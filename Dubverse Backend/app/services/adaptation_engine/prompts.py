import json
from typing import List, Dict, Optional

SYSTEM_PROMPT = """You are a professional dubbing adaptation specialist.

For each dialogue segment, produce exactly three translation variants:
1. faithful    — highest semantic fidelity; closest meaning to source; may be slightly longer than the timing slot
2. performable — most natural line reading in the target language; prioritises actor delivery and conversational flow
3. sync_fit    — optimised to fit the source timing window; may paraphrase freely to match duration

Rules:
- Never invent plot information or change meaning beyond what sync requires.
- Preserve character names exactly as given in the source.
- Each variant must be a complete, speakable line — no partial sentences.
- Respond ONLY with valid JSON matching the schema in the user prompt. No markdown, no explanation outside JSON."""


def build_batch_adapt_prompt(
    segments: List[Dict],
    source_language: str,
    target_language: str,
    scene_context: Optional[str] = None,
) -> str:
    scene_line = f"\nScene context: {scene_context}" if scene_context else ""

    segments_json = json.dumps(
        [
            {
                "id": s["segment_id"],
                "source": s.get("source_text", ""),
                "translation": s.get("target_text", ""),
                "duration_seconds": round(s.get("source_duration", 2.0), 2),
                "speaker_gender": s.get("speaker_gender", "male"),
            }
            for s in segments
        ],
        ensure_ascii=False,
        indent=2,
    )

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

    return (
        f"Source language: {source_language}\n"
        f"Target language: {target_language}"
        f"{scene_line}\n\n"
        f"Segments to adapt:\n{segments_json}\n\n"
        f"For each segment, provide three variants. The sync_fit variant should target the "
        f"segment's duration_seconds at natural speaking pace (~3.5 syllables/sec for English). "
        f"If the faithful translation already fits well, sync_fit may be identical to it.\n\n"
        f"Respond with JSON matching this schema exactly:\n{schema}"
    )
