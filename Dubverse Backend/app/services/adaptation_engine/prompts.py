import json
from typing import List, Dict, Optional, Tuple, Any

from .policy import (
    DUBBING_SYSTEM_PROMPT,
    NO_HALLUCINATION_GUARDS,
    CharacterProfile,
    TimingConstraints,
    build_timing_constraints,
    format_character_prompt,
    get_character_profile,
    detect_character_from_text,
    protect_entities,
    restore_entities,
)

# The centralized system prompt is now imported from policy.py.
# It is composed of DUBBING_SYSTEM_PROMPT + optional character + timing + NO_HALLUCINATION_GUARDS.
SYSTEM_PROMPT = DUBBING_SYSTEM_PROMPT


def build_batch_adapt_prompt(
    segments: List[Dict],
    source_language: str,
    target_language: str,
    scene_context: Optional[str] = None,
) -> Tuple[str, Dict[str, List[Tuple[str, str]]]]:
    """
    Build the adaptation prompt with per-segment entity protection,
    character profile injection, and timing constraints.

    Returns: (full_user_prompt, segment_id -> entity_replacements mapping)
    """
    scene_line = f"\nScene context: {scene_context}" if scene_context else ""

    # Build per-segment enriched JSON with protected entities, timing, and character info
    enriched_segments: List[Dict[str, Any]] = []
    entity_map: Dict[str, List[Tuple[str, str]]] = {}

    for s in segments:
        seg_id = s["segment_id"]
        source_text = s.get("source_text", "")
        target_text = s.get("target_text", "")
        duration = round(s.get("source_duration", 2.0), 2)
        speaker_id = s.get("speaker_id", "")
        speaker_label = s.get("speaker_label", "") or speaker_id

        # Protect entities
        protected_source, replacements_source = protect_entities(source_text)
        protected_target, replacements_target = protect_entities(target_text)
        # Merge and deduplicate by placeholder
        merged_replacements: Dict[str, str] = dict(replacements_source)
        merged_replacements.update(replacements_target)
        entity_map[seg_id] = list(merged_replacements.items())

        # Detect character profile
        profile = get_character_profile(speaker_label)
        if not profile:
            profile = detect_character_from_text(source_text)

        timing = build_timing_constraints(duration)

        seg_dict = {
            "id": seg_id,
            "source": protected_source,
            "translation": protected_target,
            "duration_seconds": duration,
            "speaker_gender": s.get("speaker_gender", "male"),
            "speaker_id": speaker_id,
            "speaker_label": speaker_label,
            "timing": {
                "target_duration": timing.target_duration,
                "preferred_syllables": f"{timing.preferred_syllables[0]}-{timing.preferred_syllables[1]}",
                "hard_max_syllables": timing.hard_max_syllables,
            },
        }
        if profile:
            seg_dict["character"] = {
                "name": profile.name,
                "traits": profile.traits,
                "speech_style": profile.speech_style,
            }
        enriched_segments.append(seg_dict)

    segments_json = json.dumps(enriched_segments, ensure_ascii=False, indent=2)

    schema = json.dumps(
        {
            "adapted_segments": [
                {
                    "id": "<segment id>",
                    "recommended": "<faithful|performable|sync_fit>",
                    "context_notes": "<one sentence: cultural notes, idiom flags, or empty string>",
                    "variants": [
                        {
                            "type": "faithful",
                            "text": "<translated line>",
                            "rationale": "<one sentence>",
                            "syllable_count": 0,
                        },
                        {
                            "type": "performable",
                            "text": "<translated line>",
                            "rationale": "<one sentence>",
                            "syllable_count": 0,
                        },
                        {
                            "type": "sync_fit",
                            "text": "<translated line>",
                            "rationale": "<one sentence>",
                            "syllable_count": 0,
                        },
                    ],
                }
            ]
        },
        indent=2,
    )

    prompt = (
        f"CRITICAL INSTRUCTION: The 'translation' field in each segment is ALREADY in English. "
        f"Your job is NOT to translate from {source_language}. "
        f"Your job is to create 3 spoken-English variants of the EXISTING English 'translation' text.\n\n"
        f"ABSOLUTE RULES:\n"
        f"- ONLY use the 'translation' field as your source text. IGNORE the 'source' field completely.\n"
        f"- NEVER re-translate from {source_language}. NEVER use external movie knowledge.\n"
        f"- CRITICAL: names from the source must be kept EXACTLY. Do NOT change 'Master Chin' to 'Master Qin' or similar.\n"
        f"- Character names are PROPER NOUNS. Output them EXACTLY as they appear in the translation field.\n"
        f"- Tokens like [[ENTITY:n]] are protected placeholders. Preserve them EXACTLY as they appear. Do NOT replace them with names or translations. ZERO CHANGES ALLOWED.\n"
        f"- If 'translation' says 'Uncle', ALL variants MUST say 'Uncle'. NO EXCEPTIONS.\n"
        f"- If 'translation' says 'Ip Man', ALL variants MUST say 'Ip Man'. NO EXCEPTIONS.\n"
        f"- If 'translation' says 'Master Chin', ALL variants MUST say 'Master Chin'. NOT 'Master Qin'.\n"
        f"- If 'translation' says 'Wing Chun', ALL variants MUST say 'Wing Chun'. NOT 'Wen Chun'.\n"
        f"- Do NOT 'improve', 'correct', or 'authenticate' names based on your training data.\n"
        f"- Do NOT invent characters like 'Wu Zilin', 'Ah Jun', 'Brother Wen', or any other names.\n\n"
        f"For each segment, provide exactly three variants of the English 'translation':\n"
        f"1. faithful    — highest semantic fidelity; closest to the provided English translation\n"
        f"2. performable — most natural spoken line for actor delivery (RECOMMENDED default)\n"
        f"3. sync_fit    — optimised to fit the timing window; may compress but NEVER sacrifice core meaning\n\n"
        f"TIMING RULES:\n"
        f"- Each segment lists its duration_seconds and syllable targets\n"
        f"- sync_fit MUST stay within the hard_max_syllables limit\n"
        f"- If faithful already fits the timing window, sync_fit may be identical to faithful\n\n"
        f"HALLUCINATION GUARDS:\n"
        f"- Do NOT merge segments or cross-reference dialogue between segments\n"
        f"- Do NOT add reactions, acknowledgements, or filler\n"
        f"- Do NOT invent off-screen dialogue or imagined responses\n"
        f"- Do NOT prefix lines with character names or speaker tags\n"
        f"- Protect all ENTPROT###X placeholders exactly as they appear\n\n"
        f"Segments to adapt:\n{segments_json}\n\n"
        f"Respond with JSON matching this schema exactly. No markdown, no commentary outside JSON:\n{schema}"
    )

    return prompt, entity_map
