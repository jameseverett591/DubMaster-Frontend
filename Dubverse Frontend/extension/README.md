# DubMaster Import — browser extension

Adds **Import** buttons to YouTube in two places:

- **Watch pages** — an "Import to DubMaster" button next to Like/Share
- **Feeds** (home, channel, search, sidebar) — a "DubMaster" button that
  appears when you hover any video thumbnail

The toolbar button also works everywhere: on a video it deep-links the
import, on any other YouTube page it just opens the DubMaster YouTube tab.
All of them land on `/studio?tab=youtube&yt_url=...` and start the
import automatically.

## Install (development)

Chrome / Edge: open `chrome://extensions` (or `edge://extensions`), enable
**Developer mode**, click **Load unpacked**, select this folder.
Firefox: build first (below), then `about:debugging` → **Load Temporary
Add-on** → `dist/firefox/manifest.json` (removed when Firefox restarts).

## Build for the stores

```
node build.mjs
```

Writes `dist/dubmaster-import-chrome-edge.zip` (Chrome Web Store + Edge
Add-ons) and `dist/dubmaster-import-firefox.zip` (Firefox Add-ons). The
Firefox build swaps `background.service_worker` for `background.scripts` and
adds the add-on id + data-collection declaration. Bump `version` in
`manifest.json` for every store upload. Icons in `icons/` are generated
placeholders — replace with final brand art.

## Configure

`DUBMASTER_URL` is set at the top of `content.js` and `background.js`
(production: `https://dubmasterai.com`). For local development temporarily
set it to `http://localhost:3001`.

The deep link is `/studio?tab=youtube&yt_url=<video-url>`. Middleware adds the
locale prefix; the YouTube tab consumes `yt_url`, runs the import, and strips
the param so a refresh doesn't re-import.

## Notes

- You must be signed in to DubMaster — the import runs against your account.
- Only import videos you own, have permission for, or that are public domain.
- Private and DRM-protected videos can't be imported from a link. Age-restricted videos can be imported when the backend has a signed-in YouTube session (cookies) configured — otherwise upload the file instead.
