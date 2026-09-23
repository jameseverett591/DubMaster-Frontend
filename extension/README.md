# DubMaster Import — browser extension

Adds **Import** buttons to YouTube in two places:

- **Watch pages** — an "Import to DubMaster" button next to Like/Share
- **Feeds** (home, channel, search, sidebar) — a "DubMaster" button that
  appears when you hover any video thumbnail

The toolbar button also works everywhere: on a video it deep-links the
import, on any other YouTube page it just opens the DubMaster YouTube tab.
All of them land on `/dashboard?tab=youtube&yt_url=...` and start the
import automatically.

## Install (Chrome / Edge — developer mode)

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder: `Dubverse Frontend/extension`

## Configure

`DUBMASTER_URL` is set at the top of `content.js` and `background.js`:

- Development: `http://localhost:3000`
- Production: change to the deployed origin (e.g. `https://app.dubmaster.example`)

The deep link is `/studio?tab=youtube&yt_url=<video-url>` (`/dashboard` is
the account/history page — the tabbed Studio UI lives at `/studio`).
Middleware adds the locale prefix automatically; the YouTube tab consumes
`yt_url`, runs the import, and strips the param so a refresh doesn't
re-import.

## Notes

- You must be signed in to DubMaster — the import runs against your account.
- Only import videos you own, have permission for, or that are public domain.
- Private and age-restricted videos are not supported.
