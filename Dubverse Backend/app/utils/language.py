import logging
from typing import Optional, Dict, Set

logger = logging.getLogger(__name__)


LANGUAGE_NAMES: Dict[str, str] = {
    # East / Southeast Asia
    "zh": "Mandarin Chinese",
    "yue": "Cantonese",
    "ja": "Japanese",
    "ko": "Korean",
    "vi": "Vietnamese",
    "th": "Thai",
    "id": "Indonesian",
    "ms": "Malay",
    "tl": "Filipino",
    "km": "Khmer",
    "my": "Burmese",
    # South Asia
    "hi": "Hindi",
    "bn": "Bengali",
    "ur": "Urdu",
    "ta": "Tamil",
    "te": "Telugu",
    "gu": "Gujarati",
    "mr": "Marathi",
    "si": "Sinhala",
    # Middle East / Central Asia
    "ar": "Arabic",
    "fa": "Persian",
    "he": "Hebrew",
    "tr": "Turkish",
    # Western Europe
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "nl": "Dutch",
    "sv": "Swedish",
    "no": "Norwegian",
    "da": "Danish",
    "fi": "Finnish",
    "el": "Greek",
    # Eastern Europe
    "ru": "Russian",
    "uk": "Ukrainian",
    "pl": "Polish",
    "cs": "Czech",
    "sk": "Slovak",
    "hu": "Hungarian",
    "ro": "Romanian",
    "bg": "Bulgarian",
    "hr": "Croatian",
    "sr": "Serbian",
    # Africa
    "sw": "Swahili",
    "am": "Amharic",
    "yo": "Yoruba",
    "ig": "Igbo",
    "zu": "Zulu",
    # Americas
    "pt-br": "Portuguese (Brazil)",
    "es-mx": "Spanish (Mexico)",
}

SUPPORTED_LANGUAGE_CODES: Set[str] = set(LANGUAGE_NAMES.keys())

LANGUAGE_ALIASES: Dict[str, str] = {
    # English variants
    "english": "en",
    "eng": "en",
    "en-us": "en",
    "en-uk": "en",
    "en-gb": "en",
    "en-au": "en",
    "en-ca": "en",
    "en-in": "en",
    "englishus": "en",
    "englishuk": "en",
    # Chinese variants
    "chinese": "zh",
    "mandarin": "zh",
    "cmn": "zh",
    "zh-cn": "zh",
    "zh-hans": "zh",
    "zh-hant": "zh",
    "zh-tw": "zh",
    "zh-sg": "zh",
    # Cantonese variants
    "cantonese": "yue",
    "yue-hk": "yue",
    "yue-hant-hk": "yue",
    "zh-yue": "yue",
    "zh-hk": "yue",
    # Spanish variants
    "spanish": "es",
    "espanol": "es",
    "español": "es",
    "mexican-spanish": "es-mx",
    "mexicanspanish": "es-mx",
    "mexican spanish": "es-mx",
    "spanish-mx": "es-mx",
    "spanish (mexico)": "es-mx",
    "español mexicano": "es-mx",
    "espanol mexicano": "es-mx",
    "spanishmx": "es-mx",
    "es_mx": "es-mx",
    # Portuguese variants
    "portuguese": "pt",
    "brazilian-portuguese": "pt-br",
    "brazilianportuguese": "pt-br",
    "brazilian portuguese": "pt-br",
    "portuguese-brazil": "pt-br",
    "portuguesebr": "pt-br",
    "portuguese-br": "pt-br",
    "portuguese (brazil)": "pt-br",
    "portuguese (brasil)": "pt-br",
    "português brasileiro": "pt-br",
    "portugues brasileiro": "pt-br",
    "pt_br": "pt-br",
    "brazilian": "pt-br",
    # European
    "french": "fr",
    "german": "de",
    "deutsch": "de",
    "italian": "it",
    "dutch": "nl",
    "swedish": "sv",
    "norwegian": "no",
    "danish": "da",
    "finnish": "fi",
    "greek": "el",
    "russian": "ru",
    "ukrainian": "uk",
    "polish": "pl",
    "czech": "cs",
    "slovak": "sk",
    "hungarian": "hu",
    "romanian": "ro",
    "bulgarian": "bg",
    "croatian": "hr",
    "serbian": "sr",
    # Asian / African / Middle Eastern
    "japanese": "ja",
    "korean": "ko",
    "vietnamese": "vi",
    "thai": "th",
    "indonesian": "id",
    "malay": "ms",
    "malaysian": "ms",
    "filipino": "tl",
    "tagalog": "tl",
    "khmer": "km",
    "cambodian": "km",
    "burmese": "my",
    "myanmar": "my",
    "hindi": "hi",
    "bengali": "bn",
    "bangla": "bn",
    "urdu": "ur",
    "tamil": "ta",
    "telugu": "te",
    "gujarati": "gu",
    "marathi": "mr",
    "sinhala": "si",
    "sinhalese": "si",
    "arabic": "ar",
    "persian": "fa",
    "farsi": "fa",
    "hebrew": "he",
    "turkish": "tr",
    "swahili": "sw",
    "amharic": "am",
    "yoruba": "yo",
    "igbo": "ig",
    "zulu": "zu",
    "punjabi": "pa",
    "gurmukhi": "pa",
    # ISO 639-2 / 639-3 aliases
    "yor": "yo",
    "ibo": "ig",
    "zul": "zu",
    "amh": "am",
    "swa": "sw",
    "msa": "ms",
    "fil": "tl",
    "fra": "fr",
    "deu": "de",
    "ita": "it",
    "por": "pt",
    "spa": "es",
    "rus": "ru",
    "nld": "nl",
    "swe": "sv",
    "nor": "no",
    "dan": "da",
    "fin": "fi",
    "ell": "el",
    "ukr": "uk",
    "pol": "pl",
    "ces": "cs",
    "slk": "sk",
    "hun": "hu",
    "ron": "ro",
    "bul": "bg",
    "hrv": "hr",
    "srp": "sr",
    "ara": "ar",
    "hin": "hi",
    "ben": "bn",
    "urd": "ur",
    "tam": "ta",
    "tel": "te",
    "guj": "gu",
    "mar": "mr",
    "sin": "si",
    "fas": "fa",
    "heb": "he",
    "tur": "tr",
    "pan": "pa",
    "jpn": "ja",
    "kor": "ko",
    "zho": "zh",
    "cmn": "zh",
    "vie": "vi",
    "tha": "th",
    "ind": "id",
    "khm": "km",
    "mya": "my",
}

AUTO_ALIASES = {"auto", "detect", "auto-detect", "automatic"}


def normalize_language_code(
    language: Optional[str],
    *,
    default: str = "en",
    allow_auto: bool = False,
    strict: bool = False,
) -> str:
    if not language:
        if strict:
            raise ValueError("Language code is required")
        return default

    raw = language.strip().lower()
    if not raw:
        if strict:
            raise ValueError("Language code is required")
        return default

    if allow_auto and raw in AUTO_ALIASES:
        return "auto"

    raw = raw.replace("_", "-")
    raw_no_space = raw.replace(" ", "")

    if raw in LANGUAGE_ALIASES:
        return LANGUAGE_ALIASES[raw]
    if raw_no_space in LANGUAGE_ALIASES:
        return LANGUAGE_ALIASES[raw_no_space]

    if raw in SUPPORTED_LANGUAGE_CODES:
        return raw

    if "-" in raw:
        base = raw.split("-", 1)[0]
        if base in LANGUAGE_ALIASES:
            return LANGUAGE_ALIASES[base]
        if base in SUPPORTED_LANGUAGE_CODES:
            return base

    if len(raw) >= 2 and raw[:2].isalpha():
        candidate = raw[:2]
        if candidate in SUPPORTED_LANGUAGE_CODES:
            return candidate

    if strict:
        raise ValueError(f"Unsupported language code '{language}'")

    logger.warning(f"Unknown language code '{language}', defaulting to '{default}'")
    return default
