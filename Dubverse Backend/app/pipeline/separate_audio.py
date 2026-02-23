from pathlib import Path
import os
import logging
import subprocess
import tempfile
from typing import Dict, Any

logger = logging.getLogger(__name__)

_MODEL = None
_MODEL_NAME: str | None = None


def _get_model(model_name: str):
    """
    Lazily load the Demucs source-separation model.
    Caches the model globally so it only loads once per process.
    Returns None on any failure — caller should treat this as a skip.
    """
    global _MODEL, _MODEL_NAME

    if _MODEL is not None and _MODEL_NAME == model_name:
        return _MODEL

    try:
        from demucs.pretrained import get_model
    except ImportError:
        logger.error(
            "[SEPARATE] demucs is not installed. "
            "Install with: pip install demucs"
        )
        return None

    try:
        logger.info(f"[SEPARATE] Loading demucs model '{model_name}'...")
        model = get_model(model_name)
        model.eval()
        _MODEL = model
        _MODEL_NAME = model_name
        logger.info(
            f"[SEPARATE] Model '{model_name}' loaded. "
            f"Sample rate: {model.samplerate} Hz, "
            f"Stems: {model.sources}"
        )
        return model
    except Exception as e:
        logger.error(f"[SEPARATE] Failed to load demucs model '{model_name}': {e}")
        return None


def separate_audio(video_path: str, job_id: str | None = None) -> Dict[str, Any]:
    """
    Separate background music/SFX (accompaniment) from speech (vocals)
    using Demucs neural source separation.

    This produces a clean accompaniment track — background music and sound
    effects with the original speech removed — which can be remixed at full
    volume behind the dubbed speech, rather than blending the whole original
    track at 12%.

    Input:
        video_path: path to the original video file
        job_id:     used to name output files (optional)

    Output:
        {
            "status":              "ok" | "skipped",
            "accompaniment_path":  str | None,  # bgm/sfx without vocals
            "vocals_path":         str | None,  # isolated original speech (debug use)
            "model":               str | None,
            "reason":              str | None,  # why skipped
            "error_message":       str | None,
        }

    This function NEVER raises. Separation failure is non-fatal; the caller
    should fall back to the ORIGINAL_AUDIO_LEVEL blending approach.

    Environment variables:
        AUDIO_SEPARATION_ENABLED  (default "1") — set to "0" to disable
        AUDIO_SEPARATION_MODEL    (default "htdemucs") — any demucs model name
    """

    # --- Respect kill-switch ---
    enabled = os.getenv("AUDIO_SEPARATION_ENABLED", "1").strip().lower()
    if enabled in ("0", "false", "no", "off"):
        logger.info("[SEPARATE] Skipping — AUDIO_SEPARATION_ENABLED is off")
        return {
            "status": "skipped",
            "reason": "disabled_by_env",
            "accompaniment_path": None,
            "vocals_path": None,
        }

    if not os.path.exists(video_path):
        logger.warning(f"[SEPARATE] Skipping — video not found: {video_path}")
        return {
            "status": "skipped",
            "reason": "video_not_found",
            "accompaniment_path": None,
            "vocals_path": None,
        }

    model_name = os.getenv("AUDIO_SEPARATION_MODEL", "htdemucs")
    model = _get_model(model_name)
    if model is None:
        return {
            "status": "skipped",
            "reason": "model_unavailable",
            "accompaniment_path": None,
            "vocals_path": None,
        }

    output_dir = Path("data/separated")
    output_dir.mkdir(parents=True, exist_ok=True)

    prefix = job_id if job_id else "tmp"
    accompaniment_path = str(output_dir / f"{prefix}_accompaniment.wav")
    vocals_path = str(output_dir / f"{prefix}_vocals.wav")

    raw_audio_path: str | None = None

    try:
        import torch

        # --- 1. Extract full-quality audio from the video via FFmpeg ---
        #
        # decode.py gives us 16 kHz mono for Whisper/pyannote.
        # Demucs htdemucs operates at 44100 Hz stereo, so we need a
        # fresh extraction at the model's native sample rate.
        logger.info(f"[SEPARATE] Extracting audio at {model.samplerate} Hz from: {video_path}")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            raw_audio_path = tmp.name

        extract_cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vn",                       # video stream: discard
            "-ar", str(model.samplerate),
            "-ac", "2",                  # stereo
            "-f", "wav",
            raw_audio_path,
        ]
        ffmpeg_result = subprocess.run(extract_cmd, capture_output=True, text=True)

        if ffmpeg_result.returncode != 0:
            logger.error(f"[SEPARATE] FFmpeg extraction failed:\n{ffmpeg_result.stderr[-500:]}")
            return {
                "status": "skipped",
                "reason": "audio_extraction_failed",
                "accompaniment_path": None,
                "vocals_path": None,
                "error_message": ffmpeg_result.stderr[-500:],
            }

        # --- 2. Load waveform ---
        # Use soundfile directly instead of torchaudio.load: torchaudio 2.10+
        # hardcodes torchcodec as its backend which requires FFmpeg full-shared
        # DLLs (not just the CLI binary). soundfile reads plain PCM WAV fine.
        import soundfile as sf
        import numpy as np
        data, sr = sf.read(raw_audio_path, always_2d=True)  # [samples, channels]
        waveform = torch.from_numpy(data.T).float()          # [channels, samples]
        duration = waveform.shape[-1] / sr
        logger.info(
            f"[SEPARATE] Loaded: shape={list(waveform.shape)}, "
            f"sr={sr}, duration={duration:.2f}s"
        )

        # Demucs htdemucs requires exactly 2 channels
        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)
        elif waveform.shape[0] > 2:
            waveform = waveform[:2]

        # Resample if FFmpeg gave us the wrong rate (shouldn't normally happen)
        if sr != model.samplerate:
            logger.warning(f"[SEPARATE] Resampling {sr} → {model.samplerate}")
            waveform = torchaudio.functional.resample(waveform, sr, model.samplerate)

        # Normalize to [-1, 1] so the model sees consistent input levels
        max_val = waveform.abs().max()
        if max_val > 0:
            waveform = waveform / max_val

        # --- 3. Run Demucs source separation ---
        #
        # apply_model handles chunked inference internally so very long
        # files don't OOM. num_workers=0 is required on Windows (no fork).
        from demucs.apply import apply_model

        logger.info(f"[SEPARATE] Running '{model_name}' separation on {duration:.1f}s of audio...")
        with torch.inference_mode():
            sources = apply_model(
                model,
                waveform.unsqueeze(0),   # [1, channels, samples] — batch of 1
                progress=False,
                num_workers=0,
            )
        # sources: [batch=1, stems, channels, samples]
        sources = sources.squeeze(0)  # [stems, channels, samples]

        stem_names = model.sources  # e.g. ['drums', 'bass', 'other', 'vocals']
        logger.info(f"[SEPARATE] Separation complete. Stems: {stem_names}")

        vocals_idx = stem_names.index("vocals")
        non_vocal_indices = [i for i, name in enumerate(stem_names) if name != "vocals"]

        # --- 4. Reconstruct accompaniment by summing all non-vocal stems ---
        #
        # For htdemucs 4-stem: accompaniment = drums + bass + other
        accompaniment = sources[non_vocal_indices].sum(dim=0)  # [channels, samples]
        vocals = sources[vocals_idx]                           # [channels, samples]

        # Clamp to avoid clipping artifacts from stem summation
        accompaniment = accompaniment.clamp(-1.0, 1.0)
        vocals = vocals.clamp(-1.0, 1.0)

        # --- 5. Save outputs ---
        # Again use soundfile directly to avoid the torchcodec DLL issue.
        sf.write(accompaniment_path, accompaniment.numpy().T, model.samplerate)
        sf.write(vocals_path, vocals.numpy().T, model.samplerate)

        logger.info(
            f"[SEPARATE] accompaniment → {accompaniment_path} "
            f"({os.path.getsize(accompaniment_path) // 1024} KB)"
        )
        logger.info(f"[SEPARATE] vocals → {vocals_path}")

        return {
            "status": "ok",
            "accompaniment_path": accompaniment_path,
            "vocals_path": vocals_path,
            "model": model_name,
        }

    except Exception as e:
        logger.error(
            f"[SEPARATE] Separation failed: {type(e).__name__}: {e}",
            exc_info=True,
        )
        return {
            "status": "skipped",
            "reason": "separation_failed",
            "accompaniment_path": None,
            "vocals_path": None,
            "error_message": str(e),
        }

    finally:
        # Always clean up the temporary raw extraction file
        if raw_audio_path and os.path.exists(raw_audio_path):
            try:
                os.unlink(raw_audio_path)
            except OSError:
                pass
