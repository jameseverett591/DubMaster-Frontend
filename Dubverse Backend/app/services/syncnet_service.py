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


def analyze_segment_lip_sync(
    original_video_path: str,
    segment_audio_path: str,
    seg_start: float,
    seg_end: float,
) -> Optional[Dict[str, Any]]:
    """
    Verify ONE segment's lip-sync without requiring the full dub to be rebuilt.

    The on-screen mouth movement doesn't change when a segment's dubbed audio
    is regenerated — only the audio does. So instead of re-analyzing the whole
    assembled dub video (analyze_lip_sync above, which requires dubbed_{lang}.mp4
    to reflect every edit), this extracts the mouth-movement signal directly from
    the ORIGINAL source video for just this segment's time window, and the audio
    energy envelope directly from the segment's freshly-regenerated audio file,
    then cross-correlates just those two. Same scoring math as the per-segment
    path in analyze_lip_sync, scoped down so a single "Fix" can be confirmed
    without a full rebuild+remux cycle.
    """
    if not is_enabled():
        return None
    if not os.path.exists(original_video_path):
        logger.warning(f"[SYNCNET-SEGMENT] Source video not found: {original_video_path}")
        return None
    if not os.path.exists(segment_audio_path):
        logger.warning(f"[SYNCNET-SEGMENT] Segment audio not found: {segment_audio_path}")
        return None
    if seg_end <= seg_start:
        return {"status": "error", "reason": "invalid segment window"}

    try:
        audio_energy = _extract_audio_energy(segment_audio_path)
        if audio_energy is None:
            return {"status": "error", "reason": "audio extraction failed"}

        mm = _extract_mouth_movement_window(original_video_path, seg_start, seg_end)
        if "error" in mm:
            return {"status": "error", "reason": mm["error"]}
        mouth_movement = mm["signal"]

        min_len = min(len(audio_energy), len(mouth_movement))
        if min_len < 5:
            return {"status": "error", "reason": "insufficient data"}

        audio_energy = _normalize(audio_energy[:min_len])
        mouth_movement = _normalize(mouth_movement[:min_len])

        fps = 25
        max_offset_frames = int(0.5 * fps)
        corr, offset = _cross_correlate(audio_energy, mouth_movement, max_offset_frames)
        if corr <= -1.0:
            # No offset produced a valid correlation — a constant (all-zero or
            # all-NaN) signal is the usual cause. A 0 score would read as "bad
            # sync"; the honest answer is "couldn't measure".
            return {"status": "error", "reason": "could not correlate mouth movement with audio"}
        score = max(0, min(100, int((corr + 0.2) / 0.8 * 100)))
        offset_ms = round(offset / fps * 1000)

        return {
            "status": "ok",
            "sync_score": score,
            "correlation": round(corr, 3),
            "offset_ms": offset_ms,
            "face_coverage": round(mm["face_ratio"], 2),
            "severity": "good" if score >= 70 else "fair" if score >= 40 else "poor",
        }
    except Exception as e:
        logger.error(f"[SYNCNET-SEGMENT] Analysis failed: {e}", exc_info=True)
        return {"status": "error", "reason": str(e)}


def _dubbed_energy_window(segments: List[Dict], w0: float, w1: float, fps: int = 25) -> Optional[Any]:
    """Per-frame audio energy of the DUBBED track inside [w0, w1].

    There is no rendered dub to measure against pre-render — so the signal is
    built from each segment's current audio file (seg["path"], which committed
    takes and regenerations both update) laid down at its committed start time.
    That is exactly "what's on the timeline now": timing edits shift a
    segment's energy; regenerated audio swaps its content. max() over overlaps
    keeps the louder of two stacked takes."""
    import numpy as np

    n = max(1, int(round((w1 - w0) * fps)))
    out = np.zeros(n, dtype=np.float32)
    any_audio = False

    for seg in segments or []:
        p = seg.get("path")
        if not p or not os.path.exists(p):
            continue
        s = seg.get("committed_start_time")
        s = float(s) if s is not None else float(seg.get("start_time") or seg.get("start") or 0)

        energy = _extract_audio_energy(p)
        if energy is None or len(energy) == 0:
            continue

        # Overlap check against the window before touching the array.
        if s + len(energy) / fps <= w0 or s >= w1:
            continue

        off = int(round((s - w0) * fps))
        lo = max(0, -off)
        hi = min(len(energy), n - off)
        if hi > lo:
            out[off + lo: off + hi] = np.maximum(out[off + lo: off + hi], energy[lo:hi])
        any_audio = True

    return out if any_audio else None


def score_lipsync_range(
    video_path: str,
    segments: List[Dict],
    start_s: float,
    end_s: float,
) -> Dict[str, Any]:
    """Lip-sync score for one span of the timeline: mouth movement from the
    original video in [start_s, end_s] vs the dubbed track built from the
    segments' current audio at committed times. Works per-minute upfront and
    on an edited span after fixes — no rebuild needed either way."""
    if end_s - start_s < 0.2:
        return {"start": round(start_s, 2), "end": round(end_s, 2),
                "status": "error", "reason": "span too short to score"}

    mm = _extract_mouth_movement_window(video_path, start_s, end_s)
    energy = _dubbed_energy_window(segments, start_s, end_s)
    return _score_span(video_path, energy, mm, start_s, end_s)


def _score_span(video_path: str, energy: Any, mouth: Dict[str, Any], w0: float, w1: float) -> Dict[str, Any]:
    """Shared scorer: dubbed energy envelope + extracted mouth movement for
    one span -> score dict."""
    base = {"start": round(w0, 2), "end": round(w1, 2)}
    if "error" in mouth:
        return {**base, "status": "error", "reason": mouth["error"]}
    if energy is None:
        return {**base, "status": "error",
                "reason": "no segment audio in this window — generate the dub first"}

    min_len = min(len(energy), len(mouth["signal"]))
    if min_len < 5:
        return {**base, "status": "error", "reason": "insufficient data"}

    a = _normalize(energy[:min_len])
    b = _normalize(mouth["signal"][:min_len])

    fps = 25
    corr, offset = _cross_correlate(a, b, int(0.5 * fps))
    if corr <= -1.0:
        return {**base, "status": "error",
                "reason": "could not correlate mouth movement with audio"}

    score = max(0, min(100, int((corr + 0.2) / 0.8 * 100)))
    return {
        **base,
        "status": "ok",
        "sync_score": score,
        "correlation": round(corr, 3),
        "offset_ms": round(offset / fps * 1000),
        "face_coverage": round(mouth["face_ratio"], 2),
        "severity": "good" if score >= 70 else "fair" if score >= 40 else "poor",
    }


def score_lipsync_windows(
    video_path: str,
    segments: List[Dict],
    duration_s: float,
    window_s: float = 60.0,
) -> List[Dict[str, Any]]:
    """Minute-by-minute lip-sync scores across the whole timeline — the
    upfront pass the QC monitor shows on entry.

    The dubbed energy track is built ONCE for the full duration and sliced
    per window — rebuilding per window would re-run ffmpeg on the same segment
    files for every overlapping window."""
    import numpy as np

    fps = 25
    track = _dubbed_energy_window(segments, 0.0, duration_s, fps)

    out = []
    t = 0.0
    while t < duration_s - 0.5:
        w1 = min(t + window_s, duration_s)
        mouth = _extract_mouth_movement_window(video_path, t, w1)
        energy = None
        if track is not None:
            lo = int(t * fps)
            hi = int(w1 * fps)
            energy = track[lo:hi]
            if not np.any(energy):
                energy = None
        out.append(_score_span(video_path, energy, mouth, t, w1))
        t += window_s
    return out


# ── Face detection ────────────────────────────────────────────────────────
# OpenCV 5.x removed CascadeClassifier AND the bundled Haar cascades entirely
# (cv2.data is an empty package there). The replacement is YuNet
# (cv2.FaceDetectorYN), but its ONNX model isn't shipped in the wheel either —
# fetch it once into the bind-mounted data dir so restarts don't re-download.
_YUNET_MODEL = "/app/data/models/face_detection_yunet_2023mar.onnx"
_YUNET_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/"
    "face_detection_yunet/face_detection_yunet_2023mar.onnx"
)


def _ensure_yunet_model() -> Optional[str]:
    if os.path.exists(_YUNET_MODEL):
        return _YUNET_MODEL
    try:
        import urllib.request
        os.makedirs(os.path.dirname(_YUNET_MODEL), exist_ok=True)
        urllib.request.urlretrieve(_YUNET_URL, _YUNET_MODEL)
        return _YUNET_MODEL
    except Exception as e:
        logger.warning(f"[SYNCNET] Could not fetch YuNet model: {e}")
        return None


def _make_face_detector():
    """(kind, detector) — 'haar' + CascadeClassifier (OpenCV 4.x), or
    'yunet' + FaceDetectorYN (5.x). None when neither can be built."""
    import cv2

    if hasattr(cv2, "CascadeClassifier"):
        cc = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        if not cc.empty():
            return ("haar", cc)

    if hasattr(cv2, "FaceDetectorYN_create"):
        model = _ensure_yunet_model()
        if model:
            try:
                det = cv2.FaceDetectorYN_create(model, "", (320, 320), score_threshold=0.6)
                return ("yunet", det)
            except Exception as e:
                logger.warning(f"[SYNCNET] YuNet init failed: {e}")

    return None


def _detect_faces(det, gray) -> list:
    """[x, y, w, h] boxes for the largest faces in a grayscale frame."""
    import cv2
    import numpy as np

    kind, d = det
    if kind == "haar":
        return d.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))

    h, w = gray.shape[:2]
    d.setInputSize((w, h))
    _, faces = d.detect(gray)
    if faces is None:
        return []
    return [tuple(map(int, f[:4])) for f in faces if f[4] >= 0.6]


def score_lipsync_audio_range(
    video_path: str,
    segments: List[Dict],
    start_s: float,
    end_s: float,
    source_energy: Optional[Any] = None,
) -> Dict[str, Any]:
    """Audio-vs-audio timing: source speech envelope vs the dubbed track in
    [start_s, end_s]. The dub should track the source's speech rhythm almost
    exactly, so the peak-correlation offset IS the sync error — no face
    needed. This is the trusted timing metric; the visual scorer stays for
    footage where face detection works."""
    base = {"start": round(start_s, 2), "end": round(end_s, 2)}
    if end_s - start_s < 0.2:
        return {**base, "status": "error", "reason": "span too short to score"}

    fps = 25
    if source_energy is None:
        source_energy = _extract_audio_energy(video_path)
        if source_energy is None:
            return {**base, "status": "error", "reason": "source audio extraction failed"}

    src = source_energy[int(start_s * fps): int(end_s * fps)]
    dub = _dubbed_energy_window(segments, start_s, end_s, fps)
    if dub is None:
        return {**base, "status": "error",
                "reason": "no segment audio in this window — generate the dub first"}

    min_len = min(len(src), len(dub))
    if min_len < 10:
        return {**base, "status": "error", "reason": "insufficient audio"}

    a = _normalize(src[:min_len])
    b = _normalize(dub[:min_len])

    # +/-1.5s search — the systematic placement lead ran ~400ms; the window
    # needs headroom to prove a corrected offset actually moved to ~0.
    corr, off = _cross_correlate(a, b, int(1.5 * fps))
    if corr <= -1.0 or corr < 0.15:
        return {**base, "status": "error",
                "reason": "dub rhythm doesn't track the source — correlation too weak"}

    offset_ms = round(off / fps * 1000)
    abs_off = abs(offset_ms)
    return {
        **base, "status": "ok",
        "offset_ms": offset_ms,
        "correlation": round(corr, 3),
        "score": max(0, min(100, int(100 - abs_off / 8))),   # 0ms=100, 800ms+=0
        "severity": "good" if abs_off <= 40 else "fair" if abs_off <= 150 else "poor",
    }


def score_lipsync_audio_windows(
    video_path: str,
    segments: List[Dict],
    duration_s: float,
    window_s: float = 60.0,
) -> List[Dict[str, Any]]:
    """Minute-by-minute audio-vs-audio offsets. Source envelope is extracted
    ONCE and sliced per window — same cost discipline as the visual pass."""
    source = _extract_audio_energy(video_path)
    out = []
    t = 0.0
    while t < duration_s - 0.5:
        w1 = min(t + window_s, duration_s)
        out.append(score_lipsync_audio_range(video_path, segments, t, w1, source))
        t += window_s
    return out


def _extract_mouth_movement_window(video_path: str, start_s: float, end_s: float) -> Dict[str, Any]:
    """Same approach as _extract_mouth_movement, but seeks straight to [start_s, end_s]
    instead of decoding the whole file — a single-segment check shouldn't have to walk
    frames it doesn't need, especially since this may run once per Fix click.

    Returns a dict: {"signal": np.array, "face_ratio": float} on success, or
    {"error": <reason>}. No-face frames interpolate instead of emitting 0.0 —
    a zero at a dropped detection injects a false 'mouth stopped' sample and
    corrupts the correlation. """
    try:
        import cv2
        import numpy as np

        det = _make_face_detector()
        if det is None:
            logger.warning("[SYNCNET-SEGMENT] No face detector available (no Haar on cv2 5.x, YuNet model fetch failed)")
            return {"error": "face detection model unavailable"}

        # cv2.VideoCapture + cap.read() decodes every frame through Python on
        # the Windows bind mount — ~220s per minute of video, unusable. ffmpeg
        # pipes pre-scaled grayscale frames instead: fast seek, raw stream.
        try:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v:0",
                 "-show_entries", "stream=width,height", "-of", "csv=p=0",
                 video_path],
                capture_output=True, text=True, timeout=30,
            )
            vw, vh = [int(x) for x in probe.stdout.strip().split(",")[:2]]
        except Exception:
            return {"error": "could not read video stream info"}

        tw = min(480, vw)
        th = max(2, int(round(vh * tw / vw / 2)) * 2)
        frame_bytes = tw * th

        proc = subprocess.Popen(
            ["ffmpeg", "-v", "error",
             "-ss", str(start_s), "-to", str(end_s), "-i", video_path,
             "-vf", f"fps=25,scale={tw}:{th},format=gray",
             "-f", "rawvideo", "-"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )

        mouth_signal = []
        face_frames = 0
        prev_mouth_region = None
        last_box = None
        idx = 0
        # YuNet on a 480px frame is still the slowest per-frame step — run it
        # every 3rd frame and reuse the last box between detects.
        detect_every = 3

        while True:
            buf = proc.stdout.read(frame_bytes)
            if not buf or len(buf) < frame_bytes:
                break
            gray = np.frombuffer(buf, dtype=np.uint8).reshape(th, tw)

            if last_box is None or idx % detect_every == 0:
                faces = _detect_faces(det, gray)
                last_box = max(faces, key=lambda f: f[2] * f[3]) if len(faces) else None

            if last_box is not None:
                face_frames += 1
                x, y, w, h = last_box
                mouth_y = y + int(h * 0.65)
                mouth_h = int(h * 0.35)
                mouth_region = gray[mouth_y:mouth_y + mouth_h, x:x + w]

                if prev_mouth_region is not None and mouth_region.shape == prev_mouth_region.shape:
                    diff = np.mean(np.abs(
                        mouth_region.astype(float) - prev_mouth_region.astype(float)
                    ))
                    mouth_signal.append(diff)
                else:
                    mouth_signal.append(0.0)

                prev_mouth_region = mouth_region.copy()
            else:
                mouth_signal.append(None)
                prev_mouth_region = None

            idx += 1

        proc.stdout.close()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()

        n = len(mouth_signal)
        if n < 5:
            return {"error": "window too short or outside the video"}
        if face_frames == 0:
            return {"error": "no face detected in this segment's window"}

        # Fill detection gaps by interpolation; zero-filling fabricates a
        # 'mouth stopped moving' sample and poisons the correlation.
        known = [i for i, v in enumerate(mouth_signal) if v is not None]
        if len(known) < 5:
            return {"error": "face visible in too few frames to score"}
        filled = np.interp(
            np.arange(n), known, [mouth_signal[i] for i in known]
        )

        return {
            "signal": filled.astype(np.float32),
            "face_ratio": face_frames / n,
        }

    except Exception as e:
        logger.warning(f"[SYNCNET-SEGMENT] Mouth movement window extraction failed: {e}")
        return {"error": f"extraction failed: {e}"}


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

        det = _make_face_detector()
        if det is None:
            logger.warning("[SYNCNET] No face detector available (no Haar on cv2 5.x, YuNet model fetch failed)")
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
            faces = _detect_faces(det, gray)

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
