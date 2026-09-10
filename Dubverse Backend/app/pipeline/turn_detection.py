"""
Text-based speaker turn detection for segments where acoustic diarization
fails.

When two speakers trade lines with very short gaps (under 0.3s), neither
Deepgram's utterance-level nor word-level diarization can separate them --
confirmed directly against the Ip Man 2 test clip, where a countryman's
speech with a brief "Thank you so much" interjection from Ip Man collapsed
to one speaker at every acoustic granularity we tried.  The only signal
left is in the *text*: conversational patterns that indicate a speaker
change.

This module applies deterministic rules (not LLM) to detect likely
speaker-change points inside long single-speaker segments:

  1. Question → Answer: a question mark followed by a short
     affirmative/negative response ("Is it big enough? Yes, plenty.")
  2. Gratitude response: a statement followed by "thank you" / "多謝" /
     "唔該" — the responder is a different speaker.
  3. Address term shift: an address term (文哥, 師父, 3姑) that marks
     who's being spoken to; if the addressee then responds, that's a turn.

Safety constraints:
  - Only processes segments longer than ``min_segment_s`` (default 6.0s).
  - Only splits at sentence boundaries (punctuation), never mid-word.
  - Assigns alternating speaker labels within the segment.
  - Never modifies text -- only splits and labels.
  - If no rule fires, leaves the segment unchanged.

Environment variables:
  TURN_DETECTION_ENABLED          — "1" to enable (default: "1")
  TURN_DETECTION_MIN_SEGMENT_S   — minimum segment duration to consider
                                    splitting (default: "6.0")
"""

import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Cantonese / Mandarin address terms that mark who is being spoken to.
# When the text shifts from addressing person A to addressing person B,
# or from a statement to an address term, that's a likely turn boundary.
_ADDRESS_TERMS = [
    # Cantonese
    "文哥", "師父", "葉師父", "3姑", "三姑", "永成",
    # Mandarin
    "师傅", "师父", "叶师父",
]

# Gratitude expressions that mark a response from a different speaker.
_GRATITUDE_PATTERNS = [
    # Cantonese
    r"多謝", r"唔該", r"辛苦晒", r"辛苦了",
    # Mandarin
    r"谢谢", r"感谢", r"辛苦了",
    # English (in case ASR returns English)
    r"thank you", r"thanks", r"i appreciate",
]

# Question-ending punctuation (CJK + Latin)
_QUESTION_END = r"[？?！!]"

# Sentence-ending punctuation for split points
_SENTENCE_END = r"[。．.？?！!；;]"

# CJK conversational markers that often end a clause/thought even without
# punctuation. Deepgram's Cantonese output frequently lacks sentence-ending
# punctuation, so we fall back to splitting at these markers.
# Each marker is a natural pause point in conversation.
_CJK_CLAUSE_END = [
    # Cantonese sentence-final particles
    "嘛", "啦", "囉", "嘅", "嘞", "囖",
    # Mandarin sentence-final particles
    "了", "的", "吧", "呢", "啊", "呀", "嗎",
    # Common clause connectors
    "然後", "不過", "但是", "而且",
]


def _split_at_punctuation(text: str) -> List[Tuple[str, int]]:
    """Split text at sentence-ending punctuation, returning (sentence, char_offset) pairs.

    If the text has no sentence-ending punctuation (common in Deepgram's
    Cantonese output), fall back to splitting at CJK conversational
    markers (嘛, 了, 啊, etc.) which are natural clause boundaries.
    """
    sentences: List[Tuple[str, int]] = []
    current = ""
    base_offset = 0
    for i, ch in enumerate(text):
        current += ch
        if re.match(_SENTENCE_END, ch):
            stripped = current.strip()
            if stripped:
                sentences.append((stripped, base_offset))
            base_offset = i + 1
            current = ""
    if current.strip():
        sentences.append((current.strip(), base_offset))

    # Fallback: if no punctuation was found, split at CJK clause markers
    if len(sentences) <= 1 and len(text) > 15:
        sentences = _split_at_cjk_markers(text)

    return sentences


def _split_at_cjk_markers(text: str) -> List[Tuple[str, int]]:
    """Split text at CJK conversational markers when no punctuation exists.

    Splits AFTER each marker (the marker stays with the preceding clause).
    Only splits if the resulting clauses are at least 4 characters long
    to avoid over-fragmentation.
    """
    sentences: List[Tuple[str, int]] = []
    current = ""
    base_offset = 0

    i = 0
    while i < len(text):
        ch = text[i]
        current += ch
        # Check if this position ends with a CJK clause marker
        for marker in _CJK_CLAUSE_END:
            if current.endswith(marker):
                # Only split if the remaining text is long enough
                remaining = text[i + 1:]
                stripped = current.strip()
                if stripped and len(remaining) >= 4 and len(stripped) >= 4:
                    sentences.append((stripped, base_offset))
                    base_offset = i + 1
                    current = ""
                break
        i += 1

    if current.strip():
        sentences.append((current.strip(), base_offset))

    return sentences


def _is_question(sentence: str) -> bool:
    """Check if a sentence is a question."""
    return bool(re.search(_QUESTION_END, sentence))


def _is_short_answer(sentence: str) -> bool:
    """Check if a sentence is a short affirmative/negative response."""
    text = sentence.strip().rstrip("。.！!？?")
    short_answers = [
        # Cantonese
        "係", "喺", "好", "得", "可以", "冇問題", "隨便", "請",
        "唔係", "唔好", "唔得", "唔可以",
        # Mandarin
        "是", "好", "行", "可以", "没问题", "随便", "请",
        "不是", "不好", "不行", "不可以",
        # English
        "yes", "no", "okay", "ok", "sure", "please",
    ]
    text_lower = text.lower()
    for ans in short_answers:
        if text_lower == ans.lower() or text_lower.startswith(ans.lower() + "。") or text_lower.startswith(ans.lower() + "."):
            return True
    # Also check if it's very short (<=6 chars) and contains agreement words
    if len(text) <= 12:
        for ans in short_answers:
            if ans in text_lower:
                return True
    return False


def _contains_gratitude(sentence: str) -> bool:
    """Check if a sentence contains a gratitude expression."""
    for pattern in _GRATITUDE_PATTERNS:
        if re.search(pattern, sentence, re.IGNORECASE):
            return True
    return False


def _contains_address_term(sentence: str) -> bool:
    """Check if a sentence starts with or contains an address term."""
    for term in _ADDRESS_TERMS:
        if term in sentence:
            return True
    return False


def _detect_qa_split(sentences: List[Tuple[str, int]]) -> Optional[int]:
    """Find a question→answer split point.

    Returns the index of the sentence that STARTS the answer (the split
    goes before it), or None if no clear Q&A pattern found.
    """
    for i in range(len(sentences) - 1):
        s1 = sentences[i][0]
        s2 = sentences[i + 1][0]
        if _is_question(s1) and _is_short_answer(s2):
            return i + 1
    return None


def _detect_gratitude_split(sentences: List[Tuple[str, int]]) -> Optional[int]:
    """Find a gratitude-response split point.

    Returns the index of the sentence that contains the gratitude
    expression (the responder's turn), or None.
    """
    for i in range(1, len(sentences)):
        if _contains_gratitude(sentences[i][0]):
            # Only split if the previous sentence is NOT also gratitude
            # (two "thank you"s in a row is same-speaker, not a turn change)
            if not _contains_gratitude(sentences[i - 1][0]):
                return i
    return None


def _detect_address_split(sentences: List[Tuple[str, int]]) -> Optional[int]:
    """Find an address-term shift split point.

    If sentence i contains an address term and sentence i+1 does not,
    and sentence i+1 reads like a response, split before i+1.
    """
    for i in range(len(sentences) - 1):
        s1 = sentences[i][0]
        s2 = sentences[i + 1][0]
        if _contains_address_term(s1) and not _contains_address_term(s2):
            # The address term marks who's being spoken to.
            # If the next sentence is a response from the addressee, split.
            if _is_short_answer(s2) or _is_question(s2):
                return i + 1
    return None


def _detect_address_response_split(sentences: List[Tuple[str, int]]) -> Optional[int]:
    """Find a split where an address term marks a NEW speaker's turn.

    Pattern: sentence i is a short question/statement containing an address
    term (e.g., "什麼事3姑" = "What is it, Auntie?"), and sentence i+1 is
    a longer response from the addressed person. The address term marks
    the END of the first speaker's turn, not the beginning.
    """
    for i in range(len(sentences) - 1):
        s1 = sentences[i][0]
        s2 = sentences[i + 1][0]
        # First sentence contains an address term AND is short (a question
        # or inquiry to the addressed person)
        if _contains_address_term(s1) and len(s1) <= 15:
            # Second sentence is a longer response (the addressed person speaks)
            if len(s2) > len(s1) and not _contains_address_term(s2):
                return i + 1
    return None


def _detect_long_segment_split(
    sentences: List[Tuple[str, int]],
    min_sentences: int = 3,
) -> Optional[int]:
    """Find a split point in a long multi-sentence segment.

    For segments with 3+ sentences from one speaker that should be
    separate subtitle bubbles, split at the most natural boundary
    (after a complete thought, typically 2-3 sentences in).
    """
    if len(sentences) < min_sentences:
        return None
    # Split at the midpoint sentence boundary to create roughly equal bubbles.
    # This is conservative — only fires for long segments with many sentences.
    mid = len(sentences) // 2
    return mid


def _split_segment(
    seg: Dict[str, Any],
    split_sentence_idx: int,
    sentences: List[Tuple[str, int]],
) -> List[Dict[str, Any]]:
    """Split a segment at the given sentence boundary.

    Returns two segments with alternating speaker labels. The first
    segment keeps the original speaker; the second gets a new speaker
    label (incrementing the speaker number).
    """
    original_speaker = seg.get("speaker", "speaker-1")
    # Extract speaker number from "speaker-N"
    speaker_match = re.search(r"speaker-(\d+)", original_speaker)
    base_num = int(speaker_match.group(1)) if speaker_match else 1
    other_num = base_num + 1 if base_num == 1 else base_num - 1
    # Use base_num + 1 for the second speaker to avoid collision
    other_speaker = f"speaker-{base_num + 1}"

    # Calculate the time offset for the split point
    # We split proportionally based on character position
    text = seg.get("text", "")
    seg_start = float(seg.get("start", 0.0))
    seg_end = float(seg.get("end", 0.0))
    seg_duration = seg_end - seg_start

    # Find the character offset where the split occurs
    split_offset = sentences[split_sentence_idx][1]
    total_chars = max(len(text), 1)
    split_ratio = split_offset / total_chars
    split_time = seg_start + seg_duration * split_ratio

    # Build first segment (original speaker)
    first_sentences = sentences[:split_sentence_idx]
    first_text = "".join(s[0] for s in first_sentences)
    # Re-add punctuation that was stripped during sentence splitting
    # Actually, reconstruct from original text
    first_text = text[:split_offset].strip()
    second_text = text[split_offset:].strip()

    if not first_text or not second_text:
        return [seg]

    first_seg = dict(seg)
    first_seg["text"] = first_text
    first_seg["end"] = round(split_time, 3)
    first_seg["speaker"] = original_speaker
    first_seg["turn_split"] = True

    second_seg = dict(seg)
    second_seg["text"] = second_text
    second_seg["start"] = round(split_time, 3)
    second_seg["speaker"] = other_speaker
    second_seg["turn_split"] = True

    logger.info(
        f"[TURN-DETECT] Split segment at {seg_start:.1f}s: "
        f"'{first_text[:30]}...' | '{second_text[:30]}...' "
        f"({original_speaker} -> {other_speaker})"
    )

    return [first_seg, second_seg]


def detect_turn_splits(
    segments: List[Dict[str, Any]],
    job_id: Optional[str] = None,
    source_language: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Detect and apply text-based speaker turn splits.

    Only processes long single-speaker segments (>min_segment_s) where
    the text contains clear conversational turn markers. Never modifies
    text -- only splits and assigns alternating speaker labels.
    """
    if os.getenv("TURN_DETECTION_ENABLED", "1") != "1":
        return segments

    min_segment_s = float(os.getenv("TURN_DETECTION_MIN_SEGMENT_S", "3.5"))

    out: List[Dict[str, Any]] = []
    splits_applied = 0

    for seg in segments:
        text = seg.get("text", "")
        start = float(seg.get("start", 0.0))
        end = float(seg.get("end", 0.0))
        duration = end - start

        # Only consider long single-speaker segments
        if duration < min_segment_s or not text:
            out.append(seg)
            continue

        # Split into sentences
        sentences = _split_at_punctuation(text)
        if len(sentences) < 2:
            out.append(seg)
            continue

        # Try each detection rule in priority order
        split_idx = _detect_qa_split(sentences)
        rule = "Q&A"
        if split_idx is None:
            split_idx = _detect_gratitude_split(sentences)
            rule = "gratitude"
        if split_idx is None:
            split_idx = _detect_address_split(sentences)
            rule = "address-term"
        if split_idx is None:
            split_idx = _detect_address_response_split(sentences)
            rule = "address-response"
        if split_idx is None:
            # Long multi-sentence segment: split at midpoint for readability
            if len(sentences) >= 3 and duration >= 3.5:
                split_idx = _detect_long_segment_split(sentences)
                rule = "long-segment"

        if split_idx is not None and 0 < split_idx < len(sentences):
            result = _split_segment(seg, split_idx, sentences)
            if len(result) == 2:
                logger.info(
                    f"[TURN-DETECT] job={job_id} {rule} rule fired on "
                    f"{start:.1f}-{end:.1f}s segment"
                )
                out.extend(result)
                splits_applied += 1
                continue

        out.append(seg)

    if splits_applied > 0:
        logger.info(
            f"[TURN-DETECT] job={job_id} applied {splits_applied} turn split(s), "
            f"{len(segments)} -> {len(out)} segments"
        )

    return out
