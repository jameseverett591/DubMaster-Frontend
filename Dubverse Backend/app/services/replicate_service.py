"""
Replicate Cloud GPU Service — offloads heavy ML models to cloud GPUs.

Provides drop-in replacements for local CPU inference:
  - Whisper transcription (openai/whisper)
  - Demucs source separation (cjwbw/demucs)
  - Pyannote speaker diarization (meronym/speaker-diarization)

Each function matches the return format of its local counterpart
so the pipeline code doesn't need to change.

Environment variables:
  REPLICATE_API_TOKEN  — Required. Get from https://replicate.com/account
  USE_CLOUD_GPU        — "1" (default) to use cloud, "0" to force local CPU
"""

import logging
import os
import re
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _get_client():
    """Get Replicate client. Returns None if not configured."""
    token = os.getenv("REPLICATE_API_TOKEN", "").strip()
    if not token:
        logger.warning("[CLOUD] REPLICATE_API_TOKEN not set — falling back to local CPU")
        return None
    try:
        import replicate
        return replicate.Client(api_token=token)
    except ImportError:
        logger.error("[CLOUD] replicate package not installed. Run: pip install replicate")
        return None


def is_cloud_enabled() -> bool:
    """Check if cloud GPU processing is enabled and configured."""
    if os.getenv("USE_CLOUD_GPU", "1").strip().lower() in ("0", "false", "no", "off"):
        return False
    token = os.getenv("REPLICATE_API_TOKEN", "").strip()
    return bool(token)


def _upload_audio_file(client, audio_path: str) -> Optional[str]:
    """Upload a local audio file to Replicate and return the URL."""
    try:
        with open(audio_path, "rb") as f:
            file_output = client.files.create(f, content_type="audio/wav")
        url = file_output.urls.get("get") if hasattr(file_output, "urls") else str(file_output)
        logger.info(f"[CLOUD] Uploaded {Path(audio_path).name} ({os.path.getsize(audio_path) // 1024}KB)")
        return url
    except Exception as e:
        logger.error(f"[CLOUD] File upload failed: {e}")
        return None


def _ensure_wav(audio_path: str) -> str:
    """Convert audio to WAV if needed. Returns path to WAV file."""
    if audio_path.lower().endswith(".wav"):
        return audio_path
    import subprocess
    wav_path = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    subprocess.run(
        ["ffmpeg", "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", wav_path],
        capture_output=True,
    )
    return wav_path


# ─────────────────────────────────────────────
# WHISPER TRANSCRIPTION (Cloud GPU)
# ─────────────────────────────────────────────

def cloud_transcribe(
    audio_path: str,
    language: str = "yue",
    job_id: str | None = None,
) -> Dict[str, Any]:
    """
    Transcribe audio using Replicate's Whisper large-v3 on cloud GPU.

    Returns same format as local transcribe_audio():
        {
            "status": "ok" | "skipped",
            "transcript_path": str,
            "segments": [...],
            "language": str,
        }
    """
    client = _get_client()
    if not client:
        return {"status": "skipped", "reason": "no_replicate_token"}

    start = time.time()
    logger.info(f"[CLOUD-WHISPER] Starting transcription, lang={language}, job={job_id}")

    try:
        wav_path = _ensure_wav(audio_path)

        # Run Whisper on cloud GPU
        output = client.run(
            "openai/whisper",
            input={
                "audio": open(wav_path, "rb"),
                "language": language if language != "yue" else "zh",  # Whisper uses "zh" for Chinese/Cantonese
                "translate": False,
            },
        )

        elapsed = time.time() - start
        logger.info(f"[CLOUD-WHISPER] Completed in {elapsed:.1f}s")

        # Parse output
        segments = []
        if isinstance(output, dict):
            raw_segments = output.get("segments", [])
            for seg in raw_segments:
                segments.append({
                    "start": float(seg.get("start", 0)),
                    "end": float(seg.get("end", 0)),
                    "text": seg.get("text", "").strip(),
                    "confidence": float(seg.get("confidence", 0)),
                    "source": "whisper-cloud",
                })

            detected_lang = output.get("detected_language", language)
            full_text = output.get("transcription", "")
        else:
            # Some versions return just text
            full_text = str(output)
            detected_lang = language

        # Filter empty segments
        segments = [s for s in segments if s["text"].strip()]

        # Save transcript
        import json
        transcript_dir = Path("data/transcripts")
        transcript_dir.mkdir(parents=True, exist_ok=True)
        transcript_path = str(transcript_dir / f"{job_id}.json")

        transcript_data = {
            "language": detected_lang,
            "duration": segments[-1]["end"] if segments else 0,
            "text": full_text,
            "segments": segments,
            "engines_used": ["whisper-cloud"],
        }
        with open(transcript_path, "w", encoding="utf-8") as f:
            json.dump(transcript_data, f, indent=2, ensure_ascii=False)

        logger.info(
            f"[CLOUD-WHISPER] {len(segments)} segments, "
            f"lang={detected_lang}, elapsed={elapsed:.1f}s"
        )

        return {
            "status": "ok",
            "transcript_path": transcript_path,
            "segments": segments,
            "language": detected_lang,
        }

    except Exception as e:
        logger.error(f"[CLOUD-WHISPER] Failed: {type(e).__name__}: {e}", exc_info=True)
        return {"status": "skipped", "reason": f"cloud_error: {e}"}

    finally:
        # Cleanup temp WAV if we created one
        if 'wav_path' in dir() and wav_path != audio_path and os.path.exists(wav_path):
            os.unlink(wav_path)


# ─────────────────────────────────────────────
# DEMUCS SOURCE SEPARATION (Cloud GPU)
# ─────────────────────────────────────────────

def cloud_separate(
    video_path: str,
    job_id: str | None = None,
) -> Dict[str, Any]:
    """
    Separate vocals from background using Replicate's Demucs on cloud GPU.

    Returns same format as local separate_audio():
        {
            "status": "ok" | "skipped",
            "accompaniment_path": str,
            "vocals_path": str,
            "model": str,
        }
    """
    client = _get_client()
    if not client:
        return {"status": "skipped", "reason": "no_replicate_token",
                "accompaniment_path": None, "vocals_path": None}

    output_dir = Path("data/separated")
    output_dir.mkdir(parents=True, exist_ok=True)
    prefix = job_id or "tmp"
    accompaniment_path = str(output_dir / f"{prefix}_accompaniment.wav")
    vocals_path = str(output_dir / f"{prefix}_vocals.wav")

    # Cache check
    if os.path.exists(accompaniment_path) and os.path.exists(vocals_path):
        acc_size = os.path.getsize(accompaniment_path)
        voc_size = os.path.getsize(vocals_path)
        if acc_size > 1000 and voc_size > 1000:
            logger.info(f"[CLOUD-DEMUCS] Using cached separation for {prefix}")
            return {
                "status": "ok",
                "accompaniment_path": accompaniment_path,
                "vocals_path": vocals_path,
                "model": "htdemucs-cloud",
            }

    start = time.time()
    logger.info(f"[CLOUD-DEMUCS] Starting separation, job={job_id}")

    # Extract audio from video first
    import subprocess
    raw_audio = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
    subprocess.run(
        ["ffmpeg", "-y", "-i", video_path, "-vn", "-ar", "44100", "-ac", "2", raw_audio],
        capture_output=True,
    )

    try:
        output = client.run(
            "cjwbw/demucs",
            input={
                "audio": open(raw_audio, "rb"),
                "model": "htdemucs",
            },
        )

        elapsed = time.time() - start
        logger.info(f"[CLOUD-DEMUCS] Completed in {elapsed:.1f}s")

        # Download stems
        import httpx

        vocals_url = None
        other_urls = []

        if isinstance(output, dict):
            vocals_url = output.get("vocals")
            for key in ("drums", "bass", "other"):
                if key in output:
                    other_urls.append(output[key])
        elif isinstance(output, (list, tuple)):
            # Some versions return a list of file URLs
            for item in output:
                item_str = str(item)
                if "vocals" in item_str.lower():
                    vocals_url = item_str
                else:
                    other_urls.append(item_str)

        if vocals_url:
            resp = httpx.get(str(vocals_url), timeout=120)
            with open(vocals_path, "wb") as f:
                f.write(resp.content)
            logger.info(f"[CLOUD-DEMUCS] Vocals saved: {os.path.getsize(vocals_path) // 1024}KB")

        # For accompaniment, download and mix non-vocal stems
        # or just subtract vocals from original
        if other_urls:
            # Download each stem and mix them
            import soundfile as sf
            import numpy as np
            mixed = None
            for url in other_urls:
                resp = httpx.get(str(url), timeout=120)
                tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
                tmp.write(resp.content)
                tmp.close()
                data, sr = sf.read(tmp.name, always_2d=True)
                os.unlink(tmp.name)
                if mixed is None:
                    mixed = data
                else:
                    # Ensure same length
                    min_len = min(len(mixed), len(data))
                    mixed = mixed[:min_len] + data[:min_len]

            if mixed is not None:
                sf.write(accompaniment_path, np.clip(mixed, -1.0, 1.0), sr)
                logger.info(f"[CLOUD-DEMUCS] Accompaniment saved: {os.path.getsize(accompaniment_path) // 1024}KB")
        else:
            # Fallback: create accompaniment by subtracting vocals from original
            logger.warning("[CLOUD-DEMUCS] No separate stems — creating accompaniment by subtraction")
            import soundfile as sf
            import numpy as np
            orig_data, orig_sr = sf.read(raw_audio, always_2d=True)
            voc_data, _ = sf.read(vocals_path, always_2d=True)
            min_len = min(len(orig_data), len(voc_data))
            acc_data = orig_data[:min_len] - voc_data[:min_len]
            sf.write(accompaniment_path, np.clip(acc_data, -1.0, 1.0), orig_sr)

        return {
            "status": "ok",
            "accompaniment_path": accompaniment_path,
            "vocals_path": vocals_path,
            "model": "htdemucs-cloud",
        }

    except Exception as e:
        logger.error(f"[CLOUD-DEMUCS] Failed: {type(e).__name__}: {e}", exc_info=True)
        return {"status": "skipped", "reason": f"cloud_error: {e}",
                "accompaniment_path": None, "vocals_path": None}

    finally:
        if os.path.exists(raw_audio):
            os.unlink(raw_audio)


# ─────────────────────────────────────────────
# PYANNOTE SPEAKER DIARIZATION (Cloud GPU)
# ─────────────────────────────────────────────

def cloud_diarize(
    audio_path: str,
    min_speakers: int = 2,
    max_speakers: int = 4,
    job_id: str | None = None,
) -> Dict[str, Any]:
    """
    Diarize audio using Replicate's pyannote pipeline on cloud GPU.

    Returns same format as local diarize_audio():
        {
            "status": "ok" | "skipped",
            "segments": [{"speaker": str, "start": float, "end": float}, ...],
            "output_path": str,
        }
    """
    client = _get_client()
    if not client:
        return {"status": "skipped", "reason": "no_replicate_token"}

    start = time.time()
    logger.info(
        f"[CLOUD-DIARIZE] Starting diarization, "
        f"min_speakers={min_speakers}, max_speakers={max_speakers}, job={job_id}"
    )

    try:
        wav_path = _ensure_wav(audio_path)

        output = client.run(
            "meronym/speaker-diarization",
            input={
                "audio": open(wav_path, "rb"),
                "min_speakers": min_speakers,
                "max_speakers": max_speakers,
            },
        )

        elapsed = time.time() - start
        logger.info(f"[CLOUD-DIARIZE] Completed in {elapsed:.1f}s")

        # Parse output — format may vary
        import json
        segments = []

        if isinstance(output, str):
            result = json.loads(output)
        elif hasattr(output, "read"):
            result = json.loads(output.read())
        elif isinstance(output, dict):
            result = output
        else:
            result = json.loads(str(output))

        raw_segments = result.get("segments", [])
        for seg in raw_segments:
            # Parse timestamps — Replicate returns "H:MM:SS.mmm" format
            start_time = _parse_timestamp(seg.get("start", "0"))
            end_time = _parse_timestamp(seg.get("stop", seg.get("end", "0")))

            segments.append({
                "speaker": seg.get("speaker", "SPEAKER_0"),
                "start": round(start_time, 3),
                "end": round(end_time, 3),
            })

        # Persist result
        output_dir = Path("data/diarization")
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = str(output_dir / f"{job_id or 'diarization'}.json")
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(segments, f, indent=2)

        unique_speakers = set(s["speaker"] for s in segments)
        total_speech = sum(s["end"] - s["start"] for s in segments)
        logger.info(
            f"[CLOUD-DIARIZE] {len(segments)} segments, "
            f"{len(unique_speakers)} speakers: {sorted(unique_speakers)}, "
            f"total speech: {total_speech:.1f}s, elapsed={elapsed:.1f}s"
        )

        return {
            "status": "ok",
            "segments": segments,
            "output_path": output_path,
        }

    except Exception as e:
        logger.error(f"[CLOUD-DIARIZE] Failed: {type(e).__name__}: {e}", exc_info=True)
        return {"status": "skipped", "reason": f"cloud_error: {e}"}

    finally:
        if 'wav_path' in dir() and wav_path != audio_path and os.path.exists(wav_path):
            os.unlink(wav_path)


def _parse_timestamp(ts) -> float:
    """Parse timestamp from various formats to seconds."""
    if isinstance(ts, (int, float)):
        return float(ts)

    ts = str(ts).strip()

    # "H:MM:SS.mmm" or "MM:SS.mmm"
    match = re.match(r"(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)", ts)
    if match:
        hours = int(match.group(1) or 0)
        minutes = int(match.group(2))
        seconds = float(match.group(3))
        return hours * 3600 + minutes * 60 + seconds

    # Plain seconds
    try:
        return float(ts)
    except ValueError:
        return 0.0
