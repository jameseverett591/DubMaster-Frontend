from pathlib import Path
import json
import logging
import os
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

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
    model_size = os.getenv("WHISPER_MODEL", "small")
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
            # Require at least 30% CJK characters — catches garbage like
            # "而已 ੁ ੀ ਗ਼ ੁ ੀ" where a stray CJK word is buried in
            # Gurmukhi/Bengali/Latin hallucination noise.
            if cjk_ratio < 0.3 and len(text.strip()) > 1:
                logger.info(
                    f"[HALLUCINATION] Rejected low-CJK-ratio segment ({cjk_ratio:.0%}): '{text[:60]}' "
                    f"at {seg.get('start', '?')}-{seg.get('end', '?')}"
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

        # VAD filter removes background noise / crowd cheers so they are not
        # mistaken for speech.  condition_on_previous_text=False reduces
        # hallucinations in noisy audio.  beam_size=5 improves accuracy.
        # VAD threshold controls how aggressively non-speech is filtered.
        # 0.20 is a good balance for action content with dialogue.
        # Set VAD_THRESHOLD=0 to disable VAD entirely (not recommended —
        # degrades transcription quality in noisy audio).
        vad_threshold = float(os.getenv("VAD_THRESHOLD", "0.20"))
        use_vad = vad_threshold > 0

        # Allow explicit language override via env var.
        # For Cantonese content set WHISPER_LANGUAGE=yue so Whisper preserves
        # Cantonese grammar/particles instead of normalising to Standard Chinese.
        # Leave unset for auto-detection on mixed or unknown-language content.
        whisper_language = os.getenv("WHISPER_LANGUAGE", "").strip() or None

        transcribe_kwargs = dict(
            beam_size=5,
            word_timestamps=True,
            condition_on_previous_text=False,
        )
        if whisper_language:
            transcribe_kwargs["language"] = whisper_language
            logger.info(f"[WHISPER] Language forced to '{whisper_language}' via WHISPER_LANGUAGE env var")

        if use_vad:
            transcribe_kwargs["vad_filter"] = True
            transcribe_kwargs["vad_parameters"] = dict(
                threshold=vad_threshold,
                min_speech_duration_ms=50,
                min_silence_duration_ms=150,
                speech_pad_ms=400,
            )

        segments_gen, info = model.transcribe(
            waveform,
            **transcribe_kwargs,
        )

        # Convert generator to list to avoid exhaustion
        segments = list(segments_gen)

        # ---------- Build raw segment dicts ----------
        # When word_timestamps=True, use word-level boundaries for tighter
        # start/end times instead of Whisper's segment-level estimates which
        # often bleed far beyond the actual speech.
        raw_segments = []
        for seg in segments:
            words = getattr(seg, "words", None)
            if words and len(words) > 0:
                # Use first word's start and last word's end for tight bounds
                seg_start = round(words[0].start, 3)
                seg_end = round(words[-1].end, 3)
            else:
                seg_start = round(seg.start, 3)
                seg_end = round(seg.end, 3)
            raw_segments.append({
                "start": seg_start,
                "end": seg_end,
                "text": seg.text,
            })

        # ---------- Filter hallucinations (pass 1 — with VAD) ----------
        _detected_lang = whisper_language or info.language or ""
        raw_segments = _filter_hallucinations(raw_segments, strict=False, source_language=_detected_lang)

        # ---------- Two-pass gap recovery ----------
        # VAD aggressively filters dialogue mixed with SFX (fight scenes).
        # Detect large gaps in the transcript and re-transcribe WITHOUT VAD.
        two_pass = os.getenv("VAD_TWO_PASS", "1") == "1"
        gap_threshold = float(os.getenv("VAD_GAP_THRESHOLD", "3.0"))

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
                        # Use word-level timestamps when available
                        words = getattr(seg, "words", None)
                        if words and len(words) > 0:
                            gs = round(words[0].start + gap_start, 3)
                            ge = round(words[-1].end + gap_start, 3)
                        else:
                            gs = round(seg.start + gap_start, 3)
                            ge = round(seg.end + gap_start, 3)
                        gap_segments_all.append({
                            "start": gs,
                            "end": ge,
                            "text": seg.text,
                            "avg_logprob": getattr(seg, "avg_logprob", 0),
                        })
                # Strict filtering for noisy no-VAD segments
                gap_filtered = _filter_hallucinations(gap_segments_all, strict=True, source_language=_detected_lang)
                if gap_filtered:
                    logger.info(
                        f"[TWO-PASS] Recovered {len(gap_filtered)} segment(s) "
                        f"from gaps (before merge: {len(raw_segments)} segments)"
                    )
                    for seg in gap_filtered:
                        seg.pop("avg_logprob", None)
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

        return {
            "status": "ok",
            "transcript_path": str(output_path),
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {
            "status": "skipped",
            "reason": "transcription_failed",
            "error_message": str(e),
        }
