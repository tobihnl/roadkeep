/* Roadkeep service worker.
   Two caches: the app shell (small, versioned) and map tiles (big, capped).
   Bump SHELL_V whenever index.html / app.js change. */
const SHELL_V = 'rk-shell-3';
const TILE_V  = 'rk-tiles-2';
const TILE_MAX = 900;
const TILE_TTL = 7 * 24 * 60 * 60 * 1000;   // OSM policy minimum before revalidating

const SHELL = [
  './', './index.html', './app.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon-32.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', e=>{
  e.waitUntil((async()=>{
    const c = await caches.open(SHELL_V);
    // don't let one failed CDN request block the whole install
    await Promise.all(SHELL.map(u=>c.add(new Request(u,{mode:'cors'})).catch(()=>{})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e=>{
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==SHELL_V && k!==TILE_V).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trimTiles(){
  const c = await caches.open(TILE_V);
  const keys = await c.keys();
  if(keys.length > TILE_MAX){
    for(const k of keys.slice(0, keys.length - TILE_MAX)) await c.delete(k);
  }
}

self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  /* Map tiles. The OSM Tile Usage Policy permits re-serving tiles the user has
     actually viewed, from a local cache honouring the server's caching headers
     (or a 7-day minimum). It forbids pre-fetching or "download for offline".
     So: only cache what was genuinely requested, and revalidate once stale. */
  if(/tile\.openstreetmap\.org/.test(url.hostname)){
    e.respondWith((async()=>{
      const c = await caches.open(TILE_V);
      const hit = await c.match(req);

      if(hit){
        const dated = hit.headers.get('date');
        const ageMs = dated ? Date.now() - Date.parse(dated) : Infinity;
        if(ageMs < TILE_TTL) return hit;
        // stale: serve it, but refresh in the background with a conditional request
        e.waitUntil((async()=>{
          try{
            const headers = new Headers();
            const etag = hit.headers.get('etag');
            const lm = hit.headers.get('last-modified');
            if(etag) headers.set('If-None-Match', etag);
            else if(lm) headers.set('If-Modified-Since', lm);
            const res = await fetch(new Request(req.url, {headers, mode:'cors', credentials:'omit'}));
            if(res.status === 200){ await c.put(req, res.clone()); trimTiles(); }
          }catch(err){}
        })());
        return hit;
      }

      try{
        const res = await fetch(req);
        if(res.ok){ c.put(req, res.clone()); trimTiles(); }
        return res;
      }catch(err){
        return new Response('', {status:504});   // offline and never seen: blank tile
      }
    })());
    return;
  }

  // never cache the reverse geocoder
  if(/nominatim\.openstreetmap\.org/.test(url.hostname)) return;

  // app shell: cache first, revalidate quietly
  e.respondWith((async()=>{
    const c = await caches.open(SHELL_V);
    const hit = await c.match(req, {ignoreSearch:true});
    const net = fetch(req).then(res=>{ if(res.ok) c.put(req, res.clone()); return res; }).catch(()=>null);
    return hit || (await net) || new Response('Offline', {status:503});
  })());
});
