# DubMaster Working State — QC Baseline D/53

**Date:** 2026-04-24  
**Git tag:** `qc-working-d53`  
**Git commit:** `93cf7cf6`

---

## Snapshot Summary

This is the first end-to-end working state of DubMaster with:
- Full GPU pipeline (R2 → RunPod → TTS → mix → QC) executing without errors
- QC analysis pipeline producing a 14-sub-analysis report
- Pipeline auto-grade: B/83 (inflated — weight redistribution when services offline)
- Claude synthesis honest grade: **D/53**

---

## Infrastructure

| Component | Value |
|-----------|-------|
| RunPod endpoint | `mbjktrbdi22aw1` |
| RunPod image | `jameseverett591/dubverse-gpu-serverless:v38` |
| Local backend image | `dubverse-backend:qc-working-d53` (ID: `423355b3c529`) |
| Local backend image | `dubverse-backend:latest` (same ID) |
| R2 bucket | `dubmaster-videos` |
| R2 public URL | `https://pub-475f59533bba47a4b7621c07557abe57.r2.dev` |

---

## Voice Configuration

| Role | Fish Audio Voice ID |
|------|-------------------|
| FISH_VOICE_MALE_1 | `536d3a5e000945adb7038665781a4aca` |
| FISH_VOICE_MALE_2 | `625a2fbb97d745f099e94db985b8c02b` |
| FISH_VOICE_FEMALE_1 | `9a9cf47702da476aa4629e2506d4a857` |
| FISH_VOICE_CHILD_1 | `b579f08b132d4fa688f4b041590b4664` |

TTS mode: **preset-only** (inline voice cloning disabled — pyannote merges similar speakers)

---

## Working Endpoints

| Endpoint | Status |
|----------|--------|
| `POST /upload` | Working |
| `POST /jobs` | Working |
| `GET /jobs/{id}` | Working |
| `POST /analyze/{id}/{lang}` | Working |
| `GET /analysis/{id}/{lang}` | Working |
| Azure Speech (pronunciation) | 401 — offline |
| Azure OpenAI (translation eval) | 401 — offline |
| Gemini (holistic review) | No key — offline |
| SyncNet | Scores 0 on no-face frames |

---

## Known Good Test Clip

**Job ID:** `cbbed650-ea24-43eb-9b8f-fd768f9f7312`  
**Clip:** Ip Man martial arts scene (~4:22), Chinese → English  
**GPU processing time:** 53.4s  
**QC baseline:** `docs/qc-baseline-d53.json`

---

## Known Issues (Phase 2 targets)

1. **Pyannote merges similar male speakers** — Ip Man and Master Shin share SPEAKER_02 → same voice. Fix: raise `DIARIZATION_MIN_SPEAKERS` (test 4) or add manual speaker split UI.
2. **Hallucinations** — Whisper generates text from fight grunts/SFX. Fix: upgrade to `WHISPER_MODEL=large-v3` (one change at a time after diarization).
3. **Loudness bug** — `_analyze_loudness()` passes `within_spec=True` even with true peak +8.17 dBFS (hard clipping). Only checks LUFS deviation, not `input_tp`. Fix: add `if input_tp > -1.0: within_spec = False`.
4. **Score inflation** — `_compute_summary()` auto-redistributes weights when services offline → B/83. When Claude synthesis runs, it grades D/53. Fix: use Claude score when available, expose both.
5. **Identity axis missing** — Speaker embedding similarity/drift detection not implemented anywhere in QC stack.

---

## Environment Backup

`.env.qc-working-d53` — full copy of `.env` at this state.
