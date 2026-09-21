"""
Deepgram Nova-3 ASR for Cantonese and Mandarin.

Deepgram Nova-3 supports:
  - Cantonese Traditional:  zh-HK
  - Mandarin Simplified:     zh, zh-CN, zh-Hans
  - Mandarin Traditional:    zh-TW, zh-Hant

Key advantages:
  - Built-in speaker diarization (no separate pyannote pass needed)
  - Built-in punctuation (prevents mid-sentence fragmentation)
  - Cloud API — no local model, no VAD chunking, no int8 quantization
  - Semantic accuracy from a large trained model, not a CTC acoustic map

Environment variables:
  DEEPGRAM_API_KEY  — Required. API key from Deepgram dashboard.
  DEEPGRAM_MODEL    — Model name (default: "nova-3")
"""

import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_API_BASE = "https://api.deepgram.com/v1/listen"
_TIMEOUT_S = 300

# Map our internal language codes to Deepgram language codes.
_LANG_MAP = {
    "yue": "zh-HK",
    "zh-yue": "zh-HK",
    "yue-hk": "zh-HK",
    "zh-hk": "zh-HK",
    "zh": "zh",
    "cmn": "zh",
    "zho": "zh",
    "zh-cn": "zh-CN",
    "zh-tw": "zh-TW",
}

# Deepgram's documented ceiling on keyterm entries per request.
KEYTERM_MAX = 100

# Per-genre keyterm lists, scoped to Cantonese/Mandarin sources. Selectable
# per job via DEEPGRAM_KEYTERM_GENRE.
#
# CRITICAL: boost the CORRECT forms, never the mishearings. A keyterm is the
# model's preferred output — boosting 金山爪 makes the error permanent;
# boosting 金山找 overrides it.
#
# PHRASES beat single words. Isolated 雙手 / 失望 / 佛山 were all in this list
# when a run still dropped 雙手 from 再不行我讓他雙手 and heard 打不死我 for
# 佛山太讓我失望 — a lone noun gives the decoder nothing to anchor to. The
# short phrases below are the actual spoken collocations from the scenes
# where those words were lost.
KEYTERM_GENRES: Dict[str, Dict[str, List[str]]] = {
    # Period martial-arts cinema — Ip Man universe + generic wuxia
    # vocabulary. Confirmed against the Ip Man / Master Shin clip:
    # 佛山 (Foshan) itself was being missed, 詠春 mangled to 永春.
    "martial_arts": {
        "yue": [
            # People / names — correct forms
            "葉問", "葉太", "葉太太", "金山找", "金師父", "陳師父",
            "廖師傅", "文哥", "全哥", "王叔", "阿正", "三姑", "根哥",
            # Places
            "佛山", "武館",
            # Martial-arts vocabulary
            "武術", "武術之鄉", "詠春", "詠春拳", "功夫", "切磋",
            "比武", "挑戰", "勝負", "單手", "雙手",
            # Common misheard verbs / particles
            "行開", "收聲", "閉嘴", "出去", "離開", "走開", "讓開",
            "別走開", "打爛",
            # Nouns that get truncated
            "女人", "男人", "師父", "師傅", "徒弟", "老婆",
            # Common phrases
            "不怕", "怕了", "怕老婆", "尊重",
            "失望", "厲害", "久聞",
            # Spoken collocations — where the single words above were lost
            "讓他雙手", "讓他單手", "打死他", "要是怕他輸",
            "太讓我失望", "佛山太讓我失望", "練拳的", "沒有一個打得", "居然沒有打得",
            "開武館", "找個好地方", "請你離開", "別打爛我的東西",
        ],
        "zh": [
            "叶问", "叶太太", "金山找", "金师父", "陈师父",
            "廖师傅", "文哥", "全哥", "王叔", "阿正", "三姑", "根哥",
            "佛山", "武馆",
            "武术", "武术之乡", "咏春", "咏春拳", "功夫", "切磋",
            "比武", "挑战", "胜负", "单手", "双手",
            "行开", "收声", "闭嘴", "出去", "离开", "走开", "让开",
            "别走开", "打烂",
            "女人", "男人", "师父", "师傅", "徒弟", "老婆",
            "不怕", "怕老婆", "尊重", "失望", "厉害", "久闻",
            "让他双手", "让他单手", "打死他", "要是怕他输",
            "太让我失望", "佛山太让我失望", "练拳的", "没有一个打得", "居然没有打得",
            "开武馆", "找个好地方", "请你离开", "别打烂我的东西",
        ],
    },
}


def build_keyterms(
    language: str,
    extra: Optional[List[str]] = None,
    genre: Optional[str] = None,
) -> List[str]:
    """The keyterm list for one Deepgram request.

    Precedence: DEEPGRAM_KEYTERMS_YUE / _ZH env (full override) > genre list.
    `extra` terms are placed FIRST — they are the job's own vocabulary (the
    director's Rulebook name/glossary sources), and the list is capped at
    KEYTERM_MAX, so the terms most specific to this film must not be the
    ones that fall off the end. De-duplicated, order preserved.

    Called on the GPU worker at request time, and on the backend to build
    the list it forwards to the worker (the backend has the Rulebook; the
    worker does not).
    """
    is_yue = language == "zh-HK"
    env = os.getenv("DEEPGRAM_KEYTERMS_YUE" if is_yue else "DEEPGRAM_KEYTERMS_ZH", "").strip()
    if env:
        base = [t.strip() for t in env.split(",") if t.strip()]
    else:
        g = (genre or os.getenv("DEEPGRAM_KEYTERM_GENRE", "martial_arts")).strip() or "martial_arts"
        base = KEYTERM_GENRES.get(g, KEYTERM_GENRES["martial_arts"])["yue" if is_yue else "zh"]

    seen: set = set()
    out: List[str] = []
    for t in list(extra or []) + list(base):
        t = (t or "").strip()
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    if len(out) > KEYTERM_MAX:
        logger.info(f"[DEEPGRAM] keyterm list truncated {len(out)} → {KEYTERM_MAX}")
        out = out[:KEYTERM_MAX]
    return out


def _map_language(source_language: Optional[str]) -> str:
    """Map internal language code to Deepgram's language code."""
    lang = (source_language or "").lower().strip().replace("_", "-")
    return _LANG_MAP.get(lang, "zh-HK")


def _get_api_key() -> Optional[str]:
    """Read the Deepgram API key from environment."""
    key = (
        os.getenv("DEEPGRAM_API_KEY")
        or os.getenv("DEEPGRAM_KEY")
        or ""
    )
    key = key.strip()
    if not key:
        logger.error("[DEEPGRAM] No DEEPGRAM_API_KEY set in environment")
        return None
    return key


_MIN_WORD_SPEAKER_CONFIDENCE = 0.5


def _split_by_word_speakers(
    text: str,
    start: float,
    end: float,
    speaker_num: int,
    confidence: float,
    words: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Split a Deepgram utterance at word-level speaker-change boundaries.

    utt_split only creates a new utterance across a silence gap; two people
    trading lines with less than that gap between them stay one utterance
    with one speaker label no matter how low utt_split goes -- confirmed
    directly against the Ip Man 2 test clip, where a countryman's speech
    with a brief "Thank you so much" interjection from Ip Man collapsed to
    one speaker even after lowering utt_split and the diarization-split
    floors. But Deepgram tags every WORD with its own speaker +
    speaker_confidence, independent of that utterance grouping -- real
    signal that was previously captured (further down, in the words list)
    and then discarded rather than used to split.

    A word with low speaker_confidence is treated as an unreliable tag and
    folded into whichever run it falls inside rather than triggering a
    split, so isolated diarization jitter on one word doesn't fragment an
    otherwise-single-speaker utterance.
    """
    if not words:
        return [{
            "start": start,
            "end": end,
            "text": text,
            "speaker": f"speaker-{speaker_num + 1}",
            "confidence": confidence,
            "source": "deepgram",
            "words": None,
        }]

    runs: List[Dict[str, Any]] = []
    for w in words:
        w_speaker = w.get("speaker")
        w_conf = w.get("speaker_confidence")
        reliable = w_speaker is not None and w_conf is not None and w_conf >= _MIN_WORD_SPEAKER_CONFIDENCE
        if runs and (not reliable or w_speaker == runs[-1]["speaker"]):
            runs[-1]["words"].append(w)
        else:
            runs.append({"speaker": w_speaker if reliable else speaker_num, "words": [w]})

    if len(runs) == 1:
        return [{
            "start": start,
            "end": end,
            "text": text,
            "speaker": f"speaker-{speaker_num + 1}",
            "confidence": confidence,
            "source": "deepgram",
            "words": words,
        }]

    logger.info(
        f"[DEEPGRAM] split utterance at word speaker change: "
        f"{start}-{end}s, utterance-level speaker={speaker_num}, "
        f"{len(runs)} word-level run(s) -> speakers "
        f"{[r['speaker'] for r in runs]}"
    )

    out: List[Dict[str, Any]] = []
    for run in runs:
        run_words = run["words"]
        run_text = "".join(w.get("word", "") for w in run_words).strip()
        if not run_text:
            continue
        confidences = [w["confidence"] for w in run_words if w.get("confidence") is not None]
        run_confidence = sum(confidences) / len(confidences) if confidences else confidence
        out.append({
            "start": round(float(run_words[0]["start"]), 3),
            "end": round(float(run_words[-1]["end"]), 3),
            "text": run_text,
            "speaker": f"speaker-{int(run['speaker']) + 1}",
            "confidence": round(run_confidence, 4),
            "source": "deepgram",
            "words": run_words,
        })

    # All runs came out empty (shouldn't happen, but never emit nothing for
    # a non-empty utterance) -- fall back to the single unsplit segment.
    if not out:
        return [{
            "start": start,
            "end": end,
            "text": text,
            "speaker": f"speaker-{speaker_num + 1}",
            "confidence": confidence,
            "source": "deepgram",
            "words": words,
        }]
    return out


def transcribe_with_deepgram(
    extract_result: Dict[str, Any],
    audio_path: Optional[str] = None,
    source_language: Optional[str] = None,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Transcribe audio using Deepgram Nova-3 batch API.

    Returns a dict with ``status`` and ``segments`` compatible with the
    Cantonese pipeline.  Each segment has:
        start, end, text, speaker, confidence, source, words

    Deepgram's built-in diarization assigns speaker numbers (0, 1, 2, ...)
    which are mapped to ``speaker-1``, ``speaker-2``, etc.
    """
    import requests

    api_key = _get_api_key()
    if not api_key:
        return {"status": "skipped", "reason": "no_api_key", "segments": []}

    # Resolve the audio file path.
    if not audio_path or not os.path.exists(str(audio_path)):
        # Try to write the audio tensor to a temp file.
        audio_path = _write_temp_wav(extract_result)
        if not audio_path:
            return {"status": "skipped", "reason": "no_audio", "segments": []}

    language = _map_language(source_language)
    model = os.getenv("DEEPGRAM_MODEL", "nova-3").strip() or "nova-3"

    # Deepgram batch API parameters.
    # - diarize_model=latest: speaker diarization, pinned to Deepgram's
    #   current best model version instead of an unpinned implicit default
    # - utterances=true: per-utterance segments with speaker + timing
    # - utt_split: silence gap (seconds) that starts a new utterance.
    #   Deepgram's own default is 0.8, which merges rapid back-and-forth
    #   Cantonese dialogue (turn gaps under 0.8s) into one long utterance
    #   with one speaker label -- confirmed directly against a real
    #   transcript: a 14s exchange between two speakers came back as a
    #   single speaker-2 utterance. Lowered default to 0.3s so genuinely
    #   fast turn-taking still splits; env-configurable in case 0.3 proves
    #   too aggressive on other content and over-fragments slower dialogue.
    # - punctuate=true: add punctuation (prevents mid-sentence fragments)
    # - paragraphs=true: group utterances into paragraphs using punctuation
    #   + speaker changes together
    # - smart_format=true: smart formatting for numbers, dates, etc.
    utt_split = os.getenv("DEEPGRAM_UTT_SPLIT", "0.3").strip() or "0.3"
    params = {
        "model": model,
        "language": language,
        "diarize_model": "latest",
        "utterances": "true",
        "utt_split": utt_split,
        "punctuate": "true",
        "paragraphs": "true",
        "smart_format": "true",
    }

    # Keyterm boosting (Nova-3 only). Boosts recognition of Cantonese
    # words that Deepgram's acoustic model consistently mishears in
    # martial-arts film dialogue. Without boosting, 行開 ("walk away")
    # gets misheard as 推搪祖師, 收聲 ("shut up") as 走開, and 女人
    # ("woman") gets truncated out of 創我 ("created by...").
    #
    # CRITICAL: boost the CORRECT forms, never the mishearings. A keyterm
    # is the model's preferred output — boosting 金山爪 makes the error
    # permanent; boosting 金山找 overrides it.
    #
    # Repeat the keyterm param once per term — Deepgram's API requires
    # this rather than a comma-separated list.
    #
    # Per-genre lists live at module level (KEYTERM_GENRES) so the backend
    # can build the same list, add the job's Rulebook terms, and forward it
    # to this worker as DEEPGRAM_KEYTERMS_* — see build_keyterms().
    _is_yue = language == "zh-HK"
    _keyterms = build_keyterms(language)

    if _keyterms:
        # Convert dict params to list of tuples so keyterm can repeat.
        # requests accepts params as either dict or list of (key, value) tuples.
        params = [(k, v) for k, v in params.items()]
        for t in _keyterms:
            params.append(("keyterm", t))
        logger.info(
            f"[DEEPGRAM] job={job_id} boosting {len(_keyterms)} keyterms "
            f"(lang={language}): {_keyterms[:8]}..."
        )

    # Determine content type from file extension.
    ext = os.path.splitext(str(audio_path))[1].lower()
    content_type_map = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
    }
    content_type = content_type_map.get(ext, "audio/wav")

    logger.info(
        f"[DEEPGRAM] job={job_id} language={language} model={model} "
        f"audio={audio_path} content_type={content_type}"
    )

    try:
        with open(str(audio_path), "rb") as f:
            audio_bytes = f.read()

        headers = {
            "Authorization": f"Token {api_key}",
            "Content-Type": content_type,
        }

        resp = requests.post(
            _API_BASE,
            params=params,
            headers=headers,
            data=audio_bytes,
            timeout=_TIMEOUT_S,
        )
        resp.raise_for_status()
        data = resp.json()

    except requests.exceptions.HTTPError as e:
        logger.error(f"[DEEPGRAM] job={job_id} HTTP error: {e}")
        body = ""
        try:
            body = resp.text[:500]
        except Exception:
            pass
        logger.error(f"[DEEPGRAM] job={job_id} response: {body}")
        return {"status": "skipped", "reason": "http_error", "segments": []}
    except Exception as e:
        logger.error(f"[DEEPGRAM] job={job_id} request failed: {e}")
        return {"status": "skipped", "reason": "request_failed", "segments": []}

    # Parse the response.
    # Deepgram returns either:
    #   results.utterances[]  (when utterances=true)
    #   results.channels[].alternatives[]  (when utterances=false)
    utterances = (
        data.get("results", {})
        .get("utterances", [])
    )
    if not utterances:
        # Fallback: try channels[0].alternatives[0] as a single segment.
        channels = data.get("results", {}).get("channels", [])
        if channels:
            alt = channels[0].get("alternatives", [{}])[0]
            transcript = alt.get("transcript", "").strip()
            if transcript:
                utterances = [{
                    "transcript": transcript,
                    "start": 0.0,
                    "end": float(data.get("duration", 0.0)),
                    "confidence": alt.get("confidence", 0.0),
                    "speaker": 0,
                    "words": alt.get("words", []),
                }]

    segments: List[Dict[str, Any]] = []
    for utt in utterances:
        text = (utt.get("transcript") or "").strip()
        if not text:
            continue
        start = round(float(utt.get("start", 0.0)), 3)
        end = round(float(utt.get("end", 0.0)), 3)
        speaker_num = int(utt.get("speaker", 0))
        confidence = float(utt.get("confidence", 0.0))

        # Map Deepgram speaker numbers to our speaker-N convention.
        speaker = f"speaker-{speaker_num + 1}"

        # Convert Deepgram word timings to our format. Capture speaker +
        # speaker_confidence per word too -- Deepgram tags these
        # independently of the utterance-level speaker/utt_split grouping,
        # and they're the only signal left once two people trade lines with
        # too little pause for utt_split to ever create a new utterance.
        words = []
        for w in utt.get("words", []):
            words.append({
                "word": w.get("word", ""),
                "start": round(float(w.get("start", 0.0)), 3),
                "end": round(float(w.get("end", 0.0)), 3),
                "confidence": float(w.get("confidence", 0.0)),
                "speaker": w.get("speaker"),
                "speaker_confidence": w.get("speaker_confidence"),
            })

        segments.extend(_split_by_word_speakers(text, start, end, speaker_num, confidence, words))

    logger.info(
        f"[DEEPGRAM] job={job_id} produced {len(segments)} segments, "
        f"speakers={sorted(set(s['speaker'] for s in segments))}"
    )

    return {"status": "ok", "segments": segments}


def summarize_media_url(
    media_url: str,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Fetch a media URL and return Deepgram's summary + topics + utterances.

    Used as the Summary-panel fallback when VideoTranscriber.ai can't serve a
    job. Everything returned is measured from the audio — Deepgram's own
    transcript, its `summarize=v2` blurb, and its topic segmentation — so the
    fallback can't invent content the way a generative summarizer can.

    summarize/topics language support is narrower than ASR's; a language
    Deepgram can't summarize still returns transcript + utterances, which the
    caller maps into honest timestamped sections rather than dropping.
    """
    import requests

    api_key = _get_api_key()
    if not api_key:
        return {"status": "skipped", "reason": "no_api_key"}

    params = {
        "model": os.getenv("DEEPGRAM_MODEL", "nova-3").strip() or "nova-3",
        "detect_language": "true",
        "summarize": "v2",
        "topics": "true",
        "utterances": "true",
        "diarize": "true",
        "punctuate": "true",
        "paragraphs": "true",
        "smart_format": "true",
    }

    try:
        resp = requests.post(
            _API_BASE,
            params=params,
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": "application/json",
            },
            json={"url": media_url},
            timeout=_TIMEOUT_S,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.HTTPError as e:
        body = ""
        try:
            body = e.response.text[:300]
        except Exception:
            pass
        logger.error(f"[DEEPGRAM-SUMMARY] job={job_id} HTTP error: {e} body={body}")
        return {"status": "error", "reason": f"http_{e.response.status_code if e.response is not None else 'error'}"}
    except Exception as e:
        logger.error(f"[DEEPGRAM-SUMMARY] job={job_id} request failed: {e}")
        return {"status": "error", "reason": "request_failed"}

    results = data.get("results", {})
    summary = (results.get("summary") or {}).get("short", "").strip()

    # results.topics[]: {text, start, end, topics:[{topic, confidence}]}
    topics = []
    for t in results.get("topics", []) or []:
        labels = [x.get("topic", "") for x in t.get("topics", []) if x.get("topic")]
        topics.append({
            "start": float(t.get("start", 0.0) or 0.0),
            "end": float(t.get("end", 0.0) or 0.0),
            "excerpt": (t.get("text") or "").strip(),
            "labels": labels,
        })

    utterances = []
    for utt in results.get("utterances", []) or []:
        text = (utt.get("transcript") or "").strip()
        if not text:
            continue
        utterances.append({
            "start": round(float(utt.get("start", 0.0)), 3),
            "end": round(float(utt.get("end", 0.0)), 3),
            "text": text,
            "speaker": f"speaker-{int(utt.get('speaker', 0)) + 1}",
            "confidence": float(utt.get("confidence", 0.0)),
        })

    detected_lang = (
        results.get("channels", [{}])[0]
        .get("detected_language")
        or data.get("metadata", {}).get("detected_language")
    )

    if not summary and not topics and not utterances:
        return {"status": "error", "reason": "empty_result"}

    return {
        "status": "ok",
        "summary": summary,
        "topics": topics,
        "utterances": utterances,
        "language": detected_lang,
        "duration": float(data.get("metadata", {}).get("duration", 0.0) or 0.0),
    }


def _write_temp_wav(extract_result: Dict[str, Any]) -> Optional[str]:
    """Write the audio tensor from extract_result to a temp WAV file."""
    import tempfile
    try:
        import soundfile as sf
        import numpy as np

        audio = extract_result["audio"]
        sample_rate = extract_result["sample_rate"]
        waveform = audio.squeeze().cpu().numpy()

        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        sf.write(tmp.name, waveform, sample_rate)
        tmp.close()
        return tmp.name
    except Exception as e:
        logger.error(f"[DEEPGRAM] Failed to write temp WAV: {e}")
        return None
