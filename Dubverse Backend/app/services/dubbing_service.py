import subprocess
import os
import tempfile
from pathlib import Path
import logging
from typing import Optional, List, Dict
import asyncio
import json

from app.services.elevenlabs_tts import elevenlabs_tts
from app.services.fish_audio_tts import fish_audio_tts
from app.services.translation_service import translation_service
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

    def _merge_close_segments(self, transcript: List[Dict], max_gap: float = 1.0) -> List[Dict]:
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
            # Reject ANY segment without CJK characters when the transcript
            # is CJK.  Catches Cyrillic (Согон!), Telugu, Latin-only, and
            # any other wrong-script hallucinations from Whisper.
            if is_cjk_transcript and not cjk_re.search(text) and len(text.strip()) > 1:
                logger.info(f"[CLEAN] Dropped wrong-script segment: {text[:60]!r}")
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

    def _build_speaker_voice_map(
        self,
        transcript: List[Dict],
        voice_mapping: Dict[str, str],
        speaker_genders: Optional[Dict[str, str]] = None,
    ) -> Dict[str, str]:
        unique_speakers = self._stable_unique_speakers(transcript)

        def _speaker_index(speaker_id: str) -> Optional[int]:
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

        # ------------------------------------------------------------------ #
        # Pass 1: match by explicit key from the frontend voice_mapping.      #
        # Tries multiple key formats so "voice-1", "speaker-1", "SPEAKER_00" #
        # etc. all resolve correctly regardless of which the frontend sends.  #
        # ------------------------------------------------------------------ #
        speaker_to_voice: Dict[str, str] = {}
        if voice_mapping:
            for speaker in unique_speakers:
                # Direct key hit
                if speaker in voice_mapping and voice_mapping[speaker]:
                    speaker_to_voice[speaker] = voice_mapping[speaker]
                    continue

                # Index-based fallback: try all common key formats including
                # "voice-N" which is what the frontend currently sends.
                idx = _speaker_index(speaker)
                if idx is not None:
                    candidate_keys = [
                        f"speaker-{idx + 1}",
                        f"voice-{idx + 1}",       # frontend sends "voice-1", "voice-2", …
                        f"speaker_{idx}",
                        f"SPEAKER_{idx:02d}",
                        f"SPEAKER_{idx}",
                    ]
                    for key in candidate_keys:
                        if key in voice_mapping and voice_mapping[key]:
                            speaker_to_voice[speaker] = voice_mapping[key]
                            logger.info(
                                f"[VOICE MAP] {speaker} matched via key '{key}' "
                                f"-> {voice_mapping[key]}"
                            )
                            break

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
        # Pass 3: last-resort fallback — distribute provided voice values     #
        # round-robin so speakers don't all collapse to one voice.            #
        # ------------------------------------------------------------------ #
        if unmatched:
            voice_values: List[str] = []
            if voice_mapping:
                seen: set = set()
                for value in voice_mapping.values():
                    if value and value not in seen:
                        seen.add(value)
                        voice_values.append(value)

            for i, speaker in enumerate(unmatched):
                if voice_values:
                    fallback = voice_values[i % len(voice_values)]
                else:
                    fallback = "pNInz6obpgDQGcFmaJgB"  # Adam (male)
                speaker_to_voice[speaker] = fallback
                logger.info(f"[VOICE MAP] {speaker} fallback round-robin -> {fallback}")

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

        # Sort each speaker's segments: prefer early, calm segments over long
        # fight-scene clips.  Early segments (0-30s) are typically calm
        # introductions — Fish Audio clones the vocal *style* from references,
        # so excited references → excited output for every segment.
        # Score: lower start time = better, moderate duration (3-8s) preferred.
        for spk in speaker_segments:
            speaker_segments[spk].sort(
                key=lambda s: (
                    0 if 3.0 <= s["duration"] <= 8.0 else 1,  # ideal length first
                    s["start"],                                 # then earliest
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
                        "text": seg["text"],
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
            if provider_name_check == "fish-audio" and vocals_path:
                logger.info("[VOICE-CLONE] Fish Audio active — extracting speaker references from vocals")
                speaker_voice_refs = self._extract_speaker_references(
                    transcript, vocals_path, output_dir
                )
                if speaker_voice_refs:
                    logger.info(
                        f"[VOICE-CLONE] Extracted references for {len(speaker_voice_refs)} speaker(s): "
                        f"{', '.join(f'{k}={len(v)} clips' for k, v in speaker_voice_refs.items())}"
                    )
                else:
                    logger.warning("[VOICE-CLONE] No references extracted — will use pre-uploaded voices or defaults")

            source_norm = normalize_language_code(source_language, allow_auto=True)
            target_norm = normalize_language_code(target_language)

            if source_norm != source_language or target_norm != target_language:
                logger.info(
                    f"Normalized languages: source={source_language} -> {source_norm}, "
                    f"target={target_language} -> {target_norm}"
                )

            if source_norm != target_norm:
                logger.info(f"Translating transcript from {source_norm} to {target_norm}")
                transcript = await translation_service.translate_segments(
                    transcript,
                    source_norm,
                    target_norm
                )
                logger.info(f"Translation complete for {len(transcript)} segments")
                if transcript:
                    logger.info(f"Sample translated text: {transcript[0].get('text', '')[:100]}")

                # Drop segments whose translation is empty (glossary suppressed) or
                # a single-token noise word (fight grunt residue, hallucination).
                _NOISE_WORDS = {
                    "you", "it", "he", "she", "they", "i", "we",
                    "sa", "ha", "oh", "ah", "uh", "bobo", "babo",
                    "the", "a", "an",
                }
                before_drop = len(transcript)
                transcript = [
                    s for s in transcript
                    if s.get("text", "").strip()
                    and s.get("text", "").strip().lower().rstrip(".,!?") not in _NOISE_WORDS
                ]
                if len(transcript) != before_drop:
                    logger.info(
                        f"[CLEAN] Dropped {before_drop - len(transcript)} post-translation noise segment(s)"
                    )
            
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
                text = segment.get("text", "")
                speaker = segment.get("speaker", "speaker-1")

                if not text.strip():
                    return {"index": i, "skipped": True, "reason": "empty"}

                text = self._sanitize_text(text)

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

                tts_kwargs: Optional[Dict] = dict(
                    text=text,
                    voice_id=voice_id,
                    output_path=audio_path,
                    model_id=model_id,
                    stability=stability,
                    similarity_boost=similarity_boost,
                    style=style,
                    language=target_norm,
                )

                result = None
                speaker_gender = (speaker_genders or {}).get(speaker, "male")

                if speaker_gender == "child":
                    logger.info(
                        f"[CHILD-VOICE] seg {i} speaker={speaker} provider={provider_name}: "
                        f"routing to Edge TTS child voice"
                    )
                    child_result = await elevenlabs_tts._fallback_tts(
                        text, audio_path, target_norm, voice_key, "child"
                    )
                    if child_result:
                        result = {"path": child_result, "engine": "edge-tts-child"}
                        tts_kwargs = None
                    else:
                        logger.warning(
                            f"[CHILD-VOICE] Edge TTS child voice failed for seg {i}, "
                            f"falling back to normal TTS"
                        )

                if provider_name == "fish-audio" and tts_kwargs is not None:
                    fish_tags = analyze_emotion_fish(text)
                    tts_kwargs["emotion_tags"] = fish_tags
                    if speaker in speaker_voice_refs:
                        tts_kwargs["speaker_references"] = speaker_voice_refs[speaker]

                    # Pre-compute Fish Audio speed parameter for duration targeting.
                    # Estimate: English ~3.5 words/sec at 1.0x, target slot is end-start.
                    # If estimated TTS duration exceeds the slot, speed up at the TTS
                    # level (better quality than post-hoc ffmpeg atempo).
                    seg_slot = float(segment.get("end", 0)) - float(segment.get("start", 0))
                    if seg_slot > 0.3:
                        word_count = len(text.split())
                        est_tts_dur = max(0.5, word_count / 3.5)
                        if est_tts_dur > seg_slot * 1.1:
                            # Need to speed up — clamp to Fish Audio range [0.5, 2.0]
                            speed_hint = min(2.0, max(1.0, est_tts_dur / seg_slot))
                            tts_kwargs["speed"] = round(speed_hint, 2)
                            logger.info(
                                f"[FISH-SPEED] seg {i}: est={est_tts_dur:.1f}s slot={seg_slot:.1f}s "
                                f"-> speed={speed_hint:.2f}x"
                            )

                    logger.info(
                        f"[EMOTION-FISH] seg {i} speaker={speaker} "
                        f"gender={speaker_gender} tags={fish_tags!r} "
                        f"refs={len(speaker_voice_refs.get(speaker, []))} "
                        f"text={text[:60]!r}"
                    )
                elif tts_kwargs is not None:
                    logger.info(
                        f"[EMOTION] seg {i} speaker={speaker} "
                        f"stability={stability} style={style} text={text[:60]!r}"
                    )

                if tts_kwargs is not None:
                    result = await tts_provider.text_to_speech(**tts_kwargs)

                if result:
                    logger.info(f"Segment {i}: provider={provider_name}, speaker={speaker}, voice_id={voice_id}, text={text[:50]}...")
                    return {"index": i, "result": result, "text": text, "speaker": speaker}
                else:
                    logger.warning(f"Failed to generate TTS for segment {i}")
                    return {"index": i, "failed": True}

            logger.info(f"[TTS] Launching {len(transcript)} TTS calls in parallel...")
            tts_results = await asyncio.gather(
                *[_synthesise_one(i, seg) for i, seg in enumerate(transcript)],
                return_exceptions=False,
            )
            logger.info("[TTS] All parallel TTS calls complete — running fit/trim pass")

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
                    target_duration = max(0.2, next_start - start_time - 0.05)
                else:
                    target_duration = max(0.2, end_time - start_time)

                final_path = result["path"]
                adjusted_audio_path = os.path.join(output_dir, f"segment_{i:04d}_adjusted.mp3")
                actual_duration = await asyncio.to_thread(self._get_audio_duration, final_path)

                max_speedup = float(os.getenv("DUBBING_MAX_SPEEDUP", "1.8"))
                if actual_duration > target_duration + 0.05 and target_duration > 0.3:
                    speed_needed = actual_duration / target_duration
                    adjusted = await asyncio.to_thread(
                        self._adjust_audio_duration,
                        final_path, adjusted_audio_path, target_duration,
                        min_speed=0.8, max_speed=max_speedup,
                    )
                    if adjusted and os.path.exists(adjusted_audio_path):
                        final_path = adjusted_audio_path
                        actual_duration = await asyncio.to_thread(self._get_audio_duration, final_path)
                        if speed_needed <= max_speedup:
                            logger.info(f"[FIT] seg={i} sped up {speed_needed:.2f}x to fit slot")
                        else:
                            logger.info(f"[FIT] seg={i} sped up {max_speedup}x (needed {speed_needed:.2f}x, will trim remainder)")

                if actual_duration > target_duration + 0.05:
                    trimmed_path = os.path.join(output_dir, f"segment_{i:04d}_trimmed.mp3")
                    trimmed = await asyncio.to_thread(self._trim_audio_duration, final_path, trimmed_path, target_duration)
                    if trimmed:
                        final_path = trimmed_path
                        actual_duration = target_duration
                        logger.warning(f"[FIT] seg={i} hard-trimmed to {target_duration:.2f}s (speech may be cut)")

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

                audio_segments.append({
                    "text": text,
                    "speaker": speaker,
                    "path": final_path,
                    "start": start_time,
                    "end": start_time + actual_duration,
                    "duration": actual_duration,
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

            merged_audio = os.path.join(output_dir, "dubbed_audio.mp3")
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
                gap_gen, _ = model.transcribe(
                    gap_waveform,
                    beam_size=5,
                    condition_on_previous_text=False,
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
        Return duration in seconds without spawning a subprocess.

        Strategy (fastest first):
        1. WAV/FLAC/OGG/AIFF  — soundfile reads the header in pure Python (~0ms).
        2. MP3                 — scan MPEG frame headers in pure Python (~1-5ms).
        3. Fallback            — ffprobe subprocess (original behaviour).
        """
        try:
            ext = os.path.splitext(audio_path)[1].lower()

            # --- soundfile path (lossless / uncompressed formats) ---
            if ext in (".wav", ".flac", ".ogg", ".aiff", ".aif"):
                import soundfile as _sf
                info = _sf.info(audio_path)
                return float(info.duration)

            # --- pure-Python MP3 frame scan ---
            if ext == ".mp3":
                dur = self._mp3_duration_fast(audio_path)
                if dur > 0:
                    return dur

            # --- fallback: ffprobe ---
            result = subprocess.run(
                [
                    "ffprobe", "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "json", audio_path,
                ],
                capture_output=True,
                text=True,
            )
            data = json.loads(result.stdout)
            return float(data["format"]["duration"])

        except Exception as e:
            logger.error(f"Failed to get audio duration: {e}")
            return 0.0

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
    
    def _adjust_audio_duration(
        self,
        input_path: str,
        output_path: str,
        target_duration: float,
        min_speed: float = 0.5,
        max_speed: float = 2.0,
    ) -> bool:
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
                import shutil
                shutil.copy(input_path, output_path)
                return True
            
            cmd = [
                "ffmpeg", "-y",
                "-i", input_path,
                "-filter:a", f"atempo={speed_factor}",
                "-vn",
                output_path
            ]
            
            if speed_factor > 2.0:
                cmd = [
                    "ffmpeg", "-y",
                    "-i", input_path,
                    "-filter:a", f"atempo=2.0,atempo={speed_factor/2.0}",
                    "-vn",
                    output_path
                ]
            elif speed_factor < 0.5:
                cmd = [
                    "ffmpeg", "-y",
                    "-i", input_path,
                    "-filter:a", f"atempo=0.5,atempo={speed_factor/0.5}",
                    "-vn",
                    output_path
                ]
            
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                logger.error(f"FFmpeg tempo adjustment error: {result.stderr}")
                return False
            
            logger.info(f"Adjusted audio speed by {speed_factor:.2f}x ({actual_duration:.2f}s -> {target_duration:.2f}s)")
            return os.path.exists(output_path)
            
        except Exception as e:
            logger.error(f"Audio duration adjustment error: {e}")
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

            # Delay each segment to its correct position.
            # Boost each by n_inputs to compensate for amix dividing by N.
            for i, seg in enumerate(segments_sorted):
                input_idx = i + 1
                delay_ms = int(seg["start"] * 1000)
                filter_parts.append(
                    f"[{input_idx}]adelay={delay_ms}|{delay_ms},apad=whole_dur={total_duration},volume={n_inputs}[delayed{i}]"
                )
            delayed_labels = "".join(f"[delayed{i}]" for i in range(len(segments_sorted)))
            filter_parts.append(
                f"[0]{delayed_labels}amix=inputs={n_inputs}:duration=first:normalize=0[mixout]"
            )

            final_label = "[mixout]"

            filter_complex = ";".join(filter_parts)
            
            cmd = ["ffmpeg", "-y"] + inputs + [
                "-filter_complex", filter_complex,
                "-map", final_label,
                "-t", str(total_duration),
                "-ar", "44100",
                "-ac", "2",
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
            
            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", concat_list,
                "-t", str(total_duration),
                "-ar", "44100",
                "-ac", "2",
                output_path
            ]
            
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

            boost_cmd = [
                "ffmpeg", "-y",
                "-i", audio_path,
                "-filter:a", "loudnorm=I=-14:TP=-1.5:LRA=11",
                "-ar", "44100",
                "-ac", "2",
                audio_path + ".normalized.wav"
            ]
            boost_result = subprocess.run(boost_cmd, capture_output=True, text=True)

            if boost_result.returncode == 0:
                audio_to_use = audio_path + ".normalized.wav"
                logger.info("Normalized dubbed audio volume")
            else:
                audio_to_use = audio_path
                logger.warning(f"Volume normalization failed: {boost_result.stderr}")

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
                        f"[2:a]volume=1.5[speech];"
                        f"[bgm][speech]amix=inputs=2:duration=longest:normalize=0[aout]"
                    ),
                    "-map", "0:v:0",
                    "-map", "[aout]",
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-b:a", "192k",
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
                    f"{original_filter};[1:a]volume=1.5[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0[aout]",
                    "-map", "0:v:0",
                    "-map", "[aout]",
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    output_path,
                ]
            else:
                # No original audio track; use dubbed audio only.
                cmd = [
                    "ffmpeg", "-y",
                    "-i", video_path,
                    "-i", audio_to_use,
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-map", "0:v:0",
                    "-map", "1:a:0",
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


dubbing_service = DubbingService()
