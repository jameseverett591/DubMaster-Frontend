"""
emotion2vec-based emotion preservation analysis.

Compares emotional expression between original and dubbed audio segments.
Uses torchaudio MFCC + energy features as a lightweight proxy for emotion
vectors when the full emotion2vec model is not available.

Scoring:
  - Extract emotion-correlated audio features per segment
  - Compare feature distributions between original and dubbed
  - Higher similarity = better emotion preservation
"""

import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

# Cache the model to avoid reloading
_MODEL = None
_MODEL_AVAILABLE = None


def is_enabled() -> bool:
    """Check if emotion analysis is available (needs numpy + torchaudio)."""
    try:
        import numpy as np
        import torchaudio
        return True
    except ImportError:
        return False


def _check_emotion2vec() -> bool:
    """Check if the full emotion2vec model is available."""
    global _MODEL_AVAILABLE
    if _MODEL_AVAILABLE is not None:
        return _MODEL_AVAILABLE
    try:
        from funasr import AutoModel
        _MODEL_AVAILABLE = True
    except ImportError:
        _MODEL_AVAILABLE = False
    return _MODEL_AVAILABLE


def analyze_emotion_preservation(
    original_video_path: str,
    dubbed_video_path: str,
    segments: Optional[List[Dict]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Compare emotional expression between original and dubbed audio.

    Strategy:
    1. Extract audio from both videos
    2. For each segment, extract emotion-correlated features
    3. Compare feature vectors between original and dubbed
    4. Return preservation score (0-100) and per-segment details

    Returns None if prerequisites are missing.
    """
    if not is_enabled():
        return None

    if not os.path.exists(original_video_path):
        logger.warning(f"[EMOTION2VEC] Original video not found: {original_video_path}")
        return None
    if not os.path.exists(dubbed_video_path):
        logger.warning(f"[EMOTION2VEC] Dubbed video not found: {dubbed_video_path}")
        return None

    try:
        import numpy as np

        # Extract audio from both videos
        orig_audio = _extract_audio(original_video_path)
        dubbed_audio = _extract_audio(dubbed_video_path)

        if orig_audio is None or dubbed_audio is None:
            return {"status": "error", "reason": "audio extraction failed"}

        # If full emotion2vec is available, use it
        if _check_emotion2vec():
            return _analyze_with_emotion2vec(
                orig_audio, dubbed_audio, segments
            )

        # Fallback: use MFCC + energy features as emotion proxy
        return _analyze_with_features(
            orig_audio, dubbed_audio, segments
        )

    except Exception as e:
        logger.error(f"[EMOTION2VEC] Analysis failed: {e}", exc_info=True)
        return {"status": "error", "reason": str(e)}


def _extract_audio(video_path: str) -> Optional[Dict]:
    """Extract audio as numpy array + sample rate."""
    try:
        import numpy as np
        import soundfile as sf

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_path = tmp.name

        cmd = [
            "ffmpeg", "-y", "-i", video_path,
            "-vn", "-ar", "16000", "-ac", "1",
            "-f", "wav", tmp_path,
        ]
        subprocess.run(cmd, capture_output=True, timeout=120)

        if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) < 100:
            return None

        audio, sr = sf.read(tmp_path)
        os.unlink(tmp_path)

        if audio.ndim > 1:
            audio = audio.mean(axis=1)

        return {"audio": audio.astype(np.float32), "sr": sr}

    except Exception as e:
        logger.warning(f"[EMOTION2VEC] Audio extraction failed: {e}")
        return None


def _extract_emotion_features(audio_data: Dict, start: float, end: float) -> Optional[Any]:
    """
    Extract emotion-correlated features from an audio segment.

    Features: energy, pitch variance, spectral centroid, MFCC stats.
    These correlate strongly with emotional expression without needing
    a full emotion recognition model.
    """
    import numpy as np

    audio = audio_data["audio"]
    sr = audio_data["sr"]

    start_sample = int(start * sr)
    end_sample = int(end * sr)
    segment = audio[max(0, start_sample):min(len(audio), end_sample)]

    if len(segment) < sr * 0.1:  # < 100ms
        return None

    features = []

    # 1. RMS energy
    rms = float(np.sqrt(np.mean(segment ** 2)))
    features.append(rms)

    # 2. Energy variance (dynamic range)
    frame_size = int(0.025 * sr)  # 25ms frames
    hop = int(0.010 * sr)  # 10ms hop
    frame_energies = []
    for i in range(0, len(segment) - frame_size, hop):
        frame = segment[i:i + frame_size]
        frame_energies.append(np.sqrt(np.mean(frame ** 2)))
    if frame_energies:
        features.append(float(np.std(frame_energies)))
    else:
        features.append(0.0)

    # 3. Zero crossing rate (correlates with voice quality)
    zcr = float(np.mean(np.abs(np.diff(np.sign(segment))) > 0))
    features.append(zcr)

    # 4. Spectral centroid (brightness - correlates with arousal)
    fft = np.fft.rfft(segment)
    magnitude = np.abs(fft)
    freqs = np.fft.rfftfreq(len(segment), 1.0 / sr)
    if magnitude.sum() > 0:
        centroid = float(np.sum(freqs * magnitude) / np.sum(magnitude))
    else:
        centroid = 0.0
    features.append(centroid / sr)  # normalize

    # 5. Spectral rolloff (bandwidth)
    cumsum = np.cumsum(magnitude)
    if cumsum[-1] > 0:
        rolloff_idx = np.searchsorted(cumsum, 0.85 * cumsum[-1])
        rolloff = float(freqs[min(rolloff_idx, len(freqs) - 1)])
    else:
        rolloff = 0.0
    features.append(rolloff / sr)

    # 6. Speech rate proxy (number of energy peaks per second)
    if frame_energies:
        fe = np.array(frame_energies)
        threshold = np.mean(fe) + 0.5 * np.std(fe)
        peaks = np.sum(np.diff((fe > threshold).astype(int)) > 0)
        duration = len(segment) / sr
        features.append(float(peaks / max(0.1, duration)))
    else:
        features.append(0.0)

    return np.array(features, dtype=np.float32)


def _analyze_with_features(
    orig_audio: Dict,
    dubbed_audio: Dict,
    segments: Optional[List[Dict]],
) -> Dict[str, Any]:
    """Analyze emotion preservation using handcrafted audio features."""
    import numpy as np

    if not segments:
        # Use fixed-length windows if no segment info
        duration = len(orig_audio["audio"]) / orig_audio["sr"]
        window = 5.0  # 5s windows
        segments = [
            {"start": i * window, "end": min((i + 1) * window, duration)}
            for i in range(int(duration / window))
        ]

    segment_results = []
    similarities = []

    for i, seg in enumerate(segments):
        start = float(seg.get("start", seg.get("original_start", 0)))
        end = float(seg.get("end", seg.get("original_end", 0)))

        orig_feat = _extract_emotion_features(orig_audio, start, end)
        dubbed_feat = _extract_emotion_features(dubbed_audio, start, end)

        if orig_feat is None or dubbed_feat is None:
            continue

        # Cosine similarity between feature vectors
        dot = float(np.dot(orig_feat, dubbed_feat))
        norm_a = float(np.linalg.norm(orig_feat))
        norm_b = float(np.linalg.norm(dubbed_feat))

        if norm_a > 0 and norm_b > 0:
            cosine_sim = dot / (norm_a * norm_b)
        else:
            cosine_sim = 0.0

        # Convert to 0-100 score
        score = max(0, min(100, int((cosine_sim + 1) / 2 * 100)))
        similarities.append(cosine_sim)

        # Compute energy ratio (dubbed should roughly match original energy)
        energy_ratio = (dubbed_feat[0] / orig_feat[0]) if orig_feat[0] > 0 else 1.0
        energy_match = max(0, min(100, int(100 - abs(1.0 - energy_ratio) * 50)))

        segment_results.append({
            "segment_index": i,
            "start": round(start, 2),
            "end": round(end, 2),
            "text": seg.get("text", "")[:60],
            "emotion_similarity": round(cosine_sim, 3),
            "emotion_score": score,
            "energy_ratio": round(energy_ratio, 2),
            "energy_match": energy_match,
            "severity": (
                "good" if score >= 70
                else "fair" if score >= 40
                else "poor"
            ),
        })

    if not similarities:
        return {"status": "error", "reason": "no segments could be analyzed"}

    overall_similarity = float(np.mean(similarities))
    overall_score = max(0, min(100, int((overall_similarity + 1) / 2 * 100)))

    return {
        "status": "ok",
        "method": "audio-feature-correlation",
        "overall_score": overall_score,
        "overall_similarity": round(overall_similarity, 3),
        "total_segments": len(segment_results),
        "poor_emotion_segments": sum(
            1 for s in segment_results if s["severity"] == "poor"
        ),
        "segment_scores": segment_results,
    }


def _analyze_with_emotion2vec(
    orig_audio: Dict,
    dubbed_audio: Dict,
    segments: Optional[List[Dict]],
) -> Dict[str, Any]:
    """Analyze using the full emotion2vec model (if installed)."""
    import numpy as np

    try:
        from funasr import AutoModel
        global _MODEL

        if _MODEL is None:
            logger.info("[EMOTION2VEC] Loading emotion2vec model...")
            _MODEL = AutoModel(model="iic/emotion2vec_plus_base")
            logger.info("[EMOTION2VEC] Model loaded")

        if not segments:
            duration = len(orig_audio["audio"]) / orig_audio["sr"]
            window = 5.0
            segments = [
                {"start": i * window, "end": min((i + 1) * window, duration)}
                for i in range(int(duration / window))
            ]

        segment_results = []
        similarities = []
        sr = orig_audio["sr"]

        for i, seg in enumerate(segments):
            start = float(seg.get("start", seg.get("original_start", 0)))
            end = float(seg.get("end", seg.get("original_end", 0)))
            s0 = int(start * sr)
            s1 = int(end * sr)

            orig_seg = orig_audio["audio"][max(0, s0):min(len(orig_audio["audio"]), s1)]
            dubbed_seg = dubbed_audio["audio"][max(0, s0):min(len(dubbed_audio["audio"]), s1)]

            if len(orig_seg) < sr * 0.3 or len(dubbed_seg) < sr * 0.3:
                continue

            # Get emotion embeddings
            orig_result = _MODEL.generate(orig_seg, output_dir=None, granularity="utterance")
            dubbed_result = _MODEL.generate(dubbed_seg, output_dir=None, granularity="utterance")

            if not orig_result or not dubbed_result:
                continue

            orig_emb = np.array(orig_result[0].get("feats", [0]))
            dubbed_emb = np.array(dubbed_result[0].get("feats", [0]))

            # Cosine similarity
            dot = float(np.dot(orig_emb, dubbed_emb))
            norm_a = float(np.linalg.norm(orig_emb))
            norm_b = float(np.linalg.norm(dubbed_emb))

            if norm_a > 0 and norm_b > 0:
                sim = dot / (norm_a * norm_b)
            else:
                sim = 0.0

            score = max(0, min(100, int((sim + 1) / 2 * 100)))
            similarities.append(sim)

            # Get emotion labels
            orig_labels = orig_result[0].get("labels", [])
            dubbed_labels = dubbed_result[0].get("labels", [])

            segment_results.append({
                "segment_index": i,
                "start": round(start, 2),
                "end": round(end, 2),
                "text": seg.get("text", "")[:60],
                "emotion_similarity": round(sim, 3),
                "emotion_score": score,
                "original_emotions": orig_labels[:3] if orig_labels else [],
                "dubbed_emotions": dubbed_labels[:3] if dubbed_labels else [],
                "severity": (
                    "good" if score >= 70
                    else "fair" if score >= 40
                    else "poor"
                ),
            })

        if not similarities:
            return {"status": "error", "reason": "no segments analyzed"}

        overall_sim = float(np.mean(similarities))
        overall_score = max(0, min(100, int((overall_sim + 1) / 2 * 100)))

        return {
            "status": "ok",
            "method": "emotion2vec",
            "overall_score": overall_score,
            "overall_similarity": round(overall_sim, 3),
            "total_segments": len(segment_results),
            "poor_emotion_segments": sum(
                1 for s in segment_results if s["severity"] == "poor"
            ),
            "segment_scores": segment_results,
        }

    except Exception as e:
        logger.warning(f"[EMOTION2VEC] Model analysis failed, falling back to features: {e}")
        return _analyze_with_features(orig_audio, dubbed_audio, segments)
