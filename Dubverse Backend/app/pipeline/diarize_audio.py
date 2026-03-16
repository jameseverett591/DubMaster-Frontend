from pathlib import Path
import json
import os
import logging
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

_PIPELINE = None


def _get_pipeline(job_id: str | None = None):
    """
    Lazily load the pyannote diarization pipeline.
    Cached globally — the pipeline is stateless and reusable across jobs.
    Never crashes the pipeline.
    """
    global _PIPELINE

    if _PIPELINE is not None:
        return _PIPELINE

    token = os.getenv("HF_TOKEN")
    if not token:
        logger.warning("[DIARIZE] HF_TOKEN is not set — skipping diarization")
        return None

    logger.info(f"[DIARIZE] HF_TOKEN present (length={len(token)}), loading pyannote pipeline...")

    try:
        from pyannote.audio import Pipeline
    except ImportError as e:
        logger.error(f"[DIARIZE] pyannote.audio is not installed: {e}")
        logger.error("[DIARIZE] Install with: pip install pyannote.audio")
        return None

    try:
        _PIPELINE = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=token,
        )
        import torch
        if torch.cuda.is_available():
            _PIPELINE = _PIPELINE.to(torch.device("cuda"))
            logger.info("[DIARIZE] Pipeline moved to CUDA GPU")
        else:
            logger.info("[DIARIZE] Pipeline running on CPU")
        logger.info("[DIARIZE] Pipeline loaded successfully")
    except Exception as e:
        logger.error(f"[DIARIZE] Failed to load pipeline: {e}")
        logger.error(
            "[DIARIZE] Common causes: (1) HF_TOKEN lacks access to pyannote/speaker-diarization-3.1 "
            "— accept the license at https://huggingface.co/pyannote/speaker-diarization-3.1 "
            "(2) Network issue (3) Incompatible pyannote.audio version"
        )
        return None

    return _PIPELINE


def diarize_audio(extract_result: Dict[str, Any], job_id: str | None = None) -> Dict[str, Any]:
    """
    Perform speaker diarization on decoded audio.

    Input:
        extract_result from extract_audio()

    Output:
        Structured result dict (never raises for decode failures)
    """

    logger.info(f"[DIARIZE] Starting diarization for job={job_id}")

    # ---------- Respect extract/decode boundary ----------
    if extract_result.get("status") != "ok":
        logger.warning(
            f"[DIARIZE] Skipping — upstream status={extract_result.get('status')}, "
            f"reason={extract_result.get('diagnostics', extract_result.get('reason', 'unknown'))}"
        )
        return {
            "status": "skipped",
            "reason": "audio_not_available",
            "upstream_status": extract_result.get("status"),
            "diagnostics": extract_result.get("diagnostics"),
        }

    audio = extract_result["audio"]
    sample_rate: int = extract_result["sample_rate"]
    logger.info(
        f"[DIARIZE] Audio: shape={list(audio.shape)}, sample_rate={sample_rate}, "
        f"duration={audio.shape[-1] / sample_rate:.2f}s"
    )

    try:
        pipeline = _get_pipeline(job_id)
        if pipeline is None:
            return {
                "status": "skipped",
                "reason": "missing_hf_token",
                "error_message": "HF_TOKEN is not set or pipeline failed to load (check logs above)",
            }

        logger.info("[DIARIZE] Running pipeline inference...")
        # Constrain speaker count.  For known-N-speaker content set both
        # DIARIZATION_MIN_SPEAKERS and DIARIZATION_MAX_SPEAKERS to N in .env
        # (e.g. =3) so pyannote is forced to find exactly 3 clusters instead
        # of collapsing similar-sounding speakers.
        min_speakers = int(os.getenv("DIARIZATION_MIN_SPEAKERS", "2"))
        max_speakers = int(os.getenv("DIARIZATION_MAX_SPEAKERS", "4"))

        # Ensure audio is float32 mono [1, samples] as pyannote expects
        import torch
        waveform = audio
        if waveform.dtype != torch.float32:
            waveform = waveform.float()
        if waveform.dim() == 1:
            waveform = waveform.unsqueeze(0)  # [1, samples]
        elif waveform.dim() == 2 and waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)  # stereo -> mono

        logger.info(
            f"[DIARIZE] Waveform: shape={list(waveform.shape)}, "
            f"dtype={waveform.dtype}, sample_rate={sample_rate}, "
            f"min_speakers={min_speakers}, max_speakers={max_speakers}"
        )

        pipeline_kwargs: dict = {
            "waveform": waveform,
            "sample_rate": sample_rate,
        }
        logger.info(f"[DIARIZE] Speaker constraints: min={min_speakers}, max={max_speakers}")
        diarization = pipeline(pipeline_kwargs, min_speakers=min_speakers, max_speakers=max_speakers)

        # pyannote 4.x returns DiarizeOutput wrapper; unwrap to Annotation
        if hasattr(diarization, 'speaker_diarization'):
            annotation = diarization.speaker_diarization
        else:
            annotation = diarization

        results: List[Dict[str, Any]] = []
        for turn, _, speaker in annotation.itertracks(yield_label=True):
            results.append(
                {
                    "speaker": speaker,
                    "start": round(turn.start, 3),
                    "end": round(turn.end, 3),
                }
            )

        # Log summary
        unique_speakers = set(r["speaker"] for r in results)
        logger.info(
            f"[DIARIZE] Complete: {len(results)} segments, "
            f"{len(unique_speakers)} speakers: {sorted(unique_speakers)}"
        )
        if results:
            total_speech = sum(r["end"] - r["start"] for r in results)
            logger.info(f"[DIARIZE] Total speech time: {total_speech:.2f}s")

        # ---------- Persist result (optional side effect) ----------
        output_dir = Path("data/diarization")
        output_dir.mkdir(parents=True, exist_ok=True)

        filename = f"{job_id}.json" if job_id else "diarization.json"
        output_path = output_dir / filename
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)

        return {
            "status": "ok",
            "segments": results,
            "output_path": str(output_path),
        }

    except Exception as e:
        # Diarization failure is NON-FATAL — log the full traceback so we
        # can diagnose the root cause (torchcodec missing, HF token scope, etc.)
        logger.error(
            f"[DIARIZE] Diarization failed: {type(e).__name__}: {e}",
            exc_info=True,
        )
        return {
            "status": "skipped",
            "reason": "diarization_failed",
            "error_message": f"{type(e).__name__}: {e}",
        }
