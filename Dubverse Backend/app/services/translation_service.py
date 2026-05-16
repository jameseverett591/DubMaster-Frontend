import logging
import asyncio
import re
from typing import List, Dict, Optional, Tuple
import os

logger = logging.getLogger(__name__)

from app.config import get_settings
from app.utils.language import normalize_language_code, LANGUAGE_NAMES
from app.services.glossary import get_glossary
from app.services.adaptation_engine.policy import (
    DUBBING_SYSTEM_PROMPT,
    NO_HALLUCINATION_GUARDS,
    get_character_profile,
    detect_character_from_text,
    protect_entities,
    restore_entities,
    build_name_mapping_prompt,
    fix_translation_names,
)

class TranslationService:
    def __init__(self):
        settings = get_settings()
        self.deepl_api_key = settings.DEEPL_API_KEY
        self.google_api_key = os.getenv("GOOGLE_TRANSLATE_API_KEY")
        # Glossary is loaded dynamically per source language in translate_segments.
        # Initialise with the Cantonese glossary as a safe default.
        self._glossary_sorted = sorted(get_glossary("yue").items(), key=lambda kv: len(kv[0]), reverse=True)

    def _apply_glossary_pre(self, text: str) -> Tuple[str, List[Tuple[str, str]]]:
        """Replace glossary source terms with placeholder tokens before translation."""
        # Collapse spaces between CJK characters — Whisper sometimes inserts
        # spurious whitespace (e.g. "金 師傅" instead of "金師傅"), breaking
        # glossary matching.
        _cjk_space_re = re.compile(r'(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])')
        text = _cjk_space_re.sub('', text)
        # Also strip commas/punctuation sandwiched between CJK characters —
        # Whisper vocal recovery inserts "金師父, 沒事吧" with a comma that
        # prevents glossary matching against "金師父沒事吧".
        _cjk_punct_re = re.compile(r'(?<=[\u4e00-\u9fff])[,，、;；]\s*(?=[\u4e00-\u9fff])')
        text = _cjk_punct_re.sub('', text)
        replacements: List[Tuple[str, str]] = []
        for i, (src_term, tgt_term) in enumerate(self._glossary_sorted):
            # Also collapse CJK spaces in glossary keys so we don't need
            # separate with-space/without-space duplicate entries.
            src_collapsed = _cjk_space_re.sub('', src_term)
            if src_collapsed in text:
                # Use CAPITALIZED token that translation engines won't mangle.
                # Double-underscores get stripped by DeepL.
                placeholder = f"XGLO{i:03d}X"
                text = text.replace(src_collapsed, placeholder)
                replacements.append((placeholder, tgt_term))
        # Insert a space between any two adjacent XGLO tokens so that when they
        # are restored the word-boundary check in _apply_glossary_post always has
        # a gap character — prevents "Brother Wenmy master" when 文哥 and 我師父
        # are adjacent in the source and both get replaced.
        text = re.sub(r'(XGLO\d{3}X)(?=XGLO\d{3}X)', r'\1 ', text)
        return text, replacements

    def _apply_glossary_post(self, text: str, replacements: List[Tuple[str, str]]) -> str:
        """Replace placeholder tokens with correct target-language terms after translation."""
        for placeholder, tgt_term in replacements:
            # Also try lowercase variant in case the engine lowercased it
            for ph in (placeholder, placeholder.lower()):
                if ph not in text:
                    continue
                # Ensure a space between the restored term and adjacent word chars
                # e.g. "OkayKung" → "Okay Kung", "Okaykung" → "Okay kung"
                idx = text.find(ph)
                before = text[idx - 1] if idx > 0 else ""
                after = text[idx + len(ph)] if idx + len(ph) < len(text) else ""
                repl = tgt_term
                if before and before.isalpha() and repl and repl[0].isalpha():
                    repl = " " + repl
                if after and after.isalpha() and repl and repl[-1].isalpha():
                    repl = repl + " "
                text = text.replace(ph, repl)
        # Strip any placeholder tokens that were NOT in the replacements list
        # (e.g. tokens from a prior pass or batch misalignment) so they never
        # reach TTS as literal "XGLO one zero four X" audio.
        if re.search(r'XGLO\d{3}X', text, re.IGNORECASE):
            logger.warning(f"[GLOSSARY] Unresolved placeholder(s) in post-pass: '{text}' — stripping")
            text = re.sub(r'XGLO\d{3}X', '', text, flags=re.IGNORECASE).strip()
        # Fix concatenated English words from adjacent glossary replacements
        # e.g. "Wing ChunIp Man" → "Wing Chun Ip Man"
        text = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
        # Fix common translation engine mistranslations that slip through
        # when the glossary placeholder didn't match the source text.
        # DeepL/Google sometimes translate 南拳 as "Southpaw" or "left-handed"
        # instead of "Southern Fist".
        _POST_FIXES = {
            "Southpaw": "Southern Fist",
            "southpaw": "Southern Fist",
            "left-handed": "Southern Fist",
            "Northern Boxing": "Northern Fist",
            "Southern Boxing": "Southern Fist",
            "Northern Fist Boxing": "Northern Fist",
            "Southern Fist Boxing": "Southern Fist",
            "Master Xing": "Master Shin",
            "Master Xin": "Master Shin",
            "Master Jin": "Master Shin",
            "Master Kin": "Master Shin",
            "Master Gam": "Master Shin",
            # LLM hallucinations observed on short Cantonese utterances
            "Fire Mindup": "Please",
            "fire mindup": "Please",
            "Obsessed": "I'll pay",
            "obsessed": "I'll pay",
            # GPT double-negative on 唔係南北拳㗎嘛
            "not non-northern fist": "It's not about Northern or Southern Fist",
            "Not non-northern fist": "It's not about Northern or Southern Fist",
            "Not non-Northern Fist": "It's not about Northern or Southern Fist",
            "not non-Northern Fist": "It's not about Northern or Southern Fist",
            "not non-northern": "It's not about Northern or Southern Fist",
            "Not non-northern": "It's not about Northern or Southern Fist",
            # GPT inconsistencies on final section
            "It is not a matter of Northern or Southern Fist": "It's not about Northern or Southern Fist",
            "It's not a matter of Northern or Southern Fist": "It's not about Northern or Southern Fist",
            "Brother Quan":  "Master Chin",   # observed LLM hallucination for 陳師父
            "Master Quan":   "Master Chin",   # LLM romanization of 陳 (Chan → Quan)
            # 武痴林 romanization variants — catch slipthrough after glossary
            "Wu Cilin":      "Lam",
            "Wu Zilin":      "Lam",
            "Wu Ci Lin":     "Lam",
            "Wu Zi Lin":     "Lam",
            # Plural agreement: these keys are intentionally REMOVED from plain-string
            # replacement — using regex below instead (word-boundary prevents double-s
            # when the translation already returns "masters").
            # DO NOT add "so many master" / "plenty of master" / "many master" here.
            # Ah Jun capitalization/spelling variants
            "ah June":       "Ah Jun",
            "Ah June":       "Ah Jun",
            "ah jun":        "Ah Jun",
            "Uncle Man":     "Uncle Ip",
            "uncle man":     "Uncle Ip",
            "Uncle IP":      "Uncle Ip",   # LLM/adaptation caps both letters
            "uncle ip":      "Uncle Ip",
        }
        for wrong, correct in _POST_FIXES.items():
            if wrong in text:
                text = text.replace(wrong, correct)
        # Plural fix — word-boundary regex prevents "masters" → "masterss" double-s
        # when the translation engine already pluralised correctly.
        text = re.sub(r'\b(so many|plenty of|many) master\b', r'\1 masters', text)
        # Strip timing budget values echoed from the prompt (e.g. "1.2s, " or "1.2S, " at start).
        # Claude sometimes repeats the (Xs) hint despite being told not to.
        text = re.sub(r'^\d+\.?\d*[sS][,.]?\s*', '', text).strip()
        # Strip leading discourse-particle prefixes that LLMs sometimes emit
        # when Cantonese 講/gong opens a line (e.g. "Kong, I really want to see"
        # or "Gong, today Northern Fist lost...").  These are NOT character names.
        text = re.sub(r'^(?:Kong|Gong|Cobb|Cobbs?|Come\s+on|Come|Kami|Wai|Hai|Kwam|Kwom|Kwong|Kemei|Keme|Kerm|Ker|Gam|Gem)[,\s]+', '', text, flags=re.IGNORECASE).strip()
        # Second pass: catch bare "Come" before a proper noun (no comma)
        text = re.sub(r'^Come\s+(?=[A-Z])', '', text).strip()
        # Strip trailing TTS/translation artifacts — single non-words appended to real lines
        text = re.sub(r'\s+\bmigers?\b\.?$', '', text, flags=re.IGNORECASE).strip()
        # Drop YouTube outro / promotional content hallucinated by Whisper
        if re.search(r'like.*subscribe|subscribe.*bell|hit the bell|tip tip', text, re.IGNORECASE):
            return ""
        # Drop LLM meta-commentary that sometimes appears as a final "segment"
        if re.search(r'^(summariz|in summary|summary|to summarize|closing|in conclusion)', text, re.IGNORECASE):
            return ""
        # Strip [[word]] bracket artifacts left by Claude over-applying the [[ENTITY:n]] pattern.
        # By this point all real [[ENTITY:n]] tokens are already restored, so any remaining
        # [[...]] brackets are LLM noise and should be unwrapped.
        # Also strip empty [[]] brackets (Claude hallucinated a name placeholder with no content).
        text = re.sub(r'\[\[\s*\]\]', '', text).strip()
        text = re.sub(r'\[\[([^\]]+)\]\]', r'\1', text).strip()
        return text
    
    async def translate_segments(
        self,
        segments: List[Dict],
        source_language: str,
        target_language: str
    ) -> List[Dict]:
        # Load the glossary for the incoming source language so every downstream
        # call to _apply_glossary_pre/_post uses the correct language-specific terms.
        self._glossary_sorted = sorted(
            get_glossary(source_language).items(), key=lambda kv: len(kv[0]), reverse=True
        )
        logger.info(
            f"[TRANSLATE] Loaded glossary for source_language='{source_language}' "
            f"({len(self._glossary_sorted)} entries)"
        )

        source_norm = normalize_language_code(source_language, allow_auto=True)
        target_norm = normalize_language_code(target_language)

        if source_norm != source_language or target_norm != target_language:
            logger.info(
                f"Normalized languages: source={source_language} -> {source_norm}, "
                f"target={target_language} -> {target_norm}"
            )

        if source_norm == target_norm:
            return segments

        # Cantonese detection: Whisper may tag it as "zh" or "yue".
        # Either way, use yue-HK as source for Google Cloud so the engine
        # knows it is spoken Cantonese grammar, not Standard Written Chinese.
        is_cantonese = source_norm in ("yue", "zh-yue", "zh-HK") or \
                       source_language in ("yue", "zh-yue", "zh-HK")

        # Auto-detect Cantonese from text even when source is reported as "zh".
        # Local Whisper outputs Cantonese particles (唔, 㗎, 係, 喺 etc.) that
        # DeepL cannot handle — force LLM path for any CJK text.
        _CJK_SOURCES = {"zh", "zh-cn", "zh-tw", "zh-hans", "zh-hant", "zh-sg"}
        if not is_cantonese and source_norm in _CJK_SOURCES:
            _CANTONESE_MARKERS = {"唔", "㗎", "喺", "嘅", "佢", "啩", "喎", "囉", "囉"}
            all_text = " ".join(seg.get("text", "") for seg in segments)
            if any(m in all_text for m in _CANTONESE_MARKERS):
                is_cantonese = True
                logger.info("[TRANSLATE] Cantonese markers detected in zh transcript — routing to LLM")
            else:
                # Even for standard Mandarin zh, use LLM — DeepL loses glossary context
                is_cantonese = True
                logger.info("[TRANSLATE] zh source detected — routing to LLM (skipping DeepL)")

        effective_source = "yue-HK" if is_cantonese else source_norm

        if is_cantonese:
            logger.info(
                f"[TRANSLATE] Cantonese/CJK detected ({source_language}) — "
                f"using source=yue-HK for Google Cloud; GPT-4 fallback available"
            )

        # LLM translation first for Cantonese — handles spoken grammar, idioms,
        # tone, and dubbing context better than any MT engine.
        # Priority: Claude (Anthropic) → Azure OpenAI → OpenAI
        anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
        openai_key = os.getenv("OPENAI_API_KEY", "")
        azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "")
        azure_key = os.getenv("AZURE_OPENAI_KEY", "")
        has_llm = bool(anthropic_key) or bool(openai_key) or (bool(azure_endpoint) and bool(azure_key))

        # Exact-match overrides for single-word utterances — bypass LLM entirely.
        # These are short Cantonese words that LLMs hallucinate into garbage.
        _EXACT_OVERRIDES = {
            "好": "Okay.", "好呀": "Sure.", "好了": "Alright.",
            "請": "Please.", "请": "Please.",
            "我賠": "I'll pay.", "我赔": "I'll pay.",
            "包賠": "I'll pay.", "照賠": "I'll pay.",
            "賠": "I'll pay.", "赔": "I'll pay.",
        }
        for seg in segments:
            stripped = (seg.get("text") or "").strip()
            if stripped in _EXACT_OVERRIDES:
                seg["text"] = _EXACT_OVERRIDES[stripped]

        if is_cantonese and has_llm:
            # Try Claude first (most reliable for Cantonese)
            if anthropic_key:
                result = await self._translate_segments_claude(
                    segments, target_norm, source_norm
                )
                if result is not None:
                    return result
                logger.warning("[TRANSLATE] Claude Cantonese translation failed — trying GPT")

            # Fall back to GPT-4 (Azure or OpenAI)
            if bool(openai_key) or (bool(azure_endpoint) and bool(azure_key)):
                result = await self._translate_segments_gpt(
                    segments, target_norm, source_norm
                )
                if result is not None:
                    return result
                logger.warning("[TRANSLATE] GPT-4 Cantonese translation failed — falling back")

        # DeepL: does not support Cantonese as source, so skip for yue content.
        if self.deepl_api_key and not is_cantonese:
            result = await self._translate_segments_deepl_batch(segments, source_norm, target_norm)
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

        # Google Cloud: supports yue-HK source explicitly.
        if self.google_api_key:
            result = await self._translate_segments_google_cloud(
                segments, effective_source, target_norm
            )
            if result is not None:
                return result

        # Last resort: free Google Translate via deep_translator (scraping)
        return await self._translate_segments_batch(segments, source_norm, target_norm)

    async def _translate_segments_claude(
        self,
        segments: List[Dict],
        target_language: str,
        source_language: str = "yue",
    ) -> Optional[List[Dict]]:
        """
        Translate segments using Claude via the Anthropic API.

        Primary LLM translator for Cantonese → English dubbing.
        Claude understands Cantonese grammar, particles, and martial-arts context.
        """
        import httpx

        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key:
            return None

        lang_name = LANGUAGE_NAMES.get(source_language, "Cantonese")
        target_name = LANGUAGE_NAMES.get(target_language, "English")

        texts = [seg.get("text", "") for seg in segments]
        protected: List[str] = []
        replacements_per_seg: List[List[Tuple[str, str]]] = []
        entity_replacements_per_seg: List[List[Tuple[str, str]]] = []
        for t in texts:
            p, r = self._apply_glossary_pre(t)
            p2, r2 = protect_entities(p)
            protected.append(p2)
            replacements_per_seg.append(r)
            entity_replacements_per_seg.append(r2)

        def _slot(seg: Dict) -> str:
            start = float(seg.get("start", 0))
            end = float(seg.get("end", start))
            return f"{round(max(0.3, end - start), 1)}s"

        numbered_lines = "\n".join(
            f"{i+1}. ({_slot(segments[i])}) {p}"
            for i, p in enumerate(protected)
        )

        # Build centralized system prompt from policy layer
        system_prompt_parts = [DUBBING_SYSTEM_PROMPT]

        detected_profile = detect_character_from_text("\n".join(texts))
        if detected_profile:
            system_prompt_parts.append("")
            system_prompt_parts.append(detected_profile.to_prompt())

        name_mapping = build_name_mapping_prompt(texts)
        if name_mapping:
            system_prompt_parts.append("")
            system_prompt_parts.append(name_mapping)

        system_prompt_parts.append("")
        system_prompt_parts.append("DOMAIN-SPECIFIC RULES:")
        system_prompt_parts.append("- These are SPOKEN Cantonese martial arts film dialogue lines.")
        system_prompt_parts.append("- Each line has a timing budget (Xs) — choose words that fit naturally in that time.")
        system_prompt_parts.append("- Short exclamations must stay short (1-3 syllables).")
        system_prompt_parts.append("- NEVER combine two numbered lines into one answer.")
        system_prompt_parts.append("- Do NOT echo or repeat the timing value (Xs) in your answer.")
        system_prompt_parts.append("- Do NOT prefix with speaker names (e.g. NEVER 'Ip Man: ...').")
        system_prompt_parts.append("- Drop Cantonese discourse particles (講, 係, 喂, 嗱, 嚟, 囉, 㗎) entirely.")
        system_prompt_parts.append("- [[ENTITY:n]] tokens are PROTECTED placeholders — keep them EXACTLY.")
        system_prompt_parts.append("")
        system_prompt_parts.append("TONE AND EMOTIONAL STANCE:")
        system_prompt_parts.append("- This is a classic period martial arts film. Characters speak with dignity, restraint, and warmth.")
        system_prompt_parts.append("- PRESERVE the speaker's emotional stance. If a character is being self-deprecating or humble, the translation MUST reflect that.")
        system_prompt_parts.append("- NEVER make a humble, self-deprecating line sound like a criticism of another character.")
        system_prompt_parts.append("- Do NOT optimise for a 'clever' English line at the cost of faithfulness. A plain faithful translation beats a witty unfaithful one.")
        system_prompt_parts.append("- Calm, friendly exchanges between friends must stay calm and friendly.")
        system_prompt_parts.append("- NEVER add condescension, sarcasm, or aggressive subtext not present in the source.")
        system_prompt_parts.append("")
        system_prompt_parts.append(NO_HALLUCINATION_GUARDS)

        system_prompt = "\n".join(system_prompt_parts)

        user_prompt = (
            f"Translate these spoken {lang_name} dialogue lines to natural {target_name} for voice actors.\n\n"
            f"Preserve meaning, emotion, and character voice. "
            f"Use colloquial spoken English — not formal or written style.\n\n"
            f"{numbered_lines}"
        )

        try:
            logger.info(
                f"[TRANSLATE] Claude batch: {len(segments)} segments, "
                f"{lang_name} -> {target_name} via Anthropic API"
            )

            payload = {
                "model": "claude-sonnet-4-6",
                "max_tokens": 8192,
                "temperature": 0.3,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            }

            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            }

            response = await asyncio.to_thread(
                lambda: httpx.post(
                    "https://api.anthropic.com/v1/messages",
                    json=payload, headers=headers, timeout=60.0,
                )
            )

            if response.status_code != 200:
                logger.warning(
                    f"[TRANSLATE] Claude failed: {response.status_code} "
                    f"{response.text[:200]}"
                )
                return None

            data = response.json()
            reply = data["content"][0]["text"].strip()

            gpt_lines = re.findall(r"^\d+\.\s*(.+)$", reply, re.MULTILINE)

            if len(gpt_lines) < len(segments):
                logger.warning(
                    f"[TRANSLATE] Claude returned {len(gpt_lines)} lines "
                    f"for {len(segments)} segments — padding with originals"
                )

            result: List[Dict] = []
            changed = 0
            retry_indices: List[int] = []
            for i, seg in enumerate(segments):
                if i < len(gpt_lines):
                    raw = gpt_lines[i]
                    # Restore protected entities first, then fix hallucinations, then glossary
                    raw = restore_entities(raw, entity_replacements_per_seg[i])
                    raw = fix_translation_names(raw)
                    final = self._apply_glossary_post(raw, replacements_per_seg[i])
                    if raw.strip() != protected[i].strip():
                        changed += 1
                else:
                    # Claude returned fewer lines than segments — mark for retry
                    # rather than padding with raw CJK (which would go to TTS verbatim)
                    raw = restore_entities(protected[i], entity_replacements_per_seg[i])
                    raw = fix_translation_names(raw)
                    final = self._apply_glossary_post(
                        raw, replacements_per_seg[i]
                    )
                    retry_indices.append(i)
                result.append({
                    **seg, "original_text": seg.get("text", ""), "text": final,
                })

            # CJK leak guard — flag any segment that still contains CJK after translation.
            # This catches cases where Claude echoed the source instead of translating it.
            _cjk_leak_re = re.compile(r'[一-鿿぀-ゟ゠-ヿ]')
            for i, seg_result in enumerate(result):
                if i not in retry_indices and _cjk_leak_re.search(seg_result.get("text", "")):
                    logger.warning(
                        f"[TRANSLATE] CJK leak in seg {i}: '{seg_result['text'][:60]}' — queuing retry"
                    )
                    retry_indices.append(i)

            # Retry segments that didn't get a Claude translation by translating
            # them individually via _translate_text (uses DeepL/Google/Claude single).
            if retry_indices:
                logger.warning(
                    f"[TRANSLATE] Retrying {len(retry_indices)} untranslated segment(s) "
                    f"individually: indices {retry_indices}"
                )
                _cjk_re = re.compile(r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]')
                for i in retry_indices:
                    original_text = segments[i].get("text", "")
                    if not original_text.strip():
                        continue
                    try:
                        retranslated = await self._translate_text(
                            original_text,
                            source_language,
                            target_language,
                        )
                        if retranslated and not _cjk_re.search(retranslated):
                            result[i] = {
                                **segments[i],
                                "original_text": original_text,
                                "text": retranslated,
                            }
                            changed += 1
                            logger.info(
                                f"[TRANSLATE] Retry seg {i}: '{original_text[:40]}' → '{retranslated[:40]}'"
                            )
                    except Exception as retry_e:
                        logger.error(f"[TRANSLATE] Retry seg {i} failed: {retry_e}")

            ratio = changed / max(1, len(segments))
            logger.info(
                f"[TRANSLATE] Claude: {changed}/{len(segments)} segments "
                f"changed ({ratio:.0%})"
            )
            return result

        except Exception as e:
            logger.error(f"[TRANSLATE] Claude error: {e}")
            return None

    async def _translate_segments_gpt(
        self,
        segments: List[Dict],
        target_language: str,
        source_language: str = "yue",
    ) -> Optional[List[Dict]]:
        """
        Translate segments using GPT-4 via Azure OpenAI or OpenAI API.

        Designed for Cantonese → English where standard MT engines fail
        because they treat Cantonese speech as Standard Written Chinese,
        losing grammar, particles, and idiomatic meaning.

        Each segment is translated individually with dubbing context so GPT
        can preserve emotional tone and natural spoken phrasing.
        """
        import httpx

        azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "").rstrip("/")
        azure_key = os.getenv("AZURE_OPENAI_KEY", "")
        azure_deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")
        openai_key = os.getenv("OPENAI_API_KEY", "")

        use_azure = bool(azure_endpoint) and bool(azure_key)
        use_openai = bool(openai_key) and not use_azure

        if not use_azure and not use_openai:
            return None

        lang_name = LANGUAGE_NAMES.get(source_language, "Cantonese")
        target_name = LANGUAGE_NAMES.get(target_language, "English")

        # Build all segment texts with glossary pre-processing
        texts = [seg.get("text", "") for seg in segments]
        protected: List[str] = []
        replacements_per_seg: List[List[Tuple[str, str]]] = []
        entity_replacements_per_seg: List[List[Tuple[str, str]]] = []
        for t in texts:
            p, r = self._apply_glossary_pre(t)
            p2, r2 = protect_entities(p)
            protected.append(p2)
            replacements_per_seg.append(r)
            entity_replacements_per_seg.append(r2)

        # Build a single prompt with all segments + their timing slot.
        # GPT uses the duration to choose words that fit the on-screen moment —
        # a 0.8s slot needs "Sure." not "Absolutely, without question."
        def _slot(seg: Dict) -> str:
            start = float(seg.get("start", 0))
            end = float(seg.get("end", start))
            dur = round(max(0.3, end - start), 1)
            return f"{dur}s"

        numbered_lines = "\n".join(
            f"{i+1}. ({_slot(segments[i])}) {p}"
            for i, p in enumerate(protected)
        )

        # Build centralized system prompt from policy layer
        system_prompt_parts = [DUBBING_SYSTEM_PROMPT]

        detected_profile = detect_character_from_text("\n".join(texts))
        if detected_profile:
            system_prompt_parts.append("")
            system_prompt_parts.append(detected_profile.to_prompt())

        name_mapping = build_name_mapping_prompt(texts)
        if name_mapping:
            system_prompt_parts.append("")
            system_prompt_parts.append(name_mapping)

        system_prompt_parts.append("")
        system_prompt_parts.append("DOMAIN-SPECIFIC RULES:")
        system_prompt_parts.append("- These are SPOKEN Cantonese martial arts film dialogue lines.")
        system_prompt_parts.append("- Each line has a timing budget (Xs) — choose words that fit naturally in that time.")
        system_prompt_parts.append("- Short exclamations must stay short (1-3 syllables).")
        system_prompt_parts.append("- NEVER combine two numbered lines into one answer.")
        system_prompt_parts.append("- Do NOT echo or repeat the timing value (Xs) in your answer.")
        system_prompt_parts.append("- Do NOT prefix with speaker names (e.g. NEVER 'Ip Man: ...').")
        system_prompt_parts.append("- Drop Cantonese discourse particles (講, 係, 喂, 嗱, 嚟, 囉, 㗎) entirely.")
        system_prompt_parts.append("- [[ENTITY:n]] tokens are PROTECTED placeholders — keep them EXACTLY.")
        system_prompt_parts.append("")
        system_prompt_parts.append("TONE AND EMOTIONAL STANCE:")
        system_prompt_parts.append("- This is a classic period martial arts film. Characters speak with dignity, restraint, and warmth.")
        system_prompt_parts.append("- PRESERVE the speaker's emotional stance. If a character is being self-deprecating or humble, the translation MUST reflect that.")
        system_prompt_parts.append("- NEVER make a humble, self-deprecating line sound like a criticism of another character.")
        system_prompt_parts.append("- Do NOT optimise for a 'clever' English line at the cost of faithfulness. A plain faithful translation beats a witty unfaithful one.")
        system_prompt_parts.append("- Calm, friendly exchanges between friends must stay calm and friendly.")
        system_prompt_parts.append("- NEVER add condescension, sarcasm, or aggressive subtext not present in the source.")
        system_prompt_parts.append("")
        system_prompt_parts.append(NO_HALLUCINATION_GUARDS)

        system_prompt = "\n".join(system_prompt_parts)

        user_prompt = (
            f"Translate these spoken {lang_name} dialogue lines to natural {target_name} for voice actors.\n\n"
            f"Preserve meaning, emotion, and character voice. "
            f"Use colloquial spoken English — not formal or written style.\n\n"
            f"{numbered_lines}"
        )

        try:
            if use_azure:
                api_version = "2024-06-01"
                url = (
                    f"{azure_endpoint}/openai/deployments/{azure_deployment}"
                    f"/chat/completions?api-version={api_version}"
                )
                headers = {"api-key": azure_key, "Content-Type": "application/json"}
            else:
                url = "https://api.openai.com/v1/chat/completions"
                headers = {
                    "Authorization": f"Bearer {openai_key}",
                    "Content-Type": "application/json",
                }

            payload = {
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0.3,
                "max_tokens": 8192,
            }
            if use_openai:
                payload["model"] = "gpt-4o"

            logger.info(
                f"[TRANSLATE] GPT-4 batch: {len(segments)} segments, "
                f"{lang_name} -> {target_name} via {'Azure OpenAI' if use_azure else 'OpenAI'}"
            )

            response = await asyncio.to_thread(
                lambda: httpx.post(url, json=payload, headers=headers, timeout=60.0)
            )

            if response.status_code != 200:
                logger.warning(
                    f"[TRANSLATE] GPT-4 failed: {response.status_code} "
                    f"{response.text[:200]}"
                )
                return None

            data = response.json()
            reply = data["choices"][0]["message"]["content"].strip()

            # Parse numbered lines from GPT response
            import re
            gpt_lines = re.findall(r"^\d+\.\s*(.+)$", reply, re.MULTILINE)

            if len(gpt_lines) < len(segments):
                logger.warning(
                    f"[TRANSLATE] GPT-4 returned {len(gpt_lines)} lines "
                    f"for {len(segments)} segments — retrying with stricter prompt"
                )
                # If the count is badly off (>20% missing), fail and let fallback handle it
                if len(gpt_lines) < len(segments) * 0.8:
                    return None

            result: List[Dict] = []
            changed = 0
            for i, seg in enumerate(segments):
                if i < len(gpt_lines):
                    raw = gpt_lines[i]
                    # Restore protected entities first, then fix hallucinations, then glossary
                    raw = restore_entities(raw, entity_replacements_per_seg[i])
                    raw = fix_translation_names(raw)
                    final = self._apply_glossary_post(raw, replacements_per_seg[i])
                    if raw.strip() != protected[i].strip():
                        changed += 1
                else:
                    raw = restore_entities(protected[i], entity_replacements_per_seg[i])
                    raw = fix_translation_names(raw)
                    final = self._apply_glossary_post(
                        raw, replacements_per_seg[i]
                    )
                result.append({
                    **seg,
                    "original_text": seg.get("text", ""),
                    "text": final,
                })

            ratio = changed / max(1, len(segments))
            logger.info(
                f"[TRANSLATE] GPT-4: {changed}/{len(segments)} segments "
                f"changed ({ratio:.0%})"
            )
            return result

        except Exception as e:
            logger.error(f"[TRANSLATE] GPT-4 error: {e}")
            return None

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
            if src in ("yue", "yue-HK", "zh-yue", "zh-HK"):
                src = "auto"
            elif src == "zh":
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

        # If a segment was fully consumed by the glossary (only a placeholder
        # remains), resolve it immediately so translation engines never see
        # placeholder tokens — free engines mangle them (e.g. XGLO016X → "Gan").
        _placeholder_only = re.compile(r'^XGLO\d{3}X$')
        pre_resolved: List[Optional[str]] = []
        translate_indices: List[int] = []
        translate_texts: List[str] = []
        for i, p in enumerate(protected):
            if _placeholder_only.match(p.strip()):
                pre_resolved.append(self._apply_glossary_post(p, replacements_per_seg[i]))
            else:
                pre_resolved.append(None)
                translate_indices.append(i)
                translate_texts.append(p)

        try:
            from deep_translator import GoogleTranslator

            src = source_language
            tgt = target_language
            # deep_translator uses zh-CN / zh-TW codes, not bare "zh" or "yue"
            if src in ("zh", "yue"):
                src = "zh-TW"   # Traditional Chinese (closest to Cantonese)
            if tgt == "zh":
                tgt = "zh-CN"

            logger.info(
                f"[TRANSLATE] Batch translating {len(translate_texts)} segments "
                f"{src} -> {tgt} via deep_translator"
            )
            translated_batch = await asyncio.to_thread(
                GoogleTranslator(source=src, target=tgt).translate_batch,
                translate_texts,
            )
            logger.info(f"[TRANSLATE] Batch complete; {len(translated_batch)} results")
        except ImportError:
            logger.warning("[TRANSLATE] deep_translator not installed — skipping translation")
            translated_batch = translate_texts
        except Exception as e:
            logger.error(f"[TRANSLATE] Batch translation failed: {e} — returning original text")
            translated_batch = translate_texts

        # Merge translate_batch results back with pre_resolved glossary-only segments
        translated_map: Dict[int, str] = {}
        for j, idx in enumerate(translate_indices):
            translated_map[idx] = translated_batch[j] if j < len(translated_batch) else translate_texts[j]

        changed_count = 0
        result: List[Dict] = []
        for i, seg in enumerate(segments):
            if pre_resolved[i] is not None:
                result.append({**seg, "original_text": seg.get("text", ""), "text": pre_resolved[i]})
                changed_count += 1
            else:
                raw_translated = translated_map.get(i) or protected[i]
                final = self._apply_glossary_post(raw_translated, replacements_per_seg[i])
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

            if source_code in ('zh', 'yue'):
                source_code = 'zh-TW'
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
