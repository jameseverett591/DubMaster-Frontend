# app/audio/decode.py
import os
import subprocess
from typing import Optional, List, TYPE_CHECKING

if TYPE_CHECKING:
    import torch

from app.audio.types import DecodeResult, DecodeDiagnostics


TARGET_SAMPLE_RATE = 16000


def _ffmpeg_available() -> bool:
    try:
        subprocess.run(
            ["ffmpeg", "-version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )
        return True
    except Exception:
        return False


def _run_ffmpeg_decode(
    input_path: str,
    target_sr: int,
) -> tuple[Optional["torch.Tensor"], Optional[int], Optional[str]]:
    """
    Decode audio using FFmpeg into float32 mono PCM.
    Returns (audio_tensor, sample_rate, stderr).
    """
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(target_sr),
        "-f",
        "f32le",
        "pipe:1",
    ]

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    stdout, stderr = proc.communicate()

    if proc.returncode != 0 or not stdout:
        return None, None, stderr.decode("utf-8", errors="ignore")

    import torch
    audio = torch.frombuffer(stdout, dtype=torch.float32)
    return audio, target_sr, None


def _build_base_diagnostics(input_path: str) -> DecodeDiagnostics:
    return {
        "input_path": input_path,
        "input_ext": os.path.splitext(input_path)[1].lower(),
        "file_size": os.path.getsize(input_path) if os.path.exists(input_path) else None,
        "decoder_attempts": [],
        "decoder_stderr": None,
        "duration_sec": None,
        "num_samples": None,
        "sample_rate": None,
        "resampled_from": None,
        "warnings": [],
    }


def decode_audio(
    input_path: str,
    target_sr: int = TARGET_SAMPLE_RATE,
) -> DecodeResult:
    """
    Hard decoding boundary.
    Never raises.
    Always returns DecodeResult.
    """
    diagnostics = _build_base_diagnostics(input_path)

    if not os.path.exists(input_path):
        return {
            "ok": False,
            "audio": None,
            "sample_rate": None,
            "decoder_used": None,
            "error_code": "UNSUPPORTED_FORMAT",
            "error_message": "Input path does not exist",
            "diagnostics": diagnostics,
        }

    # ---------- FFmpeg primary ----------
    if _ffmpeg_available():
        diagnostics["decoder_attempts"].append("ffmpeg")

        audio, sr, stderr = _run_ffmpeg_decode(input_path, target_sr)

        if audio is not None and sr is not None:
            diagnostics["num_samples"] = int(audio.numel())
            diagnostics["sample_rate"] = sr
            diagnostics["duration_sec"] = (
                audio.numel() / sr if sr > 0 else None
            )

            if audio.numel() == 0:
                return {
                    "ok": False,
                    "audio": None,
                    "sample_rate": None,
                    "decoder_used": "ffmpeg",
                    "error_code": "EMPTY_AUDIO",
                    "error_message": "Decoded audio contains zero samples",
                    "diagnostics": diagnostics,
                }

            import torch
            if not torch.isfinite(audio).all():
                return {
                    "ok": False,
                    "audio": None,
                    "sample_rate": None,
                    "decoder_used": "ffmpeg",
                    "error_code": "INVALID_VALUES",
                    "error_message": "Audio contains NaN or Inf values",
                    "diagnostics": diagnostics,
                }

            return {
                "ok": True,
                "audio": audio,
                "sample_rate": sr,
                "decoder_used": "ffmpeg",
                "error_code": None,
                "error_message": None,
                "diagnostics": diagnostics,
            }

        diagnostics["decoder_stderr"] = stderr

    # ---------- No decoder succeeded ----------
    return {
        "ok": False,
        "audio": None,
        "sample_rate": None,
        "decoder_used": None,
        "error_code": "NO_DECODER_AVAILABLE",
        "error_message": "No available decoder succeeded",
        "diagnostics": diagnostics,
    }
