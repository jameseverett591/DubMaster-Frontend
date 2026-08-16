"""
Post-dub quality analysis pipeline.

Runs up to 14 sub-analyses and produces a quality report:
  - 5 local: retranscription, timing, silences, speed, loudness
  - 2 ScreenApp (optional)
  - 1 Hume AI emotion/prosody (optional)
  - 1 Azure Speech pronunciation (optional)
  - 1 Azure OpenAI translation evaluation (optional)
  - 1 SyncNet lip-sync scoring (local, free)
  - 1 emotion2vec emotion preservation (local, free)
  - 1 Gemini 2.5 Pro holistic video+audio QC (optional, ~$0.12/video)
  - 1 Claude QC report synthesis (optional)

Returns a status dict — never raises exceptions.

Results saved to: data/dubbed/{job_id}/analysis_{language}.json
Progress tracked via: data/dubbed/{job_id}/analysis_{language}.running
"""

import json
import logging
import os
import subprocess
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)


def analyze_dub(
    job_id: str,
    target_language: str,
    original_video_path: str,
) -> Dict[str, Any]:
    """
    Run quality analysis on a dub.

    Runs against the exported dubbed_{lang}.mp4 when it exists (unchanged
    behavior). When no export exists yet, builds a lightweight internal
    audio-only stitch of the CURRENT segment audio -- reusing the exact merge
    step dubbing_service.remix_dub itself calls, deliberately skipping
    remix_dub's separate video-mux step, which none of the 5 local analyses
    below need. This is what lets the existing automatic trigger-on-editor-
    open (page.tsx) succeed instead of permanently 404ing until Export runs.

    lip_sync/emotion_preservation/pronunciation/screenapp_dubbed/gemini_review
    all need real video frames or are otherwise video-dependent -- they report
    "skipped" (same graceful pattern already used for a missing API key) until
    an export exists. A proper no-export lip-sync path via
    analyze_segment_lip_sync is a separate, following commit.

    Args:
        job_id: The dubbing job ID
        target_language: Target language code (e.g. "en")
        original_video_path: Path to the original source video

    Returns:
        {"status": "ok", "analysis": {...}} or {"status": "error", "reason": ...}
    """
    dubbed_dir = Path("data/dubbed") / job_id
    lang_norm = target_language.lower().strip()
    dubbed_video = dubbed_dir / f"dubbed_{lang_norm}.mp4"
    segments_file = dubbed_dir / "segments.json"
    timing_file = dubbed_dir / "timing_diagnostics.json"
    transcript_file = Path("data/transcripts") / f"{job_id}.json"
    output_file = dubbed_dir / f"analysis_{lang_norm}.json"
    sentinel = dubbed_dir / f"analysis_{lang_norm}.running"

    # Create sentinel to indicate analysis in progress
    try:
        sentinel.touch()
    except Exception:
        pass

    try:
        has_export = dubbed_video.exists()
        audio_source: Optional[Path] = None

        if has_export:
            audio_source = dubbed_video
        else:
            # No export yet -- stitch CURRENT segment audio only. Reuses the
            # exact function dubbing_service.remix_dub calls for its own audio
            # step; overwritten every run (ffmpeg -y), never accumulates, and
            # its qc_preview_ prefix keeps it unambiguous against the real
            # export artifacts (dubbed_{lang}.mp4, dubbed_audio.wav).
            if not segments_file.exists():
                return {"status": "error", "reason": "No segments available yet"}
            with open(segments_file, "r", encoding="utf-8") as f:
                seg_data = json.load(f)
            segs = seg_data.get("segments", [])
            merge_segments = [
                {"path": s["path"], "start": s["start"], "end": s["end"]}
                for s in segs if s.get("path")
            ]
            if not merge_segments:
                return {"status": "error", "reason": "No generated audio yet"}

            from app.services.dubbing_service import dubbing_service
            video_duration = seg_data.get("video_duration") or 0.0
            if not video_duration:
                video_duration = dubbing_service._get_video_duration(original_video_path)

            stitched_audio = dubbed_dir / f"qc_preview_audio_{lang_norm}.wav"
            ok = dubbing_service._merge_audio_segments(
                merge_segments, str(stitched_audio), video_duration
            )
            if not ok:
                return {"status": "error", "reason": "Could not build preview audio for QC"}
            audio_source = stitched_audio

        analysis: Dict[str, Any] = {
            "job_id": job_id,
            "target_language": lang_norm,
            "dubbed_video": str(dubbed_video) if has_export else None,
            # Unique per run — lets the editor tell a fresh re-analysis result
            # apart from the previous one (the GET endpoint can serve the prior
            # result while a re-run is still in flight).
            "generated_at": datetime.utcnow().isoformat() + "Z",
        }

        # Load timing diagnostics (generated by dubbing_service)
        timing_data = None
        if timing_file.exists():
            with open(timing_file, "r", encoding="utf-8") as f:
                timing_data = json.load(f)

        # Load original transcript
        original_transcript = None
        if transcript_file.exists():
            with open(transcript_file, "r", encoding="utf-8") as f:
                original_transcript = json.load(f)

        # --- 5 local analyses -- work identically whether audio_source is the
        # exported mp4 or the internal audio-only stitch; none read video frames. ---
        analysis["retranscription"] = _retranscribe_dubbed_audio(audio_source, lang_norm)
        analysis["timing"] = _compare_timing(timing_data, original_transcript)
        analysis["silences"] = _detect_silences(audio_source, original_transcript)
        analysis["speed"] = _detect_speed_anomalies(timing_data)
        analysis["loudness"] = _analyze_loudness(audio_source)

        # ScreenApp analyses (optional — graceful skip if not configured, or if
        # no export exists yet: screenapp_dubbed needs real video frames)
        analysis["screenapp_original"] = _screenapp_analyze(
            original_video_path, "original"
        )
        analysis["screenapp_dubbed"] = (
            _screenapp_analyze(str(dubbed_video), "dubbed") if has_export
            else {"status": "skipped", "reason": "video not yet exported"}
        )

        # --- New AI-powered analyses (optional — graceful skip) ---
        # Get original segments and dubbed transcript for the new analyses
        orig_segments = []
        if original_transcript and "segments" in original_transcript:
            orig_segments = original_transcript["segments"]
        source_lang = ""
        if original_transcript:
            source_lang = original_transcript.get("language", "")

        dubbed_segments = []
        retrans = analysis.get("retranscription", {})
        if retrans.get("status") == "ok" and retrans.get("segments"):
            dubbed_segments = retrans["segments"]

        # Combine dubbed segment texts for pronunciation reference
        dubbed_text = " ".join(
            seg.get("text", "") for seg in dubbed_segments
        ).strip()

        analysis["pronunciation"] = (
            _assess_pronunciation(str(dubbed_video), dubbed_text) if has_export
            else {"status": "skipped", "reason": "video not yet exported"}
        )
        analysis["translation"] = _evaluate_translation(
            orig_segments, dubbed_segments, source_lang, lang_norm
        )

        # --- New QC Stack analyses ---
        # SyncNet lip-sync scoring (local, free) -- no-export path is a
        # separate, following commit. For now this keeps running against
        # audio_source; when there's no export it hits syncnet_service's own
        # existing audio-only fallback (no video frames -> "method":
        # "audio-only") rather than erroring, exactly the same as if OpenCV/
        # face-detection were unavailable today.
        # DISABLED by default — the metric cannot mean what the panel implies.
        #
        # DubMaster replaces audio and leaves the video untouched: the mouth on
        # screen is performing the ORIGINAL language while the audio is the
        # translation. Envelope correlation between the two is therefore near
        # zero by construction, and a perfectly paced dub scores the same as a
        # broken one. Observed correlations sit at ~0.04 with the offset pinned
        # at the edge of the search window — the signature of noise, not sync.
        # The 30/100 it reported was a null reading presented as a judgement.
        #
        # This is not a bug in syncnet_service: measuring lip-sync only becomes
        # meaningful once the stack actually MODIFIES the video to match the
        # dub. Re-enable with DUBMASTER_ENABLE_LIP_SYNC=1 when a lip-sync model
        # is in the pipeline and there is something real to score.
        if os.getenv("DUBMASTER_ENABLE_LIP_SYNC", "").strip() == "1":
            analysis["lip_sync"] = _analyze_lip_sync(
                str(audio_source), timing_data
            )
        else:
            analysis["lip_sync"] = {
                "status": "skipped",
                "reason": "video is not lip-synced by this pipeline; "
                          "audio/video correlation carries no signal",
            }
        # emotion2vec emotion preservation (local, free) -- needs real video
        # frames for its dubbed-side extraction as currently implemented;
        # skipped until export exists, same as pronunciation/screenapp above.
        analysis["emotion_preservation"] = (
            _analyze_emotion_preservation(original_video_path, str(dubbed_video), timing_data)
            if has_export else {"status": "skipped", "reason": "video not yet exported"}
        )
        # Gemini 2.5 Pro holistic review (optional, ~$0.12/video) -- needs real
        # video frames; skipped until export exists.
        analysis["gemini_review"] = (
            _gemini_review(original_video_path, str(dubbed_video), lang_norm, source_lang, timing_data)
            if has_export else {"status": "skipped", "reason": "video not yet exported"}
        )
        # Claude QC report synthesis (optional)
        analysis["qc_report"] = _generate_qc_report(analysis, job_id)

        # Compute summary score
        analysis["summary"] = _compute_summary(analysis)

        # Save results (convert numpy types to native Python for JSON)
        def _make_serializable(obj):
            if isinstance(obj, dict):
                return {k: _make_serializable(v) for k, v in obj.items()}
            if isinstance(obj, (list, tuple)):
                return [_make_serializable(v) for v in obj]
            if hasattr(obj, 'item'):  # numpy scalar
                return obj.item()
            return obj

        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(_make_serializable(analysis), f, indent=2, ensure_ascii=False)
        logger.info(f"[ANALYSIS] Results saved to {output_file}")

        return {"status": "ok", "analysis": analysis}

    except Exception as e:
        logger.error(f"[ANALYSIS] Failed for job {job_id}: {e}", exc_info=True)
        return {"status": "error", "reason": str(e)}
    finally:
        # Remove sentinel
        try:
            sentinel.unlink(missing_ok=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Sub-analyses
# ---------------------------------------------------------------------------


def _retranscribe_dubbed_audio(dubbed_video: Path, target_language: str = "") -> Dict[str, Any]:
    """Re-transcribe the dubbed video with Whisper to verify actual spoken content.

    target_language is passed explicitly to Whisper rather than left to
    auto-detect — the dub's target language is already known, and auto-detect
    can mis-identify the language of TTS-generated speech (observed: Korean
    detected for an English dub), producing gibberish transcription and a
    meaningless near-zero pronunciation_clarity score that has nothing to do
    with actual pronunciation quality.
    """
    try:
        # Extract audio from dubbed video
        audio_path = dubbed_video.with_suffix(".wav")
        cmd = [
            "ffmpeg", "-y", "-i", str(dubbed_video),
            "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
            str(audio_path),
        ]
        subprocess.run(cmd, capture_output=True, timeout=300)

        if not audio_path.exists():
            return {"status": "error", "reason": "audio extraction failed"}

        # Transcribe with Whisper (no VAD — dubbed audio is clean)
        import numpy as np
        import soundfile as sf
        from faster_whisper import WhisperModel

        audio_data, sr = sf.read(str(audio_path))
        if audio_data.ndim > 1:
            audio_data = audio_data.mean(axis=1)
        audio_data = audio_data.astype(np.float32)

        import torch as _torch
        _device = "cuda" if _torch.cuda.is_available() else "cpu"
        _compute = "float16" if _device == "cuda" else "int8"
        model_size = os.getenv("WHISPER_MODEL", "medium")
        model = WhisperModel(model_size, device=_device, compute_type=_compute)
        segments_gen, info = model.transcribe(
            audio_data,
            beam_size=5,
            condition_on_previous_text=False,
            language=(target_language or None),
        )
        segments = [
            {
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text.strip(),
                "confidence": round(1.0 - abs(getattr(seg, "avg_logprob", -0.5)), 3),
            }
            for seg in segments_gen
            if seg.text.strip()
        ]

        # Clean up temp audio
        try:
            audio_path.unlink()
        except Exception:
            pass

        return {
            "status": "ok",
            "language": info.language,
            "segment_count": len(segments),
            "segments": segments,
        }
    except Exception as e:
        logger.warning(f"[ANALYSIS] Retranscription failed: {e}")
        return {"status": "error", "reason": str(e)}


def _compare_timing(
    timing_data: Optional[List[Dict]],
    original_transcript: Optional[Dict],
) -> Dict[str, Any]:
    """Compare dubbed segment timing against original transcript.

    Uses ``original_start`` / ``original_end`` from the timing diagnostics
    when available (these are written by the dubbing service and already
    reflect segment merges and gap recovery).  Falls back to a proximity
    search against the raw transcript only for older diagnostics that lack
    these fields.
    """
    if not timing_data:
        return {"status": "skipped", "reason": "no timing data"}

    original_segments = []
    if original_transcript and "segments" in original_transcript:
        original_segments = original_transcript["segments"]

    issues = []
    for entry in timing_data:
        idx = entry.get("index", 0)
        placed_start = entry.get("placed_start", 0)
        placed_end = entry.get("placed_end", 0)
        tts_duration = entry.get("tts_duration", 0)

        # Prefer embedded original timestamps (accurate after merge/recovery)
        if "original_start" in entry:
            orig_start = entry["original_start"]
            orig_end = entry.get("original_end", placed_end)
            orig_duration = orig_end - orig_start
            offset = abs(placed_start - orig_start)
        else:
            # Legacy fallback: match by closest timestamp overlap
            best_orig = None
            best_score = -1
            for orig in original_segments:
                os_ = orig.get("start", 0)
                oe_ = orig.get("end", 0)
                overlap = max(0, min(placed_end, oe_) - max(placed_start, os_))
                proximity = 1.0 / (1.0 + abs(placed_start - os_))
                score = overlap + proximity
                if score > best_score:
                    best_score = score
                    best_orig = orig

            if best_orig:
                orig_start = best_orig.get("start", 0)
                orig_end = best_orig.get("end", 0)
                orig_duration = orig_end - orig_start
                offset = abs(placed_start - orig_start)
            else:
                continue

        if offset > 0.5:
            severity = "high" if offset > 2.0 else "medium" if offset > 1.0 else "low"
            issues.append({
                "segment": idx,
                "text": entry.get("text", ""),
                "original_start": round(orig_start, 3),
                "dubbed_start": round(placed_start, 3),
                "offset": round(offset, 3),
                "original_duration": round(orig_duration, 3),
                "dubbed_duration": round(tts_duration, 3),
                "severity": severity,
            })

        # Check for overlaps
        gap = entry.get("gap_from_prev")
        if gap is not None and gap < -0.1:
            issues.append({
                "segment": idx,
                "text": entry.get("text", ""),
                "type": "overlap",
                "overlap_seconds": round(abs(gap), 3),
                "severity": "high" if abs(gap) > 1.0 else "medium",
            })

    return {
        "status": "ok",
        "total_segments": len(timing_data),
        "issues_found": len(issues),
        "issues": issues,
    }


def _detect_silences(
    dubbed_video: Path,
    original_transcript: Optional[Dict],
) -> Dict[str, Any]:
    """Detect silence gaps in dubbed audio using FFmpeg silencedetect."""
    try:
        cmd = [
            "ffmpeg", "-i", str(dubbed_video),
            "-af", "silencedetect=noise=-40dB:d=1.5",
            "-f", "null", "-",
        ]
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=120,
        )
        stderr = result.stderr

        # Parse silencedetect output
        silences = []
        starts = re.findall(r"silence_start:\s*([\d.]+)", stderr)
        ends_durations = re.findall(
            r"silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)", stderr
        )

        for i, (end, dur) in enumerate(ends_durations):
            start = float(starts[i]) if i < len(starts) else float(end) - float(dur)
            silences.append({
                "start": round(start, 3),
                "end": round(float(end), 3),
                "duration": round(float(dur), 3),
            })

        # Flag silences where original had speech
        flagged = []
        orig_segments = []
        if original_transcript and "segments" in original_transcript:
            orig_segments = original_transcript["segments"]

        for silence in silences:
            has_original_speech = False
            for seg in orig_segments:
                seg_start = seg.get("start", 0)
                seg_end = seg.get("end", 0)
                # Check overlap between silence and original segment
                overlap_start = max(silence["start"], seg_start)
                overlap_end = min(silence["end"], seg_end)
                if overlap_end - overlap_start > 0.3:
                    has_original_speech = True
                    break
            flagged.append({
                **silence,
                "expected_speech": has_original_speech,
                "severity": "high" if has_original_speech else "info",
            })

        return {
            "status": "ok",
            "total_silences": len(flagged),
            "unexpected_silences": sum(1 for s in flagged if s["expected_speech"]),
            "silences": flagged,
        }
    except Exception as e:
        logger.warning(f"[ANALYSIS] Silence detection failed: {e}")
        return {"status": "error", "reason": str(e)}


def _detect_speed_anomalies(timing_data: Optional[List[Dict]]) -> Dict[str, Any]:
    """Flag segments with unusual speed adjustments."""
    if not timing_data:
        return {"status": "skipped", "reason": "no timing data"}

    anomalies = []
    speeds = []

    for entry in timing_data:
        placed_start = entry.get("placed_start", 0)
        placed_end = entry.get("placed_end", 0)
        tts_duration = entry.get("tts_duration", 0)
        slot_duration = placed_end - placed_start

        if slot_duration > 0 and tts_duration > 0:
            speed_ratio = tts_duration / slot_duration
            speeds.append(speed_ratio)

            if speed_ratio > 1.3:
                anomalies.append({
                    "segment": entry.get("index", 0),
                    "text": entry.get("text", ""),
                    "speed_ratio": round(speed_ratio, 3),
                    "tts_duration": round(tts_duration, 3),
                    "slot_duration": round(slot_duration, 3),
                    "type": "too_fast",
                    "severity": "high" if speed_ratio > 1.6 else "medium",
                })

    # Check speed variance
    mean_speed = sum(speeds) / len(speeds) if speeds else 1.0
    variance = (
        sum((s - mean_speed) ** 2 for s in speeds) / len(speeds)
    ) ** 0.5 if speeds else 0

    if variance > 0.3:
        for entry in timing_data:
            placed_start = entry.get("placed_start", 0)
            placed_end = entry.get("placed_end", 0)
            tts_duration = entry.get("tts_duration", 0)
            slot_duration = placed_end - placed_start
            if slot_duration > 0 and tts_duration > 0:
                speed_ratio = tts_duration / slot_duration
                if abs(speed_ratio - mean_speed) > 0.3:
                    # Avoid duplicate entries
                    seg_idx = entry.get("index", 0)
                    if not any(a["segment"] == seg_idx and a["type"] == "inconsistent" for a in anomalies):
                        anomalies.append({
                            "segment": seg_idx,
                            "text": entry.get("text", ""),
                            "speed_ratio": round(speed_ratio, 3),
                            "mean_speed": round(mean_speed, 3),
                            "deviation": round(abs(speed_ratio - mean_speed), 3),
                            "type": "inconsistent",
                            "severity": "low",
                        })

    return {
        "status": "ok",
        "total_segments": len(timing_data),
        "anomalies_found": len(anomalies),
        "mean_speed_ratio": round(mean_speed, 3),
        "speed_std_dev": round(variance, 3),
        "anomalies": anomalies,
    }


def _analyze_loudness(dubbed_video: Path) -> Dict[str, Any]:
    """Measure audio loudness using FFmpeg loudnorm filter."""
    try:
        cmd = [
            "ffmpeg", "-i", str(dubbed_video),
            "-af", "loudnorm=print_format=json",
            "-f", "null", "-",
        ]
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=120,
        )
        stderr = result.stderr

        # Extract JSON from loudnorm output
        json_match = re.search(r'\{[^}]*"input_i"[^}]*\}', stderr, re.DOTALL)
        if not json_match:
            return {"status": "error", "reason": "loudnorm output not found"}

        loudness = json.loads(json_match.group())
        input_i = float(loudness.get("input_i", -100))
        input_tp = float(loudness.get("input_tp", -100))
        input_lra = float(loudness.get("input_lra", 0))

        # Flag if outside broadcast standards (-14 LUFS +/- 3 LU, true peak <= -1.0 dBFS)
        target_lufs = -14.0
        tolerance = 3.0
        lufs_ok = abs(input_i - target_lufs) <= tolerance
        tp_ok = input_tp <= -1.0

        within_spec = lufs_ok and tp_ok

        reasons = []
        if not lufs_ok:
            reasons.append("lufs_out_of_range")
        if not tp_ok:
            reasons.append("true_peak_clipping")

        return {
            "status": "ok",
            "integrated_loudness_lufs": round(input_i, 2),
            "true_peak_dbfs": round(input_tp, 2),
            "loudness_range_lu": round(input_lra, 2),
            "target_lufs": target_lufs,
            "within_spec": within_spec,
            "deviation_from_target": round(input_i - target_lufs, 2),
            "reason": ", ".join(reasons) if reasons else "",
        }
    except Exception as e:
        logger.warning(f"[ANALYSIS] Loudness analysis failed: {e}")
        return {"status": "error", "reason": str(e)}


def _screenapp_analyze(video_path: str, label: str) -> Optional[Dict[str, Any]]:
    """Run ScreenApp analysis on a video (original or dubbed)."""
    try:
        from app.services.screenapp_service import is_enabled, analyze_video

        if not is_enabled():
            return {"status": "skipped", "reason": "ScreenApp not configured"}

        if not Path(video_path).exists():
            return {"status": "skipped", "reason": f"Video not found: {video_path}"}

        logger.info(f"[ANALYSIS] Running ScreenApp analysis on {label} video")
        result = analyze_video(video_path, summary_length="detailed")
        if result is None:
            return {"status": "error", "reason": "ScreenApp returned no results"}

        return {"status": "ok", "label": label, **result}
    except ImportError:
        return {"status": "skipped", "reason": "screenapp_service not available"}
    except Exception as e:
        logger.warning(f"[ANALYSIS] ScreenApp {label} failed: {e}")
        return {"status": "error", "reason": str(e)}


# ---------------------------------------------------------------------------
# AI-powered analyses (Azure Speech, Azure OpenAI)
# ---------------------------------------------------------------------------


def _assess_pronunciation(
    dubbed_video_path: str,
    reference_text: str,
) -> Dict[str, Any]:
    """Assess pronunciation quality using Azure Speech SDK."""
    try:
        from app.services.azure_speech_service import is_enabled, assess_pronunciation

        if not is_enabled():
            return {"status": "skipped", "reason": "Azure Speech not configured"}

        if not reference_text:
            return {"status": "skipped", "reason": "No reference text available"}

        logger.info("[ANALYSIS] Running Azure pronunciation assessment")
        result = assess_pronunciation(dubbed_video_path, reference_text)
        if result is None:
            return {"status": "error", "reason": "Azure Speech returned no results"}

        return {"status": "ok", **result}
    except ImportError:
        return {"status": "skipped", "reason": "azure_speech_service not available"}
    except Exception as e:
        logger.warning(f"[ANALYSIS] Pronunciation assessment failed: {e}")
        return {"status": "error", "reason": str(e)}


def _evaluate_translation(
    original_segments: list,
    dubbed_segments: list,
    source_lang: str,
    target_lang: str,
) -> Dict[str, Any]:
    """Evaluate translation quality using Azure OpenAI GPT-4."""
    try:
        from app.services.azure_openai_service import is_enabled, evaluate_translation

        if not is_enabled():
            return {"status": "skipped", "reason": "Azure OpenAI not configured"}

        if not original_segments or not dubbed_segments:
            return {"status": "skipped", "reason": "Missing original or dubbed segments"}

        logger.info("[ANALYSIS] Running Azure OpenAI translation evaluation")
        result = evaluate_translation(
            original_segments, dubbed_segments, source_lang, target_lang
        )
        if result is None:
            return {"status": "error", "reason": "Azure OpenAI returned no results"}

        return {"status": "ok", **result}
    except ImportError:
        return {"status": "skipped", "reason": "azure_openai_service not available"}
    except Exception as e:
        logger.warning(f"[ANALYSIS] Translation evaluation failed: {e}")
        return {"status": "error", "reason": str(e)}


# ---------------------------------------------------------------------------
# Summary scoring
# ---------------------------------------------------------------------------

def _compute_summary(analysis: Dict[str, Any]) -> Dict[str, Any]:
    """Aggregate all analyses into a 0-100 score with A-F grade.

    Full weight table (when all services available):
        timing: 10, speed: 10, loudness: 5, silences: 10,
        emotion_variance: 15, emotion_intensity: 10,
        pronunciation_fluency: 10, pronunciation_prosody: 10,
        translation_accuracy: 15, dialogue_coverage: 5,
        pronunciation_clarity: 12, lip_sync: 12, emotion_preservation: 10,
        gemini_overall: 5

    When a service is unavailable, its weights redistribute to remaining metrics.

    IMPORTANT: every component that should count toward the score must be added to
    `scores` BEFORE the single weighted-average calculation below. lip_sync,
    emotion_preservation, and gemini_overall used to be computed *after* that
    calculation, which meant they were displayed in weights_used/component_scores
    but silently had zero actual effect on the score — e.g. a lip_sync of 29 never
    dragged a bad dub's grade down. Fixed 2026-07-15.
    """
    scores = {}

    # Provisional retranscription-confidence weight. Confirmed 2026-07-15 against a
    # real job that a heavy-accent dub produces a genuine low-to-high confidence trend
    # tracking accent severity across the clip — not just short-utterance ASR noise.
    # Revisit after observing this across a handful of real dubs with varying accent
    # severity.
    PRONUNCIATION_CLARITY_WEIGHT = 12

    # Whisper confidence runs naturally low on brief interjections regardless of actual
    # clarity, so short lines count at reduced weight rather than being excluded outright
    # — a genuinely bad short line (e.g. "Hello?" at 7%) should still register as a problem.
    SHORT_LINE_WORD_THRESHOLD = 2
    SHORT_LINE_WEIGHT_FACTOR = 0.4

    # Base weights — full allocation when all services are available
    weights = {
        "timing": 8,
        "speed": 8,
        "loudness": 4,
        "silences": 8,
        "emotion_variance": 10,
        "emotion_intensity": 7,
        "pronunciation_fluency": 7,
        "pronunciation_prosody": 7,
        "translation_accuracy": 10,
        "dialogue_coverage": 4,
        "pronunciation_clarity": PRONUNCIATION_CLARITY_WEIGHT,
        "lip_sync": 12,
        "emotion_preservation": 10,
        "gemini_overall": 5,
    }

    # --- Technical metrics (always available) ---

    # Timing score: deduct per issue
    timing = analysis.get("timing", {})
    if timing.get("status") == "ok":
        total = max(timing.get("total_segments", 1), 1)
        issues = timing.get("issues_found", 0)
        scores["timing"] = max(0, 100 - (issues / total) * 100)
    else:
        scores["timing"] = 50

    # Speed score: deduct per anomaly
    speed = analysis.get("speed", {})
    if speed.get("status") == "ok":
        total = max(speed.get("total_segments", 1), 1)
        anomalies = speed.get("anomalies_found", 0)
        std_dev = speed.get("speed_std_dev", 0)
        base = max(0, 100 - (anomalies / total) * 100)
        variance_penalty = min(30, std_dev * 100)
        scores["speed"] = max(0, base - variance_penalty)
    else:
        scores["speed"] = 50

    # Loudness score
    loudness = analysis.get("loudness", {})
    if loudness.get("status") == "ok":
        if loudness.get("within_spec"):
            scores["loudness"] = 100
        else:
            deviation = abs(loudness.get("deviation_from_target", 0))
            scores["loudness"] = max(0, 100 - deviation * 10)
    else:
        scores["loudness"] = 50

    # Silence score
    silences = analysis.get("silences", {})
    if silences.get("status") == "ok":
        unexpected = silences.get("unexpected_silences", 0)
        scores["silences"] = max(0, 100 - unexpected * 20)
    else:
        scores["silences"] = 50

    # emotion_variance and emotion_intensity (Hume) permanently removed —
    # API discontinued. Redistribute their weight to technical metrics.
    hume_weight = weights.pop("emotion_variance", 0) + weights.pop("emotion_intensity", 0)
    weights["timing"] += hume_weight // 4
    weights["speed"] += hume_weight // 4
    weights["silences"] += hume_weight // 4
    weights["loudness"] += hume_weight - 3 * (hume_weight // 4)

    # --- Azure Speech pronunciation scores (optional) ---
    pronunciation = analysis.get("pronunciation", {})
    if pronunciation.get("status") == "ok":
        scores["pronunciation_fluency"] = pronunciation.get("fluency_score", 0)
        scores["pronunciation_prosody"] = pronunciation.get("prosody_score", 0)
    else:
        # Redistribute Azure Speech weight to technical metrics
        azure_weight = weights.pop("pronunciation_fluency", 0) + weights.pop("pronunciation_prosody", 0)
        weights["timing"] += azure_weight // 3
        weights["speed"] += azure_weight // 3
        weights["silences"] += azure_weight - 2 * (azure_weight // 3)

    # --- Azure OpenAI translation scores (optional) ---
    translation = analysis.get("translation", {})
    if translation.get("status") == "ok":
        scores["translation_accuracy"] = translation.get("translation_score", 0)
        scores["dialogue_coverage"] = translation.get("coverage_percent", 0)
    else:
        # Redistribute Azure OpenAI weight to technical metrics
        openai_weight = weights.pop("translation_accuracy", 0) + weights.pop("dialogue_coverage", 0)
        weights["timing"] += openai_weight // 3
        weights["speed"] += openai_weight // 3
        weights["silences"] += openai_weight - 2 * (openai_weight // 3)

    # --- Retranscription-based pronunciation clarity (local Whisper, always available) ---
    retrans = analysis.get("retranscription", {})
    retrans_segments = retrans.get("segments") or []
    if retrans.get("status") == "ok" and retrans_segments:
        weighted_conf_sum = 0.0
        seg_weight_total = 0.0
        for seg in retrans_segments:
            conf_pct = max(0.0, min(100.0, (seg.get("confidence") or 0) * 100))
            word_count = len((seg.get("text") or "").split())
            seg_weight = (
                SHORT_LINE_WEIGHT_FACTOR if word_count <= SHORT_LINE_WORD_THRESHOLD else 1.0
            )
            weighted_conf_sum += conf_pct * seg_weight
            seg_weight_total += seg_weight
        scores["pronunciation_clarity"] = weighted_conf_sum / seg_weight_total
    else:
        # Retranscription pass didn't run/failed — redistribute weight, don't guess a score.
        retrans_weight = weights.pop("pronunciation_clarity", 0)
        if retrans_weight:
            weights["timing"] += retrans_weight // 3
            weights["speed"] += retrans_weight // 3
            weights["silences"] += retrans_weight - 2 * (retrans_weight // 3)

    # --- QC Stack scores (optional) ---
    lip_sync = analysis.get("lip_sync", {})
    if lip_sync.get("status") == "ok":
        scores["lip_sync"] = lip_sync.get("overall_score", 50)
    else:
        lip_weight = weights.pop("lip_sync", 0)
        if lip_weight:
            # NOT to timing/speed. Both are currently tautological: the
            # diagnostics record placed positions as the "original" ones and
            # tts_duration as the fitted duration, so timing's offset check can
            # never fire and speed_ratio is 1.0 by construction — verified
            # across every segment of a real job. Redistributing here would put
            # 12 points onto components incapable of reporting a fault and
            # inflate every score. Send it to metrics that genuinely measure.
            weights["loudness"] = weights.get("loudness", 0) + lip_weight // 2
            weights["silences"] = weights.get("silences", 0) + (lip_weight - lip_weight // 2)

    emotion_pres = analysis.get("emotion_preservation", {})
    if emotion_pres.get("status") == "ok":
        scores["emotion_preservation"] = emotion_pres.get("overall_score", 50)
    else:
        ep_weight = weights.pop("emotion_preservation", 0)
        if ep_weight:
            weights["timing"] += ep_weight // 2
            weights["speed"] += ep_weight - ep_weight // 2

    # Gemini overall score integrates as a separate dimension
    gemini = analysis.get("gemini_review", {})
    if gemini.get("status") == "ok":
        scores["gemini_overall"] = gemini.get("overall_score", 50)

    # Weighted average — computed once, after every component above (including
    # lip_sync/emotion_preservation/gemini/pronunciation_clarity) has been added to
    # `scores`, so every weight in weights_used actually influences the result.
    total_weight = sum(weights.get(k, 0) for k in scores)
    if total_weight > 0:
        weighted_score = sum(
            scores[k] * weights.get(k, 0) for k in scores
        ) / total_weight
    else:
        weighted_score = 50

    score = round(weighted_score)

    # Grade
    if score >= 90:
        grade = "A"
    elif score >= 80:
        grade = "B"
    elif score >= 70:
        grade = "C"
    elif score >= 60:
        grade = "D"
    else:
        grade = "F"

    # Track which AI services contributed
    services_available = {
        "azure_speech": pronunciation.get("status") == "ok",
        "azure_openai": translation.get("status") == "ok",
        "screenapp": (analysis.get("screenapp_dubbed") or {}).get("status") == "ok",
        "retranscription": retrans.get("status") == "ok",
        "syncnet": lip_sync.get("status") == "ok",
        "emotion2vec": emotion_pres.get("status") == "ok",
        "gemini": gemini.get("status") == "ok",
        "claude_report": (analysis.get("qc_report") or {}).get("status") == "ok",
    }

    # Use Claude's holistic synthesis score as authoritative when available — but only
    # the genuine Claude synthesis, not the template fallback. The template only averages
    # whichever raw sub-scores happen to be available at this point (missing timing/speed/
    # silences, and giving lip_sync equal weight to emotion), which is cruder than the
    # properly-weighted pipeline score above and must never override it.
    qc_report = analysis.get("qc_report") or {}
    is_claude_synthesis = qc_report.get("status") == "ok" and qc_report.get("method") == "claude"
    synthesis_score = qc_report.get("overall_score") if is_claude_synthesis else None
    synthesis_grade = qc_report.get("overall_grade") if is_claude_synthesis else None
    score_source = "synthesis" if synthesis_score is not None else "pipeline"

    return {
        "score": synthesis_score if synthesis_score is not None else score,
        "grade": synthesis_grade if synthesis_grade is not None else grade,
        "pipeline_score": score,
        "pipeline_grade": grade,
        "synthesis_score": synthesis_score,
        "synthesis_grade": synthesis_grade,
        "score_source": score_source,
        "component_scores": {k: round(v) for k, v in scores.items()},
        "weights_used": weights,
        "services_available": services_available,
    }


# ---------------------------------------------------------------------------
# QC Stack analyses (SyncNet, emotion2vec, Gemini, Claude)
# ---------------------------------------------------------------------------


def _analyze_lip_sync(
    dubbed_video_path: str,
    timing_data: Optional[List[Dict]],
) -> Dict[str, Any]:
    """Analyze lip-sync quality using SyncNet-style audio-visual correlation."""
    try:
        from app.services.syncnet_service import is_enabled, analyze_lip_sync

        if not is_enabled():
            return {"status": "skipped", "reason": "OpenCV not available"}

        logger.info("[ANALYSIS] Running SyncNet lip-sync analysis")
        result = analyze_lip_sync(dubbed_video_path, timing_data)
        if result is None:
            return {"status": "error", "reason": "SyncNet returned no results"}

        return result
    except ImportError:
        return {"status": "skipped", "reason": "syncnet_service not available"}
    except Exception as e:
        logger.warning(f"[ANALYSIS] Lip-sync analysis failed: {e}")
        return {"status": "error", "reason": str(e)}


def _analyze_emotion_preservation(
    original_video_path: str,
    dubbed_video_path: str,
    timing_data: Optional[List[Dict]],
) -> Dict[str, Any]:
    """Compare emotional expression between original and dubbed audio."""
    try:
        from app.services.emotion2vec_service import is_enabled, analyze_emotion_preservation

        if not is_enabled():
            return {"status": "skipped", "reason": "numpy/torchaudio not available"}

        logger.info("[ANALYSIS] Running emotion preservation analysis")
        result = analyze_emotion_preservation(
            original_video_path, dubbed_video_path, timing_data
        )
        if result is None:
            return {"status": "error", "reason": "emotion analysis returned no results"}

        return result
    except ImportError:
        return {"status": "skipped", "reason": "emotion2vec_service not available"}
    except Exception as e:
        logger.warning(f"[ANALYSIS] Emotion preservation analysis failed: {e}")
        return {"status": "error", "reason": str(e)}


def _gemini_review(
    original_video_path: str,
    dubbed_video_path: str,
    target_language: str,
    source_language: str,
    timing_data: Optional[List[Dict]],
) -> Dict[str, Any]:
    """Run Gemini 2.5 Pro holistic video+audio QC review."""
    try:
        from app.services.gemini_service import is_enabled, analyze_dubbed_video
        import asyncio

        if not is_enabled():
            return {"status": "skipped", "reason": "GEMINI_API_KEY not configured"}

        logger.info("[ANALYSIS] Running Gemini 2.5 Pro holistic review")

        context = {}
        if timing_data:
            context["segments"] = timing_data
            speakers = list(set(
                seg.get("speaker", "?") for seg in timing_data
            ))
            context["speakers"] = speakers

        # Run async function in sync context
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    result = pool.submit(
                        asyncio.run,
                        analyze_dubbed_video(
                            original_video_path, dubbed_video_path,
                            target_language, source_language, context
                        )
                    ).result(timeout=300)
            else:
                result = loop.run_until_complete(
                    analyze_dubbed_video(
                        original_video_path, dubbed_video_path,
                        target_language, source_language, context
                    )
                )
        except RuntimeError:
            result = asyncio.run(
                analyze_dubbed_video(
                    original_video_path, dubbed_video_path,
                    target_language, source_language, context
                )
            )

        if result is None:
            return {"status": "error", "reason": "Gemini returned no results"}

        return result
    except ImportError:
        return {"status": "skipped", "reason": "gemini_service not available"}
    except Exception as e:
        logger.warning(f"[ANALYSIS] Gemini review failed: {e}")
        return {"status": "error", "reason": str(e)}


def _generate_qc_report(
    analysis_data: Dict[str, Any],
    job_id: str,
) -> Dict[str, Any]:
    """Generate synthesized QC report using Claude or template."""
    try:
        from app.services.qc_report_service import generate_qc_report
        import asyncio

        logger.info("[ANALYSIS] Generating QC report")

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    result = pool.submit(
                        asyncio.run,
                        generate_qc_report(analysis_data, job_id)
                    ).result(timeout=120)
            else:
                result = loop.run_until_complete(
                    generate_qc_report(analysis_data, job_id)
                )
        except RuntimeError:
            result = asyncio.run(
                generate_qc_report(analysis_data, job_id)
            )

        return result
    except ImportError:
        return {"status": "skipped", "reason": "qc_report_service not available"}
    except Exception as e:
        logger.warning(f"[ANALYSIS] QC report generation failed: {e}")
        return {"status": "error", "reason": str(e)}
