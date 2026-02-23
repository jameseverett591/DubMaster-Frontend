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
}
_FEAR    = {
    "scared", "terrified", "afraid", "help", "run", "danger",
    "please no", "no no", "watch out", "behind you",
}
_JOY     = {
    "amazing", "wonderful", "fantastic", "love", "great", "yay",
    "hooray", "excited", "happy", "incredible", "brilliant",
    "perfect", "awesome", "thrilled", "delighted",
}
_SADNESS = {
    "sorry", "sad", "miss", "lonely", "hurt", "crying", "goodbye",
    "farewell", "never", "lost", "pain", "terrible", "awful",
    "depressed", "heartbroken", "devastated",
}
_SURPRISE = {
    "wow", "really", "no way", "unbelievable", "impossible",
    "seriously", "oh my", "what the",
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

    anger    = bool(tokens & _ANGER)   or any(p in t_lower for p in _ANGER   if " " in p)
    fear     = bool(tokens & _FEAR)    or any(p in t_lower for p in _FEAR    if " " in p)
    joy      = bool(tokens & _JOY)     or any(p in t_lower for p in _JOY     if " " in p)
    sadness  = bool(tokens & _SADNESS) or any(p in t_lower for p in _SADNESS if " " in p)
    surprise = bool(tokens & _SURPRISE)or any(p in t_lower for p in _SURPRISE if " " in p)

    # ------------------------------------------------------------------
    # Map signals -> settings (highest emotion wins via early return)
    # ------------------------------------------------------------------

    if anger or (exclamations >= 2) or caps_words >= 2:
        # Intense / confrontational
        return _settings(style=0.85, stability=0.20)

    if fear:
        # Panicked / anxious
        return _settings(style=0.80, stability=0.25)

    if joy or (exclamations == 1 and not sadness and not ellipses):
        # Excited / cheerful
        return _settings(style=0.75, stability=0.25)

    if surprise and questions:
        # "What?! Really?!" - punchy and expressive
        return _settings(style=0.78, stability=0.25)

    if surprise:
        return _settings(style=0.70, stability=0.30)

    if sadness:
        # Sorrowful / mourning - softer and measured
        return _settings(style=0.35, stability=0.60)

    if ellipses:
        # Hesitant / trailing off
        return _settings(style=0.30, stability=0.55)

    if questions:
        # Genuine question - mild uplift in expressiveness
        return _settings(style=0.55, stability=0.38)

    if exclamations == 1:
        # Single emphasis marker
        return _settings(style=0.65, stability=0.30)

    # Default: natural conversational delivery
    return _settings(style=0.50, stability=0.38)


def _settings(style: float, stability: float) -> Dict[str, float]:
    return {
        "style":            round(min(max(style,     0.0), 1.0), 2),
        "stability":        round(min(max(stability, 0.0), 1.0), 2),
        "similarity_boost": 0.90,   # keep voice identity consistent
    }
