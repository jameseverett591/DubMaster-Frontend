# =============================================================================
# Adaptation Policy Layer — Centralized Dubbing Intelligence
# =============================================================================
# This module provides a reusable, modular, configurable policy system for
# ALL dubbing adaptation and translation requests.  It enforces cinematic
# dubbing rules, character consistency, timing constraints, hallucination
# guards, and entity protection.
#
# Design goals:
#   - Centralized: one source of truth for dubbing system prompts
#   - Reusable: consumed by adaptation_engine AND translation_service
#   - Modular: compose constraints independently (system prompt, character,
#              timing, validation, entity protection)
#   - Configurable: tune via env vars without code changes
# =============================================================================

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# STEP 1 — Global Dubbing System Prompt
# ---------------------------------------------------------------------------

DUBBING_SYSTEM_PROMPT = """You are a professional cinematic dubbing adapter.

Your job is to adapt dialogue for spoken film dubbing.

CRITICAL RULES:
- Never add information not explicitly present.
- Never invent dialogue.
- Preserve exact semantic meaning.
- Preserve emotional intent.
- Preserve character personality.
- Prefer short conversational English.
- Keep dialogue concise.
- Optimize for spoken performance.
- Preserve lip-sync suitability.
- Avoid exposition.
- Avoid formal phrasing.
- Avoid unnecessary filler words.
- Avoid idioms unless culturally necessary.
- Do NOT invent off-screen dialogue or imagined responses.
- Do NOT add reactions, acknowledgements, or filler.
- Do NOT merge segments or cross-reference dialogue between segments.
- Do NOT prefix lines with character names or speaker tags.
- Each segment is independent. Only adapt the text provided for that segment.
- ONLY work with the text explicitly provided in the input. Do NOT use external knowledge of movies, books, historical facts, or cultural context.
- Do NOT "improve", "correct", or "authenticate" names, titles, or dialogue based on your training data.
- If a name appears in the input, use it EXACTLY. If it does not appear, do NOT invent it.
- NEVER hallucinate character names, places, or events.
- NEVER "correct" a name using your training data. If the input says "Master Chin", do NOT change it to "Master Qin", "Master Chen", or any other variant.
- NEVER change romanization. If the input says "Wing Chun", do NOT change it to "Wen Chun" or "Yong Chun".
- Tokens like [[ENTITY:n]] are protected placeholders. Preserve them EXACTLY. Do NOT replace them with real names.
- Do not generate acknowledgements or filler reactions.
- Do not invent off-screen dialogue.
- Preserve pacing suitable for cinematic dubbing.
- Each segment is a SEPARATE utterance — never merge, never cross-reference."""


# ---------------------------------------------------------------------------
# STEP 2 — Character Profiles
# ---------------------------------------------------------------------------

@dataclass
class CharacterProfile:
    name: str
    traits: List[str]
    speech_style: str = ""

    def to_prompt(self) -> str:
        traits_str = ", ".join(self.traits)
        return (
            f"CHARACTER PROFILE — {self.name}:\n"
            f"Traits: {traits_str}\n"
            f"Speech style: {self.speech_style}"
        )


# Central character registry — keyed by canonical English name.
# Keys are matched case-insensitively against speaker labels OR against
# detected mentions in the source text.
CHARACTER_REGISTRY: Dict[str, CharacterProfile] = {
    "Ip Man": CharacterProfile(
        name="Ip Man",
        traits=["calm", "restrained", "humble", "concise", "emotionally controlled", "never boastful"],
        speech_style="Speaks with quiet authority. Uses short, deliberate sentences. Never raises his voice. Avoids boasting.",
    ),
    "Master Ip": CharacterProfile(
        name="Master Ip",
        traits=["calm", "restrained", "humble", "concise", "emotionally controlled", "never boastful"],
        speech_style="Speaks with quiet authority. Uses short, deliberate sentences. Never raises his voice. Avoids boasting.",
    ),
    "Lynn": CharacterProfile(
        name="Lynn",
        traits=["energetic", "slightly theatrical", "proud", "confident"],
        speech_style="More animated than Ip Man. Speaks faster and with more enthusiasm. Proud of his martial arts skills.",
    ),
    "Master Shin": CharacterProfile(
        name="Master Shin",
        traits=["aggressive", "competitive", "prideful", "direct"],
        speech_style="Confrontational and direct. Speaks with force and challenge. No humility.",
    ),
    "Master Chin": CharacterProfile(
        name="Master Chin",
        traits=["honorable", "traditional", "respectful"],
        speech_style="Formal but respectful. Values tradition and martial arts honor.",
    ),
    "Ah Chun": CharacterProfile(
        name="Ah Chun",
        traits=["youthful", "eager", "respectful", "innocent"],
        speech_style="Young and earnest. Shows respect to elders. Speaks with enthusiasm and innocence.",
    ),
    "Ah Jun": CharacterProfile(
        name="Ah Jun",
        traits=["youthful", "eager", "curious", "innocent"],
        speech_style="Young child. Short, direct sentences. Speaks with wide-eyed curiosity.",
    ),
}

# Common name aliases / alternate spellings that map to canonical keys
CHARACTER_ALIASES: Dict[str, str] = {
    "yip man": "Ip Man",
    "ye wen": "Ip Man",
    "ipman": "Ip Man",
    "文哥": "Ip Man",   # informal address for Ip Man (given name 文)
    "master shin": "Master Shin",
    "shin": "Master Shin",
    "金師傅": "Master Shin",
    "master chin": "Master Chin",
    "chin": "Master Chin",
    "chan": "Master Chin",
    "陳師父": "Master Chin",
    "jun": "Ah Jun",
    "ah jun": "Ah Jun",
    "ahchun": "Ah Jun",
    "阿俊": "Ah Jun",
}


def format_character_prompt(profile: "CharacterProfile") -> str:
    """Format a character profile into a prompt section."""
    return profile.to_prompt()


def get_character_profile(speaker_label: str) -> Optional["CharacterProfile"]:
    """Look up a character profile by speaker label (case-insensitive)."""
    if not speaker_label:
        return None
    label_lower = speaker_label.lower().strip()
    for key, profile in CHARACTER_REGISTRY.items():
        if key.lower() == label_lower:
            return profile
    canonical = CHARACTER_ALIASES.get(label_lower)
    if canonical and canonical in CHARACTER_REGISTRY:
        return CHARACTER_REGISTRY[canonical]
    for key, profile in CHARACTER_REGISTRY.items():
        if key.lower() in label_lower or label_lower in key.lower():
            return profile
    return None


def detect_character_from_text(text: str) -> Optional["CharacterProfile"]:
    """Scan source text for known character mentions and return the first matching profile."""
    if not text:
        return None
    text_lower = text.lower()
    for alias, canonical in CHARACTER_ALIASES.items():
        if alias.lower() in text_lower and canonical in CHARACTER_REGISTRY:
            return CHARACTER_REGISTRY[canonical]
    for key, profile in CHARACTER_REGISTRY.items():
        if key.lower() in text_lower:
            return profile
    return None


# ---------------------------------------------------------------------------

@dataclass
class TimingConstraints:
    target_duration: float          # seconds
    preferred_syllables: Tuple[int, int]
    hard_max_syllables: int

    def to_prompt(self) -> str:
        return (
            f"Target duration: {self.target_duration:.1f} seconds\n"
            f"Preferred syllables: {self.preferred_syllables[0]}-{self.preferred_syllables[1]}\n"
            f"Hard max syllables: {self.hard_max_syllables}"
        )


def build_timing_constraints(duration_seconds: float) -> TimingConstraints:
    """Build timing constraints from a source duration slot."""
    # English dubbing: ~3.5 syllables/sec at natural pace
    # CJK source: characters map roughly 1:1 to syllables in English
    sps = 3.5
    preferred_min = max(1, int(duration_seconds * sps * 0.7))
    preferred_max = max(preferred_min + 1, int(duration_seconds * sps * 1.3))
    hard_max = max(preferred_max + 2, int(duration_seconds * sps) + 3)
    return TimingConstraints(
        target_duration=duration_seconds,
        preferred_syllables=(preferred_min, preferred_max),
        hard_max_syllables=hard_max,
    )


# ---------------------------------------------------------------------------
# STEP 4 — Named Entity Protection
# ---------------------------------------------------------------------------

# Protected entities that must NEVER be rewritten, hallucinated,
# or phonetically replaced by the LLM.
PROTECTED_ENTITIES: List[str] = [
    "Ip Man", "Master Ip", "Yip Man",
    "Master Shin",
    "Master Chin",
    "Chin",
    "Chan",
    "Wing Chun",
    "Northern Fist", "Southern Fist",
    "Tai Chi", "kung fu", "martial arts",
    "Miura", "Lam", "Li Zhao",
    "Big brother",
    "Ah Jun",
    "Uncle",
    "Honey",
    "Darling",
    "Daddy",
    "Mommy",
]

_ENTITY_TOKEN_PREFIX = "ENTPROT"


def protect_entities(text: str, extra_entities: Optional[List[str]] = None) -> Tuple[str, List[Tuple[str, str]]]:
    """
    Replace protected entities with placeholder tokens before LLM generation,
    then restore them afterward.

    Returns: (protected_text, list of (placeholder, original) tuples)
    """
    entities = list(PROTECTED_ENTITIES)
    if extra_entities:
        entities.extend(extra_entities)
    replacements: List[Tuple[str, str]] = []
    def _repl(m):
        token = f"[[ENTITY:{len(replacements)}]]"
        replacements.append((token, m.group(1)))
        return token
    _entity_re = re.compile(
        r'\b(' + '|'.join(re.escape(e) for e in sorted(entities, key=len, reverse=True)) + r')\b'
    )
    protected = _entity_re.sub(_repl, text)
    return protected, replacements


def restore_entities(text: str, replacements: list):
    for token, original in replacements:
        text = text.replace(token, original)
    return text


def build_name_mapping_prompt(source_texts: list) -> str:
    """Scan source texts for Chinese aliases and return a prompt section with explicit name mappings."""
    detected = set()
    for text in source_texts:
        for alias, canonical in CHARACTER_ALIASES.items():
            if alias in text:
                detected.add((alias, canonical))
    if not detected:
        return ""
    lines = ["CRITICAL NAME MAPPINGS — translate these Chinese names EXACTLY as shown:"]
    for alias, canonical in sorted(detected):
        lines.append(f'- "{alias}" → "{canonical}"')
    lines.append("Do NOT change romanization. Do NOT use alternate spellings from your training data.")
    return "\n".join(lines)


def fix_translation_names(text: str) -> str:
    """Post-process translation output to fix known hallucinated name variants."""
    fixes = [
        ("Master Qin", "Master Chin"),
        ("Master Chen", "Master Chin"),
        ("brother one", "Brother Wen"),
        ("Wukong street", "Wugu Street"),
        ("Wukong Street", "Wugu Street"),
        ("Wugu street", "Wugu Street"),
    ]
    for wrong, right in fixes:
        text = re.sub(rf"\b{re.escape(wrong)}\b", right, text, flags=re.IGNORECASE)
    return text


# ---------------------------------------------------------------------------
# STEP 5 — No-Hallucination Guards
# ---------------------------------------------------------------------------

NO_HALLUCINATION_GUARDS = """HALLUCINATION GUARDS:
- Do NOT add reactions ("Well said.", "Good point.", "I agree.")
- Do NOT add acknowledgements ("Okay then.", "Sure thing.", "Right.")
- Do NOT continue unfinished thoughts from the source.
- Do NOT create conversational filler.
- Do NOT append emotional commentary.
- Do NOT prepend speaker tags or stage directions.
- Do NOT expand the line beyond what the source explicitly conveys.
- Do NOT invent backstory or context not present in the source.
- Do NOT translate literally word-for-word if it breaks natural rhythm; instead, preserve intent with natural phrasing.
- Do NOT merge adjacent segments or reference dialogue outside the current segment.
- Do NOT hallucinate off-screen speakers or add imagined responses."""


# ---------------------------------------------------------------------------
# STEP 6 — Generation Config (Temperature / Top-p per variant)
# ---------------------------------------------------------------------------

@dataclass
class GenerationConfig:
    temperature: float
    top_p: float
    priority: str


VARIANT_GENERATION_CONFIG: Dict[str, GenerationConfig] = {
    "faithful": GenerationConfig(
        temperature=0.3,
        top_p=0.7,
        priority="semantic_preservation",
    ),
    "performable": GenerationConfig(
        temperature=0.3,
        top_p=0.7,
        priority="conversational_naturalness",
    ),
    "sync_fit": GenerationConfig(
        temperature=0.2,
        top_p=0.6,
        priority="syllable_timing",
    ),
}


def get_variant_config(variant_type: str) -> GenerationConfig:
    return VARIANT_GENERATION_CONFIG.get(variant_type, VARIANT_GENERATION_CONFIG["performable"])


# ---------------------------------------------------------------------------
# STEP 7 — Validation Rules & Lightweight Validation Stage
# ---------------------------------------------------------------------------

@dataclass
class ValidationRules:
    max_syllable_delta: int = 2
    forbid_hallucinations: bool = True
    check_semantic_drift: bool = True
    min_variants: int = 3
    max_variants: int = 3


DEFAULT_VALIDATION_RULES = ValidationRules()


@dataclass
class ValidationResult:
    valid: bool
    reason: str = ""
    severity: str = "pass"  # pass | warn | fail


def _count_syllables(text: str) -> int:
    """Rough syllable count for validation purposes."""
    if not text:
        return 0
    cjk_chars = len(re.findall(r"[一-鿿぀-ゟ゠-ヿ가-힯]", text))
    if cjk_chars > len(text) * 0.4:
        return cjk_chars
    vowel_re = re.compile(r"[aeiouAEIOU]+")
    return sum(max(1, len(vowel_re.findall(w))) for w in text.strip().split())


def validate_adaptation(
    source_text: str,
    adapted_text: str,
    target_duration: float,
    rules: ValidationRules = DEFAULT_VALIDATION_RULES,
    protected_replacements: Optional[List[Tuple[str, str]]] = None,
) -> ValidationResult:
    """
    Lightweight validation of a single adapted line.
    Checks for hallucinations, semantic drift, syllable count, and entity integrity.
    """
    adapted = adapted_text.strip()
    source = source_text.strip()

    if not adapted:
        return ValidationResult(valid=False, reason="Empty adaptation output", severity="fail")

    # 1. Entity integrity check — ensure no protected entities were mangled
    if protected_replacements:
        for placeholder, original in protected_replacements:
            if placeholder in adapted or placeholder.lower() in adapted.lower():
                # Placeholder leaked through — entity was not restored properly
                continue
            # Check if original entity is preserved in adapted text
            if original.lower() not in adapted.lower():
                # Entity might have been rewritten — flag it
                if any(e.lower() in source.lower() for e in PROTECTED_ENTITIES if e.lower() == original.lower()):
                    return ValidationResult(
                        valid=False,
                        reason=f"Protected entity '{original}' missing or rewritten in adaptation",
                        severity="fail",
                    )

    # 2. Hallucinated name detection — catch invented proper nouns not in source
    # Extract capitalized words/phrases from adapted text that look like names
    _name_pattern = re.compile(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b')
    adapted_names = set(_name_pattern.findall(adapted))
    # Build set of acceptable names from source + protected entities
    acceptable_names = set(_name_pattern.findall(source))
    for ent in PROTECTED_ENTITIES:
        acceptable_names.add(ent)
        # Also add individual words of multi-word entities
        acceptable_names.update(ent.split())
    # Check for names in adapted that aren't in acceptable set
    for name in adapted_names:
        if len(name) > 3 and name.lower() not in (n.lower() for n in acceptable_names):
            # Likely hallucinated name — fail unless it's a common English word
            common_words = {"Please", "Okay", "Alright", "Sure", "Right", "Hello", "Goodbye", "Thanks", "Sorry"}
            if name not in common_words:
                return ValidationResult(
                    valid=False,
                    reason=f"Hallucinated name '{name}' detected — not in source text or protected entities",
                    severity="fail",
                )

    # 2b. Missing protected entity check — catch modified names like "Master Qin" instead of "Master Chin"
    for entity in PROTECTED_ENTITIES:
        if entity.lower() in source.lower() and entity.lower() not in adapted.lower():
            return ValidationResult(
                valid=False,
                reason=f"Protected entity '{entity}' missing from adaptation — name was changed or removed",
                severity="fail",
            )

    # 3. Syllable count vs timing
    syllables = _count_syllables(adapted)
    timing = build_timing_constraints(target_duration)
    delta = syllables - timing.preferred_syllables[1]
    if delta > rules.max_syllable_delta:
        return ValidationResult(
            valid=False,
            reason=f"Syllable count {syllables} exceeds preferred max {timing.preferred_syllables[1]} by {delta} (hard max: {timing.hard_max_syllables})",
            severity="warn",
        )

    # 3. Hallucination heuristics — detect common LLM additions
    hallucination_patterns = [
        r"^(Well said|Good point|I agree|Right\.|Okay then|Sure thing)",
        r"\b(off[- ]?screen|in the background|we hear|voice over)\b",
        r"\b(meanwhile|later|earlier|after that|before this)\b",
    ]
    for pattern in hallucination_patterns:
        if re.search(pattern, adapted, re.IGNORECASE):
            return ValidationResult(
                valid=False,
                reason=f"Detected hallucinated content matching pattern: {pattern}",
                severity="fail",
            )

    # 4. Semantic drift — if source contains CJK, adapted should NOT contain CJK
    cjk_in_source = bool(re.search(r"[\u4e00-\u9fff]", source))
    if cjk_in_source and re.search(r"[\u4e00-\u9fff]", adapted):
        return ValidationResult(
            valid=False,
            reason="Adaptation contains untranslated CJK characters",
            severity="fail",
        )

    # 5. Length sanity — adapted should not be drastically longer than source
    # (rough heuristic: English is ~1.5x longer in chars than CJK for same meaning)
    if source and not cjk_in_source:
        # Both are Latin scripts — ratio check
        if len(adapted) > len(source) * 2.5:
            return ValidationResult(
                valid=False,
                reason=f"Adaptation is {len(adapted) / len(source):.1f}x longer than source — possible expansion hallucination",
                severity="warn",
            )

    return ValidationResult(valid=True, reason="Validation passed", severity="pass")


# ---------------------------------------------------------------------------
# STEP 8 — Prompt Composition Utilities
# ---------------------------------------------------------------------------

def build_system_prompt(
    character_profile: Optional[CharacterProfile] = None,
    timing_constraints: Optional[TimingConstraints] = None,
) -> str:
    """Compose the full system prompt from reusable policy components."""
    parts = [DUBBING_SYSTEM_PROMPT]

    if character_profile:
        parts.append("")
        parts.append(format_character_prompt(character_profile))

    if timing_constraints:
        parts.append("")
        parts.append("TIMING CONSTRAINTS:")
        parts.append(timing_constraints.to_prompt())

    parts.append("")
    parts.append(NO_HALLUCINATION_GUARDS)

    return "\n".join(parts)


def build_segment_prompt(
    segment: Dict[str, Any],
    source_language: str,
    target_language: str,
    scene_context: Optional[str] = None,
) -> Tuple[str, List[Tuple[str, str]], Optional[CharacterProfile], TimingConstraints]:
    """
    Build the per-segment adaptation prompt with entity protection,
    character profile injection, and timing constraints.

    Returns: (protected_prompt_text, entity_replacements, character_profile, timing_constraints)
    """
    source_text = segment.get("source_text", "")
    target_text = segment.get("target_text", "")
    duration = segment.get("source_duration", 2.0)
    speaker_id = segment.get("speaker_id", "")
    speaker_label = segment.get("speaker_label", "") or speaker_id

    # Detect character profile from speaker label or text content
    profile = get_character_profile(speaker_label)
    if not profile:
        profile = detect_character_from_text(source_text)

    timing = build_timing_constraints(duration)

    # Protect entities in source and target text
    protected_source, replacements_source = protect_entities(source_text)
    protected_target, replacements_target = protect_entities(target_text)

    # Merge replacements (deduplicate by placeholder)
    all_replacements = dict(replacements_source)
    all_replacements.update(replacements_target)
    replacements = list(all_replacements.items())

    parts = [
        f"Source language: {source_language}",
        f"Target language: {target_language}",
    ]
    if scene_context:
        parts.append(f"Scene context: {scene_context}")
    if profile:
        parts.append("")
        parts.append(format_character_prompt(profile))
    parts.append("")
    parts.append("TIMING CONSTRAINTS:")
    parts.append(timing.to_prompt())
    parts.append("")
    parts.append("SOURCE LINE:")
    parts.append(protected_source)
    if protected_target:
        parts.append("")
        parts.append("LITERAL TRANSLATION:")
        parts.append(protected_target)
    parts.append("")
    parts.append("Adapt the line for cinematic dubbing. Output ONLY the adapted line — no commentary, no explanation, no quotes.")

    return "\n".join(parts), replacements, profile, timing


# ---------------------------------------------------------------------------
# STEP 9 — Env-based Configuration Overrides
# ---------------------------------------------------------------------------

def load_policy_config() -> Dict[str, Any]:
    """
    Load tunable policy parameters from environment variables.
    This allows operators to adjust constraint strength without code changes.
    """
    return {
        "system_prompt_override": os.getenv("DUB_SYSTEM_PROMPT", "").strip(),
        "temperature_default": float(os.getenv("DUB_TEMPERATURE", "0.3")),
        "top_p_default": float(os.getenv("DUB_TOP_P", "0.7")),
        "temperature_sync_fit": float(os.getenv("DUB_TEMPERATURE_SYNC", "0.2")),
        "top_p_sync_fit": float(os.getenv("DUB_TOP_P_SYNC", "0.6")),
        "max_syllable_delta": int(os.getenv("DUB_MAX_SYLLABLE_DELTA", "2")),
        "forbid_hallucinations": os.getenv("DUB_FORBID_HALLUCINATIONS", "true").lower() == "true",
        "entity_protection": os.getenv("DUB_ENTITY_PROTECTION", "true").lower() == "true",
    }


def apply_env_overrides(config: Dict[str, Any]) -> None:
    """Apply environment overrides to global policy constants (call once at startup)."""
    global DUBBING_SYSTEM_PROMPT, DEFAULT_VALIDATION_RULES

    if config.get("system_prompt_override"):
        DUBBING_SYSTEM_PROMPT = config["system_prompt_override"]

    DEFAULT_VALIDATION_RULES.max_syllable_delta = config["max_syllable_delta"]
    DEFAULT_VALIDATION_RULES.forbid_hallucinations = config["forbid_hallucinations"]

    VARIANT_GENERATION_CONFIG["faithful"].temperature = config["temperature_default"]
    VARIANT_GENERATION_CONFIG["faithful"].top_p = config["top_p_default"]
    VARIANT_GENERATION_CONFIG["performable"].temperature = config["temperature_default"]
    VARIANT_GENERATION_CONFIG["performable"].top_p = config["top_p_default"]
    VARIANT_GENERATION_CONFIG["sync_fit"].temperature = config["temperature_sync_fit"]
    VARIANT_GENERATION_CONFIG["sync_fit"].top_p = config["top_p_sync_fit"]

    logger.info("[POLICY] Loaded environment overrides for dubbing adaptation policy")


# Auto-apply on module load
apply_env_overrides(load_policy_config())
