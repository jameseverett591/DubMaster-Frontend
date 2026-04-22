"""
Fish Audio S1 TTS service.

Drop-in alternative to ElevenLabs TTS for the Dubverse dubbing pipeline.
Uses the Fish Audio async Python SDK for voice-cloned, emotion-tagged speech.

Emotion control is handled via inline text tags (e.g. ``(angry)``, ``(calm)``)
prepended to the text before synthesis.

Voice identity can come from:
1. **Inline references** — raw audio bytes + transcript extracted from the
   original speakers' vocals (zero-shot cloning, no upload needed).
2. **Pre-uploaded models** — persistent voice models on fish.audio, referenced
   by ID via ``FISH_VOICE_*`` env vars.
"""

import asyncio
import os
import logging
import importlib.util
import random
from typing import Optional, Dict, List

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()
FISH_AUDIO_API_KEY = settings.FISH_AUDIO_API_KEY or os.getenv("FISH_AUDIO_API_KEY", "")

# ---------------------------------------------------------------------------
# Concurrency + rate-limit handling
# ---------------------------------------------------------------------------
# Fish Audio's basic tier rate-limits bursts. The dubbing pipeline fires every
# segment's TTS call in parallel via asyncio.gather (see dubbing_service.py),
# so without a concurrency cap we saturate Fish's limit, get HTTP 429 on most
# calls, and silently fall back to Edge TTS — producing a dub where almost
# every character sounds like the same generic Microsoft narrator.
#
# Tune via env var; 3 is conservative and safe for the basic tier.
_FISH_MAX_CONCURRENT = int(os.getenv("FISH_AUDIO_MAX_CONCURRENT", "3"))
_FISH_429_MAX_RETRIES = int(os.getenv("FISH_AUDIO_429_MAX_RETRIES", "4"))
_FISH_429_BASE_BACKOFF_SEC = float(os.getenv("FISH_AUDIO_429_BASE_BACKOFF_SEC", "1.5"))
# Lazy-initialised so the semaphore binds to whichever event loop imports us.
_fish_semaphore: Optional[asyncio.Semaphore] = None


def _get_fish_semaphore() -> asyncio.Semaphore:
    global _fish_semaphore
    if _fish_semaphore is None:
        _fish_semaphore = asyncio.Semaphore(_FISH_MAX_CONCURRENT)
    return _fish_semaphore


def _is_rate_limit_error(exc: BaseException) -> bool:
    """Detect Fish Audio 429 responses.

    The fish SDK raises generic Exception with the HTTP status embedded in
    the message, e.g. 'HTTP 429: Too many requests...'. We match on that.
    """
    msg = str(exc)
    return "429" in msg or "Too Many Requests" in msg or "rate limit" in msg.lower()

# ---------------------------------------------------------------------------
# Voice map: canonical keys -> Fish Audio reference_ids (from env vars)
# ---------------------------------------------------------------------------

def _load_voice_map_from_env() -> Dict[str, str]:
    """Load Fish Audio voice model IDs from FISH_VOICE_* env vars."""
    mapping: Dict[str, str] = {}
    for key_template in [
        "male-1", "male-2", "male-3", "male-4",
        "female-1", "female-2", "female-3", "female-4",
        "child-1", "child-2", "child-3", "child-4",
    ]:
        env_key = "FISH_VOICE_" + key_template.upper().replace("-", "_")
        value = os.getenv(env_key, "")
        if value:
            mapping[key_template] = value
    return mapping


class FishAudioTTS:
    """Async Fish Audio TTS service with inline voice cloning and Edge TTS fallback."""

    def __init__(self, api_key: str = FISH_AUDIO_API_KEY):
        self.api_key = api_key
        self.enabled = bool(api_key)
        self._client = None  # lazy init
        self._voices_cache: List[Dict] = []
        self._voice_map = _load_voice_map_from_env()
        self.edge_tts_available = importlib.util.find_spec("edge_tts") is not None

        if not self.enabled:
            logger.warning("FISH_AUDIO_API_KEY not set; Fish Audio TTS unavailable.")

    # ----- client --------------------------------------------------------- #

    def _get_client(self):
        """Lazy-initialise the async SDK client."""
        if self._client is None:
            try:
                from fishaudio import AsyncFishAudio
                self._client = AsyncFishAudio(api_key=self.api_key)
            except ImportError:
                logger.error("fish-audio-sdk not installed. Run: pip install fish-audio-sdk")
                raise
        return self._client

    # ----- voices --------------------------------------------------------- #

    async def get_voices(self) -> List[Dict]:
        """Fetch available voice models from Fish Audio.

        Returns a list of dicts in the same format as
        ``ElevenLabsTTS.get_voices()`` so the frontend can display them
        without knowing which provider is active.
        """
        if self._voices_cache:
            return self._voices_cache

        if not self.enabled:
            return self._fallback_voice_list()

        try:
            client = self._get_client()
            resp = await client.voices.list()
            voice_items = resp.items if hasattr(resp, 'items') else []
            self._voices_cache = [
                {
                    "voice_id": v.id,
                    "name": getattr(v, "title", None) or getattr(v, "name", "Fish Audio Voice"),
                    "category": "cloned",
                    "labels": {
                        "gender": getattr(v, "gender", "male"),
                        "accent": "cloned",
                        "age": "adult",
                    },
                    "preview_url": None,
                    "description": getattr(v, "description", "") or "Fish Audio cloned voice",
                }
                for v in voice_items
            ]
            return self._voices_cache
        except Exception as e:
            logger.error(f"Failed to fetch Fish Audio voices: {e}")
            return self._fallback_voice_list()

    def _fallback_voice_list(self) -> List[Dict]:
        """Return placeholder entries from the env-based voice map."""
        result = []
        for key, ref_id in self._voice_map.items():
            gender = "male" if "male" in key else ("female" if "female" in key else "child")
            result.append({
                "voice_id": ref_id,
                "name": f"Fish Audio {key}",
                "category": "cloned",
                "labels": {"gender": gender, "accent": "cloned", "age": "adult"},
                "preview_url": None,
                "description": f"Cloned voice ({key})",
            })
        return result

    # ----- voice resolution ----------------------------------------------- #

    def get_voice_id(self, voice_key: str) -> str:
        """Map a canonical voice key (e.g. ``male-1``) to a Fish Audio reference_id."""
        # Direct hit in env-based map
        if voice_key in self._voice_map:
            return self._voice_map[voice_key]
        # Looks like a raw Fish Audio ID — pass through
        if len(voice_key) > 15:
            return voice_key
        # Fall back to first available voice model
        if self._voice_map:
            return next(iter(self._voice_map.values()))
        return ""

    def get_model_for_language(self, language_code: str) -> str:
        """Fish Audio uses a single model for all languages."""
        return "fish-audio-s1"

    # ----- TTS ------------------------------------------------------------ #

    async def _convert_with_backoff(self, tts_kwargs: Dict) -> bytes:
        """Call Fish Audio's tts.convert with concurrency cap and 429 backoff.

        Concurrency is bounded by FISH_AUDIO_MAX_CONCURRENT so we never burst
        past the tier's rate limit. On 429 we sleep with exponential backoff
        and jitter, up to FISH_AUDIO_429_MAX_RETRIES attempts. Non-429 errors
        propagate immediately so the caller's outer retry path can handle
        them (e.g. drop inline refs and retry with reference_id only).

        Returns the audio bytes on success.
        """
        client = self._get_client()
        sem = _get_fish_semaphore()
        last_exc: Optional[BaseException] = None

        for attempt in range(_FISH_429_MAX_RETRIES + 1):
            async with sem:
                try:
                    audio = await client.tts.convert(**tts_kwargs)
                    # SDK may return bytes directly or an async iterator.
                    if isinstance(audio, (bytes, bytearray)):
                        return bytes(audio)
                    buf = bytearray()
                    async for chunk in audio:
                        buf.extend(chunk)
                    return bytes(buf)
                except Exception as e:
                    last_exc = e
                    if not _is_rate_limit_error(e):
                        raise
                    # Fall through to backoff (outside the semaphore so we
                    # don't hold the slot while waiting — other callers can
                    # use it if they're not being rate-limited).

            if attempt >= _FISH_429_MAX_RETRIES:
                break
            # Exponential backoff with jitter: 1.5, 3, 6, 12s (+/- 25%)
            base = _FISH_429_BASE_BACKOFF_SEC * (2 ** attempt)
            jitter = base * random.uniform(-0.25, 0.25)
            sleep_sec = max(0.1, base + jitter)
            logger.warning(
                f"[FISH-TTS] 429 rate limit (attempt {attempt + 1}/{_FISH_429_MAX_RETRIES + 1}); "
                f"backing off {sleep_sec:.1f}s"
            )
            await asyncio.sleep(sleep_sec)

        # Exhausted retries on 429
        assert last_exc is not None
        raise last_exc

    async def text_to_speech(
        self,
        text: str,
        voice_id: str,
        output_path: str,
        emotion_tags: str = "",
        speaker_references: Optional[List[Dict]] = None,
        speed: float = 1.0,
        temperature: float = 0.7,
        top_p: float = 0.7,
        language: str = "en",
        # Accept ElevenLabs params for interface compat (unused)
        model_id: str = "",
        stability: float = 0.3,
        similarity_boost: float = 0.9,
        style: float = 0.5,
        use_speaker_boost: bool = True,
    ) -> Optional[Dict[str, str]]:
        """Generate speech using Fish Audio S1.

        Parameters
        ----------
        text : str
            The text to synthesise.
        voice_id : str
            Fish Audio reference_id for a pre-uploaded voice model.
            Ignored when ``speaker_references`` is provided (inline cloning
            takes priority).
        output_path : str
            Where to write the audio file.
        emotion_tags : str
            Fish Audio inline tags, e.g. ``"(angry)(shouting)"``.
        speaker_references : list of dict, optional
            Inline voice cloning references.  Each dict has keys
            ``"audio"`` (bytes) and ``"text"`` (str transcript of that audio).
            When provided, Fish Audio clones the voice from these samples
            instead of using a pre-uploaded ``reference_id``.
        speed : float
            Playback speed multiplier (0.5-2.0).

        Returns ``{"path": ..., "engine": "fish-audio"}`` on success,
        or falls back to Edge TTS.
        """
        if not self.enabled:
            logger.warning("Fish Audio unavailable; falling back to Edge TTS.")
            return await self._edge_fallback(text, output_path, language, voice_id)

        # Prepend emotion tags to text
        tagged_text = f"{emotion_tags} {text}".strip() if emotion_tags else text

        # Decide cloning mode: inline references vs pre-uploaded model
        use_inline = bool(speaker_references)

        logger.info(
            f"[FISH-TTS] mode={'inline-clone' if use_inline else 'reference-id'}, "
            f"voice={voice_id if not use_inline else f'{len(speaker_references)} refs'}, "
            f"tags={emotion_tags!r}, text={tagged_text[:60]!r}..."
        )

        try:
            from fishaudio import ReferenceAudio

            # Build call kwargs
            tts_kwargs = dict(
                text=tagged_text,
                speed=speed,
                format="mp3",
            )

            if use_inline:
                # Zero-shot voice cloning from original actor audio
                tts_kwargs["references"] = [
                    ReferenceAudio(audio=ref["audio"], text=ref["text"])
                    for ref in speaker_references
                ]
                # Don't pass reference_id when using inline references
            elif voice_id:
                tts_kwargs["reference_id"] = voice_id

            audio_bytes = await self._convert_with_backoff(tts_kwargs)

            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(audio_bytes)

            if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                engine = "fish-audio-cloned" if use_inline else "fish-audio"
                logger.info(f"[FISH-TTS] SUCCESS ({engine}) -> {output_path}")
                return {"path": output_path, "engine": engine}

            logger.warning("[FISH-TTS] Produced empty output; retrying without inline refs.")

        except Exception as e:
            logger.error(f"[FISH-TTS] Error: {e}; retrying without inline refs.")

        # Retry once: drop inline references and use reference_id or bare synthesis.
        # This keeps the voice consistent (still Fish Audio) rather than switching
        # to Edge TTS which produces a completely different voice mid-job.
        if use_inline:
            try:
                retry_kwargs = dict(text=tagged_text, speed=speed, format="mp3")
                if voice_id:
                    retry_kwargs["reference_id"] = voice_id
                audio_bytes = await self._convert_with_backoff(retry_kwargs)
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                with open(output_path, "wb") as f:
                    f.write(audio_bytes)
                if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                    logger.info(f"[FISH-TTS] RETRY SUCCESS (fish-audio-bare) -> {output_path}")
                    return {"path": output_path, "engine": "fish-audio"}
            except Exception as retry_err:
                logger.error(f"[FISH-TTS] Retry also failed: {retry_err}")

        logger.warning("[FISH-TTS] All attempts failed; falling back to Edge TTS.")
        return await self._edge_fallback(text, output_path, language, voice_id)

    # ----- fallback ------------------------------------------------------- #

    async def _edge_fallback(
        self,
        text: str,
        output_path: str,
        language: str,
        voice_id: str,
    ) -> Optional[Dict[str, str]]:
        """Delegate to Edge TTS via the existing ElevenLabs fallback code."""
        try:
            from app.services.elevenlabs_tts import elevenlabs_tts
            gender = await elevenlabs_tts._resolve_voice_gender(voice_id)
            path = await elevenlabs_tts._fallback_tts(
                text, output_path, language, voice_id, gender
            )
            if path:
                return {"path": path, "engine": "edge-tts"}
        except Exception as e:
            logger.error(f"[FISH-TTS] Edge TTS fallback also failed: {e}")
        return None


# Module-level singleton
fish_audio_tts = FishAudioTTS()
