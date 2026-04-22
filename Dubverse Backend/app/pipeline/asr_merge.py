"""
ASR Merge Engine — combines Tencent ASR (high recall) with Paraformer (high precision).

Merge rules:
  A. Tencent finds speech, Paraformer doesn't → keep Tencent (higher recall)
  B. Both find speech at overlapping times → prefer Paraformer text (higher precision)
  C. Timestamps differ → use Tencent timestamps (more stable segmentation)
  D. Paraformer confidence < 0.6 → fallback to Tencent text

The merge produces a unified segment list that captures the best of both engines.
"""

import logging
import re
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

# CJK character pattern for validation
_CJK_RE = re.compile(r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]')

# Overlap threshold: segments overlap if their intersection is > this fraction
# of the shorter segment's duration
_OVERLAP_THRESHOLD = 0.3

# Minimum Paraformer confidence to prefer its text over Tencent's
_PARAFORMER_CONFIDENCE_THRESHOLD = 0.6


def _segments_overlap(seg_a: Dict, seg_b: Dict) -> float:
    """
    Return the overlap ratio between two segments.
    Ratio = intersection / min(duration_a, duration_b).
    Returns 0.0 if no overlap.
    """
    start = max(seg_a["start"], seg_b["start"])
    end = min(seg_a["end"], seg_b["end"])
    intersection = max(0.0, end - start)

    dur_a = max(seg_a["end"] - seg_a["start"], 0.001)
    dur_b = max(seg_b["end"] - seg_b["start"], 0.001)
    min_dur = min(dur_a, dur_b)

    return intersection / min_dur


def _has_cjk(text: str) -> bool:
    """Check if text contains CJK characters."""
    return bool(_CJK_RE.search(text))


def _cjk_ratio(text: str) -> float:
    """Return fraction of non-space characters that are CJK."""
    non_space = re.findall(r'\S', text)
    if not non_space:
        return 0.0
    cjk_count = len(_CJK_RE.findall(text))
    return cjk_count / len(non_space)


def merge_asr_results(
    tencent_segments: List[Dict[str, Any]],
    paraformer_segments: List[Dict[str, Any]],
    source_language: str = "yue",
    job_id: str | None = None,
) -> List[Dict[str, Any]]:
    """
    Merge Tencent ASR and Paraformer results into a unified segment list.

    Input:
        tencent_segments: Segments from Tencent ASR (high recall)
        paraformer_segments: Segments from Paraformer (high precision)
        source_language: Language code for CJK validation
        job_id: For logging

    Output:
        Merged list of segments, sorted by start time.
        Each segment has: start, end, text, confidence, source
    """
    is_cjk_lang = source_language in {"zh", "yue", "ja", "ko", "cmn"}

    # Filter out garbage from both sources
    tencent_clean = _filter_garbage(tencent_segments, is_cjk_lang, "tencent")
    paraformer_clean = _filter_garbage(paraformer_segments, is_cjk_lang, "paraformer")

    logger.info(
        f"[ASR-MERGE] Input: tencent={len(tencent_clean)} segments, "
        f"paraformer={len(paraformer_clean)} segments (job={job_id})"
    )

    if not tencent_clean and not paraformer_clean:
        logger.warning("[ASR-MERGE] Both engines returned empty — no segments")
        return []

    if not tencent_clean:
        logger.info("[ASR-MERGE] Using Paraformer only (no Tencent results)")
        return paraformer_clean

    if not paraformer_clean:
        logger.info("[ASR-MERGE] Using Tencent only (no Paraformer results)")
        return tencent_clean

    # Build merged output
    merged: List[Dict[str, Any]] = []
    used_paraformer: set = set()  # indices of paraformer segments already merged

    for t_seg in tencent_clean:
        best_match = None
        best_overlap = 0.0
        best_idx = -1

        # Find the best overlapping Paraformer segment
        for p_idx, p_seg in enumerate(paraformer_clean):
            if p_idx in used_paraformer:
                continue
            overlap = _segments_overlap(t_seg, p_seg)
            if overlap > best_overlap:
                best_overlap = overlap
                best_match = p_seg
                best_idx = p_idx

        if best_match and best_overlap >= _OVERLAP_THRESHOLD:
            # Rule B: Both found speech — merge
            used_paraformer.add(best_idx)

            p_conf = best_match.get("confidence", 0.0)

            if p_conf >= _PARAFORMER_CONFIDENCE_THRESHOLD:
                # Rule B + high confidence: use Paraformer text, Tencent timestamps
                merged.append({
                    "start": t_seg["start"],       # Rule C: Tencent timestamps
                    "end": t_seg["end"],
                    "text": best_match["text"],    # Rule B: Paraformer text
                    "confidence": p_conf,
                    "source": "paraformer+tencent_ts",
                })
                logger.debug(
                    f"[ASR-MERGE] Merged (paraformer text): "
                    f"{t_seg['start']:.1f}-{t_seg['end']:.1f} "
                    f"'{best_match['text'][:30]}' (conf={p_conf:.2f})"
                )
            else:
                # Rule D: Low Paraformer confidence — use Tencent text
                merged.append({
                    "start": t_seg["start"],
                    "end": t_seg["end"],
                    "text": t_seg["text"],
                    "confidence": t_seg.get("confidence", 0.0),
                    "source": "tencent_fallback",
                })
                logger.debug(
                    f"[ASR-MERGE] Fallback to Tencent (low paraformer conf={p_conf:.2f}): "
                    f"{t_seg['start']:.1f}-{t_seg['end']:.1f} '{t_seg['text'][:30]}'"
                )
        else:
            # Rule A: Only Tencent found speech — keep it
            merged.append({
                "start": t_seg["start"],
                "end": t_seg["end"],
                "text": t_seg["text"],
                "confidence": t_seg.get("confidence", 0.0),
                "source": "tencent_only",
            })
            logger.debug(
                f"[ASR-MERGE] Tencent only: "
                f"{t_seg['start']:.1f}-{t_seg['end']:.1f} '{t_seg['text'][:30]}'"
            )

    # Add Paraformer-only segments (not matched to any Tencent segment)
    for p_idx, p_seg in enumerate(paraformer_clean):
        if p_idx not in used_paraformer:
            merged.append({
                "start": p_seg["start"],
                "end": p_seg["end"],
                "text": p_seg["text"],
                "confidence": p_seg.get("confidence", 0.0),
                "source": "paraformer_only",
            })
            logger.debug(
                f"[ASR-MERGE] Paraformer only: "
                f"{p_seg['start']:.1f}-{p_seg['end']:.1f} '{p_seg['text'][:30]}'"
            )

    # Sort by start time and deduplicate
    merged.sort(key=lambda s: s["start"])
    merged = _deduplicate_segments(merged)

    # Log summary
    sources = {}
    for seg in merged:
        src = seg.get("source", "unknown")
        sources[src] = sources.get(src, 0) + 1

    logger.info(
        f"[ASR-MERGE] Output: {len(merged)} segments "
        f"(sources: {sources}, job={job_id})"
    )

    return merged


def _filter_garbage(
    segments: List[Dict[str, Any]],
    is_cjk_lang: bool,
    source: str,
) -> List[Dict[str, Any]]:
    """Remove garbage/hallucination segments."""
    filtered = []
    for seg in segments:
        text = seg.get("text", "").strip()
        if not text:
            continue
        if len(text) <= 1:
            continue

        # For CJK languages, require at least 30% CJK characters
        if is_cjk_lang:
            ratio = _cjk_ratio(text)
            if ratio < 0.3 and len(text) > 2:
                logger.debug(
                    f"[ASR-MERGE] Filtered garbage from {source}: "
                    f"'{text[:40]}' (CJK ratio={ratio:.0%})"
                )
                continue

        # Reject very short segments with no real content
        duration = seg.get("end", 0) - seg.get("start", 0)
        if duration > 0 and duration < 0.1:
            continue

        filtered.append(seg)

    return filtered


def _deduplicate_segments(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Remove duplicate segments that overlap heavily with identical/similar text."""
    if len(segments) <= 1:
        return segments

    deduped = [segments[0]]

    for seg in segments[1:]:
        prev = deduped[-1]

        # Check if this segment is a duplicate of the previous one
        overlap = _segments_overlap(prev, seg)
        if overlap > 0.8:
            # Nearly identical timing — keep the one with higher confidence
            if seg.get("confidence", 0) > prev.get("confidence", 0):
                deduped[-1] = seg
            continue

        # Check for near-identical text at similar times
        if (
            abs(seg["start"] - prev["start"]) < 0.5
            and seg["text"].strip() == prev["text"].strip()
        ):
            continue

        deduped.append(seg)

    return deduped


def merge_with_whisper_fallback(
    merged_segments: List[Dict[str, Any]],
    whisper_segments: List[Dict[str, Any]],
    job_id: str | None = None,
) -> List[Dict[str, Any]]:
    """
    Optional: fill gaps in merged results with Whisper segments.
    Use this when Tencent/Paraformer miss segments that Whisper caught.
    Only adds Whisper segments that don't overlap with existing merged results.
    """
    if not whisper_segments:
        return merged_segments
    if not merged_segments:
        return whisper_segments

    result = list(merged_segments)

    for w_seg in whisper_segments:
        # Check if any merged segment overlaps this Whisper segment
        has_overlap = any(
            _segments_overlap(w_seg, m_seg) > _OVERLAP_THRESHOLD
            for m_seg in result
        )
        if not has_overlap:
            w_seg_copy = dict(w_seg)
            w_seg_copy["source"] = "whisper_gap_fill"
            result.append(w_seg_copy)
            logger.debug(
                f"[ASR-MERGE] Whisper gap fill: "
                f"{w_seg['start']:.1f}-{w_seg['end']:.1f} '{w_seg['text'][:30]}'"
            )

    result.sort(key=lambda s: s["start"])
    return result


def merge_whisper_paraformer(
    whisper_segments: List[Dict[str, Any]],
    paraformer_segments: List[Dict[str, Any]],
    source_language: str = "yue",
    job_id: str | None = None,
) -> List[Dict[str, Any]]:
    """Merge Whisper + Paraformer without Tencent.

    Use Whisper's segmentation/timestamps as the base (typically higher quality
    phrase boundaries), but swap in Paraformer text when it overlaps strongly
    and has sufficient confidence.
    """
    is_cjk_lang = source_language in {"zh", "yue", "ja", "ko", "cmn"}

    whisper_clean = _filter_garbage(whisper_segments, is_cjk_lang, "whisper")
    paraformer_clean = _filter_garbage(paraformer_segments, is_cjk_lang, "paraformer")

    logger.info(
        f"[ASR-MERGE] Whisper+Paraformer input: whisper={len(whisper_clean)} segments, "
        f"paraformer={len(paraformer_clean)} segments (job={job_id})"
    )

    if not whisper_clean and not paraformer_clean:
        return []
    if not whisper_clean:
        return paraformer_clean
    if not paraformer_clean:
        return whisper_clean

    merged: List[Dict[str, Any]] = []
    used_paraformer: set[int] = set()

    for w_seg in whisper_clean:
        best_match = None
        best_overlap = 0.0
        best_idx = -1

        for p_idx, p_seg in enumerate(paraformer_clean):
            if p_idx in used_paraformer:
                continue
            overlap = _segments_overlap(w_seg, p_seg)
            if overlap > best_overlap:
                best_overlap = overlap
                best_match = p_seg
                best_idx = p_idx

        if best_match and best_overlap >= _OVERLAP_THRESHOLD:
            p_conf = float(best_match.get("confidence", 0.0) or 0.0)
            if p_conf >= _PARAFORMER_CONFIDENCE_THRESHOLD:
                used_paraformer.add(best_idx)
                merged.append({
                    "start": w_seg.get("start"),
                    "end": w_seg.get("end"),
                    "text": best_match.get("text", "") or w_seg.get("text", ""),
                    "confidence": p_conf,
                    "source": "paraformer_text_whisper_ts",
                })
                continue

        merged.append({
            "start": w_seg.get("start"),
            "end": w_seg.get("end"),
            "text": w_seg.get("text", ""),
            "confidence": float(w_seg.get("confidence", 0.0) or 0.0),
            "source": w_seg.get("source", "whisper"),
        })

    merged.sort(key=lambda s: s.get("start", 0))
    merged = _deduplicate_segments(merged)

    sources = {}
    for seg in merged:
        src = seg.get("source", "unknown")
        sources[src] = sources.get(src, 0) + 1
    logger.info(
        f"[ASR-MERGE] Whisper+Paraformer output: {len(merged)} segments "
        f"(sources: {sources}, job={job_id})"
    )

    return merged
