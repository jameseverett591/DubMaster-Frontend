import subprocess
import os
import re
import math
import shutil
import tempfile
import time
from datetime import datetime
from pathlib import Path
import logging
from typing import Optional, List, Dict, Any, Tuple
import asyncio
import json
import httpx

from app.services.elevenlabs_tts import elevenlabs_tts
from app.services.fish_audio_tts import fish_audio_tts
from app.services.respeecher_service import respeecher_tts, SEED_HISTORY_MAX
from app.services import tts_usage
from app.services.translation_service import (
    translation_service,
    natural_duration,
    update_voice_rate,
    MAX_SPEED_RATIO,
    MIN_SPEED_RATIO,
)
from app.config import get_settings
from app.utils.language import normalize_language_code
from app.utils.emotion import analyze_emotion, analyze_emotion_fish
from app.pipeline.separate_audio import separate_audio

logger = logging.getLogger(__name__)
settings = get_settings()

# Voice keys to use when auto-assigning by detected gender.
# Multiple voices per gender so that different speakers of the same gender
# still sound distinct from each other.
_VOICES_BY_GENDER: Dict[str, List[str]] = {
    "male":   ["male-1",   "male-2",   "male-3",   "male-4"],
    "female": ["female-1", "female-2", "female-3", "female-4"],
    "child":  ["child-1",  "child-2",  "child-3"],
}

# ---------------------------------------------------------------------------
# Fish Audio S2 emotion styling
# ---------------------------------------------------------------------------
# Fish S2 (model="s2-pro") steers delivery from FREE-FORM natural-language tags
# in SQUARE BRACKETS placed before the line, e.g. "[whisper in small voice]"
# (per fish.audio's S2 announcement). The editor's emotion pills are single
# words; a bare "[excited]" is the weakest possible instruction. We expand each
# pill into a short descriptive directive — pitch movement, pacing, and how the
# line's endings rise or trail — so S2 has something concrete to perform.
# Keys are lowercased pill labels. "neutral" maps to no tag (no steering);
# unknown/custom write-ins fall through as the bare word.
_S2_EMOTION_STYLE: Dict[str, str] = {
    "happy":        "happy, warm and bright, lightly smiling tone",
    "excited":      "excited, breathless and eager, rising pitch with building anticipation",
    "calm":         "calm, slow and steady, soft soothing tone",
    "sad":          "sad, heavy and subdued, downward trailing endings",
    "angry":        "angry, tense and forceful, clipped hard delivery",
    "fearful":      "fearful, shaky and hushed, quick uneven breaths",
    "surprised":    "surprised, sudden sharp rise in pitch, wide-eyed disbelief",
    "disgusted":    "disgusted, recoiling, curled sneering tone",
    "professional": "professional broadcast tone, clear measured and confident",
    "casual":       "casual, relaxed and easygoing, conversational",
    "formal":       "formal, poised and precise, controlled cadence",
    "intimate":     "intimate, soft and close, gentle breathy warmth",
    "defiant":      "defiant, firm and unyielding, chin-up challenging tone",
    "confused":     "confused, hesitant and searching, inquisitive rising ending",
    "whisper":      "whisper in a small voice, hushed and airy",
    "shout":        "shouting, loud and projected, urgent force",
    "sarcastic":    "sarcastic, dry and mocking, exaggerated flat delivery",
    "hopeful":      "hopeful, gentle rising pitch, warm anticipation",
    "melancholic":  "melancholic, wistful and slow, trailing pensive endings",
    "neutral":      "",
}


def _emotion_desc(emotion: Optional[str]) -> str:
    """Return the bare S2 description for an emotion pill (no brackets).

    "" for empty/neutral; the rich phrase for known pills; the bare lowercased
    word for unknown/custom write-ins so nothing is silently dropped.
    """
    if not emotion:
        return ""
    # Strip any brackets the user typed in the custom write-in so we never nest
    # them (compose wraps the whole directive in one [ ]); then look up presets.
    key = emotion.strip().lower().replace("[", "").replace("]", "").strip()
    return _S2_EMOTION_STYLE.get(key, key)


def fish_emotion_tag(emotion: Optional[str]) -> str:
    """Map a single emotion pill to a Fish S2 bracket directive ("" if none)."""
    desc = _emotion_desc(emotion)
    return f"[{desc}]" if desc else ""


def compose_fish_directive(
    emotion: Optional[str] = None,
    traits: Optional[List[str]] = None,
    nuance_directives: Optional[List[str]] = None,
    extra: Optional[str] = None,
) -> str:
    """Fold character traits + emotion + nuance directives + a free-text write-in
    into ONE Fish S2 natural-language bracket instruction.

    e.g. "[gruff, hopeful with gentle rising pitch and warm anticipation,
    breathy intimate onset, soft trailing tail, lingers on the last word]".

    A single coherent [ ] instruction outperforms several separate bracket tags
    stacked at the front of the line (per fish.audio's S2 guidance). Order:
    character traits (colour the whole read), then the line emotion, then the
    delivery/breath/cadence nuances, then the user's write-in directive last.
    ``extra`` is free text typed in the editor's Nuances panel — its own square
    brackets are stripped so it becomes a clause inside the one directive rather
    than a nested tag. Duplicates are dropped; returns "" when nothing to steer.
    """
    clauses: List[str] = []
    seen: set = set()

    def _add(text: Optional[str]) -> None:
        if not text:
            return
        t = text.strip()
        key = t.lower()
        if t and key not in seen:
            seen.add(key)
            clauses.append(t)

    for tr in (traits or []):
        _add(tr)  # per-speaker character words, passed through as written
    _add(_emotion_desc(emotion))
    for d in (nuance_directives or []):
        _add(d)  # already full phrases from translate_for_fish_audio
    if extra:
        _add(extra.replace("[", "").replace("]", ""))  # write-in, brackets stripped

    return "[" + ", ".join(clauses) + "]" if clauses else ""

# Provisional velma_low_confidence threshold. Revisit after 2-3 real review
# sessions using flag_status/correction_type outcome data.
CONFIDENCE_FLAG_THRESHOLD = 0.65

# Provisional meaning_divergence threshold. Recalibrate after reviewing real
# score distributions from the first batch of review sessions.
MEANING_DIVERGENCE_THRESHOLD = 0.7

# Longest source we will separate locally before falling back to a
# dialogue-only mix. Demucs has no GPU in this container, so beyond roughly ten
# minutes it blocks the whole dub for hours. Short films stay under the cap and
# keep their full music-and-effects bed. Remove this once the RunPod worker
# returns the stems it already produces on GPU.
ACCOMPANIMENT_MAX_DURATION_S = 600


def atomic_write_json(path: str, data, indent: int = 2) -> None:
    """Write JSON so a reader can never see a half-written file.

    segments.json is rewritten in full by every regenerate and commit call while
    the editor polls it. A plain open(path, "w") truncates first, so a write that
    is interrupted — or that overlaps another writer — leaves invalid JSON on
    disk. That is exactly how an 839-segment file was found cut off partway
    through segment 634, taking 206 segments with it and 500ing the editor.

    Writing a sibling temp file and os.replace() makes the swap atomic: a reader
    gets either the whole old file or the whole new one.

    This guarantees VALIDITY, not serialisation — two overlapping
    read-modify-write cycles can still lose an update. Preventing that needs a
    lock, which is a larger change.
    """
    directory = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".segments-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=indent, ensure_ascii=False)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class DubbingService:
    def __init__(self):
        self.dubbed_dir = settings.DUBBED_DIR
        os.makedirs(self.dubbed_dir, exist_ok=True)
        # One lock per job for segments.json read-modify-write cycles. Without
        # this, a rerun can read stale scenes, then an editor PUT /scenes writes
        # new scenes, then the rerun writes the stale scenes back and loses them.
        self._segment_file_locks: Dict[str, asyncio.Lock] = {}

    async def _get_segments_file_lock(self, job_id: str) -> asyncio.Lock:
        lock = self._segment_file_locks.get(job_id)
        if lock is None:
            lock = asyncio.Lock()
            self._segment_file_locks[job_id] = lock
        return lock

    def _get_tts_provider(self, target_language: str = "en"):
        """Return the active TTS service based on TTS_PROVIDER env/config.

        Yoruba (yo) and Igbo (ig) are only supported by Fish Audio, so they
        are routed there regardless of the default TTS_PROVIDER setting.
        """
        target_norm = normalize_language_code(target_language)
        if target_norm in {"yo", "ig"}:
            if fish_audio_tts.enabled:
                return fish_audio_tts, "fish-audio"
            raise RuntimeError(
                f"Target language '{target_language}' requires Fish Audio TTS, "
                "but Fish Audio is not enabled."
            )

        provider = os.getenv("TTS_PROVIDER", settings.TTS_PROVIDER).lower().strip()
        if provider == "fish-audio" and fish_audio_tts.enabled:
            return fish_audio_tts, "fish-audio"
        return elevenlabs_tts, "elevenlabs"

    def _stabilize_speakers(self, transcript: List[Dict]) -> List[Dict]:
        """
        Reduce rapid speaker flips by reassigning very short segments when
        the surrounding speakers match. This keeps one character on one voice.
        """
        if len(transcript) < 3:
            return transcript

        for i in range(1, len(transcript) - 1):
            seg = transcript[i]
            prev_seg = transcript[i - 1]
            next_seg = transcript[i + 1]

            seg_duration = max(0.0, float(seg.get("end", 0)) - float(seg.get("start", 0)))
            # Only reassign very short segments (<0.4s) — segments 0.4-0.8s
            # often represent legitimate short utterances in fast dialogue.
            if seg_duration > 0.4:
                continue

            prev_speaker = prev_seg.get("speaker")
            next_speaker = next_seg.get("speaker")
            if prev_speaker and prev_speaker == next_speaker and seg.get("speaker") != prev_speaker:
                seg["speaker"] = prev_speaker

        return transcript

    def _merge_close_segments(self, transcript: List[Dict], max_gap: float = 0.15) -> List[Dict]:
        """
        Merge consecutive segments from the same speaker when the gap between
        them is smaller than *max_gap* seconds.  This produces longer, more
        natural TTS calls and avoids choppy fast/normal/fast speed artefacts
        when many tiny segments are packed together.

        When diarization was skipped (all segments share a single speaker
        label), merging is disabled to prevent mashing different characters'
        lines into one TTS call.
        """
        if not transcript:
            return transcript

        # Detect whether real diarization ran: if every segment has the same
        # speaker label, diarization was probably skipped/timed-out and we
        # should NOT merge (different characters would get combined).
        unique_speakers = set(
            seg.get("speaker") or "speaker-1" for seg in transcript
        )
        if len(unique_speakers) <= 1:
            logger.info(
                f"[MERGE] Only 1 speaker label found ({unique_speakers}) — "
                f"diarization likely skipped; skipping segment merge to preserve "
                f"per-line timing"
            )
            return transcript

        MAX_MERGED_CHARS = 80  # hard cap on already-accumulated text before merging more
        MAX_MERGE_COUNT = 2    # never chain more than 2 segments into one TTS call
        MAX_MERGED_DURATION = 8.0  # never create a merged segment longer than 8 seconds

        merged: List[Dict] = [dict(transcript[0])]  # deep-ish copy
        merge_counts: List[int] = [1]

        for seg in transcript[1:]:
            prev = merged[-1]
            gap = float(seg.get("start", 0)) - float(prev.get("end", 0))
            same_speaker = (seg.get("speaker") or "speaker-1") == (prev.get("speaker") or "speaker-1")
            merged_text = prev["text"].rstrip() + " " + seg.get("text", "").lstrip()
            merged_duration = float(seg.get("end", 0)) - float(prev.get("start", 0))

            if same_speaker and gap > 0.3 and gap < max_gap and len(prev["text"]) <= MAX_MERGED_CHARS and merge_counts[-1] < MAX_MERGE_COUNT and merged_duration <= MAX_MERGED_DURATION:
                # Merge: extend the previous segment
                prev["text"]  = merged_text
                prev["end"]   = seg.get("end", prev["end"])
                merge_counts[-1] += 1
                logger.info(
                    f"[MERGE] Merged segment into [{prev['start']:.2f}-{prev['end']:.2f}] "
                    f"(gap={gap:.3f}s): {prev['text'][:80]}"
                )
            else:
                merged.append(dict(seg))
                merge_counts.append(1)

        if len(merged) != len(transcript):
            logger.info(f"[MERGE] {len(transcript)} segments -> {len(merged)} after merging")

        return merged

    def _sanitize_text(self, text: str) -> str:
        """
        Prevent pathological repetition like "espada espada espada" from
        producing a stuck TTS loop.
        """
        import re
        cleaned = text.strip()
        if not cleaned:
            return cleaned

        # Collapse 3+ consecutive repeats of the same word.
        cleaned = re.sub(r"\b(\w+)(\s+\1){2,}\b", r"\1", cleaned, flags=re.IGNORECASE)
        return cleaned

    # Average spoken words-per-second for natural speech across languages.
    # Used to estimate a realistic maximum duration for a segment.
    _WORDS_PER_SECOND = 3.5
    # Absolute minimum slot we ever assign (prevents sub-0.3s slots after clamping).
    _MIN_SLOT_SECONDS = 0.3
    # Characters-per-second for CJK (each char ≈ one syllable at normal pace).
    _CJK_CHARS_PER_SECOND = 4.0
    # Max speed-up when FITTING audio into its slot. Higher than the natural-
    # translation cap (MAX_SPEED_RATIO ~1.15) and matches the editor regen path, so
    # a long line fits by speeding up rather than being hard-trimmed (truncated).
    _FIT_MAX_SPEED = float(os.getenv("DUBMASTER_FIT_MAX_SPEED", "1.5"))
    # How far a segment may be placed EARLIER than its word-level start time in
    # order to borrow room from the silence before it. 0.2s ≈ 4-5 frames at 24fps:
    # noticeable on a tight close-up, but the ear forgives that much drift.
    _MAX_BORROW = 0.2

    # Patterns that identify non-dialogue hallucination segments that must be
    # dropped before translation and TTS.
    _HALLUCINATION_PATTERNS = [
        r"thanks\s+for\s+watching",
        r"subscribe",
        r"like\s+and\s+subscribe",
        r"please\s+subscribe",
        r"don't\s+forget\s+to\s+like",
        r"\[music\]",
        r"\[applause\]",
        r"\[laughter\]",
        r"^[\s\d一二三四五六七八九十,，、\.。]+$",
        r"(\b\w+\b\s+){2,}\1",  # Repetitive word patterns (e.g., "said said said")
    ]

    def _strip_hallucinations(self, transcript: List[Dict]) -> List[Dict]:
        """
        Remove segments that are YouTube/video watermarks or Whisper
        hallucinations rather than actual dialogue.

        Two rules:
        1. Text matches a known hallucination pattern (case-insensitive).
        2. Transcript language is CJK but the segment contains only Latin
           characters and no CJK — indicates Whisper hallucinated English
           text from background noise.
        """
        import re

        if not transcript:
            return transcript

        # Determine transcript language from the majority of segments.
        cjk_re = re.compile(r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]')
        cjk_count = sum(1 for s in transcript if cjk_re.search(s.get("text", "")))
        is_cjk_transcript = cjk_count > len(transcript) // 2

        hallucination_re = re.compile(
            "|".join(self._HALLUCINATION_PATTERNS), re.IGNORECASE
        )

        cleaned = []
        for seg in transcript:
            text = (seg.get("text") or "").strip()
            if not text:
                continue
            if hallucination_re.search(text):
                logger.info(f"[CLEAN] Dropped hallucination: {text[:60]!r}")
                continue
            # Drop only short non-CJK snippets in a mostly-CJK transcript. Longer Latin
            # text is kept (bilingual films, English-dubbed source) — dropping all Latin
            # lines removes TTS and the mix can sound like "no speech".
            if (
                is_cjk_transcript
                and not cjk_re.search(text)
                and len(text.strip()) > 1
                and len(text.strip()) <= int(os.getenv("DUBBING_LATIN_DROP_MAX_CHARS", "24"))
            ):
                logger.info(f"[CLEAN] Dropped short wrong-script segment: {text[:60]!r}")
                continue
            cleaned.append(seg)

        if len(cleaned) != len(transcript):
            logger.info(f"[CLEAN] {len(transcript)} → {len(cleaned)} segments after hallucination strip")

        return cleaned

    def _clamp_timestamps(self, transcript: List[Dict]) -> List[Dict]:
        """
        Whisper sometimes assigns an end timestamp far beyond when the speech
        actually ends — especially for short utterances inside fight scenes
        where background noise fills the VAD window (e.g. "我劈" gets end=58.74
        when the actual speech ends at ~48s).

        Fix: cap each segment's end so the slot never exceeds a generous
        estimate of how long the text realistically takes to say, while
        always leaving at least _MIN_SLOT_SECONDS.

        The cap uses characters-per-second for CJK text and words-per-second
        for Latin text, with a 2.5× safety multiplier so fast speech or long
        translated equivalents still fit.

        Additionally: when a segment's end overlaps the *next* segment's start,
        clamp it to next_start - 50ms so slots never overlap.
        """
        import re

        if not transcript:
            return transcript

        cjk_re = re.compile(r'[\u4e00-\u9fff\u3040-\u30ff]')
        result = [dict(s) for s in transcript]

        for i, seg in enumerate(result):
            text = (seg.get("text") or "").strip()
            start = float(seg.get("start", 0))
            end = float(seg.get("end", start))
            current_slot = end - start

            if not text or current_slot <= 0:
                continue

            # Estimate realistic max duration for this text.
            cjk_chars = len(cjk_re.findall(text))
            if cjk_chars > len(text) * 0.4:
                # Mostly CJK
                estimated_sec = cjk_chars / self._CJK_CHARS_PER_SECOND
            else:
                word_count = max(1, len(text.split()))
                estimated_sec = word_count / self._WORDS_PER_SECOND

            # Allow 2.5× the estimated time as generous headroom.
            max_slot = max(self._MIN_SLOT_SECONDS, estimated_sec * 2.5)

            new_end = end
            if current_slot > max_slot:
                new_end = start + max_slot
                logger.info(
                    f"[CLAMP] seg {i} [{start:.2f}-{end:.2f}] ({current_slot:.1f}s) "
                    f"clamped to [{start:.2f}-{new_end:.2f}] ({max_slot:.1f}s) "
                    f"for text={text[:40]!r}"
                )

            # Also ensure this segment doesn't overlap the next segment's start.
            if i + 1 < len(result):
                next_start = float(result[i + 1].get("start", new_end))
                if new_end > next_start - 0.05:
                    new_end = max(start + self._MIN_SLOT_SECONDS, next_start - 0.05)

            result[i]["end"] = round(new_end, 3)

        return result

    def _stable_unique_speakers(self, transcript: List[Dict]) -> List[str]:
        seen = set()
        ordered: List[str] = []
        for seg in transcript:
            speaker = seg.get("speaker") or "speaker-1"
            if speaker not in seen:
                seen.add(speaker)
                ordered.append(speaker)
        return ordered

    def _load_disk_segments(self, job_id: str) -> List[Dict]:
        """Load the previous segments.json for a job, if any."""
        try:
            path = os.path.join(self.dubbed_dir, job_id, "segments.json")
            if not os.path.exists(path):
                return []
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data.get("segments", []) if isinstance(data, dict) else data
        except Exception as e:
            logger.warning(f"[VOICE-MAP] Failed to load disk segments for {job_id}: {e}")
            return []

    def _enrich_segment_voices(
        self,
        transcript: List[Dict],
        disk_segments: List[Dict],
    ) -> List[Dict]:
        """Copy persisted voice ids onto new transcript segments by time overlap.

        This makes the speaker->voice mapping survive re-diarization or any
        other operation that renumbers speaker labels, because we match the
        actual speech intervals rather than the labels.
        """
        if not disk_segments or not transcript:
            return transcript

        disk = []
        for ds in disk_segments:
            start = float(ds.get("start_time", ds.get("start", 0)) or 0)
            end = float(ds.get("end_time", ds.get("end", 0)) or 0)
            if end <= start:
                continue
            disk.append({
                "start": start,
                "end": end,
                "voice_id": ds.get("voice_id"),
                "committed_voice_id": ds.get("committed_voice_id"),
            })

        for seg in transcript:
            seg_start = float(seg.get("start", 0) or 0)
            seg_end = float(seg.get("end", 0) or 0)
            if seg_end <= seg_start:
                continue

            best = None
            best_overlap = 0.0
            for ds in disk:
                overlap = min(seg_end, ds["end"]) - max(seg_start, ds["start"])
                if overlap > best_overlap:
                    best_overlap = overlap
                    best = ds

            # Require at least 100ms of overlap to avoid spurious matches.
            if best and best_overlap > 0.1:
                if best["voice_id"]:
                    seg["voice_id"] = best["voice_id"]
                if best["committed_voice_id"]:
                    seg["committed_voice_id"] = best["committed_voice_id"]

        return transcript

    @staticmethod
    def _speaker_index(speaker_id: str) -> Optional[int]:
        """Numeric index from a speaker label, or None if it isn't of that shape."""
        try:
            if speaker_id.startswith("speaker-"):
                return max(0, int(speaker_id.split("-")[1]) - 1)
            if speaker_id.startswith("speaker_"):
                return max(0, int(speaker_id.split("_")[1]))
            if speaker_id.startswith("SPEAKER_"):
                return max(0, int(speaker_id.split("_")[1]))
        except Exception:
            return None
        return None

    @classmethod
    def _explicit_voice_for_speaker(
        cls, speaker: str, voice_mapping: Optional[Dict[str, str]]
    ) -> Optional[str]:
        """The voice EXPLICITLY assigned to this speaker, or None.

        Single source of truth for "did the user actually pick a voice for this
        speaker." Used by _build_speaker_voice_map's Pass 1 AND by the dub loop's
        Path A / Path B decision — deliberately one function, because a second copy
        of this key-matching would be free to drift, and the two callers disagreeing
        would silently change which speakers get zero-shot cloned.

        Deliberately does NOT consider the gender-pool fallbacks (Passes 2 and 3):
        those fill in EVERY remaining speaker, so treating them as "assigned" would
        disable zero-shot cloning across the board.

        Note: a whitespace-only value counts as assigned. That mirrors the original
        truthiness check exactly; tightening it would change which speakers get
        cloned, so it's left alone here as a separate decision.
        """
        if not voice_mapping:
            return None
        if voice_mapping.get(speaker):
            return voice_mapping[speaker]
        idx = cls._speaker_index(speaker)
        if idx is None:
            return None
        # "voice-N" is what the frontend currently sends; the others are legacy or
        # alternate label formats that have all shown up in real payloads.
        for key in (
            f"speaker-{idx + 1}",
            f"voice-{idx + 1}",
            f"speaker_{idx}",
            f"SPEAKER_{idx:02d}",
            f"SPEAKER_{idx}",
        ):
            if voice_mapping.get(key):
                return voice_mapping[key]
        return None

    def _build_speaker_voice_map(
        self,
        transcript: List[Dict],
        voice_mapping: Dict[str, str],
        speaker_genders: Optional[Dict[str, str]] = None,
    ) -> Dict[str, str]:
        unique_speakers = self._stable_unique_speakers(transcript)

        # ------------------------------------------------------------------ #
        # Pass 0: recover voices from the segments themselves.                  #
        # Each segment may carry a voice_id / committed_voice_id from a          #
        # previous dub. Picking the dominant voice per speaker makes the       #
        # mapping survive re-diarization even when speaker labels change.      #
        # ------------------------------------------------------------------ #
        speaker_to_voice: Dict[str, str] = {}
        for speaker in unique_speakers:
            counts: Dict[str, int] = {}
            for seg in transcript:
                if (seg.get("speaker") or "speaker-1") != speaker:
                    continue
                voice = seg.get("committed_voice_id") or seg.get("voice_id")
                if voice:
                    counts[voice] = counts.get(voice, 0) + 1
            if counts:
                dominant = max(counts.items(), key=lambda kv: kv[1])[0]
                speaker_to_voice[speaker] = dominant
                logger.info(f"[VOICE MAP] {speaker} recovered from segment voices -> {dominant}")

        # ------------------------------------------------------------------ #
        # Pass 1: match by explicit key from the frontend voice_mapping.      #
        # Tries multiple key formats so "voice-1", "speaker-1", "SPEAKER_00" #
        # etc. all resolve correctly regardless of which the frontend sends.  #
        # ------------------------------------------------------------------ #
        if voice_mapping:
            for speaker in unique_speakers:
                explicit = self._explicit_voice_for_speaker(speaker, voice_mapping)
                if explicit:
                    speaker_to_voice[speaker] = explicit
                    logger.info(f"[VOICE MAP] {speaker} explicitly assigned -> {explicit}")

        # ------------------------------------------------------------------ #
        # Pass 2: gender-based auto-assignment for speakers still unmatched.  #
        # Uses F0-detected gender (speaker_genders) to pick a distinct voice  #
        # per speaker so different speakers sound different.                  #
        # ------------------------------------------------------------------ #
        gender_usage: Dict[str, int] = {}   # tracks how many of each gender assigned

        unmatched = [s for s in unique_speakers if s not in speaker_to_voice]
        if unmatched and speaker_genders:
            for speaker in unmatched:
                gender = speaker_genders.get(speaker, "male")
                pool   = _VOICES_BY_GENDER.get(gender, _VOICES_BY_GENDER["male"])
                idx    = gender_usage.get(gender, 0)
                voice  = pool[idx % len(pool)]
                gender_usage[gender] = idx + 1
                speaker_to_voice[speaker] = voice
                logger.info(
                    f"[VOICE MAP] {speaker} auto-assigned '{voice}' "
                    f"(gender={gender}, detection-based)"
                )
            unmatched = [s for s in unique_speakers if s not in speaker_to_voice]

        # ------------------------------------------------------------------ #
        # Pass 3: no gender data — cycle through male pool so each speaker   #
        # gets a distinct voice instead of all collapsing to one default.    #
        # ------------------------------------------------------------------ #
        if unmatched:
            male_pool = _VOICES_BY_GENDER["male"]
            for i, speaker in enumerate(unmatched):
                voice = male_pool[i % len(male_pool)]
                speaker_to_voice[speaker] = voice
                logger.info(f"[VOICE MAP] {speaker} fallback pool -> {voice} (no gender data)")

        return speaker_to_voice

    def _extract_speaker_references(
        self,
        transcript: List[Dict],
        vocals_path: str,
        output_dir: str,
        max_refs: int = 3,
        max_total_seconds: float = 25.0,
        min_segment_seconds: float = 2.0,
    ) -> Dict[str, List[Dict]]:
        """Extract per-speaker audio clips from separated vocals for inline voice cloning.

        For each unique speaker, selects the longest/clearest segments from the
        diarized transcript, extracts the corresponding audio from the Demucs-
        separated vocals, and returns them as dicts ready for Fish Audio
        ``ReferenceAudio(audio=bytes, text=str)``.

        Parameters
        ----------
        transcript : list of dict
            Diarized transcript with ``speaker``, ``start``, ``end``, ``text`` keys.
            Must be the *original* transcript (pre-translation) so that ``text``
            matches the language of the vocal audio.
        vocals_path : str
            Path to the Demucs-separated vocals WAV file.
        output_dir : str
            Working directory for temporary audio clips.
        max_refs : int
            Maximum number of reference clips per speaker (Fish Audio recommends 1-3).
        max_total_seconds : float
            Maximum combined duration of reference clips per speaker.
        min_segment_seconds : float
            Ignore segments shorter than this (too short for voice cloning).

        Returns
        -------
        dict mapping speaker_id -> list of {``"audio"``: bytes, ``"text"``: str}
        """
        if not vocals_path or not os.path.exists(vocals_path):
            logger.info("[VOICE-CLONE] No separated vocals available, skipping reference extraction")
            return {}

        refs_dir = os.path.join(output_dir, "speaker_refs")
        os.makedirs(refs_dir, exist_ok=True)

        # Group segments by speaker, sorted by duration (longest first)
        speaker_segments: Dict[str, List[Dict]] = {}
        for seg in transcript:
            spk = seg.get("speaker", "speaker-1")
            text = (seg.get("text") or "").strip()
            start = float(seg.get("start", 0))
            end = float(seg.get("end", 0))
            duration = end - start
            if duration < min_segment_seconds or not text:
                continue
            speaker_segments.setdefault(spk, []).append({
                "start": start,
                "end": end,
                "duration": duration,
                "text": text,
            })

        # Sort each speaker's segments: strongly prefer early, calm segments.
        # Fish Audio clones vocal *style* from references — fight-scene clips
        # (shouting, exhausted, high-energy) produce those qualities in every
        # synthesised segment, including calm dialogue.  Three-tier priority:
        #   Tier 0: early (<60s) AND ideal duration (3-8s)  — best of both
        #   Tier 1: early (<60s) any duration               — calm voice wins
        #   Tier 2: late clips (fight scene, post-fight)    — last resort only
        # Within each tier, prefer earliest start time.
        # This prevents the ref selector from picking a 3.78s clip at 237s
        # over a 2.34s clip at 11s just because it hits the ideal-length range.
        for spk in speaker_segments:
            speaker_segments[spk].sort(
                key=lambda s: (
                    0 if (s["start"] < 60 and 3.0 <= s["duration"] <= 8.0) else
                    1 if s["start"] < 60 else
                    2,
                    s["start"],
                ),
            )

        result: Dict[str, List[Dict]] = {}

        for spk, segments in speaker_segments.items():
            refs = []
            total_duration = 0.0

            for seg in segments:
                if len(refs) >= max_refs or total_duration >= max_total_seconds:
                    break

                # Cap individual clip at remaining budget
                clip_duration = min(seg["duration"], max_total_seconds - total_duration)
                clip_end = seg["start"] + clip_duration

                clip_path = os.path.join(refs_dir, f"{spk}_ref{len(refs)}.wav")

                try:
                    cmd = [
                        "ffmpeg", "-y",
                        "-i", vocals_path,
                        "-ss", f"{seg['start']:.3f}",
                        "-to", f"{clip_end:.3f}",
                        "-ar", "44100", "-ac", "1",
                        "-f", "wav", clip_path,
                    ]
                    subprocess.run(
                        cmd, capture_output=True, timeout=30,
                        check=True,
                    )

                    if not os.path.exists(clip_path) or os.path.getsize(clip_path) < 1000:
                        continue

                    with open(clip_path, "rb") as f:
                        audio_bytes = f.read()

                    refs.append({
                        "audio": audio_bytes,
                        "text": "",  # blank prevents Cantonese text from steering English phonetics
                    })
                    total_duration += clip_duration

                    logger.info(
                        f"[VOICE-CLONE] {spk} ref#{len(refs)-1}: "
                        f"{seg['start']:.1f}s-{clip_end:.1f}s ({clip_duration:.1f}s) "
                        f"{'CALM-ZONE' if seg['start'] < 30 else 'MID' if seg['start'] < 60 else 'LATE'} "
                        f"text={seg['text'][:40]!r}"
                    )

                except subprocess.TimeoutExpired:
                    logger.warning(f"[VOICE-CLONE] ffmpeg timeout extracting {spk} ref clip")
                except subprocess.CalledProcessError as e:
                    logger.warning(f"[VOICE-CLONE] ffmpeg error for {spk}: {e.stderr[:200] if e.stderr else ''}")

            if refs:
                result[spk] = refs
                logger.info(
                    f"[VOICE-CLONE] {spk}: {len(refs)} reference(s), "
                    f"{total_duration:.1f}s total"
                )
            else:
                logger.warning(f"[VOICE-CLONE] {spk}: no usable reference clips")

        return result

    async def dub_video(
        self,
        job_id: str,
        video_path: str,
        transcript: List[Dict],
        target_language: str,
        voice_mapping: Dict[str, str],
        voice_settings: Optional[Dict[str, Dict[str, float]]] = None,
        source_language: str = "en",
        speaker_genders: Optional[Dict[str, str]] = None,
        adaptation_selections: Optional[Dict[str, str]] = None,
        traits_mapping: Optional[Dict[str, List[str]]] = None,
        character_profiles: Optional[List[Dict]] = None,
    ) -> Optional[Dict[str, str]]:
        logger.info(f"Starting dubbing for job {job_id}")
        logger.info(f"Voice mapping received: {voice_mapping}")
        logger.info(f"Source language: {source_language}, Target language: {target_language}")
        logger.info(f"Transcript segments: {len(transcript)}")
        
        try:
            output_dir = os.path.join(self.dubbed_dir, job_id)
            os.makedirs(output_dir, exist_ok=True)

            # --- Recover per-segment voice assignments from a previous dub ---
            # This makes the speaker->voice mapping survive re-diarization or
            # reprocessing even when speaker labels get renumbered.
            self._enrich_segment_voices(transcript, self._load_disk_segments(job_id))

            # --- Reuse Demucs separation cached from the upload pipeline ---
            # separate_audio already ran during process_video_pipeline and wrote
            # its outputs to data/separated/<job_id>_*.wav.  Resolve those paths
            # directly so we never re-run the 3-8 min model a second time.
            from pathlib import Path as _Path
            _sep_dir = _Path("data/separated")
            _acc_candidate = str(_sep_dir / f"{job_id}_accompaniment.wav")
            _voc_candidate = str(_sep_dir / f"{job_id}_vocals.wav")

            _cached_separation = (
                os.path.exists(_acc_candidate)
                and os.path.getsize(_acc_candidate) > 1000
                and os.path.exists(_voc_candidate)
                and os.path.getsize(_voc_candidate) > 1000
            )

            # Long-form guard. Demucs runs on CPU here (no CUDA in this
            # container) at well under real time, so a feature-length film spends
            # hours separating before a single line is synthesised. The RunPod
            # worker ALREADY separates on GPU during transcription but does not
            # return its stems, so we would be paying for the same work twice —
            # once fast and discarded, once slow and blocking.
            #
            # Above the threshold we skip it and mix dialogue-only. That loses
            # the original music and effects bed, which is a real quality cost
            # and the reason this is capped rather than removed: short films
            # still get the full mix. The proper fix is the worker returning its
            # stems, which is a change to an image outside this repo.
            _src_duration = 0.0
            if not _cached_separation:
                try:
                    _probe = subprocess.run(
                        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                         "-of", "csv=p=0", video_path],
                        capture_output=True, text=True,
                    )
                    _src_duration = float((_probe.stdout or "0").strip() or 0)
                except Exception:
                    # Unknown duration falls back to the transcript's own span
                    # rather than assuming "short" and starting an hours-long run.
                    _src_duration = max((s.get("end", 0) or 0) for s in transcript) if transcript else 0.0

            if _cached_separation:
                accompaniment_path = _acc_candidate
                vocals_path = _voc_candidate
                logger.info(
                    f"[SEPARATE] Reusing cached separation — skipping Demucs re-run "
                    f"(accompaniment={os.path.getsize(_acc_candidate)//1024}KB, "
                    f"vocals={os.path.getsize(_voc_candidate)//1024}KB)"
                )
            elif _src_duration > ACCOMPANIMENT_MAX_DURATION_S:
                accompaniment_path = None
                vocals_path = None
                logger.warning(
                    f"[MIX] Skipping accompaniment for long-form content "
                    f"(duration={_src_duration:.0f}s) — GPU stems not available"
                )
            else:
                logger.info("[SEPARATE] Cached separation not found — running Demucs now")
                sep_result = await asyncio.to_thread(separate_audio, video_path, job_id)
                accompaniment_path = (
                    sep_result.get("accompaniment_path")
                    if sep_result["status"] == "ok"
                    else None
                )
                vocals_path = (
                    sep_result.get("vocals_path")
                    if sep_result["status"] == "ok"
                    else None
                )
                if accompaniment_path:
                    logger.info(
                        f"[SEPARATE] Demucs ran fresh "
                        f"(model={sep_result.get('model')}): {accompaniment_path}"
                    )
                else:
                    logger.info(
                        f"[SEPARATE] Falling back to legacy audio blend "
                        f"(reason: {sep_result.get('reason', 'unknown')})"
                    )

            # --- Recover dialogue from fight-scene gaps using separated vocals ---
            # DISABLED: Gap recovery injects Whisper hallucinations from fight
            # scenes (e.g. "Amitabha", "duckweed").  Re-enable once strict
            # filtering is implemented.
            video_duration = await asyncio.to_thread(self._get_video_duration, video_path)
            # if vocals_path:
            #     transcript = self._recover_gaps_from_vocals(
            #         transcript, vocals_path, video_duration
            #     )

            # Strip YouTube watermarks and Whisper hallucinations.
            transcript = self._strip_hallucinations(transcript)

            # Clamp Whisper end timestamps that are unrealistically long
            # (short utterances inside fight scenes get huge VAD windows).
            transcript = self._clamp_timestamps(transcript)

            # Stabilize speaker assignments to prevent voice jumping.
            transcript = self._stabilize_speakers(transcript)

            # Merge consecutive same-speaker segments with small gaps to produce
            # longer, more natural TTS calls and uniform pacing.
            transcript = self._merge_close_segments(transcript, max_gap=0.3)

            # --- Extract speaker voice references for Fish Audio inline cloning ---
            # Must happen BEFORE translation so the reference text matches the
            # language spoken in the vocal audio.
            _, provider_name_check = self._get_tts_provider(target_language)
            speaker_voice_refs: Dict[str, List[Dict]] = {}
            if provider_name_check == "fish-audio" and vocals_path and os.path.exists(vocals_path):
                try:
                    speaker_voice_refs = self._extract_speaker_references(
                        transcript, vocals_path, output_dir
                    )
                    logger.info(
                        f"[VOICE-CLONE] Extracted references for {len(speaker_voice_refs)} speakers"
                    )
                except Exception as _ref_err:
                    logger.warning(f"[VOICE-CLONE] Extraction failed, using presets: {_ref_err}")
                    speaker_voice_refs = {}
            else:
                logger.info("[VOICE-CLONE] Preset-only mode — no vocals or non-Fish provider")

            source_norm = normalize_language_code(source_language, allow_auto=True)
            target_norm = normalize_language_code(target_language, strict=True)

            if source_norm != source_language or target_norm != target_language:
                logger.info(
                    f"Normalized languages: source={source_language} -> {source_norm}, "
                    f"target={target_language} -> {target_norm}"
                )

            # Stamp stable segment IDs before translation so we can track each
            # segment through drops and re-indexing.
            for _i, _seg in enumerate(transcript):
                _seg["segment_id"] = str(_i)
                _seg["source_text"] = _seg.get("text", "")

            if source_norm != target_norm:
                logger.info(f"Translating transcript from {source_norm} to {target_norm}")

                # Stamp speaker_gender onto each segment so the translation prompt
                # gets correct pronoun data — speaker_genders is F0-classified upstream
                # but was never reaching Claude before this fix.
                if speaker_genders:
                    _stamped = 0
                    for _seg in transcript:
                        _spk = _seg.get("speaker", "")
                        if _spk and _spk in speaker_genders:
                            _seg["speaker_gender"] = speaker_genders[_spk]
                            _stamped += 1
                    logger.info(f"[DUB] Stamped speaker_gender on {_stamped} segments: {speaker_genders}")

                # Load Velma scene context if available
                _velma_context = None
                _velma_path = os.path.join("data", "velma", f"{job_id}.json")
                if os.path.exists(_velma_path):
                    try:
                        import json as _json_vc
                        with open(_velma_path, "r", encoding="utf-8") as _vcf:
                            _velma_context = _json_vc.load(_vcf)
                        logger.info(f"[DUB] Loaded Velma scene context for {job_id}")
                    except Exception as _vc_err:
                        logger.warning(f"[DUB] Failed to load Velma context: {_vc_err}")
                transcript = await translation_service.translate_segments(
                    transcript,
                    source_norm,
                    target_norm,
                    character_profiles=character_profiles,
                    velma_context=_velma_context,
                )
                logger.info(f"Translation complete for {len(transcript)} segments")
                if transcript:
                    logger.info(f"Sample translated text: {transcript[0].get('text', '')[:100]}")

                # Sentence split: expand multi-sentence segments into one per sentence
                # Stamp stable namespaced IDs before split so split children's
                # original_segment_id ("pre:N") never collides with the post-split
                # numeric segment_ids ("0", "1", ...) assigned below.
                for _pi, _ps in enumerate(transcript):
                    _ps["segment_id"] = f"pre:{_pi}"
                from app.services.translation_service import split_translated_sentences
                _pre_split = len(transcript)
                transcript = split_translated_sentences(transcript)
                if len(transcript) != _pre_split:
                    logger.info(f"[SPLIT] Sentence split: {_pre_split} → {len(transcript)} segments")
                    for _i, _seg in enumerate(transcript):
                        _seg["segment_id"] = str(_i)

                # Drop segments whose translation carries no speakable content:
                # empty (glossary suppressed), or punctuation/whitespace-only such
                # as a stray "." — TTS would otherwise synthesise junk audio from
                # it. Also drop single-token noise words (fight grunt residue,
                # hallucination). A punctuation-only result must never reach TTS,
                # regardless of how it arose (glossary, LLM, or future pipeline).
                _NOISE_WORDS = {
                    "you", "it", "he", "she", "they", "i", "we",
                    "sa", "ha", "oh", "ah", "uh", "bobo", "babo",
                    "the", "a", "an",
                }

                def _is_droppable(_raw: str) -> bool:
                    _t = _raw.strip()
                    # No letter / digit / CJK char → nothing TTS can voice
                    # (covers ASCII and full-width punctuation, whitespace, "_").
                    if not re.search(r"[^\W_]", _t, re.UNICODE):
                        return True
                    return _t.lower().rstrip(".,!?") in _NOISE_WORDS

                before_drop = len(transcript)
                transcript = [
                    s for s in transcript if not _is_droppable(s.get("text", ""))
                ]
                if len(transcript) != before_drop:
                    logger.info(
                        f"[CLEAN] Dropped {before_drop - len(transcript)} post-translation noise segment(s)"
                    )

            # --- ADAPTATION STEP ---
            # Generate 3 text variants per segment (faithful / performable / sync_fit).
            # Falls back gracefully to raw translated text if LLM is unavailable.
            adapted_map: Dict[str, object] = {}
            try:
                from app.services.adaptation_engine import adapt_batch
                _adapt_inputs = [
                    {
                        "segment_id": seg.get("segment_id", str(idx)),
                        "source_text": seg.get("source_text", ""),
                        "target_text": seg.get("text", ""),
                        "source_language": source_norm,
                        "target_language": target_norm,
                        "source_duration": max(
                            0.3, float(seg.get("end", 0)) - float(seg.get("start", 0))
                        ),
                        "speaker_id": seg.get("speaker", "speaker-1"),
                        "speaker_gender": (speaker_genders or {}).get(
                            seg.get("speaker", "speaker-1"), "male"
                        ),
                    }
                    for idx, seg in enumerate(transcript)
                ]
                _adapted_list = await adapt_batch(
                    segments=_adapt_inputs,
                    target_language=target_norm,
                    scene_context=None,
                )
                adapted_map = {a.segment_id: a for a in _adapted_list}
                logger.info(f"[ADAPTATION] Generated variants for {len(adapted_map)} segments")
            except Exception as _adapt_err:
                logger.warning(f"[ADAPTATION] Skipped — will use raw translation: {_adapt_err}")

            tts_engines: List[str] = []
            segment_engines: List[Optional[str]] = [None for _ in transcript]

            unique_speakers = self._stable_unique_speakers(transcript)
            logger.info(f"Unique speakers in transcript (stable): {unique_speakers}")
            logger.info(f"Voice mapping received: {voice_mapping}")

            speaker_to_voice = self._build_speaker_voice_map(
                transcript, voice_mapping, speaker_genders
            )

            logger.info(f"Speaker to voice assignment: {speaker_to_voice}")

            # ------------------------------------------------------------------
            # Phase A: fire all TTS calls in parallel via asyncio.gather.
            # Each coroutine writes its raw MP3 to segment_NNNN.mp3 and returns
            # the result dict (or None on failure).  ffmpeg fitting/trimming is
            # done in Phase B after all audio is on disk.
            # ------------------------------------------------------------------

            async def _synthesise_one(i: int, segment: Dict) -> Optional[Dict]:
                # Resolve adapted variant text, falling back to raw translated text.
                seg_id = segment.get("segment_id", str(i))
                speaker = segment.get("speaker", "speaker-1")
                # Resolve voice_key early so ADAPT-FIT can use a voice-calibrated
                # natural_duration() — without this, slow voices under-trigger the
                # shortener because the global 14 cps rate underestimates their time.
                # Order: per-segment committed voice > explicit speaker mapping >
                # per-segment rendered voice > speaker-level dominant/gender fallback.
                _explicit_key = self._explicit_voice_for_speaker(speaker, voice_mapping)
                _voice_key = (
                    segment.get("committed_voice_id")
                    or _explicit_key
                    or segment.get("voice_id")
                    or speaker_to_voice.get(speaker, "")
                )
                _adapted = adapted_map.get(seg_id)
                if _adapted is not None:
                    _variant_type = (adaptation_selections or {}).get(seg_id, "performable")
                    text = _adapted.get_variant(_variant_type).text or segment.get("text", "")
                    # Anti-truncation (step 1 — shorten): when the user hasn't explicitly
                    # picked a variant and the default would overrun the on-screen slot,
                    # prefer the shorter sync_fit wording instead of hard-trimming audio
                    # later. natural_duration() uses the voice's calibrated rate so slow
                    # voices trigger the shortener at the right threshold.
                    if seg_id not in (adaptation_selections or {}):
                        _start = float(segment.get("start", 0) or 0)
                        _next = transcript[i + 1].get("start") if i + 1 < len(transcript) else None
                        _slot = (float(_next) - _start) if _next is not None else (float(segment.get("end", 0) or 0) - _start)
                        if _slot > 0 and text and natural_duration(text, _voice_key) > _slot + 0.1:
                            try:
                                _sync = (_adapted.get_variant("sync_fit").text or "").strip()
                            except Exception:
                                _sync = ""
                            if _sync and natural_duration(_sync, _voice_key) < natural_duration(text, _voice_key):
                                logger.info(
                                    f"[ADAPT-FIT] seg {i}: '{_variant_type}' ~{natural_duration(text, _voice_key):.1f}s "
                                    f"overruns {_slot:.1f}s slot — using sync_fit ~{natural_duration(_sync, _voice_key):.1f}s"
                                )
                                text = _sync
                else:
                    text = segment.get("text", "")

                if not text.strip():
                    return {"index": i, "skipped": True, "reason": "empty"}

                # Skip subtitle/credit/narration lines — preserve original audio.
                if segment.get("is_credit"):
                    logger.info(f"[TTS] seg {i}: skipping subtitle/credit segment")
                    return {"index": i, "skipped": True, "reason": "credit"}

                text = self._sanitize_text(text)

                # Safety net: skip repetitive-character hallucinations
                # (e.g. "Aaaaaaaaa", "hhhhhhh") — fight grunt noise that Whisper
                # or translation garbled into repeated chars. Use a dominant-char
                # test (does ONE character make up most of the text?), which is
                # length-independent. A global unique-char ratio would falsely
                # flag any sentence longer than ~104 chars, since the alphabet is
                # finite — that silently dropped legitimate long translated lines.
                _stripped = text.replace(' ', '')
                if len(_stripped) >= 4:
                    _lower = _stripped.lower()
                    _dominant_ratio = max(_lower.count(c) for c in set(_lower)) / len(_lower)
                    if _dominant_ratio > 0.5:
                        logger.warning(
                            f"[TTS] Segment {i}: repetitive-char hallucination — skipping: '{text[:40]}'"
                        )
                        return {"index": i, "skipped": True, "reason": "repetitive_hallucination"}

                # Safety net: skip segments that are still mostly CJK — the
                # translation pipeline failed to translate them and sending raw
                # Cantonese to an English TTS engine produces garbage audio.
                _cjk_chars = len(re.findall(
                    r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]', text
                ))
                _non_space = len(re.findall(r'\S', text))
                _cjk_ratio = _cjk_chars / max(_non_space, 1)
                if _cjk_ratio > 0.5:
                    logger.warning(
                        f"[TTS] Segment {i}: text appears untranslated "
                        f"({_cjk_chars} CJK / {_non_space} chars = {_cjk_ratio:.0%}) "
                        f"— skipping: '{text[:60]}'"
                    )
                    return {"index": i, "skipped": True, "reason": "untranslated"}

                # Safety net: drop any unresolved glossary placeholder tokens
                # (XGLO###X) that survived the translation pipeline — sending
                # them to TTS produces literal "XGLO one zero four X" audio.
                if re.search(r'XGLO\d{3}X', text):
                    cleaned = re.sub(r'XGLO\d{3}X', '', text).strip()
                    logger.warning(
                        f"[TTS] Segment {i}: unresolved glossary placeholder(s) in text "
                        f"'{text}' — stripped to '{cleaned}'"
                    )
                    text = cleaned
                    if not text:
                        logger.warning(f"[TTS] Segment {i}: text was entirely a placeholder — skipping")
                        return {"index": i, "skipped": True, "reason": "unresolved_placeholder"}

                # TTS-only phonetic substitutions — display/transcript text unchanged
                tts_text = re.sub(r'\bIp Man\b', 'Yip Man', text, flags=re.IGNORECASE)
                tts_text = re.sub(r'\bMaster Shin\b', 'Master Sheen', tts_text, flags=re.IGNORECASE)
                tts_text = re.sub(r'\bMaster Xin\b', 'Master Sheen', tts_text, flags=re.IGNORECASE)
                tts_text = re.sub(r'\bMaster Jin\b', 'Master Sheen', tts_text, flags=re.IGNORECASE)
                tts_text = re.sub(r'\bMaster Xing\b', 'Master Sheen', tts_text, flags=re.IGNORECASE)
                tts_text = re.sub(r'\bWing Chun\b', 'Wing Chun', tts_text)  # already correct
                if tts_text != text:
                    logger.info(f"[PHONETIC] seg {i}: {text!r} -> {tts_text!r}")

                tts_provider, provider_name = self._get_tts_provider(target_norm)
                voice_key = _voice_key
                voice_id = tts_provider.get_voice_id(voice_key)
                model_id = tts_provider.get_model_for_language(target_norm)

                audio_path = os.path.join(output_dir, f"segment_{i:04d}.mp3")

                emotion_defaults = analyze_emotion(text)
                override = (voice_settings or {}).get(speaker, {})
                stability        = override.get("stability",        emotion_defaults["stability"])
                similarity_boost = override.get("similarity_boost", emotion_defaults["similarity_boost"])
                style            = override.get("style",            emotion_defaults["style"])
                pitch_shift      = float(override.get("pitch", 0.0))

                tts_kwargs: Optional[Dict] = dict(
                    text=tts_text,
                    voice_id=voice_id,
                    output_path=audio_path,
                    model_id=model_id,
                    stability=stability,
                    similarity_boost=similarity_boost,
                    style=style,
                    language=target_norm,
                )

                result = None
                fish_speed_applied = False
                speaker_gender = (speaker_genders or {}).get(speaker, "male")

                if speaker_gender == "child":
                    child_fish_id = fish_audio_tts.get_voice_id("child-1") if provider_name == "fish-audio" else ""
                    if child_fish_id:
                        # Use Fish Audio child preset — overwrite voice_id so the normal
                        # Fish Audio path below uses the right voice.
                        voice_id = child_fish_id
                        logger.info(
                            f"[CHILD-VOICE] seg {i} speaker={speaker}: Fish Audio child preset {child_fish_id!r}"
                        )
                    else:
                        logger.info(
                            f"[CHILD-VOICE] seg {i} speaker={speaker}: no Fish child preset — Edge TTS fallback"
                        )
                        child_result = await elevenlabs_tts._fallback_tts(
                            tts_text, audio_path, target_norm, voice_key, "child", pitch_shift
                        )
                        if child_result:
                            result = {"path": child_result, "engine": "edge-tts-child"}
                            tts_kwargs = None

                if provider_name == "fish-audio" and tts_kwargs is not None:
                    seg_emotion = segment.get("emotion")
                    # Character traits (per-speaker) + emotion (per-line) fold into ONE
                    # composed S2 directive rather than separate stacked brackets.
                    speaker_traits = (traits_mapping or {}).get(speaker) or []
                    tts_kwargs["emotion_tags"] = compose_fish_directive(
                        emotion=seg_emotion, traits=speaker_traits
                    )
                    tts_kwargs["traits_tag"] = ""  # folded into the composed directive above
                    # Voice identity, in priority order:
                    #   1. EXPLICIT user/library assignment -> reference_id -> JSON
                    #      /v1/tts -> s2.1-pro, composed directive PARSES. Costs no
                    #      Fish voice slot: the model already lives on Fish's side.
                    #   2. Zero-shot clone of the source actor -> SDK msgpack ->
                    #      s2-pro, directive inert. Preserves the ORIGINAL actor's
                    #      timbre, so it stays the default when nothing is assigned.
                    #
                    # Previously the explicit assignment was resolved into
                    # tts_kwargs["voice_id"] and then unconditionally overridden by
                    # the zero-shot refs, so picking a voice before the first dub
                    # silently did nothing until you regenerated in the editor.
                    #
                    # Must test against raw voice_mapping, NOT speaker_to_voice: the
                    # latter is gender-pool-filled for every speaker (Passes 2/3), so
                    # it reports "assigned" for everyone and would kill cloning.
                    # A per-segment committed_voice_id is also a deliberate assignment.
                    _explicit = (
                        segment.get("committed_voice_id")
                        or self._explicit_voice_for_speaker(speaker, voice_mapping)
                    )
                    _refs = speaker_voice_refs.get(speaker)
                    if _explicit:
                        # voice_id was already resolved from this same assignment at
                        # the top of the loop and is in tts_kwargs; just don't let the
                        # inline refs override it.
                        logger.info(
                            f"[VOICE-PATH] {speaker}: assigned {_explicit!r} "
                            f"(Path A / s2.1-pro, directives live, no voice slot used)"
                        )
                    elif _refs:
                        tts_kwargs["speaker_references"] = _refs
                        logger.info(
                            f"[VOICE-PATH] {speaker}: zero-shot clone (Path B / s2-pro)"
                        )

                    logger.info(
                        f"[FISH-TTS] seg {i} speaker={speaker} gender={speaker_gender} "
                        f"voice_id={voice_id!r} text={text[:60]!r}"
                    )
                elif tts_kwargs is not None:
                    # ElevenLabs path: pass through user pitch_shift for SSML / post-processing
                    if pitch_shift != 0:
                        tts_kwargs["pitch_shift"] = pitch_shift
                    logger.info(
                        f"[EMOTION] seg {i} speaker={speaker} "
                        f"stability={stability} style={style} text={text[:60]!r}"
                    )

                if tts_kwargs is not None:
                    result = await tts_provider.text_to_speech(**tts_kwargs)

                # Post-process: apply pitch shift to ElevenLabs-generated audio
                if result and pitch_shift != 0:
                    pitched_path = os.path.join(output_dir, f"segment_{i:04d}_pitched.mp3")
                    ok = await asyncio.to_thread(
                        self._apply_pitch_shift, result["path"], pitched_path, pitch_shift
                    )
                    if ok and os.path.exists(pitched_path):
                        result["path"] = pitched_path
                        logger.info(f"[PITCH] seg {i}: shifted {pitch_shift:+.0f} semitones")

                if result:
                    actual_engine = result.get("engine", provider_name)
                    # First-pass cost, kept separate from regenerations so the
                    # iteration tail can be seen on its own.
                    try:
                        tts_usage.record(
                            output_dir,
                            actual_engine,
                            characters=len(tts_text or text or ""),
                            api_requests=1,
                            regeneration=False,
                        )
                    except Exception:
                        pass
                    logger.info(
                        f"Segment {i}: engine={actual_engine} speaker={speaker} "
                        f"voice={voice_id} speed={tts_kwargs.get('speed', 1.0) if tts_kwargs else 1.0} "
                        f"text={text[:50]!r}"
                    )
                    return {
                        "index": i, "result": result, "text": text, "speaker": speaker,
                        "fish_speed_applied": fish_speed_applied,
                        "voice_id": voice_id,
                        "speed": tts_kwargs.get("speed", 1.0) if tts_kwargs else 1.0,
                    }
                else:
                    logger.warning(f"Failed to generate TTS for segment {i}")
                    return {"index": i, "failed": True}

            async def _check_meaning_divergence(source: str, adapted: str) -> tuple:
                """Check if English translation preserves Cantonese meaning. Returns (score, reason)."""
                if len(adapted.split()) < 2 or not source.strip():
                    return (None, None)
                api_key = os.getenv("ANTHROPIC_API_KEY", "")
                if not api_key:
                    return (None, None)
                payload = {
                    "model": "claude-sonnet-4-6",
                    "max_tokens": 300,
                    "temperature": 0,
                    "messages": [{"role": "user", "content": (
                        "You are evaluating whether an English dubbing translation preserves "
                        "the meaning and emotional register of the original Cantonese dialogue.\n\n"
                        f"Original Cantonese: {source}\n"
                        f"English translation: {adapted}\n\n"
                        "Score semantic faithfulness 0.0–1.0. Consider: idioms, implied threats, "
                        "cultural references, emotional register, power dynamics.\n"
                        "Note: proper names and titles may be rendered as established English "
                        "equivalents (e.g. Cantonese names in English or Mandarin transliteration) "
                        "— do not flag name substitutions as divergent.\n"
                        'Return ONLY valid JSON: {"score": <float 0-1>, "reason": "<one sentence if diverged, else null>"}'
                    )}],
                }
                headers = {
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                }
                try:
                    response = await asyncio.to_thread(
                        lambda: httpx.post(
                            "https://api.anthropic.com/v1/messages",
                            json=payload, headers=headers, timeout=30.0,
                        )
                    )
                    if response.status_code != 200:
                        logger.warning(f"[MEANING-DIVERGENCE] Claude failed: {response.status_code} {response.text[:200]}")
                        return (None, None)
                    raw_text = response.json()["content"][0]["text"].strip()
                    try:
                        result = json.loads(raw_text)
                        return (float(result["score"]), result.get("reason"))
                    except json.JSONDecodeError:
                        logger.warning(f"[MEANING-DIVERGENCE] non-JSON response: {raw_text[:200]}")
                        return (None, None)
                except Exception as e:
                    logger.warning(f"[MEANING-DIVERGENCE] check failed: {e}")
                    return (None, None)

            # Stage clock. Wall-clock per phase, so "the dub is slow" can be
            # answered with a number instead of a guess. Cheap enough to leave in.
            _stage_t = {"start": time.monotonic()}

            logger.info(f"[TTS] Launching {len(transcript)} TTS calls in parallel...")
            tts_results = await asyncio.gather(
                *[_synthesise_one(i, seg) for i, seg in enumerate(transcript)],
                return_exceptions=False,
            )
            _stage_t["tts"] = time.monotonic()
            logger.info(
                f"[STAGE] tts: {_stage_t['tts'] - _stage_t['start']:.1f}s "
                f"({len(transcript)} segments, parallel)"
            )
            logger.info("[TTS] All parallel TTS calls complete — running fit/trim pass")

            # Group segments by original_segment_id (split children share this)
            # or segment_id (standalone segments). Avoids penalising legitimate
            # sentence splits by evaluating the full concatenated English output
            # against the shared Cantonese source, not each fragment in isolation.
            from collections import defaultdict as _dd
            _grp_map: dict = _dd(list)
            for _si, _seg in enumerate(transcript):
                _grp = _seg.get("original_segment_id") or _seg.get("segment_id", str(_si))
                _ada = _seg.get("adapted_text") or _seg.get("text", "")
                _src = _seg.get("source_text", "")
                if _src.strip() and len(_ada.split()) >= 2:
                    _grp_map[_grp].append((_si, _src, _ada))

            _unique_grps = list(_grp_map.keys())
            _div_by_grp: dict = {}
            if _unique_grps:
                logger.info(f"[MEANING-DIVERGENCE] Running {len(_unique_grps)} checks ({len(transcript)} segments, {len(transcript) - len(_unique_grps)} split fragments grouped)...")
                _grp_results = await asyncio.gather(*[
                    _check_meaning_divergence(
                        _grp_map[_grp][0][1],
                        " ".join(_ada for _, _, _ada in _grp_map[_grp])
                    )
                    for _grp in _unique_grps
                ])
                for _grp, _res in zip(_unique_grps, _grp_results):
                    _div_by_grp[_grp] = _res

            divergence_scores = [
                _div_by_grp.get(
                    _seg.get("original_segment_id") or _seg.get("segment_id", str(_si)),
                    (None, None)
                )
                for _si, _seg in enumerate(transcript)
            ]
            logger.info("[MEANING-DIVERGENCE] All checks complete")

            # ------------------------------------------------------------------
            # Phase B: sequential fit/trim pass using the raw TTS audio on disk.
            # Must be sequential because target_duration depends on placement of
            # the previous segment (overlap detection).
            # ------------------------------------------------------------------
            audio_segments = []

            for i, segment in enumerate(transcript):
                raw = tts_results[i]
                if raw is None or raw.get("skipped") or raw.get("failed"):
                    if raw and raw.get("skipped"):
                        segment_engines[i] = "skipped"
                    else:
                        segment_engines[i] = "failed"
                    continue

                result = raw["result"]
                text = raw["text"]
                speaker = raw["speaker"]
                # Voice key for the per-voice rate calibration below. _synthesise_one
                # computes its own copy for the ADAPT-FIT threshold, but that is a
                # nested function — its local does not reach this loop, which is why
                # natural_duration()/update_voice_rate() here raised NameError.
                _voice_key = speaker_to_voice.get(speaker, "")
                start_time = segment.get("start", 0)
                end_time = segment.get("end", 0)
                next_start = transcript[i + 1].get("start", None) if i + 1 < len(transcript) else None

                # Skip duplicate short segments for the same speaker.
                if audio_segments:
                    prev = audio_segments[-1]
                    if prev.get("speaker") == speaker and prev.get("text") == text and (start_time - prev.get("end", 0)) <= 0.3:
                        logger.warning(f"Skipping duplicate segment for speaker={speaker}: {text[:30]}...")
                        segment_engines[i] = "skipped"
                        continue

                tts_engines.append(result.get("engine", "unknown"))
                segment_engines[i] = result.get("engine", "unknown")

                if next_start is not None:
                    segment_duration = end_time - start_time
                    gap_to_next = next_start - end_time  # natural silence in original film
                    # Level 1 — expand toward natural speech duration for translated text.
                    # Uses the voice-calibrated rate so slow voices get more expansion room
                    # — matching the ADAPT-FIT threshold that already uses the same rate.
                    _nat_dur = natural_duration(text, _voice_key)
                    _needed  = max(0.0, _nat_dur - segment_duration)
                    expansion = min(_needed, gap_to_next * 0.8) if gap_to_next > 0 else 0.0
                    comfortable_duration = max(0.2, segment_duration + expansion)
                    # Level 2 — hard ceiling: never overflow into the next segment.
                    # Computed below as full_room, which supersedes the old forward-only
                    # max_slot (next_start - start_time - 0.05): that measured from the
                    # word start rather than from where the audio is actually placed.
                    target_duration = comfortable_duration
                    # Bidirectional room: gap before this segment (from the previous
                    # segment's ACTUAL placed end, not its transcript end) + gap after
                    # (to next segment's start). Mirrors the regen path's full_room
                    # calculation — without this, split sub-segments with contiguous
                    # windows can't borrow time from surrounding gaps and get forced
                    # into aggressive atempo speed-ups.
                    #
                    # The borrowed room is taken by moving PLACEMENT earlier, not by
                    # extending the tail: sizing to a backward-extended window while
                    # still placing at start_time would push the tail past next_start
                    # by exactly the leading gap, silently overlapping the next line.
                    # _placed_start is what the segment is actually laid down at, so
                    # the window we fit to is the window we occupy.
                    _prev_placed_end = audio_segments[-1]["end"] if audio_segments else 0.0
                    _window_start = max(0.0, _prev_placed_end + 0.05)
                    # Cap: 0.2s ≈ 4-5 frames at 24fps — noticeable on a tight close-up
                    # but within the range where the ear forgives the eye. Below 50ms
                    # there is less than a syllable to gain, so don't shift at all.
                    _raw_borrow = start_time - _window_start
                    _borrow = min(_raw_borrow, self._MAX_BORROW) if _raw_borrow > 0.05 else 0.0
                    _placed_start = start_time - _borrow
                    full_room = max(0.2, next_start - _placed_start - 0.05)
                else:
                    max_slot = max(0.2, end_time - start_time)
                    comfortable_duration = max_slot
                    target_duration = max_slot
                    full_room = max_slot
                    _placed_start = start_time

                final_path = result["path"]

                # Trim leading silence — Fish Audio inline cloning often prepends
                # 0.5-2s of silence before speech, causing perceived lip-sync delay.
                silence_trimmed_path = os.path.join(output_dir, f"segment_{i:04d}_notrim.mp3")
                trimmed_ok = await asyncio.to_thread(
                    self._trim_leading_silence, final_path, silence_trimmed_path
                )
                if trimmed_ok and os.path.exists(silence_trimmed_path):
                    trimmed_dur = await asyncio.to_thread(self._get_audio_duration, silence_trimmed_path)
                    orig_dur = await asyncio.to_thread(self._get_audio_duration, final_path)
                    silence_removed = orig_dur - trimmed_dur
                    if silence_removed > 0.08:  # only swap if >80ms was trimmed
                        logger.info(f"[SILENCE-TRIM] seg {i}: removed {silence_removed:.3f}s leading silence")
                        final_path = silence_trimmed_path

                adjusted_audio_path = os.path.join(output_dir, f"segment_{i:04d}_adjusted.mp3")
                actual_duration = await asyncio.to_thread(self._get_audio_duration, final_path)

                # Feed the raw (pre-stretch, pre-trim) TTS duration back into the
                # per-voice rate calibration so subsequent segments for this voice
                # get a more accurate natural_duration estimate.  Using the raw
                # duration — not the stretched/trimmed one — is what makes the
                # calibration reflect the voice's actual speaking rate.
                update_voice_rate(_voice_key, text, actual_duration)

                # Two-level slot expansion: if TTS overflows the comfortable slot
                # but still fits within the hard ceiling, expand silently rather
                # than trimming — preserves breathing room for short speech, avoids
                # cut-offs for translations that run long. Use full_room (bidirectional)
                # so split sub-segments can borrow time from the gap before them.
                if actual_duration > target_duration:
                    target_duration = min(actual_duration, full_room)

                # --- Hard-fit: TTS audio NEVER overflows into the next segment ---
                #
                # start_time is the word-level first-word timestamp (Whisper
                # words[0].start from transcribe_audio._segments_to_dicts).
                # target_duration = next_segment.word_start - this.word_start - 50ms
                # so the window is tight and precise.
                #
                # Two-stage enforcement:
                #   1. Time-stretch (rubberband, atempo fallback) for any overflow
                #      past the window — see the tolerance note below. Fit target
                #      is full_room (bidirectional window), not max_slot
                #      (forward-only), so split sub-segments with contiguous
                #      windows can use surrounding gaps.
                #   2. Hard-trim as an absolute guarantee — but only past a wider
                #      tolerance (the capped-stretch case), never inside it. When
                #      even _FIT_MAX_SPEED can't fit the line, a short run-on is
                #      the lesser evil next to cutting words off.
                #
                # The atempo tolerance is ~0 (just the 50ms buffer already inside
                # _fit_target): full_room extends to the next segment's word start,
                # so ANY accepted overrun lands on top of the next line's speech —
                # audible double-voice overlap in back-to-back dialogue. The old
                # 0.3s tolerance assumed the run-on lands in a gap; it doesn't.
                # Overruns now take a mild stretch (the regen path already
                # speed-fits within tolerance rather than accepting overlap).
                _fish_speed_was_applied = raw.get("fish_speed_applied", False)
                _atempo_tolerance = 0.05
                _trim_tolerance = 0.3
                _speed_applied = 1.0
                _fit_target = full_room
                if actual_duration > _fit_target + _atempo_tolerance and _fit_target > 0.2:
                    _speed_applied = actual_duration / _fit_target
                    # Anti-truncation (step 2 — speed): fit by speeding up to the FIT
                    # cap (higher than the natural-translation cap) so we keep all the
                    # words. Only if even this can't fit does the hard-trim below fire.
                    if _speed_applied > self._FIT_MAX_SPEED:
                        logger.warning(
                            f"[FIT] seg={i} needs {_speed_applied:.2f}x speedup "
                            f"(exceeds fit cap {self._FIT_MAX_SPEED}) — "
                            f"capping at {self._FIT_MAX_SPEED}x; slot may hard-trim remainder"
                        )
                    adjusted = await asyncio.to_thread(
                        self._adjust_audio_duration,
                        final_path, adjusted_audio_path, _fit_target,
                        min_speed=MIN_SPEED_RATIO, max_speed=self._FIT_MAX_SPEED,
                    )
                    if adjusted and os.path.exists(adjusted_audio_path):
                        final_path = adjusted_audio_path
                        actual_duration = await asyncio.to_thread(self._get_audio_duration, final_path)
                    logger.info(
                        f"[FIT] seg={i} stretched {_speed_applied:.2f}x "
                        f"word_start={start_time:.3f}s slot={_fit_target:.2f}s "
                        f"after={actual_duration:.2f}s fish_pre={_fish_speed_was_applied}"
                    )

                # Absolute guarantee — hard-trim to slot boundary. Gated on the
                # wider trim tolerance, so this can only fire on segments atempo
                # already tried and failed to fit (capped at _FIT_MAX_SPEED).
                if actual_duration > _fit_target + _trim_tolerance:
                    trimmed_path = os.path.join(output_dir, f"segment_{i:04d}_trimmed.mp3")
                    trimmed = await asyncio.to_thread(self._trim_audio_duration, final_path, trimmed_path, _fit_target)
                    if trimmed and os.path.exists(trimmed_path):
                        final_path = trimmed_path
                        actual_duration = _fit_target
                        segment["was_truncated"] = True
                        logger.warning(
                            f"[FIT] seg={i} hard-trimmed to {_fit_target:.2f}s "
                            f"(needed {_speed_applied:.2f}x — tail may be cut)"
                        )

                overlap_with_prev = ""
                if audio_segments:
                    prev_end = audio_segments[-1]["end"]
                    if _placed_start < prev_end:
                        overlap_with_prev = f" OVERLAP={prev_end - _placed_start:.3f}s with seg {len(audio_segments)-1}"

                logger.info(
                    f"[TIMING] seg={i} speaker={speaker} "
                    f"transcript=[{start_time:.3f}-{end_time:.3f}] "
                    # slot/delta report the ENFORCED window (_fit_target), not the
                    # comfortable target — those diverged once full_room took over
                    # the fitting, and logging the unenforced one made this line
                    # disagree with [FIT] above it.
                    f"slot={_fit_target:.3f}s "
                    f"tts_dur={actual_duration:.3f}s "
                    f"delta={actual_duration - _fit_target:+.3f}s "
                    f"borrow={start_time - _placed_start:.3f}s "
                    f"placed_at=[{_placed_start:.3f}-{_placed_start + actual_duration:.3f}]"
                    f"{overlap_with_prev}"
                )

                # --- Flag generation ---
                _flags = []
                _adapted = segment.get("adapted_text") or text
                if len(_adapted.split()) >= 2:
                    _conf = segment.get("confidence")
                    if _conf is None or _conf < CONFIDENCE_FLAG_THRESHOLD:
                        _flags.append({
                            "code": "velma_low_confidence",
                            "score": _conf,
                            "threshold": CONFIDENCE_FLAG_THRESHOLD,
                        })
                    _div_score, _div_reason = divergence_scores[i]
                    if _div_score is not None and _div_score < MEANING_DIVERGENCE_THRESHOLD:
                        _flags.append({
                            "code": "meaning_divergence",
                            "score": _div_score,
                            "reason": _div_reason,
                            "threshold": MEANING_DIVERGENCE_THRESHOLD,
                        })

                # Same gain floor as the editor's regenerate path, so a fresh dub
                # and a regenerated segment are levelled identically.
                await asyncio.to_thread(self._ensure_min_loudness, final_path)

                _audio_filename = os.path.basename(final_path)
                audio_segments.append({
                    "transcript_index": i,
                    "text": text,
                    "speaker": speaker,
                    "voice_id": raw.get("voice_id", ""),
                    "speed": raw.get("speed", 1.0),
                    "path": final_path,
                    "audio_url": _audio_filename,
                    "committed_audio_url": _audio_filename,
                    "start": _placed_start,
                    "end": _placed_start + actual_duration,
                    "duration": actual_duration,
                    # The ORIGINAL transcript window, before any borrow or fit.
                    # timing_diagnostics used to write the placed position as
                    # "original_start", so QC's offset check compared a value
                    # with itself and could never fire — drift was invisible.
                    "transcript_start": start_time,
                    "transcript_end": end_time,
                    # The stretch the fit loop actually applied. Without it the
                    # diagnostics recorded tts_duration as the FITTED duration,
                    # making speed_ratio 1.0 by construction: a segment sped to
                    # 1.6x read as perfectly normal.
                    "speed_applied": round(_speed_applied, 3),
                    "velma_emotion": segment.get("velma_emotion"),
                    "velma_accent": segment.get("velma_accent"),
                    "velma_deepfake_score": segment.get("velma_deepfake_score"),
                    "confidence": segment.get("confidence"),
                    "confidence_tier": segment.get("confidence_tier"),
                    "flags": _flags,
                    "flag_status": "unreviewed",
                    "correction_type": None,
                })
                logger.info(f"Generated TTS for segment {i}: {text[:50]}...")
            
            if not audio_segments:
                if not elevenlabs_tts.enabled and not elevenlabs_tts.edge_tts_available:
                    raise RuntimeError(
                        "No audio segments generated. Edge TTS not installed and ElevenLabs API key is missing."
                    )
                if elevenlabs_tts.enabled and not elevenlabs_tts.edge_tts_available:
                    raise RuntimeError(
                        "No audio segments generated. ElevenLabs failed and Edge TTS fallback is unavailable."
                    )
                raise RuntimeError("No audio segments generated. TTS failed for all segments.")

            # --- WRITE TIMING DIAGNOSTICS REPORT ---
            # Include original_start/original_end so analysis can compare
            # placed vs original without needing the raw transcript file.
            timing_report = []
            for idx, seg in enumerate(audio_segments):
                entry = {
                    "index": idx,
                    "speaker": seg["speaker"],
                    "text": seg["text"][:80],
                    "placed_start": round(seg["start"], 3),
                    "placed_end": round(seg["end"], 3),
                    # The true transcript window, not the placed one. Falling
                    # back to the placed value keeps older jobs parseable, but
                    # any job dubbed after this change reports real drift.
                    "original_start": round(seg.get("transcript_start", seg["start"]), 3),
                    "original_end": round(seg.get("transcript_end", seg.get("original_end", seg["end"])), 3),
                    "tts_duration": round(seg["duration"], 3),
                    # What the fit loop actually did. tts_duration above is the
                    # duration AFTER fitting, so QC cannot derive this from the
                    # other fields — it has to be recorded at the source.
                    "speed_applied": round(seg.get("speed_applied", 1.0), 3),
                }
                if idx > 0:
                    prev = audio_segments[idx - 1]
                    gap = seg["start"] - prev["end"]
                    entry["gap_from_prev"] = round(gap, 3)
                    if gap < 0:
                        entry["OVERLAP"] = round(abs(gap), 3)
                timing_report.append(entry)

            report_path = os.path.join(output_dir, "timing_diagnostics.json")
            with open(report_path, "w", encoding="utf-8") as f:
                json.dump(timing_report, f, indent=2, ensure_ascii=False)
            logger.info(f"[TIMING] Diagnostics written to {report_path}")

            merged_audio = os.path.join(output_dir, "dubbed_audio.wav")
            # video_duration already computed above (before gap recovery)

            # Everything between the TTS gather and here is the sequential
            # per-segment fit/trim/loudness pass — the one stage that does not
            # use the box's other cores.
            _stage_t["fit"] = time.monotonic()
            logger.info(
                f"[STAGE] fit/trim (sequential): {_stage_t['fit'] - _stage_t['tts']:.1f}s"
            )

            success = await asyncio.to_thread(
                self._merge_audio_segments,
                audio_segments,
                merged_audio,
                video_duration,
            )
            _stage_t["merge"] = time.monotonic()
            logger.info(
                f"[STAGE] merge: {_stage_t['merge'] - _stage_t['fit']:.1f}s"
            )

            if not success:
                raise RuntimeError("Failed to merge audio segments (ffmpeg error).")

            # accompaniment_path was set earlier from the Demucs run at the top
            output_video = os.path.join(output_dir, f"dubbed_{target_norm}.mp4")
            # Hold the per-job lock while reading scenes, muxing, and writing
            # segments.json so the generated MP4 and the persisted scene layout
            # are guaranteed to agree. A concurrent PUT /scenes cannot slip in
            # between the read and the write.
            lock = await self._get_segments_file_lock(job_id)
            async with lock:
                scenes = self._read_existing_scenes(output_dir) or []
                scenes_moved = any(
                    float(s.get("source_start", s.get("start", 0))) != float(s.get("start", 0)) or
                    float(s.get("source_end", s.get("end", 0))) != float(s.get("end", 0))
                    for s in scenes
                )
                if scenes_moved:
                    if accompaniment_path:
                        logger.warning("[DUB] Scenes have been moved; separated accompaniment is not yet supported in scene-based mux. Using dubbed audio only.")
                    success = await asyncio.to_thread(
                        self._replace_audio_in_video_with_scenes, video_path, merged_audio, output_video, scenes,
                    )
                else:
                    success = await asyncio.to_thread(
                        self._replace_audio_in_video, video_path, merged_audio, output_video,
                        accompaniment_path, scenes,
                    )
                if not success:
                    raise RuntimeError("Failed to mux dubbed audio into the video (ffmpeg error).")
                payload = await asyncio.to_thread(
                    self._write_segments_json_locked,
                    job_id, target_norm, audio_segments, output_dir, scenes,
                    video_path=video_path,
                    accompaniment_path=accompaniment_path,
                    video_duration=video_duration,
                )

            _stage_t["mux"] = time.monotonic()
            logger.info(
                f"[STAGE] mux: {_stage_t['mux'] - _stage_t['merge']:.1f}s"
            )
            logger.info(
                f"[STAGE-SUMMARY] tts={_stage_t['tts'] - _stage_t['start']:.1f}s "
                f"fit={_stage_t['fit'] - _stage_t['tts']:.1f}s "
                f"merge={_stage_t['merge'] - _stage_t['fit']:.1f}s "
                f"mux={_stage_t['mux'] - _stage_t['merge']:.1f}s "
                f"total={_stage_t['mux'] - _stage_t['start']:.1f}s "
                f"segments={len(transcript)}"
            )

            logger.info(f"Dubbed video created: {output_video}")
            engine_summary = "unknown"
            if tts_engines:
                unique_engines = set(tts_engines)
                if len(unique_engines) == 1:
                    engine_summary = next(iter(unique_engines))
                else:
                    engine_summary = "mixed"
            try:
                from app.services.supabase_client import upsert_segments
                asyncio.create_task(upsert_segments(job_id, payload["segments"]))
            except Exception:
                pass
            return {
                "output_path": output_video,
                "tts_engine": engine_summary,
                "segment_engines": segment_engines,
            }
                
        except Exception as e:
            logger.exception(f"Dubbing error: {e}")
            raise
    
    def _recover_gaps_from_vocals(
        self,
        transcript: List[Dict],
        vocals_path: str,
        duration: float,
        character_roster: list | None = None,
    ) -> List[Dict]:
        """
        Use Demucs-separated vocals to recover dialogue in gaps where VAD
        missed speech mixed with SFX (fight scenes).

        Loads the separated vocals WAV, resamples to 16kHz mono, finds gaps
        >5s in the transcript, runs Whisper without VAD on those gaps, and
        merges recovered segments back.

        Returns the augmented transcript (original + recovered segments).
        """
        import os as _os
        gap_threshold = float(_os.getenv("VAD_GAP_THRESHOLD", "5.0"))

        if not vocals_path or not _os.path.exists(vocals_path):
            logger.info("[VOCAL-GAP] No separated vocals available, skipping gap recovery")
            return transcript

        try:
            import numpy as np
            import soundfile as sf
            from faster_whisper import WhisperModel

            # Load separated vocals and convert to 16kHz mono for Whisper
            data, sr = sf.read(vocals_path, always_2d=True)
            # Stereo → mono
            if data.shape[1] > 1:
                data = data.mean(axis=1)
            else:
                data = data[:, 0]
            data = data.astype(np.float32)

            # Resample to 16kHz if needed
            if sr != 16000:
                # Use FFmpeg for reliable resampling
                import subprocess, tempfile
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                    tmp_path = tmp.name
                cmd = [
                    "ffmpeg", "-y", "-i", vocals_path,
                    "-ar", "16000", "-ac", "1", "-f", "wav", tmp_path,
                ]
                subprocess.run(cmd, capture_output=True, timeout=60)
                data, sr = sf.read(tmp_path)
                data = data.astype(np.float32)
                try:
                    _os.unlink(tmp_path)
                except OSError:
                    pass

            # Normalize amplitude
            max_val = np.abs(data).max()
            if max_val > 0:
                data = data / max_val

            # Find gaps in transcript
            segments_sorted = sorted(transcript, key=lambda s: float(s.get("start", 0)))
            gaps = []
            # Gap before first segment
            if segments_sorted and float(segments_sorted[0].get("start", 0)) > gap_threshold:
                gaps.append((0.0, float(segments_sorted[0]["start"])))
            # Gaps between segments
            for i in range(len(segments_sorted) - 1):
                gap_start = float(segments_sorted[i].get("end", 0))
                gap_end = float(segments_sorted[i + 1].get("start", 0))
                if gap_end - gap_start > gap_threshold:
                    gaps.append((gap_start, gap_end))
            # Gap after last segment
            if segments_sorted and duration - float(segments_sorted[-1].get("end", 0)) > gap_threshold:
                gaps.append((float(segments_sorted[-1]["end"]), duration))

            if not gaps:
                logger.info("[VOCAL-GAP] No gaps > {:.1f}s found in transcript".format(gap_threshold))
                return transcript

            logger.info(
                f"[VOCAL-GAP] Found {len(gaps)} gap(s) > {gap_threshold}s: "
                f"{[(round(s,1), round(e,1)) for s, e in gaps]}"
            )

            # Run Whisper on separated vocals for each gap
            import torch as _torch_gpu
            _dv = "cuda" if _torch_gpu.cuda.is_available() else "cpu"
            _ct = "float16" if _dv == "cuda" else "int8"
            model_size = _os.getenv("WHISPER_MODEL", "small")
            model = WhisperModel(model_size, device=_dv, compute_type=_ct)

            # Detect original transcript language for filtering hallucinations
            orig_lang = None
            for seg in segments_sorted:
                t = seg.get("text", "")
                if t and len(t) > 2:
                    # Simple heuristic: if text has CJK chars, it's Chinese/Japanese/Korean
                    import re as _re
                    has_cjk = bool(_re.search(r'[\u4e00-\u9fff]', t))
                    has_latin = bool(_re.search(r'[a-zA-Z]{3,}', t))
                    if has_cjk:
                        orig_lang = "cjk"
                    elif has_latin:
                        orig_lang = "latin"
                    break

            recovered = []
            sample_rate = 16000
            for gap_start, gap_end in gaps:
                start_sample = int(gap_start * sample_rate)
                end_sample = int(gap_end * sample_rate)
                gap_waveform = data[start_sample:end_sample]
                if len(gap_waveform) < 1600:  # <0.1s
                    continue

                # Skip near-silent gaps — Whisper hallucinates on silence.
                # Threshold 0.03 rejects fight-scene residual noise that
                # Demucs didn't fully remove from the vocal track.
                rms = float(np.sqrt(np.mean(gap_waveform ** 2)))
                if rms < 0.03:
                    logger.info(
                        f"[VOCAL-GAP] Skipping gap {gap_start:.1f}-{gap_end:.1f}s "
                        f"(RMS={rms:.6f}, too quiet)"
                    )
                    continue

                logger.info(
                    f"[VOCAL-GAP] Transcribing gap {gap_start:.1f}s-{gap_end:.1f}s "
                    f"({gap_end - gap_start:.1f}s, RMS={rms:.4f}) using separated vocals"
                )
                from app.pipeline.transcribe_audio import build_initial_prompt
                gap_gen, _ = model.transcribe(
                    gap_waveform,
                    beam_size=5,
                    condition_on_previous_text=False,
                    initial_prompt=build_initial_prompt(character_roster),
                )
                for seg in gap_gen:
                    text = seg.text.strip()
                    if not text or len(text) <= 1:
                        continue
                    dur = seg.end - seg.start
                    # Vocal gap recovery uses separated vocals which still have
                    # residual noise.  Use 0.3s minimum to capture short phrases
                    # like "Good", "Okay", "I'm fine" that are critical dialogue.
                    # The confidence filter below handles false positives.
                    if dur < 0.3:
                        logger.info(
                            f"[VOCAL-GAP] Rejected too-short segment ({dur:.2f}s): {text[:40]}"
                        )
                        continue
                    avg_logprob = getattr(seg, "avg_logprob", 0)
                    if avg_logprob < -1.0:
                        logger.info(
                            f"[VOCAL-GAP] Rejected low-confidence segment "
                            f"(logprob={avg_logprob:.2f}): {text[:40]}"
                        )
                        continue

                    # Reject single CJK characters — common Whisper
                    # hallucinations from fight-scene residual noise.
                    # Allow 2+ char phrases like 好啊 (Sure), 大哥 (Brother),
                    # 我付 (I'll pay) — these are real short dialogue.
                    import re as _re
                    cjk_chars = _re.findall(r'[\u4e00-\u9fff]', text)
                    if len(cjk_chars) <= 1 and len(text.strip()) <= 2:
                        logger.info(
                            f"[VOCAL-GAP] Rejected single CJK char: '{text}' "
                            f"at {seg.start + gap_start:.1f}s"
                        )
                        continue

                    # Language consistency filter: reject wrong-script hallucinations
                    has_cjk = len(cjk_chars) > 0
                    has_latin = bool(_re.search(r'[a-zA-Z]{3,}', text))
                    if orig_lang == "cjk" and has_latin and not has_cjk:
                        logger.info(
                            f"[VOCAL-GAP] Rejected wrong-language hallucination: {text}"
                        )
                        continue
                    if orig_lang == "latin" and has_cjk and not has_latin:
                        logger.info(
                            f"[VOCAL-GAP] Rejected wrong-language hallucination: {text}"
                        )
                        continue

                    recovered.append({
                        "start": round(seg.start + gap_start, 3),
                        "end": round(seg.end + gap_start, 3),
                        "text": text,
                        "speaker": "speaker-1",  # default — will be refined by stabilizer
                    })

            # Deduplicate: remove consecutive segments with identical text
            if recovered:
                deduped = [recovered[0]]
                for seg in recovered[1:]:
                    if seg["text"] != deduped[-1]["text"]:
                        deduped.append(seg)
                    else:
                        logger.info(
                            f"[VOCAL-GAP] Deduped repeated: {seg['text'][:40]} "
                            f"at {seg['start']:.1f}s"
                        )
                recovered = deduped

            # Deduplicate against existing transcript: reject recovered segments
            # whose text already appears in (or is a substring of) the original
            # transcript.  This prevents duplicates like "Master Jin, are you
            # okay?" appearing at both 96s (inside a merged segment) and 145s
            # (from gap recovery).
            existing_texts = []
            for seg in transcript:
                t = seg.get("text", "").strip()
                if t:
                    existing_texts.append(t)
            before_dedup = len(recovered)
            deduped_recovered = []
            for seg in recovered:
                rec_text = seg["text"].strip()
                is_dup = False
                for et in existing_texts:
                    # Check both exact match and substring containment
                    if rec_text == et or rec_text in et or et in rec_text:
                        logger.info(
                            f"[VOCAL-GAP] Rejected duplicate of existing transcript: "
                            f"'{rec_text[:50]}' at {seg['start']:.1f}s "
                            f"(matches: '{et[:50]}')"
                        )
                        is_dup = True
                        break
                if not is_dup:
                    deduped_recovered.append(seg)
            recovered = deduped_recovered
            if len(recovered) < before_dedup:
                logger.info(
                    f"[VOCAL-GAP] Removed {before_dedup - len(recovered)} duplicate(s) "
                    f"already in transcript"
                )

            if not recovered:
                logger.info("[VOCAL-GAP] No valid segments recovered from vocals")
                return transcript

            logger.info(
                f"[VOCAL-GAP] Recovered {len(recovered)} segment(s) from separated vocals"
            )
            for seg in recovered:
                logger.info(
                    f"[VOCAL-GAP]   {seg['start']:.1f}-{seg['end']:.1f}: "
                    f"{seg['text'][:80]}"
                )

            # Merge recovered segments into transcript
            augmented = list(transcript) + recovered
            augmented.sort(key=lambda s: float(s.get("start", 0)))
            logger.info(
                f"[VOCAL-GAP] Transcript augmented: {len(transcript)} → {len(augmented)} segments"
            )
            return augmented

        except Exception as e:
            logger.warning(f"[VOCAL-GAP] Gap recovery failed: {e}", exc_info=True)
            return transcript

    def _get_video_duration(self, video_path: str) -> float:
        try:
            result = subprocess.run(
                [
                    "ffprobe", "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "json", video_path
                ],
                capture_output=True,
                text=True,
            )
            data = json.loads(result.stdout)
            return float(data["format"]["duration"])
        except Exception as e:
            logger.error(f"Failed to get video duration: {e}")
            return 0.0

    def _get_video_info(self, video_path: str) -> Dict[str, Any]:
        """Return width, height, fps, duration for a video file."""
        defaults = {"width": 1920, "height": 1080, "fps": 24.0, "duration": 0.0}
        try:
            result = subprocess.run(
                [
                    "ffprobe", "-v", "error",
                    "-select_streams", "v:0",
                    "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate,duration",
                    "-show_entries", "format=duration",
                    "-of", "json", video_path
                ],
                capture_output=True,
                text=True,
            )
            data = json.loads(result.stdout)
            stream = data.get("streams", [{}])[0]
            fmt = data.get("format", {})
            width = int(stream.get("width", 1920))
            height = int(stream.get("height", 1080))
            fps_str = stream.get("r_frame_rate") or stream.get("avg_frame_rate") or "24/1"
            num, den = fps_str.split("/")
            fps = float(num) / float(den) if float(den) else 24.0
            duration = float(stream.get("duration") or fmt.get("duration") or 0.0)
            return {"width": width, "height": height, "fps": fps, "duration": duration}
        except Exception as e:
            logger.warning(f"Failed to probe video info: {e}")
            return defaults

    def _ensure_min_loudness(self, audio_path: str) -> bool:
        """Raise a too-quiet segment to a usable floor. BOOST ONLY — never cuts.

        Fish sometimes renders a line far below its neighbours: measured on a
        real job, "Master please dont be angry" came back at -31.24 LUFS with a
        true peak of -14.98 dBTP, sitting 16.5 dB under the loudest line in the
        same scene. That is not a quiet performance — 15 dB of headroom is
        simply unused, and the line is inaudible under the music. Delivery tags
        do not fix it: asking for [raised voice] produced a QUIETER take.

        So level it deterministically instead of negotiating with the model.
        A segment already at or above the floor is left completely untouched,
        which keeps a shout louder than a whisper — this levels the broken-quiet
        outliers, it does not compress the performance.

        The boost is additionally capped so true peak never exceeds TP_CEILING,
        so a quiet-but-peaky clip cannot be driven into clipping.

        Returns True if gain was applied, False if untouched or on any failure
        (failure is non-fatal — the original file is left exactly as it was).
        """
        floor = float(os.getenv("DUBBING_SEGMENT_FLOOR_LUFS", "-20"))
        tp_ceiling = float(os.getenv("DUBBING_SEGMENT_TP_CEILING", "-1.5"))
        try:
            probe = subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-nostats", "-i", audio_path,
                    "-af", "loudnorm=print_format=json", "-f", "null", "-",
                ],
                capture_output=True, text=True,
            )
            blob = re.search(r'\{[^{}]*"input_i"[^{}]*\}', probe.stderr, re.S)
            if not blob:
                return False
            m = json.loads(blob.group(0))
            cur_i = float(m["input_i"])
            cur_tp = float(m["input_tp"])
        except Exception as exc:
            logger.warning(f"[GAIN] measure failed for {os.path.basename(audio_path)}: {exc}")
            return False

        # -inf / nan on a silent or unmeasurable clip — nothing to raise.
        if not math.isfinite(cur_i) or not math.isfinite(cur_tp):
            return False
        if cur_i >= floor:
            return False

        gain_db = min(floor - cur_i, tp_ceiling - cur_tp)
        if gain_db <= 0.1:  # nothing meaningful left after the peak cap
            return False

        tmp = audio_path + ".gain.mp3"
        try:
            res = subprocess.run(
                [
                    "ffmpeg", "-y", "-hide_banner", "-nostats", "-i", audio_path,
                    "-filter:a", f"volume={gain_db:.2f}dB",
                    "-c:a", "libmp3lame", "-b:a", "192k", tmp,
                ],
                capture_output=True, text=True,
            )
            if res.returncode != 0 or not os.path.exists(tmp):
                logger.warning(f"[GAIN] apply failed: {res.stderr[:200]}")
                return False
            shutil.move(tmp, audio_path)
            logger.info(
                f"[GAIN] {os.path.basename(audio_path)}: {cur_i:.2f} LUFS "
                f"(TP {cur_tp:.2f}) +{gain_db:.2f} dB -> ~{cur_i + gain_db:.2f} LUFS"
            )
            return True
        except Exception as exc:
            logger.warning(f"[GAIN] apply error: {exc}")
            return False
        finally:
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass

    def _get_audio_duration(self, audio_path: str) -> float:
        """
        Return duration in seconds.

        Strategy (correct-and-fast first):
        1. soundfile.info() — header read, no decode, no subprocess. With
           libsndfile >= 1.1 this covers MP3 too and, crucially, reports the
           TRUE duration of variable-bitrate MP3s.
        2. ffprobe subprocess — correct for any format soundfile can't open.
        3. Pure-Python CBR frame estimate — LAST RESORT ONLY, logged loudly.

        History (2026-07-21): MP3 previously went straight to the pure-Python
        frame scan (_mp3_duration_fast), which assumes CONSTANT bitrate and
        derives duration from (file_size * 8 / first_frame_bitrate). Fish
        Audio emits VARIABLE-bitrate MP3, so that under-reported every clip to
        ~60% of its real length (verified: 1.411s stored vs 2.352s real). That
        wrong duration then drove the slot-fit and the frontend auto-shrink to
        pull each segment's slot down to ~60% of its audio, cutting off the end
        of every segment on rebuild. Never trust a CBR estimate for VBR MP3.
        """
        try:
            ext = os.path.splitext(audio_path)[1].lower()

            # --- soundfile: correct for WAV/FLAC/OGG/AIFF and (libsndfile>=1.1) MP3,
            #     including VBR MP3. Header-only, ~0ms. ---
            if ext in (".wav", ".flac", ".ogg", ".aiff", ".aif", ".mp3"):
                try:
                    import soundfile as _sf
                    info = _sf.info(audio_path)
                    if info.duration and info.duration > 0:
                        return float(info.duration)
                except Exception:
                    # e.g. older libsndfile without MP3 support — fall through.
                    pass

            # --- ffprobe: correct for VBR, used when soundfile can't open the file ---
            try:
                result = subprocess.run(
                    [
                        "ffprobe", "-v", "error",
                        "-show_entries", "format=duration",
                        "-of", "json", audio_path,
                    ],
                    capture_output=True,
                    text=True,
                )
                if result.returncode == 0:
                    data = json.loads(result.stdout)
                    d = float(data["format"]["duration"])
                    if d > 0:
                        return d
            except Exception:
                pass

            # --- last resort: pure-Python CBR estimate. WRONG for VBR MP3 —
            #     only reached when neither soundfile nor ffprobe is available. ---
            if ext == ".mp3":
                dur = self._mp3_duration_fast(audio_path)
                if dur > 0:
                    logger.warning(
                        f"[AUDIO-DUR] soundfile+ffprobe unavailable; falling back to "
                        f"unreliable CBR estimate for {audio_path}: {dur:.3f}s "
                        f"(may under-report VBR MP3)"
                    )
                    return dur

            return 0.0

        except Exception as e:
            logger.error(f"Failed to get audio duration: {e}")
            return 0.0

    @staticmethod
    def _apply_pitch_shift(input_path: str, output_path: str, n_steps: float) -> bool:
        """Shift audio pitch by n_steps semitones using librosa.

        Preserves duration.  Falls back to ffmpeg rubberband if librosa
        is not available.  Returns True on success.
        """
        try:
            import librosa
            import soundfile as sf

            y, sr = librosa.load(input_path, sr=None, mono=True)
            y_shifted = librosa.effects.pitch_shift(y, sr=sr, n_steps=n_steps)
            sf.write(output_path, y_shifted, sr, format="MP3")
            return True
        except ImportError:
            logger.warning("librosa not available for pitch shift; trying ffmpeg rubberband")
        except Exception as e:
            logger.warning(f"librosa pitch shift failed: {e}")

        # Fallback: ffmpeg arubberband (formant-preserving pitch shift)
        try:
            # rubberband transpose=semitones (formant=preserved — see _adjust_audio_duration)
            rb_filter = f"rubberband=pitch={n_steps:.1f}:formant=preserved"
            cmd = ["ffmpeg", "-y", "-i", input_path, "-filter:a", rb_filter, "-vn", output_path]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                return True
            logger.warning(f"ffmpeg rubberband pitch shift failed: {result.stderr[-200:]}")
        except Exception as e:
            logger.warning(f"ffmpeg pitch shift fallback failed: {e}")
        return False

    @staticmethod
    async def _apply_atempo(input_path: str, output_path: str, speed: float) -> bool:
        """Change playback rate without altering pitch.

        ffmpeg's atempo accepts 0.5-2.0 per instance; callers clamp use_speed to
        exactly that range (see regenerate_segment), so one stage suffices.
        """
        try:
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-y", "-hide_banner", "-nostats", "-loglevel", "error",
                "-i", input_path, "-filter:a", f"atempo={speed:.4f}", "-vn", output_path,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            if proc.returncode != 0:
                logger.warning(f"atempo failed: {stderr.decode('utf-8', 'replace')[-200:]}")
                return False
            return os.path.exists(output_path) and os.path.getsize(output_path) > 0
        except Exception as e:
            logger.warning(f"atempo error: {e}")
            return False

    @staticmethod
    def _mp3_duration_fast(path: str) -> float:
        """
        Estimate MP3 duration by reading the first valid MPEG frame header and
        using (file_size - ID3_size) / bitrate.  Runs in pure Python with no
        subprocess.  Returns 0.0 on any parse failure so the caller can fall
        back to ffprobe.
        """
        try:
            with open(path, "rb") as f:
                data = f.read(10)
                if len(data) < 10:
                    return 0.0

                # Skip ID3v2 tag if present
                id3_size = 0
                if data[:3] == b"ID3":
                    raw = data[6:10]
                    id3_size = (
                        ((raw[0] & 0x7F) << 21)
                        | ((raw[1] & 0x7F) << 14)
                        | ((raw[2] & 0x7F) << 7)
                        | (raw[3] & 0x7F)
                    ) + 10

                f.seek(id3_size)
                # Scan up to 4 KB for a sync word
                scan = f.read(4096)

            file_size = os.path.getsize(path)
            audio_size = file_size - id3_size

            # Find sync word (0xFF 0xEx or 0xFF 0xFx)
            for i in range(len(scan) - 3):
                b0, b1 = scan[i], scan[i + 1]
                if b0 == 0xFF and (b1 & 0xE0) == 0xE0:
                    # MPEG version
                    mpeg_ver = (b1 >> 3) & 0x03
                    # Bitrate index
                    br_idx = (scan[i + 2] >> 4) & 0x0F
                    # Sample rate index
                    sr_idx = (scan[i + 2] >> 2) & 0x03

                    # Bitrate table (MPEG1 Layer3 only — covers 99% of real MP3s)
                    br_table = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
                    sr_table_v1 = [44100, 48000, 32000, 0]

                    if br_idx == 0 or br_idx == 15:
                        continue
                    if sr_idx == 3:
                        continue

                    bitrate = br_table[br_idx] * 1000
                    if bitrate <= 0:
                        continue

                    if mpeg_ver == 3:  # MPEG1
                        sample_rate = sr_table_v1[sr_idx]
                    else:
                        sample_rate = sr_table_v1[sr_idx] // (1 if mpeg_ver == 2 else 2)

                    if sample_rate <= 0:
                        continue

                    return audio_size * 8 / bitrate

            return 0.0
        except Exception:
            return 0.0
    
    # Whether ffmpeg was built with librubberband (detected once at startup).
    _rubberband_available: Optional[bool] = None

    @classmethod
    def _check_rubberband(cls) -> bool:
        """Return True if ffmpeg supports arubberband (librubberband linked in)."""
        if cls._rubberband_available is not None:
            return cls._rubberband_available
        try:
            probe = subprocess.run(
                ["ffmpeg", "-filters"],
                capture_output=True, text=True, timeout=10
            )
            # ffmpeg ≤6.x exposed the filter as "arubberband"; ffmpeg 7.x renamed it to "rubberband".
            # "rubberband" is a substring of "arubberband" so this check works on both.
            cls._rubberband_available = "rubberband" in probe.stdout
        except Exception:
            cls._rubberband_available = False
        logger.info(f"[TIME-STRETCH] rubberband={'available' if cls._rubberband_available else 'not available, using atempo'}")
        return cls._rubberband_available

    def _adjust_audio_duration(
        self,
        input_path: str,
        output_path: str,
        target_duration: float,
        min_speed: float = 0.5,
        max_speed: float = 2.0,
    ) -> bool:
        """Time-stretch audio to fit target_duration.

        Uses arubberband (formant-preserving, phase-vocoder) when available.
        Falls back to atempo (simpler but sounds robotic above 1.3×).
        """
        try:
            actual_duration = self._get_audio_duration(input_path)

            if actual_duration <= 0 or target_duration <= 0:
                return False

            speed_factor = actual_duration / target_duration

            if speed_factor < min_speed:
                speed_factor = min_speed
                logger.warning(f"Speed factor clamped to minimum: {min_speed}")
            elif speed_factor > max_speed:
                speed_factor = max_speed
                logger.warning(f"Speed factor clamped to maximum: {max_speed}")

            if 0.95 <= speed_factor <= 1.05:
                shutil.copy(input_path, output_path)
                return True

            use_rubberband = self._check_rubberband()

            if use_rubberband:
                # arubberband: formant=preserved keeps voice resonance during stretch.
                # smoothing=on reduces phasing artefacts at >1.3×.
                # transients=crisp keeps consonant clarity.
                rb_filter = (
                    f"rubberband=tempo={speed_factor:.4f}"
                    # ffmpeg's rubberband wrapper takes formant=shifted|preserved,
                    # not on/off — formant=on is rejected as an invalid argument and
                    # silently dropped every stretch to the atempo fallback.
                    ":formant=preserved:smoothing=on:transients=crisp"
                )
                cmd = ["ffmpeg", "-y", "-i", input_path, "-filter:a", rb_filter, "-vn", output_path]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                if result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                    logger.info(
                        f"[RUBBERBAND] {speed_factor:.2f}× "
                        f"({actual_duration:.2f}s → {target_duration:.2f}s)"
                    )
                    return True
                # rubberband failed despite being available — fall through to atempo
                logger.warning(f"[RUBBERBAND] failed ({result.stderr[-200:]}), falling back to atempo")

            # atempo fallback — must stay in (0.5, 2.0); chain for larger ratios
            if speed_factor > 2.0:
                atempo_filter = f"atempo=2.0,atempo={speed_factor / 2.0:.4f}"
            elif speed_factor < 0.5:
                atempo_filter = f"atempo=0.5,atempo={speed_factor / 0.5:.4f}"
            else:
                atempo_filter = f"atempo={speed_factor:.4f}"

            cmd = ["ffmpeg", "-y", "-i", input_path, "-filter:a", atempo_filter, "-vn", output_path]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)

            if result.returncode != 0:
                logger.error(f"[ATEMPO] error: {result.stderr[-200:]}")
                return False

            logger.info(
                f"[ATEMPO] {speed_factor:.2f}× "
                f"({actual_duration:.2f}s → {target_duration:.2f}s)"
            )
            return os.path.exists(output_path)

        except Exception as e:
            logger.error(f"Audio duration adjustment error: {e}")
            return False

    def _trim_leading_silence(
        self,
        input_path: str,
        output_path: str,
        silence_threshold_db: float = -40.0,
        min_silence_duration: float = 0.1,
    ) -> bool:
        """Remove leading silence from a TTS audio file.
        Fish Audio inline cloning often prepends 0.5-2s of silence before speech.
        Only trims if >100ms of silence is detected so normal attack isn't clipped.
        """
        try:
            cmd = [
                "ffmpeg", "-y",
                "-i", input_path,
                "-af", (
                    f"silenceremove=start_periods=1"
                    f":start_silence={min_silence_duration}"
                    f":start_threshold={silence_threshold_db}dB"
                ),
                "-ar", "44100",
                "-ac", "2",
                output_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                return False
            # Sanity: if output is empty or shorter than 0.1s, keep original
            if not os.path.exists(output_path):
                return False
            return True
        except Exception as e:
            logger.error(f"Leading silence trim error: {e}")
            return False

    def _trim_audio_duration(
        self,
        input_path: str,
        output_path: str,
        target_duration: float,
    ) -> bool:
        try:
            if target_duration <= 0:
                return False
            cmd = [
                "ffmpeg", "-y",
                "-i", input_path,
                "-t", f"{target_duration:.3f}",
                "-ar", "44100",
                "-ac", "2",
                output_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                logger.error(f"FFmpeg trim error: {result.stderr}")
                return False
            return os.path.exists(output_path)
        except Exception as e:
            logger.error(f"Audio trim error: {e}")
            return False
    
    def _merge_audio_segments_mixdown(
        self,
        segments: List[Dict],
        output_path: str,
        total_duration: float,
    ) -> bool:
        """Linear-time mixdown: decode each segment to PCM and sum it into a
        preallocated buffer at its placed offset, then one loudnorm pass.

        Replaces the N-input ffmpeg amix for large segment counts — the
        filter-graph cost of that path grows superlinearly (840 inputs took
        ~40 minutes of single-core CPU on a 105-minute film). Segments are
        non-overlapping by construction (the fit loop guarantees it), so
        summing is exact — same as amix normalize=0.

        Memory: duration * 44.1k * 2ch * 4B (~2.3 GB at 2 hours) — fine on
        the 24 GB container, and this path is what makes feature-length
        merges complete in minutes instead of most of an hour.
        """
        import numpy as np
        import soundfile as sf
        from concurrent.futures import ThreadPoolExecutor

        segments_sorted = sorted(segments, key=lambda x: x["start"])
        if not segments_sorted:
            return False

        sr = 44100
        total_samples = int(total_duration * sr) + sr  # 1s headroom
        mix = np.zeros((total_samples, 2), dtype=np.float32)

        def _decode(path: str) -> Optional["np.ndarray"]:
            cmd = [
                "ffmpeg", "-v", "error", "-i", path,
                "-f", "f32le", "-acodec", "pcm_f32le",
                "-ar", str(sr), "-ac", "2", "-",
            ]
            proc = subprocess.run(cmd, capture_output=True)
            if proc.returncode != 0 or not proc.stdout:
                logger.warning(f"[MERGE] decode failed for {path}")
                return None
            data = np.frombuffer(proc.stdout, dtype=np.float32)
            if data.size % 2:
                data = data[:-1]
            return data.reshape(-1, 2)

        # Decodes are subprocess-bound — run a bounded pool so 839 files cost
        # seconds, not a minute each in series.
        paths = [seg["path"] for seg in segments_sorted]
        with ThreadPoolExecutor(max_workers=8) as pool:
            decoded = list(pool.map(_decode, paths))

        # Overlap-derived crossfades. Mirrors computeFades in lib/rpt-engine.ts —
        # the preview and the export have to reach the same answer or the film does
        # not sound like what was approved.
        #
        # Hand-set fades alone are not enough: overlap is a TIMING TECHNIQUE here,
        # used to tuck one line under the next, and it is normally applied by
        # dragging segments rather than by dragging fade handles. Summing two
        # full-level speech signals in the overlap is louder than either and can
        # clip; it reads as two people talking over each other, which is exactly
        # what the crossfade exists to avoid.
        #
        # Measured from where the audio ACTUALLY ends (start + decoded length),
        # never from the slot: a segment whose audio is shorter than its slot has
        # no acoustic overlap to blend, and fading it would dip a tail that had
        # already finished.
        _extents = []
        for _i, (_seg, _data) in enumerate(zip(segments_sorted, decoded)):
            if _data is None or not len(_data):
                continue
            _st = float(_seg["start"])
            _off = int(round(_st * sr))
            _en = min(_off + len(_data), total_samples)
            if _en <= _off:
                continue
            _extents.append((_i, _st, _st + (_en - _off) / sr))
        _extents.sort(key=lambda e: e[1])

        _auto_fade: Dict[int, List[float]] = {}
        for _k in range(len(_extents) - 1):
            _ai, _a_start, _a_end = _extents[_k]
            _bi, _b_start, _b_end = _extents[_k + 1]
            _overlap = _a_end - _b_start
            if _overlap <= 0.001:
                continue
            # Both sides of one overlap must use the SAME length, or the curves stop
            # being complementary and their sum dips or peaks in the middle. Capped
            # by each segment, so a short line beside a long overlap is not faded
            # across its whole duration.
            _n = min(_overlap, _a_end - _a_start, _b_end - _b_start)
            if _n <= 0:
                continue
            # Explicitly create keys before the RHS runs. The one-liner
            # `_auto_fade.setdefault(...)[...] = max(_auto_fade[...][...], ...)`
            # evaluates the value (RHS) before the target setdefault, so a missing
            # key raises KeyError. This path hit segment index 172 in production.
            if _ai not in _auto_fade:
                _auto_fade[_ai] = [0.0, 0.0]
            if _bi not in _auto_fade:
                _auto_fade[_bi] = [0.0, 0.0]
            _auto_fade[_ai][1] = max(_auto_fade[_ai][1], _n)
            _auto_fade[_bi][0] = max(_auto_fade[_bi][0], _n)

        for _idx, (seg, data) in enumerate(zip(segments_sorted, decoded)):
            if data is None or not len(data):
                continue
            offset = int(round(float(seg["start"]) * sr))
            end = min(offset + len(data), total_samples)
            if end <= offset:
                continue

            copy_len = end - offset
            seg_data = data[:copy_len].copy()

            # Apply per-segment fade handles. fade_in/fade_out are seconds, stored
            # in segments.json by the editor. They are independent of overlap — a
            # segment with a long fade_out fades out over its own tail regardless of
            # whether the next line overlaps. When two segments overlap, the fades
            # combine into a crossfade.
            # Greater of hand-set and overlap-derived, per side — the same rule the
            # browser applies. A crossfade the timing needs is never shortened by a
            # smaller manual fade, and a longer manual fade is never cut back by a
            # shorter overlap.
            _auto = _auto_fade.get(_idx, (0.0, 0.0))
            fade_in = max(float(seg.get("fade_in") or 0), float(_auto[0]))
            fade_out = max(float(seg.get("fade_out") or 0), float(_auto[1]))
            if fade_in > 0 or fade_out > 0:
                fi_samples = min(int(round(fade_in * sr)), copy_len)
                # Cap fade-out so it does not overlap the fade-in region.
                fo_samples = min(int(round(fade_out * sr)), copy_len - fi_samples)

                if fi_samples > 0:
                    ramp = np.sin(np.linspace(0, np.pi / 2, fi_samples, dtype=np.float32))
                    seg_data[:fi_samples, 0] *= ramp
                    seg_data[:fi_samples, 1] *= ramp
                if fo_samples > 0:
                    ramp = np.cos(np.linspace(0, np.pi / 2, fo_samples, dtype=np.float32))
                    seg_data[-fo_samples:, 0] *= ramp
                    seg_data[-fo_samples:, 1] *= ramp

            mix[offset:end] += seg_data

        # Match the amix path's output treatment: loudnorm to the same target.
        tmp_raw = output_path + ".raw.wav"
        sf.write(tmp_raw, mix, sr, subtype="PCM_16")
        norm = subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error", "-i", tmp_raw,
                "-af", "loudnorm=I=-16:TP=-1:LRA=11",
                # Truncate to the video duration exactly, as the amix path's
                # `-t` did — the mixdown buffer carries 1s of headroom.
                "-t", str(total_duration),
                "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le",
                output_path,
            ],
            capture_output=True,
        )
        try:
            os.remove(tmp_raw)
        except OSError:
            pass
        if norm.returncode != 0:
            logger.error(f"[MERGE] loudnorm pass failed: {norm.stderr}")
            return False
        logger.info(f"[MERGE] numpy mixdown: {len(segments_sorted)} segments -> {output_path}")
        return os.path.exists(output_path)

    def _merge_audio_segments(
        self,
        segments: List[Dict],
        output_path: str,
        total_duration: float,
    ) -> bool:
        # Fast path first: linear-time numpy mixdown. The ffmpeg amix graph
        # below is superlinear in input count — 840 segments took ~40 minutes
        # on a 105-minute film. The mixdown is linear in total audio size.
        try:
            if self._merge_audio_segments_mixdown(segments, output_path, total_duration):
                return True
            logger.warning("[MERGE] numpy mixdown unavailable/failed — falling back to ffmpeg amix")
        except Exception as e:
            logger.exception(f"[MERGE] mixdown failed ({type(e).__name__}: {e!r}) — falling back to ffmpeg amix")
        try:
            segments_sorted = sorted(segments, key=lambda x: x["start"])
            if not segments_sorted:
                logger.error("No audio segments to merge")
                return False
            
            filter_parts = []
            inputs = []

            # Input 0: silent base track spanning the full video duration
            inputs.extend([
                "-f", "lavfi",
                "-t", str(total_duration),
                "-i", "anullsrc=r=44100:cl=stereo"
            ])

            for i, seg in enumerate(segments_sorted):
                inputs.extend(["-i", seg["path"]])

            # Single N-input amix: silent base + all delayed segments
            n_inputs = 1 + len(segments_sorted)  # base + segments

            # apad whole_dur is in samples, not seconds (FFmpeg docs).
            sample_rate = 44100
            pad_samples = max(1, int(float(total_duration) * sample_rate))

            # Delay each segment to its correct position.
            # normalize=0 means amix sums without dividing — correct here because
            # segments are non-overlapping so at most one is non-silent at any
            # instant.  Do NOT boost volume before amix (old bug: volume=n_inputs
            # with normalize=0 stacked to ~20x gain, causing clipping/distortion).
            # Final loudnorm brings the mix to broadcast level (-16 LUFS, -1 dBTP).
            for i, seg in enumerate(segments_sorted):
                input_idx = i + 1
                delay_ms = int(seg["start"] * 1000)
                slot_dur = max(0.0, float(seg.get("end", 0)) - float(seg.get("start", 0)))
                fade_in = float(seg.get("fade_in") or 0)
                fade_out = float(seg.get("fade_out") or 0)
                fade_filters = []
                if fade_in > 0:
                    fade_filters.append(f"afade=t=in:st=0:d={fade_in:.3f}:curve=qsin")
                if fade_out > 0 and fade_out < slot_dur:
                    st = max(0.0, slot_dur - fade_out)
                    fade_filters.append(f"afade=t=out:st={st:.3f}:d={fade_out:.3f}:curve=qsin")
                fade_chain = ",".join(fade_filters)
                if fade_chain:
                    filter_parts.append(
                        f"[{input_idx}]adelay={delay_ms}|{delay_ms},{fade_chain},apad=whole_dur={pad_samples}[delayed{i}]"
                    )
                else:
                    filter_parts.append(
                        f"[{input_idx}]adelay={delay_ms}|{delay_ms},apad=whole_dur={pad_samples}[delayed{i}]"
                    )
            delayed_labels = "".join(f"[delayed{i}]" for i in range(len(segments_sorted)))
            filter_parts.append(
                f"[0]{delayed_labels}amix=inputs={n_inputs}:duration=first:normalize=0,loudnorm=I=-16:TP=-1:LRA=11[mixout]"
            )

            final_label = "[mixout]"

            filter_complex = ";".join(filter_parts)
            
            cmd = ["ffmpeg", "-y"] + inputs + [
                "-filter_complex", filter_complex,
                "-map", final_label,
                "-t", str(total_duration),
                "-ar", "44100",
                "-ac", "2",
                "-c:a", "pcm_s16le",
                output_path
            ]
            
            logger.info(f"Merging {len(segments_sorted)} audio segments")
            for i, seg in enumerate(segments_sorted):
                logger.info(f"  Segment {i}: start={seg['start']:.2f}s, path={seg['path']}")
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                logger.error(f"FFmpeg merge error: {result.stderr}")
                simple_concat = self._simple_concat_segments(segments_sorted, output_path, total_duration)
                return simple_concat
            
            return os.path.exists(output_path)
            
        except Exception as e:
            logger.exception(f"Merge error: {e}")
            return False
    
    def _simple_concat_segments(
        self,
        segments: List[Dict],
        output_path: str,
        total_duration: float,
    ) -> bool:
        try:
            temp_dir = os.path.dirname(output_path)
            concat_list = os.path.join(temp_dir, "concat_list.txt")
            def _ffmpeg_path(path: str) -> str:
                return Path(path).resolve().as_posix()
            
            with open(concat_list, "w") as f:
                prev_end = 0.0
                for seg in segments:
                    gap = seg["start"] - prev_end
                    if gap > 0.1:
                        silence_file = os.path.join(temp_dir, f"silence_{prev_end:.0f}.mp3")
                        silence_cmd = [
                            "ffmpeg", "-y",
                            "-f", "lavfi",
                            "-i", f"anullsrc=r=44100:cl=stereo",
                            "-t", str(gap),
                            silence_file
                        ]
                        subprocess.run(silence_cmd, capture_output=True)
                        if os.path.exists(silence_file):
                            f.write(f"file '{_ffmpeg_path(silence_file)}'\n")
                    
                    f.write(f"file '{_ffmpeg_path(seg['path'])}'\n")
                    
                    actual_dur = self._get_audio_duration(seg["path"])
                    prev_end = seg["start"] + actual_dur
            
            concat_cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_list,
                "-t", str(total_duration),
                "-ar", "44100",
                "-ac", "2",
            ]
            if output_path.lower().endswith(".wav"):
                concat_cmd += ["-c:a", "pcm_s16le"]
            concat_cmd.append(output_path)
            cmd = concat_cmd
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                logger.error(f"FFmpeg concat error: {result.stderr}")
                return False
            
            return os.path.exists(output_path)
            
        except Exception as e:
            logger.exception(f"Simple concat error: {e}")
            return False
    
    def _replace_audio_in_video(
        self,
        video_path: str,
        audio_path: str,
        output_path: str,
        accompaniment_path: Optional[str] = None,
        scenes: Optional[List[Dict]] = None,
    ) -> bool:
        try:
            def _video_has_audio(path: str) -> bool:
                try:
                    probe = subprocess.run(
                        [
                            "ffprobe", "-v", "error",
                            "-select_streams", "a",
                            "-show_entries", "stream=codec_type",
                            "-of", "json", path
                        ],
                        capture_output=True,
                        text=True,
                    )
                    data = json.loads(probe.stdout or "{}")
                    return bool(data.get("streams"))
                except Exception as err:
                    logger.warning(f"Audio stream probe failed: {err}")
                    return False

            if os.getenv("DUBBING_SKIP_LOUDNORM", "").lower() in ("1", "true", "yes"):
                audio_to_use = audio_path
                logger.info("[MIX] Skipping loudnorm (DUBBING_SKIP_LOUDNORM)")
            else:
                boost_cmd = [
                    "ffmpeg", "-y",
                    "-i", audio_path,
                    "-filter:a", "loudnorm=I=-14:TP=-1.5:LRA=11",
                    "-ar", "44100",
                    "-ac", "2",
                    audio_path + ".normalized.wav",
                ]
                boost_result = subprocess.run(boost_cmd, capture_output=True, text=True)

                if boost_result.returncode == 0:
                    audio_to_use = audio_path + ".normalized.wav"
                    logger.info("Normalized dubbed audio volume")
                else:
                    audio_to_use = audio_path
                    logger.warning(
                        f"Volume normalization failed: {boost_result.stderr}"
                    )

            use_separation = (
                accompaniment_path is not None
                and os.path.exists(accompaniment_path)
                and _video_has_audio(video_path)
            )

            # Video fade-to-black filters from user scene boundaries. When no
            # scenes are supplied, the video stream is mapped unchanged. Fades
            # are applied at the SOURCE time of each scene so the rendered
            # output matches the original video before any scene rearrangement.
            video_fade_filters = []
            # Parked scenes sit on the layover track: lifted out of the picture
            # but kept so they can be dropped back in. They occupy no time on the
            # timeline, so a fade of theirs would land on whatever footage closed
            # the gap behind them.
            for scene in [sc for sc in (scenes or []) if not sc.get("parked")]:
                start = float(scene.get("source_start", scene.get("start", 0)))
                end = float(scene.get("source_end", scene.get("end", start)))
                fade_in = float(scene.get("video_fade_in") or 0)
                fade_out = float(scene.get("video_fade_out") or 0)
                if fade_in > 0:
                    video_fade_filters.append(f"fade=t=in:st={start:.3f}:d={fade_in:.3f}:c=black")
                if fade_out > 0 and end > fade_out:
                    video_fade_filters.append(f"fade=t=out:st={max(0.0, end - fade_out):.3f}:d={fade_out:.3f}:c=black")
            video_fade_chain = ",".join(video_fade_filters)
            video_output_label = "[vout]" if video_fade_chain else "0:v:0"

            if use_separation:
                # ML-separated accompaniment path: background music/SFX has already
                # had the original speech removed by Demucs, so we can play it at
                # high volume without speech bleed-through.
                #
                # Inputs:
                #   [0] video          — video stream only (audio ignored)
                #   [1] accompaniment  — clean bgm/sfx, no original speech
                #   [2] dubbed audio   — synthesised speech
                accompaniment_level = float(os.getenv("ACCOMPANIMENT_LEVEL", "0.85"))
                logger.info(
                    f"[MIX] Using separated accompaniment at {accompaniment_level:.0%} volume"
                )
                sep_filter = (
                    f"[1:a]volume={accompaniment_level}[bgm];"
                    f"[2:a]volume=3.0[speech];"
                    f"[bgm][speech]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]"
                )
                if video_fade_chain:
                    sep_filter += f";[0:v]{video_fade_chain}[vout]"
                cmd = [
                    "ffmpeg", "-y",
                    "-i", video_path,
                    "-i", accompaniment_path,
                    "-i", audio_to_use,
                    "-filter_complex", sep_filter,
                    "-map", video_output_label,
                    "-map", "[aout]",
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-movflags", "+faststart",
                    output_path,
                ]
            elif _video_has_audio(video_path):
                # Legacy fallback: blend the whole original audio (speech + music) at
                # a low level so background music is audible but speech bleed is quiet.
                original_level = float(os.getenv("ORIGINAL_AUDIO_LEVEL", "0.08"))
                original_mode = os.getenv("ORIGINAL_AUDIO_MODE", "music_only")
                if original_mode == "music_only":
                    original_filter = f"[0:a]pan=stereo|c0=c0-c1|c1=c1-c0,volume={original_level}[a0]"
                else:
                    original_filter = f"[0:a]volume={original_level}[a0]"
                logger.info(
                    f"[MIX] Legacy blend: original audio at {original_level:.0%} "
                    f"(mode={original_mode})"
                )
                legacy_filter = f"{original_filter};[1:a]volume=1.5[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]"
                if video_fade_chain:
                    legacy_filter += f";[0:v]{video_fade_chain}[vout]"
                cmd = [
                    "ffmpeg", "-y",
                    "-i", video_path,
                    "-i", audio_to_use,
                    "-filter_complex", legacy_filter,
                    "-map", video_output_label,
                    "-map", "[aout]",
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-movflags", "+faststart",
                    output_path,
                ]
            else:
                # No original audio track; use dubbed audio only.
                only_filter = "[1:a]loudnorm=I=-14:TP=-1.5:LRA=11[aout]"
                if video_fade_chain:
                    only_filter += f";[0:v]{video_fade_chain}[vout]"
                cmd = [
                    "ffmpeg", "-y",
                    "-i", video_path,
                    "-i", audio_to_use,
                    "-filter_complex", only_filter,
                    "-map", video_output_label,
                    "-map", "[aout]",
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-movflags", "+faststart",
                    output_path,
                ]

            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                logger.error(f"FFmpeg replace audio error: {result.stderr}")
                return False

            logger.info(
                f"[MIX] Output written: {output_path} "
                f"({'separated' if use_separation else 'legacy' if _video_has_audio(video_path) else 'dubbed-only'})"
            )
            return os.path.exists(output_path)

        except Exception as e:
            logger.error(f"Replace audio error: {e}")
            return False

    def _replace_audio_in_video_with_scenes(
        self,
        video_path: str,
        audio_path: str,
        output_path: str,
        scenes: List[Dict],
    ) -> bool:
        """Mux video + audio when scenes have been moved/retimed on the timeline.

        Each scene is cut from its source_start..source_end range in the original
        video/audio and placed at its timeline start. Gaps between scenes are
        filled with black/silence. Per-scene video fade-in/fade-out and per-
        segment audio fades (already applied in the mixed audio) are preserved,
        so the export matches the browser preview.
        """
        try:
            # Parked scenes are excluded outright: they are not part of the cut, and
            # including one would splice footage back in that was deliberately
            # lifted, at whatever timeline position it happened to keep.
            scenes_sorted = sorted(
                [sc for sc in scenes if not sc.get("parked")],
                key=lambda s: float(s.get("start", 0)),
            )
            n = len(scenes_sorted)
            if n == 0:
                return self._replace_audio_in_video(video_path, audio_path, output_path)

            info = self._get_video_info(video_path)
            width = info.get("width", 1920)
            height = info.get("height", 1080)
            fps = info.get("fps", 24.0)

            # Build an interleaved list of scenes and gap fillers on the output
            # timeline, starting at t=0 and ending at the last scene end.
            output_end = max(float(s.get("end", 0)) for s in scenes_sorted)
            segments: List[Tuple[str, Any]] = []
            cursor = 0.0
            for scene in scenes_sorted:
                scene_start = float(scene.get("start", 0))
                scene_end = float(scene.get("end", scene_start))
                if scene_start > cursor:
                    segments.append(("gap", scene_start - cursor))
                segments.append(("scene", scene))
                cursor = max(cursor, scene_end)
            if cursor < output_end:
                segments.append(("gap", output_end - cursor))

            num_scenes = sum(1 for s in segments if s[0] == "scene")
            num_gaps = sum(1 for s in segments if s[0] == "gap")

            # ----------------- Video filter graph -----------------
            v_filters: List[str] = []
            v_filters.append(f"[0:v]split={num_scenes}{''.join(f'[v{i}]' for i in range(num_scenes))}")

            scene_labels: List[str] = []
            scene_idx = 0
            gap_idx = 0
            for seg_type, seg_value in segments:
                if seg_type == "scene":
                    scene = seg_value
                    ss = float(scene.get("source_start", scene.get("start", 0)))
                    se = float(scene.get("source_end", scene.get("end", ss)))
                    dur = max(0.0, se - ss)
                    fade_in = float(scene.get("video_fade_in") or 0)
                    fade_out = float(scene.get("video_fade_out") or 0)
                    fade_chain = ""
                    if fade_in > 0:
                        fade_chain += f",fade=t=in:st=0:d={min(fade_in, dur):.3f}:c=black"
                    if fade_out > 0 and dur > fade_out:
                        fade_chain += f",fade=t=out:st={max(0.0, dur - fade_out):.3f}:d={fade_out:.3f}:c=black"
                    v_filters.append(f"[v{scene_idx}]trim=start={ss:.3f}:end={se:.3f},setpts=PTS-STARTPTS{fade_chain}[s{scene_idx}]")
                    scene_labels.append(f"[s{scene_idx}]")
                    scene_idx += 1
                else:
                    gap_dur = float(seg_value)
                    v_filters.append(f"[bg{gap_idx}]trim=duration={gap_dur:.3f}[g{gap_idx}]")
                    scene_labels.append(f"[g{gap_idx}]")
                    gap_idx += 1

            if num_gaps > 0:
                v_filters.insert(0, f"[black]color=c=black:s={width}x{height}:r={fps}[bgbase]")
                v_filters.insert(1, f"[bgbase]split={num_gaps}{''.join(f'[bg{i}]' for i in range(num_gaps))}")

            total_segments = len(scene_labels)
            v_filters.append(f"{''.join(scene_labels)}concat=n={total_segments}:v=1:a=0[outv]")

            # ----------------- Audio filter graph -----------------
            a_filters: List[str] = []
            a_filters.append(f"[1:a]asplit={num_scenes}{''.join(f'[a{i}]' for i in range(num_scenes))}")

            audio_labels: List[str] = []
            scene_idx = 0
            gap_idx = 0
            for seg_type, seg_value in segments:
                if seg_type == "scene":
                    scene = seg_value
                    ss = float(scene.get("source_start", scene.get("start", 0)))
                    se = float(scene.get("source_end", scene.get("end", ss)))
                    a_filters.append(f"[a{scene_idx}]atrim=start={ss:.3f}:end={se:.3f},asetpts=PTS-STARTPTS[a{scene_idx}_c]")
                    audio_labels.append(f"[a{scene_idx}_c]")
                    scene_idx += 1
                else:
                    gap_dur = float(seg_value)
                    a_filters.append(f"[sg{gap_idx}]atrim=duration={gap_dur:.3f}[ag{gap_idx}]")
                    audio_labels.append(f"[ag{gap_idx}]")
                    gap_idx += 1

            if num_gaps > 0:
                a_filters.insert(0, "[sil]anullsrc=r=44100:cl=stereo[silbase]")
                a_filters.insert(1, f"[silbase]asplit={num_gaps}{''.join(f'[sg{i}]' for i in range(num_gaps))}")

            total_audio_segments = len(audio_labels)
            a_filters.append(f"{''.join(audio_labels)}concat=n={total_audio_segments}:v=0:a=1[outa]")

            filter_complex = ";".join(v_filters + a_filters)

            cmd = [
                "ffmpeg", "-y",
                "-i", video_path,
                "-i", audio_path,
                "-filter_complex", filter_complex,
                "-map", "[outv]",
                "-map", "[outa]",
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "192k",
                "-movflags", "+faststart",
                output_path,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                logger.error(f"Scene-based mux error: {result.stderr}")
                return False
            logger.info(f"[MIX] Scene-based output written: {output_path}")
            return os.path.exists(output_path)
        except Exception as e:
            logger.error(f"Scene-based mux error: {e}")
            return False

    def render_scene_preview(
        self,
        job_id: str,
        scene: Dict,
        output_path: str,
    ) -> bool:
        """Render one scene with dubbed audio and video fade-to-black applied.

        The output is a temporary preview file, not the final export. The user
        can review a scene, adjust fades, and render the next one.
        """
        output_dir = os.path.join(settings.DUBBED_DIR, job_id)
        segments_path = os.path.join(output_dir, "segments.json")
        if not os.path.exists(segments_path):
            raise FileNotFoundError(f"segments.json not found for {job_id}")
        with open(segments_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        segments = data.get("segments", [])

        start = float(scene.get("start", 0))
        end = float(scene.get("end", start))
        source_start = float(scene.get("source_start", start))
        source_end = float(scene.get("source_end", end))
        source_duration = source_end - source_start
        if source_duration <= 0:
            raise ValueError("Scene source duration must be positive")
        duration = end - start

        # Resolve video path, mirroring the same fallback used in remix_dub.
        video_path = data.get("video_path", "")
        if not video_path or not os.path.exists(video_path):
            upload_dir = os.path.join(settings.UPLOAD_DIR, job_id)
            for name in ("video.mp4", "video.mov", "video.mkv", "video.avi"):
                candidate = os.path.join(upload_dir, name)
                if os.path.exists(candidate):
                    video_path = candidate
                    break
        if not video_path or not os.path.exists(video_path):
            raise FileNotFoundError(f"Video not found for {job_id}")

        # Build audio segments that overlap this scene and map URLs to disk paths.
        merge_segments = []
        for seg in segments:
            audio_url = seg.get("committed_audio_url") or seg.get("audio_url")
            seg_start = seg.get("committed_start_time") if seg.get("committed_start_time") is not None else seg.get("start_time")
            seg_end = seg.get("committed_end_time") if seg.get("committed_end_time") is not None else seg.get("end_time")
            if not audio_url or seg_start is None or seg_end is None:
                continue
            if seg_end <= start or seg_start >= end:
                continue
            seg_path = audio_url
            if not os.path.isabs(seg_path):
                if seg_path.startswith("/media/"):
                    seg_path = seg_path.split("/")[-1]
                seg_path = os.path.join(output_dir, seg_path)
            merge_segments.append({
                "path": seg_path,
                "start": seg_start,
                "end": seg_end,
                "fade_in": seg.get("fade_in"),
                "fade_out": seg.get("fade_out"),
            })

        total_duration = max(end, max((s.get("end") or 0 for s in merge_segments), default=0))
        mixed_audio = output_path + ".audio.wav"
        if not self._merge_audio_segments_mixdown(merge_segments, mixed_audio, total_duration):
            raise RuntimeError("Audio mix failed for scene preview")

        # Video fades are measured from the start of the scene cut.
        video_filters = []
        fade_in = float(scene.get("video_fade_in") or 0)
        fade_out = float(scene.get("video_fade_out") or 0)
        if fade_in > 0:
            video_filters.append(f"fade=t=in:st=0:d={fade_in:.3f}:c=black")
        if fade_out > 0 and duration > fade_out:
            video_filters.append(f"fade=t=out:st={duration - fade_out:.3f}:d={fade_out:.3f}:c=black")
        video_filter = ",".join(video_filters)

        cmd = [
            "ffmpeg", "-y",
            "-ss", str(source_start),
            "-t", str(source_duration),
            "-i", video_path,
            "-ss", str(source_start),
            "-t", str(source_duration),
            "-i", mixed_audio,
        ]
        if video_filter:
            cmd += ["-filter_complex", f"[0:v]{video_filter}[vout]", "-map", "[vout]"]
        else:
            cmd += ["-map", "0:v:0"]
        cmd += [
            "-map", "1:a:0",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "+faststart",
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error(f"Scene render ffmpeg error: {result.stderr}")
            return False
        return os.path.exists(output_path)

    # ------------------------------------------------------------------
    # Segment editor support
    # ------------------------------------------------------------------

    def _read_existing_scenes(self, output_dir: str) -> Optional[List[Dict]]:
        """Read the current `scenes` list from segments.json, if any."""
        path = os.path.join(output_dir, "segments.json")
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f).get("scenes")
        except Exception:
            return None

    def _write_segments_json_locked(
        self,
        job_id: str,
        language: str,
        audio_segments: List[Dict],
        output_dir: str,
        scenes: Optional[List[Dict]],
        video_path: str = "",
        accompaniment_path: Optional[str] = None,
        video_duration: float = 0.0,
    ) -> Dict:
        """Write segments.json. Caller must hold the per-job lock."""
        path = os.path.join(output_dir, "segments.json")
        snapshot_path = os.path.join(output_dir, "segments_snapshot.json")

        payload = {
            "job_id": job_id,
            "language": language,
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "video_path": video_path,
            "accompaniment_path": accompaniment_path,
            "video_duration": video_duration,
            "segments": [
                {
                    **seg,
                    "locked": False,
                    "candidates": [],
                    "edit_history": [],
                    "qc_findings": [],
                }
                for seg in audio_segments
            ],
        }
        if scenes is not None:
            payload["scenes"] = scenes
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        shutil.copy2(path, snapshot_path)
        logger.info(f"[SEGMENTS] Wrote {len(audio_segments)} segments to {path}")
        from app.services.segment_validation import validate_segments
        validate_segments(job_id, payload["segments"])
        return payload

    async def _write_segments_json(
        self,
        job_id: str,
        language: str,
        audio_segments: List[Dict],
        output_dir: str,
        video_path: str = "",
        accompaniment_path: Optional[str] = None,
        video_duration: float = 0.0,
    ) -> None:
        """Write segments.json while holding the per-job lock.

        The lock protects the read-modify-write of existing scenes so that a
        concurrent PUT /scenes cannot be overwritten by a rerun that read the
        file before the editor's scenes were persisted.
        """
        lock = await self._get_segments_file_lock(job_id)
        async with lock:
            scenes = self._read_existing_scenes(output_dir)
            payload = await asyncio.to_thread(
                self._write_segments_json_locked,
                job_id, language, audio_segments, output_dir, scenes,
                video_path, accompaniment_path, video_duration,
            )
        try:
            from app.services.supabase_client import upsert_segments
            asyncio.create_task(upsert_segments(job_id, payload["segments"]))
        except Exception:
            pass  # No running event loop — skip Supabase upsert

    class NuanceTranslator:
        """Translates UI nuance descriptors to TTS engine directives.

        Adapter pattern — subclass for ElevenLabs or other engines.
        """

        def translate_for_fish_audio(self, nuances: dict) -> dict:
            """Translate every Nuances control into rich Fish S2 directives.

            Design goal: EVERY knob affects the segment. The 3-position Basic
            buttons fire on both ends (the middle position is the intentional
            neutral baseline). The 0-100 Advanced sliders fire in both
            directions once moved off a small ±5 dead-band around centre (50),
            each end emitting its own natural-language clause. ``pauses`` is the
            one exception — it edits the text via preprocess_text_pauses rather
            than adding a directive. Directives are already full phrases, so they
            drop straight into the composed [ ] instruction.
            """
            directives: List[str] = []
            speed_modifier = 1.0

            def _num(key: str, default: float = 50) -> float:
                try:
                    return float(nuances.get(key, default))
                except (TypeError, ValueError):
                    return default

            LO, HI = 45.0, 55.0  # ±5 dead-band around centre; move past it to act

            # --- Basic 3-position buttons (0 = low end, 1 = neutral, 2 = high end) ---
            pace = nuances.get("pace", 1)
            if pace == 0:
                speed_modifier *= 1.2
                directives.append("quick, rushed pace")
            elif pace == 2:
                speed_modifier *= 0.85
                directives.append("slow, deliberate pacing")

            weight = nuances.get("weight", 1)
            if weight == 0:
                directives.append("light, airy delivery")
            elif weight == 2:
                directives.append("heavy, weighted delivery")

            breath = nuances.get("breath", 1)
            if breath == 0:
                directives.append("tight, controlled breathing")
            elif breath == 2:
                directives.append("breathy intimate onset")

            delivery = nuances.get("delivery", 1)
            if delivery == 0:
                directives.append("intimate, close and soft")
            elif delivery == 2:
                directives.append("projected and forward, energized timbre")

            tail = nuances.get("tail", 1)
            if tail == 0:
                directives.append("clipped, abrupt clean stop with no tail")
            elif tail == 2:
                directives.append("soft trailing tail that fades")

            # --- Advanced sliders (0-100; act below LO or above HI) ---
            prosody = _num("prosody")
            if prosody < LO:
                directives.append("flat, level intonation")
            elif prosody > HI:
                directives.append("expressive, wide pitch movement")

            pitch_contour = _num("pitchContour")
            if pitch_contour < LO:
                directives.append("flat pitch contour")
            elif pitch_contour > HI:
                directives.append("melodic, sing-song intonation")

            volume_dynamics = _num("volumeDynamics")
            if volume_dynamics < LO:
                directives.append("compressed, even volume")
            elif volume_dynamics > HI:
                directives.append("dynamic volume swells")

            tempo_pacing = _num("tempoPacing")
            if tempo_pacing < LO:
                speed_modifier *= 0.9
                directives.append("slower, unhurried tempo")
            elif tempo_pacing > HI:
                speed_modifier *= 1.1
                directives.append("faster, driving tempo")

            breath_sounds = _num("breathSounds")
            if breath_sounds < LO:
                directives.append("minimal breath sounds")
            elif breath_sounds > HI:
                directives.append("audible breaths between phrases")

            voice_quality = _num("voiceQuality")
            if voice_quality < LO:
                directives.append("smooth, clean tone")
            elif voice_quality > HI:
                directives.append("textured, gravelly tone")

            micro = _num("microIntonation")
            if micro < LO:
                directives.append("flat, robotic delivery")
            elif micro > HI:
                directives.append("natural human micro-inflections")

            # pauses handled by preprocess_text_pauses (edits text), not a directive
            return {
                "directives": directives,
                "speed_modifier": round(speed_modifier, 3),
            }

        def preprocess_text_pauses(self, text: str, pause_level: int, engine: str = "fish_audio") -> str:
            """Insert pauses at punctuation based on slider intensity.

            pause_level 0-25: strip commas (no pauses)
            pause_level 26-50: leave as-is (natural)
            pause_level 51-75: moderate pauses at commas/periods
            pause_level 76-100: heavy dramatic pauses
            """
            import re

            if engine == "fish_audio":
                if pause_level <= 25:
                    return re.sub(r",\s*", " ", text)
                if pause_level <= 50:
                    return text
                if pause_level <= 75:
                    text = re.sub(r",\s*", "... ", text)
                    text = re.sub(r"\.\s+", "... ", text)
                    text = re.sub(r";\s*", "... ", text)
                    return text
                # 76-100: heavy
                text = re.sub(r",\s*", "... ... ", text)
                text = re.sub(r"\.\s+", "... ... ... ", text)
                text = re.sub(r";\s*", "... ... ", text)
                text = re.sub(r"—\s*", "... ... ", text)
                return text

            elif engine == "elevenlabs":
                if pause_level <= 25:
                    return re.sub(r",\s*", " ", text)
                if pause_level <= 50:
                    return text
                ms = int(200 + (pause_level - 50) * 12)
                text = re.sub(r",\s*", f', <break time="{ms}ms"/> ', text)
                text = re.sub(r"\.\s+", f'. <break time="{ms + 200}ms"/> ', text)
                return text

            # generic_ssml fallback
            if pause_level <= 50:
                return text
            ms = int(200 + (pause_level - 50) * 12)
            text = re.sub(r",\s*", f', <break time="{ms}ms"/> ', text)
            text = re.sub(r"\.\s+", f'. <break time="{ms + 200}ms"/> ', text)
            return text

        def apply_markers_to_text(self, text: str, markers: list, engine: str = "fish_audio") -> str:
            """Apply intra-segment nuance markers to text spans."""
            if not markers:
                return text
            for marker in sorted(markers, key=lambda m: m.get("startChar", 0), reverse=True):
                start = marker.get("startChar", 0)
                end = marker.get("endChar", len(text))
                mtype = marker.get("type", "")
                if start < 0 or end > len(text) or start >= end:
                    continue
                span = text[start:end]

                if engine == "fish_audio":
                    if mtype == "rise":
                        replacement = f"[excited]{span}"
                    elif mtype == "drop":
                        replacement = f"{span}..."
                    elif mtype == "stress":
                        replacement = f"[emphasized]{span}"
                    elif mtype == "pause_before":
                        replacement = f"... {span}"
                    elif mtype == "whisper":
                        replacement = f"[whispered]{span}"
                    elif mtype == "breathy":
                        replacement = f"[breathy]{span}"
                    else:
                        continue

                elif engine == "elevenlabs":
                    intensity = marker.get("intensity", 50)
                    ms = int(100 + intensity * 5)
                    if mtype == "rise":
                        replacement = f'<prosody pitch="+{intensity // 10}%">{span}</prosody>'
                    elif mtype == "drop":
                        replacement = f'<prosody pitch="-{intensity // 10}%">{span}</prosody>'
                    elif mtype == "stress":
                        replacement = f"<emphasis>{span}</emphasis>"
                    elif mtype == "pause_before":
                        replacement = f'<break time="{ms}ms"/>{span}'
                    elif mtype == "whisper":
                        replacement = f'<amazon:effect name="whispered">{span}</amazon:effect>'
                    elif mtype == "breathy":
                        replacement = f'<prosody volume="soft">{span}</prosody>'
                    else:
                        continue
                else:
                    continue

                text = text[:start] + replacement + text[end:]
            return text

    _nuance_translator = NuanceTranslator()

    async def regenerate_segment(
        self,
        job_id: str,
        segment_index: int,
        voice_id: Optional[str] = None,
        speed: Optional[float] = None,
        speed_ratio: Optional[float] = None,
        target_duration: Optional[float] = None,
        sync_offset_ms: Optional[float] = None,
        emotion: Optional[str] = None,
        traits: Optional[List[str]] = None,
        pitch: Optional[int] = None,
        force_timing: Optional[bool] = None,
        nuances: Optional[Dict] = None,
        nuance_markers: Optional[List[Dict]] = None,
        custom_nuance: Optional[str] = None,
        tts_text: Optional[str] = None,
        engine: Optional[str] = None,
        sampling_params: Optional[Dict] = None,
        seed: Optional[int] = None,
        reroll: Optional[bool] = None,
        live_segment_start: Optional[float] = None,
        live_segment_end: Optional[float] = None,
        live_next_segment_start: Optional[float] = None,
        live_prev_segment_end: Optional[float] = None,
        stage: bool = False,
        text: Optional[str] = None,
    ) -> Dict:
        output_dir = os.path.join(self.dubbed_dir, job_id)
        segments_path = os.path.join(output_dir, "segments.json")

        if not os.path.exists(segments_path):
            raise FileNotFoundError(f"segments.json not found for job {job_id}")

        with open(segments_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        segments = data["segments"]
        seg = next((s for s in segments if s.get("transcript_index") == segment_index), None)
        if seg is None:
            raise ValueError(f"Segment with transcript_index={segment_index} not found in job {job_id}")

        if stage:
            # Staged mode (chunk-lens editor): render and fit against a COPY of
            # the segment so the take is auditionable without touching committed
            # state. Every inline mutation below (path, committed_*, fit timing,
            # edit_history) lands on this copy, and the final segments.json /
            # Supabase write is skipped. Promotion happens via
            # commit_segment_timing's staged_path when the user saves the chunk.
            import copy as _copy
            seg = _copy.deepcopy(seg)

        use_voice_id = voice_id or seg.get("voice_id", "")
        use_speed = speed if speed is not None else seg.get("speed", 1.0)
        if speed is None and speed_ratio is not None:
            try:
                sr = float(speed_ratio)
                if sr > 0:
                    use_speed = sr
            except Exception:
                pass

        if speed is None and target_duration is not None and "duration" in seg:
            try:
                base_dur = float(seg.get("duration") or 0.0)
                td = float(target_duration)
                if base_dur > 0 and td > 0:
                    use_speed = base_dur / td
            except Exception:
                pass

        # Lip-sync auto-fix: caller sends a signed ms offset (positive = audio leads
        # video, negative = video leads audio) rather than a precomputed duration,
        # since the frontend has no reliable current-duration value to derive one
        # from — this segment's own `duration` field here is the authoritative
        # source. Slow down (longer duration) when audio leads, speed up when video
        # leads. Only applies when nothing more explicit (speed/speed_ratio/
        # target_duration) was already given.
        if (
            speed is None and speed_ratio is None and target_duration is None
            and sync_offset_ms is not None and "duration" in seg
        ):
            try:
                base_dur = float(seg.get("duration") or 0.0)
                offset_s = float(sync_offset_ms) / 1000.0
                candidate_duration = base_dur + offset_s
                if base_dur > 0 and candidate_duration > 0:
                    use_speed = base_dur / candidate_duration
            except Exception:
                pass

        try:
            use_speed = float(use_speed)
        except Exception:
            use_speed = 1.0

        use_speed = max(0.5, min(2.0, use_speed))
        use_text = seg.get("committed_adapted_text") or seg.get("text", "")
        # Explicit text override — the frontend has always sent this field but
        # the model silently dropped it, so a regen after an uncommitted text
        # edit spoke the OLD line. Staged chunk editing makes that flow normal,
        # so honor it: a non-empty override is what gets synthesized.
        if text and text.strip():
            use_text = text.strip()

        previous_text = seg.get("text", "")
        previous_path = seg.get("path", "")

        # Regen always writes to segment_NNNN_regen.mp3, overwriting any prior
        # regen for this segment. edit_history preserves the change record.
        # Staged mode uses a separate _staged stem so auditioning a take never
        # clobbers the segment's currently committed audio or intermediates.
        _take_suffix = "_staged" if stage else "_regen"
        _staged_infix = "_staged" if stage else ""
        audio_path = os.path.join(output_dir, f"segment_{segment_index:04d}{_take_suffix}.mp3")

        # Nuance sliders → delivery directives + speed modifier + pause/marker text edits.
        nuance_directives: List[str] = []
        tts_text_processed = use_text
        if nuances:
            translated = self._nuance_translator.translate_for_fish_audio(nuances)
            nuance_directives = translated["directives"]
            use_speed = max(0.5, min(2.0, use_speed * translated["speed_modifier"]))
            pause_level = nuances.get("pauses", 50)
            if pause_level != 50:
                tts_text_processed = self._nuance_translator.preprocess_text_pauses(
                    tts_text_processed, pause_level, engine="fish_audio"
                )
        if nuance_markers:
            tts_text_processed = self._nuance_translator.apply_markers_to_text(
                tts_text_processed, nuance_markers, engine="fish_audio"
            )
        # Verbatim override: the user authored the exact line to synthesise, so the
        # composed directive is skipped. Engine-agnostic — Fish parses [tags] in it,
        # Respeecher reads the punctuation and structure as written.
        if tts_text and tts_text.strip():
            speak_text = tts_text
            directive = ""
        else:
            speak_text = tts_text_processed
            # One composed S2 directive: traits + emotion + nuance delivery/cadence
            # clauses + the free-text write-in from the Nuances panel (last).
            directive = compose_fish_directive(
                emotion=emotion, traits=traits,
                nuance_directives=nuance_directives, extra=custom_nuance,
            )

        # ---- Slot resolution --------------------------------------------------
        # Computed BEFORE synthesis because Respeecher picks its take by fitting
        # this number. Previously it derived its own target from segments.json
        # while the fit pass below used the live timeline, so the two disagreed:
        # a segment whose real slot was 10.8s had takes selected against 1.93s.
        # One definition, used by both.
        def _effective_start(s: Dict) -> float:
            v = s.get("committed_start_time")
            return float(v) if v is not None else float(s.get("start", 0))

        def _effective_end(s: Dict) -> float:
            v = s.get("committed_end_time")
            return float(v) if v is not None else float(s.get("end", 0))

        def _is_finite_number(v: Optional[float]) -> bool:
            return v is not None and isinstance(v, (int, float)) and math.isfinite(v)

        backend_slot_start = _effective_start(seg)
        backend_slot_end   = _effective_end(seg)

        # Snapshot before any fit branch can move the window, so the final overlap
        # guard can tell "a branch set this window" from "this is stale disk state".
        # Defined unconditionally: the fit section is guarded, and a NameError here
        # would silently disable the guard rather than fail loudly.
        _pre_fit_committed = (seg.get("committed_start_time"), seg.get("committed_end_time"))
        # Defaults so the guard is safe if the fit section never ran; it prefers
        # these live-aware boundaries over anything re-read from segments.json.
        next_start = None
        prev_end = None

        # The frontend's live timeline can be ahead of segments.json — a split/resize's
        # commitSegmentTiming sync is fire-and-forget (see dubverse-editor.tsx), so this
        # persisted copy is sometimes stale. Prefer what the user is actually looking at,
        # but only if it's sane; never trust a malformed value from the wire outright.
        if (
            _is_finite_number(live_segment_start)
            and _is_finite_number(live_segment_end)
            and live_segment_start >= 0
            and live_segment_end > live_segment_start
        ):
            slot_start = float(live_segment_start)
            slot_end = float(live_segment_end)
            if abs(slot_start - backend_slot_start) > 0.01 or abs(slot_end - backend_slot_end) > 0.01:
                logger.info(
                    f"[REGEN-LIVE-OVERRIDE] seg {segment_index}: slot "
                    f"backend=({backend_slot_start:.2f}, {backend_slot_end:.2f}) → "
                    f"live=({slot_start:.2f}, {slot_end:.2f})"
                )
        else:
            slot_start = backend_slot_start
            slot_end = backend_slot_end
        slot_dur = slot_end - slot_start

        # ---- Engine selection ------------------------------------------------
        # Precedence: explicit request > segment's stored engine > Fish.
        # Deliberately NOT keyed off TTS_PROVIDER: regen has always used Fish
        # regardless of that setting, and settings.TTS_PROVIDER still defaults to
        # "elevenlabs", so reading it here would silently reroute every regen.
        use_engine = (engine or seg.get("engine") or "fish-audio").lower()
        # Respeecher's catalogue is adult-only — a child speaker always gets Fish.
        # speaker_gender is stamped onto the in-memory transcript during translation
        # but never reaches segments.json, so it is absent on every existing job and
        # cannot be the only signal. The durable one is the voice itself: a segment
        # rendered with a configured child voice is a child.
        # Only keys actually present in the voice map count — get_voice_id() falls
        # back to the FIRST configured voice for an unset key, so "child-2"/"child-3"
        # resolve to male-1 and would misroute every male-1 segment to Fish.
        _child_keys = set(_VOICES_BY_GENDER.get("child", []))
        _child_voice_ids = {
            _vid for _key, _vid in getattr(fish_audio_tts, "_voice_map", {}).items()
            if _key in _child_keys and _vid
        }
        # Read the signal off the SEGMENT as previously rendered, or its speaker's
        # mapping — never off the voice being requested now. Switching a segment to
        # Respeecher supplies a Respeecher voice ("neal"), which would erase the very
        # signal this guard depends on and let a child line through.
        _seg_voice = seg.get("voice_id") or ""
        _mapped_voice = (data.get("voice_mapping") or {}).get(seg.get("speaker") or "", "")
        _is_child = (
            seg.get("speaker_gender") == "child"
            or _seg_voice in _child_voice_ids
            or _mapped_voice in _child_voice_ids
            or _mapped_voice in _child_keys
        )
        if use_engine == "respeecher" and _is_child:
            logger.info(f"[ENGINE] seg {segment_index}: child voice -> forcing fish-audio")
            use_engine = "fish-audio"
        if use_engine == "respeecher" and not respeecher_tts.enabled:
            logger.warning("[ENGINE] Respeecher unavailable (no API key) -> fish-audio")
            use_engine = "fish-audio"
        if use_engine == "respeecher":
            # A voice id from Fish's namespace (UUID or "male-1") means the caller
            # wants Fish and only the stored engine says otherwise. Posting it to
            # Respeecher fails every take and raises below, so route it instead.
            # Gated on a non-empty catalogue: get_voices() returns [] when the
            # fetch fails, and an empty cache must not knock every segment to Fish.
            _catalogue = await respeecher_tts.get_voices()
            if _catalogue and not respeecher_tts.has_voice(use_voice_id):
                logger.info(
                    f"[ENGINE] seg {segment_index}: {use_voice_id!r} not in Respeecher "
                    f"catalogue -> fish-audio"
                )
                use_engine = "fish-audio"

        # Every route to Fish above flips the ENGINE but leaves use_voice_id as
        # whatever was requested — so a Respeecher slug ("neal") can arrive at
        # Fish, which cannot resolve it and renders some default voice or fails.
        # Observed in real data: a segment stored engine="fish-audio" with
        # voice_id="neal". Re-resolve from the speaker's Fish mapping instead.
        # Symmetric with the guard above, and keyed off the same catalogue.
        # A performed segment re-renders from its stored recording. If that file
        # is gone there is nothing to convert — fall back rather than fail, since
        # the text is still there and Fish can speak it.
        if use_engine == "elevenlabs-sts":
            _perf = seg.get("perf_path")
            if not _perf or not os.path.exists(_perf):
                logger.warning(
                    f"[ENGINE] seg {segment_index}: no stored performance -> fish-audio"
                )
                use_engine = "fish-audio"
            elif not elevenlabs_tts.enabled:
                logger.warning("[ENGINE] ElevenLabs unavailable (no API key) -> fish-audio")
                use_engine = "fish-audio"

        # Mirrors get_voice_id's own resolution rules: a key in the map, or a raw
        # reference_id (>15 chars), is a Fish voice. Anything else — "neal",
        # "victoria-cyber" — is not, and get_voice_id would quietly substitute the
        # first configured voice for it. Tested this way rather than against the
        # Respeecher catalogue because has_voice() does not fetch, so on the child
        # and no-API-key paths the cache can be cold and the guard would not fire.
        _fish_map = getattr(fish_audio_tts, "_voice_map", {}) or {}
        _is_fish_voice = use_voice_id in _fish_map or len(use_voice_id) > 15
        if use_engine == "fish-audio" and use_voice_id and not _is_fish_voice:
            if _mapped_voice:
                _fish_voice = fish_audio_tts.get_voice_id(_mapped_voice) or _mapped_voice
                logger.info(
                    f"[ENGINE] seg {segment_index}: non-Fish voice {use_voice_id!r} on "
                    f"fish-audio -> speaker {seg.get('speaker')!r} maps to {_fish_voice!r}"
                )
            else:
                # No mapping for this speaker. A wrong-but-valid Fish voice still
                # renders; a Respeecher slug does not, so take Fish's own default.
                _fish_voice = fish_audio_tts.get_voice_id("")
                logger.warning(
                    f"[ENGINE] seg {segment_index}: non-Fish voice {use_voice_id!r} on "
                    f"fish-audio and speaker {seg.get('speaker')!r} has no mapping "
                    f"-> default {_fish_voice!r}"
                )
            if _fish_voice:
                use_voice_id = _fish_voice

        respeecher_meta: Optional[Dict] = None
        if use_engine == "respeecher":
            # Respeecher speaks the TEXT BUBBLE only, never the write-in: the
            # Delivery Script is a Fish feature (its [tags] are Fish directives,
            # and Respeecher has no directive language to retarget them to).
            # Deliberately sourced from tts_text_processed, not speak_text —
            # speak_text may be the verbatim write-in override. The write-in
            # routes itself to Fish client-side; this is the authoritative guard
            # for any direct or bulk caller that skips the UI.
            # The strip stays as a backstop for [tags] emitted by the nuance
            # marker pass, which Respeecher would otherwise read aloud.
            resp_text = re.sub(r"\[[^\]]*\]", " ", tts_text_processed)
            resp_text = re.sub(r"\s+", " ", resp_text).strip() or tts_text_processed
            # Respeecher exposes no directive, speed or pitch parameters. Its only
            # lever on duration is which take we keep, so hand it the slot and let
            # it choose; staged speed is applied separately below.
            _slot = slot_dur if slot_dur > 0 else None
            # Fall back to whatever this segment was last rendered with, so a
            # plain regen reproduces the approved take instead of re-rolling it.
            _sp = sampling_params if sampling_params is not None else seg.get("respeecher_sampling_params")
            # reroll wins over everything: it exists precisely to escape a stored
            # seed. Otherwise an explicit seed, then the segment's stored one.
            if reroll:
                _sd = None
            else:
                _sd = seed if seed is not None else seg.get("respeecher_seed")
            # ALWAYS strip the seed out of the params blob. respeecher_service pops
            # a seed from sampling_params and treats the explicit `seed` argument as
            # a mere fallback, so any seed riding inside the params silently outranks
            # _sd — which is the one that encodes the caller's actual intent
            # (explicit seed > stored seed > race). Two ways in observed: the blob
            # stored on the segment, and a library entry carrying the winner's seed.
            # Recalling an alternate re-rendered the winner and looked correct.
            if isinstance(_sp, dict):
                _sp = {k: v for k, v in _sp.items() if k != "seed"}
            result = await respeecher_tts.text_to_speech(
                text=resp_text,
                voice_id=use_voice_id,
                output_path=audio_path,
                target_duration=target_duration or _slot,
                sampling_params=_sp,
                seed=_sd,
            )
            respeecher_meta = result
        elif use_engine == "elevenlabs-sts":
            # Re-convert from the stored performance. The recording is the source
            # of truth here, so text edits, emotion pills and Delivery Scripts do
            # NOT reach this engine — same as Respeecher, for the same reason:
            # there is no directive channel to put them through.
            with open(seg["perf_path"], "rb") as _pf:
                _perf_bytes = _pf.read()
            _payload = await elevenlabs_tts.speech_to_speech(
                audio_bytes=_perf_bytes,
                voice_id=use_voice_id,
                output_path=audio_path,
                model_id=seg.get("perf_model_id") or "eleven_english_sts_v2",
                # Replay the isolation setting the take was made with, or the
                # re-render would differ from the audio it is meant to reproduce.
                remove_background_noise=bool(seg.get("perf_denoise")),
                filename=os.path.basename(seg["perf_path"]),
            )
            result = {"path": audio_path, "engine": "elevenlabs-sts"} if _payload else None
        else:
            result = await fish_audio_tts.text_to_speech(
                text=speak_text,
                voice_id=use_voice_id,
                output_path=audio_path,
                speed=use_speed,
                emotion_tags=directive,
                traits_tag="",  # folded into the composed directive above
            )
        if not result:
            raise RuntimeError(
                f"TTS failed for segment {segment_index} in job {job_id} (engine={use_engine})"
            )

        final_path = result["path"]

        # Cost accounting for this regeneration. api_requests is what the vendor
        # actually billed: a Respeecher race is three requests for one segment,
        # so counting "one call" would understate it threefold.
        try:
            _billed = 1
            _audio_s = 0.0
            if use_engine == "respeecher" and respeecher_meta:
                _billed = max(1, len(respeecher_meta.get("take_seeds") or []) or 1)
                _audio_s = float(respeecher_meta.get("duration") or 0.0)
            elif use_engine == "elevenlabs-sts":
                _audio_s = float(self._get_audio_duration(final_path) or 0.0)
            tts_usage.record(
                output_dir,
                use_engine,
                characters=len(speak_text or ""),
                audio_seconds=_audio_s,
                api_requests=_billed,
                regeneration=True,
            )
        except Exception as _e:
            logger.warning(f"[TTS-USAGE] regen accounting skipped: {_e}")

        # Fish consumes use_speed natively; Respeecher has no speed parameter, so
        # apply it here or the speed chip would silently do nothing on that engine.
        # Neither Respeecher nor ElevenLabs STS has a speed parameter, so the
        # speed chip has to be applied to the finished audio on both.
        if use_engine in ("respeecher", "elevenlabs-sts") and use_speed and abs(use_speed - 1.0) > 0.01:
            sped_path = os.path.join(output_dir, f"segment_{segment_index:04d}{_staged_infix}_speed.mp3")
            if await self._apply_atempo(final_path, sped_path, use_speed):
                final_path = sped_path
                logger.info(f"[SPEED] seg {segment_index}: atempo {use_speed:.2f}x (respeecher)")

        # Pitch is a post-process, not a Fish parameter: /v1/tts exposes prosody
        # {speed, volume, normalize_loudness} and no pitch field. The editor's pitch
        # slider reached text_to_speech() and was silently dropped there, so the
        # control did nothing whenever Fish was the provider. This mirrors what the
        # main pipeline already does (~line 1078). Runs BEFORE the fit/trim pass
        # below so the fit measures the audio we actually ship.
        if pitch:
            pitched_path = os.path.join(
                output_dir, f"segment_{segment_index:04d}{_staged_infix}_pitched.mp3"
            )
            ok = await asyncio.to_thread(
                self._apply_pitch_shift, final_path, pitched_path, float(pitch)
            )
            if ok and os.path.exists(pitched_path):
                final_path = pitched_path
                logger.info(
                    f"[PITCH] seg {segment_index}: shifted {pitch:+.0f} semitones"
                )

        # Clear any stale exclusion from a previous attempt
        seg.pop("timing_exclusion", None)
        seg.pop("timing_audio_duration", None)
        seg.pop("timing_slot_duration", None)
        seg.pop("timing_overlap", None)

        # Fit/trim pass — same quality treatment as the main dub pipeline.
        # If the TTS audio overflows the segment slot, time-stretch it with
        # rubberband (formant-preserving) so the editor regen is never worse
        # than re-running a full dub.
        # Slot already resolved above the engine dispatch (live timeline preferred
        # over segments.json), so Respeecher's take selection and this fit pass
        # measure against the same number.
        if slot_dur > 0.2:
            trimmed_path = os.path.join(output_dir, f"segment_{segment_index:04d}{_take_suffix}_notrim.mp3")
            trimmed_ok = await asyncio.to_thread(
                self._trim_leading_silence, final_path, trimmed_path
            )
            if trimmed_ok and os.path.exists(trimmed_path):
                silence_removed = (
                    await asyncio.to_thread(self._get_audio_duration, final_path)
                    - await asyncio.to_thread(self._get_audio_duration, trimmed_path)
                )
                if silence_removed > 0.08:
                    final_path = trimmed_path

            actual_dur = await asyncio.to_thread(self._get_audio_duration, final_path)
            # Feed back into per-voice rate calibration (same as the main dub loop).
            # In the regen path we key by use_voice_id (the actual reference ID)
            # rather than the canonical voice_key — still a valid per-voice signal.
            update_voice_rate(use_voice_id, use_text, actual_dur)

            # If the user has committed a manual timing (drag/resize), treat the slot
            # as authoritative. Fit the audio inside it with speed or trim, but never
            # relocate the segment. This stops the "snap-back" where regenerating a
            # manually placed segment moves it to match the TTS duration.
            user_committed_timing = (
                _pre_fit_committed[0] is not None and _pre_fit_committed[1] is not None
            ) or seg.get("locked")

            if user_committed_timing and actual_dur > slot_dur + 0.05:
                target = max(0.2, slot_dur)
                stretched_path = os.path.join(output_dir, f"segment_{segment_index:04d}{_take_suffix}_fit.mp3")
                stretched = await asyncio.to_thread(
                    self._adjust_audio_duration,
                    final_path, stretched_path, target,
                    min_speed=0.5, max_speed=2.0,
                )
                if stretched and os.path.exists(stretched_path):
                    final_path = stretched_path
                    logger.info(
                        f"[REGEN-PRESERVE] seg {segment_index}: user-committed slot "
                        f"[{slot_start:.2f}-{slot_end:.2f}] kept; audio speed-fit {actual_dur:.2f}s → {target:.2f}s"
                    )
                else:
                    trimmed_path = os.path.join(output_dir, f"segment_{segment_index:04d}{_take_suffix}_trim.mp3")
                    trimmed = await asyncio.to_thread(
                        self._trim_audio_duration, final_path, trimmed_path, target
                    )
                    if trimmed and os.path.exists(trimmed_path):
                        final_path = trimmed_path
                        logger.warning(
                            f"[REGEN-PRESERVE] seg {segment_index}: user-committed slot "
                            f"[{slot_start:.2f}-{slot_end:.2f}] kept; audio hard-trimmed {actual_dur:.2f}s → {target:.2f}s"
                        )
            elif actual_dur > slot_dur + 0.05:
                # Room before the next segment starts. The segments array is NOT
                # guaranteed to be in time order (splits insert out-of-order
                # transcript_indexes), so take the temporally-NEAREST segment that
                # starts after this one — the SMALLEST such start — not the first in
                # array order. Otherwise the window can overrun a segment that sits
                # later in the array but earlier in time, and the expanded audio
                # overlaps its slot.
                backend_next_start = min(
                    (_effective_start(s) for s in segments if _effective_start(s) > slot_end + 0.01),
                    default=slot_end + 999.0,
                )

                # Same trust rule as the slot itself: only override with the live value
                # if it's sane and actually leaves room after this segment's live end.
                if _is_finite_number(live_next_segment_start) and live_next_segment_start > slot_end:
                    next_start = float(live_next_segment_start)
                    if abs(next_start - backend_next_start) > 0.01:
                        logger.info(
                            f"[REGEN-LIVE-OVERRIDE] seg {segment_index}: next_start "
                            f"backend={backend_next_start:.2f} → live={next_start:.2f}"
                        )
                else:
                    next_start = backend_next_start
                available_dur = next_start - slot_start  # end-only room (keeps start fixed)

                # Also count the gap BEFORE this segment: it can move its start earlier,
                # up to the previous segment's end, to gain room without colliding. The
                # "full window" between neighbors is what decides whether it can fit at all.
                prev_end = max(
                    (_effective_end(s) for s in segments if _effective_end(s) <= slot_start + 0.01),
                    default=0.0,
                )
                # Same trust rule as next_start: prefer the live value when it is
                # sane. Taking the LATER of the two is deliberate — a neighbour the
                # editor has already extended is the binding constraint, and using
                # the stale (earlier) backend copy is exactly how a segment ends up
                # moved back into audio that is already there.
                if _is_finite_number(live_prev_segment_end) and 0.0 <= live_prev_segment_end <= slot_start + 0.01:
                    if live_prev_segment_end > prev_end + 0.01:
                        logger.info(
                            f"[REGEN-LIVE-OVERRIDE] seg {segment_index}: prev_end "
                            f"backend={prev_end:.2f} → live={float(live_prev_segment_end):.2f}"
                        )
                    prev_end = max(prev_end, float(live_prev_segment_end))
                window_start = max(0.0, prev_end + 0.05)
                full_room = next_start - window_start  # room growing in BOTH directions

                overlap = actual_dur - full_room
                TOLERANCE = 0.3

                if actual_dur <= available_dur - 0.05:
                    # Gap is large enough — extend this segment's window to fit the audio
                    new_end = round(slot_start + actual_dur, 3)
                    seg["end"] = new_end
                    seg["committed_end_time"] = new_end
                    logger.info(
                        f"[REGEN-EXTEND] seg {segment_index}: "
                        f"extended end {slot_end:.2f}s → {new_end:.2f}s "
                        f"(next seg at {next_start:.2f}s, gap was {available_dur - slot_dur:.2f}s)"
                    )
                elif actual_dur <= full_room - 0.05:
                    # Doesn't fit by growing the end alone, but the gap BEFORE this segment
                    # supplies enough total room — move the start earlier just enough to fit,
                    # ending just before the next segment (0.05s gap). No collision either side.
                    new_end = round(next_start - 0.05, 3)
                    new_start = round(max(window_start, new_end - actual_dur), 3)
                    seg["start"] = new_start
                    seg["committed_start_time"] = new_start
                    seg["end"] = new_end
                    seg["committed_end_time"] = new_end
                    logger.info(
                        f"[REGEN-EXTEND-BIDIR] seg {segment_index}: grew into window "
                        f"[{window_start:.2f}, {next_start:.2f}] — start {slot_start:.2f}→{new_start:.2f}, "
                        f"end {slot_end:.2f}→{new_end:.2f}"
                    )
                elif overlap <= TOLERANCE or force_timing:
                    # Marginal overrun even vs the full window, or user-forced — speed-fit into it.
                    target = full_room - 0.05
                    stretched_path = os.path.join(output_dir, f"segment_{segment_index:04d}{_take_suffix}_fit.mp3")
                    stretched = await asyncio.to_thread(
                        self._adjust_audio_duration,
                        final_path, stretched_path, target,
                        min_speed=0.8, max_speed=1.5,
                    )
                    if stretched and os.path.exists(stretched_path):
                        final_path = stretched_path
                        new_end = round(next_start - 0.05, 3)
                        new_start = round(max(window_start, new_end - target), 3)
                        seg["start"] = new_start
                        seg["committed_start_time"] = new_start
                        seg["end"] = new_end
                        seg["committed_end_time"] = new_end
                        logger.info(
                            f"[REGEN-TOLERANCE] seg {segment_index}: "
                            f"overlap {overlap:.2f}s {'(forced)' if force_timing else 'within tolerance'}, speed-fit to {target:.2f}s in full window"
                        )
                    else:
                        # The speed-fit itself failed (ffmpeg error) — do NOT shrink the
                        # committed window to `target` in this case. Doing so unconditionally
                        # here used to leave the segment thinking its slot was `target`
                        # seconds long while `final_path` was still the original, longer,
                        # un-stretched audio — silently producing audio that overruns its own
                        # slot with a 200 OK response and no visible error anywhere. Surface
                        # it as a timing exclusion instead, same as the "genuinely too long"
                        # branch below, so the user is told to intervene rather than getting
                        # a silently mismatched result.
                        seg["timing_exclusion"] = True
                        seg["timing_audio_duration"] = round(actual_dur, 2)
                        seg["timing_slot_duration"] = round(full_room, 2)
                        seg["timing_overlap"] = round(overlap, 2)
                        logger.error(
                            f"[REGEN-TOLERANCE] seg {segment_index}: speed-fit failed "
                            f"(ffmpeg error) — surfacing as timing exclusion instead of "
                            f"silently keeping mismatched audio/timing"
                        )
                else:
                    # Even the full window between neighbors can't hold the audio —
                    # rewrite is genuinely the only option now.
                    seg["timing_exclusion"] = True
                    seg["timing_audio_duration"] = round(actual_dur, 2)
                    seg["timing_slot_duration"] = round(full_room, 2)
                    seg["timing_overlap"] = round(overlap, 2)
                    logger.info(
                        f"[REGEN-EXCLUSION] seg {segment_index}: "
                        f"{actual_dur:.2f}s exceeds full window {full_room:.2f}s by {overlap:.2f}s"
                    )

        # Final overlap guard.
        #
        # Every fit branch above clamps to next_start - 0.05, so none of them
        # INTENDS an overlap — yet 17 of 817 segments in a real feature ended up
        # overlapping a neighbour. That happens when the boundary a branch trusted
        # was itself wrong (a stale copy, a neighbour moved after this segment was
        # last rendered), and neither regen could detect it: each one believed it
        # had fitted correctly, so no exclusion was raised and the user got a silent
        # overrun with a 200 OK.
        #
        # Verify the window actually written against the real neighbours, whatever
        # the branches concluded. Overlapping audio is never acceptable output, so
        # surface it as a timing exclusion and let the user decide.
        try:
            # The window this segment ACTUALLY ends up with. The fit branches write
            # committed_* only when they change something, so when the audio fitted
            # as-is those fields still hold whatever was on disk — which is stale
            # exactly when the editor sent a live override. Reading them made the
            # guard measure a window the regen never used, and report an overlap
            # against it. Fall back to the stored values only if no live slot ran.
            _now_committed = (seg.get("committed_start_time"), seg.get("committed_end_time"))
            if _now_committed != _pre_fit_committed:
                # A fit branch moved the window this call — that is the result.
                _fs, _fe = _now_committed
            else:
                # No branch changed it, so the window is the slot the fit used,
                # which already carries the editor's live override. committed_* is
                # whatever was on disk and may be stale — reading it here made the
                # guard measure a window the regen never used.
                _fs, _fe = slot_start, slot_end
            if _is_finite_number(_fs) and _is_finite_number(_fe):
                # Neighbours must come from the same source the fit logic used.
                # Re-deriving them from `segments` reads segments.json, which lags
                # the editor: expanding a slot ripples the later segments right, but
                # those commits are fire-and-forget, so the on-disk neighbour is
                # still where it was. Judging against it reported a large overlap
                # for a window the user had just made room for — the guard
                # contradicting the very fit logic it exists to backstop.
                _next = next_start if _is_finite_number(next_start) else min(
                    (_effective_start(o) for o in segments
                     if o is not seg and _effective_start(o) >= _fs + 0.01),
                    default=None,
                )
                # Segments ending at or before this one STARTS. The bound was _fe,
                # which swept up every short segment nested inside a long window and
                # reported its end as "prev" — producing overlaps of several seconds
                # against a neighbour that was never behind this segment at all.
                _prev = prev_end if _is_finite_number(prev_end) else max(
                    (_effective_end(o) for o in segments
                     if o is not seg and _effective_end(o) <= _fs + 0.01),
                    default=None,
                )
                _over_next = (_fe - _next) if _next is not None else 0.0
                _over_prev = (_prev - _fs) if _prev is not None else 0.0
                _worst = max(_over_next, _over_prev)
                if _worst > 0.01:
                    seg["timing_exclusion"] = True
                    seg["timing_audio_duration"] = round(actual_dur, 2)
                    seg["timing_slot_duration"] = round(_fe - _fs, 2)
                    seg["timing_overlap"] = round(_worst, 2)
                    # Informational only: the editor no longer blocks on this. Its
                    # verdict is computed from segments.json, which lags the live
                    # timeline, so it is a debugging aid rather than a fault.
                    logger.info(
                        f"[REGEN-OVERLAP] seg {segment_index}: window "
                        f"[{_fs:.2f}, {_fe:.2f}] overlaps a neighbour by {_worst:.2f}s "
                        f"(next={_next}, prev={_prev}) — raising timing exclusion"
                    )
        except Exception as _e:
            logger.warning(f"[REGEN-OVERLAP] guard failed for seg {segment_index}: {_e}")

        # Raise the clip if Fish rendered it far below its neighbours. Boost only,
        # peak-capped — see _ensure_min_loudness. Runs before the duration measure
        # because gain re-encodes the file.
        await asyncio.to_thread(self._ensure_min_loudness, final_path)

        # Always measure final audio duration so the frontend can auto-shrink
        # slots that are longer than the actual speech.
        try:
            _final_dur = actual_dur
        except NameError:
            _final_dur = await asyncio.to_thread(self._get_audio_duration, final_path)
        seg["audio_duration"] = round(_final_dur, 3)

        seg["path"] = final_path
        seg["voice_id"] = use_voice_id
        if voice_id:
            seg["committed_voice_id"] = use_voice_id
        seg["speed"] = use_speed
        seg["text"] = use_text
        seg["was_truncated"] = False
        seg["committed_audio_url"] = final_path
        seg["committed_adapted_text"] = use_text
        # Contract: "" = explicit clear (drop seg["emotion"]); None = no change; non-empty = set
        if emotion == "":
            seg.pop("emotion", None)
        elif emotion:
            seg["emotion"] = emotion.lower()
        # Same contract for attached_traits: [] = explicit clear; None = no change; non-empty = set
        if traits == []:
            seg.pop("attached_traits", None)
        elif traits:
            seg["attached_traits"] = [t.lower() for t in traits]
        # Free-text nuance write-in: "" = explicit clear; None = no change; non-empty = set
        if custom_nuance == "":
            seg.pop("custom_nuance", None)
        elif custom_nuance:
            seg["custom_nuance"] = custom_nuance
        # Verbatim text override: same contract. Kept separate from seg["text"] so
        # the display/subtitle stays the clean line.
        if tts_text == "":
            seg.pop("tts_text", None)
        elif tts_text:
            seg["tts_text"] = tts_text
        # Engine actually used (post child/availability fallback), so the editor can
        # show it and the next regen defaults to the same one without the client
        # re-sending it. Take metadata drives the panel's audition list.
        seg["engine"] = use_engine
        if respeecher_meta:
            seg["respeecher_takes"] = respeecher_meta.get("takes", [])
            seg["respeecher_take_seeds"] = respeecher_meta.get("take_seeds", [])
            seg["respeecher_fits"] = respeecher_meta.get("fits", True)
            seg["respeecher_duration"] = respeecher_meta.get("duration")
            # Audition history, kept as seeds rather than audio. Every take of
            # every race stays replayable byte-for-byte from its seed, so the
            # alternates survive later renders instead of being overwritten the
            # way the _takeN.mp3 files are. Voice and params ride along because a
            # seed only reproduces its take under the same two.
            _hist = list(seg.get("respeecher_seed_history") or [])
            # Strip the seed out of the params blob. The winner's params carry its
            # own seed, and attaching that blob to every entry gave each alternate
            # the WINNER's seed — which then won on replay, because
            # respeecher_service pops a seed out of sampling_params and only falls
            # back to the explicit `seed` argument when there isn't one. Recalling
            # an alternate would silently re-render the winner and look right.
            _raw_params = respeecher_meta.get("sampling_params") or {}
            _params = {k: v for k, v in _raw_params.items() if k != "seed"} or None
            _race_seeds = list(respeecher_meta.get("take_seeds") or [])
            # Refresh entries this race re-rendered rather than skipping them as
            # already-seen. The same seed under different params is a DIFFERENT
            # take, so a stale entry would recall something other than the audio
            # currently on the segment. `kept` is preserved — only the recipe moves.
            _race_set = set(_race_seeds)
            for _e in _hist:
                if isinstance(_e, dict) and _e.get("seed") in _race_set:
                    _e["voice"] = use_voice_id
                    _e["params"] = _params
            _seen = {e.get("seed") for e in _hist if isinstance(e, dict)}
            _fresh = [
                {"seed": _s, "voice": use_voice_id, "params": _params}
                for _s in _race_seeds
                if _s not in _seen
            ]
            # Newest first, so the cap evicts the oldest — except entries the user
            # has locked, which are exempt and never counted out. A locked take is
            # an explicit "keep this", and silently dropping it off the end of the
            # list would destroy the only record of a read they wanted back.
            _combined = _fresh + _hist
            _budget = max(0, SEED_HISTORY_MAX - sum(1 for e in _combined if e.get("kept")))
            _out = []
            for _e in _combined:                    # order preserved: newest first
                if _e.get("kept"):
                    _out.append(_e)
                elif _budget > 0:
                    _out.append(_e)
                    _budget -= 1
            seg["respeecher_seed_history"] = _out
            # The seed + params that produced this exact performance. Replaying
            # them re-renders it byte-for-byte, so an approved delivery survives
            # any later regeneration.
            seg["respeecher_seed"] = respeecher_meta.get("seed")
            seg["respeecher_sampling_params"] = respeecher_meta.get("sampling_params")
        else:
            # Drop only what describes audio that is no longer live. seed and
            # sampling_params are KEPT so switching to Fish and back reproduces the
            # approved take byte-for-byte instead of re-racing — the toggle is a
            # round trip, not a one-way door.
            for _k in ("respeecher_takes", "respeecher_take_seeds", "respeecher_fits",
                       "respeecher_duration"):
                seg.pop(_k, None)
        if speed_ratio is not None:
            seg["speed_ratio"] = speed_ratio
        if target_duration is not None:
            seg["target_duration"] = target_duration

        history_entry = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "previous_text": previous_text,
            "new_text": use_text,
            "previous_path": previous_path,
            "new_path": result["path"],
        }
        seg.setdefault("edit_history", []).append(history_entry)

        # Honor timeline drag: committed_* timing is the source of truth once the
        # user has moved a block. Write it back into start/end so both this regen
        # response and the persisted JSON reflect the dragged position rather than
        # the original transcript slot. (The slot-fit above intentionally still
        # used the original start/end for duration fitting.)
        if seg.get("committed_start_time") is not None:
            seg["start"] = seg["committed_start_time"]
        if seg.get("committed_end_time") is not None:
            seg["end"] = seg["committed_end_time"]

        if not stage:
            data["regenerated_at"] = datetime.utcnow().isoformat() + "Z"
            atomic_write_json(segments_path, data)

            try:
                from app.services.supabase_client import upsert_segments
                from app.services.job_manager import _spawn
                # _spawn, not a bare create_task: asyncio keeps only a weak
                # reference to a task, so a fire-and-forget write nobody holds can
                # be collected before it reaches Supabase.
                _spawn(upsert_segments(job_id, data["segments"]))
            except Exception as exc:
                logger.warning(
                    f"Job {job_id}: segment {segment_index} upsert failed: {exc}"
                )

        if stage:
            # Marker so the caller can tell this audition copy apart from a
            # committed segment — none of its mutations were persisted.
            seg["staged"] = True
            logger.info(f"[SEGMENTS] Staged take for segment {segment_index} (job {job_id}) — not committed")
        else:
            logger.info(f"[SEGMENTS] Regenerated segment {segment_index} for job {job_id}")
        return seg

    async def remix_dub(self, job_id: str) -> Dict:
        import time
        t0 = time.monotonic()

        output_dir = os.path.join(self.dubbed_dir, job_id)
        segments_path = os.path.join(output_dir, "segments.json")

        if not os.path.exists(segments_path):
            raise FileNotFoundError(f"segments.json not found for job {job_id}")

        with open(segments_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        language = data.get("language", "en")
        segments = data["segments"]

        # --- Backwards-compat: pre-patch segments.json lacks video_path,
        # accompaniment_path, and video_duration.  Reconstruct from disk
        # conventions rather than refusing to remix.  Post-patch jobs have
        # these fields written by _write_segments_json at dub time. ---
        video_path = data.get("video_path") or ""
        if not video_path or not os.path.exists(video_path):
            upload_dir = os.path.join(settings.UPLOAD_DIR, job_id)
            candidates = [
                f for f in os.listdir(upload_dir)
                if f.lower().endswith((".mp4", ".mkv", ".avi", ".mov", ".webm"))
            ] if os.path.isdir(upload_dir) else []
            if not candidates:
                raise FileNotFoundError(
                    f"Source video not found for job {job_id} "
                    f"(checked segments.json.video_path and {upload_dir})"
                )
            video_path = os.path.join(upload_dir, candidates[0])

        accompaniment_path = data.get("accompaniment_path") or None
        if not accompaniment_path or not os.path.exists(accompaniment_path):
            candidate_acc = os.path.join("data/separated", f"{job_id}_accompaniment.wav")
            accompaniment_path = candidate_acc if os.path.exists(candidate_acc) else None

        video_duration = data.get("video_duration") or 0.0
        if not video_duration:
            video_duration = await asyncio.to_thread(self._get_video_duration, video_path)

        merge_segments = [
            {"path": seg["path"], "start": seg["start"], "end": seg["end"]}
            for seg in segments
        ]

        merged_audio = os.path.join(output_dir, "dubbed_audio.wav")
        ok = await asyncio.to_thread(
            self._merge_audio_segments, merge_segments, merged_audio, video_duration
        )
        if not ok:
            raise RuntimeError(f"Remix failed: could not merge {len(merge_segments)} segments for job {job_id}")

        output_video = os.path.join(output_dir, f"dubbed_{language}.mp4")
        # Hold the per-job lock while reading scenes, muxing, and writing
        # segments.json so the remix MP4 and the persisted scene layout agree.
        lock = await self._get_segments_file_lock(job_id)
        async with lock:
            _latest_scenes = self._read_existing_scenes(output_dir)
            scenes = _latest_scenes if _latest_scenes is not None else (data.get("scenes") or [])
            scenes_moved = any(
                float(s.get("source_start", s.get("start", 0))) != float(s.get("start", 0)) or
                float(s.get("source_end", s.get("end", 0))) != float(s.get("end", 0))
                for s in scenes
            )
            if scenes_moved:
                if accompaniment_path:
                    logger.warning("[REMIX] Scenes have been moved; separated accompaniment is not yet supported in scene-based mux. Using dubbed audio only.")
                ok = await asyncio.to_thread(
                    self._replace_audio_in_video_with_scenes, video_path, merged_audio, output_video, scenes
                )
            else:
                ok = await asyncio.to_thread(
                    self._replace_audio_in_video, video_path, merged_audio, output_video, accompaniment_path, scenes
                )
            if not ok:
                raise RuntimeError(f"Remix failed: could not mux audio into video for job {job_id}")

            elapsed_ms = int((time.monotonic() - t0) * 1000)
            data["last_remixed_at"] = datetime.utcnow().isoformat() + "Z"
            data["scenes"] = scenes
            await asyncio.to_thread(atomic_write_json, segments_path, data)

        logger.info(f"[REMIX] job={job_id} segments={len(merge_segments)} elapsed={elapsed_ms}ms")
        return {
            "job_id": job_id,
            "dubbed_video_url": f"/api/download/{job_id}/{language}",
            "duration_seconds": video_duration,
            "status": "ok",
            "remix_duration_ms": elapsed_ms,
            "segments_used": len(merge_segments),
        }


dubbing_service = DubbingService()
