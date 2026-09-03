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

ELEVENLABS_UNSUPPORTED_LANGUAGE_CODES = {
    "am",
    "ig",
    "km",
    "my",
    "si",
    "yo",
    "yue",
    "zu",
}

ELEVENLABS_SUPPORTED_LANGUAGE_CODES = {
    "ar",
    "bg",
    "bn",
    "cs",
    "da",
    "de",
    "el",
    "en",
    "es",
    "es-mx",
    "fa",
    "fi",
    "fr",
    "gu",
    "he",
    "hi",
    "hr",
    "hu",
    "id",
    "it",
    "ja",
    "ko",
    "mr",
    "ms",
    "nl",
    "no",
    "pl",
    "pt",
    "pt-br",
    "ro",
    "ru",
    "sk",
    "sr",
    "sv",
    "sw",
    "ta",
    "te",
    "th",
    "tl",
    "tr",
    "uk",
    "ur",
    "vi",
    "zh",
}

LANGUAGE_MODELS = {
    "ar": "eleven_multilingual_v2",
    "bg": "eleven_multilingual_v2",
    "bn": "eleven_multilingual_v2",
    "cs": "eleven_multilingual_v2",
    "da": "eleven_multilingual_v2",
    "de": "eleven_multilingual_v2",
    "el": "eleven_multilingual_v2",
    "en": "eleven_multilingual_v2",
    "es": "eleven_multilingual_v2",
    "es-mx": "eleven_multilingual_v2",
    "fa": "eleven_multilingual_v2",
    "fi": "eleven_multilingual_v2",
    "fr": "eleven_multilingual_v2",
    "gu": "eleven_multilingual_v2",
    "he": "eleven_multilingual_v2",
    "hi": "eleven_multilingual_v2",
    "hr": "eleven_multilingual_v2",
    "hu": "eleven_multilingual_v2",
    "id": "eleven_multilingual_v2",
    "it": "eleven_multilingual_v2",
    "ja": "eleven_multilingual_v2",
    "ko": "eleven_multilingual_v2",
    "mr": "eleven_multilingual_v2",
    "ms": "eleven_multilingual_v2",
    "nl": "eleven_multilingual_v2",
    "no": "eleven_multilingual_v2",
    "pl": "eleven_multilingual_v2",
    "pt": "eleven_multilingual_v2",
    "pt-br": "eleven_multilingual_v2",
    "ro": "eleven_multilingual_v2",
    "ru": "eleven_multilingual_v2",
    "sk": "eleven_multilingual_v2",
    "sr": "eleven_multilingual_v2",
    "sv": "eleven_multilingual_v2",
    "sw": "eleven_multilingual_v2",
    "ta": "eleven_multilingual_v2",
    "te": "eleven_multilingual_v2",
    "th": "eleven_multilingual_v2",
    "tl": "eleven_multilingual_v2",
    "tr": "eleven_multilingual_v2",
    "uk": "eleven_multilingual_v2",
    "ur": "eleven_multilingual_v2",
    "vi": "eleven_multilingual_v2",
    "zh": "eleven_multilingual_v2",
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
        "male": [
            "en-US-AndrewNeural",
            "en-US-BrianNeural",
            "en-US-GuyNeural",
            "en-US-DavisNeural",
            "en-US-JasonNeural",
            "en-US-KaiNeural"
        ],
        "female": [
            "en-US-AvaNeural",
            "en-US-EmmaNeural",
            "en-US-JennyNeural",
            "en-US-AriaNeural",
            "en-US-JaneNeural",
            "en-US-LunaNeural"
        ],
        "child": [
            "en-US-AvaNeural",
            "en-US-EmmaNeural",
            "en-US-JennyNeural"
        ]
    },
    "es": {
        "male": [
            "es-ES-AlvaroNeural",
            "es-ES-ArnauNeural",
            "es-ES-DarioNeural",
            "es-ES-EliasNeural",
            "es-ES-NilNeural",
            "es-ES-SaulNeural"
        ],
        "female": [
            "es-ES-ElviraNeural",
            "es-ES-AbrilNeural",
            "es-ES-EstrellaNeural",
            "es-ES-IreneNeural",
            "es-ES-LaiaNeural",
            "es-ES-LiaNeural"
        ],
        "child": [
            "es-ES-ElviraNeural",
            "es-ES-AbrilNeural",
            "es-ES-EstrellaNeural"
        ]
    },
    "fr": {
        "male": [
            "fr-FR-HenriNeural",
            "fr-FR-AlainNeural",
            "fr-FR-ClaudeNeural",
            "fr-FR-JeromeNeural",
            "fr-FR-MauriceNeural",
            "fr-FR-YvesNeural"
        ],
        "female": [
            "fr-FR-DeniseNeural",
            "fr-FR-BrigitteNeural",
            "fr-FR-CelesteNeural",
            "fr-FR-CoralieNeural",
            "fr-FR-EloiseNeural",
            "fr-FR-JacquelineNeural"
        ],
        "child": [
            "fr-FR-DeniseNeural",
            "fr-FR-BrigitteNeural",
            "fr-FR-CelesteNeural"
        ]
    },
    "de": {
        "male": [
            "de-DE-ConradNeural",
            "de-DE-BerndNeural",
            "de-DE-ChristophNeural",
            "de-DE-KasperNeural",
            "de-DE-KillianNeural",
            "de-DE-KlausNeural"
        ],
        "female": [
            "de-DE-KatjaNeural",
            "de-DE-AmalaNeural",
            "de-DE-ElkeNeural",
            "de-DE-GiselaNeural",
            "de-DE-KlarissaNeural",
            "de-DE-LouisaNeural"
        ],
        "child": [
            "de-DE-KatjaNeural",
            "de-DE-AmalaNeural",
            "de-DE-ElkeNeural"
        ]
    },
    "it": {
        "male": [
            "it-IT-DiegoNeural",
            "it-IT-BenignoNeural",
            "it-IT-CalimeroNeural",
            "it-IT-CataldoNeural",
            "it-IT-GianniNeural",
            "it-IT-GiuseppeNeural"
        ],
        "female": [
            "it-IT-ElsaNeural",
            "it-IT-IsabellaNeural",
            "it-IT-FabiolaNeural",
            "it-IT-FiammaNeural",
            "it-IT-ImeldaNeural",
            "it-IT-IrmaNeural"
        ],
        "child": [
            "it-IT-ElsaNeural",
            "it-IT-IsabellaNeural",
            "it-IT-FabiolaNeural"
        ]
    },
    "pt": {
        "male": [
            "pt-PT-DuarteNeural",
            "pt-BR-AntonioNeural",
            "pt-BR-DonatoNeural",
            "pt-BR-FabioNeural",
            "pt-BR-HumbertoNeural",
            "pt-BR-JulioNeural"
        ],
        "female": [
            "pt-PT-RaquelNeural",
            "pt-PT-FernandaNeural",
            "pt-BR-FranciscaNeural",
            "pt-BR-BrendaNeural",
            "pt-BR-ElzaNeural",
            "pt-BR-GiovannaNeural"
        ],
        "child": [
            "pt-PT-RaquelNeural",
            "pt-PT-FernandaNeural",
            "pt-BR-FranciscaNeural"
        ]
    },
    "ja": {
        "male": [
            "ja-JP-KeitaNeural",
            "ja-JP-DaichiNeural",
            "ja-JP-NaokiNeural"
        ],
        "female": [
            "ja-JP-NanamiNeural",
            "ja-JP-AoiNeural",
            "ja-JP-MayuNeural",
            "ja-JP-ShioriNeural"
        ],
        "child": [
            "ja-JP-NanamiNeural",
            "ja-JP-AoiNeural",
            "ja-JP-MayuNeural"
        ]
    },
    "ko": {
        "male": [
            "ko-KR-InJoonNeural",
            "ko-KR-BongJinNeural",
            "ko-KR-GookMinNeural",
            "ko-KR-HyunsuNeural"
        ],
        "female": [
            "ko-KR-SunHiNeural",
            "ko-KR-JiMinNeural",
            "ko-KR-SeoHyeonNeural",
            "ko-KR-SoonBokNeural",
            "ko-KR-YuJinNeural"
        ],
        "child": [
            "ko-KR-SunHiNeural",
            "ko-KR-JiMinNeural",
            "ko-KR-SeoHyeonNeural"
        ]
    },
    "zh": {
        "male": [
            "zh-CN-YunxiNeural",
            "zh-CN-YunjianNeural",
            "zh-CN-YunyangNeural",
            "zh-CN-YunfengNeural",
            "zh-CN-YunhaoNeural",
            "zh-CN-YunjieNeural"
        ],
        "female": [
            "zh-CN-XiaoxiaoNeural",
            "zh-CN-XiaoyiNeural",
            "zh-CN-XiaochenNeural",
            "zh-CN-XiaohanNeural",
            "zh-CN-XiaomengNeural",
            "zh-CN-XiaomoNeural"
        ],
        "child": [
            "zh-CN-XiaoxiaoNeural",
            "zh-CN-XiaoyiNeural",
            "zh-CN-XiaochenNeural"
        ]
    },
    "yue": {
        "male": [
            "zh-HK-WanLungNeural"
        ],
        "female": [
            "zh-HK-HiuMaanNeural",
            "zh-HK-HiuGaaiNeural"
        ],
        "child": [
            "zh-HK-HiuMaanNeural",
            "zh-HK-HiuGaaiNeural"
        ]
    },
    "ar": {
        "male": [
            "ar-SA-HamedNeural",
            "ar-EG-ShakirNeural",
            "ar-AE-HamdanNeural"
        ],
        "female": [
            "ar-SA-ZariyahNeural",
            "ar-EG-SalmaNeural",
            "ar-AE-FatimaNeural"
        ],
        "child": [
            "ar-SA-ZariyahNeural",
            "ar-EG-SalmaNeural",
            "ar-AE-FatimaNeural"
        ]
    },
    "hi": {
        "male": [
            "hi-IN-AaravNeural",
            "hi-IN-ArjunNeural",
            "hi-IN-KunalNeural",
            "hi-IN-RehaanNeural",
            "hi-IN-MadhurNeural"
        ],
        "female": [
            "hi-IN-AnanyaNeural",
            "hi-IN-AartiNeural",
            "hi-IN-KavyaNeural",
            "hi-IN-SwaraNeural"
        ],
        "child": [
            "hi-IN-AnanyaNeural",
            "hi-IN-AartiNeural",
            "hi-IN-KavyaNeural"
        ]
    },
    "ru": {
        "male": [
            "ru-RU-DmitryNeural"
        ],
        "female": [
            "ru-RU-SvetlanaNeural",
            "ru-RU-DariyaNeural"
        ],
        "child": [
            "ru-RU-SvetlanaNeural",
            "ru-RU-DariyaNeural"
        ]
    },
    "nl": {
        "male": [
            "nl-NL-MaartenNeural",
            "nl-BE-ArnaudNeural"
        ],
        "female": [
            "nl-NL-FennaNeural",
            "nl-NL-ColetteNeural",
            "nl-BE-DenaNeural"
        ],
        "child": [
            "nl-NL-FennaNeural",
            "nl-NL-ColetteNeural",
            "nl-BE-DenaNeural"
        ]
    },
    "vi": {
        "male": [
            "vi-VN-NamMinhNeural"
        ],
        "female": [
            "vi-VN-HoaiMyNeural"
        ],
        "child": [
            "vi-VN-HoaiMyNeural"
        ]
    },
    "th": {
        "male": [
            "th-TH-NiwatNeural"
        ],
        "female": [
            "th-TH-PremwadeeNeural",
            "th-TH-AcharaNeural"
        ],
        "child": [
            "th-TH-PremwadeeNeural",
            "th-TH-AcharaNeural"
        ]
    },
    "id": {
        "male": [
            "id-ID-ArdiNeural"
        ],
        "female": [
            "id-ID-GadisNeural"
        ],
        "child": [
            "id-ID-GadisNeural"
        ]
    },
    "ms": {
        "male": [
            "ms-MY-OsmanNeural"
        ],
        "female": [
            "ms-MY-YasminNeural"
        ],
        "child": [
            "ms-MY-YasminNeural"
        ]
    },
    "tl": {
        "male": [
            "fil-PH-AngeloNeural"
        ],
        "female": [
            "fil-PH-BlessicaNeural"
        ],
        "child": [
            "fil-PH-BlessicaNeural"
        ]
    },
    "km": {
        "male": [
            "km-KH-PisethNeural"
        ],
        "female": [
            "km-KH-SreymomNeural"
        ],
        "child": [
            "km-KH-SreymomNeural"
        ]
    },
    "my": {
        "male": [
            "my-MM-ThihaNeural"
        ],
        "female": [
            "my-MM-NilarNeural"
        ],
        "child": [
            "my-MM-NilarNeural"
        ]
    },
    "bn": {
        "male": [
            "bn-IN-BashkarNeural",
            "bn-BD-PradeepNeural"
        ],
        "female": [
            "bn-IN-TanishaaNeural",
            "bn-BD-NabanitaNeural"
        ],
        "child": [
            "bn-IN-TanishaaNeural",
            "bn-BD-NabanitaNeural"
        ]
    },
    "ur": {
        "male": [
            "ur-IN-SalmanNeural",
            "ur-PK-AsadNeural"
        ],
        "female": [
            "ur-IN-GulNeural",
            "ur-PK-UzmaNeural"
        ],
        "child": [
            "ur-IN-GulNeural",
            "ur-PK-UzmaNeural"
        ]
    },
    "pa": {
        "male": [
            "pa-IN-OjasNeural"
        ],
        "female": [
            "pa-IN-VaaniNeural"
        ],
        "child": [
            "pa-IN-VaaniNeural"
        ]
    },
    "ta": {
        "male": [
            "ta-IN-ValluvarNeural",
            "ta-LK-KumarNeural",
            "ta-MY-SuryaNeural",
            "ta-SG-AnbuNeural"
        ],
        "female": [
            "ta-IN-PallaviNeural",
            "ta-LK-SaranyaNeural",
            "ta-MY-KaniNeural",
            "ta-SG-VenbaNeural"
        ],
        "child": [
            "ta-IN-PallaviNeural",
            "ta-LK-SaranyaNeural",
            "ta-MY-KaniNeural"
        ]
    },
    "te": {
        "male": [
            "te-IN-MohanNeural"
        ],
        "female": [
            "te-IN-ShrutiNeural"
        ],
        "child": [
            "te-IN-ShrutiNeural"
        ]
    },
    "gu": {
        "male": [
            "gu-IN-NiranjanNeural"
        ],
        "female": [
            "gu-IN-DhwaniNeural"
        ],
        "child": [
            "gu-IN-DhwaniNeural"
        ]
    },
    "mr": {
        "male": [
            "mr-IN-ManoharNeural"
        ],
        "female": [
            "mr-IN-AarohiNeural"
        ],
        "child": [
            "mr-IN-AarohiNeural"
        ]
    },
    "si": {
        "male": [
            "si-LK-SameeraNeural"
        ],
        "female": [
            "si-LK-ThiliniNeural"
        ],
        "child": [
            "si-LK-ThiliniNeural"
        ]
    },
    "fa": {
        "male": [
            "fa-IR-FaridNeural"
        ],
        "female": [
            "fa-IR-DilaraNeural"
        ],
        "child": [
            "fa-IR-DilaraNeural"
        ]
    },
    "he": {
        "male": [
            "he-IL-AvriNeural"
        ],
        "female": [
            "he-IL-HilaNeural"
        ],
        "child": [
            "he-IL-HilaNeural"
        ]
    },
    "tr": {
        "male": [
            "tr-TR-AhmetNeural"
        ],
        "female": [
            "tr-TR-EmelNeural"
        ],
        "child": [
            "tr-TR-EmelNeural"
        ]
    },
    "sv": {
        "male": [
            "sv-SE-MattiasNeural"
        ],
        "female": [
            "sv-SE-SofieNeural",
            "sv-SE-HilleviNeural"
        ],
        "child": [
            "sv-SE-SofieNeural",
            "sv-SE-HilleviNeural"
        ]
    },
    "no": {
        "male": [
            "nb-NO-FinnNeural"
        ],
        "female": [
            "nb-NO-PernilleNeural",
            "nb-NO-IselinNeural"
        ],
        "child": [
            "nb-NO-PernilleNeural",
            "nb-NO-IselinNeural"
        ]
    },
    "da": {
        "male": [
            "da-DK-JeppeNeural"
        ],
        "female": [
            "da-DK-ChristelNeural"
        ],
        "child": [
            "da-DK-ChristelNeural"
        ]
    },
    "fi": {
        "male": [
            "fi-FI-HarriNeural"
        ],
        "female": [
            "fi-FI-SelmaNeural",
            "fi-FI-NooraNeural"
        ],
        "child": [
            "fi-FI-SelmaNeural",
            "fi-FI-NooraNeural"
        ]
    },
    "el": {
        "male": [
            "el-GR-NestorasNeural"
        ],
        "female": [
            "el-GR-AthinaNeural"
        ],
        "child": [
            "el-GR-AthinaNeural"
        ]
    },
    "uk": {
        "male": [
            "uk-UA-OstapNeural"
        ],
        "female": [
            "uk-UA-PolinaNeural"
        ],
        "child": [
            "uk-UA-PolinaNeural"
        ]
    },
    "pl": {
        "male": [
            "pl-PL-MarekNeural"
        ],
        "female": [
            "pl-PL-AgnieszkaNeural",
            "pl-PL-ZofiaNeural"
        ],
        "child": [
            "pl-PL-AgnieszkaNeural",
            "pl-PL-ZofiaNeural"
        ]
    },
    "cs": {
        "male": [
            "cs-CZ-AntoninNeural"
        ],
        "female": [
            "cs-CZ-VlastaNeural"
        ],
        "child": [
            "cs-CZ-VlastaNeural"
        ]
    },
    "sk": {
        "male": [
            "sk-SK-LukasNeural"
        ],
        "female": [
            "sk-SK-ViktoriaNeural"
        ],
        "child": [
            "sk-SK-ViktoriaNeural"
        ]
    },
    "hu": {
        "male": [
            "hu-HU-TamasNeural"
        ],
        "female": [
            "hu-HU-NoemiNeural"
        ],
        "child": [
            "hu-HU-NoemiNeural"
        ]
    },
    "ro": {
        "male": [
            "ro-RO-EmilNeural"
        ],
        "female": [
            "ro-RO-AlinaNeural"
        ],
        "child": [
            "ro-RO-AlinaNeural"
        ]
    },
    "bg": {
        "male": [
            "bg-BG-BorislavNeural"
        ],
        "female": [
            "bg-BG-KalinaNeural"
        ],
        "child": [
            "bg-BG-KalinaNeural"
        ]
    },
    "hr": {
        "male": [
            "hr-HR-SreckoNeural"
        ],
        "female": [
            "hr-HR-GabrijelaNeural"
        ],
        "child": [
            "hr-HR-GabrijelaNeural"
        ]
    },
    "sr": {
        "male": [
            "sr-RS-NicholasNeural"
        ],
        "female": [
            "sr-RS-SophieNeural"
        ],
        "child": [
            "sr-RS-SophieNeural"
        ]
    },
    "sw": {
        "male": [
            "sw-KE-RafikiNeural",
            "sw-TZ-DaudiNeural"
        ],
        "female": [
            "sw-KE-ZuriNeural",
            "sw-TZ-RehemaNeural"
        ],
        "child": [
            "sw-KE-ZuriNeural",
            "sw-TZ-RehemaNeural"
        ]
    },
    "am": {
        "male": [
            "am-ET-AmehaNeural"
        ],
        "female": [
            "am-ET-MekdesNeural"
        ],
        "child": [
            "am-ET-MekdesNeural"
        ]
    },
    "zu": {
        "male": [
            "zu-ZA-ThembaNeural"
        ],
        "female": [
            "zu-ZA-ThandoNeural"
        ],
        "child": [
            "zu-ZA-ThandoNeural"
        ]
    },
    "pt-br": {
        "male": [
            "pt-BR-AntonioNeural",
            "pt-BR-DonatoNeural",
            "pt-BR-FabioNeural",
            "pt-BR-HumbertoNeural",
            "pt-BR-JulioNeural",
            "pt-BR-NicolauNeural"
        ],
        "female": [
            "pt-BR-FranciscaNeural",
            "pt-BR-BrendaNeural",
            "pt-BR-ElzaNeural",
            "pt-BR-GiovannaNeural",
            "pt-BR-LeilaNeural",
            "pt-BR-LeticiaNeural"
        ],
        "child": [
            "pt-BR-FranciscaNeural",
            "pt-BR-BrendaNeural",
            "pt-BR-ElzaNeural"
        ]
    },
    "es-mx": {
        "male": [
            "es-MX-JorgeNeural",
            "es-MX-CecilioNeural",
            "es-MX-GerardoNeural",
            "es-MX-LibertoNeural",
            "es-MX-LucianoNeural",
            "es-MX-PelayoNeural"
        ],
        "female": [
            "es-MX-DaliaNeural",
            "es-MX-BeatrizNeural",
            "es-MX-CandelaNeural",
            "es-MX-CarlotaNeural",
            "es-MX-LarissaNeural",
            "es-MX-MarinaNeural"
        ],
        "child": [
            "es-MX-DaliaNeural",
            "es-MX-BeatrizNeural",
            "es-MX-CandelaNeural"
        ]
    }
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

        lang_base = (language or "en").split("-")[0]
        elevenlabs_supported = lang_base in ELEVENLABS_SUPPORTED_LANGUAGE_CODES

        # Default to ElevenLabs when API key is available, Edge TTS otherwise.
        # Override with EDGE_TTS_PRIMARY=1 to force Edge TTS even with a key.
        default_edge = "0" if self.enabled else "1"
        edge_primary = os.getenv("EDGE_TTS_PRIMARY", default_edge) == "1"
        if (edge_primary or not elevenlabs_supported) and self.edge_tts_available:
            gender = await self._resolve_voice_gender(voice_id)
            fallback_path = await self._fallback_tts(text, output_path, language, voice_id, gender, pitch_shift)
            if fallback_path:
                return {"path": fallback_path, "engine": "edge-tts"}
            if not self.enabled:
                return None
            if language not in EDGE_VOICES:
                logger.error(f"TTS not available for language '{language}'")
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
            if not edge_voice:
                return None
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

    def _get_edge_voice(self, language: str, gender: str, voice_id: str) -> Optional[str]:
        """Pick a distinct edge-tts voice based on language and speaker gender."""
        pools = EDGE_VOICES.get(language)
        if not pools:
            logger.warning(f"No Edge TTS voices configured for language '{language}'")
            return None
        gender_key = gender if gender in pools else "male"
        voices = pools.get(gender_key) or pools.get("female") or pools.get("male")
        if not voices:
            logger.warning(f"No {gender_key} Edge TTS voices for language '{language}'")
            return None
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
        if normalized in LANGUAGE_MODELS:
            return LANGUAGE_MODELS[normalized]
        # Region variants (e.g. pt-br, es-mx) share the base-language model.
        base = normalized.split("-")[0]
        return LANGUAGE_MODELS.get(base, "eleven_multilingual_v2")


elevenlabs_tts = ElevenLabsTTS()
