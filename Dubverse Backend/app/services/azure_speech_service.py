"""
Azure Speech SDK — pronunciation assessment for dubbed audio.

Uses Azure Cognitive Services Speech SDK to evaluate fluency, prosody,
accuracy, and completeness of English dubbed audio.

Returns None on any error — QC analysis degrades gracefully without Azure.
"""

import logging
import math
import os
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)

AZURE_CHUNK_MAX_SECONDS = 28  # Azure limit ~30s, leave margin


def _get_config() -> Optional[Dict[str, str]]:
    key = os.getenv("AZURE_SPEECH_KEY", "").strip()
    region = os.getenv("AZURE_SPEECH_REGION", "").strip()
    if key and region:
        return {"key": key, "region": region}
    return None


def is_enabled() -> bool:
    """Check if Azure Speech integration is configured."""
    return _get_config() is not None


def assess_pronunciation(
    audio_path: str,
    reference_text: str,
) -> Optional[Dict[str, Any]]:
    """
    Run pronunciation assessment on dubbed audio.

    Args:
        audio_path: Path to dubbed audio/video file
        reference_text: Expected spoken text (from TTS transcript)

    Returns:
        {
            "fluency_score": 0-100,
            "prosody_score": 0-100,
            "accuracy_score": 0-100,
            "completeness_score": 0-100,
        }
        or None on error.
    """
    config = _get_config()
    if not config:
        logger.info("[AZURE_SPEECH] Not configured, skipping")
        return None

    audio = Path(audio_path)
    if not audio.exists():
        logger.warning(f"[AZURE_SPEECH] Audio not found: {audio_path}")
        return None

    try:
        import azure.cognitiveservices.speech as speechsdk
    except ImportError:
        logger.warning("[AZURE_SPEECH] azure-cognitiveservices-speech not installed")
        return None

    try:
        # Extract audio to WAV (Azure needs PCM)
        wav_path = audio.with_name(f"{audio.stem}_azure_assess.wav")
        cmd = [
            "ffmpeg", "-y", "-i", str(audio),
            "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
            str(wav_path),
        ]
        subprocess.run(cmd, capture_output=True, timeout=60)

        if not wav_path.exists():
            return None

        # Get audio duration
        duration = _get_audio_duration(wav_path)
        if duration is None:
            wav_path.unlink(missing_ok=True)
            return None

        # Split reference text into chunks proportional to audio duration
        chunks = _split_for_assessment(wav_path, reference_text, duration)

        all_scores: List[Dict[str, float]] = []

        for chunk_wav, chunk_text in chunks:
            scores = _assess_chunk(
                config, chunk_wav, chunk_text
            )
            if scores:
                all_scores.append(scores)

            # Clean up chunk wav if it's different from main wav
            if chunk_wav != wav_path:
                Path(chunk_wav).unlink(missing_ok=True)

        # Clean up main wav
        wav_path.unlink(missing_ok=True)

        if not all_scores:
            logger.warning("[AZURE_SPEECH] No chunks scored successfully")
            return None

        # Average scores across chunks
        result = {}
        for key in ("fluency_score", "prosody_score", "accuracy_score", "completeness_score"):
            values = [s[key] for s in all_scores if key in s]
            result[key] = round(sum(values) / len(values), 1) if values else 0.0

        logger.info(
            f"[AZURE_SPEECH] Assessment complete: "
            f"fluency={result['fluency_score']}, prosody={result['prosody_score']}, "
            f"accuracy={result['accuracy_score']}, completeness={result['completeness_score']}"
        )
        return result

    except Exception as e:
        logger.warning(f"[AZURE_SPEECH] Error: {e}")
        # Clean up
        wav_path = audio.with_name(f"{audio.stem}_azure_assess.wav")
        Path(wav_path).unlink(missing_ok=True)
        return None


def _get_audio_duration(wav_path: Path) -> Optional[float]:
    """Get audio duration using ffprobe."""
    try:
        cmd = [
            "ffprobe", "-v", "quiet", "-show_entries",
            "format=duration", "-of", "csv=p=0", str(wav_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return float(result.stdout.strip())
    except Exception:
        return None


def _split_for_assessment(
    wav_path: Path,
    reference_text: str,
    total_duration: float,
) -> List[tuple]:
    """Split audio and text into chunks under Azure's 30s limit."""
    if total_duration <= AZURE_CHUNK_MAX_SECONDS:
        return [(str(wav_path), reference_text)]

    n_chunks = math.ceil(total_duration / AZURE_CHUNK_MAX_SECONDS)
    chunk_duration = total_duration / n_chunks

    # Split text roughly proportionally
    words = reference_text.split()
    words_per_chunk = max(1, len(words) // n_chunks)

    chunks = []
    for i in range(n_chunks):
        start = i * chunk_duration
        end = min((i + 1) * chunk_duration, total_duration)

        # Extract audio chunk
        chunk_path = wav_path.with_name(f"{wav_path.stem}_chunk{i}.wav")
        cmd = [
            "ffmpeg", "-y", "-i", str(wav_path),
            "-ss", str(start), "-t", str(end - start),
            "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
            str(chunk_path),
        ]
        subprocess.run(cmd, capture_output=True, timeout=30)

        if not chunk_path.exists():
            continue

        # Get corresponding text slice
        text_start = i * words_per_chunk
        text_end = (i + 1) * words_per_chunk if i < n_chunks - 1 else len(words)
        chunk_text = " ".join(words[text_start:text_end])

        if chunk_text.strip():
            chunks.append((str(chunk_path), chunk_text))
        else:
            chunk_path.unlink(missing_ok=True)

    return chunks


def _assess_chunk(
    config: Dict[str, str],
    wav_path: str,
    reference_text: str,
) -> Optional[Dict[str, float]]:
    """Run Azure pronunciation assessment on a single audio chunk."""
    try:
        import azure.cognitiveservices.speech as speechsdk

        speech_config = speechsdk.SpeechConfig(
            subscription=config["key"],
            region=config["region"],
        )

        audio_config = speechsdk.audio.AudioConfig(filename=wav_path)

        # Configure pronunciation assessment with prosody
        pron_config = speechsdk.PronunciationAssessmentConfig(
            reference_text=reference_text,
            grading_system=speechsdk.PronunciationAssessmentGradingSystem.HundredMark,
            granularity=speechsdk.PronunciationAssessmentGranularity.Phoneme,
        )
        pron_config.enable_prosody_assessment()

        recognizer = speechsdk.SpeechRecognizer(
            speech_config=speech_config,
            audio_config=audio_config,
            language="en-US",
        )
        pron_config.apply_to(recognizer)

        result = recognizer.recognize_once()

        if result.reason == speechsdk.ResultReason.RecognizedSpeech:
            pron_result = speechsdk.PronunciationAssessmentResult(result)
            scores = {
                "accuracy_score": pron_result.accuracy_score or 0,
                "fluency_score": pron_result.fluency_score or 0,
                "completeness_score": pron_result.completeness_score or 0,
                "prosody_score": pron_result.prosody_score or 0,
            }
            return scores
        elif result.reason == speechsdk.ResultReason.NoMatch:
            logger.warning("[AZURE_SPEECH] No speech recognized in chunk")
            return None
        else:
            logger.warning(f"[AZURE_SPEECH] Recognition failed: {result.reason}")
            return None

    except Exception as e:
        logger.warning(f"[AZURE_SPEECH] Chunk assessment error: {e}")
        return None
