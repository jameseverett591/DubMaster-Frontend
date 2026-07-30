import subprocess
import os
import re
import math
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
import logging
from typing import Optional, List, Dict
import asyncio
import json
import httpx

from app.services.elevenlabs_tts import elevenlabs_tts
from app.services.fish_audio_tts import fish_audio_tts
from app.services.translation_service import (
    translation_service,
    natural_duration,
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


class DubbingService:
    def __init__(self):
        self.dubbed_dir = settings.DUBBED_DIR
        os.makedirs(self.dubbed_dir, exist_ok=True)

    def _get_tts_provider(self):
        """Return the active TTS service based on TTS_PROVIDER env/config."""
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
        # Pass 1: match by explicit key from the frontend voice_mapping.      #
        # Tries multiple key formats so "voice-1", "speaker-1", "SPEAKER_00" #
        # etc. all resolve correctly regardless of which the frontend sends.  #
        # ------------------------------------------------------------------ #
        speaker_to_voice: Dict[str, str] = {}
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

            # --- Reuse Demucs separation cached from the upload pipeline ---
            # separate_audio already ran during process_video_pipeline and wrote
            # its outputs to data/separated/<job_id>_*.wav.  Resolve those paths
            # directly so we never re-run the 3-8 min model a second time.
            from pathlib import Path as _Path
            _sep_dir = _Path("data/separated")
            _acc_candidate = str(_sep_dir / f"{job_id}_accompaniment.wav")
            _voc_candidate = str(_sep_dir / f"{job_id}_vocals.wav")

            if (
                os.path.exists(_acc_candidate)
                and os.path.getsize(_acc_candidate) > 1000
                and os.path.exists(_voc_candidate)
                and os.path.getsize(_voc_candidate) > 1000
            ):
                accompaniment_path = _acc_candidate
                vocals_path = _voc_candidate
                logger.info(
                    f"[SEPARATE] Reusing cached separation — skipping Demucs re-run "
                    f"(accompaniment={os.path.getsize(_acc_candidate)//1024}KB, "
                    f"vocals={os.path.getsize(_voc_candidate)//1024}KB)"
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
            _, provider_name_check = self._get_tts_provider()
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
            target_norm = normalize_language_code(target_language)

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
                _adapted = adapted_map.get(seg_id)
                if _adapted is not None:
                    _variant_type = (adaptation_selections or {}).get(seg_id, "performable")
                    text = _adapted.get_variant(_variant_type).text or segment.get("text", "")
                    # Anti-truncation (step 1 — shorten): when the user hasn't explicitly
                    # picked a variant and the default would overrun the on-screen slot,
                    # prefer the shorter sync_fit wording instead of hard-trimming audio
                    # later. natural_duration() matches the fit path's timing model.
                    if seg_id not in (adaptation_selections or {}):
                        _start = float(segment.get("start", 0) or 0)
                        _next = transcript[i + 1].get("start") if i + 1 < len(transcript) else None
                        _slot = (float(_next) - _start) if _next is not None else (float(segment.get("end", 0) or 0) - _start)
                        if _slot > 0 and text and natural_duration(text) > _slot + 0.1:
                            try:
                                _sync = (_adapted.get_variant("sync_fit").text or "").strip()
                            except Exception:
                                _sync = ""
                            if _sync and natural_duration(_sync) < natural_duration(text):
                                logger.info(
                                    f"[ADAPT-FIT] seg {i}: '{_variant_type}' ~{natural_duration(text):.1f}s "
                                    f"overruns {_slot:.1f}s slot — using sync_fit ~{natural_duration(_sync):.1f}s"
                                )
                                text = _sync
                else:
                    text = segment.get("text", "")
                speaker = segment.get("speaker", "speaker-1")

                if not text.strip():
                    return {"index": i, "skipped": True, "reason": "empty"}

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

                tts_provider, provider_name = self._get_tts_provider()
                default_voice = "pNInz6obpgDQGcFmaJgB" if provider_name == "elevenlabs" else ""
                voice_key = speaker_to_voice.get(speaker, default_voice)
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
                    _explicit = self._explicit_voice_for_speaker(speaker, voice_mapping)
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

            logger.info(f"[TTS] Launching {len(transcript)} TTS calls in parallel...")
            tts_results = await asyncio.gather(
                *[_synthesise_one(i, seg) for i, seg in enumerate(transcript)],
                return_exceptions=False,
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
                    # Uses the shared _CHARS_PER_SECOND constant so this floor matches
                    # the split function and editor regen path exactly.
                    _nat_dur = natural_duration(text)
                    _needed  = max(0.0, _nat_dur - segment_duration)
                    expansion = min(_needed, gap_to_next * 0.8) if gap_to_next > 0 else 0.0
                    comfortable_duration = max(0.2, segment_duration + expansion)
                    # Level 2 — hard ceiling: never overflow into the next segment.
                    max_slot = max(0.2, next_start - start_time - 0.05)
                    target_duration = comfortable_duration
                else:
                    max_slot = max(0.2, end_time - start_time)
                    comfortable_duration = max_slot
                    target_duration = max_slot

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

                # Two-level slot expansion: if TTS overflows the comfortable slot
                # but still fits within the hard ceiling, expand silently rather
                # than trimming — preserves breathing room for short speech, avoids
                # cut-offs for translations that run long.
                if actual_duration > target_duration:
                    target_duration = min(actual_duration, max_slot)

                # --- Hard-fit: TTS audio NEVER overflows into the next segment ---
                #
                # start_time is the word-level first-word timestamp (Whisper
                # words[0].start from transcribe_audio._segments_to_dicts).
                # target_duration = next_segment.word_start - this.word_start - 50ms
                # so the window is tight and precise.
                #
                # Two-stage enforcement:
                #   1. Time-stretch via ffmpeg atempo (no speedup cap — correctness
                #      over quality when the slot is tight).  Fish Audio pre-speed
                #      gets a wider tolerance (150ms) before atempo fires, to avoid
                #      compounding two back-to-back speed operations on audio that
                #      already fits.  For larger overflows, atempo fires regardless.
                #   2. Hard-trim to 20ms tolerance as an absolute guarantee.
                _fish_speed_was_applied = raw.get("fish_speed_applied", False)
                _atempo_tolerance = 0.15 if _fish_speed_was_applied else 0.05
                _speed_applied = 1.0
                if actual_duration > target_duration + _atempo_tolerance and target_duration > 0.2:
                    _speed_applied = actual_duration / target_duration
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
                        final_path, adjusted_audio_path, target_duration,
                        min_speed=MIN_SPEED_RATIO, max_speed=self._FIT_MAX_SPEED,
                    )
                    if adjusted and os.path.exists(adjusted_audio_path):
                        final_path = adjusted_audio_path
                        actual_duration = await asyncio.to_thread(self._get_audio_duration, final_path)
                    logger.info(
                        f"[FIT] seg={i} stretched {_speed_applied:.2f}x "
                        f"word_start={start_time:.3f}s slot={target_duration:.2f}s "
                        f"after={actual_duration:.2f}s fish_pre={_fish_speed_was_applied}"
                    )

                # Absolute guarantee — hard-trim to slot boundary (20ms tolerance).
                if actual_duration > target_duration + 0.02:
                    trimmed_path = os.path.join(output_dir, f"segment_{i:04d}_trimmed.mp3")
                    trimmed = await asyncio.to_thread(self._trim_audio_duration, final_path, trimmed_path, target_duration)
                    if trimmed and os.path.exists(trimmed_path):
                        final_path = trimmed_path
                        actual_duration = target_duration
                        segment["was_truncated"] = True
                        logger.warning(
                            f"[FIT] seg={i} hard-trimmed to {target_duration:.2f}s "
                            f"(needed {_speed_applied:.2f}x — tail may be cut)"
                        )

                overlap_with_prev = ""
                if audio_segments:
                    prev_end = audio_segments[-1]["end"]
                    if start_time < prev_end:
                        overlap_with_prev = f" OVERLAP={prev_end - start_time:.3f}s with seg {len(audio_segments)-1}"

                logger.info(
                    f"[TIMING] seg={i} speaker={speaker} "
                    f"transcript=[{start_time:.3f}-{end_time:.3f}] "
                    f"slot={target_duration:.3f}s "
                    f"tts_dur={actual_duration:.3f}s "
                    f"delta={actual_duration - target_duration:+.3f}s "
                    f"placed_at=[{start_time:.3f}-{start_time + actual_duration:.3f}]"
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

                audio_segments.append({
                    "transcript_index": i,
                    "text": text,
                    "speaker": speaker,
                    "voice_id": raw.get("voice_id", ""),
                    "speed": raw.get("speed", 1.0),
                    "path": final_path,
                    "start": start_time,
                    "end": start_time + actual_duration,
                    "duration": actual_duration,
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
                    "original_start": round(seg["start"], 3),
                    "original_end": round(seg.get("original_end", seg["end"]), 3),
                    "tts_duration": round(seg["duration"], 3),
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

            success = await asyncio.to_thread(
                self._merge_audio_segments,
                audio_segments,
                merged_audio,
                video_duration,
            )
            
            if not success:
                raise RuntimeError("Failed to merge audio segments (ffmpeg error).")

            # accompaniment_path was set earlier from the Demucs run at the top
            output_video = os.path.join(output_dir, f"dubbed_{target_norm}.mp4")
            success = await asyncio.to_thread(
                self._replace_audio_in_video, video_path, merged_audio, output_video,
                accompaniment_path,
            )
            
            if success:
                logger.info(f"Dubbed video created: {output_video}")
                engine_summary = "unknown"
                if tts_engines:
                    unique_engines = set(tts_engines)
                    if len(unique_engines) == 1:
                        engine_summary = next(iter(unique_engines))
                    else:
                        engine_summary = "mixed"
                self._write_segments_json(
                    job_id, target_norm, audio_segments, output_dir,
                    video_path=video_path,
                    accompaniment_path=accompaniment_path,
                    video_duration=video_duration,
                )
                return {
                    "output_path": output_video,
                    "tts_engine": engine_summary,
                    "segment_engines": segment_engines,
                }

            raise RuntimeError("Failed to mux dubbed audio into the video (ffmpeg error).")
                
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
            # rubberband transpose=semitones
            rb_filter = f"rubberband=pitch={n_steps:.1f}:formant=on"
            cmd = ["ffmpeg", "-y", "-i", input_path, "-filter:a", rb_filter, "-vn", output_path]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                return True
            logger.warning(f"ffmpeg rubberband pitch shift failed: {result.stderr[-200:]}")
        except Exception as e:
            logger.warning(f"ffmpeg pitch shift fallback failed: {e}")
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
                # arubberband: formant=on preserves voice resonance during stretch.
                # smoothing=on reduces phasing artefacts at >1.3×.
                # transients=crisp keeps consonant clarity.
                rb_filter = (
                    f"rubberband=tempo={speed_factor:.4f}"
                    ":formant=on:smoothing=on:transients=crisp"
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
    
    def _merge_audio_segments(
        self,
        segments: List[Dict],
        output_path: str,
        total_duration: float,
    ) -> bool:
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
            logger.error(f"Merge error: {e}")
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
            logger.error(f"Simple concat error: {e}")
            return False
    
    def _replace_audio_in_video(
        self,
        video_path: str,
        audio_path: str,
        output_path: str,
        accompaniment_path: Optional[str] = None,
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
                cmd = [
                    "ffmpeg", "-y",
                    "-i", video_path,
                    "-i", accompaniment_path,
                    "-i", audio_to_use,
                    "-filter_complex",
                    (
                        f"[1:a]volume={accompaniment_level}[bgm];"
                        f"[2:a]volume=3.0[speech];"
                        f"[bgm][speech]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]"
                    ),
                    "-map", "0:v:0",
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
                cmd = [
                    "ffmpeg", "-y",
                    "-i", video_path,
                    "-i", audio_to_use,
                    "-filter_complex",
                    f"{original_filter};[1:a]volume=1.5[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]",
                    "-map", "0:v:0",
                    "-map", "[aout]",
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-movflags", "+faststart",
                    output_path,
                ]
            else:
                # No original audio track; use dubbed audio only.
                cmd = [
                    "ffmpeg", "-y",
                    "-i", video_path,
                    "-i", audio_to_use,
                    "-filter_complex", "[1:a]loudnorm=I=-14:TP=-1.5:LRA=11[aout]",
                    "-map", "0:v:0",
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

    # ------------------------------------------------------------------
    # Segment editor support
    # ------------------------------------------------------------------

    def _write_segments_json(
        self,
        job_id: str,
        language: str,
        audio_segments: List[Dict],
        output_dir: str,
        video_path: str = "",
        accompaniment_path: Optional[str] = None,
        video_duration: float = 0.0,
    ) -> None:
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
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        shutil.copy2(path, snapshot_path)
        logger.info(f"[SEGMENTS] Wrote {len(audio_segments)} segments to {path}")
        from app.services.segment_validation import validate_segments
        validate_segments(job_id, payload["segments"])
        try:
            from app.services.supabase_client import upsert_segments
            loop = asyncio.get_running_loop()
            loop.create_task(upsert_segments(job_id, payload["segments"]))
        except RuntimeError:
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
        live_segment_start: Optional[float] = None,
        live_segment_end: Optional[float] = None,
        live_next_segment_start: Optional[float] = None,
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

        # A locked segment is frozen — refuse to regenerate it here, the single
        # choke point every regen path (HTTP endpoint, bulk/auto) flows through,
        # so nothing but a manual unlock in the editor can overwrite it.
        if seg.get("locked"):
            raise PermissionError(f"Segment {segment_index} is locked — unlock it to regenerate")

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

        previous_text = seg.get("text", "")
        previous_path = seg.get("path", "")

        # Regen always writes to segment_NNNN_regen.mp3, overwriting any prior
        # regen for this segment. edit_history preserves the change record.
        audio_path = os.path.join(output_dir, f"segment_{segment_index:04d}_regen.mp3")

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
        # Delivery Script override: the user authored the exact line + inline [tags]
        # to synthesize. Send it VERBATIM (tags parse, not spoken) and skip the
        # composed directive so we don't double-tag. The clean display text
        # (use_text) still drives seg["text"] / subtitle / timing below.
        if tts_text and tts_text.strip():
            fish_text = tts_text
            directive = ""
        else:
            fish_text = tts_text_processed
            # One composed S2 directive: traits + emotion + nuance delivery/cadence
            # clauses + the free-text write-in from the Nuances panel (last).
            directive = compose_fish_directive(
                emotion=emotion, traits=traits,
                nuance_directives=nuance_directives, extra=custom_nuance,
            )
        result = await fish_audio_tts.text_to_speech(
            text=fish_text,
            voice_id=use_voice_id,
            output_path=audio_path,
            speed=use_speed,
            emotion_tags=directive,
            traits_tag="",  # folded into the composed directive above
        )
        if not result:
            raise RuntimeError(f"TTS failed for segment {segment_index} in job {job_id}")

        final_path = result["path"]

        # Pitch is a post-process, not a Fish parameter: /v1/tts exposes prosody
        # {speed, volume, normalize_loudness} and no pitch field. The editor's pitch
        # slider reached text_to_speech() and was silently dropped there, so the
        # control did nothing whenever Fish was the provider. This mirrors what the
        # main pipeline already does (~line 1078). Runs BEFORE the fit/trim pass
        # below so the fit measures the audio we actually ship.
        if pitch:
            pitched_path = os.path.join(
                output_dir, f"segment_{segment_index:04d}_pitched.mp3"
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
        # Honor timeline drag/resize: committed_* is the source of truth once
        # the user has moved this segment's slot, even before the post-fit
        # sync-back below runs. Without this, a resized segment's fit check
        # uses its original (pre-resize) transcript timing.
        def _effective_start(s: Dict) -> float:
            v = s.get("committed_start_time")
            return float(v) if v is not None else float(s.get("start", 0))

        def _effective_end(s: Dict) -> float:
            v = s.get("committed_end_time")
            return float(v) if v is not None else float(s.get("end", 0))

        backend_slot_start = _effective_start(seg)
        backend_slot_end   = _effective_end(seg)

        # The frontend's live timeline can be ahead of segments.json — a split/resize's
        # commitSegmentTiming sync is fire-and-forget (see dubverse-editor.tsx), so this
        # persisted copy is sometimes stale. Prefer what the user is actually looking at,
        # but only if it's sane; never trust a malformed value from the wire outright.
        def _is_finite_number(v: Optional[float]) -> bool:
            return v is not None and isinstance(v, (int, float)) and math.isfinite(v)

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
        if slot_dur > 0.2:
            trimmed_path = os.path.join(output_dir, f"segment_{segment_index:04d}_regen_notrim.mp3")
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
            if actual_dur > slot_dur + 0.05:
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
                    stretched_path = os.path.join(output_dir, f"segment_{segment_index:04d}_regen_fit.mp3")
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

        # Always measure final audio duration so the frontend can auto-shrink
        # slots that are longer than the actual speech.
        try:
            _final_dur = actual_dur
        except NameError:
            _final_dur = await asyncio.to_thread(self._get_audio_duration, final_path)
        seg["audio_duration"] = round(_final_dur, 3)

        seg["path"] = final_path
        seg["voice_id"] = use_voice_id
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
        # Delivery Script (verbatim line + tags): same contract. Kept separate from
        # seg["text"] so the display/subtitle stays the clean line.
        if tts_text == "":
            seg.pop("tts_text", None)
        elif tts_text:
            seg["tts_text"] = tts_text
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

        data["regenerated_at"] = datetime.utcnow().isoformat() + "Z"
        with open(segments_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        try:
            from app.services.supabase_client import upsert_segments
            asyncio.create_task(upsert_segments(job_id, data["segments"]))
        except Exception as exc:
            logger.warning(
                f"Job {job_id}: segment {segment_index} upsert failed: {exc}"
            )

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
        ok = await asyncio.to_thread(
            self._replace_audio_in_video, video_path, merged_audio, output_video, accompaniment_path
        )
        if not ok:
            raise RuntimeError(f"Remix failed: could not mux audio into video for job {job_id}")

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        data["last_remixed_at"] = datetime.utcnow().isoformat() + "Z"
        with open(segments_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

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
