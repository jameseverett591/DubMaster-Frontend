from __future__ import annotations

import logging
from typing import Optional, Dict

logger = logging.getLogger(__name__)


LANGUAGE_NAMES: Dict[str, str] = {
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese",
    "ar": "Arabic",
    "hi": "Hindi",
    "ru": "Russian",
    "nl": "Dutch",
    "en": "English",
}

SUPPORTED_LANGUAGE_CODES = set(LANGUAGE_NAMES.keys())

LANGUAGE_ALIASES: Dict[str, str] = {
    "english": "en",
    "eng": "en",
    "en-us": "en",
    "en-uk": "en",
    "en-gb": "en",
    "englishus": "en",
    "englishuk": "en",
    "spanish": "es",
    "espanol": "es",
    "español": "es",
    "french": "fr",
    "german": "de",
    "deutsch": "de",
    "italian": "it",
    "portuguese": "pt",
    "portuguese-br": "pt",
    "portuguesebr": "pt",
    "japanese": "ja",
    "korean": "ko",
    "chinese": "zh",
    "mandarin": "zh",
    "zh-cn": "zh",
    "zh-hans": "zh",
    "zh-hant": "zh",
    "zh-tw": "zh",
    "cantonese": "zh",
    "yue": "zh",
    "yue-hk": "zh",
    "yue-hant-hk": "zh",
    "arabic": "ar",
    "hindi": "hi",
    "russian": "ru",
    "dutch": "nl",
}

AUTO_ALIASES = {"auto", "detect", "auto-detect", "automatic"}


def normalize_language_code(
    language: Optional[str],
    *,
    default: str = "en",
    allow_auto: bool = False,
) -> str:
    if not language:
        return default

    raw = language.strip().lower()
    if not raw:
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

    logger.warning(f"Unknown language code '{language}', defaulting to '{default}'")
    return default

