"""
Azure OpenAI GPT-4 — translation quality evaluation.

Uses Azure-hosted GPT-4 to evaluate semantic accuracy of translations,
flag errors, and detect missing dialogue.

Returns None on any error — QC analysis degrades gracefully without Azure OpenAI.
"""

import json
import logging
import os
from typing import Optional, Dict, Any, List

logger = logging.getLogger(__name__)


def _get_config() -> Optional[Dict[str, str]]:
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").strip()
    key = os.getenv("AZURE_OPENAI_KEY", "").strip()
    deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT", "").strip()
    if endpoint and key and deployment:
        return {"endpoint": endpoint, "key": key, "deployment": deployment}
    return None


def is_enabled() -> bool:
    """Check if Azure OpenAI integration is configured."""
    return _get_config() is not None


def evaluate_translation(
    original_segments: List[Dict[str, Any]],
    dubbed_segments: List[Dict[str, Any]],
    source_lang: str,
    target_lang: str,
) -> Optional[Dict[str, Any]]:
    """
    Use GPT-4 to evaluate translation quality between original and dubbed transcripts.

    Args:
        original_segments: [{text, start, end, ...}, ...] from source transcript
        dubbed_segments: [{text, start, end, ...}, ...] from re-transcription
        source_lang: Source language code (e.g. "zh")
        target_lang: Target language code (e.g. "en")

    Returns:
        {
            "translation_score": 0-100,
            "errors": [{segment, original, translated, issue, severity}, ...],
            "missing_dialogue": [{start, end, original_text}, ...],
            "coverage_percent": 0-100,
        }
        or None on error.
    """
    config = _get_config()
    if not config:
        logger.info("[AZURE_OPENAI] Not configured, skipping")
        return None

    if not original_segments or not dubbed_segments:
        logger.warning("[AZURE_OPENAI] Empty segments provided")
        return None

    try:
        from openai import AzureOpenAI

        client = AzureOpenAI(
            azure_endpoint=config["endpoint"],
            api_key=config["key"],
            api_version="2024-06-01",
        )

        # Format transcripts for the prompt
        original_text = _format_segments(original_segments, "Original")
        dubbed_text = _format_segments(dubbed_segments, "Dubbed")

        prompt = f"""You are an expert translation quality evaluator. Analyze the following dubbing translation from {source_lang} to {target_lang}.

## Original Transcript ({source_lang}):
{original_text}

## Dubbed Transcript ({target_lang}):
{dubbed_text}

## Task:
Evaluate the translation quality. Consider:
1. Semantic accuracy — does the meaning come through? (Not word-for-word, but intent)
2. Natural phrasing — does the target language sound natural?
3. Missing content — is any original dialogue missing from the dub?
4. Nonsensical translations — any parts that don't make sense?
5. Character names — are proper nouns handled correctly?

## Respond with ONLY valid JSON in this exact format:
{{
    "translation_score": <0-100 integer>,
    "summary": "<1-2 sentence overall assessment>",
    "errors": [
        {{
            "segment": <original segment index, 0-based>,
            "original": "<original text>",
            "translated": "<dubbed text>",
            "issue": "<description of the translation problem>",
            "severity": "<critical|major|minor>"
        }}
    ],
    "missing_dialogue": [
        {{
            "start": <timestamp in seconds>,
            "end": <timestamp in seconds>,
            "original_text": "<text that was not translated>"
        }}
    ]
}}

Be strict. A robotic TTS reading of a decent translation might score 60-70. Perfect human-quality dubbing scores 90+. Flag any meaning changes, even subtle ones, as errors."""

        logger.info("[AZURE_OPENAI] Sending translation evaluation request")
        response = client.chat.completions.create(
            model=config["deployment"],
            messages=[
                {"role": "system", "content": "You are a professional translation quality assessor. Always respond with valid JSON only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=4000,
        )

        content = response.choices[0].message.content.strip()

        # Parse JSON — handle markdown code blocks
        if content.startswith("```"):
            content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        result = json.loads(content)

        # Add coverage calculation
        coverage = detect_missing_dialogue(original_segments, dubbed_segments)
        result["coverage_percent"] = coverage["coverage_percent"]
        if not result.get("missing_dialogue"):
            result["missing_dialogue"] = coverage.get("missing_regions", [])

        logger.info(
            f"[AZURE_OPENAI] Evaluation complete: score={result.get('translation_score')}, "
            f"errors={len(result.get('errors', []))}, coverage={result.get('coverage_percent')}%"
        )
        return result

    except ImportError:
        logger.warning("[AZURE_OPENAI] openai package not installed")
        return None
    except json.JSONDecodeError as e:
        logger.warning(f"[AZURE_OPENAI] Failed to parse GPT response as JSON: {e}")
        return None
    except Exception as e:
        logger.warning(f"[AZURE_OPENAI] Error: {e}")
        return None


def detect_missing_dialogue(
    original_segments: List[Dict[str, Any]],
    dubbed_segments: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Compare segment counts and time coverage to find missing dialogue.

    Args:
        original_segments: Original transcript segments
        dubbed_segments: Re-transcribed dubbed segments

    Returns:
        {
            "coverage_percent": 0-100,
            "missing_regions": [{start, end, original_text}, ...],
        }
    """
    if not original_segments:
        return {"coverage_percent": 100, "missing_regions": []}

    # Calculate total original speech time
    original_total = sum(
        max(0, seg.get("end", 0) - seg.get("start", 0))
        for seg in original_segments
    )

    if original_total <= 0:
        return {"coverage_percent": 100, "missing_regions": []}

    # For each original segment, check if dubbed audio covers that time region
    missing = []
    covered_time = 0

    for orig in original_segments:
        orig_start = orig.get("start", 0)
        orig_end = orig.get("end", 0)
        orig_duration = orig_end - orig_start
        if orig_duration <= 0:
            continue

        # Check if any dubbed segment overlaps this time region
        has_coverage = False
        for dub in dubbed_segments:
            dub_start = dub.get("start", 0)
            dub_end = dub.get("end", 0)
            overlap = max(0, min(orig_end, dub_end) - max(orig_start, dub_start))
            if overlap > 0.3:  # at least 300ms overlap
                has_coverage = True
                break

        if has_coverage:
            covered_time += orig_duration
        else:
            missing.append({
                "start": round(orig_start, 2),
                "end": round(orig_end, 2),
                "original_text": orig.get("text", ""),
            })

    coverage = round((covered_time / original_total) * 100) if original_total > 0 else 100

    return {
        "coverage_percent": coverage,
        "missing_regions": missing,
    }


def _format_segments(
    segments: List[Dict[str, Any]],
    label: str,
) -> str:
    """Format segments for the GPT prompt."""
    lines = []
    for i, seg in enumerate(segments):
        start = seg.get("start", 0)
        end = seg.get("end", 0)
        text = seg.get("text", "").strip()
        if text:
            lines.append(f"[{i}] {start:.1f}s-{end:.1f}s: {text}")
    return "\n".join(lines) if lines else f"(No {label.lower()} segments found)"
