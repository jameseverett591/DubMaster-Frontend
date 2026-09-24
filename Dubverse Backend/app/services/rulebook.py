# =============================================================================
# Rulebook Service — Feature B of the Dubbing Studio Platform spec
# (plan-8012dcdb5d41cf3b.md)
#
# Every directorial decision is a RULE: a typed, scoped, reviewable override
# that steers translation/adaptation/TTS. Rules live at two scopes:
#
#   - job    → data/dubbed/{job_id}/rulebook.json   (staging area)
#   - global → Supabase `director_rules` table      (the cross-job moat)
#
# Precedence (spec §10): job rules override global rules; explicit rules
# override inferred ones. resolve_rules() merges global first, then job.
#
# Application is never silent — the resolved ruleset carries applied_rule_ids
# so the UI can show "Rules applied (N)" per segment and the translation log
# can say which rule fired.
# =============================================================================

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.config import get_settings

logger = logging.getLogger(__name__)

# Spec §5.1 — the six rule classes.
RULE_CLASSES = {
    "name_mapping",     # source name/term → forced English rendering
    "persona",          # speaker slot → character profile (register + delivery)
    "stance",           # scene-style directive, fires when conditions match
    "translation_fix",  # exact source line → forced target line
    "pronunciation",    # displayed term → spoken respelling for TTS only
    "delivery",         # speaker → emotion/speed/pitch defaults for TTS
    "glossary",         # source term → canonical English term
}

# Rule classes that apply to the whole job's prompt vs. per-segment matching.
_PROMPT_LEVEL_CLASSES = {"stance"}


def _rulebook_path(job_id: str) -> str:
    return os.path.join(get_settings().DUBBED_DIR, job_id, "rulebook.json")


def new_rule(
    rule_class: str,
    source_pattern: str = "",
    target: str = "",
    scope: str = "job",
    conditions: Optional[Dict[str, Any]] = None,
    notes: str = "",
    created_from_job: Optional[str] = None,
    inferred: bool = False,
) -> Dict[str, Any]:
    """Create a rule dict with spec §5.3 fields. inferred=True marks a rule
    captured from an edit diff — it is a SUGGESTION until the director accepts
    it (enabled stays False), per the 'nothing is learned silently' guard."""
    return {
        "id": uuid.uuid4().hex[:12],
        "class": rule_class if rule_class in RULE_CLASSES else "translation_fix",
        "scope": scope if scope in {"job", "global"} else "job",
        "source_pattern": source_pattern or "",
        "target": target or "",
        "conditions": conditions or {},
        "enabled": not inferred,   # inferred rules arrive disabled — review first
        "inferred": inferred,
        "created_from_job": created_from_job,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "notes": notes or "",
    }


def load_job_rules(job_id: str) -> List[Dict[str, Any]]:
    """Per-job rules from disk. Missing/corrupt file → empty list, never raise."""
    path = _rulebook_path(job_id)
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        rules = data.get("rules", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
        return [r for r in rules if isinstance(r, dict) and r.get("class") in RULE_CLASSES]
    except Exception as exc:
        logger.warning(f"[RULEBOOK] {job_id}: failed to load {path}: {exc}")
        return []


def save_job_rules(job_id: str, rules: List[Dict[str, Any]]) -> None:
    path = _rulebook_path(job_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"rules": rules}, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Global scope — Supabase `director_rules`, keyed by user_id.
# Columns: id (text pk), user_id, class, source_pattern, target, conditions
# (jsonb), enabled (bool), inferred (bool), created_from_job, notes, created_at.
# If the table is absent the global scope degrades to empty — job rules still
# work, and nothing breaks.
# ---------------------------------------------------------------------------

def load_global_rules(user_id: str) -> List[Dict[str, Any]]:
    if not user_id:
        return []
    try:
        from app.services.supabase_client import supabase_writer
        result = (
            supabase_writer.table("director_rules")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=False)
            .execute()
        )
        rules = result.data or []
        for r in rules:
            r["scope"] = "global"
        return rules
    except Exception as exc:
        logger.warning(f"[RULEBOOK] global load failed for {user_id}: {exc}")
        return []


def save_global_rule(user_id: str, rule: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Insert or upsert a global rule. Returns the stored row or None."""
    if not user_id:
        return None
    # Only send columns the director_rules table actually has — a rule dict
    # may carry extras that PostgREST would reject outright.
    _COLS = ("id", "class", "scope", "source_pattern", "target", "conditions",
             "enabled", "inferred", "created_from_job", "notes", "created_at")
    row = {k: v for k, v in rule.items() if k in _COLS}
    row["user_id"] = user_id
    row["scope"] = "global"
    try:
        from app.services.supabase_client import supabase_writer
        result = supabase_writer.table("director_rules").upsert(row).execute()
        return (result.data or [rule])[0]
    except Exception as exc:
        logger.warning(f"[RULEBOOK] global save failed for {user_id}: {exc}")
        return None


def delete_global_rule(user_id: str, rule_id: str) -> bool:
    try:
        from app.services.supabase_client import supabase_writer
        supabase_writer.table("director_rules") \
            .delete() \
            .eq("id", rule_id) \
            .eq("user_id", user_id) \
            .execute()
        return True
    except Exception as exc:
        logger.warning(f"[RULEBOOK] global delete failed for {user_id}: {exc}")
        return False


# ---------------------------------------------------------------------------
# Resolution — merge scopes into the params the pipeline already understands.
# ---------------------------------------------------------------------------

# Language families a rule can be scoped to via conditions.languages.
# A rule carrying conditions.languages=["yue","zh","cmn",...] only applies
# when the job's source language is in that set; no languages condition
# means the rule applies to every job.
CJK_SOURCE_LANGS = {
    "yue", "zh-yue", "zh-hk", "yue-hk", "zh", "cmn", "zho",
    "zh-cn", "zh-tw", "zh-hans", "zh-hant", "zh-sg",
}

# UI shortcut: the "Cantonese / Mandarin" section in the panel is just a
# languages condition pre-filled with the CJK family.
CJK_LANGUAGE_SCOPE = sorted(CJK_SOURCE_LANGS)


def _language_matches(rule: Dict[str, Any], source_language: Optional[str]) -> bool:
    """A rule applies when it carries no languages condition (global to all
    source languages) or when the job's source language is in its list."""
    langs = (rule.get("conditions") or {}).get("languages")
    if not langs:
        return True
    src = (source_language or "").lower().strip()
    if not src:
        return False
    return src in {str(l).lower().strip() for l in langs}


def resolve_rules(
    job_rules: Optional[List[Dict[str, Any]]] = None,
    global_rules: Optional[List[Dict[str, Any]]] = None,
    source_language: Optional[str] = None,
) -> Dict[str, Any]:
    """Effective ruleset for one job.

    Global rules apply first; job rules override them (spec §10 precedence:
    job > global, explicit > inferred). Disabled rules never apply — an
    inferred rule arrives disabled until the director accepts it. Rules
    carrying conditions.languages only fire when the job's source language
    matches (the Cantonese/Mandarin section).

    Returns the merged translation/TTS params plus the rule ids that fired,
    so "Rules applied (N)" is a fact, not a guess.
    """
    all_rules = [
        r for r in (global_rules or []) + (job_rules or [])
        if r.get("enabled") and _language_matches(r, source_language)
    ]

    localized_aliases: Dict[str, str] = {}
    character_profiles: Dict[str, Dict[str, Any]] = {}   # keyed by name — job wins
    stance_directives: List[str] = []
    translation_fixes: Dict[str, str] = {}
    pronunciations: Dict[str, str] = {}                  # displayed term → spoken form
    delivery: Dict[str, Dict[str, Any]] = {}             # keyed by speaker
    applied_rule_ids: List[str] = []

    for rule in all_rules:
        cls = rule.get("class")
        src = (rule.get("source_pattern") or "").strip()
        tgt = (rule.get("target") or "").strip()
        cond = rule.get("conditions") or {}
        applied_rule_ids.append(rule.get("id", ""))

        if cls in ("name_mapping", "glossary") and src and tgt:
            localized_aliases[src] = tgt
        elif cls == "persona":
            # conditions.speaker = speaker slot; target = character name;
            # notes/conditions carry traits + speech_style.
            speaker = (cond.get("speaker") or src or "").strip()
            if speaker:
                traits = cond.get("traits") or []
                if isinstance(traits, str):
                    traits = [t.strip() for t in traits.split(",") if t.strip()]
                character_profiles[tgt or speaker] = {
                    "name": tgt or speaker,
                    "speaker": speaker,
                    "traits": traits,
                    "speech_style": cond.get("speech_style") or rule.get("notes", ""),
                }
        elif cls == "stance" and tgt:
            # A stance rule's target IS the directive; conditions annotate when
            # it should fire so the model can judge scene fit.
            when = cond.get("stakes_tags") or cond.get("when") or ""
            when_str = ", ".join(when) if isinstance(when, list) else str(when)
            stance_directives.append(
                f"- {tgt}" + (f" (when: {when_str})" if when_str else "")
            )
        elif cls == "translation_fix" and src and tgt:
            translation_fixes[src] = tgt
        elif cls == "pronunciation" and src and tgt:
            pronunciations[src] = tgt
        elif cls == "delivery":
            speaker = (cond.get("speaker") or src or "").strip()
            if speaker:
                delivery[speaker] = {
                    "emotion": cond.get("emotion"),
                    "speed": cond.get("speed"),
                    "pitch": cond.get("pitch"),
                }

    return {
        "localized_aliases": localized_aliases,
        "character_profiles": list(character_profiles.values()),
        "stance_directives": stance_directives,
        "translation_fixes": translation_fixes,
        "pronunciations": pronunciations,
        "delivery": delivery,
        "applied_rule_ids": [rid for rid in applied_rule_ids if rid],
    }


def merge_character_profiles(
    existing: Optional[List[Dict[str, Any]]],
    rule_profiles: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Rulebook personas override same-named existing profiles (director's
    explicit decision beats the stored default); otherwise they append."""
    if not rule_profiles:
        return existing or []
    merged: Dict[str, Dict[str, Any]] = {}
    for cp in existing or []:
        if isinstance(cp, dict) and cp.get("name"):
            merged[cp["name"]] = cp
    for rp in rule_profiles:
        merged[rp["name"]] = rp
    return list(merged.values())


def apply_translation_fixes(
    segments: List[Dict[str, Any]],
    fixes: Dict[str, str],
) -> int:
    """Post-translation hard overrides: a segment whose SOURCE text exactly
    matches a translation_fix pattern gets the rule's target verbatim.

    Exact-match only — substring rewriting inside a translated line would fight
    the translation itself. Partial matches are already covered by the prompt
    hint in build_rulebook_prompt. Returns the count of segments overridden.
    """
    if not fixes:
        return 0
    applied = 0
    norm = {k.strip(): v for k, v in fixes.items()}
    for seg in segments:
        # Match against the SOURCE line, not the translated text — after
        # translation, seg["text"] IS the English output; the original lives
        # in source_text (and in the pre-translation path, text itself).
        src = (seg.get("source_text") or "").strip()
        if src and src in norm:
            seg["text"] = norm[src]
            seg["rulebook_fix"] = True
            applied += 1
    if applied:
        logger.info(f"[RULEBOOK] translation_fix applied to {applied} segment(s)")
    return applied


def apply_pronunciations(
    text: str,
    pronunciations: Optional[Dict[str, str]] = None,
) -> str:
    """Respell display text into its spoken form for TTS — e.g. 'Ip Man' is
    spoken as 'Yip Man'. Synthesis-only: the subtitle/transcript text is never
    touched, so 'Ip Man' still displays while the voice says 'Yip Man'.

    Matching is case-insensitive with word-edge boundaries on both sides, so a
    rule for 'Ip' cannot chew the inside of 'Ipswich'. Returns text unchanged
    when nothing matches.
    """
    if not text or not pronunciations:
        return text
    out = text
    for src, tgt in pronunciations.items():
        if not src or not tgt:
            continue
        pattern = re.compile(
            r"(?<![A-Za-z])" + re.escape(src.strip()) + r"(?![A-Za-z])",
            re.IGNORECASE,
        )
        out = pattern.sub(tgt.strip(), out)
    return out


def build_rulebook_prompt(directives: List[str], fixes: Dict[str, str]) -> str:
    """Prompt section carrying the director's standing rules. Stance directives
    steer register; translation fixes are named overrides the model must use
    whenever the source line appears (exact or partial)."""
    parts: List[str] = []
    if directives:
        parts.append("DIRECTOR'S STANDING RULES — apply these throughout:")
        parts.extend(directives)
    if fixes:
        parts.append("")
        parts.append("DIRECTOR'S TRANSLATION OVERRIDES — when these source lines appear, use the given rendering exactly:")
        for src, tgt in fixes.items():
            parts.append(f'- "{src}" → "{tgt}"')
    return "\n".join(parts)
