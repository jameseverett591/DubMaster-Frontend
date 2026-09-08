"""
Unified Chinese (Cantonese + Mandarin) transcription pipeline.

Deepgram Nova-3 is the primary ASR for Cantonese and Mandarin. It is
supported by the other engines as fallbacks / gap-fillers:
  1. Deepgram    (cloud) — primary for Cantonese and Mandarin
  2. Tencent ASR  (cloud) — high recall, catches speech in noise
  3. Paraformer   (local) — high precision for Mandarin tones/characters
  4. Whisper      (local) — fallback gap fill
  5. Merge engine          — combines the best of each

The pipeline gracefully degrades:
  - If Deepgram is not configured → Tencent + Paraformer + Whisper
  - If Tencent is not configured → Deepgram + Paraformer + Whisper
  - If Paraformer is not installed → Deepgram + Tencent + Whisper
  - If all unavailable → Whisper only (existing behavior)

Environment variables:
  CANTONESE_ASR_ENGINES  — Comma-separated engine priority
                           (default: "deepgram,tencent,paraformer,whisper")
  CANTONESE_ASR_WHISPER_GAP_FILL — "1" to fill gaps with Whisper (default: "1")
"""

import concurrent.futures
import logging
import os
import tempfile
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_CANTONESE_LANGS = {"yue", "zh-yue", "yue-hk", "zh-hk"}
_MANDARIN_LANGS = {"zh", "cmn", "zho", "zh-cn", "zh-tw"}
_CHINESE_LANGS = _CANTONESE_LANGS | _MANDARIN_LANGS


def _is_cantonese(source_language: Optional[str]) -> bool:
    """Return True when source_language is a Cantonese variant."""
    return (source_language or "").lower().strip().replace("_", "-") in _CANTONESE_LANGS


def _is_mandarin(source_language: Optional[str]) -> bool:
    """Return True when source_language is a Mandarin/Standard Chinese variant."""
    return (source_language or "").lower().strip().replace("_", "-") in _MANDARIN_LANGS


def _is_chinese(source_language: Optional[str]) -> bool:
    """Return True for any Cantonese or Mandarin/Standard Chinese variant."""
    return _is_cantonese(source_language) or _is_mandarin(source_language)


def _normalize_language(source_language: Optional[str]) -> str:
    """Map Cantonese locale variants to the base `yue` code used by engines."""
    lang = (source_language or "").lower().strip().replace("_", "-")
    if lang in _CANTONESE_LANGS:
        return "yue"
    if lang in _MANDARIN_LANGS:
        return "zh"
    return source_language or "yue"


def _prepare_audio_file(extract_result: Dict[str, Any]) -> Optional[str]:
    """
    Save waveform tensor to a temporary WAV file for engines that need a file path.
    Returns the temp file path, or None on failure.
    Caller is responsible for cleanup.
    """
    try:
        import soundfile as sf
        import numpy as np

        audio = extract_result["audio"]
        sample_rate = extract_result["sample_rate"]

        # Convert to numpy
        waveform = audio.squeeze().cpu().numpy()

        # Write to temp file
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        sf.write(tmp.name, waveform, sample_rate)
        tmp.close()

        return tmp.name
    except Exception as e:
        logger.error(f"[CANTONESE-ASR] Failed to prepare audio file: {e}")
        return None


def transcribe_cantonese(
    extract_result: Dict[str, Any],
    vocals_path: Optional[str] = None,
    job_id: str | None = None,
    source_language: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Run the multi-engine Chinese (Cantonese + Mandarin) transcription pipeline.

    Input:
        extract_result: From extract_audio() — contains audio tensor + sample_rate
        vocals_path: Path to Demucs-separated vocals WAV (preferred for ASR)
        job_id: For logging and output file naming

    Output:
        {
            "status": "ok" | "skipped",
            "transcript_path": str | None,
            "segments": [...],
            "engines_used": [...],
        }

    This function NEVER raises.
    """
    if extract_result.get("status") != "ok":
        return {
            "status": "skipped",
            "reason": "upstream_failed",
            "segments": [],
            "engines_used": [],
        }

    # Determine which engines to use
    env_engines = os.getenv("CANTONESE_ASR_ENGINES", "").strip()
    if env_engines:
        engines_str = env_engines
    elif _is_chinese(source_language):
        engines_str = "deepgram,tencent,paraformer,whisper"
    else:
        engines_str = "tencent,paraformer,whisper"
    engines = [e.strip().lower() for e in engines_str.split(",") if e.strip()]
    whisper_gap_fill = os.getenv("CANTONESE_ASR_WHISPER_GAP_FILL", "1") == "1"

    language = _normalize_language(os.getenv("WHISPER_LANGUAGE") or source_language)

    logger.info(
        f"[CANTONESE-ASR] Starting multi-engine pipeline: {engines}, "
        f"language={language}, job={job_id}"
    )

    # Prepare audio file path for engines that need it
    # Prefer separated vocals (cleaner) over raw audio
    audio_file = vocals_path
    temp_audio = None

    if not audio_file or not os.path.exists(str(audio_file)):
        temp_audio = _prepare_audio_file(extract_result)
        audio_file = temp_audio

    if not audio_file:
        logger.error("[CANTONESE-ASR] No audio file available")
        return {
            "status": "skipped",
            "reason": "no_audio",
            "segments": [],
            "engines_used": [],
        }

    tencent_segments: List[Dict] = []
    paraformer_segments: List[Dict] = []
    whisper_segments: List[Dict] = []
    deepgram_segments: List[Dict] = []
    engines_used: List[str] = []

    try:
        # ── Engine 0: Deepgram Nova-3 (primary for Cantonese/Mandarin) ──
        if "deepgram" in engines:
            try:
                from app.pipeline.deepgram_asr import transcribe_with_deepgram

                deepgram_result = transcribe_with_deepgram(
                    extract_result,
                    audio_path=audio_file,
                    source_language=source_language,
                    job_id=job_id,
                )
                if deepgram_result.get("status") == "ok":
                    deepgram_segments = deepgram_result.get("segments", [])
                    engines_used.append("deepgram")
                    logger.info(
                        f"[CANTONESE-ASR] Deepgram: {len(deepgram_segments)} segments"
                    )
                else:
                    logger.info(
                        f"[CANTONESE-ASR] Deepgram skipped: "
                        f"{deepgram_result.get('reason', 'unknown')}"
                    )
            except Exception as e:
                logger.warning(f"[CANTONESE-ASR] Deepgram failed: {e}")

        # ── Engine 1 + 2: Tencent ASR and Paraformer in parallel ──
        # Tencent is a cloud API call; Paraformer is a local model. They are
        # independent, so run them concurrently to avoid waiting for the slower
        # one before starting the next.
        def _run_tencent():
            if "tencent" not in engines:
                return (False, [])
            try:
                from app.pipeline.tencent_asr import transcribe_with_tencent

                tencent_result = transcribe_with_tencent(
                    audio_path=audio_file,
                    language=language,
                    job_id=job_id,
                )
                if tencent_result.get("status") == "ok":
                    segs = tencent_result.get("segments", [])
                    logger.info(f"[CANTONESE-ASR] Tencent: {len(segs)} segments")
                    return (True, segs)
                else:
                    logger.info(
                        f"[CANTONESE-ASR] Tencent skipped: "
                        f"{tencent_result.get('reason', 'unknown')}"
                    )
            except Exception as e:
                logger.warning(f"[CANTONESE-ASR] Tencent failed: {e}")
            return (False, [])

        def _run_paraformer():
            if "paraformer" not in engines:
                return (False, [])
            try:
                from app.pipeline.paraformer_asr import transcribe_with_paraformer

                paraformer_result = transcribe_with_paraformer(
                    audio_path=audio_file,
                    language=language,
                    job_id=job_id,
                )
                if paraformer_result.get("status") == "ok":
                    segs = paraformer_result.get("segments", [])
                    logger.info(f"[CANTONESE-ASR] Paraformer: {len(segs)} segments")
                    return (True, segs)
                else:
                    logger.info(
                        f"[CANTONESE-ASR] Paraformer skipped: "
                        f"{paraformer_result.get('reason', 'unknown')}"
                    )
            except Exception as e:
                logger.warning(f"[CANTONESE-ASR] Paraformer failed: {e}")
            return (False, [])

        tencent_ok = False
        paraformer_ok = False
        if "tencent" in engines or "paraformer" in engines:
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                t_future = pool.submit(_run_tencent) if "tencent" in engines else None
                p_future = pool.submit(_run_paraformer) if "paraformer" in engines else None
                tencent_ok, tencent_segments = t_future.result() if t_future else (False, [])
                paraformer_ok, paraformer_segments = p_future.result() if p_future else (False, [])
            if tencent_ok:
                engines_used.append("tencent")
            if paraformer_ok:
                engines_used.append("paraformer")
        else:
            logger.info("[CANTONESE-ASR] Skipping Tencent and Paraformer (not in engine list)")

        # ── Engine 3: Whisper (fallback / gap fill) ──
        run_whisper_full = (
            "whisper" in engines
            and not deepgram_segments
            and not tencent_segments
            and not paraformer_segments
        )
        run_whisper_gaps = (
            whisper_gap_fill
            and "whisper" in engines
            and (deepgram_segments or tencent_segments or paraformer_segments)
        )

        if run_whisper_full or run_whisper_gaps:
            try:
                from app.pipeline.transcribe_audio import transcribe_audio

                whisper_result = transcribe_audio(extract_result, job_id, source_language=language)
                if whisper_result.get("status") == "ok":
                    import json
                    transcript_path = whisper_result.get("transcript_path")
                    if transcript_path:
                        with open(transcript_path, "r", encoding="utf-8") as f:
                            whisper_data = json.load(f)
                        whisper_segments = whisper_data.get("segments", [])
                        # Normalize to our format
                        for seg in whisper_segments:
                            seg.setdefault("confidence", 0.0)
                            seg.setdefault("source", "whisper")
                        engines_used.append("whisper")
                        logger.info(
                            f"[CANTONESE-ASR] Whisper: {len(whisper_segments)} segments"
                        )
            except Exception as e:
                logger.warning(f"[CANTONESE-ASR] Whisper failed: {e}")

        # ── Merge results ──
        from app.pipeline.asr_merge import (
            fill_gaps_with_fallbacks,
            merge_asr_results,
            merge_with_whisper_fallback,
        )

        if deepgram_segments:
            # Deepgram is the primary Chinese (Cantonese/Mandarin) transcript.
            # Tencent/Paraformer/Whisper are only added where Deepgram left
            # non-overlapping gaps, so they never overwrite the primary text.
            merged = deepgram_segments

            fallback_segments = []
            if tencent_segments:
                fallback_segments.extend(tencent_segments)
            if paraformer_segments:
                fallback_segments.extend(paraformer_segments)
            if whisper_segments and run_whisper_gaps:
                fallback_segments.extend(whisper_segments)

            if fallback_segments:
                merged = fill_gaps_with_fallbacks(
                    primary_segments=merged,
                    fallback_segments=fallback_segments,
                    job_id=job_id,
                )
        elif tencent_segments or paraformer_segments:
            # Primary merge: Tencent + Paraformer
            merged = merge_asr_results(
                tencent_segments=tencent_segments,
                paraformer_segments=paraformer_segments,
                source_language=language,
                job_id=job_id,
            )

            # Optional: fill gaps with Whisper
            if whisper_segments and run_whisper_gaps:
                merged = merge_with_whisper_fallback(
                    merged_segments=merged,
                    whisper_segments=whisper_segments,
                    job_id=job_id,
                )
        elif whisper_segments:
            # Whisper-only fallback
            merged = whisper_segments
        else:
            merged = []

        # ── Filter repetition loops in merged output ──
        from app.pipeline.transcribe_audio import _filter_repetition_loops, _filter_hallucinations
        merged = _filter_repetition_loops(merged)
        merged = _filter_hallucinations(merged, strict=False, source_language=language, whisper_source=False)

        # ── Persist output ──
        import json
        from pathlib import Path

        # Calculate duration from extract_result
        audio_tensor = extract_result.get("audio")
        sample_rate = extract_result.get("sample_rate", 16000)
        duration = 0.0
        if audio_tensor is not None:
            duration = audio_tensor.shape[-1] / sample_rate

        transcript = {
            "language": language,
            "duration": duration,
            "text": " ".join(seg.get("text", "") for seg in merged),
            "segments": merged,
            "engines_used": engines_used,
        }

        output_dir = Path("data/transcripts")
        output_dir.mkdir(parents=True, exist_ok=True)

        filename = f"{job_id}.json" if job_id else "transcript.json"
        output_path = output_dir / filename
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(transcript, f, indent=2, ensure_ascii=False)

        logger.info(
            f"[CANTONESE-ASR] Pipeline complete: {len(merged)} segments, "
            f"engines={engines_used}, job={job_id}"
        )

        return {
            "status": "ok",
            "transcript_path": str(output_path),
            "segments": merged,
            "engines_used": engines_used,
        }

    except Exception as e:
        logger.error(
            f"[CANTONESE-ASR] Pipeline failed: {type(e).__name__}: {e}",
            exc_info=True,
        )
        return {
            "status": "skipped",
            "reason": "pipeline_failed",
            "error_message": str(e),
            "segments": [],
            "engines_used": engines_used,
        }

    finally:
        # Clean up temp audio file
        if temp_audio and os.path.exists(temp_audio):
            try:
                os.unlink(temp_audio)
            except OSError:
                pass
