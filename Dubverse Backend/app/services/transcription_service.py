import os
import subprocess
import json
import logging
from typing import Optional, List, Dict
from pathlib import Path

from app.models import Transcript, TranscriptSegment

logger = logging.getLogger(__name__)


class TranscriptionService:
    def __init__(self):
        self.model_size = "medium"
        self._model = None
    
    def _get_model(self):
        if self._model is None:
            try:
                import torch
                from faster_whisper import WhisperModel
                _device = "cuda" if torch.cuda.is_available() else "cpu"
                _compute = "float16" if _device == "cuda" else "int8"
                self._model = WhisperModel(
                    self.model_size,
                    device=_device,
                    compute_type=_compute,
                )
                logger.info(f"Loaded Whisper model: {self.model_size} on {_device}")
            except Exception as e:
                logger.error(f"Failed to load Whisper model: {e}")
                raise
        return self._model
    
    def extract_audio_from_video(self, video_path: str, output_path: str) -> bool:
        try:
            cmd = [
                "ffmpeg", "-y",
                "-i", video_path,
                "-vn",
                "-acodec", "pcm_s16le",
                "-ar", "16000",
                "-ac", "1",
                output_path
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                logger.error(f"FFmpeg error: {result.stderr}")
                return False
            return os.path.exists(output_path)
        except Exception as e:
            logger.error(f"Audio extraction error: {e}")
            return False
    
    def _detect_speakers(self, segments: List[Dict], expected_speakers: int = 3) -> List[Dict]:
        """
        Speaker detection based on timing gaps and segment distribution.
        Uses multiple heuristics to detect speaker changes.
        """
        if not segments:
            return segments
        
        total_segments = len(segments)
        
        if total_segments <= 1:
            segments[0]["speaker"] = "SPEAKER_00"
            return segments
        
        gaps = []
        for i in range(1, len(segments)):
            gap = segments[i]["start"] - segments[i-1]["end"]
            gaps.append((i, gap))
        
        gaps.sort(key=lambda x: x[1], reverse=True)
        
        change_points = set([0])
        for i in range(min(expected_speakers - 1, len(gaps))):
            if gaps[i][1] > 0.3:
                change_points.add(gaps[i][0])
        
        if len(change_points) < expected_speakers and total_segments >= expected_speakers:
            segment_size = total_segments // expected_speakers
            for i in range(1, expected_speakers):
                change_points.add(i * segment_size)
        
        sorted_changes = sorted(change_points)
        
        speaker_assignments = {}
        current_speaker = 0
        for i, change_idx in enumerate(sorted_changes):
            speaker_assignments[change_idx] = i % expected_speakers
        
        current_speaker = 0
        for i, seg in enumerate(segments):
            if i in speaker_assignments:
                current_speaker = speaker_assignments[i]
            seg["speaker"] = f"SPEAKER_{current_speaker:02d}"
        
        unique_speakers = len(set(s["speaker"] for s in segments))
        logger.info(f"Detected {unique_speakers} speakers across {total_segments} segments")
        
        return segments
    
    def transcribe_audio(self, audio_path: str, expected_speakers: int = 3) -> Optional[Transcript]:
        try:
            model = self._get_model()
            
            segments_list, info = model.transcribe(
                audio_path,
                beam_size=5,
                word_timestamps=True,
                vad_filter=True,
            )
            
            raw_segments = []
            full_text_parts = []
            
            for seg in segments_list:
                raw_segments.append({
                    "text": seg.text.strip(),
                    "start": round(seg.start, 3),
                    "end": round(seg.end, 3),
                })
                full_text_parts.append(seg.text.strip())
            
            detected_segments = self._detect_speakers(raw_segments, expected_speakers)
            
            segments = [
                TranscriptSegment(
                    text=s["text"],
                    start=s["start"],
                    end=s["end"],
                    speaker=s["speaker"],
                )
                for s in detected_segments
            ]
            
            transcript = Transcript(
                language=info.language or "en",
                duration=info.duration or 0.0,
                text=" ".join(full_text_parts),
                segments=segments,
            )
            
            unique_speakers = len(set(s.speaker for s in segments))
            logger.info(f"Transcribed {len(segments)} segments with {unique_speakers} speakers, language: {transcript.language}")
            return transcript
            
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return None
    
    def transcribe_video(self, video_path: str, job_id: str, expected_speakers: int = 3) -> Optional[Transcript]:
        audio_dir = Path("data/audio")
        audio_dir.mkdir(parents=True, exist_ok=True)
        
        audio_path = str(audio_dir / f"{job_id}.wav")
        
        logger.info(f"Extracting audio from {video_path}")
        if not self.extract_audio_from_video(video_path, audio_path):
            logger.error("Failed to extract audio")
            return None
        
        logger.info(f"Transcribing audio: {audio_path}")
        transcript = self.transcribe_audio(audio_path, expected_speakers)
        
        if os.path.exists(audio_path):
            os.remove(audio_path)
        
        return transcript


transcription_service = TranscriptionService()
