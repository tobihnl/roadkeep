/* ============================================================
   Roadkeep — save the good stretches, not whole routes.
   Local-first. The JSON file is the asset; this is a viewer over it.
   ============================================================ */

/* ---------------- state ---------------- */
const NS    = 'roadkeep';
const STORE = NS + '.v1';
/* older names, read once so nothing is stranded by the rename */
const LEGACY = ['segmentVault.v2', 'segmentVault.v1'];

let state = loadLocal();                 // {segments:[], deleted:[{id,deletedAt}]}
let vault = state.segments;
let rides = [], ride = null;
let candidates = [], selectedId = null, editing = null;
let dirty = 0;                            // changes since last write to a real file

const $ = id => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const now = () => new Date().toISOString();
const fmt = (n,d=1) => Number(n).toFixed(d);
const esc = s => String(s??'').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));

function toast(m, ms=2400){
  const t=$('toast'); t.textContent=m; t.classList.add('on');
  clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('on'), ms);
}

/* ---------------- geometry ---------------- */
function hav(a,b){
  const R=6371, r=Math.PI/180;
  const dLat=(b.lat-a.lat)*r, dLon=(b.lon-a.lon)*r;
  const s=Math.sin(dLat/2)**2 + Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}
function bearing(a,b){
  const r=Math.PI/180;
  const y=Math.sin((b.lon-a.lon)*r)*Math.cos(b.lat*r);
  const x=Math.cos(a.lat*r)*Math.sin(b.lat*r)-Math.sin(a.lat*r)*Math.cos(b.lat*r)*Math.cos((b.lon-a.lon)*r);
  return (Math.atan2(y,x)/r+360)%360;
}
const compass = d => ['N','NE','E','SE','S','SW','W','NW'][Math.round(d/45)%8];

/* degrees of heading change per km — crude but honest */
function curviness(pts){
  if(pts.length<3) return 0;
  let km=0, turn=0, prev=null, last=pts[0];
  for(let i=1;i<pts.length;i++){
    const d=hav(last,pts[i]);
    if(d<0.012) continue;
    const b=bearing(last,pts[i]);
    if(prev!==null){ let dd=Math.abs(b-prev); if(dd>180) dd=360-dd; if(dd<120) turn+=dd; }
    prev=b; km+=d; last=pts[i];
  }
  return km>0.3 ? turn/km : 0;
}
function len(pts){ let k=0; for(let i=1;i<pts.length;i++) k+=hav(pts[i-1],pts[i]); return k }
const toPt = c => ({lat:c[0], lon:c[1]});

/* Douglas–Peucker, ~8 m. A season at 1 Hz would otherwise fill storage. */
function simplify(coords, tolKm=0.008){
  if(coords.length<3) return coords;
  const perp=(p,a,b)=>{
    const kx=111.32*Math.cos(p[0]*Math.PI/180), ky=110.57;
    const px=(p[1]-a[1])*kx, py=(p[0]-a[0])*ky;
    const bx=(b[1]-a[1])*kx, by=(b[0]-a[0])*ky;
    const L2=bx*bx+by*by;
    if(L2===0) return Math.hypot(px,py);
    let t=(px*bx+py*by)/L2; t=Math.max(0,Math.min(1,t));
    return Math.hypot(px-t*bx, py-t*by);
  };
  const keep=new Array(coords.length).fill(false);
  keep[0]=keep[coords.length-1]=true;
  const stack=[[0,coords.length-1]];
  while(stack.length){
    const [i,j]=stack.pop();
    let maxD=0, idx=-1;
    for(let k=i+1;k<j;k++){ const d=perp(coords[k],coords[i],coords[j]); if(d>maxD){maxD=d;idx=k} }
    if(maxD>tolKm && idx>0){ keep[idx]=true; stack.push([i,idx],[idx,j]) }
  }
  return coords.filter((_,i)=>keep[i]);
}

/* ---------------- colours ----------------
   The OSM basemap already owns orange (primary), yellow (secondary),
   green (forest) and blue (water). Everything here avoids those. */
const C = { ride:'#33415c', active:'#ff1493', casing:'#ffffff', avoid:'#c62828' };
const RATING_RAMP = ['#8d99ae','#7a6ea8','#8e44ad','#c2186b','#e6007e'];
const SURFACE_COL = { 'asphalt':'#5e35b1','mixed':'#00897b','gravel':'#d81b60',
                      'rough gravel':'#6d4c41','unknown':'#607d8b' };
let colorMode = localStorage.getItem(NS+'.colorMode') || 'rating';

function segColor(s){
  if(s.avoid) return C.avoid;
  if(colorMode==='surface') return SURFACE_COL[s.surface] || SURFACE_COL.unknown;
  return RATING_RAMP[Math.max(0,Math.min(4,(s.rating||3)-1))];
}
const segWeight = s => 3 + Math.max(1,Math.min(5,s.rating||3));

function isStale(s){
  if(!s.lastConfirmed) return true;
  return (Date.now()-Date.parse(s.lastConfirmed))/864e5 > 730;
}
function renderLegend(){
  const items = colorMode==='surface'
    ? Object.entries(SURFACE_COL).map(([k,v])=>[v,k])
    : RATING_RAMP.map((v,i)=>[v,'★'.repeat(i+1)]);
  $('legend').innerHTML = items.map(([c,l])=>`<span class="lg"><i style="background:${c}"></i>${esc(l)}</span>`).join('')
    + `<span class="lg"><i style="background:${C.avoid}"></i>avoid</span>`
    + `<div class="hint" style="margin-top:5px;width:100%">Line thickness always shows the rating.</div>`;
}

/* ---------------- map ---------------- */
const map = L.map('map', {zoomControl:true, tap:true}).setView([49.45,11.08], 9);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  {maxZoom:19, attribution:'&copy; OpenStreetMap'}).addTo(map);
const layerRide = L.layerGroup().addTo(map);
const layerSegs = L.layerGroup().addTo(map);
const layerEdit = L.layerGroup().addTo(map);
const layerMe   = L.layerGroup().addTo(map);
const hlLayer   = L.layerGroup().addTo(map);

function cased(coords, opts, group){
  L.polyline(coords,{color:C.casing, weight:(opts.weight||5)+4,
    opacity: opts.opacity!=null ? Math.min(1,opts.opacity+.25) : .9,
    lineCap:'round', interactive:false}).addTo(group);
  return L.polyline(coords, opts).addTo(group);
}

/* ============================================================
   STORAGE + SYNC
   Every segment carries updatedAt; deletions leave a tombstone.
   Merging is then order-independent: newest wins, per segment.
   ============================================================ */
function loadLocal(){
  for(const key of [STORE, ...LEGACY]){
    try{
      const d = JSON.parse(localStorage.getItem(key));
      if(!d) continue;
      if(Array.isArray(d.segments)) return {segments:d.segments.map(normalise), deleted:d.deleted||[]};
      if(Array.isArray(d)) return {segments:d.map(normalise), deleted:[]};   // oldest shape
    }catch(e){}
  }
  return {segments:[], deleted:[]};
}
function normalise(s){
  if(!s.updatedAt) s.updatedAt = s.createdAt || new Date(0).toISOString();
  return s;
}
function stripTransient(s){ const {a,b,_attachedTo,_new,_autoNamed,...rest}=s; return rest }
function payload(){
  return JSON.stringify({
    format:'roadkeep', version:2, exported:now(),
    segments: vault.map(stripTransient), deleted: state.deleted
  }, null, 2);
}

/* newest-wins merge, tombstones included */
function mergeDoc(doc){
  const inSegs = (doc.segments||doc||[]).filter(x=>x&&x.id).map(normalise);
  const inDel  = doc.deleted || [];
  const byId = new Map(vault.map(s=>[s.id,s]));
  const delById = new Map(state.deleted.map(d=>[d.id,d]));
  let added=0, updated=0, removed=0;

  for(const d of inDel){
    const cur = delById.get(d.id);
    if(!cur || d.deletedAt > cur.deletedAt) delById.set(d.id, d);
  }
  for(const s of inSegs){
    const t = delById.get(s.id);
    if(t && t.deletedAt >= s.updatedAt) continue;      // deleted after this version
    const cur = byId.get(s.id);
    if(!cur){ byId.set(s.id,s); added++ }
    else if(s.updatedAt > cur.updatedAt){ byId.set(s.id,s); updated++ }
  }
  for(const [id,t] of delById){
    const cur = byId.get(id);
    if(cur && t.deletedAt >= cur.updatedAt){ byId.delete(id); removed++ }
  }
  vault = [...byId.values()];
  state.segments = vault;
  state.deleted = [...delById.values()];
  return {added, updated, removed};
}
function touch(s){ s.updatedAt = now(); }
function removeSegment(id){
  vault = vault.filter(s=>s.id!==id);
  state.segments = vault;
  state.deleted = state.deleted.filter(d=>d.id!==id).concat([{id, deletedAt: now()}]);
}

function save(){
  try{
    localStorage.setItem(STORE, JSON.stringify({segments:vault.map(stripTransient), deleted:state.deleted}));
  }catch(err){
    toast('Browser storage is full — save to a file now.', 5000);
    console.error(err);
  }
  dirty++;
  writeFile();
  renderList(); renderSegs(); stats(); storageStatus();
}

/* ---- desktop: a real file via the File System Access API ---- */
let fileHandle=null, pendingHandle=null;
const canFS = typeof window.showSaveFilePicker === 'function';

function idbOp(fn){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(NS,1);
    r.onupgradeneeded=()=>r.result.createObjectStore('kv');
    r.onerror=()=>rej(r.error);
    r.onsuccess=()=>{ const q=fn(r.result.transaction('kv','readwrite').objectStore('kv'));
      q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error); };
  });
}
const idbGet=k=>idbOp(st=>st.get(k)), idbPut=(k,v)=>idbOp(st=>st.put(v,k));

async function writeFile(){
  if(!fileHandle) return false;
  try{
    if(await fileHandle.queryPermission({mode:'readwrite'})!=='granted') return false;
    const w=await fileHandle.createWritable();
    await w.write(payload()); await w.close();
    dirty=0; storageStatus(); return true;
  }catch(e){ console.warn(e); return false }
}
async function readFileInto(){
  try{
    const txt = await (await fileHandle.getFile()).text();
    if(!txt.trim()) return {added:0,updated:0,removed:0};
    return mergeDoc(JSON.parse(txt));
  }catch(e){ console.warn(e); return {added:0,updated:0,removed:0} }
}
async function linkFile(){
  if(!canFS) return toast('This browser cannot write files directly. Use “Share / save file…”.', 4000);
  try{
    fileHandle = await window.showSaveFilePicker({ suggestedName:'roadkeep.json',
      types:[{description:'Roadkeep', accept:{'application/json':['.json']}}] });
    await idbPut('fileHandle', fileHandle);
    const r = await readFileInto();
    await writeFile(); save();
    toast(r.added||r.updated ? `Linked · ${r.added} new, ${r.updated} updated merged in.` : 'Linked. Every change now writes to that file.');
  }catch(e){ if(e.name!=='AbortError') toast('Could not link: '+e.message) }
}
async function reconnect(){
  const h = pendingHandle || await idbGet('fileHandle').catch(()=>null);
  if(!h) return linkFile();
  try{
    if(await h.requestPermission({mode:'readwrite'})!=='granted') return toast('Permission declined.');
    fileHandle=h; pendingHandle=null;
    await readFileInto(); save(); toast('Reconnected.');
  }catch(e){ toast('Could not reconnect: '+e.message) }
}
async function tryReconnectQuietly(){
  if(!canFS) return storageStatus();
  try{
    const h=await idbGet('fileHandle');
    if(!h) return storageStatus();
    if(await h.queryPermission({mode:'readwrite'})==='granted'){ fileHandle=h; await readFileInto(); save() }
    else pendingHandle=h;
  }catch(e){}
  storageStatus();
}

/* ---- iPhone: iCloud through the clipboard and a Shortcut ----
   iOS has no File System Access API and no public iCloud API, but Shortcuts
   can write iCloud Drive freely. The clipboard carries the payload because
   URL schemes choke on anything large. */
const scName = k => localStorage.getItem(NS+'.sc.'+k) || (k==='save'?'Save Roadkeep':'Load Roadkeep');

async function shortcutSave(){
  try{
    await navigator.clipboard.writeText(payload());
  }catch(e){
    return toast('Clipboard blocked. Use “Share / save file…” instead.', 4500);
  }
  dirty=0; storageStatus();
  toast('Copied. Handing over to Shortcuts…');
  location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent(scName('save'));
}
function shortcutLoad(){
  toast('Running the Shortcut. Come back and tap Paste.', 3500);
  location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent(scName('load'));
}
async function pasteVault(){
  let txt='';
  try{ txt = await navigator.clipboard.readText() }
  catch(e){ return toast('Clipboard read blocked — use the paste box below.', 4500) }
  mergeText(txt);
}
function mergeText(txt){
  if(!txt || !txt.trim()) return toast('Nothing to merge.');
  let doc;
  try{ doc = JSON.parse(txt) }catch(e){ return toast('That is not Roadkeep JSON.') }
  const r = mergeDoc(doc);
  save(); fitAll();
  toast(`Merged · ${r.added} new, ${r.updated} updated, ${r.removed} removed.`, 4000);
}

/* ---- anywhere: share sheet / download ---- */
function dl(text, name, type='application/octet-stream'){
  const b=new Blob([text],{type}), u=URL.createObjectURL(b);
  const a=document.createElement('a'); a.href=u; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(u),1500);
}
async function shareFile(){
  const file = new File([payload()], 'roadkeep.json', {type:'application/json'});
  if(navigator.canShare && navigator.canShare({files:[file]})){
    try{
      await navigator.share({files:[file], title:'Roadkeep'});
      dirty=0; storageStatus();
      return;
    }catch(e){ if(e.name==='AbortError') return }
  }
  dl(payload(), `roadkeep-${new Date().toISOString().slice(0,10)}.json`, 'application/json');
  dirty=0; storageStatus();
}

function storageStatus(){
  const el=$('storeStatus'); if(!el) return;
  $('syncDot').className = fileHandle ? 'ok' : (dirty ? 'dirty' : '');
  if(fileHandle){
    el.className='ok';
    el.innerHTML=`Saving straight into <b>${esc(fileHandle.name)}</b> on disk.`;
    $('btnLink').textContent='Change file'; $('btnReconnect').style.display='none';
  } else if(pendingHandle){
    el.className='warn';
    el.innerHTML=`A file was linked before (<b>${esc(pendingHandle.name)}</b>). The browser needs permission again.`;
    $('btnReconnect').style.display='';
  } else {
    el.className = dirty ? 'warn' : 'hint';
    el.innerHTML = dirty
      ? `<b>${dirty} change${dirty===1?'':'s'} not written to a file yet.</b> Browser storage alone is not a home — iOS can evict it.`
      : `In browser storage. Save to iCloud or a file to make it durable.`;
    $('btnReconnect').style.display = 'none';
  }
}
window.addEventListener('beforeunload', e=>{ if(!fileHandle && dirty>0){ e.preventDefault(); e.returnValue='' } });

/* ============================================================
   RIDES
   ============================================================ */
function parseGpx(text, name){
  const doc = new DOMParser().parseFromString(text,'application/xml');
  if(doc.querySelector('parsererror')) throw new Error('not valid XML');
  let nodes=[...doc.getElementsByTagName('trkpt')];
  if(!nodes.length) nodes=[...doc.getElementsByTagName('rtept')];
  if(!nodes.length) nodes=[...doc.getElementsByTagName('wpt')];
  const pts=[];
  for(const n of nodes){
    const lat=parseFloat(n.getAttribute('lat')), lon=parseFloat(n.getAttribute('lon'));
    if(!isFinite(lat)||!isFinite(lon)) continue;
    const t=n.getElementsByTagName('time')[0];
    const ms=t?Date.parse(t.textContent.trim()):NaN;
    pts.push({lat,lon,t:isFinite(ms)?ms:null});
  }
  if(pts.length<2) throw new Error('no track points found');
  const cum=[0];
  for(let i=1;i<pts.length;i++) cum[i]=cum[i-1]+hav(pts[i-1],pts[i]);
  return {name, pts, cum, hasTime: pts.some(p=>p.t!==null)};
}
function addRides(files){
  let done=0;
  [...files].forEach(f=>{
    const fr=new FileReader();
    fr.onload=()=>{
      try{ rides.push(parseGpx(fr.result, f.name.replace(/\.gpx$/i,''))) }
      catch(e){ toast(f.name+': '+e.message) }
      if(++done===files.length) renderRides();
    };
    fr.readAsText(f);
  });
}
function renderRides(){
  const sel=$('rideSel');
  sel.innerHTML = rides.map((r,i)=>
    `<option value="${i}">${esc(r.name)} · ${fmt(r.cum.at(-1))} km${r.hasTime?'':' · no times'}</option>`).join('');
  if(rides.length){ sel.value=rides.length-1; pickRide(rides.length-1) }
  else { ride=null; layerRide.clearLayers(); renderSegs() }
}
function pickRide(i){
  ride=rides[i]; cancelHighlight(); candidates=[];
  layerRide.clearLayers();
  if(!ride) return;
  const ll=ride.pts.map(p=>[p.lat,p.lon]);
  L.polyline(ll,{color:'#fff',weight:6,opacity:.7,interactive:false}).addTo(layerRide);
  const line=L.polyline(ll,{color:C.ride,weight:3,opacity:.85,interactive:false}).addTo(layerRide);
  map.fitBounds(line.getBounds(),{padding:[30,30]});
  if(!ride.hasTime) toast('No timestamps in this GPX — marks match by coordinates only.', 4000);
  renderList(); renderSegs(); offscreenNotice();
}

/* ============================================================
   MARKS → PROPOSED SEGMENTS
   ============================================================ */
function parseMarkers(text){
  const out=[];
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();
    if(!line||line.startsWith('#')) continue;
    const parts=line.split(/\s*[,;\t|]\s*/);
    let t=null, lat=null, lon=null, note=[];
    for(const p of parts){
      const num=Number(p);
      if(t===null){ const d=Date.parse(p); if(isFinite(d)){ t=d; continue } }
      if(isFinite(num)&&p!==''&&lat===null&&Math.abs(num)<=90&&/\./.test(p)){ lat=num; continue }
      if(isFinite(num)&&p!==''&&lat!==null&&lon===null&&Math.abs(num)<=180&&/\./.test(p)){ lon=num; continue }
      note.push(p);
    }
    if(t===null&&lat===null) continue;
    out.push({t,lat,lon,note:note.join(', ')});
  }
  return out;
}
function nearestIndex(m){
  if(!ride) return -1;
  if(m.t!==null && ride.hasTime){
    let best=-1,bd=Infinity;
    ride.pts.forEach((p,i)=>{ if(p.t===null)return; const d=Math.abs(p.t-m.t); if(d<bd){bd=d;best=i} });
    if(best>=0 && bd<45*60*1000) return best;
  }
  if(m.lat!==null&&m.lon!==null){
    let best=-1,bd=Infinity;
    ride.pts.forEach((p,i)=>{ const d=hav(p,m); if(d<bd){bd=d;best=i} });
    if(best>=0 && bd<0.5) return best;
  }
  return -1;
}
function makeCandidate(a,b,note){
  a=Math.max(0,a); b=Math.min(ride.pts.length-1,b);
  if(b-a<3) return null;
  const pts=ride.pts.slice(a,b+1);
  return { id:uid(), name:'', rating:4, avoid:false, note:note||'',
    a, b, rideName:ride.name, _attachedTo:ride.name,
    coords: pts.map(p=>[p.lat,p.lon]),
    lengthKm: len(pts), curv: curviness(pts),
    dir: compass(bearing(pts[0],pts.at(-1))),
    surface:'asphalt', season:'',
    lastConfirmed: new Date(pts[0].t||Date.now()).toISOString().slice(0,10),
    createdAt: now(), updatedAt: now(), _new:true };
}
function cutFromMarkers(){
  if(!ride) return toast('Load a GPX ride first.');
  const ms=parseMarkers($('markerTxt').value);
  if(!ms.length) return toast('No marks parsed.');
  const km=parseFloat($('lookback').value);
  candidates=[]; let miss=0;
  for(const m of ms){
    const i=nearestIndex(m);
    if(i<0){ miss++; continue }
    const target=ride.cum[i]-km;
    let s=i; while(s>0 && ride.cum[s]>target) s--;
    const c=makeCandidate(s,i,m.note); if(c) candidates.push(c);
  }
  renderList(); renderSegs();
  toast(`${candidates.length} proposed${miss?` · ${miss} mark(s) not on this ride`:''}`);
  if(candidates.length) openEditor(candidates[0]);
}
function autoSuggest(){
  if(!ride) return toast('Load a GPX ride first.');
  const win=parseFloat($('lookback').value), step=.5, out=[];
  let s=0;
  for(let startKm=0; startKm<ride.cum.at(-1)-win; startKm+=step){
    while(ride.cum[s]<startKm) s++;
    let e=s; while(e<ride.cum.length-1 && ride.cum[e]<startKm+win) e++;
    out.push({a:s,b:e,score:curviness(ride.pts.slice(s,e+1))});
  }
  out.sort((x,y)=>y.score-x.score);
  const picked=[];
  for(const o of out){
    if(picked.some(p=>!(o.b<p.a||o.a>p.b))) continue;
    picked.push(o); if(picked.length>=5) break;
  }
  candidates=picked.map(p=>makeCandidate(p.a,p.b,'auto-suggested')).filter(Boolean);
  renderList(); renderSegs();
  toast(`${candidates.length} curvy stretches proposed — judge them, it is only maths.`, 3500);
  if(candidates.length) openEditor(candidates[0]);
}

/* ============================================================
   HIGHLIGHT BY HAND
   ============================================================ */
function nearestTrackIdx(ll){
  if(!ride) return -1;
  let best=-1,bd=Infinity;
  const q={lat:ll.lat,lon:ll.lng};
  for(let i=0;i<ride.pts.length;i++){ const d=hav(ride.pts[i],q); if(d<bd){bd=d;best=i} }
  return best;
}
function hint(html){ const h=$('hintbar'); if(html){h.innerHTML=html;h.classList.add('on')} else h.classList.remove('on') }

let hlStart=null, hlRaf=0;
function trackClick(ll){
  if(!ride || editing) return;
  const idx=nearestTrackIdx(ll);
  if(idx<0) return;
  const tol = hlStart===null ? 0.35 : 1.0;
  if(hav(ride.pts[idx],{lat:ll.lat,lon:ll.lng}) > tol){
    if(hlStart!==null) toast('Too far from the track.');
    return;
  }
  if(hlStart===null){
    hlStart=idx;
    hint('Start set. Tap again where it ends. <b>Esc</b> cancels.');
    hlPreview(idx);
    map.on('mousemove', hlMove);
    return;
  }
  const [a,b]=[hlStart,idx].sort((x,y)=>x-y);
  cancelHighlight();
  const c=makeCandidate(a,b,'');
  if(!c) return toast('Too short — pick points further apart.');
  candidates.push(c); renderList(); renderSegs(); openEditor(c);
}
function hlPreview(idx){
  const [a,b]=[hlStart,idx].sort((x,y)=>x-y);
  hlLayer.clearLayers();
  if(b-a<2){ L.circleMarker(ride.pts[a]&&[ride.pts[a].lat,ride.pts[a].lon],
      {radius:7,color:C.active,fillColor:'#fff',fillOpacity:1,weight:3}).addTo(hlLayer); return }
  const pts=ride.pts.slice(a,b+1);
  cased(pts.map(p=>[p.lat,p.lon]),{color:C.active,weight:8,opacity:.9,interactive:false},hlLayer);
  hint(`<b>${fmt(len(pts))} km</b> · ${Math.round(curviness(pts))}°/km — tap to end, Esc cancels`);
}
function hlMove(e){
  if(hlStart===null||hlRaf) return;
  hlRaf=requestAnimationFrame(()=>{ hlRaf=0; const i=nearestTrackIdx(e.latlng); if(i>=0) hlPreview(i) });
}
function cancelHighlight(){ hlStart=null; hlLayer.clearLayers(); map.off('mousemove',hlMove); hint(null) }

/* ============================================================
   RENDER
   ============================================================ */
function renderSegs(){
  layerSegs.clearLayers(); renderLegend();
  const staleOnly = $('btnStale').dataset.on==='1';
  for(const s of vault){
    if(staleOnly && !isStale(s)) continue;
    const pl=cased(s.coords,{color:segColor(s), weight:segWeight(s)+(s.id===selectedId?3:0),
      opacity:isStale(s)?.45:.95, dashArray:s.avoid?'8 7':null, lineCap:'round'}, layerSegs);
    pl.bindTooltip(`${esc(s.name||'unnamed')} · ${fmt(s.lengthKm)} km · ${s.avoid?'AVOID':'★'.repeat(s.rating||0)}`,{sticky:true});
    pl.on('click',()=>{ selectedId=s.id; openEditor(s); renderList(); renderSegs() });
  }
  for(const c of candidates){
    cased(c.coords,{color:C.active,weight:6,opacity:.9,dashArray:'3 8',lineCap:'round'},layerSegs)
      .bindTooltip('proposed — tap to review and save',{sticky:true})
      .on('click',()=>openEditor(c));
  }
}
function renderList(){
  const ul=$('segList');
  const items=[...candidates.map(c=>({s:c,cand:true})), ...vault.map(s=>({s,cand:false}))];
  $('vaultBadge').textContent = vault.length;
  if(!items.length){ ul.innerHTML='<li style="color:var(--muted)">Nothing saved yet.</li>'; return }
  ul.innerHTML = items.map(({s,cand})=>`
    <li data-id="${s.id}" class="${s.id===selectedId?'sel':''}">
      <span class="dot" style="background:${cand?C.active:segColor(s)}"></span>
      <span class="grow">
        <div class="nm ell">${esc(s.name || (cand?'proposed — not saved':'unnamed'))}</div>
        <div class="meta">${fmt(s.lengthKm)} km · ${s.dir} · ${Math.round(s.curv)}°/km${s.avoid?' · avoid':''}${(!cand&&isStale(s))?' · stale':''}</div>
        ${s.note?`<div class="meta ell">${esc(s.note)}</div>`:''}
      </span></li>`).join('');
  [...ul.querySelectorAll('li[data-id]')].forEach(li=>li.onclick=()=>{
    const s = candidates.find(c=>c.id===li.dataset.id) || vault.find(v=>v.id===li.dataset.id);
    if(!s) return;
    selectedId=s.id; openEditor(s); renderList(); renderSegs();
    map.fitBounds(L.polyline(s.coords).getBounds(),{padding:[40,40]});
    if(isPhone()) collapseSheet(true);
  });
}
function stats(){
  const km=vault.reduce((a,s)=>a+s.lengthKm,0);
  $('stats').innerHTML = `${vault.length} segments · ${fmt(km)} km`;
}
function fitAll(){
  if(!vault.length) return;
  map.fitBounds(L.featureGroup(vault.map(s=>L.polyline(s.coords))).getBounds(),{padding:[40,40]});
  setTimeout(offscreenNotice,300);
}
function offscreenNotice(){
  const el=$('offscreen');
  if(!vault.length){ el.style.display='none'; return }
  const b=map.getBounds();
  const off=vault.filter(s=>!s.coords.some(c=>b.contains(c))).length;
  if(off){ el.innerHTML=`${off} segment${off===1?'':'s'} off-screen — <b>tap to show</b>`; el.style.display='block' }
  else el.style.display='none';
}

/* ============================================================
   NAMING
   ============================================================ */
function autoName(s){
  const d=s.lastConfirmed || (s.createdAt||'').slice(0,10);
  const day=d?new Date(d).toLocaleDateString(undefined,{day:'numeric',month:'short'}):'unknown day';
  return `${day} · ${fmt(s.lengthKm)} km ${s.dir}`;
}
async function placeName(lat,lon){
  const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=13&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`,
    {headers:{'Accept':'application/json'}});
  if(!r.ok) throw new Error(r.status);
  const a=(await r.json()).address||{};
  return a.village||a.town||a.city||a.hamlet||a.suburb||a.municipality||a.county||null;
}
async function geoName(s){
  try{
    const A=await placeName(s.coords[0][0], s.coords[0][1]);
    await new Promise(r=>setTimeout(r,1100));       // Nominatim asks for 1 req/s
    const B=await placeName(s.coords.at(-1)[0], s.coords.at(-1)[1]);
    if(A&&B&&A!==B) return `${A} → ${B}`;
    if(A||B) return `${A||B} · ${fmt(s.lengthKm)} km`;
  }catch(e){}
  return null;
}

/* ============================================================
   EDITOR
   ============================================================ */
let editLine=null, hA=null, hB=null;
function attachToRide(s){
  if(!ride){ delete s.a; delete s.b; delete s._attachedTo; return false }
  if(s._attachedTo===ride.name && s.a!==undefined) return true;
  delete s.a; delete s.b; delete s._attachedTo;
  const ia=nearestTrackIdx({lat:s.coords[0][0],lng:s.coords[0][1]});
  const ib=nearestTrackIdx({lat:s.coords.at(-1)[0],lng:s.coords.at(-1)[1]});
  if(ia<0||ib<0) return false;
  if(hav(ride.pts[ia],toPt(s.coords[0]))>0.15) return false;
  if(hav(ride.pts[ib],toPt(s.coords.at(-1)))>0.15) return false;
  if(Math.abs(ib-ia)<3) return false;
  s.a=Math.min(ia,ib); s.b=Math.max(ia,ib); s._attachedTo=ride.name;
  return true;
}
function openEditor(s){
  cancelHighlight();
  editing=s; selectedId=s.id;
  attachToRide(s);
  const isNew=!!s._new, maxIdx=ride?ride.pts.length-1:0;
  const trimmable = ride && s.a!==undefined && s._attachedTo===ride.name;
  $('editor').classList.add('on');
  $('editorBody').innerHTML = `
    <h3>${isNew?'New segment':'Edit segment'}</h3>
    <div class="hint">${esc(s.rideName||'')}</div>
    ${trimmable ? `
      <div class="hint">Drag the round handles along the road, or use the sliders.</div>
      <label class="f">Trim start</label><input type="range" id="trimA" min="0" max="${maxIdx}" value="${s.a}">
      <label class="f">Trim end</label><input type="range" id="trimB" min="0" max="${maxIdx}" value="${s.b}">
      <div class="row">
        <button data-nudge="a-">◀ start</button><button data-nudge="a+">start ▶</button>
        <button data-nudge="b-">◀ end</button><button data-nudge="b+">end ▶</button>
      </div>`
    : `<div class="hint">Re-trimming needs this segment's own ride GPX loaded${s.rideName?` (<code>${esc(s.rideName)}</code>)`:''}. Everything else is editable.</div>`}

    <div class="kv"><span>Length</span><b id="kLen">${fmt(s.lengthKm)} km</b></div>
    <div class="kv"><span>Curviness</span><b id="kCurv">${Math.round(s.curv)}°/km</b></div>
    <div class="kv"><span>Direction</span><b id="kDir">${s.dir}</b></div>

    <label class="f">Name <span style="text-transform:none;letter-spacing:0;font-weight:400">— optional</span></label>
    <input type="text" id="fName" value="${esc(s.name)}" placeholder="left blank, it names itself">
    <div class="row"><button id="bAuto" class="ghost">Name from map</button></div>

    <label class="f">Rating</label>
    <div class="stars" id="fRate">${[1,2,3,4,5].map(n=>`<button data-r="${n}" class="${s.rating===n?'on':''}">${n}</button>`).join('')}</div>

    <label class="f">Surface</label>
    <select id="fSurface">${['asphalt','mixed','gravel','rough gravel','unknown']
      .map(o=>`<option ${s.surface===o?'selected':''}>${o}</option>`).join('')}</select>

    <label class="f">Traffic / season note</label>
    <input type="text" id="fSeason" value="${esc(s.season)}" placeholder="closed Nov–May, busy Sundays">

    <label class="f">Note</label>
    <textarea id="fNote" rows="3" placeholder="gate at the north end, loose after rain…">${esc(s.note)}</textarea>

    <label class="f">Last confirmed</label>
    <input type="date" id="fConf" value="${esc(s.lastConfirmed||'')}">

    <label class="f"><input type="checkbox" id="fAvoid" ${s.avoid?'checked':''}> Mark as <b>avoid</b></label>
    <div class="hint">“Gated, no through route” is worth as much as another five-star curve.</div>

    <hr>
    <div class="row">
      <button class="primary" id="bSave">${isNew?'Save to vault':'Update'}</button>
      <button id="bClose" class="ghost">Close</button>
    </div>
    <div class="row">
      ${isNew?'<button id="bDrop" class="ghost">Discard</button>'
             :'<button id="bGpx">This one → GPX</button><button id="bDel" class="danger">Delete</button>'}
    </div>`;
  wireEditor(isNew);
  drawEdit(s);
}
function drawEdit(s){
  layerEdit.clearLayers(); editLine=null;
  editLine = cased(s.coords,{color:C.active,weight:8,opacity:.95,interactive:false}, layerEdit);
  const drag = !!(ride && s.a!==undefined && s._attachedTo===ride.name);
  hA=mkHandle(s.coords[0],'start',drag,'a');
  hB=mkHandle(s.coords.at(-1),'end',drag,'b');
}
function mkHandle(latlng,label,draggable,which){
  const m=L.marker(latlng,{draggable, zIndexOffset:2000,
    icon:L.divIcon({className:'hnd'+(which==='b'?' end':''), iconSize:[18,18], iconAnchor:[9,9]})}).addTo(layerEdit);
  if(!draggable) return m;
  m.on('drag', e=>{
    const idx=nearestTrackIdx(e.target.getLatLng());
    if(idx<0) return;
    const s=editing;
    if(which==='a') s.a=Math.min(idx,s.b-3); else s.b=Math.max(idx,s.a+3);
    s.a=Math.max(0,s.a); s.b=Math.min(ride.pts.length-1,s.b);
    const p=ride.pts[which==='a'?s.a:s.b];
    e.target.setLatLng([p.lat,p.lon]);
    recalc(s,true);
  });
  m.on('dragend',()=>{ syncSliders(); recalc(editing) });
  return m;
}
function recalc(s, light){
  const pts=ride.pts.slice(s.a,s.b+1);
  s.coords=pts.map(p=>[p.lat,p.lon]);
  s.lengthKm=len(pts); s.curv=curviness(pts); s.dir=compass(bearing(pts[0],pts.at(-1)));
  if(editLine) editLine.setLatLngs(s.coords);
  layerEdit.eachLayer(l=>{ if(l.setLatLngs && l.options.color===C.casing) l.setLatLngs(s.coords) });
  if($('kLen')){ $('kLen').textContent=fmt(s.lengthKm)+' km';
    $('kCurv').textContent=Math.round(s.curv)+'°/km'; $('kDir').textContent=s.dir }
  if(!light){ if(hA) hA.setLatLng(s.coords[0]); if(hB) hB.setLatLng(s.coords.at(-1)) }
}
function syncSliders(){ if($('trimA')){ $('trimA').value=editing.a; $('trimB').value=editing.b } }
function retrim(){
  const s=editing; if(!ride||s.a===undefined) return;
  let a=parseInt($('trimA').value), b=parseInt($('trimB').value);
  if(b<=a+2){ b=a+3; $('trimB').value=b }
  s.a=Math.max(0,a); s.b=Math.min(b,ride.pts.length-1);
  recalc(s);
}
function wireEditor(isNew){
  const s=editing;
  if($('trimA')){
    $('trimA').oninput=retrim; $('trimB').oninput=retrim;
    [...document.querySelectorAll('[data-nudge]')].forEach(b=>b.onclick=()=>{
      const k=b.dataset.nudge, step=Math.max(5,Math.round(ride.pts.length/400));
      if(k==='a-') $('trimA').value=Math.max(0,+$('trimA').value-step);
      if(k==='a+') $('trimA').value=+$('trimA').value+step;
      if(k==='b-') $('trimB').value=Math.max(0,+$('trimB').value-step);
      if(k==='b+') $('trimB').value=Math.min(ride.pts.length-1,+$('trimB').value+step);
      retrim();
    });
  }
  [...$('fRate').querySelectorAll('button')].forEach(b=>b.onclick=()=>{
    s.rating=+b.dataset.r;
    [...$('fRate').querySelectorAll('button')].forEach(x=>x.classList.toggle('on',+x.dataset.r===s.rating));
  });
  $('bClose').onclick=closeEditor;
  if($('bDrop')) $('bDrop').onclick=()=>{ candidates=candidates.filter(c=>c.id!==s.id); closeEditor() };
  if($('bDel')) $('bDel').onclick=()=>{ if(confirm('Delete this segment?')){ removeSegment(s.id); closeEditor(); save() } };
  if($('bGpx')) $('bGpx').onclick=()=>dl(gpxTrack([s]), (s.name||'segment').replace(/\W+/g,'-')+'.gpx');
  $('bAuto').onclick=async()=>{
    const b=$('bAuto'); b.disabled=true; b.textContent='asking OSM…';
    const n=await geoName(s);
    b.disabled=false; b.textContent='Name from map';
    if(n) $('fName').value=n; else { $('fName').value=autoName(s); toast('No place name — used date and length.') }
  };
  $('bSave').onclick=()=>{
    s.name=$('fName').value.trim(); s.surface=$('fSurface').value;
    s.season=$('fSeason').value.trim(); s.note=$('fNote').value.trim();
    s.lastConfirmed=$('fConf').value; s.avoid=$('fAvoid').checked;
    s.coords=simplify(s.coords);
    const unnamed=!s.name;
    if(unnamed){ s.name=autoName(s); s._autoNamed=true }
    touch(s);
    if(isNew){ delete s._new; candidates=candidates.filter(c=>c.id!==s.id); vault.push(s); state.segments=vault }
    save(); closeEditor();
    toast(unnamed?`Saved as “${s.name}”`:'Saved.');
    if(unnamed) geoName(s).then(n=>{ if(n&&s._autoNamed){ s.name=n; delete s._autoNamed; touch(s); save(); toast(`Renamed to “${n}”`) } });
  };
}
function closeEditor(){
  $('editor').classList.remove('on'); layerEdit.clearLayers(); editing=null;
  renderList(); renderSegs();
}

/* ============================================================
   EXPORT
   ============================================================ */
const gpxHead = () => `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Roadkeep" xmlns="http://www.topografix.com/GPX/1/1">\n`;
function gpxTrack(segs){
  let x=gpxHead();
  for(const s of segs){
    x+=`  <trk>\n    <name>${esc(s.name||'segment')}</name>\n`;
    x+=`    <desc>${esc([s.rating+'/5',s.surface,s.dir,Math.round(s.curv)+' deg/km',s.season,s.note].filter(Boolean).join(' | '))}</desc>\n    <trkseg>\n`;
    for(const [la,lo] of s.coords) x+=`      <trkpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}"/>\n`;
    x+=`    </trkseg>\n  </trk>\n`;
  }
  return x+'</gpx>\n';
}
function shapePoints(s, everyKm=2){
  const out=[s.coords[0]]; let acc=0;
  for(let i=1;i<s.coords.length;i++){
    acc+=hav(toPt(s.coords[i-1]), toPt(s.coords[i]));
    if(acc>=everyKm){ out.push(s.coords[i]); acc=0 }
  }
  out.push(s.coords.at(-1)); return out;
}
function gpxRoute(segs){
  let x=gpxHead()+`  <rte>\n    <name>Roadkeep route</name>\n`;
  for(const s of segs) for(const [la,lo] of shapePoints(s))
    x+=`    <rtept lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}"><name>${esc(s.name||'seg')}</name></rtept>\n`;
  return x+`  </rte>\n</gpx>\n`;
}
function notionTable(){
  return '| Segment | km | Rating | Dir | Curviness | Surface | Season/traffic | Last confirmed | Note |\n|---|---|---|---|---|---|---|---|---|\n'
    + vault.map(s=>`| ${s.name||'unnamed'} | ${fmt(s.lengthKm)} | ${s.avoid?'AVOID':'★'.repeat(s.rating||0)} | ${s.dir} | ${Math.round(s.curv)}°/km | ${s.surface} | ${s.season||''} | ${s.lastConfirmed||''} | ${(s.note||'').replace(/\|/g,'/')} |`).join('\n');
}
function csv(){
  const rows=[['name','length_km','rating','avoid','direction','curviness','surface','season','last_confirmed','note','start_lat','start_lon','end_lat','end_lon']];
  for(const s of vault) rows.push([s.name,fmt(s.lengthKm,2),s.rating,s.avoid?'yes':'no',s.dir,Math.round(s.curv),
    s.surface,s.season,s.lastConfirmed,s.note,
    s.coords[0][0].toFixed(6),s.coords[0][1].toFixed(6),s.coords.at(-1)[0].toFixed(6),s.coords.at(-1)[1].toFixed(6)]);
  return rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');
}

/* ============================================================
   UI SHELL
   ============================================================ */
const isPhone = () => window.matchMedia('(max-width: 820px)').matches;
function collapseSheet(c){ $('panel').classList.toggle('collapsed', c) }
function showTab(t){
  [...$('tabs').querySelectorAll('button')].forEach(b=>b.classList.toggle('on', b.dataset.tab===t));
  [...document.querySelectorAll('.pane')].forEach(p=>p.classList.toggle('on', p.id==='pane-'+t));
  if(isPhone()) collapseSheet(false);
}
[...$('tabs').querySelectorAll('button')].forEach(b=>b.onclick=()=>{
  if(isPhone() && b.classList.contains('on') && !$('panel').classList.contains('collapsed')) return collapseSheet(true);
  showTab(b.dataset.tab);
});
$('grip').onclick=()=>collapseSheet(!$('panel').classList.contains('collapsed'));

$('fileGpx').onchange=e=>{ addRides(e.target.files); e.target.value='' };
$('dropGpx').onclick=()=>$('fileGpx').click();
['dragenter','dragover'].forEach(ev=>$('dropGpx').addEventListener(ev,e=>{e.preventDefault();$('dropGpx').classList.add('over')}));
['dragleave','drop'].forEach(ev=>$('dropGpx').addEventListener(ev,e=>{e.preventDefault();$('dropGpx').classList.remove('over')}));
$('dropGpx').addEventListener('drop',e=>{ if(e.dataTransfer.files.length) addRides(e.dataTransfer.files) });

$('rideSel').onchange=e=>pickRide(+e.target.value);
$('btnFit').onclick=()=>{ if(ride) map.fitBounds(L.polyline(ride.pts.map(p=>[p.lat,p.lon])).getBounds(),{padding:[30,30]}) };
$('btnClearRides').onclick=()=>{
  rides=[]; candidates=[]; renderRides(); renderList(); renderSegs();
  if(vault.length){ fitAll(); toast(`Rides cleared. ${vault.length} segment${vault.length===1?'':'s'} still here.`) }
};
$('lookback').oninput=e=>$('lookbackTxt').textContent=fmt(e.target.value)+' km';
$('btnCut').onclick=cutFromMarkers;
$('btnSuggest').onclick=autoSuggest;
$('btnFitAll').onclick=fitAll;
$('offscreen').onclick=fitAll;
$('btnStale').onclick=e=>{
  const on=e.target.dataset.on==='1';
  e.target.dataset.on=on?'0':'1'; e.target.textContent=on?'Show stale':'Show all';
  renderSegs();
};
function setMode(m){
  colorMode=m; localStorage.setItem(NS+'.colorMode',m);
  $('modeRating').classList.toggle('modeon',m==='rating');
  $('modeSurface').classList.toggle('modeon',m==='surface');
  renderSegs(); renderList();
}
$('modeRating').onclick=()=>setMode('rating');
$('modeSurface').onclick=()=>setMode('surface');

/* where am I / what is near me */
function locate(then){
  if(!navigator.geolocation) return toast('No geolocation here.');
  toast('Finding you…',1500);
  navigator.geolocation.getCurrentPosition(p=>{
    const me={lat:p.coords.latitude, lon:p.coords.longitude};
    layerMe.clearLayers();
    L.circleMarker([me.lat,me.lon],{radius:8,color:'#fff',weight:3,fillColor:'#1a73e8',fillOpacity:1}).addTo(layerMe);
    then(me);
  }, err=>toast('Could not locate: '+err.message, 4000), {enableHighAccuracy:true, timeout:12000, maximumAge:30000});
}
$('locBtn').onclick=()=>locate(me=>map.setView([me.lat,me.lon], Math.max(map.getZoom(),13)));
$('btnNear').onclick=()=>locate(me=>{
  if(!vault.length) return toast('Vault is empty.');
  const near=vault.map(s=>({s, d:Math.min(...s.coords.map(c=>hav(toPt(c),me)))}))
                  .sort((x,y)=>x.d-y.d).slice(0,8);
  const grp=L.featureGroup([L.circleMarker([me.lat,me.lon]), ...near.map(n=>L.polyline(n.s.coords))]);
  map.fitBounds(grp.getBounds(),{padding:[40,40]});
  toast(`Nearest: ${near[0].s.name} · ${fmt(near[0].d)} km away`, 4000);
});

/* sync wiring */
$('btnLink').onclick=linkFile;
$('btnReconnect').onclick=reconnect;
$('btnShortSave').onclick=shortcutSave;
$('btnShortLoad').onclick=shortcutLoad;
$('btnPaste').onclick=pasteVault;
$('btnPasteBox').onclick=()=>mergeText($('pasteBox').value);
$('btnShareFile').onclick=shareFile;
$('btnImport').onclick=()=>$('fileJson').click();
$('fileJson').onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  const fr=new FileReader();
  fr.onload=()=>mergeText(fr.result);
  fr.readAsText(f); e.target.value='';
};
$('btnGpxAll').onclick=()=>vault.length?dl(gpxTrack(vault),'roadkeep.gpx'):toast('Vault is empty.');
$('btnRte').onclick=()=>vault.length?dl(gpxRoute(vault.filter(s=>!s.avoid)),'roadkeep-route.gpx'):toast('Vault is empty.');
$('btnNotion').onclick=async()=>{ try{ await navigator.clipboard.writeText(notionTable()); toast('Markdown table copied.') }
  catch(e){ dl(notionTable(),'segments.md') } };
$('btnCsv').onclick=()=>dl(csv(),'segments.csv','text/csv');

for(const k of ['save','load']){
  const el=$(k==='save'?'scSave':'scLoad');
  el.value = scName(k);
  el.onchange=()=>{ localStorage.setItem(NS+'.sc.'+k, el.value.trim()); toast('Shortcut name saved.') };
}

map.on('click', e=>trackClick(e.latlng));
map.on('moveend zoomend', offscreenNotice);

document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){ if(hlStart!==null) return cancelHighlight(); if(editing) return closeEditor() }
  if(!editing||!ride||editing.a===undefined) return;
  if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
  const step=e.shiftKey?25:5;
  const k=e.key;
  if(k==='ArrowLeft'){ editing.b=Math.max(editing.a+3,editing.b-step) }
  else if(k==='ArrowRight'){ editing.b=Math.min(ride.pts.length-1,editing.b+step) }
  else if(k==='ArrowUp'){ editing.a=Math.max(0,editing.a-step) }
  else if(k==='ArrowDown'){ editing.a=Math.min(editing.b-3,editing.a+step) }
  else return;
  syncSliders(); recalc(editing); e.preventDefault();
});

/* ---------------- boot ---------------- */
setMode(colorMode);
renderList(); renderSegs(); stats(); storageStatus();
tryReconnectQuietly();
if(vault.length) fitAll();
if(isPhone()) collapseSheet(true);
setTimeout(()=>map.invalidateSize(), 250);
window.addEventListener('resize', ()=>map.invalidateSize());

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('SW',e)));
}
if(!vault.length) toast('Load a .gpx ride, or open a vault file under Sync.', 4000);
