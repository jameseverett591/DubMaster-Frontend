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
- Backend health: `curl http://127.0.0.1:8000/health` (localhost may resolve
  oddly — use 127.0.0.1).

## Git

- Before `git add` on any file: `git diff <file>` and confirm the diff matches
  the approved plan (see CLAUDE.md pre-staging rule).
