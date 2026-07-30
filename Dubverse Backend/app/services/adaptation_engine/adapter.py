import json
import logging
import os
import re
from typing import Dict, List, Optional, Tuple

import httpx

from .prompts import SYSTEM_PROMPT, build_batch_adapt_prompt
from .types import VARIANT_ORDER, AdaptationVariant, AdaptedSegment
from .policy import (
    restore_entities,
    validate_adaptation,
    get_variant_config,
    DEFAULT_VALIDATION_RULES,
    PROTECTED_ENTITIES,
)

logger = logging.getLogger(__name__)

_SYLLABLES_PER_SECOND_EN = 3.5
_SYLLABLES_PER_SECOND_CJK = 4.0
_CJK_LANGS = {"zh", "yue", "ja", "ko", "cmn", "zho"}


def _force_entity_preservation(original_text: str, adapted_text: str) -> str:
    """Detect and correct modified protected names in adapted text.

    If the LLM changed e.g. 'Master Chin' → 'Master Qin', this tries
    to find the mutated version and swap it back to the original.
    """
    result = adapted_text
    for entity in PROTECTED_ENTITIES:
        if entity.lower() not in original_text.lower():
            continue
        if entity.lower() in result.lower():
            continue
        words = entity.split()
        if len(words) >= 2:
            # Heuristic: first word preserved, second word mutated?
            pattern = re.compile(
                rf"\b{re.escape(words[0])}\s+([A-Za-z]+)", re.IGNORECASE
            )
            for match in pattern.finditer(result):
                candidate = match.group(0)
                if candidate.lower() != entity.lower():
                    result = result[: match.start()] + entity + result[match.end() :]
                    break
    return result


async def adapt_batch(
    segments: List[Dict],
    target_language: str,
    scene_context: Optional[str] = None,
) -> List[AdaptedSegment]:
    """
    Generate 3 adaptation variants for every segment in a single GPT-4 call.
    Falls back to synthetic variants derived from target_text if LLM unavailable.
    Returns one AdaptedSegment per input segment, in the same order.
    """
    if not segments:
        return []

    if not os.getenv("ANTHROPIC_API_KEY", "").strip():
        logger.warning("[ADAPTATION] ANTHROPIC_API_KEY not set — using fallback variants")
        return _fallback_variants(segments)

    source_language = segments[0].get("source_language", "zh")

    try:
        user_prompt, entity_map = build_batch_adapt_prompt(
            segments=segments,
            source_language=source_language,
            target_language=target_language,
            scene_context=scene_context,
        )
        raw = await _call_llm(user_prompt)
        if raw is None:
            logger.warning("[ADAPTATION] LLM returned None — using fallback")
            return _fallback_variants(segments)

        return _parse_llm_response(raw, segments, entity_map)

    except Exception as e:
        logger.error(f"[ADAPTATION] adapt_batch failed: {e}", exc_info=True)
        return _fallback_variants(segments)


# Models from Opus 4.7 / Sonnet 5 onward reject `temperature` and `top_p`
# outright (HTTP 400) — sampling parameters were removed on those models.
_NO_SAMPLING_PARAMS = (
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-fable-5",
    "claude-mythos-5",
)


async def _call_llm(user_prompt: str) -> Optional[str]:
    """Call Claude via the Anthropic Messages API with the adaptation prompt.

    Posts to /v1/messages directly, matching every other Anthropic call in this
    codebase (qc_report_service, translation_service, routes, dubbing_service).
    This previously used the `anthropic` SDK, which is not in requirements.txt
    and was not installed — so every adaptation call raised ModuleNotFoundError
    and silently fell back to synthetic variants.

    Sends `temperature` only. The previous code sent temperature AND top_p
    together, which the API rejects: verified against claude-haiku-4-5 —
    "`temperature` and `top_p` cannot both be specified for this model."
    Either alone returns 200. On models that removed sampling parameters
    entirely (see _NO_SAMPLING_PARAMS) neither is sent.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return None

    model = os.getenv("ADAPTATION_MODEL", "claude-haiku-4-5-20251001")

    body: Dict = {
        "model": model,
        "max_tokens": 6000,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_prompt}],
    }
    if not model.startswith(_NO_SAMPLING_PARAMS):
        body["temperature"] = 0.3

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json=body,
            )

        if response.status_code != 200:
            logger.error(
                f"[ADAPTATION] Anthropic API HTTP {response.status_code}: "
                f"{response.text[:300]}"
            )
            return None

        blocks = response.json().get("content") or []
        content = next(
            (b.get("text") for b in blocks if b.get("type") == "text"), None
        )
        if not content:
            return None

        content = content.strip()
        content = re.sub(r"^```json\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
        return content

    except Exception as e:
        logger.error(f"[ADAPTATION] LLM call failed: {e}", exc_info=True)
        return None


def _parse_llm_response(
    raw_json: str,
    segments: List[Dict],
    entity_map: Dict[str, List[Tuple[str, str]]],
) -> List[AdaptedSegment]:
    """
    Parse LLM JSON response. Restore protected entities, validate each variant,
    and substitute a fallback for any segment that fails validation or is missing.
    Never raises.
    """
    seg_index = {s["segment_id"]: s for s in segments}
    result_map: Dict[str, AdaptedSegment] = {}

    try:
        data = json.loads(raw_json)
        adapted_list = data.get("adapted_segments", [])
    except json.JSONDecodeError as e:
        logger.warning(f"[ADAPTATION] JSON parse failed: {e} — using full fallback")
        return _fallback_variants(segments)

    for item in adapted_list:
        seg_id = str(item.get("id", ""))
        if seg_id not in seg_index:
            continue

        orig = seg_index[seg_id]
        variants_raw = item.get("variants", [])
        variants: List[AdaptationVariant] = []
        seen_types = set()

        seg_replacements = entity_map.get(seg_id, [])

        for vr in variants_raw:
            vtype = vr.get("type", "")
            if vtype not in VARIANT_ORDER:
                continue
            raw_text = (vr.get("text") or "").strip() or orig.get("target_text", "")

            # Restore protected entities
            text = restore_entities(raw_text, seg_replacements) if seg_replacements else raw_text
            # Strip empty [[]] and [[word]] bracket artifacts.
            text = re.sub(r'\[\[\s*\]\]', '', text).strip()
            text = re.sub(r'\[\[([^\]]+)\]\]', r'\1', text).strip()
            # Try to recover entities the LLM mutated (e.g. Master Qin → Master Chin)
            text = _force_entity_preservation(
                orig.get("target_text", ""), text
            )
            # Plural fix — word-boundary regex is safe even if translation already
            # returned "masters" (avoids "masterss" double-s).
            text = re.sub(r'\b(so many|plenty of|many) master\b', r'\1 masters', text)
            # Uncle IP capitalisation from adaptation LLM
            text = re.sub(r'\bUncle IP\b', 'Uncle Ip', text)

            # Lightweight validation
            validation = validate_adaptation(
                source_text=orig.get("target_text", ""),
                adapted_text=text,
                target_duration=orig.get("source_duration", 2.0),
                rules=DEFAULT_VALIDATION_RULES,
                protected_replacements=seg_replacements,
            )
            if not validation.valid:
                logger.warning(
                    f"[ADAPTATION] Variant '{vtype}' for segment {seg_id} failed validation: "
                    f"{validation.reason} (severity={validation.severity})"
                )
                if validation.severity == "fail":
                    # Fall back to target_text for this variant
                    text = orig.get("target_text", "")

            syllables = int(vr.get("syllable_count") or 0) or _estimate_syllables(
                text, orig.get("target_language", "en")
            )
            ratio = _estimate_duration_ratio(
                syllables, orig.get("source_duration", 2.0), orig.get("target_language", "en")
            )
            variants.append(
                AdaptationVariant(
                    variant_type=vtype,
                    text=text,
                    rationale=(vr.get("rationale") or "").strip(),
                    estimated_duration_ratio=round(ratio, 3),
                    syllable_count=syllables,
                )
            )
            seen_types.add(vtype)

        # Fill any variant type the LLM omitted
        fallback_text = orig.get("target_text", "")
        for vtype in VARIANT_ORDER:
            if vtype not in seen_types:
                syllables = _estimate_syllables(fallback_text, orig.get("target_language", "en"))
                ratio = _estimate_duration_ratio(
                    syllables, orig.get("source_duration", 2.0), orig.get("target_language", "en")
                )
                variants.append(
                    AdaptationVariant(
                        variant_type=vtype,
                        text=fallback_text,
                        rationale="Fallback — LLM did not return this variant.",
                        estimated_duration_ratio=round(ratio, 3),
                        syllable_count=syllables,
                    )
                )

        order_map = {v: i for i, v in enumerate(VARIANT_ORDER)}
        variants.sort(key=lambda v: order_map.get(v.variant_type, 99))

        recommended = item.get("recommended", "performable")
        if recommended not in VARIANT_ORDER:
            recommended = "performable"

        result_map[seg_id] = AdaptedSegment(
            segment_id=seg_id,
            source_text=orig.get("source_text", ""),
            source_language=orig.get("source_language", "zh"),
            target_language=orig.get("target_language", "en"),
            source_duration=orig.get("source_duration", 2.0),
            variants=variants,
            recommended=recommended,
            context_notes=(item.get("context_notes") or "").strip(),
        )

    # Segments the LLM did not return get a per-segment fallback
    out: List[AdaptedSegment] = []
    for seg in segments:
        sid = seg["segment_id"]
        out.append(result_map[sid] if sid in result_map else _fallback_single(seg))

    return out


def _fallback_variants(segments: List[Dict]) -> List[AdaptedSegment]:
    return [_fallback_single(s) for s in segments]


def _fallback_single(seg: Dict) -> AdaptedSegment:
    text = seg.get("target_text", "")
    lang = seg.get("target_language", "en")
    duration = seg.get("source_duration", 2.0)
    syllables = _estimate_syllables(text, lang)
    ratio = _estimate_duration_ratio(syllables, duration, lang)

    variants = [
        AdaptationVariant(
            variant_type=vtype,
            text=text,
            rationale="Fallback — adaptation service unavailable.",
            estimated_duration_ratio=round(ratio, 3),
            syllable_count=syllables,
        )
        for vtype in VARIANT_ORDER
    ]

    return AdaptedSegment(
        segment_id=seg["segment_id"],
        source_text=seg.get("source_text", ""),
        source_language=seg.get("source_language", "zh"),
        target_language=lang,
        source_duration=duration,
        variants=variants,
        recommended="performable",
        context_notes="",
    )


def _estimate_syllables(text: str, language: str) -> int:
    """Rough syllable/mora count — informational only, not used for audio timing."""
    if not text:
        return 0
    cjk_chars = len(
        re.findall(r"[一-鿿぀-ゟ゠-ヿ가-힯]", text)
    )
    if cjk_chars > len(text) * 0.4:
        return cjk_chars
    # Latin: count vowel clusters per word
    vowel_re = re.compile(r"[aeiouAEIOU]+")
    return sum(max(1, len(vowel_re.findall(w))) for w in text.strip().split())


def _estimate_duration_ratio(
    syllable_count: int, source_duration: float, language: str
) -> float:
    """
    Estimate whether a variant will overflow or underflow the source timing slot.
    1.0 = exact fit, >1.0 = likely too long, <1.0 = likely too short.
    """
    if source_duration <= 0:
        return 1.0
    lang_short = language.split("-")[0].lower()
    sps = _SYLLABLES_PER_SECOND_CJK if lang_short in _CJK_LANGS else _SYLLABLES_PER_SECOND_EN
    return (syllable_count / sps) / source_duration
