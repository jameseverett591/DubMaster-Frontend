# DubMaster / DubVerse — Working Notes

## Product principles

- **Summaries are for users who do NOT speak the source language.** Any
  invented content (names, events, stakes — e.g. a hallucinated "Yue Fei"
  mention) is a commercial defect, not a style issue. Never silently
  substitute a weaker summarizer when the primary provider fails — surface
  the real error instead.

## Summary pipeline

- Primary provider: **Claude over the job's own transcript**
  (`scene_summary.py::generate_video_notes`, route
  `POST /api/jobs/{id}/video-notes`). The dubbing pipeline already produces
  the transcript, so this is one LLM call — no vendor billing, no public
  URL needed. Selected via `VIDEO_NOTES_PROVIDER` env (default `claude`;
  `vt` = VideoTranscriber.ai ~2 quota/min, `deepgram` = summarize+topics).
- `VT_API_KEY`/`VT_MAX_MINUTES` still apply when `VIDEO_NOTES_PROVIDER=vt`.
- Per-segment "selected line" context card still uses Claude — accepted.
- Results cache per job+preset in `video_notes.json`; VT task id persists in
  `vt_task.json` (idempotent, never double-bills).

## Docker/env gotchas

- `.env` vars bake at container-create time. After editing `.env`:
  `docker compose up -d --force-recreate backend` — `restart` is not enough.
- Code/docs are volume-mounted; a plain `restart` picks those up.
- **New pip deps in `requirements.txt` need an image rebuild** —
  `docker compose build backend && docker compose up -d backend`.
  `restart`/`up -d` alone will NOT pick them up (learned the hard way:
  yt-dlp was in requirements for weeks but the image predated it →
  "No module named 'yt_dlp'" in production). Never `pip install` inside a
  running container as the fix — it doesn't survive recreate.
- **Age-restricted YouTube videos need cookies.** `YTDLP_COOKIES_FILE`
  (default `/app/data/yt_cookies.txt`) — a Netscape cookies.txt that
  MUST contain `LOGIN_INFO` (HttpOnly — extension exports that scrape
  `document.cookie` silently miss it). **YouTube rotates session cookies
  on active browsing**, so the export dies within minutes if it comes
  from a browser YouTube is used on. Durable source: the dedicated
  Firefox profile (`4svdnchn.default-release`) — nobody browses YouTube
  in it. Refresh via `Dubverse Backend/scripts/export_yt_cookies.py`
  (docker cp the profile's `cookies.sqlite` in, run the script inside
  the container — writes `/app/data/yt_cookies.txt` directly). DO NOT
  use `yt-dlp --cookies-from-browser firefox` — it silently dropped the
  auth cookies here. Gotcha: `moz_cookies.expiry` is SECONDS while
  `creationTime`/`lastAccessed` are MICROSECONDS — dividing expiry by
  1e6 produces cookies that expired in 1970 and the jar silently drops
  the entire auth set. `data/` is volume-mounted and gitignored; file
  changes take effect instantly — no rebuild/recreate. The file is fed
  to yt-dlp via `io.StringIO` (its jar rewrite on exit desyncs Docker
  Desktop bind mounts — never pass the mounted path as `cookiefile`,
  and never point `--cookies` at the mounted file in tests either).
- **Signed-in YouTube sessions need `deno` + `yt-dlp-ejs`** (both baked
  in the image) to solve signature/n challenges — without them cookie
  requests return "No video formats found".
- Backend health: `curl http://127.0.0.1:8000/health` (localhost may resolve
  oddly — use 127.0.0.1).

## Git

- Before `git add` on any file: `git diff <file>` and confirm the diff matches
  the approved plan (see CLAUDE.md pre-staging rule).

## Greptile round-3 batch (commit f0841a3)

- **Payment gates** — the paywall covers every finished-film path, not just
  `?attachment=1`: `/download` inline, `/dub/export/download`, and
  `dubbed_*.mp4` via both the legacy and `/audio/` media routes → HTTP 402
  unpaid.
- **Vendor tokens** — `request.state.vendor_token` marks token-auth
  requests; `/video`, `lip_in_*`, and `.mp3/.wav/.m4a` audio inputs are all
  they can reach. Films, stems, waveforms, scrub-proxy → 403.
- **Lip-sync billing** — scoped sync debits per range inside the runner
  (post-cut, pre-vendor), refunding when the vendor never ran it.
  `lipsync_synced_selection` records only the ids whose footage actually
  synced — a partially-failed run no longer satisfies the export/billing
  gate.
- **Stripe dedup** — `recordPayment` uses ON CONFLICT DO NOTHING upsert; a
  lost race is a no-op instead of a 500 retry storm, with a 42P10 fallback
  + warning if the migration hasn't run.
- **Captions** — `source_language` is REQUIRED when supplying captions
  (both `/upload` and `/youtube/import` → 422 otherwise). `/youtube/import`
  accepts the reviewed transcript and skips ASR; the frontend sends
  `extractedLang` + the segments the user checked.
- **Expired URLs** — `refreshMediaUrlAsync` re-mints the token on click;
  download + Web Share file-fetch use it.
- **Queued regen** — `handleGenerateSpeech` returns a promise that resolves
  with the queued run's real outcome; waiters no longer mis-flag queued
  segments.
- **Cookie rotation** — `_YdlLogger` captures yt-dlp warnings
  (`no_warnings` only silences stderr), so rotation surfaces as "cookies
  need refreshing" instead of generic sign-in text.
