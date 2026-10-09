"""Per-user, per-voice Audio Settings — the sliders a user tunes on a voice
card in the Voice Library (Speed / Stability / Similarity / Style).

Persisted to a JSON file (same pattern as custom_voices.json) keyed by
"{user_id}:{voice_id}" so settings follow the voice: whoever assigns it, on
whatever job, the tuning travels with the voice. A job can still override
per speaker — explicit keys in the render request's voice_settings win.

Slider semantics vs providers:
- speed            -> Fish prosody speed multiplier and EL rate. Honest
                      everywhere.
- stability        -> ElevenLabs `stability` direct; Fish has no stability
                      knob, so it maps inversely onto `temperature`
                      (steady = low temperature).
- similarity_boost -> ElevenLabs `similarity_boost` direct; Fish clones keep
                      timbre by construction — stored but a no-op there.
- style            -> ElevenLabs `style` direct; Fish maps onto `top_p`
                      (more nucleus range = more expressive delivery).

Defaults reproduce today's behavior (Fish temp 0.7 / top_p 0.7 / speed 1.0,
EL 0.3/0.9/0.5 conventions are the providers' own), so nothing changes for
users who never touch the sliders.
"""

import json
import logging
import os
import threading

logger = logging.getLogger(__name__)

STORE_PATH = os.path.join("data", "voice_settings.json")
_lock = threading.Lock()

_KEYS = ("speed", "stability", "similarity_boost", "style")

# Slider ranges — same on the card UI. Values outside are clamped, not
# rejected: a stale client shouldn't lose the whole save.
_RANGES = {
    "speed": (0.5, 2.0),
    "stability": (0.0, 1.0),
    "similarity_boost": (0.0, 1.0),
    "style": (0.0, 1.0),
}

DEFAULTS = {"speed": 1.0, "stability": 0.5, "similarity_boost": 0.75, "style": 0.3}


def _load() -> dict:
    try:
        with open(STORE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save(data: dict) -> None:
    os.makedirs(os.path.dirname(STORE_PATH), exist_ok=True)
    tmp = STORE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, STORE_PATH)


def _key(user_id: str, voice_id: str) -> str:
    return f"{user_id}:{voice_id}"


def get(user_id: str, voice_id: str) -> dict:
    """Saved settings for this user+voice, or {} when never tuned.

    Empty — NOT DEFAULTS — so callers can distinguish "user set nothing" from
    an explicit choice and leave provider defaults/emotion analysis alone.
    """
    if not user_id or not voice_id:
        return {}
    with _lock:
        entry = _load().get(_key(user_id, voice_id))
    return dict(entry) if isinstance(entry, dict) else {}


def set(user_id: str, voice_id: str, settings: dict) -> dict:
    """Persist a settings dict for this user+voice. Unknown keys are dropped,
    known keys clamped to slider range. Returns the stored dict."""
    if not user_id or not voice_id:
        raise ValueError("user_id and voice_id are required")
    clean = {}
    for k in _KEYS:
        if k in settings:
            try:
                v = float(settings[k])
            except (TypeError, ValueError):
                continue
            lo, hi = _RANGES[k]
            clean[k] = max(lo, min(hi, v))
    with _lock:
        data = _load()
        if clean:
            data[_key(user_id, voice_id)] = clean
        else:
            data.pop(_key(user_id, voice_id), None)
        _save(data)
    return clean


def fish_tts_overrides(settings: dict) -> dict:
    """Translate the stored sliders into Fish TTS kwargs (temperature/top_p/
    speed multiplier). Only keys the user actually saved produce output —
    unset sliders leave the pipeline's own defaults untouched."""
    out = {}
    if "speed" in settings:
        out["speed_mult"] = float(settings["speed"])
    if "stability" in settings:
        # steady voice = low temperature: stability 1.0 -> 0.4, 0.5 -> 0.7
        # (the env default), 0.0 -> 1.0.
        out["temperature"] = round(1.0 - 0.6 * float(settings["stability"]), 3)
    if "style" in settings:
        # style exaggeration widens nucleus sampling: 0.4 -> 0.7 (the env
        # default), 0.0 -> 0.5, 1.0 -> 1.0.
        out["top_p"] = round(0.5 + 0.5 * float(settings["style"]), 3)
    return out
