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

It works offline after the first launch. Tiles are cached as you browse, so pan around your home region once while online.

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

## Known limits

- First launch needs a connection — Leaflet comes from a CDN, then it's cached.
- Place-name lookup uses Nominatim, roughly one request per second, skipped when offline. Names fall back to date and length.
- A browser cannot record GPS in the background, so the track comes from a dedicated recorder.
