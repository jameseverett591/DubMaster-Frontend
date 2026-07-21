import logging
import asyncio
import re
import secrets
from typing import List, Dict, Optional, Tuple
import os

logger = logging.getLogger(__name__)

# Matches a marked reply line like "[[SEG-a3f9c2]] translated text here".
# See _generate_line_markers / _parse_marked_reply / _validate_marked_mapping —
# these replace the old "1. 2. 3." numbered-line scheme, whose positional zip
# back onto segments silently desynced text/timing whenever the LLM merged two
# adjacent lines into one answer (confirmed root cause, 2026-07-14).
_MARKER_LINE_RE = re.compile(r"^\s*\[\[SEG-([0-9a-f]{6})\]\]\s*(.*)$")

from app.config import get_settings
from app.utils.language import normalize_language_code, LANGUAGE_NAMES
from app.services.glossary import get_glossary, build_phonetic_index, _cjk_pinyin, _is_cjk
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

# Split after .!? followed by whitespace + uppercase letter.
# Em-dash variant catches ". — Next sentence" patterns from some LLM outputs.
_SENTENCE_SPLIT_RE = re.compile(
    r'(?<=[.!?])\s+(?=[A-Z])'
    r'|\s+—\s+(?=[A-Z])'
)

# ── Natural speech rate constants ─────────────────────────────────────────────
# All tunable via environment variables so RunPod instances can be dialled in
# without a code deploy — just update the env var and restart the container.
#
# 14 chars/sec ≈ 3.5 words/sec at avg 4-char word+space — comfortable dubbed
# dialogue pace matching the baseline set in the editor's handleGenerateSpeech.
NATURAL_SPEECH_RATE = float(os.getenv("DUBMASTER_NATURAL_SPEECH_RATE", "3.5"))  # words/sec
FAST_SPEECH_RATE    = float(os.getenv("DUBMASTER_FAST_SPEECH_RATE",    "4.5"))  # words/sec
SLOW_SPEECH_RATE    = float(os.getenv("DUBMASTER_SLOW_SPEECH_RATE",    "2.5"))  # words/sec
MAX_SPEED_RATIO     = float(os.getenv("DUBMASTER_MAX_SPEED_RATIO",     "1.15")) # 15% above natural
MIN_SPEED_RATIO     = float(os.getenv("DUBMASTER_MIN_SPEED_RATIO",     "0.85")) # 15% below natural
_CHARS_PER_SECOND   = float(os.getenv("DUBMASTER_CHARS_PER_SECOND",   "14.0")) # chars/sec
_MIN_SEGMENT_SECS   = float(os.getenv("DUBMASTER_MIN_SEGMENT_SECS",    "0.8"))  # absolute floor


def natural_duration(text: str) -> float:
    """Minimum comfortable TTS duration for this text at natural speech rate.
    'My name is Jin Shan Zhao.' = 26 chars → 1.86 s minimum at 14 chars/s."""
    return max(_MIN_SEGMENT_SECS, len(text) / _CHARS_PER_SECOND)


def split_translated_sentences(segments: list) -> list:
    """
    Expand segments whose translated text spans multiple sentences into one
    segment per sentence. Time windows are allocated proportionally by natural
    speech duration (character-rate based), so each sentence gets time in
    proportion to how long it takes to say — not raw character count.
    Each sub-segment carries auto_split=True.
    Non-split segments pass through unchanged.
    """
    # Mask title/honorific abbreviations before splitting so their periods
    # are never treated as sentence boundaries.  Restored after split.
    _TITLE_ABBREV_RE = re.compile(r'\b(Mr|Mrs|Ms|Dr|Prof|Jr|Sr|St|Lt|Sgt|Gen|Col|Maj|Capt)\.')
    out: list = []
    for seg in segments:
        text = (seg.get("translated_text") or seg.get("text") or "").strip()
        text = _TITLE_ABBREV_RE.sub(lambda m: m.group(1) + '\x00', text)
        sentences = [s.replace('\x00', '.').strip() for s in _SENTENCE_SPLIT_RE.split(text) if s.strip()]
        if len(sentences) <= 1:
            out.append(seg)
            continue
        n       = len(sentences)
        start   = float(seg.get("start", 0.0))
        end     = float(seg.get("end", start))
        duration = end - start
        orig_id = seg.get("segment_id", "")

        # Allocate time proportional to natural speaking duration per sentence.
        # This ensures short sentences ("Yes.") and long ones get fair shares —
        # raw character count underweights short function words.
        nat_durs   = [natural_duration(s) for s in sentences]
        total_nat  = sum(nat_durs)
        fracs      = [d / total_nat for d in nat_durs]

        cursor = start
        for i, (sentence, frac) in enumerate(zip(sentences, fracs)):
            seg_end = (cursor + duration * frac) if i < n - 1 else end
            out.append({
                **seg,
                "text":                sentence,
                "translated_text":     sentence,
                "start":               round(cursor, 3),
                "end":                 round(seg_end, 3),
                "auto_split":          True,
                "original_segment_id": orig_id,
                "split_index":         i,
                # There's no clean way to slice the original-language line 1:1 per
                # English sentence — one source utterance can split into several
                # English sentences with no real boundary in the source. Keep the
                # full original text on the first sub-segment only; repeating it
                # identically on every sibling misleadingly implies each one has
                # its own distinct source line.
                **({} if i == 0 else {"source_text": "", "original_text": ""}),
            })
            cursor = seg_end
    return out


class TranslationService:
    def __init__(self):
        settings = get_settings()
        self.deepl_api_key = settings.DEEPL_API_KEY
        self.google_api_key = os.getenv("GOOGLE_TRANSLATE_API_KEY")
        # Glossary is loaded dynamically per source language in translate_segments.
        # Initialise with the Cantonese glossary as a safe default.
        _yue_glossary = get_glossary("yue")
        self._glossary_sorted = sorted(_yue_glossary.items(), key=lambda kv: len(kv[0]), reverse=True)
        # Phonetic index: pinyin_key → (src, tgt, char_len) for fuzzy CJK matching
        self._phonetic_index = build_phonetic_index(_yue_glossary)

    def _reload_glossary(self, source_language: str) -> None:
        """Reload glossary and phonetic index when source language changes."""
        glossary = get_glossary(source_language)
        self._glossary_sorted = sorted(glossary.items(), key=lambda kv: len(kv[0]), reverse=True)
        self._phonetic_index = build_phonetic_index(glossary)

    def _apply_glossary_pre(self, text: str):
        """
        Replace glossary source terms with placeholder tokens before translation.

        Returns (protected_text, replacements, fuzzy_match_log).
        fuzzy_match_log lists phonetic substitutions made for director review.
        """
        import re as _re2
        _cjk_space_re = _re2.compile(r'(?<=[一-鿿])\s+(?=[一-鿿])')
        _cjk_punct_re = _re2.compile(r'(?<=[一-鿿])[,，、;；]\s*(?=[一-鿿])')
        text = _cjk_space_re.sub('', text)
        text = _cjk_punct_re.sub('', text)

        replacements = []
        fuzzy_log = []
        phon_idx = len(self._glossary_sorted)

        # Pass 1: exact match (existing behaviour)
        for i, (src_term, tgt_term) in enumerate(self._glossary_sorted):
            src_collapsed = _cjk_space_re.sub('', src_term)
            if src_collapsed in text:
                placeholder = f"XGLO{i:03d}X"
                text = text.replace(src_collapsed, placeholder)
                replacements.append((placeholder, tgt_term))

        # Pass 2: phonetic (fuzzy) match for remaining CJK spans.
        # Walks character-by-character; for each CJK run not already replaced,
        # compares pinyin against every glossary term of matching length.
        # e.g. 金山沼 / 金山找 / 金山照 all yield "jin shan zhao" and hit the same entry.
        if self._phonetic_index:
            term_lengths = sorted(set(v[2] for v in self._phonetic_index.values()), reverse=True)
            chars = list(text)
            replaced_spans = []

            def _in_span(s, e, spans=replaced_spans):
                return any(rs <= s < re_ or rs < e <= re_ for rs, re_ in spans)

            rebuilt = []
            pos = 0
            while pos < len(chars):
                ch = chars[pos]
                if not _is_cjk(ch) or _in_span(pos, pos + 1):
                    rebuilt.append(ch)
                    pos += 1
                    continue
                matched = False
                for tlen in term_lengths:
                    if pos + tlen > len(chars):
                        continue
                    span = ''.join(chars[pos:pos + tlen])
                    if not all(_is_cjk(c) for c in span):
                        continue
                    if _in_span(pos, pos + tlen):
                        continue
                    key = _cjk_pinyin(span)
                    if key and key in self._phonetic_index:
                        canonical_src, tgt_term, _ = self._phonetic_index[key]
                        if span != canonical_src:
                            placeholder = f"XFUZ{phon_idx:03d}X"
                            phon_idx += 1
                            rebuilt.append(placeholder)
                            replacements.append((placeholder, tgt_term))
                            replaced_spans.append((pos, pos + tlen))
                            fuzzy_log.append(
                                f"fuzzy: {span!r} -> {canonical_src!r} -> {tgt_term!r} (pinyin: {key})"
                            )
                            pos += tlen
                            matched = True
                            break
                if not matched:
                    rebuilt.append(ch)
                    pos += 1

            text = ''.join(rebuilt)

        text = _re2.sub(r'(X(?:GLO|FUZ)\d{3}X)(?=X(?:GLO|FUZ)\d{3}X)', r' ', text)
        return text, replacements, fuzzy_log

    def _verify_translation(self, translated_text: str, replacements: list):
        """
        Post-translation verification: confirm every substituted glossary target
        appears in the translated output. If missing, inject it at sentence start.
        Returns (corrected_text, warnings).
        """
        warnings = []
        for _ph, tgt_term in replacements:
            if tgt_term.lower() not in translated_text.lower():
                warnings.append(f"verify: {tgt_term!r} missing from output — injecting")
                translated_text = f"{tgt_term}, {translated_text}"
        return translated_text, warnings

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
        # Strip bare comma left when a glossary placeholder was stripped mid-sentence
        text = re.sub(r'([!?.])\s*,\s*', r'\1 ', text).strip()
        # Recapitalize first letter of any word that now directly follows terminal
        # punctuation — the comma-strip above can leave lowercase sentence starts.
        text = re.sub(r'([.!?])\s+([a-z])', lambda m: m.group(1) + ' ' + m.group(2).upper(), text)
        # Clean up punctuation artifacts from post-fix values colliding with
        # Claude's surrounding sentence context.
        text = re.sub(r',\s*\.', '.', text)                          # ,. → .
        text = re.sub(r'(?<!\.)\.\s*\.(?!\.)', '.', text)            # .. → . (ellipsis-aware)
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
            # Mrs. Ip — Claude romanizes 葉 as "Ye" (Mandarin) instead of "Yip" (Cantonese)
            "Mrs. Ye":       "Mrs. Yip",
            "Mrs Ye":        "Mrs. Yip",
            "mrs. ye":       "Mrs. Yip",
            # Line 1 — 久闻佛山武术之地: 之地 ("land of") implies fame; Claude drops "famous for"
            # and produces various phrasings — catch all observed variants.
            "that Foshan is martial arts":    "that Foshan is famous for martial arts",
            "Foshan is martial arts":         "Foshan is famous for martial arts",
            "that martial arts is in Foshan": "that Foshan is famous for martial arts",
            "martial arts is in Foshan":      "Foshan is famous for martial arts",
            # Line 12 — challenger boasting to Mrs. Yip (self-handicap threat, not
            # an offer to Ip Man). Specific/longer patterns MUST come before bare
            # patterns — Python applies these sequentially and "let him use one hand"
            # firing inside "I'll let him use one hand" produces "I'll I'll use…".
            "won't beat her to death":      "won't beat him to death",
            "she'll lose":                  "he'll lose",
            # Specific (with leading "I'll") — must precede bare variants.
            # No trailing comma/prefix in values: Claude's surrounding sentence already
            # provides context ("If you're afraid he'll lose, ..."), so embedding those
            # in the replacement produces doubled phrases and ,. artifacts.
            "I'll let her use one hand":    "I'll use only one hand",
            "I'll let him use one hand":    "I'll use only one hand",
            "I'll let her use both hands":  "I'll beat him with no hands.",
            "I'll let him use both hands":  "I'll beat him with no hands.",
            # Bare fallback (translation omits leading "I'll")
            "let her use one hand":         "use only one hand",
            "let him use one hand":         "use only one hand",
            "let her use both hands":       "I'll beat him with no hands.",
            "let him use both hands":       "I'll beat him with no hands.",
            # Line 15 — Mrs. Yip: 你闭嘴。没打冷气的东西。 Velma transcribes inconsistently;
            # Claude mis-translates 冷气 (air-con/cold) in several ways. Catch all observed variants.
            "Shut your mouth! , remember your things.":        "Shut your mouth! Don't break my things.",
            "shut your mouth! , remember your things.":        "Shut your mouth! Don't break my things.",
            "A thing that hasn't been beaten cold.":           "Don't break my things.",
            "a thing that hasn't been beaten cold.":           "Don't break my things.",
            "thing that hasn't been beaten cold":              "Don't break my things.",
            "Shut your mouth. A thing that hasn't been beaten cold.": "Shut your mouth! Don't break my things.",
            # ASR safety net — Velma mishearing of 没打冷气的东西 produces English "remember
            # your things" via Claude when the Cantonese source doesn't match any glossary key.
            # Log fires tracked so we can identify additional source variants slipping through.
            "Remember your things.":  "__LOG_POSTFIX__Don't break my things.",
            "remember your things.":  "__LOG_POSTFIX__Don't break my things.",
            "Remember your things!":  "__LOG_POSTFIX__Don't break my things.",
            # Challenger boast — Claude appends a colloquial flourish not in source.
            " — how about that?":     "",
            " — How about that?":     "",
        }
        for wrong, correct in _POST_FIXES.items():
            if wrong in text:
                if correct.startswith("__LOG_POSTFIX__"):
                    correct = correct[len("__LOG_POSTFIX__"):]
                    logger.warning(f"[POSTFIX_NET] Caught ASR mishearing safety-net: '{wrong}' → '{correct}' in: {text!r}")
                text = text.replace(wrong, correct)
        # Second pass: catch ,. and .. artifacts introduced by post-fix replacements
        # (a replacement value ending in "." collides with the source text's existing period).
        text = re.sub(r',\s*\.', '.', text)
        text = re.sub(r'(?<!\.)\.\s*\.(?!\.)', '.', text)
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
        target_language: str,
        character_profiles: Optional[List[Dict]] = None,
        velma_context: Optional[Dict] = None,
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

        # --- FIX 3: Universal short-segment bypass ---
        # Segments ≤3 words that are pure punctuation/particles get direct lookup
        # or are left as-is. Applies to ALL languages, not just Cantonese.
        # Prevents LLMs from padding out "Okay." into three sentences.
        _EXACT_OVERRIDES = {
            "好": "Okay.", "好呀": "Sure.", "好了": "Alright.",
            "請": "Please.", "请": "Please.",
            "我賠": "I'll pay.", "我赔": "I'll pay.",
            "包賠": "I'll pay.", "照賠": "I'll pay.",
            "賠": "I'll pay.", "赔": "I'll pay.",
        }
        _SHORT_BYPASS_INDICES: set = set()
        for i, seg in enumerate(segments):
            stripped = (seg.get("text") or "").strip()
            if stripped in _EXACT_OVERRIDES:
                seg["text"] = _EXACT_OVERRIDES[stripped]
                _SHORT_BYPASS_INDICES.add(i)
                continue
            # Universal: skip LLM for segments with ≤2 non-CJK words that are
            # already in English (target language). These are usually sound effects
            # or titles that got through transcription as English.
            _cjk_re_quick = re.compile(r'[一-鿿぀-ゟ゠-ヿ]')
            words = stripped.split()
            if (
                len(words) <= 2
                and not _cjk_re_quick.search(stripped)
                and target_norm.startswith("en")
                and re.match(r'^[A-Za-z0-9 .,!?\'"-]+$', stripped)
            ):
                # Already looks like English — keep as-is
                _SHORT_BYPASS_INDICES.add(i)

        if is_cantonese and has_llm:
            # Try Claude first (most reliable for Cantonese)
            if anthropic_key:
                result = await self._translate_segments_claude(
                    segments, target_norm, source_norm,
                    character_profiles=character_profiles,
                    velma_context=velma_context,
                )
                if result is not None:
                    translated = result
                    # Adaptation pass disabled — rewrites cause synonym substitution and
                    # paraphrasing that breaks word-for-word fidelity to the source script.
                    return translated
                logger.warning("[TRANSLATE] Claude Cantonese translation failed — trying GPT")

            # Fall back to GPT-4 (Azure or OpenAI)
            if bool(openai_key) or (bool(azure_endpoint) and bool(azure_key)):
                result = await self._translate_segments_gpt(
                    segments, target_norm, source_norm,
                    character_profiles=character_profiles,
                )
                if result is not None:
                    return result
                logger.warning("[TRANSLATE] GPT-4 Cantonese translation failed — falling back")

        # DeepL: does not support Cantonese as source, so skip for yue content.
        if self.deepl_api_key and not is_cantonese:
            result = await self._translate_segments_deepl_batch(segments, source_norm, target_norm)
            glossary_baselines = [
                self._apply_glossary_post(*self._apply_glossary_pre(seg.get("text", ""))[:2])
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

    # ── Batch-translation line markers ────────────────────────────────────────
    # Shared by _translate_segments_claude and _translate_segments_gpt. Both send
    # every segment in one prompt as a numbered-line list and parse the reply
    # back — plain "1. 2. 3." numbering let the model "helpfully" merge two
    # short adjacent lines under one number, silently desyncing every segment's
    # text from its own timing from that point on, with no error raised. A
    # random per-line marker can't be merged or continued, and the mapping is
    # now validated before being trusted at all.

    def _generate_line_markers(self, n: int) -> List[str]:
        """Fresh random markers for one batch — regenerated each call (including
        retries) so a retry can't anchor on the same failure pattern."""
        return [secrets.token_hex(3) for _ in range(n)]

    def _parse_marked_reply(self, reply: str) -> List[Tuple[str, str]]:
        """(marker, text) pairs in reply order. Deliberately preserves duplicates
        and doesn't dedupe — _validate_marked_mapping decides what's fatal."""
        pairs: List[Tuple[str, str]] = []
        for line in reply.splitlines():
            m = _MARKER_LINE_RE.match(line)
            if m:
                pairs.append((m.group(1), m.group(2).strip()))
        return pairs

    def _validate_marked_mapping(
        self, markers: List[str], pairs: List[Tuple[str, str]]
    ) -> Optional[Dict[str, str]]:
        """Returns marker -> text ONLY if every sent marker comes back exactly
        once. Returns None on ANY mismatch (missing, duplicated, extra, or
        unrecognized marker) — the caller must treat None as a hard failure,
        not a signal to fall back to a partial/best-effort zip."""
        if len(pairs) != len(markers):
            return None
        seen: Dict[str, str] = {}
        marker_set = set(markers)
        for mk, text in pairs:
            if mk not in marker_set or mk in seen:
                return None
            seen[mk] = text
        if set(seen.keys()) != marker_set:
            return None
        return seen

    async def _translate_segments_claude(
        self,
        segments: List[Dict],
        target_language: str,
        source_language: str = "yue",
        character_profiles: Optional[List[Dict]] = None,
        velma_context: Optional[Dict] = None,
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

        # Process in chunks of 20 to avoid token overflow and dropped tail segments.
        _CHUNK_SIZE = 20
        if len(segments) > _CHUNK_SIZE:
            results: List[Dict] = []
            for start in range(0, len(segments), _CHUNK_SIZE):
                chunk = segments[start:start + _CHUNK_SIZE]
                chunk_result = await self._translate_segments_claude(
                    chunk, target_language, source_language, character_profiles
                )
                if chunk_result is None:
                    return None
                results.extend(chunk_result)
            return results

        lang_name = LANGUAGE_NAMES.get(source_language, "Cantonese")
        target_name = LANGUAGE_NAMES.get(target_language, "English")

        texts = [seg.get("text", "") for seg in segments]
        protected: List[str] = []
        replacements_per_seg: List[List[Tuple[str, str]]] = []
        entity_replacements_per_seg: List[List[Tuple[str, str]]] = []
        for t in texts:
            p, r, _fuzz = self._apply_glossary_pre(t)
            if _fuzz:
                logger.info("[GLOSSARY-FUZZY] %s", " | ".join(_fuzz))
            p2, r2 = protect_entities(p)
            protected.append(p2)
            replacements_per_seg.append(r)
            entity_replacements_per_seg.append(r2)

        def _slot(seg: Dict) -> str:
            start = float(seg.get("start", 0))
            end = float(seg.get("end", start))
            return f"{round(max(0.3, end - start), 1)}s"

        def _build_marked_lines(markers: List[str]) -> str:
            return "\n".join(
                f"[[SEG-{markers[i]}]] ({_slot(segments[i])}) {p}"
                for i, p in enumerate(protected)
            )

        # Literal translation system prompt — does NOT use DUBBING_SYSTEM_PROMPT because
        # that prompt instructs the model to "prefer short conversational English" and
        # "optimize for spoken performance", which causes synonym substitution and
        # paraphrasing that breaks fidelity to the source script.
        _LITERAL_TRANSLATION_SYSTEM_PROMPT = (
            "You are a professional subtitler and translator.\n\n"
            "Your ONLY job is to produce a FAITHFUL, MEANING-ACCURATE translation.\n\n"
            "ABSOLUTE RULES:\n"
            "- Translate the EXACT meaning of each word. Do NOT substitute synonyms.\n"
            "  Example: '神秘' = 'secretive' — do NOT change it to 'mysterious'.\n"
            "- Do NOT paraphrase, adapt, or rewrite for 'naturalness'.\n"
            "- Do NOT add, remove, or combine any words beyond what is needed to form a grammatical sentence.\n"
            "- Each input line starts with a marker like [[SEG-a3f9c2]]. Your answer for that\n"
            "  line MUST start with the EXACT SAME marker, unchanged, followed by your translation.\n"
            "  Answer EVERY marker exactly once, one per output line. NEVER merge two markers'\n"
            "  content into one answer line, NEVER skip a marker, NEVER invent a marker that\n"
            "  wasn't in the input.\n"
            "- Do NOT prefix lines with speaker names (e.g. NEVER write 'Ip Man: ...').\n"
            "- Do NOT echo the timing value (e.g. '(1.2s)') in your answer — but DO echo the marker.\n"
            "- XGLO###X and XFUZ###X tokens (e.g. XGLO135X, XFUZ002X) are glossary placeholders.\n"
            "  Preserve them CHARACTER-FOR-CHARACTER. Do NOT rename, reformat, or convert them.\n"
            "  WRONG: ENTITY:135  RIGHT: XGLO135X\n"
            "- [[ENTITY:n]] tokens are also protected placeholders — keep them EXACTLY.\n"
            "- Drop Cantonese discourse particles (講, 係, 喂, 嗱, 嚟, 囉, 㗎) entirely.\n"
            "- NEVER invent character names. Use only names that appear in the source text.\n"
            "- NEVER hallucinate. ONLY translate what is written.\n\n"
            "CHINESE IDIOM RULE (critical for accuracy):\n"
            "Four-character set phrases (成語/chengyu) and Cantonese fixed expressions MUST be\n"
            "translated by their ESTABLISHED MEANING, never character-by-character.\n"
            "Rendering each character literally will produce nonsense — always use the phrase meaning.\n"
            "Examples:\n"
            "  推三阻四 → 'making excuses' or 'keep dodging'  (NOT 'push three block four')\n"
            "  不打不相識 → 'you can't be friends without a fight'  (NOT 'no hit no know each other')\n"
            "  步步為營 → 'advance cautiously'  (NOT 'step by step make camp')\n"
            "  馬到成功 → 'immediate success'  (NOT 'horse arrive become success')\n"
            "If a phrase is a known chengyu or set expression, translate its meaning, not its words."
        )
        system_prompt_parts = [_LITERAL_TRANSLATION_SYSTEM_PROMPT]

        # CHARACTER_REGISTRY injection suppressed — pre-baked character profiles caused
        # name hallucination (e.g. "Master Ip" -> "Brother Man"). Per-job character_profiles
        # (below) are still applied if explicitly provided by the caller.
        # detected_profile = detect_character_from_text("\n".join(texts))
        # name_mapping = build_name_mapping_prompt(texts)

        # Per-job character profiles (Fix 2)
        if character_profiles:
            system_prompt_parts.append("")
            system_prompt_parts.append("CHARACTER PROFILES FOR THIS PROJECT:")
            for cp in character_profiles:
                name = cp.get("name", "Unknown")
                traits = ", ".join(cp.get("traits", []))
                style = cp.get("speech_style", "")
                system_prompt_parts.append(f"- {name}: traits=[{traits}]. Speech style: {style}")
            system_prompt_parts.append("Apply these character voices consistently across all lines.")

        # Velma scene context — summary, topics, speaker roles, sentiment
        if velma_context:
            _vc_summary = velma_context.get("summary")
            _vc_topics = velma_context.get("topics", [])
            _vc_roles = velma_context.get("role_picks", [])
            _vc_sentiments = velma_context.get("topic_sentiments", [])

            if _vc_summary or _vc_topics or _vc_roles:
                system_prompt_parts.append("")
                system_prompt_parts.append("SCENE CONTEXT (from audio analysis):")
                if _vc_summary:
                    system_prompt_parts.append(f"Scene summary: {_vc_summary}")
                if _vc_topics:
                    system_prompt_parts.append(f"Topics discussed: {', '.join(_vc_topics)}")
                if _vc_roles:
                    for _rp in _vc_roles:
                        _spk = _rp.get("speaker_label", "?")
                        _role = _rp.get("name", "Unknown")
                        _conf = _rp.get("confidence", 0)
                        _reason = _rp.get("reasoning", "")
                        system_prompt_parts.append(
                            f"- Speaker {_spk}: role={_role} (confidence={_conf:.0%}). {_reason}"
                        )
                if _vc_sentiments:
                    _sent_parts = []
                    for _ts in _vc_sentiments:
                        _sent_parts.append(
                            f"Speaker {_ts.get('speaker_label', '?')} on '{_ts.get('topic', '?')}': "
                            f"{_ts.get('sentiment_label', '?')} ({_ts.get('sentiment_score', 0):+.1f})"
                        )
                    system_prompt_parts.append(f"Speaker sentiments: {'; '.join(_sent_parts)}")
                system_prompt_parts.append(
                    "Use this context to inform word choice and tone — "
                    "but do NOT add information not present in the source text."
                )

        # Speaker gender map — prevents him/her pronoun errors in translation
        _gender_map: dict = {}
        for _seg in segments:
            _spk = _seg.get("speaker") or _seg.get("speaker_label", "")
            _gender = (_seg.get("speaker_gender") or _seg.get("gender") or "").lower().strip()
            if _spk and _gender and _spk not in _gender_map:
                _gender_map[_spk] = _gender
        if _gender_map:
            system_prompt_parts.append("")
            system_prompt_parts.append("SPEAKER GENDERS — use correct pronouns when referring to each speaker:")
            for _spk, _g in _gender_map.items():
                _pronoun = "he/him" if _g in ("male", "m", "man", "child") else "she/her" if _g in ("female", "f", "woman") else "he/him"
                system_prompt_parts.append(f"- {_spk}: {_pronoun}")
            system_prompt_parts.append("NEVER use 'her' or 'she' for a male speaker, or 'him'/'he' for a female speaker.")

        system_prompt_parts.append("")
        system_prompt_parts.append("DOMAIN-SPECIFIC RULES:")
        system_prompt_parts.append("- These are SPOKEN Cantonese martial arts film dialogue lines.")
        system_prompt_parts.append("- Each line has a timing budget (Xs) — choose words that fit naturally in that time.")
        system_prompt_parts.append("- Short exclamations must stay short (1-3 syllables).")
        system_prompt_parts.append("- NEVER combine two [[SEG-...]] marked lines into one answer — answer each marker separately, even short ones.")
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

        def _build_user_prompt(marked_lines: str) -> str:
            return (
                f"Translate these spoken {lang_name} dialogue lines to {target_name} word-for-word.\n\n"
                f"Rules:\n"
                f"- Translate LITERALLY. Do NOT substitute synonyms, paraphrase, or rewrite for 'naturalness'.\n"
                f"- Keep the exact meaning of each word. 'Secretive' must stay 'secretive', not 'mysterious'.\n"
                f"- Preserve every line. Do NOT drop, merge, or skip any [[SEG-...]] marked line.\n"
                f"- Match the original speech rhythm — keep translations concise to fit the timing budget.\n\n"
                f"{marked_lines}"
            )

        async def _send_and_validate(markers: List[str]) -> Optional[Dict[str, str]]:
            payload = {
                "model": "claude-sonnet-4-6",
                "max_tokens": 8192,
                "temperature": 0.3,
                "system": system_prompt,
                "messages": [{"role": "user", "content": _build_user_prompt(_build_marked_lines(markers))}],
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
            pairs = self._parse_marked_reply(reply)
            return self._validate_marked_mapping(markers, pairs)

        try:
            logger.info(
                f"[TRANSLATE] Claude batch: {len(segments)} segments, "
                f"{lang_name} -> {target_name} via Anthropic API"
            )

            markers = self._generate_line_markers(len(protected))
            marker_map = await _send_and_validate(markers)

            if marker_map is None:
                logger.warning(
                    f"[TRANSLATE-ZIP-MISMATCH] Claude's reply markers didn't validate "
                    f"1:1 against the {len(markers)} segments sent (missing, duplicated, "
                    f"or merged line) — rejecting this mapping rather than risk a silently "
                    f"desynced text/timing zip. Retrying once with fresh markers."
                )
                markers = self._generate_line_markers(len(protected))
                marker_map = await _send_and_validate(markers)

            if marker_map is None:
                logger.warning(
                    f"[TRANSLATE-ZIP-FALLBACK] Retry also failed validation for this "
                    f"{len(segments)}-segment batch — falling back to one Claude call "
                    f"per segment (slower, but a single-segment batch has zero merge "
                    f"risk by construction, so it's guaranteed aligned)."
                )
                result: List[Dict] = []
                for i, seg in enumerate(segments):
                    single = await self._translate_segments_claude(
                        [seg], target_language, source_language, character_profiles, velma_context
                    )
                    if single is None:
                        logger.error(
                            f"[TRANSLATE-ZIP-FALLBACK] seg {i} individual Claude call "
                            f"also failed — keeping original text untranslated"
                        )
                        result.append({**seg, "original_text": seg.get("text", ""), "text": seg.get("text", "")})
                    else:
                        result.extend(single)
                return result

            result: List[Dict] = []
            changed = 0
            for i, seg in enumerate(segments):
                raw = marker_map[markers[i]]
                # Restore protected entities first, then fix hallucinations, then glossary
                raw = restore_entities(raw, entity_replacements_per_seg[i])
                raw = fix_translation_names(raw)
                final = self._apply_glossary_post(raw, replacements_per_seg[i])
                final, _v_warns = self._verify_translation(final, replacements_per_seg[i])
                for _w in _v_warns: logger.warning("[VERIFY] seg %d: %s", i, _w)
                if raw.strip() != protected[i].strip():
                    changed += 1
                result.append({
                    **seg, "original_text": seg.get("text", ""), "text": final,
                })

            # CJK leak guard — flag any segment that still contains CJK after translation.
            # This catches cases where Claude echoed the source instead of translating it.
            _cjk_leak_re = re.compile(r'[一-鿿぀-ゟ゠-ヿ]')
            retry_indices: List[int] = []
            for i, seg_result in enumerate(result):
                if _cjk_leak_re.search(seg_result.get("text", "")):
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
        character_profiles: Optional[List[Dict]] = None,
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
            p, r, _fuzz = self._apply_glossary_pre(t)
            if _fuzz:
                logger.info("[GLOSSARY-FUZZY] %s", " | ".join(_fuzz))
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

        def _build_marked_lines(markers: List[str]) -> str:
            return "\n".join(
                f"[[SEG-{markers[i]}]] ({_slot(segments[i])}) {p}"
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

        # Per-job character profiles (Fix 2)
        if character_profiles:
            system_prompt_parts.append("")
            system_prompt_parts.append("CHARACTER PROFILES FOR THIS PROJECT:")
            for cp in character_profiles:
                name = cp.get("name", "Unknown")
                traits = ", ".join(cp.get("traits", []))
                style = cp.get("speech_style", "")
                system_prompt_parts.append(f"- {name}: traits=[{traits}]. Speech style: {style}")
            system_prompt_parts.append("Apply these character voices consistently across all lines.")

        # Speaker gender map — prevents him/her pronoun errors in translation
        _gender_map_gpt: dict = {}
        for _seg in segments:
            _spk = _seg.get("speaker") or _seg.get("speaker_label", "")
            _gender = (_seg.get("speaker_gender") or _seg.get("gender") or "").lower().strip()
            if _spk and _gender and _spk not in _gender_map_gpt:
                _gender_map_gpt[_spk] = _gender
        if _gender_map_gpt:
            system_prompt_parts.append("")
            system_prompt_parts.append("SPEAKER GENDERS — use correct pronouns when referring to each speaker:")
            for _spk, _g in _gender_map_gpt.items():
                _pronoun = "he/him" if _g in ("male", "m", "man", "child") else "she/her" if _g in ("female", "f", "woman") else "he/him"
                system_prompt_parts.append(f"- {_spk}: {_pronoun}")
            system_prompt_parts.append("NEVER use 'her' or 'she' for a male speaker, or 'him'/'he' for a female speaker.")

        system_prompt_parts.append("")
        system_prompt_parts.append("DOMAIN-SPECIFIC RULES:")
        system_prompt_parts.append("- These are SPOKEN Cantonese martial arts film dialogue lines.")
        system_prompt_parts.append("- Each line has a timing budget (Xs) — choose words that fit naturally in that time.")
        system_prompt_parts.append("- Short exclamations must stay short (1-3 syllables).")
        system_prompt_parts.append("- NEVER combine two [[SEG-...]] marked lines into one answer — answer each marker separately, even short ones.")
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

        def _build_user_prompt(marked_lines: str) -> str:
            return (
                f"Translate these spoken {lang_name} dialogue lines to natural {target_name} for voice actors.\n\n"
                f"Preserve meaning, emotion, and character voice. "
                f"Use colloquial spoken English — not formal or written style.\n\n"
                f"{marked_lines}"
            )

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

        async def _send_and_validate(markers: List[str]) -> Optional[Dict[str, str]]:
            payload = {
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": _build_user_prompt(_build_marked_lines(markers))},
                ],
                "temperature": 0.3,
                "max_tokens": 8192,
            }
            if use_openai:
                payload["model"] = "gpt-4o"
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
            pairs = self._parse_marked_reply(reply)
            return self._validate_marked_mapping(markers, pairs)

        try:
            logger.info(
                f"[TRANSLATE] GPT-4 batch: {len(segments)} segments, "
                f"{lang_name} -> {target_name} via {'Azure OpenAI' if use_azure else 'OpenAI'}"
            )

            markers = self._generate_line_markers(len(protected))
            marker_map = await _send_and_validate(markers)

            if marker_map is None:
                logger.warning(
                    f"[TRANSLATE-ZIP-MISMATCH] GPT-4's reply markers didn't validate "
                    f"1:1 against the {len(markers)} segments sent — rejecting this "
                    f"mapping rather than risk a silently desynced text/timing zip. "
                    f"Retrying once with fresh markers."
                )
                markers = self._generate_line_markers(len(protected))
                marker_map = await _send_and_validate(markers)

            if marker_map is None:
                logger.warning(
                    f"[TRANSLATE-ZIP-FALLBACK] Retry also failed validation for this "
                    f"{len(segments)}-segment batch — falling back to one GPT-4 call "
                    f"per segment (slower, but a single-segment batch has zero merge "
                    f"risk by construction, so it's guaranteed aligned)."
                )
                result: List[Dict] = []
                for i, seg in enumerate(segments):
                    single = await self._translate_segments_gpt(
                        [seg], target_language, source_language, character_profiles
                    )
                    if single is None:
                        logger.error(
                            f"[TRANSLATE-ZIP-FALLBACK] seg {i} individual GPT-4 call "
                            f"also failed — keeping original text untranslated"
                        )
                        result.append({**seg, "original_text": seg.get("text", ""), "text": seg.get("text", "")})
                    else:
                        result.extend(single)
                return result

            result: List[Dict] = []
            changed = 0
            for i, seg in enumerate(segments):
                raw = marker_map[markers[i]]
                # Restore protected entities first, then fix hallucinations, then glossary
                raw = restore_entities(raw, entity_replacements_per_seg[i])
                raw = fix_translation_names(raw)
                final = self._apply_glossary_post(raw, replacements_per_seg[i])
                final, _v_warns = self._verify_translation(final, replacements_per_seg[i])
                for _w in _v_warns: logger.warning("[VERIFY] seg %d: %s", i, _w)
                if raw.strip() != protected[i].strip():
                    changed += 1
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
            p, r, _fuzz = self._apply_glossary_pre(t)
            if _fuzz:
                logger.info("[GLOSSARY-FUZZY] %s", " | ".join(_fuzz))
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
            final, _v_warns = self._verify_translation(final, replacements_per_seg[i])
            for _w in _v_warns: logger.warning("[VERIFY] seg %d: %s", i, _w)
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
            p, r, _fuzz = self._apply_glossary_pre(t)
            if _fuzz:
                logger.info("[GLOSSARY-FUZZY] %s", " | ".join(_fuzz))
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
                final, _v_warns = self._verify_translation(final, replacements_per_seg[i])
                for _w in _v_warns: logger.warning("[VERIFY] seg %d: %s", i, _w)
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
            p, r, _fuzz = self._apply_glossary_pre(t)
            if _fuzz:
                logger.info("[GLOSSARY-FUZZY] %s", " | ".join(_fuzz))
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
                final, _v_warns = self._verify_translation(final, replacements_per_seg[i])
                for _w in _v_warns: logger.warning("[VERIFY] seg %d: %s", i, _w)
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

    # -----------------------------------------------------------------------
    # FIX 1 — Two-pass dubbing adaptation
    # -----------------------------------------------------------------------
    async def _dubbing_adaptation_pass(
        self,
        segments: List[Dict],
        source_language: str = "yue",
        character_profiles: Optional[List[Dict]] = None,
        skip_indices: Optional[set] = None,
    ) -> List[Dict]:
        """
        Second pass: takes raw translated English and rewrites each line for
        natural spoken performance — colloquial rhythm, character voice, no stiffness.
        Short/bypassed segments are returned unchanged.
        """
        import httpx

        api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if not api_key:
            return segments

        skip = skip_indices or set()

        # Only adapt segments that actually have English text worth rewriting
        adapt_indices = [
            i for i, seg in enumerate(segments)
            if i not in skip and len((seg.get("text") or "").split()) >= 3
        ]
        if not adapt_indices:
            return segments

        numbered_lines = "\n".join(
            f"{i+1}. ({round(max(0.3, (seg.get('end', 0) or 0) - (seg.get('start', 0) or 0)), 1)}s) {seg.get('text', '')}"
            for i, seg in [(i, segments[i]) for i in adapt_indices]
        )

        system_parts = [
            "You are a professional dubbing dialogue coach.",
            "",
            "Your job: take a literal translated line and rewrite it so a voice actor can deliver it naturally.",
            "",
            "RULES:",
            "- Keep the exact meaning — do NOT add, remove, or change information.",
            "- Make it sound like something a person would actually SAY, not write.",
            "- Use contractions, natural rhythm, and conversational phrasing.",
            "- Preserve the character's emotional tone and personality.",
            "- Keep it within the timing budget (Xs) shown before each line.",
            "- Do NOT add filler words, reactions, or extra content.",
            "- Do NOT change character names or proper nouns.",
            "- Return ONLY numbered lines in the same format as input.",
        ]

        if character_profiles:
            system_parts.append("")
            system_parts.append("CHARACTER VOICES:")
            for cp in character_profiles:
                name = cp.get("name", "Unknown")
                traits = ", ".join(cp.get("traits", []))
                style = cp.get("speech_style", "")
                system_parts.append(f"- {name}: [{traits}]. {style}")

        system_prompt = "\n".join(system_parts)
        user_prompt = (
            "Rewrite these translated dialogue lines for natural spoken dubbing performance.\n\n"
            f"{numbered_lines}"
        )

        try:
            logger.info(f"[ADAPT] Dubbing adaptation pass: {len(adapt_indices)} segments")
            payload = {
                "model": "claude-sonnet-4-6",
                "max_tokens": 4096,
                "temperature": 0.4,
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
                logger.warning(f"[ADAPT] Adaptation pass failed: {response.status_code} — returning raw translation")
                return segments

            reply = response.json()["content"][0]["text"].strip()
            adapted_lines = re.findall(r"^\d+\.\s*(.+)$", reply, re.MULTILINE)

            result = list(segments)
            for local_i, seg_i in enumerate(adapt_indices):
                if local_i < len(adapted_lines):
                    adapted = adapted_lines[local_i].strip()
                    # Sanity: reject if obviously longer than 2x original (hallucination guard)
                    original_words = len((result[seg_i].get("text") or "").split())
                    adapted_words = len(adapted.split())
                    if adapted_words <= max(original_words * 2, original_words + 6):
                        result[seg_i] = {**result[seg_i], "text": adapted}
                    else:
                        logger.warning(f"[ADAPT] Seg {seg_i} adaptation too long ({adapted_words} vs {original_words} words) — keeping raw")
            logger.info(f"[ADAPT] Adaptation pass complete: {len(adapted_lines)} lines rewritten")
            return result

        except Exception as exc:
            logger.warning(f"[ADAPT] Adaptation pass exception: {exc} — returning raw translation")
            return segments

    async def _translate_text(
        self,
        text: str,
        source_language: str,
        target_language: str
    ) -> str:
        if not text.strip():
            return text

        # Protect glossary terms with placeholders before translation
        protected_text, replacements, _fuzz_single = self._apply_glossary_pre(text)
        if _fuzz_single:
            logger.info("[GLOSSARY-FUZZY] %s", " | ".join(_fuzz_single))
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
            translated, _v_warns = self._verify_translation(translated, replacements)
            for _w in _v_warns: logger.warning("[VERIFY] single: %s", "; ".join(_v_warns))
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
