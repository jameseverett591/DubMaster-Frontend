"""
Confidence-gated LLM rescoring for ASR text correction.

After Deepgram produces its best guess, this pass corrects likely
transcription errors (wrong homophones, garbled characters, name
confusion) using Claude. It does NOT invent new content.

Safety design:
  1. Gate on confidence — only rescore segments below a threshold
     (default 0.7), not already-high-confidence text.
  2. Conservative correction — the prompt explicitly instructs: "fix
     likely transcription errors; if the audio content is genuinely
     ambiguous, leave the text unchanged rather than inventing new
     content."
  3. Log both versions — keep the original ASR text in
     ``original_text`` and the corrected text in ``text``, so we can
     see what changed and catch a bad correction in review.

Environment variables:
  ASR_RESCORE_ENABLED              — "1" to enable (default: "1")
  ASR_RESCORE_CONFIDENCE_THRESHOLD — only rescore below this (default: "0.7")
  ASR_RESCORE_MODEL                — Claude model (default: "claude-sonnet-4-6")
  ASR_RESCORE_TIMEOUT_SEC          — per-batch timeout (default: "30")
"""

import json
import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _get_threshold() -> float:
    return float(os.getenv("ASR_RESCORE_CONFIDENCE_THRESHOLD", "0.7"))


def _get_model() -> str:
    return os.getenv("ASR_RESCORE_MODEL", "claude-sonnet-4-6").strip() or "claude-sonnet-4-6"


def _get_timeout() -> float:
    return float(os.getenv("ASR_RESCORE_TIMEOUT_SEC", "30"))


_SYSTEM_PROMPT = """\
You are a Cantonese and Mandarin transcription corrector. You receive
ASR (automatic speech recognition) output that may contain errors from
a speech-to-text system.

Your job: fix likely transcription errors only:
  - Wrong homophones (e.g., 龍城 vs 永成)
  - Garbled or corrupted characters
  - Name confusion (wrong character for a proper name)

Critical rules:
  - If the text is genuinely ambiguous, return it UNCHANGED.
  - Do NOT invent new content that is not present in the original.
  - Do NOT add information, commentary, or context.
  - Do NOT translate — keep the same language (Cantonese/Mandarin).
  - Only fix obvious character-level errors.

Return JSON: a list of objects with "index" (0-based) and "corrected"
(the corrected text, or the original if no correction needed).
"""


def _build_user_prompt(items: List[Dict[str, Any]]) -> str:
    lines = []
    for i, item in enumerate(items):
        lines.append(f'{i}. "{item["text"]}"')
    return "Fix transcription errors in these segments. Return JSON array:\n\n" + "\n".join(lines)


def _call_claude(items: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    """Call Claude to rescore a batch of low-confidence segments.

    Returns a list of {"index": N, "corrected": "..."} dicts, or None
    on failure.
    """
    import httpx

    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        logger.warning("[RESCORE] No ANTHROPIC_API_KEY set — skipping rescoring")
        return None

    payload = {
        "model": _get_model(),
        "max_tokens": 4096,
        "temperature": 0.2,
        "system": _SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": _build_user_prompt(items)}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }

    try:
        resp = httpx.post(
            "https://api.anthropic.com/v1/messages",
            json=payload,
            headers=headers,
            timeout=_get_timeout(),
        )
        if resp.status_code != 200:
            logger.warning(
                f"[RESCORE] Claude failed: {resp.status_code} {resp.text[:200]}"
            )
            return None

        data = resp.json()
        content = data.get("content", [])
        if not content:
            return None

        text = content[0].get("text", "")
        # Parse JSON array from response
        # Claude may wrap in markdown code blocks
        text = text.strip()
        if text.startswith("```"):
            # Strip markdown code fences
            lines = text.split("\n")
            text = "\n".join(l for l in lines if not l.startswith("```"))

        result = json.loads(text)
        if isinstance(result, list):
            return result
        return None

    except json.JSONDecodeError as e:
        logger.warning(f"[RESCORE] Failed to parse Claude response: {e}")
        return None
    except Exception as e:
        logger.warning(f"[RESCORE] Claude call failed: {e}")
        return None


def rescore_segments(
    segments: List[Dict[str, Any]],
    job_id: Optional[str] = None,
    source_language: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Rescore low-confidence ASR segments using Claude.

    Only processes segments where:
      - source == "deepgram"
      - confidence < threshold (default 0.7)

    For each rescored segment:
      - text is replaced with the corrected text (if different)
      - original_text preserves the original ASR text
      - rescored flag is set to True

    If Claude returns the same text or fails, the segment is unchanged.
    """
    if os.getenv("ASR_RESCORE_ENABLED", "1") != "1":
        return segments

    threshold = _get_threshold()

    # Find low-confidence Deepgram segments
    low_conf: List[Dict[str, Any]] = []
    low_conf_indices: List[int] = []
    for i, seg in enumerate(segments):
        if seg.get("source") != "deepgram":
            continue
        conf = seg.get("confidence")
        if conf is None:
            continue
        if float(conf) < threshold:
            low_conf.append(seg)
            low_conf_indices.append(i)

    if not low_conf:
        logger.info(f"[RESCORE] job={job_id} no low-confidence segments to rescore")
        return segments

    logger.info(
        f"[RESCORE] job={job_id} rescore {len(low_conf)} low-confidence segments "
        f"(threshold={threshold})"
    )

    corrections = _call_claude(low_conf)
    if not corrections:
        logger.info(f"[RESCORE] job={job_id} no corrections returned")
        return segments

    # Build a map of index -> corrected text
    correction_map: Dict[int, str] = {}
    for c in corrections:
        idx = c.get("index")
        corrected = c.get("corrected", "")
        if idx is not None and corrected:
            correction_map[int(idx)] = corrected.strip()

    # Apply corrections
    rescored_count = 0
    for map_idx, seg_idx in enumerate(low_conf_indices):
        if map_idx not in correction_map:
            continue
        corrected = correction_map[map_idx]
        original = segments[seg_idx].get("text", "")
        if corrected and corrected != original:
            segments[seg_idx]["original_text"] = original
            segments[seg_idx]["text"] = corrected
            segments[seg_idx]["rescored"] = True
            rescored_count += 1
            logger.info(
                f"[RESCORE] job={job_id} segment {seg_idx}: "
                f"'{original[:30]}...' -> '{corrected[:30]}...'"
            )

    logger.info(
        f"[RESCORE] job={job_id} applied {rescored_count} correction(s) "
        f"out of {len(low_conf)} candidates"
    )

    return segments
