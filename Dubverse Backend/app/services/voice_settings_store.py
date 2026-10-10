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
CHECKPOINTS_PATH = os.path.join("data", "voice_checkpoints.json")
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


def _load(path: str = STORE_PATH) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save(data: dict, path: str = STORE_PATH) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


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
    clean = _clean_settings(settings)
    with _lock:
        data = _load()
        if clean:
            data[_key(user_id, voice_id)] = clean
        else:
            data.pop(_key(user_id, voice_id), None)
        _save(data)
    return clean


# ---------------------------------------------------------------------------
# Scene checkpoints — per (user, job, speaker) tuning pinned to a transcript
# index. A checkpoint applies from its segment onward until the next one, so a
# character's delivery can change with the scene: calm for the dinner scene,
# furious from the argument onward. Checkpoints win over the saved voice-level
# tuning in the render pipeline.
# ---------------------------------------------------------------------------


def _ck_key(user_id: str, job_id: str, speaker: str) -> str:
    return f"{user_id}:{job_id}:{speaker}"


def _clean_settings(settings: dict) -> dict:
    """Clamp a settings dict the same way `set` does; unknown keys dropped."""
    clean = {}
    for k in _KEYS:
        if k in settings:
            try:
                v = float(settings[k])
            except (TypeError, ValueError):
                continue
            lo, hi = _RANGES[k]
            clean[k] = max(lo, min(hi, v))
    return clean


def get_checkpoints(user_id: str, job_id: str, speaker: str) -> list:
    """Ordered checkpoint list [{index, settings}] for this user+job+speaker."""
    if not (user_id and job_id and speaker):
        return []
    with _lock:
        entry = _load(CHECKPOINTS_PATH).get(_ck_key(user_id, job_id, speaker))
    if not isinstance(entry, list):
        return []
    return [dict(ck) for ck in entry
            if isinstance(ck, dict) and "index" in ck]


def set_checkpoints(user_id: str, job_id: str, speaker: str, checkpoints: list) -> list:
    """Replace a speaker's checkpoint list. Each entry {index, settings} is
    validated — index must be a non-negative int, settings clamp to slider
    range. Duplicate indices collapse (last wins); list is stored sorted by
    index. An empty list clears the speaker's checkpoints."""
    if not (user_id and job_id and speaker):
        raise ValueError("user_id, job_id and speaker are required")
    if not isinstance(checkpoints, list):
        raise ValueError("checkpoints must be a list")
    by_index = {}
    for ck in checkpoints:
        if not isinstance(ck, dict):
            raise ValueError("each checkpoint must be an object")
        try:
            idx = int(ck.get("index"))
        except (TypeError, ValueError):
            raise ValueError("checkpoint index must be an integer")
        if idx < 0:
            raise ValueError("checkpoint index must be >= 0")
        settings = _clean_settings(ck.get("settings") or {})
        if not settings:
            raise ValueError("each checkpoint needs at least one setting")
        by_index[idx] = {"index": idx, "settings": settings}
    ordered = [by_index[k] for k in sorted(by_index)]
    with _lock:
        data = _load(CHECKPOINTS_PATH)
        if ordered:
            data[_ck_key(user_id, job_id, speaker)] = ordered
        else:
            data.pop(_ck_key(user_id, job_id, speaker), None)
        _save(data, CHECKPOINTS_PATH)
    return ordered


def active_checkpoint(user_id: str, job_id: str, speaker: str, seg_index: int) -> dict:
    """The checkpoint settings in force at transcript index `seg_index` —
    the latest checkpoint at or before it. {} when none applies."""
    active = {}
    for ck in get_checkpoints(user_id, job_id, speaker):
        if ck["index"] <= seg_index:
            active = ck["settings"]
        else:
            break
    return dict(active) if isinstance(active, dict) else {}


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
