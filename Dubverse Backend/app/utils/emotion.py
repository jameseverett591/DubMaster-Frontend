"""
Lightweight utterance emotion analysis.

Analyses each TTS segment's text and returns ElevenLabs-compatible
voice_settings (stability, similarity_boost, style) derived from
punctuation patterns, ALL-CAPS emphasis, and emotion keyword banks.

ElevenLabs voice_settings semantics
------------------------------------
stability        0.0-1.0   low  = more expressive / variable
                           high = more consistent / calm
similarity_boost 0.0-1.0   high keeps the voice close to the trained model
style            0.0-1.0   0.0  = flat/robotic narration
                           1.0  = highly emotive character performance
"""

import re
from typing import Dict

# ---------------------------------------------------------------------------
# Emotion keyword banks (lowercase, space-separated phrases are also checked)
# ---------------------------------------------------------------------------
_ANGER   = {
    "furious", "angry", "rage", "hate", "damn", "bastard", "idiot",
    "shut up", "stop it", "how dare", "outrageous",
    # Confrontation (only actual insults/aggression)
    "brat", "you little",
}
_FEAR    = {
    "scared", "terrified", "afraid", "help", "run", "danger",
    "please no", "no no", "watch out", "behind you",
}
_CONCERN = {
    "are you okay", "are you alright", "what happened",
}
_JOY     = {
    "amazing", "wonderful", "fantastic", "love", "great", "yay",
    "hooray", "excited", "happy", "incredible", "brilliant",
    "perfect", "awesome", "thrilled", "delighted",
    # Confident / impressed
    "of course",
}
_SADNESS = {
    "sorry", "sad", "miss", "lonely", "hurt", "crying", "goodbye",
    "farewell", "never", "pain", "terrible", "awful",
    "depressed", "heartbroken", "devastated",
}
_HUMBLE = {
    # Defeat admitted calmly, teaching moments, self-reflection
    "i lost", "that's enough", "enough",
}
_SURPRISE = {
    "wow", "really", "no way", "unbelievable", "impossible",
    "seriously", "oh my", "what the",
}
# Calm authority: wise teaching, philosophical statements.
# These should sound measured and composed, NOT aggressive.
_AUTHORITY = {
    "doesn't discriminate", "it's not about", "you're wrong",
    "kung fu", "wing chun", "northern fist", "southern fist",
    "your problem", "it's your problem",
    "mind your language", "watch your mouth",
}


def analyze_emotion(text: str) -> Dict[str, float]:
    """
    Analyse utterance text and return recommended ElevenLabs voice settings.

    Returns a dict with keys: stability, similarity_boost, style.
    """
    if not text or not text.strip():
        return _settings(style=0.50, stability=0.40)

    t       = text.strip()
    t_lower = t.lower()

    # --- punctuation signals ---
    exclamations = t.count("!")
    questions    = t.count("?")
    ellipses     = t.count("...")
    caps_words   = len(re.findall(r"\b[A-Z]{2,}\b", t))   # ALL-CAPS words

    # --- keyword scan (token-level) ---
    tokens = set(re.split(r"[\s,\.!?;:\"']+", t_lower))

    anger     = bool(tokens & _ANGER)    or any(p in t_lower for p in _ANGER     if " " in p)
    fear      = bool(tokens & _FEAR)     or any(p in t_lower for p in _FEAR      if " " in p)
    concern   = any(p in t_lower for p in _CONCERN)
    joy       = bool(tokens & _JOY)      or any(p in t_lower for p in _JOY       if " " in p)
    sadness   = bool(tokens & _SADNESS)  or any(p in t_lower for p in _SADNESS   if " " in p)
    humble    = any(p in t_lower for p in _HUMBLE)
    surprise  = bool(tokens & _SURPRISE) or any(p in t_lower for p in _SURPRISE  if " " in p)
    authority = any(p in t_lower for p in _AUTHORITY)

    # Short utterances (< 5 words) tend to be punchy — boost expressiveness
    word_count = len(t.split())
    short = word_count <= 4

    # ------------------------------------------------------------------
    # Map signals -> settings
    # Authority/humble OVERRIDE anger/surprise so that calm teaching
    # moments don't get delivered as shouting.
    # ------------------------------------------------------------------

    if authority:
        # Calm, wise, measured — Ip Man teaching, philosophical statements.
        # High stability = consistent/composed delivery.
        return _settings(style=0.45, stability=0.55)

    if humble:
        # Admitting defeat gracefully, self-reflection.
        # Soft and measured, not dramatic.
        return _settings(style=0.35, stability=0.60)

    if anger or (exclamations >= 2) or caps_words >= 2:
        # Intense / confrontational (actual anger, not teaching)
        return _settings(style=0.80, stability=0.25)

    if concern:
        # Worried / checking on someone — warm, not panicked
        return _settings(style=0.60, stability=0.40)

    if fear:
        # Panicked / anxious
        return _settings(style=0.75, stability=0.30)

    if joy or (exclamations == 1 and not sadness and not ellipses):
        # Excited / cheerful
        return _settings(style=0.70, stability=0.30)

    if surprise and questions:
        # "What?! Really?!" - punchy and expressive
        return _settings(style=0.70, stability=0.30)

    if surprise:
        return _settings(style=0.65, stability=0.35)

    if sadness:
        # Sorrowful — softer and measured
        return _settings(style=0.35, stability=0.55)

    if ellipses:
        # Hesitant / trailing off
        return _settings(style=0.30, stability=0.55)

    if questions:
        # Genuine question - mild uplift
        return _settings(style=0.55, stability=0.40)

    if exclamations == 1:
        # Single emphasis marker
        return _settings(style=0.60, stability=0.35)

    # Default: natural conversational delivery (short or long)
    return _settings(style=0.45, stability=0.45)


def _settings(style: float, stability: float) -> Dict[str, float]:
    return {
        "style":            round(min(max(style,     0.0), 1.0), 2),
        "stability":        round(min(max(stability, 0.0), 1.0), 2),
        "similarity_boost": 0.90,   # keep voice identity consistent
    }


# ---------------------------------------------------------------------------
# Fish Audio emotion tag mapping
# ---------------------------------------------------------------------------

def analyze_emotion_fish(text: str) -> str:
    """
    Analyse utterance text and return Fish Audio inline emotion tags.

    Fish Audio tags are placed at the start of the sentence, e.g. ``(angry)``.
    Returns a SINGLE tag string like ``"(calm)"`` or ``""`` for neutral.

    Uses only single, moderate-intensity tags to avoid the "overly excited"
    problem that occurred when doubling up tags like ``(angry)(shouting)``.
    """
    if not text or not text.strip():
        return ""

    t = text.strip()
    t_lower = t.lower()

    # --- punctuation signals ---
    exclamations = t.count("!")
    questions = t.count("?")
    ellipses = t.count("...")
    caps_words = len(re.findall(r"\b[A-Z]{2,}\b", t))

    # --- keyword scan (reuse existing banks) ---
    tokens = set(re.split(r"[\s,\.!?;:\"']+", t_lower))

    anger     = bool(tokens & _ANGER)    or any(p in t_lower for p in _ANGER     if " " in p)
    fear      = bool(tokens & _FEAR)     or any(p in t_lower for p in _FEAR      if " " in p)
    concern   = any(p in t_lower for p in _CONCERN)
    joy       = bool(tokens & _JOY)      or any(p in t_lower for p in _JOY       if " " in p)
    sadness   = bool(tokens & _SADNESS)  or any(p in t_lower for p in _SADNESS   if " " in p)
    humble    = any(p in t_lower for p in _HUMBLE)
    surprise  = bool(tokens & _SURPRISE) or any(p in t_lower for p in _SURPRISE  if " " in p)
    authority = any(p in t_lower for p in _AUTHORITY)

    # --- Map to Fish Audio inline tags ---
    # SINGLE tags only — no doubling.  Avoids the overly-excited delivery
    # that occurred with stacked tags like (angry)(shouting).

    if authority:
        return "(calm)"

    if humble:
        return "(calm)"

    if anger or (exclamations >= 2) or caps_words >= 2:
        return "(angry)"

    if concern:
        return "(concerned)"

    if fear:
        return "(scared)"

    if joy or (exclamations == 1 and not sadness and not ellipses):
        return "(happy)"

    if surprise:
        return "(surprised)"

    if sadness:
        return "(sad)"

    if ellipses:
        return ""  # no "hesitating" tag — let voice cloning handle pauses

    if questions:
        return ""  # natural question intonation from text itself

    # Default: no tag — let Fish Audio's natural delivery handle it
    return ""
