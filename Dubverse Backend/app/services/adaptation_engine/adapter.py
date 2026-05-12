import asyncio
import json
import logging
import os
import re
from typing import Dict, List, Optional

from .prompts import SYSTEM_PROMPT, build_batch_adapt_prompt
from .types import VARIANT_ORDER, AdaptationVariant, AdaptedSegment

logger = logging.getLogger(__name__)

_SYLLABLES_PER_SECOND_EN = 3.5
_SYLLABLES_PER_SECOND_CJK = 4.0
_CJK_LANGS = {"zh", "yue", "ja", "ko", "cmn", "zho"}


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
        user_prompt = build_batch_adapt_prompt(
            segments=segments,
            source_language=source_language,
            target_language=target_language,
            scene_context=scene_context,
        )
        raw = await _call_llm(user_prompt)
        if raw is None:
            logger.warning("[ADAPTATION] LLM returned None — using fallback")
            return _fallback_variants(segments)

        return _parse_llm_response(raw, segments)

    except Exception as e:
        logger.error(f"[ADAPTATION] adapt_batch failed: {e}", exc_info=True)
        return _fallback_variants(segments)


async def _call_llm(user_prompt: str) -> Optional[str]:
    """Call Claude via Anthropic API with the adaptation prompt."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return None

    model = os.getenv("ADAPTATION_MODEL", "claude-haiku-4-5-20251001")

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)

        response = await asyncio.to_thread(
            client.messages.create,
            model=model,
            max_tokens=6000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
            temperature=0.3,
        )

        content = response.content[0].text if response.content else None
        if not content:
            return None

        content = content.strip()
        content = re.sub(r"^```json\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
        return content

    except Exception as e:
        logger.error(f"[ADAPTATION] LLM call failed: {e}", exc_info=True)
        return None


def _parse_llm_response(raw_json: str, segments: List[Dict]) -> List[AdaptedSegment]:
    """
    Parse GPT-4 JSON. If any segment is missing or malformed, substitute a
    fallback for that segment only — never raise.
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

        for vr in variants_raw:
            vtype = vr.get("type", "")
            if vtype not in VARIANT_ORDER:
                continue
            text = (vr.get("text") or "").strip() or orig.get("target_text", "")
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
