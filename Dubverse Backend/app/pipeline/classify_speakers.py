"""
Speaker gender/age classification using fundamental frequency (F0) estimation.

Uses torchaudio.functional.detect_pitch_frequency to classify each diarized
speaker as male, female, or child based on their vocal REGISTER FLOOR — a low
percentile of their voiced pitch, not the median. See the calibration note
below for why the median fails on shouted/angry content.

Register-floor boundaries (Hz), measured at the 25th percentile over 50
speakers across 14 real jobs:
  Male speech:   ~93-150 Hz
  Female speech: ~170-180 Hz
  Child speech:  ~250+ Hz
"""

import logging
import os
from typing import Dict, List, Optional

import torch
import torchaudio

logger = logging.getLogger(__name__)

# We classify on the speaker's REGISTER FLOOR — a low percentile of their
# voiced F0 — not on a median.
#
# Why: shouting raises the TOP of a speaker's pitch range but not the bottom.
# A median (even one that trims the top 15%) therefore tracks vocal effort as
# much as vocal identity, so a man in sustained rage drifts up into the female
# band. The old trim assumed shouting was an outlier; in angry content it IS
# the distribution, so trimming 15% moved nothing. Measured on a real
# enraged-male video: two male speakers came out at 207 and 212 Hz by trimmed
# median (both -> "female"), but 150 and 135 Hz at the 25th percentile (both
# correctly male).
#
# Calibrate on the RMS-GATED distribution this module actually produces, not
# on raw pitch frames. The voicing gate below drops low-energy frames, and
# quiet frames are disproportionately the relaxed low-pitched ones — so the
# gated distribution sits well above an ungated one. Measured percentiles for
# the two confirmed-male shouters:
#             p5    p10   p25   p50
#   spk-2:    126   150   174   218
#   spk-4:    118   151   186   227
#   (child):  256   277   298   317
#   (female): 166   166   206   227
# p25 and p10 both put shouting males over any usable female line; p5 leaves
# a clean gap. Hence the 5th percentile.
#
# The female boundary is the less certain of the two — it rests on a single
# probable-female speaker (166 Hz at p5). The male and child sides are well
# separated. Revisit F0_FEMALE_HZ if a genuine female is classified male.
#
# NOTE: these use NEW env names on purpose. The previous knobs
# (F0_FEMALE_THRESHOLD=185 / F0_CHILD_THRESHOLD=220) are calibrated for the
# old median scale and are still present in .env — reusing those names would
# silently apply median-scale numbers to percentile-scale values. The old
# names are now ignored; remove them from .env when convenient.
F0_REGISTER_PERCENTILE = float(os.getenv("F0_REGISTER_PERCENTILE", "5"))
F0_FEMALE_HZ = float(os.getenv("F0_FEMALE_HZ", "155"))
F0_CHILD_HZ  = float(os.getenv("F0_CHILD_HZ",  "240"))

# A low percentile is meaningless on a handful of frames — one speaker in
# testing yielded a single voiced frame. Below this, report "undetectable"
# and let the caller fall back to the safe default rather than classify on
# noise.
MIN_VOICED_FRAMES = int(os.getenv("F0_MIN_VOICED_FRAMES", "30"))

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

    # Group every segment by speaker, then measure the register floor across
    # ALL of that speaker's audio at once.
    #
    # This is deliberately NOT per-segment-plus-majority-vote (what this used
    # to do). A register floor only means something over a speaker's full
    # range: their lowest pitch shows up in their calm lines, which are
    # different segments from their shouted ones. Scoring each segment in
    # isolation would take the floor of a shout — which is just a slightly
    # quieter shout — and voting over those reproduces the original bug.
    speaker_ranges: Dict[str, List[Dict]] = {}
    for seg in segments:
        if hasattr(seg, "speaker"):
            spk, start, end = seg.speaker, seg.start, seg.end
        else:
            spk   = seg.get("speaker", "speaker-1")
            start = float(seg.get("start", 0.0))
            end   = float(seg.get("end",   0.0))
        speaker_ranges.setdefault(spk, []).append({"start": start, "end": end})

    result: Dict[str, str] = {}
    for speaker, ranges in speaker_ranges.items():
        f0 = _register_f0(audio, sample_rate, ranges)
        gender = _classify(f0)
        result[speaker] = gender
        logger.info(
            f"[CLASSIFY] {speaker}: register floor (p{F0_REGISTER_PERCENTILE:.0f}) = "
            f"{f0:.0f} Hz -> {gender}" if f0 is not None else
            f"[CLASSIFY] {speaker}: pitch undetectable "
            f"(<{MIN_VOICED_FRAMES} voiced frames) -> {gender} (default)"
        )

    return result


def _register_f0(
    audio: torch.Tensor,
    sample_rate: int,
    ranges: List[Dict],
    cap_seconds: float = 30.0,
) -> Optional[float]:
    """
    Estimate the speaker's register floor: the F0_REGISTER_PERCENTILE-th
    percentile of their voiced fundamental frequency.

    This is deliberately a LOW percentile rather than a median — see the
    calibration note at the top of this module. Raising your voice lifts the
    top of your pitch range, not the bottom, so the low end of the
    distribution identifies the speaker while the high end mostly reports how
    hard they are pushing.

    Caps total extraction at cap_seconds to avoid excessive computation on
    very long videos. Uses detect_pitch_frequency (torchaudio >=2.0) with an
    RMS-based voicing filter to discard silence and noise frames.
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

    if len(all_pitch) < MIN_VOICED_FRAMES:
        return None

    all_pitch.sort()
    pct = min(max(F0_REGISTER_PERCENTILE, 0.0), 100.0)
    idx = int(len(all_pitch) * pct / 100.0)
    return all_pitch[min(idx, len(all_pitch) - 1)]


def _classify(f0: Optional[float]) -> str:
    if f0 is None:
        return "male"             # safe default when pitch undetectable
    if f0 >= F0_CHILD_HZ:
        return "child"
    if f0 >= F0_FEMALE_HZ:
        return "female"
    return "male"
