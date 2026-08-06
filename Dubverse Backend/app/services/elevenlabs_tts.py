import httpx
import os
from pathlib import Path
import logging
from typing import Optional, Dict, List
import asyncio
import hashlib
import importlib.util

from app.utils.language import normalize_language_code
from app.config import get_settings

logger = logging.getLogger(__name__)

ELEVENLABS_API_KEY = get_settings().ELEVENLABS_API_KEY or os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1"

VOICE_MAP = {
    "male-1": "pNInz6obpgDQGcFmaJgB",
    "male-2": "VR6AewLTigWG4xSOukaG",
    "male-3": "ErXwobaYiN019PkySvjV",
    "male-4": "TxGEqnHWrfWFTfGW9XjX",
    "female-1": "EXAVITQu4vr4xnSDxMaL",
    "female-2": "21m00Tcm4TlvDq8ikWAM",
    "female-3": "AZnzlk1XvdvUeBnXmlld",
    "female-4": "MF3mGyEYCl7XYWbV9V6O",
    "child-1": "jsCqWAovK2LkecY7zXl4",
    "child-2": "ThT5KcBeYPX3keUQqHPh",
    "child-3": "Zlb1dXrM653N07WRdFW3",
    "child-4": "jsCqWAovK2LkecY7zXl4",
    "voice-1": "pNInz6obpgDQGcFmaJgB",
    "voice-2": "EXAVITQu4vr4xnSDxMaL",
    "speaker-1": "pNInz6obpgDQGcFmaJgB",
    "speaker-2": "EXAVITQu4vr4xnSDxMaL",
}

LANGUAGE_MODELS = {
    "en": "eleven_multilingual_v2",
    "es": "eleven_multilingual_v2",
    "fr": "eleven_multilingual_v2",
    "de": "eleven_multilingual_v2",
    "it": "eleven_multilingual_v2",
    "pt": "eleven_multilingual_v2",
    "ja": "eleven_multilingual_v2",
    "ko": "eleven_multilingual_v2",
    "zh": "eleven_multilingual_v2",
    "ar": "eleven_multilingual_v2",
    "hi": "eleven_multilingual_v2",
    "ru": "eleven_multilingual_v2",
    "nl": "eleven_multilingual_v2",
}


def _voice_index(voice_id: str) -> int:
    """Extract a stable index from a voice ID."""
    import re
    m = re.search(r"(\d+)", voice_id)
    if m:
        return max(0, int(m.group(1)) - 1)
    if not voice_id:
        return 0
    digest = hashlib.md5(voice_id.encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


EDGE_VOICES: Dict[str, Dict[str, List[str]]] = {
    "en": {
        "male": ["en-US-GuyNeural", "en-US-ChristopherNeural", "en-GB-RyanNeural"],
        "female": ["en-US-JennyNeural", "en-US-AriaNeural", "en-GB-SoniaNeural"],
        "child": ["en-US-AnaNeural", "en-US-JennyNeural"],
    },
    "es": {
        "male": ["es-ES-AlvaroNeural", "es-MX-JorgeNeural"],
        "female": ["es-ES-ElviraNeural", "es-MX-DaliaNeural"],
        "child": ["es-MX-DaliaNeural", "es-ES-ElviraNeural"],
    },
    "fr": {
        "male": ["fr-FR-HenriNeural", "fr-CA-AntoineNeural"],
        "female": ["fr-FR-DeniseNeural", "fr-CA-SylvieNeural"],
        "child": ["fr-FR-DeniseNeural", "fr-CA-SylvieNeural"],
    },
    "de": {
        "male": ["de-DE-ConradNeural", "de-DE-KillianNeural"],
        "female": ["de-DE-KatjaNeural", "de-DE-AmalaNeural"],
        "child": ["de-DE-AmalaNeural", "de-DE-KatjaNeural"],
    },
    "it": {
        "male": ["it-IT-DiegoNeural"],
        "female": ["it-IT-ElsaNeural", "it-IT-IsabellaNeural"],
        "child": ["it-IT-IsabellaNeural", "it-IT-ElsaNeural"],
    },
    "pt": {
        "male": ["pt-BR-AntonioNeural"],
        "female": ["pt-BR-FranciscaNeural", "pt-PT-RaquelNeural"],
        "child": ["pt-BR-FranciscaNeural", "pt-PT-RaquelNeural"],
    },
    "ja": {
        "male": ["ja-JP-KeitaNeural"],
        "female": ["ja-JP-NanamiNeural"],
        "child": ["ja-JP-NanamiNeural"],
    },
    "ko": {
        "male": ["ko-KR-InJoonNeural"],
        "female": ["ko-KR-SunHiNeural"],
        "child": ["ko-KR-SunHiNeural"],
    },
    "zh": {
        "male": ["zh-CN-YunxiNeural", "zh-CN-YunjianNeural"],
        "female": ["zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural"],
        "child": ["zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural"],
    },
    "ar": {
        "male": ["ar-SA-HamedNeural"],
        "female": ["ar-SA-ZariyahNeural"],
        "child": ["ar-SA-ZariyahNeural"],
    },
    "hi": {
        "male": ["hi-IN-MadhurNeural"],
        "female": ["hi-IN-SwaraNeural"],
        "child": ["hi-IN-SwaraNeural"],
    },
    "ru": {
        "male": ["ru-RU-DmitryNeural"],
        "female": ["ru-RU-SvetlanaNeural"],
        "child": ["ru-RU-SvetlanaNeural"],
    },
    "nl": {
        "male": ["nl-NL-MaartenNeural"],
        "female": ["nl-NL-ColetteNeural"],
        "child": ["nl-NL-ColetteNeural"],
    },
}


class ElevenLabsTTS:
    def __init__(self, api_key: str = ELEVENLABS_API_KEY):
        self.api_key = api_key
        self.headers = {
            "xi-api-key": api_key,
            "Content-Type": "application/json",
        }
        self._voices_cache: List[Dict] = []
        self.enabled = bool(api_key)
        self.edge_tts_available = importlib.util.find_spec("edge_tts") is not None
        if not self.enabled:
            logger.warning("ELEVENLABS_API_KEY not set; using Edge TTS fallback.")
        if not self.edge_tts_available:
            logger.warning("edge-tts not installed; fallback TTS is unavailable.")
    
    async def get_voices(self, refresh: bool = False) -> List[Dict]:
        # Cached for the process lifetime, so voices added to the ElevenLabs
        # account after the backend started are invisible until something asks
        # for a refresh. `refresh=True` is how the Perform panel picks up a
        # newly added voice without a restart.
        if self._voices_cache and not refresh:
            return self._voices_cache

        if not self.enabled:
            return self._get_fallback_voices()
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{ELEVENLABS_BASE_URL}/voices",
                    headers=self.headers,
                    timeout=30.0
                )
                if response.status_code == 200:
                    data = response.json()
                    self._voices_cache = data.get("voices", [])
                    return self._voices_cache
                else:
                    logger.error(f"Failed to get voices: {response.text}")
        except Exception as e:
            logger.error(f"Error fetching voices: {e}")
        
        return self._get_fallback_voices()
    
    def _get_fallback_voices(self) -> List[Dict]:
        return [
            {"voice_id": "pNInz6obpgDQGcFmaJgB", "name": "Adam", "category": "premade", "labels": {"gender": "male", "accent": "American", "age": "middle aged"}, "preview_url": None, "description": "Deep, authoritative male voice"},
            {"voice_id": "VR6AewLTigWG4xSOukaG", "name": "Arnold", "category": "premade", "labels": {"gender": "male", "accent": "American", "age": "middle aged"}, "preview_url": None, "description": "Warm, friendly male voice"},
            {"voice_id": "ErXwobaYiN019PkySvjV", "name": "Antoni", "category": "premade", "labels": {"gender": "male", "accent": "American", "age": "young"}, "preview_url": None, "description": "Professional, clear male voice"},
            {"voice_id": "TxGEqnHWrfWFTfGW9XjX", "name": "Josh", "category": "premade", "labels": {"gender": "male", "accent": "American", "age": "young"}, "preview_url": None, "description": "Energetic, youthful male voice"},
            {"voice_id": "ODq5zmih8GrVes37Dizd", "name": "Patrick", "category": "premade", "labels": {"gender": "male", "accent": "American", "age": "middle aged"}, "preview_url": None, "description": "Confident, engaging male voice"},
            {"voice_id": "EXAVITQu4vr4xnSDxMaL", "name": "Bella", "category": "premade", "labels": {"gender": "female", "accent": "American", "age": "young"}, "preview_url": None, "description": "Warm, conversational female voice"},
            {"voice_id": "21m00Tcm4TlvDq8ikWAM", "name": "Rachel", "category": "premade", "labels": {"gender": "female", "accent": "American", "age": "young"}, "preview_url": None, "description": "Professional, confident female voice"},
            {"voice_id": "AZnzlk1XvdvUeBnXmlld", "name": "Domi", "category": "premade", "labels": {"gender": "female", "accent": "American", "age": "young"}, "preview_url": None, "description": "Soft, soothing female voice"},
            {"voice_id": "MF3mGyEYCl7XYWbV9V6O", "name": "Emily", "category": "premade", "labels": {"gender": "female", "accent": "American", "age": "young"}, "preview_url": None, "description": "Energetic, bright female voice"},
            {"voice_id": "XB0fDUnXU5powFXDhCwa", "name": "Charlotte", "category": "premade", "labels": {"gender": "female", "accent": "British", "age": "middle aged"}, "preview_url": None, "description": "Elegant British female voice"},
            {"voice_id": "jBpfuIE2acCO8z3wKNLl", "name": "Fin", "category": "premade", "labels": {"gender": "male", "accent": "Irish", "age": "middle aged"}, "preview_url": None, "description": "Warm Irish male voice"},
            {"voice_id": "onwK4e9ZLuTAKqWW03F9", "name": "Daniel", "category": "premade", "labels": {"gender": "male", "accent": "British", "age": "middle aged"}, "preview_url": None, "description": "Deep British male voice"},
            {"voice_id": "cgSgspJ2msm6clMCkdW9", "name": "George", "category": "premade", "labels": {"gender": "male", "accent": "British", "age": "young"}, "preview_url": None, "description": "Youthful British male voice"},
            {"voice_id": "IKne3meq5aSn9XLyUdCD", "name": "Charlie", "category": "premade", "labels": {"gender": "male", "accent": "Australian", "age": "middle aged"}, "preview_url": None, "description": "Casual Australian male voice"},
            {"voice_id": "XrExE9yKIg1WjnnlVkGX", "name": "Matilda", "category": "premade", "labels": {"gender": "female", "accent": "Australian", "age": "middle aged"}, "preview_url": None, "description": "Friendly Australian female voice"},
            {"voice_id": "pFZP5JQG7iQjIQuC4Bku", "name": "Lily", "category": "premade", "labels": {"gender": "female", "accent": "British", "age": "young"}, "preview_url": None, "description": "Warm British female voice"},
            {"voice_id": "bIHbv24MWmeRgasZH58o", "name": "Will", "category": "premade", "labels": {"gender": "male", "accent": "American", "age": "young"}, "preview_url": None, "description": "Friendly American male voice"},
            {"voice_id": "jsCqWAovK2LkecY7zXl4", "name": "Thomas (Boy)", "category": "premade", "labels": {"gender": "male", "accent": "American", "age": "child"}, "preview_url": None, "description": "Young boy voice, perfect for children characters"},
            {"voice_id": "ThT5KcBeYPX3keUQqHPh", "name": "Dorothy (Girl)", "category": "premade", "labels": {"gender": "female", "accent": "American", "age": "child"}, "preview_url": None, "description": "Young girl voice, perfect for children characters"},
            {"voice_id": "Zlb1dXrM653N07WRdFW3", "name": "Mimi (Child)", "category": "premade", "labels": {"gender": "female", "accent": "American", "age": "child"}, "preview_url": None, "description": "Sweet childlike female voice"},
        ]
    
    async def text_to_speech(
        self,
        text: str,
        voice_id: str,
        output_path: str,
        model_id: str = "eleven_multilingual_v2",
        stability: float = 0.3,
        similarity_boost: float = 0.9,
        style: float = 0.5,
        use_speaker_boost: bool = True,
        language: str = "en",
        pitch_shift: float = 0.0,
    ) -> Optional[Dict[str, str]]:
        logger.info(f"TTS Request: voice_id={voice_id}, model={model_id}, language={language}, text={text[:50]}...")

        # Default to ElevenLabs when API key is available, Edge TTS otherwise.
        # Override with EDGE_TTS_PRIMARY=1 to force Edge TTS even with a key.
        default_edge = "0" if self.enabled else "1"
        edge_primary = os.getenv("EDGE_TTS_PRIMARY", default_edge) == "1"
        if edge_primary and self.edge_tts_available:
            gender = await self._resolve_voice_gender(voice_id)
            fallback_path = await self._fallback_tts(text, output_path, language, voice_id, gender, pitch_shift)
            if fallback_path:
                return {"path": fallback_path, "engine": "edge-tts"}
            if not self.enabled:
                return None
            logger.warning("Edge TTS failed; falling back to ElevenLabs.")

        if not self.enabled:
            logger.warning("ElevenLabs API key missing; using Edge TTS fallback.")
            gender = await self._resolve_voice_gender(voice_id)
            fallback_path = await self._fallback_tts(text, output_path, language, voice_id, gender, pitch_shift)
            if fallback_path:
                return {"path": fallback_path, "engine": "edge-tts"}
            return None
        
        child_voice_ids = ["jsCqWAovK2LkecY7zXl4", "ThT5KcBeYPX3keUQqHPh", "Zlb1dXrM653N07WRdFW3"]
        if voice_id in child_voice_ids:
            stability = 0.6
            similarity_boost = 0.85
            style = 0.3
            logger.info(f"Using child voice settings: stability={stability}, similarity={similarity_boost}, style={style}")
        
        url = f"{ELEVENLABS_BASE_URL}/text-to-speech/{voice_id}"
        
        payload = {
            "text": text,
            "model_id": model_id,
            "voice_settings": {
                "stability": stability,
                "similarity_boost": similarity_boost,
                "style": style,
                "use_speaker_boost": use_speaker_boost,
            }
        }
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url,
                    json=payload,
                    headers=self.headers,
                    timeout=120.0,
                )
                
                if response.status_code == 200:
                    os.makedirs(os.path.dirname(output_path), exist_ok=True)
                    with open(output_path, "wb") as f:
                        f.write(response.content)
                    logger.info(f"ElevenLabs SUCCESS: voice={voice_id}, saved to {output_path}")
                    return {"path": output_path, "engine": "elevenlabs"}
                else:
                    error_text = response.text[:200]
                    if response.status_code == 429 or "quota" in response.text.lower():
                        logger.warning("ElevenLabs quota exhausted; falling back to Edge TTS.")
                    else:
                        logger.warning(f"ElevenLabs FAILED: {response.status_code} - {error_text}")
                        logger.info("Falling back to Edge TTS...")
                    gender = await self._resolve_voice_gender(voice_id)
                    fallback_path = await self._fallback_tts(text, output_path, language, voice_id, gender, pitch_shift)
                    if fallback_path:
                        return {"path": fallback_path, "engine": "edge-tts"}
                    return None
                    
        except Exception as e:
            logger.error(f"TTS error: {e}")
            logger.info("Falling back to Edge TTS...")
            gender = await self._resolve_voice_gender(voice_id)
            fallback_path = await self._fallback_tts(text, output_path, language, voice_id, gender, pitch_shift)
            if fallback_path:
                return {"path": fallback_path, "engine": "edge-tts"}
            return None

    # ----- Speech-to-speech (Voice Changer) -------------------------------- #

    async def speech_to_speech(
        self,
        audio_bytes: bytes,
        voice_id: str,
        output_path: Optional[str] = None,
        model_id: str = "eleven_english_sts_v2",
        seed: Optional[int] = None,
        remove_background_noise: bool = False,
        filename: str = "performance.wav",
    ) -> Optional[bytes]:
        """Map a performance onto a target voice, keeping its delivery.

        Unlike text_to_speech this takes AUDIO as the content source: words,
        timing and emotion all come from the recording and only the timbre is
        replaced. It does NOT translate — feed it Cantonese and you get
        Cantonese in a new voice.

        Returns the converted MP3 bytes, and writes them to output_path when
        one is given.
        """
        if not self.enabled:
            logger.warning("[EL-STS] ELEVENLABS_API_KEY not set")
            return None

        url = f"{ELEVENLABS_BASE_URL}/speech-to-speech/{voice_id}"
        # 44.1 kHz mono MP3 is what the rest of the pipeline works in, so the
        # result can sit beside other segments with no transcode. Also the
        # default tier-wise: 192 kbps needs Creator+, PCM/WAV 44.1 needs Pro+.
        params = {"output_format": "mp3_44100_128"}
        data = {
            "model_id": model_id,
            "remove_background_noise": str(remove_background_noise).lower(),
        }
        if seed is not None:
            data["seed"] = str(seed)
        files = {"audio": (filename, audio_bytes, "application/octet-stream")}
        # Deliberately NOT self.headers: that pins Content-Type: application/json,
        # which would override the multipart boundary httpx needs to set here and
        # the upload would be rejected.
        headers = {"xi-api-key": self.api_key}

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(url, params=params, data=data,
                                      files=files, headers=headers)
            if r.status_code != 200:
                logger.error(f"[EL-STS] {r.status_code}: {r.text[:300]}")
                return None
            payload = r.content
        except Exception as e:
            logger.error(f"[EL-STS] request failed: {e}")
            return None

        if output_path:
            os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(payload)
        logger.info(
            f"[EL-STS] voice={voice_id} model={model_id} seed={seed} "
            f"bytes={len(payload)}"
        )
        return payload

    async def _fallback_tts(
        self,
        text: str,
        output_path: str,
        language: str = "en",
        voice_id: str = "",
        gender: str = "male",
        pitch_shift: float = 0.0,
    ) -> Optional[str]:
        try:
            if not self.edge_tts_available:
                logger.error("Edge TTS fallback unavailable (edge-tts not installed).")
                return None
            import edge_tts

            language = normalize_language_code(language)
            edge_voice = self._get_edge_voice(language, gender, voice_id)
            # Slightly slower rate for more natural delivery (Edge TTS
            # defaults are fast and robotic).  Children get a faster rate.
            rate = "+15%" if gender == "child" else "-5%"
            # Base pitch from gender + additional user pitch_shift
            base_pitch = "+50Hz" if gender == "child" else "+0Hz"
            # Apply SSML pitch shift if user specified a non-zero value
            if pitch_shift != 0:
                # Convert semitones to SSML pitch string (e.g., +8st or -4st)
                pitch_steps = f"{pitch_shift:+.0f}st"
                # Wrap text in SSML prosody tag for pitch control
                text = f'<speak><prosody pitch="{pitch_steps}">{text}</prosody></speak>'

            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            kwargs = {}
            if rate:
                kwargs["rate"] = rate
            # Only pass base pitch if no explicit pitch_shift (SSML handles it otherwise)
            if pitch_shift == 0 and base_pitch != "+0Hz":
                kwargs["pitch"] = base_pitch
            communicate = edge_tts.Communicate(text, edge_voice, **kwargs)
            await asyncio.wait_for(communicate.save(output_path), timeout=90)
            # Edge-TTS silently creates an empty file when the voice can't speak
            # the text (e.g. Chinese text sent to an English voice after a failed
            # translation).  Treat a 0-byte output as a failure so callers skip
            # this segment rather than merging silence.
            if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                logger.warning(
                    f"Edge TTS produced empty audio (voice={edge_voice}, "
                    f"lang={language}, text={text[:60]!r})"
                )
                if os.path.exists(output_path):
                    os.unlink(output_path)
                return None
            logger.info(f"Edge TTS fallback: voice={edge_voice}, saved to {output_path}")
            return output_path
        except ImportError:
            logger.error("edge-tts not installed; cannot fall back.")
            return None
        except Exception as e:
            logger.error(f"Edge TTS fallback error: {e}")
            if os.path.exists(output_path):
                os.unlink(output_path)
            return None

    async def _resolve_voice_gender(self, voice_id: str) -> str:
        if not voice_id:
            return "male"

        lowered = voice_id.lower()
        if "female" in lowered:
            return "female"
        if "child" in lowered or "kid" in lowered:
            return "child"
        if "male" in lowered:
            return "male"

        for key, value in VOICE_MAP.items():
            if value == voice_id:
                key_lower = key.lower()
                if "female" in key_lower:
                    return "female"
                if "child" in key_lower:
                    return "child"
                if "male" in key_lower:
                    return "male"

        if not self._voices_cache:
            try:
                await self.get_voices()
            except Exception:
                pass

        for voice in (self._voices_cache or self._get_fallback_voices()):
            if voice.get("voice_id") == voice_id:
                labels = voice.get("labels") or {}
                gender = (labels.get("gender") or "").lower()
                age = (labels.get("age") or "").lower()
                if "child" in age:
                    return "child"
                if gender in ("male", "female"):
                    return gender

        return "male"

    def _get_edge_voice(self, language: str, gender: str, voice_id: str) -> str:
        """Pick a distinct edge-tts voice based on language and speaker gender."""
        pools = EDGE_VOICES.get(language, EDGE_VOICES["en"])
        gender_key = gender if gender in pools else "male"
        voices = pools.get(gender_key) or pools.get("female") or pools.get("male")
        idx = _voice_index(voice_id)
        return voices[idx % len(voices)]

    def get_voice_id(self, voice_key: str) -> str:
        if voice_key in VOICE_MAP:
            return VOICE_MAP[voice_key]
        if len(voice_key) > 15:
            return voice_key
        return VOICE_MAP.get("male-1")
    
    def get_model_for_language(self, language_code: str) -> str:
        normalized = normalize_language_code(language_code)
        return LANGUAGE_MODELS.get(normalized, "eleven_multilingual_v2")


elevenlabs_tts = ElevenLabsTTS()
