"""
LLM rescoring pass for low-confidence Cantonese/Mandarin ASR segments.

Deepgram (or any other engine in the Cantonese pipeline) occasionally
mis-hears a homophone or garbles a character run, and that error survives
untouched into translation because nothing downstream understands the
source language well enough to catch it. This module sends only the
LOW-CONFIDENCE segments -- the ones the ASR engine itself was already
unsure about -- to Claude for a conservative correction pass.

Deliberately conservative: last night's investigation found Claude's
translation step, when handed genuinely garbled Cantonese, doesn't fail --
it invents plausible-but-wrong content. A "fix errors" prompt has the exact
same failure mode if not constrained, so the prompt explicitly instructs
Claude to leave ambiguous text untouched rather than guess. Original text is
always preserved (never overwritten) so a bad correction is visible and
reversible, not silently shipped.

Uses the same [[SEG-xxxxxx]] marker + validate-1:1 mechanism as
translation_service.py (via the shared instance) so a merged, dropped, or
reordered line is treated as a hard failure -- this batch is left
unrescored -- rather than risking a silent text/segment desync.
"""

import logging
import os
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

_API_URL = "https://api.anthropic.com/v1/messages"

_LANG_NAMES = {
    "yue": "Cantonese", "zh-yue": "Cantonese", "yue-hk": "Cantonese", "zh-hk": "Cantonese",
    "zh": "Mandarin Chinese", "zh-cn": "Mandarin Chinese", "zh-tw": "Mandarin Chinese",
}


def _is_enabled() -> bool:
    return os.getenv("ASR_RESCORE_ENABLED", "1").strip() == "1"


def _confidence_threshold() -> float:
    try:
        return float(os.getenv("ASR_RESCORE_CONFIDENCE_THRESHOLD", "0.7"))
    except ValueError:
        return 0.7


def _model() -> str:
    return os.getenv("ASR_RESCORE_MODEL", "claude-sonnet-4-6").strip() or "claude-sonnet-4-6"


def _timeout_sec() -> float:
    try:
        return float(os.getenv("ASR_RESCORE_TIMEOUT_SEC", "60"))
    except ValueError:
        return 60.0


def _build_prompt(lang_name: str, marked_lines: str) -> str:
    return (
        f"These are spoken {lang_name} lines from an ASR system that flagged each one as "
        f"LOW CONFIDENCE -- it was already unsure about the exact wording.\n\n"
        f"Your job is ONLY to fix likely transcription errors: wrong homophones, "
        f"garbled or dropped characters, an obviously mis-heard word given the "
        f"surrounding context.\n\n"
        f"Rules:\n"
        f"- If a line's content is genuinely ambiguous, or you are not clearly confident "
        f"about a specific correction, return that line EXACTLY UNCHANGED. Do not guess. "
        f"Do not invent words to fill a gap.\n"
        f"- Do NOT translate. Output stays in the original language.\n"
        f"- Do NOT merge, split, drop, or reorder lines. Every [[SEG-...]] marker you "
        f"receive must appear exactly once in your reply, in any order.\n"
        f"- Do NOT add commentary. Reply with only the marked lines.\n\n"
        f"{marked_lines}"
    )


async def rescore_low_confidence_segments(
    segments: List[Dict[str, Any]],
    source_language: Optional[str] = None,
    job_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Conservatively correct low-confidence segments' text in place.

    Returns the same list of segment dicts. Segments that get corrected gain
    `original_text` (the pre-correction ASR text) and `rescored=True`.
    Segments that were already high-confidence, empty, or where the batch
    validation failed are returned completely unchanged.
    """
    if not _is_enabled():
        return segments

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.warning(f"[ASR-RESCORE] job={job_id} no ANTHROPIC_API_KEY — skipping")
        return segments

    threshold = _confidence_threshold()
    candidates = [
        i for i, s in enumerate(segments)
        if (s.get("text") or "").strip()
        and s.get("confidence") is not None
        and float(s["confidence"]) < threshold
    ]
    if not candidates:
        return segments

    lang_name = _LANG_NAMES.get((source_language or "").lower(), "Cantonese")

    # Reuse translation_service's marker generation/parsing/validation --
    # same [[SEG-xxxxxx]] mechanism, same "any mismatch is a hard failure"
    # semantics, rather than reimplementing (and risking a subtly different)
    # alignment safety net.
    from app.services.translation_service import translation_service as _ts

    markers = _ts._generate_line_markers(len(candidates))
    marked_lines = "\n".join(
        f"[[SEG-{markers[j]}]] {segments[i].get('text', '').strip()}"
        for j, i in enumerate(candidates)
    )
    prompt = _build_prompt(lang_name, marked_lines)

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    payload = {
        "model": _model(),
        "max_tokens": 4096,
        "temperature": 0.0,
        "messages": [{"role": "user", "content": prompt}],
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                _API_URL, json=payload, headers=headers, timeout=_timeout_sec(),
            )
    except Exception as e:
        logger.warning(f"[ASR-RESCORE] job={job_id} request failed: {e} — leaving segments unchanged")
        return segments

    if response.status_code != 200:
        logger.warning(
            f"[ASR-RESCORE] job={job_id} Claude failed: {response.status_code} "
            f"{response.text[:200]} — leaving segments unchanged"
        )
        return segments

    try:
        reply = response.json()["content"][0]["text"].strip()
    except Exception as e:
        logger.warning(f"[ASR-RESCORE] job={job_id} malformed response: {e} — leaving segments unchanged")
        return segments

    pairs = _ts._parse_marked_reply(reply)
    marker_map = _ts._validate_marked_mapping(markers, pairs)
    if marker_map is None:
        logger.warning(
            f"[ASR-RESCORE] job={job_id} reply markers didn't validate 1:1 against "
            f"{len(candidates)} sent segments — rejecting this batch rather than risk "
            f"a silently desynced correction; leaving all segments unchanged"
        )
        return segments

    changed = 0
    for j, i in enumerate(candidates):
        corrected = (marker_map.get(markers[j]) or "").strip()
        original = (segments[i].get("text") or "").strip()
        if corrected and corrected != original:
            segments[i]["original_text"] = original
            segments[i]["text"] = corrected
            segments[i]["rescored"] = True
            changed += 1

    logger.info(
        f"[ASR-RESCORE] job={job_id} {len(candidates)} low-confidence segment(s) "
        f"reviewed (threshold={threshold}), {changed} corrected"
    )
    return segments
