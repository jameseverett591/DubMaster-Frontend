import logging
import asyncio
import re
from typing import List, Dict, Optional, Tuple
import os

logger = logging.getLogger(__name__)

from app.config import get_settings
from app.utils.language import normalize_language_code, LANGUAGE_NAMES

# Glossary: maps source terms to their correct English translations.
# These are protected from machine translation via placeholder tokens.
GLOSSARY: Dict[str, str] = {
    # Character names (including common Whisper mishearings)
    "叶问": "Ip Man",
    "葉問": "Ip Man",
    "熱吻": "Ip Man",        # Whisper mishearing of 葉問
    "叶师傅": "Master Ip",
    "葉師傅": "Master Ip",
    "金師傅": "Master Jin",
    "金师傅": "Master Jin",
    "金山找": "Jin Shanzhao",
    "三浦": "Miura",
    "武痴林": "Lam",
    "李钊": "Li Zhao",
    # Martial arts terms
    "榮春": "Wing Chun",      # Whisper mishearing of 詠春
    "永春": "Wing Chun",
    "詠春": "Wing Chun",
    "咏春拳": "Wing Chun",
    "詠春拳": "Wing Chun",
    "木人桩": "wooden dummy",
    "木人樁": "wooden dummy",
    "黐手": "chi sau",
    "太极": "Tai Chi",
    "太極": "Tai Chi",
    "武术": "martial arts",
    "武術": "martial arts",
    "功夫": "kung fu",
    "师傅": "master",
    "師傅": "master",
    "师父": "master",
    "師父": "master",
    # Idiomatic expressions
    "不用說了": "That's enough",
    "不用说了": "That's enough",
    "小心你的嘴": "Mind your language",
    "小心你的嘴巴": "Mind your language",
    "看人家的": "It's up to you",
    "看人家": "It's up to you",
    # Full phrase overrides (must appear before shorter substrings)
    "怎麼樣 金師傅": "Master Jin, are you alright?",
    "怎么样 金师傅": "Master Jin, are you alright?",
    "怎麼樣金師傅": "Master Jin, are you alright?",
    "怎么样金师傅": "Master Jin, are you alright?",
}


class TranslationService:
    def __init__(self):
        settings = get_settings()
        self.deepl_api_key = settings.DEEPL_API_KEY
        self.google_api_key = os.getenv("GOOGLE_TRANSLATE_API_KEY")
        # Sort glossary by length descending so longer matches take priority
        self._glossary_sorted = sorted(GLOSSARY.items(), key=lambda kv: len(kv[0]), reverse=True)

    def _apply_glossary_pre(self, text: str) -> Tuple[str, List[Tuple[str, str]]]:
        """Replace glossary source terms with placeholder tokens before translation."""
        replacements: List[Tuple[str, str]] = []
        for i, (src_term, tgt_term) in enumerate(self._glossary_sorted):
            if src_term in text:
                # Use CAPITALIZED token that translation engines won't mangle.
                # Double-underscores get stripped by DeepL.
                placeholder = f"XGLO{i:03d}X"
                text = text.replace(src_term, placeholder)
                replacements.append((placeholder, tgt_term))
        return text, replacements

    def _apply_glossary_post(self, text: str, replacements: List[Tuple[str, str]]) -> str:
        """Replace placeholder tokens with correct target-language terms after translation."""
        for placeholder, tgt_term in replacements:
            # Also try lowercase variant in case the engine lowercased it
            text = text.replace(placeholder, tgt_term)
            text = text.replace(placeholder.lower(), tgt_term)
        return text
    
    async def translate_segments(
        self,
        segments: List[Dict],
        source_language: str,
        target_language: str
    ) -> List[Dict]:
        source_norm = normalize_language_code(source_language, allow_auto=True)
        target_norm = normalize_language_code(target_language)

        if source_norm != source_language or target_norm != target_language:
            logger.info(
                f"Normalized languages: source={source_language} -> {source_norm}, "
                f"target={target_language} -> {target_norm}"
            )

        if source_norm == target_norm:
            return segments

        # Always use batch translation — one HTTP call for all segments instead
        # of N calls.  DeepL batch is tried first (header-based auth); if it
        # fails or the key is absent, fall through to deep_translator batch.
        if self.deepl_api_key:
            result = await self._translate_segments_deepl_batch(segments, source_norm, target_norm)
            # Compare translated output against the glossary-only baseline (what
            # the text looks like after glossary substitution but NO translation).
            # This prevents glossary-only changes from inflating the change ratio
            # and masking a silent translation failure.
            glossary_baselines = [
                self._apply_glossary_post(*self._apply_glossary_pre(seg.get("text", "")))
                for seg in segments
            ]
            change_ratio = sum(
                1 for baseline, seg in zip(glossary_baselines, result)
                if seg.get("text", "").strip() != baseline.strip()
            ) / max(1, len(segments))
            if change_ratio >= 0.2:
                logger.info(f"[TRANSLATE] DeepL batch: {change_ratio:.0%} of segments changed")
                return result
            logger.warning(
                f"[TRANSLATE] DeepL batch change rate too low ({change_ratio:.0%}) — "
                "falling back"
            )

        # Google Cloud Translation API (paid, high quality)
        if self.google_api_key:
            result = await self._translate_segments_google_cloud(segments, source_norm, target_norm)
            if result is not None:
                return result

        # Last resort: free Google Translate via deep_translator (scraping)
        return await self._translate_segments_batch(segments, source_norm, target_norm)

    def _deepl_batch_sync(
        self,
        protected: List[str],
        source_language: str,
        target_language: str,
    ) -> Optional[List[Dict]]:
        """
        Synchronous DeepL HTTP call (run inside asyncio.to_thread).
        Returns the parsed translations list or None on failure.
        """
        import httpx

        deepl_target = target_language.upper()
        if deepl_target == "EN":
            deepl_target = "EN-US"
        elif deepl_target == "PT":
            deepl_target = "PT-BR"

        form_pairs: List[Tuple[str, str]] = [("text", t) for t in protected]
        form_pairs.append(("target_lang", deepl_target))
        # Omit source_lang for auto-detection; DeepL rejects "AUTO"
        if source_language.lower() not in ("auto", ""):
            form_pairs.append(("source_lang", source_language.upper()))

        headers = {
            "Authorization": f"DeepL-Auth-Key {self.deepl_api_key}",
            "Content-Type": "application/x-www-form-urlencoded",
        }

        src_display = source_language.upper() if source_language.lower() != "auto" else "AUTO-DETECT"
        logger.info(
            f"[TRANSLATE] DeepL batch: {len(protected)} segments, "
            f"{src_display} -> {deepl_target}"
        )

        # Manually encode to handle repeated 'text' keys that httpx
        # fails to serialize from a list of tuples.
        from urllib.parse import urlencode
        body = urlencode(form_pairs)

        response = httpx.post(
            "https://api-free.deepl.com/v2/translate",
            content=body.encode("utf-8"),
            headers=headers,
            timeout=30.0,
        )

        if response.status_code != 200:
            logger.warning(
                f"[TRANSLATE] DeepL batch failed: {response.status_code} {response.text[:200]}"
            )
            return None

        translations = response.json().get("translations", [])
        logger.info(f"[TRANSLATE] DeepL returned {len(translations)} translations")
        return translations

    async def _translate_segments_deepl_batch(
        self,
        segments: List[Dict],
        source_language: str,
        target_language: str,
    ) -> List[Dict]:
        """
        Send all segment texts in a single DeepL API request (multi-text batch).
        Uses the current header-based auth required since Nov 2025.
        """
        texts = [seg.get("text", "") for seg in segments]

        protected: List[str] = []
        replacements_per_seg: List[List[Tuple[str, str]]] = []
        for t in texts:
            p, r = self._apply_glossary_pre(t)
            protected.append(p)
            replacements_per_seg.append(r)

        # Build glossary-only fallback so error paths match the change_ratio
        # baseline and correctly fall through to deep_translator.
        def _glossary_fallback() -> List[Dict]:
            result = []
            for i, seg in enumerate(segments):
                glossed = self._apply_glossary_post(protected[i], replacements_per_seg[i])
                result.append({**seg, "original_text": seg.get("text", ""), "text": glossed})
            return result

        try:
            translations = await asyncio.to_thread(
                self._deepl_batch_sync, protected, source_language, target_language
            )

            if translations is None:
                return _glossary_fallback()

        except Exception as e:
            logger.error(f"[TRANSLATE] DeepL batch error: {e}")
            return _glossary_fallback()

        result: List[Dict] = []
        for i, seg in enumerate(segments):
            raw = (translations[i]["text"] if i < len(translations) else None) or protected[i]
            final = self._apply_glossary_post(raw, replacements_per_seg[i])
            result.append({**seg, "original_text": seg.get("text", ""), "text": final})

        return result

    async def _translate_segments_google_cloud(
        self,
        segments: List[Dict],
        source_language: str,
        target_language: str,
    ) -> Optional[List[Dict]]:
        """
        Translate via the official Google Cloud Translation API v2 (paid).
        Supports multiple 'q' values in one request for batch translation.
        Returns None on failure so the caller can fall through to the next engine.
        """
        texts = [seg.get("text", "") for seg in segments]

        protected: List[str] = []
        replacements_per_seg: List[List[Tuple[str, str]]] = []
        for t in texts:
            p, r = self._apply_glossary_pre(t)
            protected.append(p)
            replacements_per_seg.append(r)

        try:
            import httpx

            src = source_language
            if src == "zh":
                src = "zh-TW"

            payload = {
                "q": protected,
                "target": target_language,
                "format": "text",
            }
            # Only set source if not auto-detect
            if src.lower() not in ("auto", ""):
                payload["source"] = src

            logger.info(
                f"[TRANSLATE] Google Cloud API batch: {len(protected)} segments, "
                f"{src if src.lower() != 'auto' else 'AUTO-DETECT'} -> {target_language}"
            )

            response = await asyncio.to_thread(
                lambda: httpx.post(
                    "https://translation.googleapis.com/language/translate/v2",
                    params={"key": self.google_api_key},
                    json=payload,
                    timeout=30.0,
                )
            )

            if response.status_code != 200:
                logger.warning(
                    f"[TRANSLATE] Google Cloud API failed: {response.status_code} "
                    f"{response.text[:200]}"
                )
                return None

            data = response.json()
            translations = data.get("data", {}).get("translations", [])
            logger.info(f"[TRANSLATE] Google Cloud API returned {len(translations)} translations")

            changed = 0
            result: List[Dict] = []
            for i, seg in enumerate(segments):
                raw = (
                    translations[i]["translatedText"]
                    if i < len(translations)
                    else protected[i]
                )
                final = self._apply_glossary_post(raw, replacements_per_seg[i])
                if raw.strip() != protected[i].strip():
                    changed += 1
                result.append({**seg, "original_text": seg.get("text", ""), "text": final})

            ratio = changed / max(1, len(segments))
            logger.info(f"[TRANSLATE] Google Cloud API: {changed}/{len(segments)} changed ({ratio:.0%})")
            return result

        except Exception as e:
            logger.error(f"[TRANSLATE] Google Cloud API error: {e}")
            return None

    async def _translate_segments_batch(
        self,
        segments: List[Dict],
        source_language: str,
        target_language: str,
    ) -> List[Dict]:
        """
        Translate all segment texts in a single batch call via deep_translator.
        One HTTP request instead of N, so Google's rate limit is not triggered.
        """
        texts = [seg.get("text", "") for seg in segments]

        # Apply glossary pre-pass on every text
        protected: List[str] = []
        replacements_per_seg: List[List[Tuple[str, str]]] = []
        for t in texts:
            p, r = self._apply_glossary_pre(t)
            protected.append(p)
            replacements_per_seg.append(r)

        try:
            from deep_translator import GoogleTranslator

            src = source_language
            tgt = target_language
            # deep_translator uses zh-CN / zh-TW codes, not bare "zh"
            if src == "zh":
                src = "zh-TW"   # Traditional Chinese (Cantonese content)
            if tgt == "zh":
                tgt = "zh-CN"

            logger.info(
                f"[TRANSLATE] Batch translating {len(protected)} segments "
                f"{src} -> {tgt} via deep_translator"
            )
            translated_batch = await asyncio.to_thread(
                GoogleTranslator(source=src, target=tgt).translate_batch,
                protected,
            )
            logger.info(f"[TRANSLATE] Batch complete; {len(translated_batch)} results")
        except ImportError:
            logger.warning("[TRANSLATE] deep_translator not installed — skipping translation")
            translated_batch = protected
        except Exception as e:
            logger.error(f"[TRANSLATE] Batch translation failed: {e} — returning original text")
            translated_batch = protected

        changed_count = 0
        result: List[Dict] = []
        for i, seg in enumerate(segments):
            raw_translated = (translated_batch[i] if i < len(translated_batch) else None) or protected[i]
            # Restore glossary terms
            final = self._apply_glossary_post(raw_translated, replacements_per_seg[i])
            # Compare raw translator output against the protected input (not the
            # original) so that glossary-only substitutions don't inflate the
            # change ratio and mask a silent translation failure.
            if raw_translated.strip() != protected[i].strip():
                changed_count += 1
            result.append({**seg, "original_text": seg.get("text", ""), "text": final})

        change_ratio = changed_count / max(1, len(segments))
        if change_ratio < 0.2:
            logger.warning(
                f"[TRANSLATE] Low change rate ({change_ratio:.0%}) — batch translation may have failed. "
                "Set DEEPL_API_KEY or GOOGLE_TRANSLATE_API_KEY for reliable translation."
            )
        else:
            logger.info(f"[TRANSLATE] {changed_count}/{len(segments)} segments changed ({change_ratio:.0%})")

        return result
    
    async def _translate_text(
        self,
        text: str,
        source_language: str,
        target_language: str
    ) -> str:
        if not text.strip():
            return text

        # Protect glossary terms with placeholders before translation
        protected_text, replacements = self._apply_glossary_pre(text)
        if replacements:
            logger.debug(f"Glossary: protected {len(replacements)} terms in '{text[:60]}'")

        if self.deepl_api_key:
            translated = await self._translate_with_deepl(protected_text, source_language, target_language)
        elif self.google_api_key:
            translated = await self._translate_with_google(protected_text, source_language, target_language)
        else:
            translated = await self._translate_with_libre(protected_text, source_language, target_language)

        # Restore glossary terms in translated output
        if replacements:
            translated = self._apply_glossary_post(translated, replacements)
            logger.debug(f"Glossary: restored terms -> '{translated[:80]}'")

        return translated
    
    async def _translate_with_deepl(
        self,
        text: str,
        source_language: str,
        target_language: str
    ) -> str:
        try:
            import httpx
            
            deepl_target = target_language.upper()
            if deepl_target == "EN":
                deepl_target = "EN-US"
            elif deepl_target == "PT":
                deepl_target = "PT-BR"
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://api-free.deepl.com/v2/translate",
                    headers={"Authorization": f"DeepL-Auth-Key {self.deepl_api_key}"},
                    data={
                        "text": text,
                        "target_lang": deepl_target,
                        **({"source_lang": source_language.upper()} if source_language.lower() not in ("auto", "") else {}),
                    },
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    result = response.json()
                    return result["translations"][0]["text"]
                else:
                    logger.warning(f"DeepL API error: {response.status_code}")
                    return text
                    
        except Exception as e:
            logger.error(f"DeepL translation error: {e}")
            return text
    
    async def _translate_with_google(
        self,
        text: str,
        source_language: str,
        target_language: str
    ) -> str:
        try:
            import httpx
            
            async with httpx.AsyncClient() as client:
                payload = {
                    "q": text,
                    "target": target_language,
                    "format": "text"
                }
                if source_language != "auto":
                    payload["source"] = source_language

                response = await client.post(
                    "https://translation.googleapis.com/language/translate/v2",
                    params={"key": self.google_api_key},
                    json=payload,
                    timeout=30.0
                )
                
                if response.status_code == 200:
                    result = response.json()
                    return result["data"]["translations"][0]["translatedText"]
                else:
                    logger.warning(f"Google Translate API error: {response.status_code}")
                    return text
                    
        except Exception as e:
            logger.error(f"Google translation error: {e}")
            return text
    
    async def _translate_with_libre(
        self,
        text: str,
        source_language: str,
        target_language: str
    ) -> str:
        try:
            from deep_translator import GoogleTranslator
            
            source_code = source_language
            target_code = target_language
            
            if source_code == 'zh':
                source_code = 'zh-CN'
            if target_code == 'zh':
                target_code = 'zh-CN'
            
            logger.info(f"Translating: '{text[:50]}...' from {source_code} to {target_code}")
            
            translated = await asyncio.to_thread(
                GoogleTranslator(source=source_code, target=target_code).translate,
                text
            )
            
            logger.info(f"Translation result: '{translated[:50] if translated else 'None'}...'")
            return translated or text
            
        except ImportError:
            logger.warning("deep_translator not installed, skipping translation")
            return text
        except Exception as e:
            logger.error(f"Libre translation error: {e}")
            return text


translation_service = TranslationService()
