import sys
print("handler.py: starting...", flush=True)

import logging
import asyncio
import json
import os
import time

try:
    import runpod
    print(f"handler.py: runpod {getattr(runpod, '__version__', 'unknown')} OK", flush=True)
except Exception as _e:
    print(f"handler.py FATAL (runpod import): {_e}", file=sys.stderr, flush=True)
    sys.exit(1)

try:
    from app.pipeline.extract_audio import extract_audio
    from app.pipeline.separate_audio import separate_audio
    from app.pipeline.transcribe_audio import transcribe_audio
    from app.pipeline.transcribe_cantonese import transcribe_cantonese
    from app.pipeline.diarize_audio import diarize_audio
    print("handler.py: pipeline imports OK", flush=True)
except Exception as _e:
    print(f"handler.py FATAL (pipeline import): {_e}", file=sys.stderr, flush=True)
    sys.exit(1)

# Languages that use the multi-engine Cantonese ASR pipeline
_CJK_LANGS = {"zh", "yue", "cmn", "zho", "ja", "ko",
               "zh-cn", "zh-tw", "zh-hk", "yue-hk", "zh-yue"}

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _assign_speaker(transcript_seg, diarization_segments):
    """Best-overlap speaker assignment for a single transcript segment."""
    best_overlap = 0.0
    assigned_speaker = "SPEAKER_00"
    t_start = float(transcript_seg.get("start", 0))
    t_end = float(transcript_seg.get("end", t_start))
    for d_seg in diarization_segments:
        d_start = float(d_seg.get("start", 0))
        d_end = float(d_seg.get("end", 0))
        overlap = max(0.0, min(t_end, d_end) - max(t_start, d_start))
        if overlap > best_overlap:
            best_overlap = overlap
            assigned_speaker = d_seg.get("speaker", "SPEAKER_00")
    return assigned_speaker


def handler(event):
    """
    RunPod serverless handler — v28.

    Pipeline: Download → Extract Audio → Demucs Separation →
              Whisper Transcription → pyannote Diarization → Speaker Assignment

    Returns transcript + diarization data to the local backend.
    Translation and TTS happen locally (not in RunPod) so the local
    backend can do per-speaker voice routing.
    """
    logger.info("RunPod handler v29 invoked")
    timings = {}
    t0 = time.time()

    job_input = event.get("input", event)
    file_url       = job_input.get("file_url", "")
    video_path     = job_input.get("video_path", file_url)
    language       = job_input.get("language", job_input.get("source_language", "yue"))
    min_speakers   = int(job_input.get("min_speakers", 1))
    max_speakers   = int(job_input.get("max_speakers", 6))
    # When caller specifies an exact count (min==max), honour it strictly.
    _exact_speakers = min_speakers if min_speakers == max_speakers and min_speakers > 0 else None
    job_id         = job_input.get("job_id", event.get("id", "local"))
    steps          = job_input.get("steps", ["separate", "transcribe", "diarize"])

    if not video_path:
        return {"error": "No video_path or file_url provided"}

    # ── Step 1: Download (if URL) ─────────────────────────────────────────
    if video_path.startswith("http"):
        import urllib.request
        local_path = f"/tmp/{job_id}_video.mp4"
        logger.info(f"[1/4] Downloading {video_path} → {local_path}")
        t_dl = time.time()
        urllib.request.urlretrieve(video_path, local_path)
        timings["download"] = round(time.time() - t_dl, 2)
        logger.info(f"Download complete in {timings['download']}s")
        video_path = local_path
    else:
        if not os.path.exists(video_path):
            return {"error": f"video_path not found: {video_path}"}

    # ── Step 2: Extract Audio ─────────────────────────────────────────────
    logger.info("[2/4] Extracting audio")
    t_ex = time.time()
    extract_result = extract_audio(video_path)
    timings["extract"] = round(time.time() - t_ex, 2)

    if extract_result.get("status") != "ok":
        return {"error": f"Audio extraction failed: {extract_result.get('reason', '')}"}

    # ── Step 3: Demucs Source Separation (vocals only) ───────────────────
    vocals_audio_path = None
    if "separate" in steps:
        logger.info("[3a/4] Running Demucs source separation")
        t_sep = time.time()
        sep_result = separate_audio(video_path, job_id=job_id)
        timings["separate"] = round(time.time() - t_sep, 2)

        if sep_result.get("status") == "ok":
            vocals_audio_path = sep_result.get("vocals_path")
            logger.info(f"Separation complete in {timings['separate']}s → vocals: {vocals_audio_path}")
        else:
            logger.warning(f"Separation skipped ({sep_result.get('reason')}) — transcribing raw audio")

    # Use separated vocals for transcription if available
    transcription_source = extract_result
    if vocals_audio_path and os.path.exists(vocals_audio_path):
        t_load = time.time()
        vocal_extract = extract_audio(vocals_audio_path)
        if vocal_extract.get("status") == "ok":
            transcription_source = vocal_extract
            logger.info(f"Using separated vocals for transcription (load: {round(time.time()-t_load, 2)}s)")
        else:
            logger.warning("Failed to load separated vocals — falling back to original audio")

    # ── Step 4: Transcription ─────────────────────────────────────────────
    if "transcribe" in steps:
        logger.info(f"[3b/4] Transcribing (language={language})")
        t_tr = time.time()

        # Set language env var so both transcribe_audio and transcribe_cantonese pick it up
        prev_lang = os.environ.get("WHISPER_LANGUAGE")
        if language:
            os.environ["WHISPER_LANGUAGE"] = language

        _lang_norm = (language or "").lower().strip()
        if _lang_norm in _CJK_LANGS:
            # Multi-engine pipeline: Tencent → Paraformer → Whisper (with merge)
            # Passes separated vocals so Tencent/Paraformer get the cleanest signal
            logger.info(f"[TRANSCRIBE] CJK language '{language}' — using multi-engine Cantonese pipeline")
            transcript_result = transcribe_cantonese(
                transcription_source,
                vocals_path=vocals_audio_path,
                job_id=job_id,
            )
        else:
            transcript_result = transcribe_audio(transcription_source, job_id=job_id)

        if prev_lang is None:
            os.environ.pop("WHISPER_LANGUAGE", None)
        else:
            os.environ["WHISPER_LANGUAGE"] = prev_lang

        timings["transcribe"] = round(time.time() - t_tr, 2)

        if transcript_result.get("status") != "ok":
            return {"error": f"Transcription failed: {transcript_result.get('reason', '')}"}

        transcript_path = transcript_result.get("transcript_path", "")
        if not transcript_path or not os.path.exists(transcript_path):
            return {"error": "Transcript file missing after transcription"}

        with open(transcript_path, "r", encoding="utf-8") as f:
            transcript_data = json.load(f)

        segments = transcript_data.get("segments", [])
        logger.info(f"Transcription complete in {timings['transcribe']}s: {len(segments)} segments")
    else:
        transcript_data = {}
        segments = []

    # ── Step 5: Speaker Diarization ───────────────────────────────────────
    diarization_segments = []
    if "diarize" in steps:
        logger.info("[4/4] Running speaker diarization")
        t_di = time.time()
        # diarize_audio reads min/max_speakers from env vars
        os.environ["DIARIZATION_MIN_SPEAKERS"] = str(min_speakers)
        os.environ["DIARIZATION_MAX_SPEAKERS"] = str(max_speakers)
        # Use separated vocals for diarization if available — cleaner signal for pyannote
        diarize_source = extract_result
        if vocals_audio_path and os.path.exists(vocals_audio_path):
            vocal_extract_for_diarize = extract_audio(vocals_audio_path)
            if vocal_extract_for_diarize.get("status") == "ok":
                diarize_source = vocal_extract_for_diarize
                logger.info("[DIARIZE] Using separated vocals as diarization source")
        diarize_result = diarize_audio(diarize_source, job_id=job_id)
        timings["diarize"] = round(time.time() - t_di, 2)

        if diarize_result.get("status") == "ok":
            diarization_segments = diarize_result.get("segments", [])
            unique_diar = len(set(d.get("speaker") for d in diarization_segments))
            logger.info(f"Diarization complete in {timings['diarize']}s: {len(diarization_segments)} turns, {unique_diar} speakers")
            # If user specified an exact count but pyannote returned fewer,
            # log a warning — the F0 fallback on the local backend will handle it.
            if _exact_speakers and unique_diar < _exact_speakers:
                logger.warning(
                    f"[DIARIZE] pyannote found {unique_diar} speaker(s) but expected {_exact_speakers} — "
                    "local backend F0 fallback will attempt re-split"
                )
        else:
            logger.warning(f"Diarization skipped: {diarize_result.get('reason')} — all segments will use SPEAKER_00")

    # ── Speaker Assignment ────────────────────────────────────────────────
    if diarization_segments:
        for seg in segments:
            seg["speaker"] = _assign_speaker(seg, diarization_segments)
        unique = len(set(s.get("speaker") for s in segments))
        logger.info(f"Speaker assignment complete: {unique} unique speaker(s) across {len(segments)} segments")
    else:
        for seg in segments:
            seg.setdefault("speaker", "SPEAKER_00")

    # ── Confidence Tiering ────────────────────────────────────────────────
    # Tag each segment so the editor can route low-confidence ones to review.
    for seg in segments:
        conf = float(seg.get("confidence", 0.0) or 0.0)
        source = seg.get("source", "")
        is_gap_fill = "gap_fill" in source or "whisper_gap" in source
        is_truncated = seg.get("repetition_truncated", False)

        if is_truncated or conf < 0.4 or is_gap_fill:
            seg["confidence_tier"] = "low"
        elif conf >= 0.85:
            seg["confidence_tier"] = "high"
        else:
            seg["confidence_tier"] = "medium"

    timings["total"] = round(time.time() - t0, 2)
    logger.info(f"Handler v28 complete in {timings['total']}s — {len(segments)} segments, {len(diarization_segments)} diarization turns")

    import torch
    gpu_info = {
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
    }

    return {
        "status": "success",
        "segments": segments,
        "transcript": transcript_data,
        "diarization": {"segments": diarization_segments},
        "speaker_genders": {},
        "timings": timings,
        "gpu": gpu_info,
        "job_id": job_id,
    }


runpod.serverless.start({"handler": handler})
