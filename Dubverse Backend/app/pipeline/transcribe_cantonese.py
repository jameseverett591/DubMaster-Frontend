"""
Unified Cantonese transcription pipeline.

Orchestrates multiple ASR engines for maximum accuracy:
  1. Tencent ASR  (cloud) — high recall, catches speech in noise
  2. Paraformer   (local) — high precision, correct tones/characters
  3. Whisper      (local) — fallback gap fill
  4. Merge engine          — combines the best of each

The pipeline gracefully degrades:
  - If Tencent is not configured → Paraformer + Whisper
  - If Paraformer is not installed → Tencent + Whisper
  - If both unavailable → Whisper only (existing behavior)

Environment variables:
  CANTONESE_ASR_ENGINES  — Comma-separated engine priority
                           (default: "tencent,paraformer,whisper")
  CANTONESE_ASR_WHISPER_GAP_FILL — "1" to fill gaps with Whisper (default: "1")
"""

import logging
import os
import tempfile
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


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
) -> Dict[str, Any]:
    """
    Run the multi-engine Cantonese transcription pipeline.

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
    engines_str = os.getenv("CANTONESE_ASR_ENGINES", "tencent,paraformer,whisper")
    engines = [e.strip().lower() for e in engines_str.split(",") if e.strip()]
    whisper_gap_fill = os.getenv("CANTONESE_ASR_WHISPER_GAP_FILL", "1") == "1"

    language = os.getenv("WHISPER_LANGUAGE", "yue")

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
    engines_used: List[str] = []

    try:
        # ── Engine 1: Tencent ASR ──
        if "tencent" in engines:
            try:
                from app.pipeline.tencent_asr import transcribe_with_tencent

                tencent_result = transcribe_with_tencent(
                    audio_path=audio_file,
                    language=language,
                    job_id=job_id,
                )
                if tencent_result.get("status") == "ok":
                    tencent_segments = tencent_result.get("segments", [])
                    engines_used.append("tencent")
                    logger.info(
                        f"[CANTONESE-ASR] Tencent: {len(tencent_segments)} segments"
                    )
                else:
                    logger.info(
                        f"[CANTONESE-ASR] Tencent skipped: "
                        f"{tencent_result.get('reason', 'unknown')}"
                    )
            except Exception as e:
                logger.warning(f"[CANTONESE-ASR] Tencent failed: {e}")

        # ── Engine 2: Paraformer ──
        if "paraformer" in engines:
            try:
                from app.pipeline.paraformer_asr import transcribe_with_paraformer

                paraformer_result = transcribe_with_paraformer(
                    audio_path=audio_file,
                    language=language,
                    job_id=job_id,
                )
                if paraformer_result.get("status") == "ok":
                    paraformer_segments = paraformer_result.get("segments", [])
                    engines_used.append("paraformer")
                    logger.info(
                        f"[CANTONESE-ASR] Paraformer: {len(paraformer_segments)} segments"
                    )
                else:
                    logger.info(
                        f"[CANTONESE-ASR] Paraformer skipped: "
                        f"{paraformer_result.get('reason', 'unknown')}"
                    )
            except Exception as e:
                logger.warning(f"[CANTONESE-ASR] Paraformer failed: {e}")

        # ── Engine 3: Whisper (fallback / gap fill) ──
        run_whisper_full = (
            "whisper" in engines
            and not tencent_segments
            and not paraformer_segments
        )
        run_whisper_gaps = (
            whisper_gap_fill
            and "whisper" in engines
            and (tencent_segments or paraformer_segments)
        )

        if run_whisper_full or run_whisper_gaps:
            try:
                from app.pipeline.transcribe_audio import transcribe_audio

                whisper_result = transcribe_audio(extract_result, job_id)
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
        from app.pipeline.asr_merge import merge_asr_results, merge_with_whisper_fallback

        if tencent_segments or paraformer_segments:
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
        from app.pipeline.transcribe_audio import _filter_repetition_loops
        merged = _filter_repetition_loops(merged)

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
