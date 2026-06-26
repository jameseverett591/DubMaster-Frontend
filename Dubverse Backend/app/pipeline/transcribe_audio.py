from pathlib import Path
import json
import logging
import os
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

# Proper noun context seed for Whisper — biases the model toward correct CJK
# characters for names and martial arts terms that appear in Ip Man content.
# This is passed as initial_prompt to every model.transcribe() call.
INITIAL_PROMPT = (
    "葉問，詠春，師父，金山找，三浦，木人樁，黐手，北拳，南拳，功夫，武術，葉師傅，"
    "請，我賠，我畀錢，夠了，沒事，好呀，豁出去"
)

_WHISPER_MODEL = None


def _get_compute_device() -> tuple:
    """Return (device, compute_type) — cuda:float16 if GPU available, else cpu:int8."""
    import torch
    if torch.cuda.is_available():
        logger.info("[DEVICE] CUDA GPU detected — using cuda/float16")
        return "cuda", "float16"
    logger.info("[DEVICE] No GPU detected — using cpu/int8")
    return "cpu", "int8"


def _get_whisper_model():
    global _WHISPER_MODEL
    if _WHISPER_MODEL is not None:
        return _WHISPER_MODEL
    from faster_whisper import WhisperModel
    wl = (os.getenv("WHISPER_LANGUAGE", "") or "").strip().lower()
    _is_cantonese_lang = wl in ("yue", "zh-yue", "yue-hk", "zh-hk")
    model_size = os.getenv("WHISPER_MODEL", "medium")
    # Cantonese requires at least large-v3 for acceptable accuracy.
    # If WHISPER_MODEL is set to a smaller model but WHISPER_LANGUAGE=yue,
    # upgrade silently — medium produces too many Standard Chinese artefacts.
    _MODEL_RANK = {"tiny": 0, "base": 1, "small": 2, "medium": 3, "large": 4, "large-v2": 5, "large-v3": 6}
    if _is_cantonese_lang and _MODEL_RANK.get(model_size, 3) < _MODEL_RANK["large-v3"]:
        logger.info(f"[WHISPER] Cantonese detected — upgrading model from '{model_size}' to 'large-v3'")
        model_size = "large-v3"
    device, compute_type = _get_compute_device()
    logger.info(f"[WHISPER] Loading model '{model_size}' on {device} (will be cached for subsequent jobs)...")
    _WHISPER_MODEL = WhisperModel(model_size, device=device, compute_type=compute_type)
    logger.info(f"[WHISPER] Model '{model_size}' loaded and cached.")
    return _WHISPER_MODEL


def _find_gaps(segments: List[Dict], duration: float, min_gap: float) -> List[tuple]:
    """Return list of (start, end) gaps longer than *min_gap* seconds."""
    gaps = []
    if not segments:
        if duration > min_gap:
            gaps.append((0.0, duration))
        return gaps
    # Gap before first segment
    if segments[0]["start"] > min_gap:
        gaps.append((0.0, segments[0]["start"]))
    # Gaps between consecutive segments
    for i in range(len(segments) - 1):
        gap_start = segments[i]["end"]
        gap_end = segments[i + 1]["start"]
        if gap_end - gap_start > min_gap:
            gaps.append((gap_start, gap_end))
    # Gap after last segment
    if duration - segments[-1]["end"] > min_gap:
        gaps.append((segments[-1]["end"], duration))
    return gaps


def _filter_hallucinations(raw_segments: List[Dict], strict: bool = False, source_language: str = "") -> List[Dict]:
    """
    Filter likely hallucination segments.
    When strict=True (used for no-VAD gap pass), also reject:
      - segments shorter than 0.3s
      - segments with avg_logprob < -1.0
    Non-strict mode also rejects:
      - Short single-word Latin text that looks like noise (e.g. "pave", "the")
    """
    import re as _re
    filtered = []
    for seg in raw_segments:
        text = seg["text"].strip()
        if not text or _re.fullmatch(r'[\s\W]*', text):
            continue
        if filtered and text == filtered[-1]["text"].strip():
            continue
        if len(text) <= 1:
            continue

        # Unconditional minimum-duration guard — must run before every other filter.
        # No real phoneme can be produced in under 300ms: even the shortest stop
        # consonant + vowel pair (e.g. 打, 的) takes ~120ms of frication + release.
        # Sub-300ms segments are always Whisper hallucinations produced when it
        # forces a transcription onto a single click, breath, or frame boundary
        # artifact.  The 0:43 "Leopard skin" / "Now play this game" phantom slot
        # (42.88–42.94s, 60ms) is a canonical example.
        _dur = float(seg.get("end", 0)) - float(seg.get("start", 0))
        if _dur < 0.3:
            logger.info(
                f"[HALLUCINATION] Rejected sub-300ms segment ({_dur*1000:.0f}ms): "
                f"'{text[:60]}' at {seg.get('start','?')}-{seg.get('end','?')}"
            )
            continue

        # Reject repetitive single-character hallucinations produced by Whisper
        # when processing fight grunts, screams, or impact noise — e.g.
        # "Aaaaaaaaaaaaa", "hhhhhhhh", "eeeeeeee".  Real speech has varied chars.
        stripped = text.replace(' ', '')
        if len(stripped) >= 4:
            unique_ratio = len(set(stripped.lower())) / len(stripped)
            if unique_ratio < 0.25:   # >75% of chars are the same 1-2 characters
                logger.info(
                    f"[HALLUCINATION] Rejected repetitive-char segment "
                    f"(unique_ratio={unique_ratio:.2f}): '{text[:40]}' "
                    f"at {seg.get('start', '?')}-{seg.get('end', '?')}"
                )
                continue

        # Reject short single-word Latin-script hallucinations.
        # Whisper often produces nonsense English words during fight scenes
        # or silent moments (e.g. "pave", "the", "you").  Real dialogue
        # in CJK audio won't be a single short English word.
        words = text.split()
        if len(words) == 1 and _re.fullmatch(r'[a-zA-Z]+', text) and len(text) <= 5:
            logger.info(
                f"[HALLUCINATION] Rejected short Latin word: '{text}' "
                f"at {seg.get('start', '?')}-{seg.get('end', '?')}"
            )
            continue

        # Reject known YouTube/subtitle boilerplate hallucinations that Whisper
        # produces when processing near-silence or background music in CJK audio.
        _HALLUCINATION_PHRASES = {
            "thanks for watching",
            "thank you for watching",
            "please subscribe",
            "don't forget to subscribe",
            "like and subscribe",
            "subtitles by",
            "subtitle by",
            "amara.org",
        }
        if text.lower().rstrip('!.,') in _HALLUCINATION_PHRASES or any(
            ph in text.lower() for ph in _HALLUCINATION_PHRASES
        ):
            logger.info(
                f"[HALLUCINATION] Rejected boilerplate phrase: '{text}' "
                f"at {seg.get('start', '?')}-{seg.get('end', '?')}"
            )
            continue

        # Reject segments that are entirely non-CJK (Latin/Cyrillic/etc.) when
        # the source language is a CJK language (Chinese, Japanese, Korean).
        # This catches Cyrillic/Latin hallucinations like "Сого́н!" in Cantonese audio.
        # Reject segments with NO CJK characters when the source language
        # is CJK.  Catches ALL wrong-script hallucinations: Cyrillic (Согон!),
        # Telugu, Latin, Arabic, Devanagari, etc.
        _CJK_LANGS = {"zh", "yue", "ja", "ko", "cmn"}
        if source_language in _CJK_LANGS:
            cjk_chars = len(_re.findall(r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]', text))
            non_space = len(_re.findall(r'\S', text))
            cjk_ratio = cjk_chars / max(non_space, 1)

            # PRIMARY: reject any segment with zero CJK characters when transcribing
            # CJK audio.  Real Cantonese/Mandarin dialogue always contains CJK chars.
            # Pure-Latin/Cyrillic/etc. output is a hallucination produced by Whisper
            # when it encounters fight sounds, music, or silence — e.g. "Always a
            # stunner", "Groove", "Согон!".  This is the strongest signal we have.
            if cjk_chars == 0 and len(text.strip()) > 1:
                logger.info(
                    f"[HALLUCINATION] Rejected zero-CJK segment in {source_language} audio: "
                    f"'{text[:60]}' at {seg.get('start', '?')}-{seg.get('end', '?')}"
                )
                continue

            # SECONDARY: mixed-script garbage — some CJK but ratio too low.
            # Catches "而已 ੁ ੀ ਗ਼" where a stray CJK word is buried in Gurmukhi noise.
            min_ratio = 0.3
            if source_language == "yue":
                min_ratio = 0.15
            if cjk_ratio < min_ratio and cjk_chars < 6 and len(text.strip()) > 1:
                logger.info(
                    f"[HALLUCINATION] Rejected low-CJK-ratio segment ({cjk_ratio:.0%}): '{text[:60]}' "
                    f"at {seg.get('start', '?')}-{seg.get('end', '?')}"
                )
                continue

        # Short isolated CJK hallucinations (e.g. 老闆 during a table-break silence):
        # Whisper produces real CJK text but with low confidence on very short segments.
        # Apply a moderate logprob threshold when the segment is short (< 2s) and
        # the word count is low (≤ 2 words).  Threshold -0.8 is stricter than the
        # strict-mode -1.2 but lenient enough to keep genuine short utterances
        # like 好呀 (Sure) or 夠了 (That's enough) that Whisper hears clearly.
        if source_language in _CJK_LANGS:
            dur = float(seg.get("end", 0)) - float(seg.get("start", 0))
            avg_lp = seg.get("avg_logprob", 0.0)
            word_count = len(seg.get("text", "").split())
            if dur < 2.0 and word_count <= 2 and avg_lp < -0.8:
                logger.info(
                    f"[HALLUCINATION] Rejected short low-confidence CJK segment "
                    f"({dur:.2f}s, lp={avg_lp:.2f}): '{seg.get('text','')[:60]}' "
                    f"at {seg.get('start','?')}-{seg.get('end','?')}"
                )
                continue

        if strict:
            dur = seg["end"] - seg["start"]
            if dur < 0.2:
                continue
            if seg.get("avg_logprob", 0) < -1.2:
                continue
        filtered.append(seg)
    return filtered


def _filter_repetition_loops(segments: List[Dict]) -> List[Dict]:
    """
    Detect and truncate n-gram repetition loops within segment text.
    Whisper produces loops like "male and female and male and female" when
    context is lost. Detects repeating 2-6 gram patterns and keeps only
    the first occurrence.
    """
    result = []
    for seg in segments:
        text = seg.get("text", "").strip()
        if not text or len(text) < 10:
            result.append(seg)
            continue

        truncated = _truncate_repetition(text)
        if truncated != text:
            logger.info(
                f"[REPETITION] Truncated loop at {seg.get('start', '?')}-{seg.get('end', '?')}: "
                f"'{text[:60]}' → '{truncated[:60]}'"
            )
            if len(truncated.strip()) < 2:
                continue
            seg = dict(seg)
            seg["text"] = truncated
            seg["repetition_truncated"] = True

        result.append(seg)
    return result


def _truncate_repetition(text: str) -> str:
    """Find the shortest repeating n-gram (2-6 tokens) and keep only the first occurrence."""
    tokens = text.split()
    if len(tokens) < 6:
        return text

    for n in range(2, 7):
        if len(tokens) < n * 2:
            continue
        for start in range(len(tokens) - n * 2 + 1):
            gram = tokens[start:start + n]
            repeat_count = 1
            pos = start + n
            while pos + n <= len(tokens) and tokens[pos:pos + n] == gram:
                repeat_count += 1
                pos += n
            if repeat_count >= 3:
                kept = tokens[:start + n]
                return " ".join(kept)

    # CJK: character-level repetition (no spaces between words)
    for n in range(2, 8):
        if len(text) < n * 3:
            continue
        for start in range(len(text) - n * 3 + 1):
            gram = text[start:start + n]
            repeat_count = 1
            pos = start + n
            while pos + n <= len(text) and text[pos:pos + n] == gram:
                repeat_count += 1
                pos += n
            if repeat_count >= 3:
                return text[:start + n]

    return text


def _fix_timestamp_bleed(segments: List[Dict]) -> List[Dict]:
    """Fix Whisper timestamp bleed — segments whose duration far exceeds
    what the text content could plausibly occupy.

    Threshold: 8s (down from 30s) to catch mid-length bleed that previously
    caused 10-30s segments for 1-2 seconds of actual speech.

    For CJK text (Chinese/Japanese/Korean), uses character count at ~4 chars/s
    instead of word count, since CJK doesn't use spaces between words.
    """
    import re
    CJK_RE = re.compile(r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]')

    for i, seg in enumerate(segments):
        duration = seg["end"] - seg["start"]
        text = seg.get("text", "").strip()
        if not text:
            continue

        # Estimate plausible speech duration from text content
        cjk_chars = len(CJK_RE.findall(text))
        if cjk_chars > len(text) * 0.3:
            # CJK text: ~4 characters per second
            estimated_dur = max(0.8, cjk_chars / 4.0)
        else:
            # Latin/other: ~3 words per second
            word_count = len(text.split())
            estimated_dur = max(0.8, word_count / 3.0 * 2.0)

        # Only fix if actual duration is > 8s AND more than 3x the estimate
        if duration <= 8.0 or duration < estimated_dur * 3.0:
            continue

        new_end = seg["start"] + estimated_dur
        if i + 1 < len(segments):
            new_end = min(new_end, segments[i + 1]["start"] - 0.05)
        old_end = seg["end"]
        seg["end"] = round(max(new_end, seg["start"] + 0.1), 3)
        logger.info(
            f"[BLEED-FIX] seg {i}: duration {duration:.1f}s -> {seg['end'] - seg['start']:.1f}s "
            f"(est={estimated_dur:.1f}s) text={text[:40]!r}"
        )
    return segments


def transcribe_audio(extract_result: Dict[str, Any], job_id: str | None = None) -> Dict[str, Any]:
    """
    Transcribe decoded audio using faster-whisper.

    Input:
        extract_result from extract_audio()

    Output:
        {
            "status": "ok" | "skipped",
            "transcript_path": str | None,
            "reason": str | None
        }

    This function is hardened for real-world audio
    and NEVER raises exceptions.
    """

    # ---------- Respect upstream contract ----------
    if extract_result["status"] != "ok":
        return {
            "status": "skipped",
            "reason": "upstream_failed",
        }

    audio = extract_result["audio"]

    # ---------- Prepare waveform safely ----------
    # Expecting audio shape (1, N)
    waveform = audio.squeeze(0).float()

    # Guard: too-short audio (Whisper will fail silently)
    if waveform.numel() < 1600:  # ~0.1s @ 16kHz
        return {
            "status": "skipped",
            "reason": "audio_too_short",
        }

    # Normalize amplitude to [-1, 1]
    max_val = waveform.abs().max()
    if max_val > 0:
        waveform = waveform / max_val

    waveform = waveform.cpu().numpy()

    try:
        # ---------- Load Whisper model (cached globally) ----------
        import os
        model = _get_whisper_model()

        whisper_language = os.getenv("WHISPER_LANGUAGE", "").strip() or None
        _is_yue = (whisper_language or "").lower().strip() in ("yue", "zh-yue", "yue-hk", "zh-hk")

        def _do_transcribe(_use_vad: bool, _vad_threshold: float):
            transcribe_kwargs = dict(
                beam_size=5,
                word_timestamps=True,
                condition_on_previous_text=False,
                initial_prompt=INITIAL_PROMPT,
                compression_ratio_threshold=1.8,
                log_prob_threshold=-0.8,
                no_speech_threshold=0.5,
            )
            if whisper_language:
                transcribe_kwargs["language"] = whisper_language
                logger.info(f"[WHISPER] Language forced to '{whisper_language}' via WHISPER_LANGUAGE env var")

            if _use_vad:
                transcribe_kwargs["vad_filter"] = True
                transcribe_kwargs["vad_parameters"] = dict(
                    threshold=_vad_threshold,
                    min_speech_duration_ms=50,
                    min_silence_duration_ms=150,
                    speech_pad_ms=400,
                )

            segments_gen, info = model.transcribe(waveform, **transcribe_kwargs)
            return list(segments_gen), info

        if "VAD_THRESHOLD" in os.environ:
            vad_threshold = float(os.getenv("VAD_THRESHOLD", "0.20"))
            use_vad = vad_threshold > 0
        else:
            # Cantonese previously disabled VAD (0.0) but this causes hallucinations
            # on silence/SFX regions. Use a moderate threshold — the two-pass gap
            # recovery will catch real dialogue that VAD aggressively clips.
            vad_threshold = 0.15 if _is_yue else 0.05
            use_vad = True

        segments, info = _do_transcribe(use_vad, vad_threshold)

        # ---------- Build raw segment dicts ----------
        # When word_timestamps=True, use word-level boundaries for tighter
        # start/end times instead of Whisper's segment-level estimates which
        # often bleed far beyond the actual speech.
        def _segments_to_dicts(_segments):
            raw = []
            for seg in _segments:
                words = getattr(seg, "words", None)
                if words and len(words) > 0:
                    seg_start = round(words[0].start, 3)
                    seg_end = round(words[-1].end, 3)
                    word_list = [
                        {
                            "word": w.word.strip(),
                            "start": round(w.start, 3),
                            "end": round(w.end, 3),
                            "confidence": round(w.probability, 3) if hasattr(w, "probability") else 0.5,
                        }
                        for w in words
                        if w.word.strip()
                    ]
                else:
                    seg_start = round(seg.start, 3)
                    seg_end = round(seg.end, 3)
                    word_list = []

                avg_lp = getattr(seg, "avg_logprob", -0.5)
                confidence = round(max(0.0, min(1.0, 1.0 + avg_lp)), 3)

                raw.append({
                    "start": seg_start,
                    "end": seg_end,
                    "text": seg.text,
                    "confidence": confidence,
                    "avg_logprob": avg_lp,
                    "words": word_list,
                })
            return raw

        raw_segments = _segments_to_dicts(segments)

        logger.info(f"[WHISPER] Raw segments before filtering: {len(raw_segments)}, detected language: {info.language}")

        # ---------- Filter hallucinations (pass 1 — with VAD) ----------
        _detected_lang = whisper_language or info.language or ""
        raw_segments = _filter_hallucinations(raw_segments, strict=False, source_language=_detected_lang)

        # ---------- Cantonese auto-rescue ----------
        # Whisper often misdetects Cantonese as "zh" (Mandarin) when no source
        # language is specified, collapsing the full audio into one or a handful
        # of segments. Detect this by checking for Cantonese-specific particles
        # in the returned text, then re-run with language="yue" explicitly.
        _CANTONESE_PARTICLES = frozenset("唔嘅係喺囉啩佢哋喇咋噉嗰呢㗎咩咗")
        if (
            not whisper_language                       # user did not specify a source language
            and (info.language or "") == "zh"          # Whisper auto-detected Mandarin
            and len(raw_segments) < 25                 # collapsed / very few segments
            and "CANTONESE_RESCUE" not in os.environ   # prevent infinite recursion
        ):
            full_text = "".join(s["text"] for s in raw_segments)
            has_cantonese_particles = any(p in full_text for p in _CANTONESE_PARTICLES)
            if has_cantonese_particles or len(raw_segments) < 3:
                os.environ["CANTONESE_RESCUE"] = "1"
                try:
                    logger.info(
                        f"[WHISPER] Cantonese auto-rescue: detected language='zh' with "
                        f"{len(raw_segments)} segment(s), Cantonese particles={has_cantonese_particles} "
                        f"— re-running with language='yue', VAD disabled"
                    )
                    rescue_gen, rescue_info = model.transcribe(
                        waveform,
                        language="yue",
                        beam_size=5,
                        word_timestamps=True,
                        condition_on_previous_text=False,
                        initial_prompt=INITIAL_PROMPT,
                        vad_filter=False,
                    )
                    rescue_raw = _segments_to_dicts(list(rescue_gen))
                    rescue_raw = _filter_hallucinations(rescue_raw, strict=False, source_language="yue")
                    if len(rescue_raw) > len(raw_segments):
                        raw_segments = rescue_raw
                        info = rescue_info
                        use_vad = False
                        _detected_lang = "yue"
                        logger.info(
                            f"[WHISPER] Cantonese rescue succeeded: "
                            f"{len(rescue_raw)} segment(s) recovered"
                        )
                    else:
                        logger.info(
                            f"[WHISPER] Cantonese rescue did not improve output "
                            f"({len(rescue_raw)} vs {len(raw_segments)}) — keeping original"
                        )
                finally:
                    os.environ.pop("CANTONESE_RESCUE", None)

        if _is_yue and len(raw_segments) < 12 and "YUE_TRANSCRIBE_RETRY" not in os.environ:
            os.environ["YUE_TRANSCRIBE_RETRY"] = "1"
            try:
                if use_vad:
                    retry_use_vad, retry_thr = False, 0.0
                else:
                    retry_use_vad, retry_thr = True, 0.10

                logger.info(
                    f"[WHISPER] yue retry: use_vad={retry_use_vad} threshold={retry_thr} "
                    f"(initial_segments={len(raw_segments)})"
                )
                retry_segments, retry_info = _do_transcribe(retry_use_vad, retry_thr)
                retry_raw = _segments_to_dicts(retry_segments)
                retry_raw = _filter_hallucinations(retry_raw, strict=False, source_language=_detected_lang)
                if len(retry_raw) > len(raw_segments):
                    raw_segments = retry_raw
                    info = retry_info
                    use_vad = retry_use_vad
                    vad_threshold = retry_thr
            finally:
                os.environ.pop("YUE_TRANSCRIBE_RETRY", None)

        # ---------- Two-pass gap recovery ----------
        # VAD aggressively filters dialogue mixed with SFX (fight scenes).
        # Detect large gaps in the transcript and re-transcribe WITHOUT VAD.
        # NOTE: This is expensive on CPU. Default is disabled for local dev.
        if "VAD_TWO_PASS" in os.environ:
            two_pass = os.getenv("VAD_TWO_PASS", "0") == "1"
        else:
            # Always run two-pass for CJK languages when VAD is active —
            # VAD clips fight-scene dialogue that sits under SFX energy.
            _is_cjk = _is_yue or (info.language or "") in ("zh", "yue", "ja", "ko")
            two_pass = _is_cjk and use_vad

        if "VAD_GAP_THRESHOLD" in os.environ:
            gap_threshold = float(os.getenv("VAD_GAP_THRESHOLD", "3.0"))
        else:
            gap_threshold = 2.5 if _is_yue else 3.0

        if use_vad and two_pass:
            gaps = _find_gaps(raw_segments, info.duration, gap_threshold)
            if gaps:
                logger.info(
                    f"[TWO-PASS] Found {len(gaps)} gap(s) > {gap_threshold}s: "
                    f"{[(round(s,1), round(e,1)) for s, e in gaps]}"
                )
                no_vad_kwargs = dict(
                    beam_size=5,
                    word_timestamps=True,
                    condition_on_previous_text=False,
                    initial_prompt=INITIAL_PROMPT,
                )
                if whisper_language:
                    no_vad_kwargs["language"] = whisper_language
                    logger.info(f"[TWO-PASS] Gap recovery forced to language='{whisper_language}'")
                sample_rate = 16000
                gap_segments_all = []
                for gap_start, gap_end in gaps:
                    start_sample = int(gap_start * sample_rate)
                    end_sample = int(gap_end * sample_rate)
                    gap_waveform = waveform[start_sample:end_sample]
                    if len(gap_waveform) < 1600:
                        continue
                    logger.info(
                        f"[TWO-PASS] Transcribing gap {gap_start:.1f}s-{gap_end:.1f}s "
                        f"({gap_end - gap_start:.1f}s) without VAD"
                    )
                    gap_gen, _ = model.transcribe(gap_waveform, **no_vad_kwargs)
                    gap_segs = list(gap_gen)
                    for seg in gap_segs:
                        words = getattr(seg, "words", None)
                        if words and len(words) > 0:
                            gs = round(words[0].start + gap_start, 3)
                            ge = round(words[-1].end + gap_start, 3)
                            word_list = [
                                {
                                    "word": w.word.strip(),
                                    "start": round(w.start + gap_start, 3),
                                    "end": round(w.end + gap_start, 3),
                                    "confidence": round(w.probability, 3) if hasattr(w, "probability") else 0.5,
                                }
                                for w in words
                                if w.word.strip()
                            ]
                        else:
                            gs = round(seg.start + gap_start, 3)
                            ge = round(seg.end + gap_start, 3)
                            word_list = []
                        avg_lp = getattr(seg, "avg_logprob", -0.5)
                        gap_segments_all.append({
                            "start": gs,
                            "end": ge,
                            "text": seg.text,
                            "confidence": round(max(0.0, min(1.0, 1.0 + avg_lp)), 3),
                            "avg_logprob": avg_lp,
                            "words": word_list,
                        })
                # Strict filtering for noisy no-VAD segments
                gap_filtered = _filter_hallucinations(gap_segments_all, strict=True, source_language=_detected_lang)
                if gap_filtered:
                    logger.info(
                        f"[TWO-PASS] Recovered {len(gap_filtered)} segment(s) "
                        f"from gaps (before merge: {len(raw_segments)} segments)"
                    )
                    for seg in gap_filtered:
                        logger.info(
                            f"[TWO-PASS]   {seg['start']:.1f}-{seg['end']:.1f}: "
                            f"{seg['text'][:80]}"
                        )
                    raw_segments.extend(gap_filtered)
                    raw_segments.sort(key=lambda s: s["start"])
                    logger.info(
                        f"[TWO-PASS] Total segments after merge: {len(raw_segments)}"
                    )
                else:
                    logger.info("[TWO-PASS] No valid segments recovered from gaps")
            else:
                logger.info(f"[TWO-PASS] No gaps > {gap_threshold}s found")

        # ---------- Filter repetition loops ----------
        raw_segments = _filter_repetition_loops(raw_segments)

        # ---------- Fix Whisper timestamp bleed ----------
        raw_segments = _fix_timestamp_bleed(raw_segments)

        # ---------- Normalize transcript ----------
        transcript = {
            "language": info.language,
            "duration": info.duration,
            "text": " ".join(seg["text"] for seg in raw_segments),
            "segments": raw_segments,
        }

        # ---------- Persist output ----------
        output_dir = Path("data/transcripts")
        output_dir.mkdir(parents=True, exist_ok=True)

        filename = f"{job_id}.json" if job_id else "transcript.json"
        output_path = output_dir / filename
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(transcript, f, indent=2, ensure_ascii=False)

        result = {
            "status": "ok",
            "transcript_path": str(output_path),
        }

        if os.getenv("GC_BETWEEN_STEPS", "1") == "1":
            try:
                import gc
                gc.collect()
            except Exception:
                pass

        return result

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {
            "status": "skipped",
            "reason": "transcription_failed",
            "error_message": str(e),
        }
