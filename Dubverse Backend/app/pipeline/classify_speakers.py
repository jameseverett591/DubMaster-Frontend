"""
Speaker gender/age classification using fundamental frequency (F0) estimation.

Uses torchaudio.functional.compute_kaldi_pitch to classify each diarized speaker
as male, female, or child based on their median vocal pitch.

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


def classify_speakers(
    audio: torch.Tensor,
    sample_rate: int,
    segments: list,
) -> Dict[str, str]:
    """
    Classify each unique speaker as 'male', 'female', or 'child'.

    Args:
        audio:       1-D float32 mono PCM tensor from extract_audio().
        sample_rate: Sample rate of *audio*.
        segments:    List of TranscriptSegment objects (or dicts) that already
                     carry normalised speaker labels such as 'speaker-1'.

    Returns:
        Dict mapping speaker label -> gender, e.g.
        {'speaker-1': 'male', 'speaker-2': 'female', 'speaker-3': 'child'}
    """
    if audio is None or not segments:
        return {}

    # Collect time ranges per normalised speaker label
    speaker_ranges: Dict[str, List[Dict]] = {}
    for seg in segments:
        if hasattr(seg, "speaker"):
            spk   = seg.speaker
            start = seg.start
            end   = seg.end
        else:
            spk   = seg.get("speaker", "speaker-1")
            start = float(seg.get("start", 0.0))
            end   = float(seg.get("end",   0.0))
        speaker_ranges.setdefault(spk, []).append({"start": start, "end": end})

    result: Dict[str, str] = {}
    for speaker, ranges in speaker_ranges.items():
        f0     = _median_f0(audio, sample_rate, ranges)
        gender = _classify(f0)
        result[speaker] = gender
        if f0 is not None:
            logger.info(f"[CLASSIFY] {speaker}: median F0={f0:.1f} Hz -> {gender}")
        else:
            logger.info(f"[CLASSIFY] {speaker}: no voiced frames detected -> defaulting to {gender}")

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
    """
    all_pitch: List[float] = []
    extracted = 0.0

    for r in sorted(ranges, key=lambda x: x["start"]):
        dur = r["end"] - r["start"]
        if dur < 0.25:
            continue

        s = int(r["start"] * sample_rate)
        e = min(int(r["end"]   * sample_rate), audio.shape[-1])
        if e <= s:
            continue

        seg_audio = audio[s:e]
        if seg_audio.dtype != torch.float32:
            seg_audio = seg_audio.float()
        if seg_audio.dim() == 1:
            seg_audio = seg_audio.unsqueeze(0)  # [1, T]

        try:
            # Returns [1, frames, 2]; col 0 = NCCF, col 1 = pitch in Hz
            pitch_feat = torchaudio.functional.compute_kaldi_pitch(
                seg_audio, sample_rate, min_f0=50.0, max_f0=500.0
            )
            pitch_hz = pitch_feat[0, :, 1]          # [frames]
            voiced   = pitch_hz[pitch_hz > 50.0]    # discard unvoiced (near-zero)
            if voiced.numel() > 0:
                all_pitch.extend(voiced.tolist())
        except Exception as exc:
            logger.debug(f"[CLASSIFY] pitch extraction error: {exc}")

        extracted += dur
        if extracted >= cap_seconds:
            break

    if not all_pitch:
        return None

    all_pitch.sort()
    return all_pitch[len(all_pitch) // 2]


def _classify(f0: Optional[float]) -> str:
    if f0 is None:
        return "male"             # safe default when pitch undetectable
    if f0 >= F0_CHILD_THRESHOLD:
        return "child"
    if f0 >= F0_FEMALE_THRESHOLD:
        return "female"
    return "male"
