# DubMaster / DubVerse — Working Notes

## Product principles

- **Summaries are for users who do NOT speak the source language.** Any
  invented content (names, events, stakes — e.g. a hallucinated "Yue Fei"
  mention) is a commercial defect, not a style issue. Never silently
  substitute a weaker summarizer when the primary provider fails — surface
  the real error instead.

## Summary pipeline

- Primary provider: **VideoTranscriber.ai** OpenAPI
  (`app/services/videotranscriber_service.py`, route
  `POST /api/jobs/{id}/video-notes`). Chapters + transcript, pure vendor
  output — no LLM re-summarization on top.
- `VT_API_KEY` in backend `.env`; `VT_MAX_MINUTES` caps film length to guard
  quota (billing ≈ 2 quota/min: transcribe + chapters). Their API needs a
  public URL — we hand them `PUBLIC_BASE_URL/api/media/{job}/video?access_token=<jwt>`.
- Claude fallback (`scene_summary.py::generate_video_notes`) only runs when
  `VT_API_KEY` is unset. Per-segment "selected line" context card still uses
  Claude — accepted for now.
- Results cache per job+preset in `video_notes.json`; VT task id persists in
  `vt_task.json` (idempotent, never double-bills).

## Docker/env gotchas

- `.env` vars bake at container-create time. After editing `.env`:
  `docker compose up -d --force-recreate backend` — `restart` is not enough.
- Code/docs are volume-mounted; a plain `restart` picks those up.
- Backend health: `curl http://127.0.0.1:8000/health` (localhost may resolve
  oddly — use 127.0.0.1).

## Git

- Before `git add` on any file: `git diff <file>` and confirm the diff matches
  the approved plan (see CLAUDE.md pre-staging rule).
