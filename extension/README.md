# DubMaster Import — browser extension

Adds an **Import to DubMaster** button to YouTube watch pages (next to
Like/Share) and a toolbar button that works from any YouTube page. Both open
DubMaster's dashboard on the YouTube tab and start the import automatically.

## Install (Chrome / Edge — developer mode)

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder: `Dubverse Frontend/extension`

## Configure

`DUBMASTER_URL` is set at the top of `content.js` and `background.js`:

- Development: `http://localhost:3000`
- Production: change to the deployed origin (e.g. `https://app.dubmaster.example`)

The deep link is `/dashboard?tab=youtube&yt_url=<video-url>`. Middleware adds
the locale prefix automatically; the YouTube tab consumes `yt_url`, runs the
import, and strips the param so a refresh doesn't re-import.

## Notes

- You must be signed in to DubMaster — the import runs against your account.
- Only import videos you own, have permission for, or that are public domain.
- Private and age-restricted videos are not supported.
