# Deploying Roadkeep

*Internal notes. Roadkeep is not open source — see LICENSE.*

Static files, no build step, no dependencies to install.

```
index.html              app shell and styles
app.js                  everything else
sw.js                   service worker (offline + tile cache)
manifest.webmanifest    home-screen metadata
icon-192.png            \
icon-512.png             |
icon-512-maskable.png    |  icons
apple-touch-icon.png     |
favicon-32.png          /
README.md
SHORTCUTS.md
```

## It needs HTTPS

A `file://` page cannot install to a home screen or run a service worker. Opening `index.html` from disk works for a quick look on desktop, but not on the phone.

## Cloudflare Pages, from a private repo — recommended

Keeps the source out of public view, free, HTTPS, and no public repository inviting forks.

1. Create the GitHub repository as **Private**. Push these files to the root, so `index.html` is top level rather than inside a folder.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, authorise, pick the repo.
3. Framework preset: **None**. Build command: leave empty. Output directory: `/`.
4. Deploy. You get `https://<project>.pages.dev`, and a custom domain if you want one.
5. Update the "Open Roadkeep" link at the top of `README.md`.

Netlify works identically and also allows private repos on its free tier.

### If you use GitHub Pages instead

Free-plan Pages only publishes from a **public** repository, which puts the source on display and invites forks. Pro lets you publish from a private repo, but the site itself stays public either way — genuinely private Pages needs Enterprise Cloud.

Either way, none of this exposes your roads. The vault never enters the repository; it lives in iCloud and on your devices.

### What "not open source" actually buys you

The LICENSE makes reuse unlawful. It does not make it impossible — this is a browser app, so anyone who loads the page can read the JavaScript, and minifying only slows them down. Practically:

- A **private repo** removes the obvious fork button and stops the code being indexed and searched.
- `robots.txt` keeps the deployed app out of search results.
- **Cloudflare Access** (free for up to 50 users) can put an email-code login in front of the whole site if you want it genuinely closed. Test it against the installed home-screen app first — auth redirects and service workers don't always get along.

Choose based on what you're protecting. If it's the idea and the effort, the licence plus a private repo is proportionate. If it's revenue, that's a different conversation and a server-side component.

## Install on iPhone

Open the URL in **Safari**, then Share → **Add to Home Screen**, and launch it from the icon rather than from Safari. Home-screen apps get their own storage, which escapes Safari's seven-day eviction rule for ordinary websites.

The app itself works offline after the first launch, and tiles you have actually looked at are re-served from cache. Deliberately pre-loading an area is **not** possible and not permitted — see the tile note below.

## Desktop

Just open the URL. Chrome and Edge additionally offer **Sync → Keep it in a file on disk**, which auto-saves every change into a real `.json` you choose. Safari and Firefox fall back to explicit save and open.

## Storage, honestly

| Where | Durability |
|---|---|
| Browser storage | A cache. iOS can evict it under disk pressure and clearing Safari wipes it. Never the only copy. |
| iCloud via Shortcut | Durable. One tap each way. The home on iPhone. |
| File on disk (Chrome/Edge desktop) | Durable, written on every change. |
| Downloaded JSON | Durable, manual. |

The dot beside the segment count shows where you stand: grey means written, orange means changes not yet in a file, green means a linked file is taking every save.

## Updating the app

Replace the files, then bump `SHELL_V` in `sw.js` (`rk-shell-2` → `rk-shell-3`). Without that, the service worker keeps serving the cached old version. Vault data is in separate storage and is untouched by app updates.

## Third-party terms

Your own licence choice doesn't change these, and they apply regardless of whether the app is open or closed.

**Leaflet** is BSD-2-Clause — permissive, usable in closed-source software, needs its copyright notice retained.

**OpenStreetMap data** is ODbL. Share-alike attaches to *databases derived from OSM*, not to your application code. Your segments are traced from your own GPS recordings, so the vault isn't a derivative database. Place names fetched from Nominatim are, per the OSMF [Geocoding Guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Geocoding_-_Guideline), *insubstantial extracts* that may be stored alongside proprietary data without triggering share-alike — as long as you're not systematically harvesting a city-sized area. Marking a few hundred roads is nowhere near that line. **Attribution to OpenStreetMap is required**, and is shown on the map.

**OSM tile servers** are the tight constraint, and the rules are stricter than most people assume:

- Tiles are donation-funded and free-for-everyone does **not** apply to them.
- Re-serving tiles the user actually viewed, from a local cache honouring caching headers or a 7-day minimum, is **permitted**. That is what `sw.js` does.
- **Pre-fetching and "download this area for offline" are prohibited.** Don't add such a feature, and don't tell users to pan around to seed the cache — that's pre-seeding by hand.
- Attribution must stay visible and must not be hidden behind a toggle.
- Don't set a restrictive `Referrer-Policy`; the tile servers rely on the `Referer` header to identify web traffic.

If Roadkeep ever gets real users, or if you want genuine offline maps in the Alps, move off `tile.openstreetmap.org` to a provider whose terms allow caching and offline packs, or self-host. Vector tiles are the usual answer. Keep the tile URL easy to change — the policy explicitly recommends not hard-coding it.

## Known limits

- First launch needs a connection — Leaflet comes from a CDN, then it's cached.
- Place-name lookup uses Nominatim, roughly one request per second, skipped when offline. Names fall back to date and length.
- A browser cannot record GPS in the background, so the track comes from a dedicated recorder.
- Map tiles only work offline where you have already been looking. That's a deliberate limit, not a bug.
