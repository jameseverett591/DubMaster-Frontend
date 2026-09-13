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
        plus optional speaker_id (from Tencent) and words (word timestamps).
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
                # Rule B + high confidence: use Paraformer text, Tencent timestamps.
                # Only keep word timestamps if they came from the same source as the text.
                merged.append({
                    "start": t_seg["start"],       # Rule C: Tencent timestamps
                    "end": t_seg["end"],
                    "text": best_match["text"],    # Rule B: Paraformer text
                    "confidence": p_conf,
                    "source": "paraformer+tencent_ts",
                    "speaker_id": t_seg.get("speaker_id"),
                    "words": best_match.get("words"),
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
                    "speaker_id": t_seg.get("speaker_id"),
                    "words": t_seg.get("words"),
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
                "speaker_id": t_seg.get("speaker_id"),
                "words": t_seg.get("words"),
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
                "words": p_seg.get("words"),
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


_HOMOPHONE_FOLD = str.maketrans({"她": "他", "它": "他", "牠": "他", "妳": "你", "祂": "他"})


def _text_shared_run(a: str, b: str, min_len: int = 4) -> bool:
    """True when the two texts share a contiguous run of >= min_len characters.

    A cheap stand-in for edit distance that matches the observed failure: the
    same phrase transcribed twice from two overlapping utterances, each with
    a different lead-in/tail. 要是怕她輸 vs 要是怕他輸我讓他單手 share 要是怕
    (3) + 輸 — homophone drift breaks exact-substring tests, so the run is
    checked on both strings' substrings rather than containment.
    """
    # 他/她/它 and 你/妳 are the same sound — the ASR picks one at random per
    # utterance, so the two copies of a line routinely differ only there.
    a = re.sub(r"\s+", "", a).translate(_HOMOPHONE_FOLD)
    b = re.sub(r"\s+", "", b).translate(_HOMOPHONE_FOLD)
    if len(a) < min_len or len(b) < min_len:
        return a == b
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    for i in range(len(shorter) - min_len + 1):
        if shorter[i:i + min_len] in longer:
            return True
    return False


def _shared_boundary_run(prev_text: str, next_text: str, min_len: int = 4) -> int:
    """How many leading characters of next_text repeat the END of prev_text.

    Deepgram utterances that overlap by a fraction of a second each carry the
    words in the overlap — the phrase 要是怕他輸 came out as the tail of one
    utterance AND the head of the next (…你要是怕她輸 | 要是怕他輸我讓他單手…),
    was translated twice, and was voiced twice. The time overlap (0.65s of a
    6s utterance) is far too small for a ratio test to see, so the join is
    checked on TEXT: the longest suffix of prev that is a prefix of next,
    homophone-folded (她/他). Returns the count of next_text chars to drop
    (whitespace inside the run included), or 0.
    """
    a = re.sub(r"\s+", "", prev_text).translate(_HOMOPHONE_FOLD)
    b_stripped = re.sub(r"\s+", "", next_text).translate(_HOMOPHONE_FOLD)
    best = 0
    for k in range(min(len(a), len(b_stripped)), min_len - 1, -1):
        if a.endswith(b_stripped[:k]):
            best = k
            break
    if not best:
        return 0
    # Map the folded/stripped count back onto next_text's real indices.
    seen = 0
    for i, ch in enumerate(next_text):
        if not ch.isspace():
            seen += 1
        if seen == best:
            return i + 1
    return len(next_text)


def _drop_leading_words(words: List[Dict], n_chars: int) -> List[Dict]:
    """Drop leading word alignments covering roughly the first n_chars."""
    out = list(words or [])
    covered = 0
    while out and covered < n_chars:
        covered += len(re.sub(r"\s+", "", out[0].get("word", "")))
        out.pop(0)
    return out


def _same_speaker(a: Dict, b: Dict) -> bool:
    sa, sb = a.get("speaker"), b.get("speaker")
    # Unlabelled segments (pre-diarization) are treated as same-speaker: the
    # duplicates being removed here come from the ASR engine, not diarization.
    return sa is None or sb is None or sa == sb


def _deduplicate_segments(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Remove duplicate segments that overlap heavily with identical/similar text.

    Two failure shapes, both observed on a Deepgram + Speechmatics job, and
    they need OPPOSITE treatment:

      DUPLICATE — the same words transcribed twice. Identical text within
        0.5s, or same speaker + >50% time overlap + a shared phrase (the same
        line caught by two overlapping utterances, each with its own lead-in:
        要是怕她輸 / 要是怕他輸我讓他單手). Keep the longer text — it is the
        more complete transcription — and drop the other.

      MIS-TIMESTAMPED SPLIT — one line emitted as two utterances stamped with
        the same start, DIFFERENT consecutive text (打什麼打你當我家是武館 /
        進來打打殺殺馬上請 at 23.43 twice). These are not duplicates: dropping
        either loses real dialogue. Concatenate in emission order instead, so
        the translator sees the whole line.

    The old rule dropped anything with >80% overlap regardless of text — right
    for two engines covering one span, wrong for one engine mis-stamping two
    halves of a line. Input must be sorted by start (stable, so equal starts
    keep emission order).
    """
    if len(segments) <= 1:
        return segments

    def _keep_better(a: Dict, b: Dict) -> Dict:
        ta, tb = a.get("text", "").strip(), b.get("text", "").strip()
        if len(tb) != len(ta):
            return b if len(tb) > len(ta) else a
        return b if b.get("confidence", 0) > a.get("confidence", 0) else a

    deduped = [segments[0]]

    for seg in segments[1:]:
        prev = deduped[-1]
        overlap = _segments_overlap(prev, seg)
        same_spk = _same_speaker(prev, seg)
        p_text, s_text = prev.get("text", "").strip(), seg.get("text", "").strip()
        same_text = p_text == s_text
        shared = same_text or _text_shared_run(p_text, s_text)
        near_start = abs(seg["start"] - prev["start"]) < 0.15

        is_dup = (
            (abs(seg["start"] - prev["start"]) < 0.5 and same_text)
            or (overlap > 0.8 and shared)
            or (same_spk and overlap > 0.5 and shared)
        )
        is_split = same_spk and not shared and (near_start or overlap > 0.8)

        # Adjacent utterances that repeat a phrase at the join. Not a
        # duplicate (most of each is unique) and not a split (they are
        # already consecutive): trim the repeated run off the head of the
        # later one. Only for touching/overlapping neighbours — a phrase
        # genuinely said twice seconds apart must stay.
        if not is_dup and not is_split and same_spk and seg["start"] - prev["end"] < 0.3:
            cut = _shared_boundary_run(p_text, s_text)
            if cut:
                trimmed = dict(seg)
                trimmed["text"] = s_text[cut:].lstrip()
                if seg.get("words"):
                    trimmed["words"] = _drop_leading_words(seg["words"], cut)
                logger.info(
                    f"[ASR-DEDUP] trim [{seg['start']:.2f}] repeated '{s_text[:cut]}' "
                    f"at join with '{p_text[-12:]}' → '{trimmed['text'][:30]}'"
                )
                if trimmed["text"]:
                    deduped.append(trimmed)
                continue

        if is_dup:
            winner = dict(_keep_better(prev, seg))
            logger.info(
                f"[ASR-DEDUP] dup [{prev['start']:.2f}-{prev['end']:.2f}] '{p_text[:24]}' "
                f"vs [{seg['start']:.2f}-{seg['end']:.2f}] '{s_text[:24]}' "
                f"(overlap={overlap:.2f}) → kept '{winner.get('text','')[:24]}'"
            )
        elif is_split:
            winner = dict(prev)
            winner["text"] = (p_text + " " + s_text).strip() if _has_cjk(p_text) is False else p_text + s_text
            winner["words"] = list(prev.get("words") or []) + list(seg.get("words") or [])
            if seg.get("confidence") is not None and prev.get("confidence") is not None:
                winner["confidence"] = min(prev["confidence"], seg["confidence"])
            logger.info(
                f"[ASR-DEDUP] rejoin [{prev['start']:.2f}] '{p_text[:20]}' + '{s_text[:20]}' "
                f"(same start, different text) → '{winner['text'][:40]}'"
            )
        else:
            deduped.append(seg)
            continue

        # Survivor covers the audio both segments claimed.
        winner["start"] = min(prev["start"], seg["start"])
        winner["end"] = max(prev["end"], seg["end"])
        deduped[-1] = winner

    return deduped


def deduplicate_segments(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Public entry: sort by start, then remove duplicates."""
    ordered = sorted(segments, key=lambda s: s["start"])
    result = _deduplicate_segments(ordered)
    if len(result) != len(ordered):
        logger.info(f"[ASR-DEDUP] {len(ordered)} segments -> {len(result)} after dedup")
    return result


def fill_gaps_with_fallbacks(
    primary_segments: List[Dict[str, Any]],
    fallback_segments: List[Dict[str, Any]],
    job_id: str | None = None,
) -> List[Dict[str, Any]]:
    """Add fallback segments that do not overlap the primary segments.

    Tencent/Paraformer/Whisper segments are only added where the primary
    (Deepgram) left a gap, so the primary transcript is never overwritten
    by a weaker engine.

    Gap-filled segments are stamped `gap_filled=True`: the primary engine
    found nothing there (usually fight-scene noise, music, or shouting —
    the audio stretch where hallucination risk is highest), and the
    fallback's self-reported confidence is not calibrated against the
    primary's. Translation marks them translation_flagged so a fabricated
    line can't reach the dub unreviewed.
    """
    if not fallback_segments:
        return primary_segments
    if not primary_segments:
        return fallback_segments

    result = list(primary_segments)
    for fb in fallback_segments:
        if not (fb.get("text") or "").strip():
            continue
        has_overlap = any(
            _segments_overlap(fb, p) > _OVERLAP_THRESHOLD
            for p in result
        )
        if not has_overlap:
            filled = dict(fb)
            filled["gap_filled"] = True
            result.append(filled)

    result.sort(key=lambda s: s["start"])
    return result


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
            w_seg_copy["gap_filled"] = True
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
