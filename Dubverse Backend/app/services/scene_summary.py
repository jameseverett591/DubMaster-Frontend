"""
Scene Summary generation -- Feature A of the Dubbing Studio Platform spec
(plan-8012dcdb5d41cf3b.md).

Gives a director who doesn't speak the source language enough plain-English
context to judge whether a translation serves the scene, WITHOUT ever
inventing dialogue or plot details it wasn't given. Same hallucination-risk
class as policy.py's NO_HALLUCINATION_GUARDS, tuned for summarization
instead of translation: this model must never invent stakes, relationships,
or lines beyond what the given source text directly states or clearly
implies.
"""

import json
import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_SCENE_SUMMARY_SYSTEM_PROMPT = """You are a scene-context assistant for a professional dubbing director who does NOT speak the source language of this film. Your job is to give them just enough plain-English context to judge whether a translated line serves the scene -- not to translate, not to write dialogue, not to invent plot.

STRICT RULES (violating these makes your output useless and dangerous):
- Base everything ONLY on the source lines you are given. Do not invent characters, relationships, backstory, or events not directly stated or clearly implied by the given lines.
- Never write new dialogue. Never suggest what a line "should" say in English.
- Never translate. You are describing the scene and the function of one line within it, not its content word-for-word.
- If you are not confident about something (e.g. who a speaker is), say so plainly rather than guessing with false confidence.
- Keep the scene beat to 1-2 sentences. Keep the line function to a single word or short phrase (e.g. "dismissal", "challenge", "plea", "warning", "joke", "reveal", "reassurance").

Return ONLY a JSON object with these exact keys, no commentary, no markdown fences:
{
  "scene_beat": "1-2 plain-English sentences: who is in this scene, what they want, what's at stake",
  "speaker_persona": "one line reminder of who is speaking and their established manner, or null if unknown",
  "line_function": "the pragmatic function of THIS line: dismissal / challenge / plea / warning / joke / reveal / reassurance / etc.",
  "stakes_tags": ["short", "tag", "words", "e.g.", "tension", "confrontation", "domestic"]
}"""


def _build_user_prompt(
    scene_segments: List[Dict[str, Any]],
    target_index: int,
    speaker_personas: Dict[str, str],
) -> str:
    lines = []
    for i, seg in enumerate(scene_segments):
        speaker = seg.get("speaker", "?")
        text = (seg.get("source_text") or seg.get("text") or "").strip()
        marker = "  <-- SUMMARIZE THIS LINE" if i == target_index else ""
        lines.append(f"[{speaker}] {text}{marker}")

    persona_lines = "\n".join(f"- {spk}: {p}" for spk, p in speaker_personas.items()) or "(none known)"

    return (
        "Known character personas for speakers in this scene (may be incomplete):\n"
        f"{persona_lines}\n\n"
        "Scene lines, in order (source language, not yet translated):\n"
        f"{chr(10).join(lines)}\n\n"
        "Summarize the scene and describe the marked line's function, per the JSON schema."
    )


def generate_scene_summary(
    scene_segments: List[Dict[str, Any]],
    target_index: int,
    job_id: Optional[str] = None,
    original_performance: Optional[str] = None,
) -> Dict[str, Any]:
    """Generate a Scene Summary for one segment within its surrounding scene.

    scene_segments: all segments within the scene range, in chronological order.
    target_index: index into scene_segments of the segment being summarized.

    Never raises -- returns a status dict on failure so the panel can show
    "summary unavailable" rather than break the editor.
    """
    import httpx
    from app.services.adaptation_engine.policy import get_character_profile, detect_character_from_text

    if not scene_segments or not (0 <= target_index < len(scene_segments)):
        return {"status": "skipped", "reason": "invalid_segment_range"}

    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        logger.warning(f"[SCENE-SUMMARY] job={job_id} no ANTHROPIC_API_KEY set")
        return {"status": "skipped", "reason": "no_api_key"}

    # Resolve a persona line per unique speaker in the scene from whatever
    # character-detection signal already exists (registry lookup by speaker
    # label, then a text-mention scan) -- degrades to "unknown" rather than
    # guessing when neither resolves.
    speaker_personas: Dict[str, str] = {}
    for seg in scene_segments:
        speaker = seg.get("speaker") or "?"
        if speaker in speaker_personas:
            continue
        profile = get_character_profile(speaker) or detect_character_from_text(
            seg.get("source_text") or seg.get("text") or ""
        )
        if profile:
            descriptor = profile.speech_style or ", ".join(profile.traits)
            speaker_personas[speaker] = f"{profile.name} -- {descriptor}"

    prompt = _build_user_prompt(scene_segments, target_index, speaker_personas)

    payload = {
        "model": os.getenv("SCENE_SUMMARY_MODEL", "claude-sonnet-4-6"),
        "max_tokens": 512,
        "temperature": 0.2,
        "system": _SCENE_SUMMARY_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": prompt}],
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
            timeout=float(os.getenv("SCENE_SUMMARY_TIMEOUT_SEC", "30")),
        )
    except Exception as e:
        logger.warning(f"[SCENE-SUMMARY] job={job_id} request failed: {e}")
        return {"status": "error", "reason": str(e)}

    if resp.status_code != 200:
        logger.warning(
            f"[SCENE-SUMMARY] job={job_id} Claude failed: {resp.status_code} {resp.text[:200]}"
        )
        return {"status": "error", "reason": f"http_{resp.status_code}"}

    try:
        text = resp.json()["content"][0]["text"].strip()
        if text.startswith("```"):
            lines = text.split("\n")
            text = "\n".join(l for l in lines if not l.startswith("```"))
        parsed = json.loads(text)
    except Exception as e:
        logger.warning(f"[SCENE-SUMMARY] job={job_id} failed to parse response: {e}")
        return {"status": "error", "reason": "parse_failed"}

    return {
        "status": "ok",
        "scene_beat": parsed.get("scene_beat", ""),
        "speaker_persona": parsed.get("speaker_persona"),
        "line_function": parsed.get("line_function", ""),
        "stakes_tags": parsed.get("stakes_tags", []) or [],
        # Factual, not LLM-generated -- passed through by the caller from
        # whatever real performance-analysis data exists for this segment
        # (Velma emotion/accent, or emotion2vec's original_emotions when
        # Velma is skipped for Cantonese/Mandarin jobs). Never invented.
        "original_performance": original_performance,
    }
