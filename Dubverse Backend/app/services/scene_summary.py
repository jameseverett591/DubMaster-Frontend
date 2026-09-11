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
import re
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


# ---------------------------------------------------------------------------
# Whole-video AI Notes -- the videotranscriber.ai-style panel
# ---------------------------------------------------------------------------
# One call produces two artifacts over the whole job:
#   notes    -- timestamped beats, each covering a segment or a short run of
#               them ("[00:23] Jin directly challenges Ye Wen...")
#   chapters -- titled cards with a prose summary whose inline [MM:SS-MM:SS]
#               markers link back into the timeline.
#
# The presets mirror the reference tool's Prompt Library, but the DEFAULT
# ("smart") is tuned for a dubbing director, not a student: every note says
# who is speaking, what they want, and what the line is DOING (challenge /
# dismissal / plea / joke) so someone who cannot read the source language can
# still judge whether the translation carries the right stance.
# ---------------------------------------------------------------------------

def _mmss(seconds: float) -> str:
    s = max(0, int(seconds))
    return f"{s // 60:02d}:{s % 60:02d}"


_VIDEO_NOTES_PRESETS: Dict[str, str] = {
    "smart": (
        "You write DIRECTOR'S NOTES for a dubbing director who does NOT speak the source "
        "language. For each beat: name who is speaking (use the character name in "
        "parentheses when a persona is known), what they want in that moment, and what "
        "the line DOES dramatically (challenge, dismissal, plea, warning, joke, reveal, "
        "reassurance, interruption). One note per beat -- merge consecutive lines by the "
        "same speaker into one note; never one note per line when a run forms a single "
        "beat. Each note is 1-2 sentences."
    ),
    "summary": (
        "You write a STRUCTURED SUMMARY of this video: a short overview first, then the "
        "key beats with timestamps. Each note is 1-2 sentences covering the essential "
        "events in order."
    ),
    "core_points": (
        "You extract the CORE POINTS of this video: the main arguments, decisions, "
        "conclusions and useful details -- not a moment-by-moment recap. Fewer, denser "
        "notes; each is 1-2 sentences."
    ),
    "chapters": (
        "You organize this video into CHAPTERS. Notes may be sparse (chapter boundaries "
        "only); the chapters array is the primary artifact. Give each chapter a "
        "descriptive title and a 2-4 sentence summary of what happens in it."
    ),
    "study_notes": (
        "You turn this video into STUDY NOTES: clear, reviewable notes that capture the "
        "key information a viewer should retain. Notes may define terms, flag important "
        "claims, and mark pivotal moments."
    ),
}


_VIDEO_NOTES_SCHEMA = """Return ONLY a JSON object, no commentary, no markdown fences:
{
  "video_title": "a short evocative title for the video, e.g. 'Confrontation at the Foshan Martial Arts School: A Clash of Pride and Respect'",
  "notes": [
    {"t": "MM:SS", "text": "what happens in this beat, 1-2 sentences"}
  ],
  "chapters": [
    {"title": "chapter title", "start": "MM:SS", "end": "MM:SS",
     "summary": "2-4 sentence prose summary; may embed [MM:SS-MM:SS] markers where a moment is referenced"}
  ]
}"""


def generate_video_notes(
    all_segments: List[Dict[str, Any]],
    preset: str = "smart",
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Generate a timestamped AI Notes feed + chapter cards for a whole job.

    all_segments: every segment of the job, in chronological order. Uses each
    segment's source text when present, else its translated text -- notes are
    written in English either way.

    Never raises -- returns a status dict so the panel degrades gracefully.
    """
    import httpx
    from app.services.adaptation_engine.policy import get_character_profile, detect_character_from_text

    if not all_segments:
        return {"status": "skipped", "reason": "no_segments"}

    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        logger.warning(f"[VIDEO-NOTES] job={job_id} no ANTHROPIC_API_KEY set")
        return {"status": "skipped", "reason": "no_api_key"}

    # Persona map: speaker id -> "Name -- speech style", same resolution path
    # the per-segment summary uses (registry label match, then text scan).
    speaker_personas: Dict[str, str] = {}
    speaker_names: Dict[str, str] = {}
    for seg in all_segments:
        speaker = seg.get("speaker") or seg.get("speaker_id") or "?"
        if speaker in speaker_personas:
            continue
        profile = get_character_profile(seg.get("speaker_label") or speaker) or detect_character_from_text(
            seg.get("source_text") or seg.get("text") or ""
        )
        if profile:
            descriptor = profile.speech_style or ", ".join(profile.traits)
            speaker_personas[speaker] = f"{profile.name} -- {descriptor}"
            speaker_names[speaker] = profile.name

    # Transcript lines, capped so a feature-length job still fits the window.
    # ~800 segments x ~90 chars stays under ~30k tokens.
    max_segs = int(os.getenv("VIDEO_NOTES_MAX_SEGMENTS", "800"))
    segs = all_segments[:max_segs]
    lines = []
    for seg in segs:
        speaker = seg.get("speaker") or seg.get("speaker_id") or "?"
        name = speaker_names.get(speaker)
        who = f"{speaker} ({name})" if name else speaker
        text = (seg.get("source_text") or seg.get("text") or "").strip()
        if len(text) > 140:
            text = text[:137] + "..."
        lines.append(f"[{_mmss(seg.get('start', 0))}] [{who}] {text}")

    persona_lines = "\n".join(f"- {spk}: {p}" for spk, p in speaker_personas.items()) or "(none known)"

    system = (
        _VIDEO_NOTES_PRESETS.get(preset, _VIDEO_NOTES_PRESETS["smart"])
        + "\n\nSTRICT RULES (violating these makes your output useless and dangerous):\n"
        "- Base everything ONLY on the transcript lines given. Do not invent characters, "
        "relationships, backstory, or events not directly stated or clearly implied.\n"
        "- Never write new dialogue. Never suggest what a line 'should' say.\n"
        "- Every note's timestamp MUST be the timestamp of the first line the beat "
        "covers, copied exactly from the transcript.\n"
        "- If you are not confident about something, say so plainly rather than guessing.\n\n"
        + _VIDEO_NOTES_SCHEMA
    )

    user = (
        "Known character personas for speakers in this video (may be incomplete):\n"
        f"{persona_lines}\n\n"
        f"Video duration: {_mmss(segs[-1].get('end', 0))}\n\n"
        "Transcript, in order:\n"
        f"{chr(10).join(lines)}\n\n"
        "Produce the JSON object now."
    )

    payload = {
        "model": os.getenv("SCENE_SUMMARY_MODEL", "claude-sonnet-4-6"),
        "max_tokens": int(os.getenv("VIDEO_NOTES_MAX_TOKENS", "4096")),
        "temperature": 0.2,
        "system": system,
        "messages": [{"role": "user", "content": user}],
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
            timeout=float(os.getenv("VIDEO_NOTES_TIMEOUT_SEC", "90")),
        )
    except Exception as e:
        logger.warning(f"[VIDEO-NOTES] job={job_id} request failed: {e}")
        return {"status": "error", "reason": str(e)}

    if resp.status_code != 200:
        logger.warning(
            f"[VIDEO-NOTES] job={job_id} Claude failed: {resp.status_code} {resp.text[:200]}"
        )
        return {"status": "error", "reason": f"http_{resp.status_code}"}

    try:
        text = resp.json()["content"][0]["text"].strip()
        if text.startswith("```"):
            text = "\n".join(l for l in text.split("\n") if not l.startswith("```"))
        parsed = json.loads(text)
    except Exception as e:
        logger.warning(f"[VIDEO-NOTES] job={job_id} failed to parse response: {e}")
        return {"status": "error", "reason": "parse_failed"}

    def _parse_mmss(v: Any) -> Optional[float]:
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            m = re_mmss.match(v.strip())
            if m:
                return int(m.group(1)) * 60 + int(m.group(2)) + int(m.group(3) or 0) / 10
        return None

    notes = []
    for n in parsed.get("notes") or []:
        start = _parse_mmss(n.get("t"))
        if start is None or not str(n.get("text") or "").strip():
            continue
        notes.append({"start": start, "text": str(n["text"]).strip()})

    chapters = []
    for c in parsed.get("chapters") or []:
        title = str(c.get("title") or "").strip()
        summary = str(c.get("summary") or "").strip()
        if not title and not summary:
            continue
        chapters.append({
            "title": title,
            "start": _parse_mmss(c.get("start")),
            "end": _parse_mmss(c.get("end")),
            "summary": summary,
        })

    return {
        "status": "ok",
        "preset": preset,
        "video_title": str(parsed.get("video_title") or "").strip(),
        "notes": notes,
        "chapters": chapters,
    }


# "MM:SS" or "MM:SS.t" -- the only timestamp shapes we accept back from the LLM.
re_mmss = re.compile(r"^(\d+):([0-5]?\d)(?:\.(\d))?$")
