"""
Deepgram Nova-3 ASR for Cantonese and Mandarin.

Deepgram Nova-3 supports:
  - Cantonese Traditional:  zh-HK
  - Mandarin Simplified:     zh, zh-CN, zh-Hans
  - Mandarin Traditional:    zh-TW, zh-Hant

Key advantages over WenetSpeech:
  - Built-in speaker diarization (no separate pyannote pass needed)
  - Built-in punctuation (prevents mid-sentence fragmentation)
  - Cloud API — no local model, no VAD chunking, no int8 quantization
  - Semantic accuracy from a large trained model, not a CTC acoustic map

Environment variables:
  DEEPGRAM_API_KEY  — Required. API key from Deepgram dashboard.
  DEEPGRAM_MODEL    — Model name (default: "nova-3")
"""

import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_API_BASE = "https://api.deepgram.com/v1/listen"
_TIMEOUT_S = 300

# Map our internal language codes to Deepgram language codes.
_LANG_MAP = {
    "yue": "zh-HK",
    "zh-yue": "zh-HK",
    "yue-hk": "zh-HK",
    "zh-hk": "zh-HK",
    "zh": "zh",
    "cmn": "zh",
    "zho": "zh",
    "zh-cn": "zh-CN",
    "zh-tw": "zh-TW",
}


def _map_language(source_language: Optional[str]) -> str:
    """Map internal language code to Deepgram's language code."""
    lang = (source_language or "").lower().strip().replace("_", "-")
    return _LANG_MAP.get(lang, "zh-HK")


def _get_api_key() -> Optional[str]:
    """Read the Deepgram API key from environment."""
    key = (
        os.getenv("DEEPGRAM_API_KEY")
        or os.getenv("DEEPGRAM_KEY")
        or ""
    )
    key = key.strip()
    if not key:
        logger.error("[DEEPGRAM] No DEEPGRAM_API_KEY set in environment")
        return None
    return key


def transcribe_with_deepgram(
    extract_result: Dict[str, Any],
    audio_path: Optional[str] = None,
    source_language: Optional[str] = None,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Transcribe audio using Deepgram Nova-3 batch API.

    Returns a dict with ``status`` and ``segments`` compatible with the
    Cantonese pipeline.  Each segment has:
        start, end, text, speaker, confidence, source, words

    Deepgram's built-in diarization assigns speaker numbers (0, 1, 2, ...)
    which are mapped to ``speaker-1``, ``speaker-2``, etc.
    """
    import requests

    api_key = _get_api_key()
    if not api_key:
        return {"status": "skipped", "reason": "no_api_key", "segments": []}

    # Resolve the audio file path.
    if not audio_path or not os.path.exists(str(audio_path)):
        # Try to write the audio tensor to a temp file.
        audio_path = _write_temp_wav(extract_result)
        if not audio_path:
            return {"status": "skipped", "reason": "no_audio", "segments": []}

    language = _map_language(source_language)
    model = os.getenv("DEEPGRAM_MODEL", "nova-3").strip() or "nova-3"

    # Deepgram batch API parameters.
    # - diarize_model=latest: speaker diarization, pinned to Deepgram's
    #   current best model version instead of an unpinned implicit default
    # - utterances=true: per-utterance segments with speaker + timing
    # - utt_split: silence gap (seconds) that starts a new utterance.
    #   Deepgram's own default is 0.8, which merges rapid back-and-forth
    #   Cantonese dialogue (turn gaps under 0.8s) into one long utterance
    #   with one speaker label -- confirmed directly against a real
    #   transcript: a 14s exchange between two speakers came back as a
    #   single speaker-2 utterance. Lowered default to 0.3s so genuinely
    #   fast turn-taking still splits; env-configurable in case 0.3 proves
    #   too aggressive on other content and over-fragments slower dialogue.
    # - punctuate=true: add punctuation (prevents mid-sentence fragments)
    # - paragraphs=true: group utterances into paragraphs using punctuation
    #   + speaker changes together
    # - smart_format=true: smart formatting for numbers, dates, etc.
    utt_split = os.getenv("DEEPGRAM_UTT_SPLIT", "0.3").strip() or "0.3"
    params = {
        "model": model,
        "language": language,
        "diarize_model": "latest",
        "utterances": "true",
        "utt_split": utt_split,
        "punctuate": "true",
        "paragraphs": "true",
        "smart_format": "true",
    }

    # Determine content type from file extension.
    ext = os.path.splitext(str(audio_path))[1].lower()
    content_type_map = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
    }
    content_type = content_type_map.get(ext, "audio/wav")

    logger.info(
        f"[DEEPGRAM] job={job_id} language={language} model={model} "
        f"audio={audio_path} content_type={content_type}"
    )

    try:
        with open(str(audio_path), "rb") as f:
            audio_bytes = f.read()

        headers = {
            "Authorization": f"Token {api_key}",
            "Content-Type": content_type,
        }

        resp = requests.post(
            _API_BASE,
            params=params,
            headers=headers,
            data=audio_bytes,
            timeout=_TIMEOUT_S,
        )
        resp.raise_for_status()
        data = resp.json()

    except requests.exceptions.HTTPError as e:
        logger.error(f"[DEEPGRAM] job={job_id} HTTP error: {e}")
        body = ""
        try:
            body = resp.text[:500]
        except Exception:
            pass
        logger.error(f"[DEEPGRAM] job={job_id} response: {body}")
        return {"status": "skipped", "reason": "http_error", "segments": []}
    except Exception as e:
        logger.error(f"[DEEPGRAM] job={job_id} request failed: {e}")
        return {"status": "skipped", "reason": "request_failed", "segments": []}

    # Parse the response.
    # Deepgram returns either:
    #   results.utterances[]  (when utterances=true)
    #   results.channels[].alternatives[]  (when utterances=false)
    utterances = (
        data.get("results", {})
        .get("utterances", [])
    )
    if not utterances:
        # Fallback: try channels[0].alternatives[0] as a single segment.
        channels = data.get("results", {}).get("channels", [])
        if channels:
            alt = channels[0].get("alternatives", [{}])[0]
            transcript = alt.get("transcript", "").strip()
            if transcript:
                utterances = [{
                    "transcript": transcript,
                    "start": 0.0,
                    "end": float(data.get("duration", 0.0)),
                    "confidence": alt.get("confidence", 0.0),
                    "speaker": 0,
                    "words": alt.get("words", []),
                }]

    segments: List[Dict[str, Any]] = []
    for utt in utterances:
        text = (utt.get("transcript") or "").strip()
        if not text:
            continue
        start = round(float(utt.get("start", 0.0)), 3)
        end = round(float(utt.get("end", 0.0)), 3)
        speaker_num = int(utt.get("speaker", 0))
        confidence = float(utt.get("confidence", 0.0))

        # Map Deepgram speaker numbers to our speaker-N convention.
        speaker = f"speaker-{speaker_num + 1}"

        # Convert Deepgram word timings to our format.
        words = []
        for w in utt.get("words", []):
            words.append({
                "word": w.get("word", ""),
                "start": round(float(w.get("start", 0.0)), 3),
                "end": round(float(w.get("end", 0.0)), 3),
                "confidence": float(w.get("confidence", 0.0)),
            })

        segments.append({
            "start": start,
            "end": end,
            "text": text,
            "speaker": speaker,
            "confidence": confidence,
            "source": "deepgram",
            "words": words if words else None,
        })

    logger.info(
        f"[DEEPGRAM] job={job_id} produced {len(segments)} segments, "
        f"speakers={sorted(set(s['speaker'] for s in segments))}"
    )

    return {"status": "ok", "segments": segments}


def _write_temp_wav(extract_result: Dict[str, Any]) -> Optional[str]:
    """Write the audio tensor from extract_result to a temp WAV file."""
    import tempfile
    try:
        import soundfile as sf
        import numpy as np

        audio = extract_result["audio"]
        sample_rate = extract_result["sample_rate"]
        waveform = audio.squeeze().cpu().numpy()

        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        sf.write(tmp.name, waveform, sample_rate)
        tmp.close()
        return tmp.name
    except Exception as e:
        logger.error(f"[DEEPGRAM] Failed to write temp WAV: {e}")
        return None
