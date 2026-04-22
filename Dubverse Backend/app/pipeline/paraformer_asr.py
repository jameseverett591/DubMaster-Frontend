"""
Paraformer (Alibaba FunASR) local ASR for Cantonese speech recognition.

Uses the Paraformer-zh model which excels at:
  - Cantonese phonetic accuracy (tones, particles)
  - Short utterance recognition (好啊, 臭小子, 大哥)
  - Non-autoregressive inference (fast and stable)
  - Low hallucination rate

The model is downloaded on first use and cached locally.
GPU is used automatically when available.

Environment variables:
  PARAFORMER_MODEL   — Model name (default: "iic/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch")
  PARAFORMER_DEVICE  — "cuda" or "cpu" (default: auto-detect)
"""

import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_MODEL = None
_VAD_MODEL = None
_PUNC_MODEL = None


def _get_device() -> str:
    """Auto-detect best device for inference."""
    device = os.getenv("PARAFORMER_DEVICE", "").strip()
    if device:
        return device
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        return "cpu"


def _get_model():
    """
    Lazily load the Paraformer pipeline (model + VAD + punctuation).
    Cached globally — stateless and reusable across jobs.
    """
    global _MODEL, _VAD_MODEL, _PUNC_MODEL

    if _MODEL is not None:
        return _MODEL, _VAD_MODEL, _PUNC_MODEL

    try:
        from funasr import AutoModel
    except ImportError:
        logger.error(
            "[PARAFORMER] funasr is not installed. "
            "Install with: pip install funasr modelscope"
        )
        return None, None, None

    device = _get_device()
    logger.info(f"[PARAFORMER] Loading models on device={device}...")

    try:
        # Main ASR model — Paraformer-large with built-in VAD + punctuation
        model_name = os.getenv(
            "PARAFORMER_MODEL",
            "iic/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        )

        _MODEL = AutoModel(
            model=model_name,
            device=device,
            # Disable ncpu_threads warning
            disable_log=True,
        )
        logger.info(f"[PARAFORMER] ASR model loaded: {model_name}")

        # VAD model for speech activity detection
        try:
            _VAD_MODEL = AutoModel(
                model="iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
                device=device,
                disable_log=True,
            )
            logger.info("[PARAFORMER] VAD model loaded")
        except Exception as e:
            logger.warning(f"[PARAFORMER] VAD model failed to load: {e}")
            _VAD_MODEL = None

        # Punctuation model
        try:
            _PUNC_MODEL = AutoModel(
                model="iic/punc_ct-transformer_cn-en-common-vocab471067-large",
                device=device,
                disable_log=True,
            )
            logger.info("[PARAFORMER] Punctuation model loaded")
        except Exception as e:
            logger.warning(f"[PARAFORMER] Punctuation model failed to load: {e}")
            _PUNC_MODEL = None

        return _MODEL, _VAD_MODEL, _PUNC_MODEL

    except Exception as e:
        logger.error(
            f"[PARAFORMER] Failed to load models: {type(e).__name__}: {e}",
            exc_info=True,
        )
        _MODEL = None
        return None, None, None


def transcribe_with_paraformer(
    audio_path: str,
    language: str = "yue",
    job_id: str | None = None,
) -> Dict[str, Any]:
    """
    Transcribe audio using Paraformer (FunASR).

    Input:
        audio_path: Path to WAV file (16kHz mono recommended)
        language: Source language code
        job_id: For logging

    Output:
        {
            "status": "ok" | "skipped",
            "segments": [{"start", "end", "text", "confidence", "source"}],
            "full_text": str,
        }

    This function NEVER raises — returns status="skipped" on failure.
    """
    # Paraformer models we use are Mandarin (zh) focused; for Cantonese (yue)
    # they frequently return garbage or a single giant blob. Avoid poisoning
    # the Cantonese pipeline — use Whisper for yue.
    if (language or "").strip().lower() == "yue":
        logger.info(f"[PARAFORMER] Skipping for Cantonese (language=yue), job={job_id}")
        return {
            "status": "skipped",
            "reason": "unsupported_language_yue",
            "segments": [],
        }

    if not os.path.exists(audio_path):
        logger.warning(f"[PARAFORMER] Audio file not found: {audio_path}")
        return {
            "status": "skipped",
            "reason": "audio_not_found",
            "segments": [],
        }

    model, vad_model, punc_model = _get_model()
    if model is None:
        logger.info("[PARAFORMER] Skipping — model not available")
        return {
            "status": "skipped",
            "reason": "model_not_available",
            "segments": [],
        }

    try:
        logger.info(
            f"[PARAFORMER] Transcribing {audio_path} "
            f"(language={language}, job={job_id})"
        )

        # Run inference
        # Paraformer handles VAD internally when using the vad-punc model
        result = model.generate(
            input=audio_path,
            batch_size_s=300,  # Process up to 300s at once
        )

        if not result:
            logger.warning("[PARAFORMER] Empty result")
            return {
                "status": "ok",
                "segments": [],
                "full_text": "",
            }

        segments = _parse_paraformer_result(result, job_id)

        full_text = " ".join(seg["text"] for seg in segments)
        logger.info(
            f"[PARAFORMER] Transcribed {len(segments)} segments for job={job_id}"
        )

        return {
            "status": "ok",
            "segments": segments,
            "full_text": full_text,
        }

    except Exception as e:
        logger.error(
            f"[PARAFORMER] Transcription failed: {type(e).__name__}: {e}",
            exc_info=True,
        )
        return {
            "status": "skipped",
            "reason": "transcription_failed",
            "error_message": str(e),
            "segments": [],
        }


def _parse_paraformer_result(
    result: list, job_id: str | None = None
) -> List[Dict[str, Any]]:
    """Parse FunASR result into our standard segment format."""
    segments: List[Dict[str, Any]] = []

    for item in result:
        # FunASR returns list of dicts with 'text', 'timestamp', etc.
        if isinstance(item, dict):
            text = item.get("text", "").strip()
            if not text:
                continue

            # Extract timestamps if available
            # FunASR timestamp format: [[start_ms, end_ms], [start_ms, end_ms], ...]
            timestamps = item.get("timestamp", [])
            sentence_info = item.get("sentence_info", [])

            if sentence_info:
                # Sentence-level results with timestamps
                for sent in sentence_info:
                    sent_text = sent.get("text", "").strip()
                    if not sent_text:
                        continue
                    start_ms = sent.get("start", 0)
                    end_ms = sent.get("end", 0)

                    segments.append({
                        "start": round(start_ms / 1000.0, 3),
                        "end": round(end_ms / 1000.0, 3),
                        "text": sent_text,
                        "confidence": sent.get("confidence", 0.0),
                        "source": "paraformer",
                    })
            elif timestamps:
                # Word-level timestamps — group into segments
                # Each timestamp pair corresponds to a character/word
                words = list(text)
                if len(timestamps) == len(words):
                    # Group consecutive characters into segments
                    current_seg = {
                        "start": timestamps[0][0] / 1000.0,
                        "text": "",
                        "chars": [],
                    }
                    for i, (ts, char) in enumerate(zip(timestamps, words)):
                        char_start = ts[0] / 1000.0
                        char_end = ts[1] / 1000.0

                        # New segment if gap > 0.5s
                        if (
                            current_seg["chars"]
                            and char_start - current_seg["chars"][-1][1] > 0.5
                        ):
                            current_seg["end"] = current_seg["chars"][-1][1]
                            current_seg["text"] = "".join(
                                c[2] for c in current_seg["chars"]
                            )
                            segments.append({
                                "start": round(current_seg["start"], 3),
                                "end": round(current_seg["end"], 3),
                                "text": current_seg["text"],
                                "confidence": 0.0,
                                "source": "paraformer",
                            })
                            current_seg = {
                                "start": char_start,
                                "text": "",
                                "chars": [],
                            }

                        current_seg["chars"].append(
                            (char_start, char_end, char)
                        )

                    # Flush last segment
                    if current_seg["chars"]:
                        current_seg["end"] = current_seg["chars"][-1][1]
                        current_seg["text"] = "".join(
                            c[2] for c in current_seg["chars"]
                        )
                        segments.append({
                            "start": round(current_seg["start"], 3),
                            "end": round(current_seg["end"], 3),
                            "text": current_seg["text"],
                            "confidence": 0.0,
                            "source": "paraformer",
                        })
                else:
                    # Timestamp count mismatch — use full text without timing
                    if timestamps:
                        segments.append({
                            "start": round(timestamps[0][0] / 1000.0, 3),
                            "end": round(timestamps[-1][1] / 1000.0, 3),
                            "text": text,
                            "confidence": 0.0,
                            "source": "paraformer",
                        })
            else:
                # No timestamps at all
                segments.append({
                    "start": 0.0,
                    "end": 0.0,
                    "text": text,
                    "confidence": 0.0,
                    "source": "paraformer",
                })

    return segments
