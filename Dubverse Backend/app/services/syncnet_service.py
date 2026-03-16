"""
SyncNet lip-sync quality scoring.

Uses a lightweight approach based on audio-visual correlation:
1. Extract face crops from video frames using OpenCV
2. Extract MFCC features from audio
3. Compute cross-correlation between mouth movement and audio energy
4. Output an LSE-D-like sync score per segment

Falls back gracefully if OpenCV face detection is unavailable.
"""

import logging
import os
import subprocess
import tempfile
import json
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """SyncNet analysis is available when OpenCV and numpy are installed."""
    try:
        import cv2
        import numpy as np
        return True
    except ImportError:
        return False


def analyze_lip_sync(
    video_path: str,
    segments: Optional[List[Dict]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Analyze lip-sync quality between video and audio.

    Uses audio energy vs. mouth movement correlation as a proxy
    for full SyncNet LSE-D scoring (which requires the pretrained
    SyncNet model weights).

    Returns dict with overall_score (0-100) and per-segment details.
    """
    if not is_enabled():
        return None

    if not os.path.exists(video_path):
        logger.warning(f"[SYNCNET] Video not found: {video_path}")
        return None

    try:
        import cv2
        import numpy as np

        # --- Step 1: Extract audio energy envelope ---
        audio_energy = _extract_audio_energy(video_path)
        if audio_energy is None:
            return {"status": "error", "reason": "audio extraction failed"}

        # --- Step 2: Extract mouth movement signal from video ---
        mouth_movement = _extract_mouth_movement(video_path)
        if mouth_movement is None:
            return {
                "status": "ok",
                "method": "audio-only",
                "reason": "face detection unavailable - using audio-only analysis",
                "overall_score": _score_audio_only(audio_energy, segments),
                "segment_scores": [],
            }

        # --- Step 3: Compute correlation ---
        # Resample to same length
        min_len = min(len(audio_energy), len(mouth_movement))
        if min_len < 10:
            return {"status": "error", "reason": "insufficient data"}

        audio_energy = audio_energy[:min_len]
        mouth_movement = mouth_movement[:min_len]

        # Normalize both signals
        audio_energy = _normalize(audio_energy)
        mouth_movement = _normalize(mouth_movement)

        # Overall cross-correlation
        fps = 25  # standard video FPS for analysis
        max_offset_frames = int(0.5 * fps)  # search +/- 0.5s

        overall_corr, best_offset = _cross_correlate(
            audio_energy, mouth_movement, max_offset_frames
        )

        # Convert correlation (-1 to 1) to score (0 to 100)
        # Good lip sync: correlation > 0.3, perfect > 0.6
        overall_score = max(0, min(100, int((overall_corr + 0.2) / 0.8 * 100)))

        # Per-segment scoring
        segment_scores = []
        if segments:
            for i, seg in enumerate(segments):
                start = float(seg.get("start", seg.get("original_start", 0)))
                end = float(seg.get("end", seg.get("original_end", 0)))
                start_frame = int(start * fps)
                end_frame = int(end * fps)

                if start_frame >= min_len or end_frame <= start_frame:
                    continue

                end_frame = min(end_frame, min_len)
                seg_audio = audio_energy[start_frame:end_frame]
                seg_mouth = mouth_movement[start_frame:end_frame]

                if len(seg_audio) < 5:
                    continue

                seg_corr, seg_offset = _cross_correlate(
                    seg_audio, seg_mouth, max_offset_frames
                )
                seg_score = max(0, min(100, int((seg_corr + 0.2) / 0.8 * 100)))
                offset_ms = round(seg_offset / fps * 1000)

                segment_scores.append({
                    "segment_index": i,
                    "start": round(start, 2),
                    "end": round(end, 2),
                    "text": seg.get("text", "")[:60],
                    "sync_score": seg_score,
                    "correlation": round(seg_corr, 3),
                    "offset_ms": offset_ms,
                    "severity": (
                        "good" if seg_score >= 70
                        else "fair" if seg_score >= 40
                        else "poor"
                    ),
                })

        offset_ms = round(best_offset / fps * 1000)

        return {
            "status": "ok",
            "method": "audio-visual-correlation",
            "overall_score": overall_score,
            "overall_correlation": round(overall_corr, 3),
            "offset_ms": offset_ms,
            "offset_direction": (
                "audio_leads" if best_offset > 0
                else "video_leads" if best_offset < 0
                else "in_sync"
            ),
            "total_segments_scored": len(segment_scores),
            "poor_sync_segments": sum(
                1 for s in segment_scores if s["severity"] == "poor"
            ),
            "segment_scores": segment_scores,
        }

    except Exception as e:
        logger.error(f"[SYNCNET] Analysis failed: {e}", exc_info=True)
        return {"status": "error", "reason": str(e)}


def _extract_audio_energy(video_path: str) -> Optional[Any]:
    """Extract per-frame audio energy from video."""
    try:
        import numpy as np
        import soundfile as sf

        # Extract audio to temp WAV
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name

        cmd = [
            "ffmpeg", "-y", "-i", video_path,
            "-vn", "-ar", "16000", "-ac", "1",
            "-f", "wav", tmp_path,
        ]
        subprocess.run(cmd, capture_output=True, timeout=60)

        if not os.path.exists(tmp_path):
            return None

        audio, sr = sf.read(tmp_path)
        os.unlink(tmp_path)

        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        audio = audio.astype(np.float32)

        # Compute per-frame energy (at 25 FPS)
        fps = 25
        frame_samples = sr // fps
        n_frames = len(audio) // frame_samples

        energy = np.array([
            np.sqrt(np.mean(
                audio[i * frame_samples:(i + 1) * frame_samples] ** 2
            ))
            for i in range(n_frames)
        ])

        return energy

    except Exception as e:
        logger.warning(f"[SYNCNET] Audio energy extraction failed: {e}")
        return None


def _extract_mouth_movement(video_path: str) -> Optional[Any]:
    """Extract mouth region movement signal from video using OpenCV face detection."""
    try:
        import cv2
        import numpy as np

        # Use OpenCV's built-in Haar cascade for face detection
        face_cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        face_cascade = cv2.CascadeClassifier(face_cascade_path)

        if face_cascade.empty():
            logger.warning("[SYNCNET] Face cascade not available")
            return None

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return None

        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        # Sample at 25 FPS equivalent
        sample_interval = max(1, int(fps / 25))
        mouth_signal = []
        prev_mouth_region = None
        frame_idx = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % sample_interval != 0:
                frame_idx += 1
                continue

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60)
            )

            if len(faces) > 0:
                # Take the largest face
                x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
                # Mouth region: lower 30% of face
                mouth_y = y + int(h * 0.65)
                mouth_h = int(h * 0.35)
                mouth_region = gray[mouth_y:mouth_y + mouth_h, x:x + w]

                if prev_mouth_region is not None and mouth_region.shape == prev_mouth_region.shape:
                    # Movement = absolute difference between consecutive frames
                    diff = np.mean(np.abs(
                        mouth_region.astype(float) - prev_mouth_region.astype(float)
                    ))
                    mouth_signal.append(diff)
                else:
                    mouth_signal.append(0.0)

                prev_mouth_region = mouth_region.copy()
            else:
                mouth_signal.append(0.0)
                prev_mouth_region = None

            frame_idx += 1

        cap.release()

        if len(mouth_signal) < 10:
            return None

        return np.array(mouth_signal, dtype=np.float32)

    except Exception as e:
        logger.warning(f"[SYNCNET] Mouth movement extraction failed: {e}")
        return None


def _normalize(signal):
    """Normalize signal to zero mean, unit variance."""
    import numpy as np
    std = np.std(signal)
    if std < 1e-6:
        return signal - np.mean(signal)
    return (signal - np.mean(signal)) / std


def _cross_correlate(signal_a, signal_b, max_offset: int):
    """
    Compute normalized cross-correlation between two signals.
    Returns (best_correlation, best_offset_in_frames).
    """
    import numpy as np

    best_corr = -1.0
    best_offset = 0

    for offset in range(-max_offset, max_offset + 1):
        if offset > 0:
            a = signal_a[offset:]
            b = signal_b[:len(a)]
        elif offset < 0:
            b = signal_b[-offset:]
            a = signal_a[:len(b)]
        else:
            a, b = signal_a, signal_b

        min_len = min(len(a), len(b))
        if min_len < 5:
            continue

        a = a[:min_len]
        b = b[:min_len]

        corr = np.corrcoef(a, b)[0, 1]
        if not np.isnan(corr) and corr > best_corr:
            best_corr = corr
            best_offset = offset

    return best_corr, best_offset


def _score_audio_only(audio_energy, segments) -> int:
    """Fallback score based on audio energy alignment with expected speech regions."""
    import numpy as np

    if segments is None or len(segments) == 0 or audio_energy is None:
        return 50  # neutral

    fps = 25
    total_frames = len(audio_energy)
    speech_mask = np.zeros(total_frames, dtype=bool)

    for seg in segments:
        start = int(float(seg.get("start", 0)) * fps)
        end = int(float(seg.get("end", 0)) * fps)
        start = max(0, min(start, total_frames - 1))
        end = max(0, min(end, total_frames))
        speech_mask[start:end] = True

    if not speech_mask.any():
        return 50

    speech_energy = np.mean(audio_energy[speech_mask])
    silence_energy = np.mean(audio_energy[~speech_mask]) if (~speech_mask).any() else 0

    # Good dub: speech regions have higher energy than silence
    if speech_energy > 0:
        ratio = silence_energy / speech_energy
        score = max(0, min(100, int((1.0 - ratio) * 100)))
        return score

    return 50
