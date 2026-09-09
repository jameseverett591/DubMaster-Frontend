import sys
print("handler.py: starting...", flush=True)

import logging
import asyncio
import concurrent.futures
import glob
import json
import os
import re
import time

# Image version stamp — confirms which Docker image the worker is running.
# Updated on every build.  If the log doesn't show this version, the worker
# is running a cached/old image.
_WORKER_IMAGE_VERSION = "v76-deepgram-primary-sm-diarize"
print(f"handler.py: IMAGE_VERSION={_WORKER_IMAGE_VERSION}", flush=True)
print(f"handler.py: CANTONESE_ASR_ENGINES={os.getenv('CANTONESE_ASR_ENGINES', '(not set)')}", flush=True)
print(f"handler.py: DEEPGRAM_API_KEY={'set' if os.getenv('DEEPGRAM_API_KEY') else 'NOT SET'}", flush=True)

try:
    import runpod
    print(f"handler.py: runpod {getattr(runpod, '__version__', 'unknown')} OK", flush=True)
except Exception as _e:
    print(f"handler.py FATAL (runpod import): {_e}", file=sys.stderr, flush=True)
    sys.exit(1)

try:
    from app.pipeline.extract_audio import extract_audio
    from app.pipeline.separate_audio import separate_audio
    from app.pipeline.transcribe_audio import transcribe_audio
    from app.pipeline.transcribe_cantonese import transcribe_cantonese
    from app.pipeline.diarize_audio import diarize_audio
    from app.pipeline.speechmatics_diarize import diarize_with_speechmatics
    print("handler.py: pipeline imports OK", flush=True)
except Exception as _e:
    print(f"handler.py FATAL (pipeline import): {_e}", file=sys.stderr, flush=True)
    sys.exit(1)

# ── GPU stem export ──────────────────────────────────────────────────────────
# The worker separates on GPU in seconds and then discards the stems, so the
# backend had to re-run Demucs on CPU (over an hour on a feature) or give up the
# music bed AND voice cloning. Handing the stems back means that work is paid
# for once. Compressed deliberately: a 105-minute stereo WAV is ~1.1 GB per
# stem, and both uses here — a bed mixed under dialogue at 85%, and a
# cloning/pitch reference — are transparent at MP3 bitrates.
STEM_UPLOAD_BITRATE = os.getenv("STEM_UPLOAD_BITRATE", "192k")


def _upload_stems(job_id: str, sep_result: dict) -> dict:
    """Compress and upload vocals + accompaniment to R2. Returns {name: key}.

    Best-effort by design: a failure here must never fail an otherwise good
    transcription. When a key is absent the backend behaves exactly as before.
    """
    keys = {}
    # One try around BOTH the import and the client build: _r2_client imports
    # boto3 lazily, so a missing dependency raises HERE, not at import time.
    # Anything escaping this function would fail an otherwise good transcription.
    try:
        from app.services.upload_reservations import _r2_client
        client, bucket = _r2_client()
    except Exception as exc:
        logger.warning(f"[STEMS] R2 client unavailable ({exc}) - not exporting")
        return keys

    if client is None:
        logger.warning("[STEMS] R2 not configured - not exporting stems")
        return keys

    import subprocess as _sp
    for name in ("vocals", "accompaniment"):
        src_path = sep_result.get(f"{name}_path")
        if not src_path or not os.path.exists(src_path):
            logger.warning(f"[STEMS] {name} missing from separation result")
            continue
        mp3_path = f"/tmp/{job_id}_{name}.mp3"
        try:
            _sp.run(
                ["ffmpeg", "-y", "-i", src_path, "-c:a", "libmp3lame",
                 "-b:a", STEM_UPLOAD_BITRATE, mp3_path],
                capture_output=True, check=True,
            )
            key = f"stems/{job_id}/{name}.mp3"
            client.upload_file(mp3_path, bucket, key)
            keys[name] = key
            logger.info(
                f"[STEMS] uploaded {name} "
                f"({os.path.getsize(mp3_path) // (1024 * 1024)}MB) -> {key}"
            )
        except Exception as exc:
            logger.warning(f"[STEMS] {name} export failed: {exc}")
        finally:
            if os.path.exists(mp3_path):
                os.remove(mp3_path)
    return keys


# Languages that use the multi-engine Chinese ASR pipeline
# Deepgram Nova-3 supports Cantonese and Mandarin/Standard Chinese; Japanese/Korean
# fall back to the standard Whisper path.
_CHINESE_LANGS = {"zh", "yue", "cmn", "zho",
                   "zh-cn", "zh-tw", "zh-hk", "yue-hk", "zh-yue"}

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Punctuation used to split long transcript segments into natural phrases.
_SENTENCE_END_PUNCT = "。！？.?!；;"
_WORD_BOUNDARY_PUNCT = "，,、 "

# Maximum duration/length of a transcript segment before we force a phrase split.
# Keeping segments under these limits prevents a single ASR block from spanning
# multiple speaker turns and makes downstream translation/TTS timing sane.
_MAX_SEGMENT_DURATION = float(os.getenv("HANDLER_MAX_SEGMENT_DURATION", "12.0"))
_MAX_SEGMENT_CHARS = int(os.getenv("HANDLER_MAX_SEGMENT_CHARS", "90"))


def _find_punctuation_split(
    text: str,
    target_idx: int,
    punct: str,
    max_dist: int | None = None,
) -> int:
    """Return a split index near *target_idx* that falls after a punctuation char.

    If *max_dist* is set, only consider punctuation within that character distance.
    This prevents a far-away sentence-ending mark from overriding a closer word
    boundary when the real target is in the middle of a clause.
    """
    if not text or target_idx <= 0 or target_idx >= len(text):
        return target_idx
    best = target_idx
    best_dist = abs(target_idx - best)
    for i, ch in enumerate(text):
        if ch in punct:
            idx = i + 1
            dist = abs(idx - target_idx)
            if max_dist is not None and dist > max_dist:
                continue
            if dist < best_dist:
                best = idx
                best_dist = dist
    return best


def _split_long_segment(
    seg: dict,
    speaker: str | None = None,
    max_duration: float = _MAX_SEGMENT_DURATION,
    max_chars: int = _MAX_SEGMENT_CHARS,
) -> list[dict]:
    """Recursively split a single long segment by natural phrase boundaries."""
    t_start = float(seg.get("start", 0))
    t_end = float(seg.get("end", t_start))
    text = seg.get("text", "")
    duration = t_end - t_start

    if duration <= max_duration and len(text) <= max_chars:
        out = dict(seg)
        out["speaker"] = speaker or out.get("speaker", "SPEAKER_00")
        return [out]

    # Prefer sentence-ending punctuation, then weaker boundaries.
    boundaries = sorted(
        set(m.end() for m in re.finditer(rf"[{re.escape(_SENTENCE_END_PUNCT)}]+", text))
    )
    if len(boundaries) < 2:
        boundaries = sorted(
            set(boundaries) | set(m.end() for m in re.finditer(rf"[{re.escape(_WORD_BOUNDARY_PUNCT)}]+", text))
        )
    boundaries = [b for b in boundaries if 0 < b < len(text)]

    if not boundaries:
        # No punctuation: split in half by character count and recurse.
        mid = len(text) // 2
        if mid < 1 or mid >= len(text):
            # Cannot split any further; return as-is to avoid infinite recursion.
            out = dict(seg)
            out["speaker"] = speaker or out.get("speaker", "SPEAKER_00")
            return [out]
        boundaries = [mid]

    # Build chunks; if a chunk is still too long, recurse.
    chunks_raw = []
    last = 0
    for b in boundaries:
        if b > last:
            chunks_raw.append(text[last:b])
            last = b
    if last < len(text):
        chunks_raw.append(text[last:])

    out: list[dict] = []
    for chunk in chunks_raw:
        chunk_dur = duration * (len(chunk) / max(len(text), 1))
        if chunk_dur > max_duration or len(chunk) > max_chars:
            sub_seg = dict(seg)
            sub_seg["text"] = chunk
            sub_seg["start"] = t_start
            sub_seg["end"] = t_start + chunk_dur
            out.extend(
                _split_long_segment(sub_seg, speaker, max_duration, max_chars)
            )
        else:
            if chunk.strip():
                sub = dict(seg)
                sub["text"] = chunk.strip()
                sub["start"] = round(float(t_start), 3)
                sub["end"] = round(float(t_start + chunk_dur), 3)
                sub["speaker"] = speaker or sub.get("speaker", "SPEAKER_00")
                sub.pop("words", None)
                out.append(sub)
        t_start += chunk_dur
    return out


def _speaker_overlap(seg: dict, diarization_segments: list[dict]) -> str:
    """Return the diarization speaker with the largest absolute overlap."""
    best_overlap = 0.0
    assigned = "SPEAKER_00"
    t_start = float(seg.get("start", 0))
    t_end = float(seg.get("end", t_start))
    for d_seg in diarization_segments:
        d_start = float(d_seg.get("start", 0))
        d_end = float(d_seg.get("end", 0))
        overlap = max(0.0, min(t_end, d_end) - max(t_start, d_start))
        if overlap > best_overlap:
            best_overlap = overlap
            assigned = d_seg.get("speaker", "SPEAKER_00")
    return assigned


def _split_segment_by_diarization(
    seg: dict,
    diarization_segments: list[dict],
    max_duration: float = _MAX_SEGMENT_DURATION,
    max_chars: int = _MAX_SEGMENT_CHARS,
) -> list[dict]:
    """
    Split a transcript segment along diarization speaker boundaries and assign
    each piece the corresponding speaker.

    If the segment contains no diarization overlaps, or diarization collapsed to a
    single speaker, we still force a phrase-level split when the segment is too long.
    """
    t_start = float(seg.get("start", 0))
    t_end = float(seg.get("end", t_start))
    text = (seg.get("text") or "").strip()

    if not text:
        out = dict(seg)
        out["speaker"] = _speaker_overlap(out, diarization_segments)
        return [out]

    # Intersect diarization turns with this segment.
    intervals = []
    for d in diarization_segments:
        ds = float(d.get("start", 0))
        de = float(d.get("end", 0))
        sp = d.get("speaker") or "SPEAKER_00"
        if de <= t_start or ds >= t_end:
            continue
        intervals.append([max(ds, t_start), min(de, t_end), sp])

    intervals.sort(key=lambda x: x[0])

    # Merge adjacent or overlapping turns from the same speaker.
    merged = []
    for inv in intervals:
        if merged and inv[2] == merged[-1][2] and inv[0] <= merged[-1][1] + 0.25:
            merged[-1][1] = max(merged[-1][1], inv[1])
        else:
            merged.append(inv)
    intervals = merged
    # Drop zero-length turns so we do not create empty output segments.
    intervals = [i for i in intervals if i[1] > i[0]]

    # No usable diarization: split long segments by punctuation, keep one speaker.
    if not intervals:
        return _split_long_segment(seg, _speaker_overlap(seg, diarization_segments), max_duration, max_chars)

    # Single speaker for this interval: still split if the segment is too long.
    if len(intervals) == 1:
        return _split_long_segment(seg, intervals[0][2], max_duration, max_chars)

    # Turns averaging under this floor are more likely diarization noise than
    # real speaker changes — fall back to the dominant speaker rather than
    # splitting on jitter. Time-based, not character-count-based: a
    # character-count guard here (len(intervals) > chars_total) was
    # language-biased — CJK text conveys a full exchange in far fewer
    # characters than the English equivalent, so it tripped constantly on
    # Cantonese/Chinese segments and almost never on English ones for the
    # identical number of real speaker turns, silently collapsing real
    # multi-speaker Cantonese dialogue into one dominant voice.
    # Floor lowered from 0.8 to 0.3 (env-configurable): confirmed directly
    # against a real transcript that rapid Cantonese back-and-forth (turn
    # gaps under 0.8s) was landing below the old floor and collapsing to one
    # speaker even after Deepgram itself produced separate diarization turns.
    min_turn_duration = float(os.getenv("DIARIZATION_MIN_TURN_DURATION", "0.3"))
    avg_turn_duration = (t_end - t_start) / len(intervals)
    chars_total = max(len(text), 1)
    # Second guard, independent of the duration check above: the proportional
    # allocation below needs at least one character per interval to produce
    # valid, non-overlapping slices (see max_target's "- (num_intervals - 1 - i)"
    # term). Real turns average >=0.8s can still fail this on a very short
    # transcription (e.g. one-word interjections back to back), and without
    # this check max_target goes negative, corrupting split points into chunks
    # that come out empty and get silently dropped at the chunk.strip() filter
    # below — those speakers' dialogue vanishes rather than misattributes.
    # This is a hard mathematical precondition of the algorithm, not a
    # language-sensitivity issue: it only fires when there isn't even 1
    # character per turn, which is rare for genuine multi-turn dialogue in any
    # script, unlike the old bug which fired on any Cantonese segment with
    # more turns than its (naturally low) character count.
    if avg_turn_duration < min_turn_duration or len(intervals) > chars_total:
        speakers = {}
        for s, e, sp in intervals:
            speakers[sp] = speakers.get(sp, 0.0) + (e - s)
        dominant = max(speakers, key=speakers.get)
        return _split_long_segment(seg, dominant, max_duration, max_chars)

    # Multiple speakers: allocate text proportionally to each interval and split at
    # natural punctuation boundaries when possible.  This preserves the exact number
    # of speaker turns instead of collapsing ratios into fewer chunks.
    #
    # Split priority:
    #   1. Sentence-ending punctuation (。！？.?!；;) within 25% of target
    #   2. Word boundary (space/comma) — BUT only if both sides have at least
    #      _MIN_FRAGMENT_CHARS characters and _MIN_FRAGMENT_WORDS words.
    #      This prevents "a few / months" (fragment too short) while still
    #      allowing splits in long multi-speaker segments with no punctuation
    #      (so 5 sentences don't collapse into one bubble/speaker).
    #   3. If neither found, don't split — dominant speaker gets the whole line.
    _MIN_FRAGMENT_CHARS = 8
    _MIN_FRAGMENT_WORDS = 2

    total_speech = sum(i[1] - i[0] for i in intervals)
    num_intervals = len(intervals)
    split_points: list[int] = []
    prev_point = 0
    cum_speech = 0.0
    search_end = chars_total - 1
    for i in range(num_intervals - 1):
        cum_speech += intervals[i][1] - intervals[i][0]
        ratio = cum_speech / total_speech
        raw_target = int(chars_total * min(ratio, 0.999))
        # Leave at least one character for every remaining interval.
        max_target = chars_total - (num_intervals - 1 - i)
        target = min(max(raw_target, prev_point + 1), max_target)

        # 1. Search for sentence-ending punctuation within 25% of remaining text.
        max_dist = max(3, int((search_end - prev_point) * 0.25))
        best = -1
        best_dist = float("inf")
        for j in range(prev_point, search_end):
            if text[j] in _SENTENCE_END_PUNCT:
                dist = abs((j + 1) - target)
                if dist <= max_dist and dist < best_dist:
                    best = j + 1
                    best_dist = dist

        # 2. If no sentence boundary, try word boundaries — but only if both
        #    sides would be long enough to be meaningful speech fragments.
        if best == -1:
            for j in range(prev_point, search_end):
                if text[j] in _WORD_BOUNDARY_PUNCT:
                    dist = abs((j + 1) - target)
                    if dist < best_dist:
                        left = text[prev_point:j].strip()
                        right = text[j:].strip()
                        left_words = len(left.split())
                        right_words = len(right.split())
                        if (len(left) >= _MIN_FRAGMENT_CHARS
                                and len(right) >= _MIN_FRAGMENT_CHARS
                                and left_words >= _MIN_FRAGMENT_WORDS
                                and right_words >= _MIN_FRAGMENT_WORDS):
                            best = j + 1
                            best_dist = dist

        if best == -1:
            # No suitable boundary — skip this split.
            continue
        best = max(prev_point + 1, min(best, search_end))
        split_points.append(best)
        prev_point = best

    # If we couldn't find boundaries for every turn transition, don't
    # force-split — assign the whole segment to the dominant speaker.
    if len(split_points) < num_intervals - 1:
        speakers = {}
        for s, e, sp in intervals:
            speakers[sp] = speakers.get(sp, 0.0) + (e - s)
        dominant = max(speakers, key=speakers.get)
        return _split_long_segment(seg, dominant, max_duration, max_chars)

    chunks = []
    last = 0
    for pt in split_points:
        chunks.append(text[last:pt])
        last = pt
    chunks.append(text[last:])

    out = []
    for chunk, (s, e, sp) in zip(chunks, intervals):
        if not chunk.strip():
            continue
        # Skip fragments that are too short to be meaningful speech.
        if (float(e) - float(s)) < 0.25 and len(chunk.strip()) < 2:
            continue
        sub = dict(seg)
        sub["text"] = chunk.strip()
        sub["start"] = round(float(s), 3)
        sub["end"] = round(float(e), 3)
        sub["speaker"] = sp
        sub.pop("words", None)
        # A single speaker may still have a long monologue; split it further.
        sub_dur = sub["end"] - sub["start"]
        if sub_dur > max_duration or len(sub["text"]) > max_chars:
            out.extend(_split_long_segment(sub, sp, max_duration, max_chars))
        else:
            out.append(sub)
    return out


def _assign_and_split_segments(
    transcript_segments: list[dict],
    diarization_segments: list[dict],
    max_duration: float = _MAX_SEGMENT_DURATION,
    max_chars: int = _MAX_SEGMENT_CHARS,
) -> list[dict]:
    """Assign speakers and split any transcript segments that span turns."""
    out = []
    for seg in transcript_segments:
        out.extend(_split_segment_by_diarization(seg, diarization_segments, max_duration, max_chars))
    return out


# Simple CJK detector for merging over-fragmented Chinese/Cantonese text without
# inserting spaces between characters.
_CJK_RE = re.compile(r"[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]")


def _merge_overfragmented_segments(
    segments: list[dict],
    max_gap: float = 0.5,
    max_duration: float = _MAX_SEGMENT_DURATION,
    max_chars: int = _MAX_SEGMENT_CHARS,
) -> list[dict]:
    """Merge adjacent same-speaker fragments that were split by diarization noise.

    WenetSpeech's VAD produces short chunks; when those chunks cross a pyannote
    speaker-boundary jitter, the diarization rescue split can chop a single
    sentence into tiny pieces (e.g. "Master Ip" / "haven't you taken any
    disciples in today?"). This step rejoins adjacent fragments when:
      - they have the same speaker,
      - the gap/overlap is small,
      - the previous fragment does not end with sentence-ending punctuation,
      - the combined segment still fits the duration/char limits.
    """
    if not segments:
        return segments

    _SENTENCE_ENDS = frozenset(".!?。！？")

    def _join_texts(a: str, b: str) -> str:
        a = (a or "").rstrip()
        b = (b or "").lstrip()
        # If both sides are primarily CJK, do not insert a space.
        if _CJK_RE.search(a) and _CJK_RE.search(b):
            return (a + b).strip()
        return (a + " " + b).strip()

    merged: list[dict] = []
    for seg in sorted(segments, key=lambda s: float(s.get("start", 0))):
        if not merged:
            merged.append(seg)
            continue

        prev = merged[-1]
        prev_speaker = prev.get("speaker", "SPEAKER_00")
        cur_speaker = seg.get("speaker", "SPEAKER_00")
        gap = float(seg.get("start", 0)) - float(prev.get("end", 0))
        prev_text = (prev.get("text") or "").strip()
        cur_text = (seg.get("text") or "").strip()
        joined_text = _join_texts(prev_text, cur_text)
        joined_dur = float(seg.get("end", 0)) - float(prev.get("start", 0))

        can_merge = (
            prev_speaker == cur_speaker
            and prev_text
            and cur_text
            and gap >= -0.05
            and gap <= max_gap
            and prev_text[-1] not in _SENTENCE_ENDS
            and joined_dur <= max_duration
            and len(joined_text) <= max_chars
        )

        if can_merge:
            merged[-1] = dict(prev)
            merged[-1]["text"] = joined_text
            merged[-1]["end"] = float(seg.get("end", 0))
            # Combine word alignments if both sides carry them.
            if prev.get("words") or seg.get("words"):
                merged[-1]["words"] = (prev.get("words") or []) + (seg.get("words") or [])
            # Keep the lower (worse) confidence of the two fragments.
            prev_conf = prev.get("confidence")
            cur_conf = seg.get("confidence")
            if prev_conf is not None and cur_conf is not None:
                merged[-1]["confidence"] = min(prev_conf, cur_conf)
            # If either fragment was flagged low-confidence, keep the flag.
            if prev.get("confidence_tier") == "low" or seg.get("confidence_tier") == "low":
                merged[-1]["confidence_tier"] = "low"
        else:
            merged.append(seg)

    return merged


def handler(event):
    """
    RunPod serverless handler — v29.

    Pipeline: Download → Extract Audio → Demucs Separation →
              Chinese Multi-Engine ASR / Whisper Transcription →
              pyannote Diarization → Speaker Assignment → Anti-Fragmentation Merge

    Returns transcript + diarization data to the local backend.
    Translation and TTS happen locally (not in RunPod) so the local
    backend can do per-speaker voice routing.
    """
    logger.info("RunPod handler v29 invoked")
    timings = {}
    t0 = time.time()

    job_input = event.get("input", event)
    file_url       = job_input.get("file_url", "")
    video_path     = job_input.get("video_path", file_url)
    language       = job_input.get("language", job_input.get("source_language")) or None
    min_speakers   = int(job_input.get("min_speakers", 1))
    max_speakers   = int(job_input.get("max_speakers", 6))
    # When caller specifies an exact count (min==max), honour it strictly.
    _exact_speakers = min_speakers if min_speakers == max_speakers and min_speakers > 0 else None
    job_id         = job_input.get("job_id", event.get("id", "local"))
    steps          = job_input.get("steps", ["separate", "transcribe", "diarize"])

    # RunPod can reuse a warm container.  Remove any stale per-job artifacts
    # from an earlier invocation before this job writes to the same paths.
    for _stale in glob.glob(f"/tmp/{job_id}_*") + [
        f"data/transcripts/{job_id}.json",
        f"data/diarization/{job_id}.json",
        f"data/separated/{job_id}_accompaniment.wav",
        f"data/separated/{job_id}_vocals.wav",
    ]:
        try:
            if os.path.exists(_stale):
                os.remove(_stale)
                logger.info(f"[CLEANUP] Removed stale artifact: {_stale}")
        except OSError:
            pass

    # RunPod template env vars are static. Apply per-job env vars sent by the
    # backend so ASR/diarization settings can be pinned per job.
    env_vars = job_input.get("env_vars", {})
    if env_vars:
        for k, v in env_vars.items():
            if isinstance(v, str):
                os.environ[k] = v
        logger.info(f"[ENV] Applied per-job env vars: {sorted(env_vars.keys())}")

    if not video_path:
        return {"error": "No video_path or file_url provided"}

    # ── Step 1: Download (if URL) ─────────────────────────────────────────
    if video_path.startswith("http"):
        import urllib.request
        from urllib.parse import urlparse
        # The backend now hands this an audio-only file (see
        # _get_runpod_file_url in routes.py) — usually .mka, sometimes still
        # a video container for a caller that hasn't been updated. Derive
        # the extension from the URL rather than hardcoding .mp4: ffmpeg
        # sniffs by content, not name, so a mismatch wasn't fatal, but a
        # video-named file holding audio-only bytes is confusing to debug.
        _url_ext = os.path.splitext(urlparse(video_path).path)[1] or ".mp4"
        local_path = f"/tmp/{job_id}_source{_url_ext}"
        logger.info(f"[1/4] Downloading {video_path} → {local_path}")
        t_dl = time.time()
        urllib.request.urlretrieve(video_path, local_path)
        timings["download"] = round(time.time() - t_dl, 2)
        logger.info(f"Download complete in {timings['download']}s")
        video_path = local_path
    else:
        if not os.path.exists(video_path):
            return {"error": f"video_path not found: {video_path}"}

    # ── Step 2: Extract Audio (lazily) ────────────────────────────────────
    # Don't decode the original video into 16 kHz mono here if Demucs is going
    # to do its own 44.1 kHz extraction anyway. We'll only fall back to this
    # when source separation is disabled or fails.
    extract_result = None
    if "separate" not in steps:
        logger.info("[2/4] Extracting audio")
        t_ex = time.time()
        extract_result = extract_audio(video_path)
        timings["extract"] = round(time.time() - t_ex, 2)
        if extract_result.get("status") != "ok":
            return {"error": f"Audio extraction failed: {extract_result.get('reason', '')}"}

    # ── Step 3: Demucs Source Separation (vocals only) ───────────────────
    vocals_audio_path = None
    stem_keys: dict = {}
    if "separate" in steps:
        logger.info("[3a/4] Running Demucs source separation")
        t_sep = time.time()
        sep_result = separate_audio(video_path, job_id=job_id)
        timings["separate"] = round(time.time() - t_sep, 2)

        if sep_result.get("status") == "ok":
            vocals_audio_path = sep_result.get("vocals_path")
            logger.info(f"Separation complete in {timings['separate']}s → vocals: {vocals_audio_path}")
            # Hand the stems back so the backend never re-separates on CPU.
            _t_up = time.time()
            try:
                stem_keys = _upload_stems(job_id, sep_result)
            except Exception as _stem_exc:
                # Belt and braces. Transcription is the job; stems are a bonus.
                logger.warning(f"[STEMS] export raised, continuing: {_stem_exc}")
                stem_keys = {}
            if stem_keys:
                timings["stem_upload"] = round(time.time() - _t_up, 2)
        else:
            logger.warning(f"Separation skipped ({sep_result.get('reason')}) — transcribing raw audio")

    # Load separated vocals once and reuse for both transcription and diarization.
    # Previously this file was decoded twice (once per stage), adding a redundant
    # FFmpeg pass and memory copy for long-form audio.
    vocal_extract = None
    if vocals_audio_path and os.path.exists(vocals_audio_path):
        t_load = time.time()
        vocal_extract = extract_audio(vocals_audio_path)
        if vocal_extract.get("status") == "ok":
            logger.info(f"Using separated vocals for transcription & diarization (load: {round(time.time()-t_load, 2)}s)")
        else:
            logger.warning("Failed to load separated vocals — falling back to original audio")
            vocal_extract = None

    # If separated vocals were not produced or could not be loaded, decode the
    # original source once for transcription/diarization.
    if vocal_extract is None and extract_result is None:
        logger.info("[2/4] Extracting audio (separation disabled/failed)")
        t_ex = time.time()
        extract_result = extract_audio(video_path)
        timings["extract"] = round(time.time() - t_ex, 2)
        if extract_result.get("status") != "ok":
            return {"error": f"Audio extraction failed: {extract_result.get('reason', '')}"}

    transcription_source = vocal_extract if vocal_extract is not None else extract_result
    diarize_source = transcription_source

    # Set language env var before launching the parallel transcription/diarization
    # tasks so both pick it up consistently.
    prev_lang = os.environ.get("WHISPER_LANGUAGE")
    if language:
        os.environ["WHISPER_LANGUAGE"] = language
    else:
        os.environ.pop("WHISPER_LANGUAGE", None)

    # ── Step 4 + 5: Transcription and Speaker Diarization in parallel ─────
    # Transcription is GPU-bound and diarization is CPU-bound by default; they
    # use independent models and can run concurrently on the worker. This hides
    # the CPU diarization time behind transcription on long-form content.
    transcript_result: dict = {"status": "skipped"}
    diarize_result: dict = {"status": "skipped"}
    diarization_segments = []

    _lang_norm = (language or "").lower().strip()

    def _run_transcribe():
        t0 = time.time()
        if _lang_norm in _CHINESE_LANGS:
            # Multi-engine pipeline: Deepgram → Tencent → Paraformer → Whisper
            # Passes separated vocals so the engines get the cleanest signal.
            logger.info(f"[TRANSCRIBE] Chinese language '{language}' — using multi-engine Chinese pipeline")
            result = transcribe_cantonese(
                transcription_source,
                vocals_path=vocals_audio_path,
                job_id=job_id,
                source_language=language,
            )
        else:
            result = transcribe_audio(transcription_source, job_id=job_id, source_language=language)
        timings["transcribe"] = round(time.time() - t0, 2)
        return result

    def _run_diarize():
        if vocal_extract is not None:
            logger.info("[DIARIZE] Using separated vocals as diarization source")
        t0 = time.time()
        # Cantonese/Mandarin: prefer Speechmatics' diarization over pyannote.
        # Confirmed directly against the Ip Man 2 test clip that pyannote
        # (and Deepgram's own diarization) collapse brief interjections
        # inside a longer speaker's turn; Speechmatics' tunable
        # speaker_sensitivity showed real separation on the same audio.
        # Requires the real vocals WAV file (not just a decoded tensor) and
        # falls back to pyannote on any failure or if unconfigured.
        if _lang_norm in _CHINESE_LANGS and os.getenv("SPEECHMATICS_API_KEY") and vocals_audio_path:
            logger.info(f"[DIARIZE] Chinese language '{language}' — using Speechmatics diarization instead of pyannote")
            result = diarize_with_speechmatics(vocals_audio_path, job_id=job_id, source_language=language)
            if result.get("status") != "ok":
                logger.warning(
                    f"[DIARIZE] Speechmatics diarization unavailable ({result.get('reason')}) — falling back to pyannote"
                )
                result = diarize_audio(diarize_source, job_id=job_id, min_speakers=min_speakers, max_speakers=max_speakers)
        else:
            result = diarize_audio(diarize_source, job_id=job_id, min_speakers=min_speakers, max_speakers=max_speakers)
        timings["diarize"] = round(time.time() - t0, 2)
        return result

    if "transcribe" in steps or "diarize" in steps:
        steps_run = [s for s in ("transcribe", "diarize") if s in steps]
        logger.info(f"[3b/4]+[4/4] Running {', '.join(steps_run)} in parallel")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            tr_future = pool.submit(_run_transcribe) if "transcribe" in steps else None
            di_future = pool.submit(_run_diarize) if "diarize" in steps else None
            transcript_result = tr_future.result() if tr_future else {"status": "skipped"}
            diarize_result = di_future.result() if di_future else {"status": "skipped"}

    # Restore the previous WHISPER_LANGUAGE env var.
    if prev_lang is None:
        os.environ.pop("WHISPER_LANGUAGE", None)
    else:
        os.environ["WHISPER_LANGUAGE"] = prev_lang

    # Process transcription output
    if "transcribe" in steps:
        if transcript_result.get("status") != "ok":
            return {"error": f"Transcription failed: {transcript_result.get('reason', '')}"}

        transcript_path = transcript_result.get("transcript_path", "")
        if not transcript_path or not os.path.exists(transcript_path):
            return {"error": "Transcript file missing after transcription"}

        with open(transcript_path, "r", encoding="utf-8") as f:
            transcript_data = json.load(f)

        segments = transcript_data.get("segments", [])
        logger.info(
            f"[STAGE] After transcription: {len(segments)} segments, "
            f"sources={sorted(set(s.get('source','?') for s in segments))}, "
            f"speakers={sorted(set(s.get('speaker','?') for s in segments))}"
        )
    else:
        transcript_data = {}
        segments = []

    # Process diarization output
    if "diarize" in steps:
        if diarize_result.get("status") == "ok":
            diarization_segments = diarize_result.get("segments", [])
            unique_diar = len(set(d.get("speaker") for d in diarization_segments))
            logger.info(f"Diarization complete in {timings.get('diarize', 0)}s: {len(diarization_segments)} turns, {unique_diar} speakers")
            # If user specified an exact count but pyannote returned fewer,
            # log a warning — the F0 fallback on the local backend will handle it.
            if _exact_speakers and unique_diar < _exact_speakers:
                logger.warning(
                    f"[DIARIZE] pyannote found {unique_diar} speaker(s) but expected {_exact_speakers} — "
                    "local backend F0 fallback will attempt re-split"
                )
        else:
            logger.warning(f"Diarization skipped: {diarize_result.get('reason')} — all segments will use SPEAKER_00")

    # ── Speaker Assignment ────────────────────────────────────────────────
    if diarization_segments:
        before = len(segments)
        segments = _assign_and_split_segments(segments, diarization_segments)
        unique = len(set(s.get("speaker") for s in segments))
        logger.info(
            f"[STAGE] After speaker assignment: {unique} unique speaker(s) across "
            f"{len(segments)} segments (before split: {before})"
        )
    else:
        # No diarization: still split any ASR monster segments by punctuation so
        # translation/TTS timing doesn't collapse multiple turns into one block.
        before = len(segments)
        segments = _assign_and_split_segments(segments, [])
        unique = len(set(s.get("speaker") for s in segments))
        logger.info(
            f"[STAGE] After speaker assignment (no diarization): {unique} default speaker(s) across "
            f"{len(segments)} segments (before split: {before})"
        )

    # ── Anti-fragmentation merge ───────────────────────────────────────────
    # WenetSpeech's short VAD chunks can get chopped further by the diarization
    # rescue split. Rejoin adjacent same-speaker fragments that do not end with
    # sentence-ending punctuation so a single sentence isn't broken into pieces.
    _before_merge = len(segments)
    segments = _merge_overfragmented_segments(segments)
    if len(segments) != _before_merge:
        logger.info(
            f"[STAGE] After anti-fragmentation merge: {len(segments)} segments "
            f"(merged {_before_merge - len(segments)} fragment(s))"
        )

    # ── Confidence Tiering ────────────────────────────────────────────────
    # Tag each segment so the editor can route low-confidence ones to review.
    for seg in segments:
        conf = float(seg.get("confidence", 0.0) or 0.0)
        source = seg.get("source", "")
        is_gap_fill = "gap_fill" in source or "whisper_gap" in source
        is_truncated = seg.get("repetition_truncated", False)

        if is_truncated or conf < 0.4 or is_gap_fill:
            seg["confidence_tier"] = "low"
        elif conf >= 0.85:
            seg["confidence_tier"] = "high"
        else:
            seg["confidence_tier"] = "medium"

    timings["total"] = round(time.time() - t0, 2)
    logger.info(f"Handler v28 complete in {timings['total']}s — {len(segments)} segments, {len(diarization_segments)} diarization turns")

    import torch
    gpu_info = {
        "device": "cuda" if torch.cuda.is_available() else "cpu",
        "name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
    }

    return {
        "status": "success",
        "segments": segments,
        "transcript": transcript_data,
        "diarization": {"segments": diarization_segments},
        "speaker_genders": {},
        # R2 keys for the GPU-produced stems when the export succeeded. Absent
        # means the backend falls back to exactly its previous behaviour.
        "stems": stem_keys,
        "timings": timings,
        "gpu": gpu_info,
        "job_id": job_id,
    }


runpod.serverless.start({"handler": handler})
