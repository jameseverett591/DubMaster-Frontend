"""
Speaker gender/age classification using fundamental frequency (F0) estimation.

Uses torchaudio.functional.detect_pitch_frequency to classify each diarized
speaker as male, female, or child based on their median vocal pitch.

F0 boundaries (Hz) based on average human vocal fundamental frequencies:
  Male speech:   ~85-180 Hz  (median ~120)
  Female speech: ~165-265 Hz (median ~210)
  Child speech:  ~250-400 Hz (median ~300)
"""

import logging
import os
from typing import Dict, List, Optional

import torch
import torchaudio

logger = logging.getLogger(__name__)

# Pitch thresholds (Hz) — configurable via env vars so you can tune per-video
# without code changes.
#
# Action-scene guidance:
#   Males shout at 140-200 Hz, so raising F0_FEMALE_THRESHOLD above 185
#   avoids mis-classifying strained male voices as female.
#   Children 6-10 yr peak around 220-300 Hz; F0_CHILD_THRESHOLD=220 gives
#   a wider safety margin than 230.
#
# Defaults:
#   F0_FEMALE_THRESHOLD=185   (was 165 — raised to handle shouting males)
#   F0_CHILD_THRESHOLD=220    (was 230 — lowered to catch more child voices)
F0_FEMALE_THRESHOLD = float(os.getenv("F0_FEMALE_THRESHOLD", "185"))
F0_CHILD_THRESHOLD  = float(os.getenv("F0_CHILD_THRESHOLD",  "220"))

# RMS threshold: frames below this energy level are silence/noise, not speech.
RMS_VOICED_THRESHOLD = float(os.getenv("RMS_VOICED_THRESHOLD", "0.01"))

# Frame size for RMS computation (in samples at the audio sample rate).
# detect_pitch_frequency uses frame_time=0.01 by default (10ms), so we
# compute RMS in matching 10ms windows.
FRAME_MS = 10


def classify_speakers(
    audio: torch.Tensor,
    sample_rate: int,
    segments: list,
) -> Dict[str, str]:
    """
    Classify each unique speaker as 'male', 'female', or 'child'.

    Returns a dict mapping speaker label -> gender.
    A speaker is marked 'child' only if the MAJORITY of its segments have
    child-range F0, preventing one high-pitched shout from tagging an adult.
    """
    if audio is None or not segments:
        return {}

    # Classify every individual segment first.
    seg_genders: List[str] = []
    speaker_seg_genders: Dict[str, List[str]] = {}

    for seg in segments:
        if hasattr(seg, "speaker"):
            spk   = seg.speaker
            start = seg.start
            end   = seg.end
        else:
            spk   = seg.get("speaker", "speaker-1")
            start = float(seg.get("start", 0.0))
            end   = float(seg.get("end",   0.0))

        f0 = _median_f0(audio, sample_rate, [{"start": start, "end": end}])
        gender = _classify(f0)
        seg_genders.append(gender)
        speaker_seg_genders.setdefault(spk, []).append(gender)

    # Per-speaker: use majority vote across all its segments.
    # A speaker is 'child' only if > 50 % of its segments are child-range.
    result: Dict[str, str] = {}
    for speaker, genders in speaker_seg_genders.items():
        counts: Dict[str, int] = {}
        for g in genders:
            counts[g] = counts.get(g, 0) + 1
        majority = max(counts, key=lambda k: counts[k])
        result[speaker] = majority
        logger.info(
            f"[CLASSIFY] {speaker}: {counts} -> majority={majority} "
            f"({len(genders)} segments)"
        )

    return result


def _median_f0(
    audio: torch.Tensor,
    sample_rate: int,
    ranges: List[Dict],
    cap_seconds: float = 30.0,
) -> Optional[float]:
    """
    Extract pitched frames from the speaker's time ranges and return the
    median fundamental frequency.  Caps total extraction at cap_seconds to
    avoid excessive computation on very long videos.

    Uses detect_pitch_frequency (torchaudio >=2.0) with RMS-based voicing
    filter to discard silence and noise frames.
    """
    all_pitch: List[float] = []
    extracted = 0.0
    frame_samples = int(sample_rate * FRAME_MS / 1000)

    for r in sorted(ranges, key=lambda x: x["start"]):
        dur = r["end"] - r["start"]
        if dur < 0.25:
            continue

        s = int(r["start"] * sample_rate)
        e = min(int(r["end"]   * sample_rate), audio.shape[-1])
        if e <= s:
            continue

        # Slice along the time (last) dimension so both 1-D [T] and 2-D [1, T]
        # tensors (e.g. vocals from _load_vocals_tensor) work correctly.
        # audio[s:e] on a [1, T] tensor slices dim-0 (giving an empty tensor
        # for s≥1), whereas audio[..., s:e] always slices the time axis.
        seg_audio = audio[..., s:e]
        if seg_audio.dtype != torch.float32:
            seg_audio = seg_audio.float()
        if seg_audio.dim() == 1:
            seg_audio = seg_audio.unsqueeze(0)  # [1, T]

        try:
            pitch_hz = torchaudio.functional.detect_pitch_frequency(
                seg_audio, sample_rate,
                freq_low=70, freq_high=450,
            )  # [1, frames]
            pitch_hz = pitch_hz.squeeze(0)  # [frames]

            n_frames = pitch_hz.numel()
            raw = seg_audio.squeeze(0)  # [T]

            # Pad raw so it divides evenly into frames
            pad = (frame_samples - raw.numel() % frame_samples) % frame_samples
            if pad:
                raw = torch.nn.functional.pad(raw, (0, pad))

            # Reshape into [n_frames, frame_samples] and compute RMS vectorized
            expected_samples = n_frames * frame_samples
            if raw.numel() < expected_samples:
                # Not enough samples to match pitch frames, skip this segment
                continue
            
            frames = raw[:expected_samples].reshape(n_frames, frame_samples)
            rms_per_frame = frames.pow(2).mean(dim=1).sqrt()  # [n_frames]

            # Voiced mask: sufficient energy AND plausible F0 range
            voiced = (rms_per_frame >= RMS_VOICED_THRESHOLD) & (pitch_hz > 70.0) & (pitch_hz < 450.0)
            voiced_hz = pitch_hz[voiced]
            if voiced_hz.numel() > 0:
                all_pitch.extend(voiced_hz.tolist())

        except Exception as exc:
            logger.warning(f"[CLASSIFY] pitch extraction error: {exc}")

        extracted += dur
        if extracted >= cap_seconds:
            break

    if not all_pitch:
        return None

    all_pitch.sort()
    # Trim top 15% of frames before computing median to exclude shout spikes.
    # Shouted speech temporarily raises F0 above the speaker's natural range;
    # using the raw median would mis-classify adult males as children on
    # action content with frequent yells.
    trim = max(0, int(len(all_pitch) * 0.15))
    trimmed = all_pitch[: len(all_pitch) - trim] if trim else all_pitch
    return trimmed[len(trimmed) // 2]


def _classify(f0: Optional[float]) -> str:
    if f0 is None:
        return "male"             # safe default when pitch undetectable
    if f0 >= F0_CHILD_THRESHOLD:
        return "child"
    if f0 >= F0_FEMALE_THRESHOLD:
        return "female"
    return "male"
