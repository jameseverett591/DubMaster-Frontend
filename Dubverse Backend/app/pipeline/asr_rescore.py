"""
Confidence-gated transcript verification + repair for ASR output.

After Deepgram produces its best guess, this pass verifies suspicious
segments against a second acoustic opinion (Whisper on the same time
range) and the surrounding dialogue, then corrects likely transcription
errors (wrong homophones, garbled characters) using Claude.

Stage boundary (do not blur): this runs on the SOURCE-language transcript
BEFORE translation. It does not translate and does not adapt — it answers
only "what was actually said?"

Safety design:
  1. Gate on confidence — only verify segments below a threshold
     (default 0.5), never touching already-high-confidence text.
  2. Second acoustic opinion — each suspect range is re-transcribed by
     Whisper so the LLM compares two ears instead of guessing one.
  3. Surrounding dialogue as context — the prompt carries neighbouring
     lines so reconstruction uses the conversation, not the single line.
  4. Skip short segments — proper names (<=4 CJK chars) are NOT rescored
     because the LLM has no context to know which name is correct and
     frequently "corrects" the right name to a wrong one. They are
     flagged for human review instead.
  5. Conservative correction — "fix likely transcription errors; if the
     text is genuinely ambiguous or could be a proper name, leave it
     UNCHANGED; if no hypothesis is defensible, mark it UNRECOVERABLE."
  6. Log both versions — keep the original ASR text in ``original_text``
     so bad corrections are visible.
  7. Human-in-the-loop — segments that stay suspect are flagged with
     ``translation_flagged``/``flag_reason`` (the existing withheld-from-
     TTS review channel) rather than letting corrupted text silently
     reach translation.

Environment variables:
  ASR_RESCORE_ENABLED              — "1" to enable (default: "1")
  ASR_RESCORE_CONFIDENCE_THRESHOLD — only verify below this (default: "0.5")
  ASR_RESCORE_MIN_LENGTH           — skip segments shorter than this (default: "5")
  ASR_RESCORE_MODEL                — Claude model (default: "claude-sonnet-4-6")
  ASR_RESCORE_TIMEOUT_SEC          — per-call timeout (default: "60")
  ASR_RESCORE_CONTEXT              — neighbours each side for context (default: "2")
  ASR_RESCORE_WHISPER_VERIFY       — "1" to re-ASR suspect ranges (default: "1")
"""

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _get_threshold() -> float:
    return float(os.getenv("ASR_RESCORE_CONFIDENCE_THRESHOLD", "0.5"))


def _get_min_length() -> int:
    return int(os.getenv("ASR_RESCORE_MIN_LENGTH", "5"))


def _get_model() -> str:
    return os.getenv("ASR_RESCORE_MODEL", "claude-sonnet-4-6").strip() or "claude-sonnet-4-6"


def _get_timeout() -> float:
    return float(os.getenv("ASR_RESCORE_TIMEOUT_SEC", "60"))


def _get_context_n() -> int:
    return int(os.getenv("ASR_RESCORE_CONTEXT", "2"))


def _whisper_verify_enabled() -> bool:
    return os.getenv("ASR_RESCORE_WHISPER_VERIFY", "1") == "1"


# ASR invents subtitle-credit lines during music/silence gaps
# (e.g. "字幕提供者李宗盛" hallucinated where the film has no speech).
_CREDIT_RE = re.compile(
    r"字幕|翻譯|翻译|譯製|译制|聽譯|听译|校對|校对|時間軸|时间轴|"
    r"subtitle|subtitles|translated by|subbed by|caption",
    re.IGNORECASE,
)


_SYSTEM_PROMPT = """\
You are a Cantonese and Mandarin transcription corrector working on film
dialogue. You receive ASR (automatic speech recognition) output that may
contain errors from a speech-to-text system, plus a SECOND transcription
of the same audio from a different engine, plus the surrounding dialogue.

Your job: reconstruct what the speaker most likely actually said.

For each item you get:
  - DG: the primary engine's text, with its confidence score
  - WHISPER: a second engine's transcription of the same audio range
    (may be empty or worse — it is evidence, not ground truth)
  - CONTEXT: the dialogue lines immediately before and after

Rules (violating these causes HARM):
  - If the text could be a PROPER NAME and neither hypothesis is clearly
    right, return UNCHANGED. You do NOT know which name the speaker
    intended — 永成 is just as valid as 龍城. NEVER swap one name for
    another on a guess.
  - If the DG text is a subtitle-credit or boilerplate line that does not
    fit the dialogue at all (fansub credits, website watermarks), answer
    status "unrecoverable" — these are ASR fabrications, not speech.
  - Prefer the hypothesis that fits the surrounding conversation.
  - Do NOT invent new content that is not supported by either hypothesis.
  - Do NOT translate — keep the same language (Cantonese/Mandarin).
  - When in doubt, return the original text UNCHANGED.

Return JSON: a list of objects:
  {"index": <0-based item index>,
   "status": "fixed" | "unchanged" | "unrecoverable",
   "corrected": "<corrected text, or the original if unchanged>"}

status="unrecoverable" means no hypothesis is defensible — the human
reviewer must listen to the audio.
"""


def _whisper_hypothesis(
    seg: Dict[str, Any],
    extract_result: Optional[Dict[str, Any]],
    job_id: Optional[str],
    language: Optional[str],
) -> str:
    """Re-transcribe just this segment's time range with Whisper.

    Returns the alternative transcript text, or "" when audio is
    unavailable. Cheap because the Whisper model is already cached and
    the slice is seconds long.
    """
    if not extract_result or not _whisper_verify_enabled():
        return ""
    audio = extract_result.get("audio")
    if audio is None:
        return ""
    sr = extract_result.get("sample_rate", 16000)
    try:
        start = float(seg.get("start", 0))
        end = float(seg.get("end", start))
    except (TypeError, ValueError):
        return ""
    # Pad 0.4s each side — utterance boundaries are fuzzy and a tight cut
    # clips the first/last syllable.
    pad = 0.4
    s_idx = max(0, int((start - pad) * sr))
    e_idx = min(audio.shape[-1], int((end + pad) * sr))
    if e_idx - s_idx < int(0.2 * sr):
        return ""
    try:
        from app.pipeline.transcribe_audio import transcribe_audio
        chunk = {"status": "ok", "audio": audio[..., s_idx:e_idx], "sample_rate": sr}
        res = transcribe_audio(chunk, f"{job_id or 'job'}_verify", source_language=language)
        if res.get("status") != "ok":
            return ""
        return " ".join(s.get("text", "") for s in res.get("segments", [])).strip()
    except Exception as e:
        logger.warning(f"[RESCORE] Whisper verify failed for range {start}-{end}: {e}")
        return ""


def _build_user_prompt(
    items: List[Dict[str, Any]],
    all_segments: List[Dict[str, Any]],
) -> str:
    ctx_n = _get_context_n()
    lines = []
    for i, item in enumerate(items):
        seg_idx = item["seg_idx"]
        prev_ctx = [
            (all_segments[j].get("text") or "").strip()
            for j in range(max(0, seg_idx - ctx_n), seg_idx)
        ]
        next_ctx = [
            (all_segments[j].get("text") or "").strip()
            for j in range(seg_idx + 1, min(len(all_segments), seg_idx + 1 + ctx_n))
        ]
        lines.append(f"--- Item {i} ---")
        if prev_ctx:
            lines.append("CONTEXT BEFORE: " + " / ".join(prev_ctx))
        lines.append(f'DG (conf {item.get("confidence", "?")}): "{item["text"]}"')
        if item.get("whisper"):
            lines.append(f'WHISPER: "{item["whisper"]}"')
        if next_ctx:
            lines.append("CONTEXT AFTER: " + " / ".join(next_ctx))
    return (
        "Verify and repair these segments. Return JSON array:\n\n" + "\n".join(lines)
    )


def _call_claude(items: List[Dict[str, Any]], all_segments: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    """Call Claude to verify/repair a batch of low-confidence segments."""
    import httpx

    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        logger.warning("[RESCORE] No ANTHROPIC_API_KEY set — skipping rescoring")
        return None

    payload = {
        "model": _get_model(),
        "max_tokens": 8192,
        "temperature": 0.2,
        "system": _SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": _build_user_prompt(items, all_segments)}],
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

        text = content[0].get("text", "").strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(l for l in lines if not l.startswith("```"))

        result = json.loads(text)
        return result if isinstance(result, list) else None

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
    extract_result: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Verify + repair low-confidence ASR segments.

    Pipeline per suspect segment:
      1. Whisper re-transcribes the audio range (second opinion).
      2. Claude sees both transcripts + surrounding dialogue and either
         fixes the text, leaves it, or declares it unrecoverable.
      3. Unrecoverable / uncorrectable segments get ``translation_flagged``
         so the editor routes them to a human — corrupted text never
         silently reaches translation.

    ``original_text`` preserves the ASR output on any corrected segment.
    """
    if os.getenv("ASR_RESCORE_ENABLED", "1") != "1":
        return segments

    threshold = _get_threshold()
    min_length = _get_min_length()

    # Pass 1 — flag subtitle-credit fabrications and hopeless low-conf
    # stubs for human review regardless of what the LLM tier decides.
    # translation_flagged/flag_reason is the existing review channel —
    # flagged segments still translate but TTS is withheld until a human
    # clears them in the editor.
    for seg in segments:
        text = (seg.get("text") or "").strip()
        conf = seg.get("confidence")
        if text and _CREDIT_RE.search(text):
            seg["translation_flagged"] = True
            seg["flag_reason"] = "possible_fabricated_credit"
        elif (
            conf is not None and float(conf) < threshold
            and text and len(text) <= 3
        ):
            # A lone very-short low-confidence utterance (usually a guessed
            # name like 岳飛) cannot be reconstructed from text context —
            # send it to a human rather than let the LLM guess.
            seg["translation_flagged"] = True
            seg["flag_reason"] = "low_confidence_stub"

    # Pass 2 — collect segments worth an LLM repair attempt.
    low_conf: List[Dict[str, Any]] = []
    for i, seg in enumerate(segments):
        if seg.get("source") != "deepgram":
            continue
        conf = seg.get("confidence")
        if conf is None:
            continue
        text = (seg.get("text") or "").strip()
        # Short segments stay human-flagged (proper-name trap above).
        if len(text) < min_length:
            continue
        if float(conf) < threshold:
            low_conf.append({
                "seg_idx": i,
                "text": text,
                "confidence": round(float(conf), 3),
            })

    if not low_conf:
        logger.info(f"[RESCORE] job={job_id} no low-confidence segments to verify")
        return segments

    # Second acoustic opinion on each suspect range.
    for item in low_conf:
        seg = segments[item["seg_idx"]]
        item["whisper"] = _whisper_hypothesis(
            seg, extract_result, job_id, source_language
        )

    logger.info(
        f"[RESCORE] job={job_id} verifying {len(low_conf)} low-confidence "
        f"segments (threshold={threshold}, whisper_verify="
        f"{_whisper_verify_enabled()})"
    )

    corrections = _call_claude(low_conf, segments)
    if not corrections:
        # LLM tier down — still surface the suspects for a human.
        for item in low_conf:
            seg = segments[item["seg_idx"]]
            seg["translation_flagged"] = True
            seg.setdefault("flag_reason", "unverified_low_confidence")
        logger.info(f"[RESCORE] job={job_id} no verdicts returned — suspects flagged for review")
        return segments

    verdict_map: Dict[int, Dict[str, Any]] = {}
    for c in corrections:
        idx = c.get("index")
        if idx is not None:
            verdict_map[int(idx)] = c

    fixed = reviewed = unchanged = 0
    for item_idx, item in enumerate(low_conf):
        seg = segments[item["seg_idx"]]
        v = verdict_map.get(item_idx)
        if not v:
            seg["translation_flagged"] = True
            seg.setdefault("flag_reason", "no_verdict")
            reviewed += 1
            continue
        status = str(v.get("status", "")).lower().strip()
        corrected = (v.get("corrected") or "").strip()
        original = item["text"]
        if status == "fixed" and corrected and corrected != original:
            seg["original_text"] = original
            seg["text"] = corrected
            seg["rescored"] = True
            fixed += 1
            logger.info(
                f"[RESCORE] job={job_id} seg {item['seg_idx']}: "
                f"'{original[:30]}' -> '{corrected[:30]}'"
            )
        elif status == "unrecoverable":
            seg["translation_flagged"] = True
            seg["flag_reason"] = "unrecoverable_asr"
            reviewed += 1
        else:
            unchanged += 1

    logger.info(
        f"[RESCORE] job={job_id} verified {len(low_conf)} suspects: "
        f"{fixed} fixed, {reviewed} flagged for human review, {unchanged} unchanged"
    )
    return segments
