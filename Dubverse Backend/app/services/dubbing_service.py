import subprocess
import os
from pathlib import Path
import logging
from typing import Optional, List, Dict
import asyncio
import json

from app.services.elevenlabs_tts import elevenlabs_tts
from app.services.translation_service import translation_service
from app.config import get_settings
from app.utils.language import normalize_language_code
from app.utils.emotion import analyze_emotion
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
            if seg_duration > 0.6:
                continue

            prev_speaker = prev_seg.get("speaker")
            next_speaker = next_seg.get("speaker")
            if prev_speaker and prev_speaker == next_speaker and seg.get("speaker") != prev_speaker:
                seg["speaker"] = prev_speaker

        return transcript

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

            # Stabilize speaker assignments to prevent voice jumping.
            transcript = self._stabilize_speakers(transcript)

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
            
            audio_segments = []
            tts_engines: List[str] = []
            segment_engines: List[Optional[str]] = [None for _ in transcript]
            
            unique_speakers = self._stable_unique_speakers(transcript)
            logger.info(f"Unique speakers in transcript (stable): {unique_speakers}")
            logger.info(f"Voice mapping received: {voice_mapping}")

            speaker_to_voice = self._build_speaker_voice_map(
                transcript, voice_mapping, speaker_genders
            )
            
            logger.info(f"Speaker to voice assignment: {speaker_to_voice}")
            
            for i, segment in enumerate(transcript):
                text = segment.get("text", "")
                speaker = segment.get("speaker", "speaker-1")
                start_time = segment.get("start", 0)
                end_time = segment.get("end", 0)
                next_start = transcript[i + 1].get("start", None) if i + 1 < len(transcript) else None
                
                if not text.strip():
                    segment_engines[i] = "skipped"
                    continue

                text = self._sanitize_text(text)

                # Skip duplicate short segments for the same speaker.
                if audio_segments:
                    prev = audio_segments[-1]
                    prev_text = prev.get("text")
                    prev_speaker = prev.get("speaker")
                    if prev_speaker == speaker and prev_text == text and (start_time - prev.get("end", 0)) <= 0.3:
                        logger.warning(f"Skipping duplicate segment for speaker={speaker}: {text[:30]}...")
                        segment_engines[i] = "skipped"
                        continue
                
                voice_key = speaker_to_voice.get(speaker, "pNInz6obpgDQGcFmaJgB")
                
                voice_id = elevenlabs_tts.get_voice_id(voice_key)
                model_id = elevenlabs_tts.get_model_for_language(target_norm)
                
                logger.info(f"Segment {i}: speaker={speaker}, voice_id={voice_id}, text={text[:50]}...")
                
                audio_path = os.path.join(output_dir, f"segment_{i:04d}.mp3")
                adjusted_audio_path = os.path.join(output_dir, f"segment_{i:04d}_adjusted.mp3")
                
                # Per-utterance emotion analysis (Fix 3).
                # Caller voice_settings take priority; fall back to emotion-driven defaults.
                emotion_defaults = analyze_emotion(text)
                override = (voice_settings or {}).get(speaker, {})
                stability        = override.get("stability",        emotion_defaults["stability"])
                similarity_boost = override.get("similarity_boost", emotion_defaults["similarity_boost"])
                style            = override.get("style",            emotion_defaults["style"])
                logger.info(
                    f"[EMOTION] seg {i} speaker={speaker} "
                    f"stability={stability} style={style} text={text[:60]!r}"
                )

                result = await elevenlabs_tts.text_to_speech(
                    text=text,
                    voice_id=voice_id,
                    output_path=audio_path,
                    model_id=model_id,
                    stability=stability,
                    similarity_boost=similarity_boost,
                    style=style,
                    language=target_norm,
                )
                
                if result:
                    tts_engines.append(result.get("engine", "unknown"))
                    segment_engines[i] = result.get("engine", "unknown")
                    if next_start is not None:
                        target_duration = max(0.2, min(end_time, next_start) - start_time)
                    else:
                        target_duration = max(0.2, end_time - start_time)
                    use_time_stretch = os.getenv("DUBBING_TIME_STRETCH", "0") == "1"
                    if use_time_stretch and target_duration > 0.5:
                        adjusted = await asyncio.to_thread(
                            self._adjust_audio_duration,
                            result["path"], adjusted_audio_path, target_duration,
                            min_speed=0.9, max_speed=1.1
                        )
                        final_path = adjusted_audio_path if adjusted and os.path.exists(adjusted_audio_path) else result["path"]
                    else:
                        # Keep natural speech rate to avoid speed fluctuations.
                        final_path = result["path"]

                    # Trim if the generated audio exceeds its slot to avoid overlaps.
                    actual_duration = await asyncio.to_thread(self._get_audio_duration, final_path)
                    if actual_duration > target_duration + 0.05:
                        trimmed_path = os.path.join(output_dir, f"segment_{i:04d}_trimmed.mp3")
                        trimmed = await asyncio.to_thread(self._trim_audio_duration, final_path, trimmed_path, target_duration)
                        if trimmed:
                            final_path = trimmed_path
                            actual_duration = target_duration
                    
                    # --- TIMING DIAGNOSTICS ---
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
                else:
                    logger.warning(f"Failed to generate TTS for segment {i}")
                    segment_engines[i] = "failed"
            
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
            timing_report = []
            for idx, seg in enumerate(audio_segments):
                entry = {
                    "index": idx,
                    "speaker": seg["speaker"],
                    "text": seg["text"][:80],
                    "placed_start": round(seg["start"], 3),
                    "placed_end": round(seg["end"], 3),
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
            video_duration = await asyncio.to_thread(self._get_video_duration, video_path)
            
            success = await asyncio.to_thread(
                self._merge_audio_segments,
                audio_segments,
                merged_audio,
                video_duration,
            )
            
            if not success:
                raise RuntimeError("Failed to merge audio segments (ffmpeg error).")
            
            # --- Source separation: isolate background music from original speech ---
            # Runs Demucs on the original video audio to produce a clean accompaniment
            # track (music/SFX only, no original speech). This is remixed at full volume
            # instead of blending the whole original track at 12%.
            # Falls back to the legacy blend if separation is disabled or fails.
            sep_result = await asyncio.to_thread(separate_audio, video_path, job_id)
            accompaniment_path = (
                sep_result.get("accompaniment_path")
                if sep_result["status"] == "ok"
                else None
            )
            if accompaniment_path:
                logger.info(
                    f"[SEPARATE] Using ML-separated accompaniment for final mix "
                    f"(model={sep_result.get('model')}): {accompaniment_path}"
                )
            else:
                logger.info(
                    f"[SEPARATE] Falling back to legacy audio blend "
                    f"(reason: {sep_result.get('reason', 'unknown')})"
                )

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
        try:
            result = subprocess.run(
                [
                    "ffprobe", "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "json", audio_path
                ],
                capture_output=True,
                text=True,
            )
            data = json.loads(result.stdout)
            return float(data["format"]["duration"])
        except Exception as e:
            logger.error(f"Failed to get audio duration: {e}")
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

            # Delay each segment to its correct position
            for i, seg in enumerate(segments_sorted):
                input_idx = i + 1
                delay_ms = int(seg["start"] * 1000)
                filter_parts.append(
                    f"[{input_idx}]adelay={delay_ms}|{delay_ms},apad=whole_dur={total_duration}[delayed{i}]"
                )

            # Single N-input amix: silent base + all delayed segments
            n_inputs = 1 + len(segments_sorted)  # base + segments
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
                "-filter:a", "loudnorm=I=-18:TP=-2:LRA=11",
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
                        f"[2:a]volume=1.0[speech];"
                        f"[bgm][speech]amix=inputs=2:duration=shortest:normalize=0[aout]"
                    ),
                    "-map", "0:v:0",
                    "-map", "[aout]",
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-shortest",
                    output_path,
                ]
            elif _video_has_audio(video_path):
                # Legacy fallback: blend the whole original audio (speech + music) at
                # a low level so background music is audible but speech bleed is quiet.
                original_level = float(os.getenv("ORIGINAL_AUDIO_LEVEL", "0.12"))
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
                    f"{original_filter};[1:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=shortest:normalize=0[aout]",
                    "-map", "0:v:0",
                    "-map", "[aout]",
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-shortest",
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
                    "-shortest",
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
