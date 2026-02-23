from pathlib import Path
import json
from typing import Dict, Any


def transcribe_audio(extract_result: Dict[str, Any], job_id: str | None = None) -> Dict[str, Any]:
    """
    Transcribe decoded audio using faster-whisper.

    Input:
        extract_result from extract_audio()

    Output:
        {
            "status": "ok" | "skipped",
            "transcript_path": str | None,
            "reason": str | None
        }

    This function is hardened for real-world audio
    and NEVER raises exceptions.
    """

    # ---------- Respect upstream contract ----------
    if extract_result["status"] != "ok":
        return {
            "status": "skipped",
            "reason": "upstream_failed",
        }

    audio = extract_result["audio"]

    # ---------- Prepare waveform safely ----------
    # Expecting audio shape (1, N)
    waveform = audio.squeeze(0).float()

    # Guard: too-short audio (Whisper will fail silently)
    if waveform.numel() < 1600:  # ~0.1s @ 16kHz
        return {
            "status": "skipped",
            "reason": "audio_too_short",
        }

    # Normalize amplitude to [-1, 1]
    max_val = waveform.abs().max()
    if max_val > 0:
        waveform = waveform / max_val

    waveform = waveform.cpu().numpy()

    try:
        # ---------- Load Whisper model ----------
        # Model size is configurable via WHISPER_MODEL env var.
        # "small" is the minimum recommended for non-English content.
        # Use "medium" or "large-v3" for best accuracy (requires more RAM/time).
        import os
        from faster_whisper import WhisperModel
        model_size = os.getenv("WHISPER_MODEL", "small")
        model = WhisperModel(
            model_size,
            device="cpu",
            compute_type="int8",
        )

        # VAD filter removes background noise / crowd cheers so they are not
        # mistaken for speech.  condition_on_previous_text=False reduces
        # hallucinations in noisy audio.  beam_size=5 improves accuracy.
        segments_gen, info = model.transcribe(
            waveform,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=300,
                speech_pad_ms=400,
            ),
            condition_on_previous_text=False,
        )

        # Convert generator to list to avoid exhaustion
        segments = list(segments_gen)

        # ---------- Build raw segment dicts ----------
        raw_segments = [
            {
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text,
            }
            for seg in segments
        ]

        # ---------- Fix Whisper timestamp bleed ----------
        # faster-whisper sometimes assigns the next segment's start as the
        # current segment's end when there is a long silent gap (e.g. a fight
        # scene with no dialogue).  Any segment longer than 30 s is almost
        # certainly a bleed: genuine continuous speech rarely exceeds 30 s
        # without a pause, and Whisper itself chunks in 30-second windows.
        #
        # Fix: estimate a realistic end from word count (≈3 words/sec, 2×
        # headroom), then clamp to just before the next segment's start.
        for i, seg in enumerate(raw_segments):
            duration = seg["end"] - seg["start"]
            if duration <= 30.0:
                continue
            word_count = len(seg["text"].split())
            estimated_dur = max(1.0, word_count / 3.0 * 2.0)
            new_end = seg["start"] + estimated_dur
            if i + 1 < len(raw_segments):
                new_end = min(new_end, raw_segments[i + 1]["start"] - 0.05)
            seg["end"] = round(max(new_end, seg["start"] + 0.1), 3)

        # ---------- Normalize transcript ----------
        transcript = {
            "language": info.language,
            "duration": info.duration,
            "text": " ".join(seg["text"] for seg in raw_segments),
            "segments": raw_segments,
        }

        # ---------- Persist output ----------
        output_dir = Path("data/transcripts")
        output_dir.mkdir(parents=True, exist_ok=True)

        filename = f"{job_id}.json" if job_id else "transcript.json"
        output_path = output_dir / filename
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(transcript, f, indent=2, ensure_ascii=False)

        return {
            "status": "ok",
            "transcript_path": str(output_path),
        }

    except Exception as e:
        # Final safety net (should rarely trigger now)
        return {
            "status": "skipped",
            "reason": "transcription_failed",
            "error_message": str(e),
        }
