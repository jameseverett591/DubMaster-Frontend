"""
WenetSpeech-Yue CTC Cantonese ASR via sherpa-onnx.

Primary transcription is performed by an INT8 Wenet CTC model. Because the
greedy-search model returns no usable per-segment confidence, a parallel
faster-whisper pass on the same VAD chunks provides `avg_logprob`,
`no_speech_prob`, and word timestamps as the confidence signal.
"""

import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

_CANTONESE_LANGS = {"yue", "zh-yue", "yue-hk", "zh-hk"}
_DEFAULT_REPO = (
    "csukuangfj/sherpa-onnx-wenetspeech-yue-u2pp-conformer-ctc-zh-en-cantonese-int8-2025-09-10"
)
_DEFAULT_MODEL_DIR = "/app/data/models/wenetspeech-yue-int8"
_SAMPLE_RATE = 16000

_WENET_RECOGNIZER: Any = None


def _is_cantonese(source_language: Optional[str]) -> bool:
    """Return True if source_language is a Cantonese variant."""
    return (source_language or "").lower().strip().replace("_", "-") in _CANTONESE_LANGS


def _load_audio_file(audio_path: str) -> Tuple[np.ndarray, int]:
    """Load a WAV/audio file and return a 1-D float32 numpy array + sample rate."""
    import soundfile as sf
    import torch
    import torchaudio

    audio_np, sample_rate = sf.read(audio_path, dtype="float32")
    if audio_np.ndim == 0:
        audio_np = np.array([audio_np.item()], dtype=np.float32)
    elif audio_np.ndim > 1:
        audio_np = audio_np.mean(axis=1).astype(np.float32)

    if sample_rate != _SAMPLE_RATE:
        logger.info(f"[WENET] Resampling audio from {sample_rate} Hz to {_SAMPLE_RATE} Hz")
        audio_t = torch.from_numpy(audio_np).unsqueeze(0)
        audio_t = torchaudio.functional.resample(audio_t, sample_rate, _SAMPLE_RATE)
        audio_np = audio_t.squeeze(0).numpy()
        sample_rate = _SAMPLE_RATE

    max_val = float(np.max(np.abs(audio_np))) if audio_np.size else 0.0
    if max_val > 1.0:
        audio_np = audio_np / max_val

    return audio_np, sample_rate


def _get_audio_samples(extract_result: Dict[str, Any]) -> Tuple[np.ndarray, int]:
    """Convert extract_result audio to a 1-D float32 numpy array at the original sample rate."""
    import torch
    import torchaudio

    audio = extract_result["audio"]
    sample_rate = int(extract_result.get("sample_rate", _SAMPLE_RATE))

    if isinstance(audio, torch.Tensor):
        waveform = audio.squeeze().float().cpu()
        if waveform.ndim == 0:
            waveform = waveform.unsqueeze(0)
        elif waveform.ndim > 1:
            waveform = waveform.mean(dim=0)
        audio_np = waveform.numpy()
    elif isinstance(audio, np.ndarray):
        audio_np = audio.squeeze().astype(np.float32)
        if audio_np.ndim == 0:
            audio_np = np.array([audio_np.item()], dtype=np.float32)
        elif audio_np.ndim > 1:
            audio_np = audio_np.mean(axis=0).astype(np.float32)
    else:
        raise TypeError(f"Unsupported audio type: {type(audio)}")

    if audio_np.dtype != np.float32:
        audio_np = audio_np.astype(np.float32)

    # Resample to 16 kHz if necessary.
    if sample_rate != _SAMPLE_RATE:
        logger.info(f"[WENET] Resampling audio from {sample_rate} Hz to {_SAMPLE_RATE} Hz")
        audio_t = torch.from_numpy(audio_np).unsqueeze(0)
        audio_t = torchaudio.functional.resample(audio_t, sample_rate, _SAMPLE_RATE)
        audio_np = audio_t.squeeze(0).numpy()
        sample_rate = _SAMPLE_RATE

    max_val = float(np.max(np.abs(audio_np))) if audio_np.size else 0.0
    if max_val > 1.0:
        audio_np = audio_np / max_val

    return audio_np, sample_rate


def _get_wenet_model() -> Any:
    """Load (or reuse) the Wenet CTC offline recognizer."""
    global _WENET_RECOGNIZER
    if _WENET_RECOGNIZER is not None:
        return _WENET_RECOGNIZER

    try:
        import sherpa_onnx
        from huggingface_hub import hf_hub_download
    except ImportError as e:
        raise RuntimeError(f"sherpa-onnx or huggingface_hub not installed: {e}")

    model_dir = Path(os.getenv("WENETSPEECH_YUE_MODEL_DIR", _DEFAULT_MODEL_DIR))
    repo_id = os.getenv("WENETSPEECH_YUE_REPO", _DEFAULT_REPO)
    num_threads = int(os.getenv("WENET_NUM_THREADS", "4"))
    provider = os.getenv("WENET_PROVIDER", "cpu")

    model_path = model_dir / "model.int8.onnx"
    tokens_path = model_dir / "tokens.txt"

    if not model_path.exists() or not tokens_path.exists():
        logger.info(f"[WENET] Downloading WenetSpeech-Yue INT8 model to {model_dir}")
        model_dir.mkdir(parents=True, exist_ok=True)
        hf_hub_download(
            repo_id=repo_id,
            filename="model.int8.onnx",
            local_dir=str(model_dir),
            local_dir_use_symlinks=False,
        )
        hf_hub_download(
            repo_id=repo_id,
            filename="tokens.txt",
            local_dir=str(model_dir),
            local_dir_use_symlinks=False,
        )

    logger.info(f"[WENET] Loading Wenet CTC model from {model_dir} (provider={provider})")
    _WENET_RECOGNIZER = sherpa_onnx.OfflineRecognizer.from_wenet_ctc(
        model=str(model_path),
        tokens=str(tokens_path),
        num_threads=num_threads,
        sample_rate=_SAMPLE_RATE,
        feature_dim=80,
        decoding_method="greedy_search",
        provider=provider,
    )
    return _WENET_RECOGNIZER


def _get_vad_chunks(waveform: np.ndarray) -> List[Dict[str, int]]:
    """Return VAD speech chunks as {start, end} sample indices at 16 kHz."""
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    max_speech_s = float(os.getenv("WENET_VAD_MAX_SPEECH_S", "20.0"))
    vad_options = VadOptions(
        threshold=float(os.getenv("WENET_VAD_THRESHOLD", "0.15")),
        min_speech_duration_ms=int(os.getenv("WENET_VAD_MIN_SPEECH_MS", "50")),
        min_silence_duration_ms=int(os.getenv("WENET_VAD_MIN_SILENCE_MS", "150")),
        speech_pad_ms=int(os.getenv("WENET_VAD_SPEECH_PAD_MS", "400")),
        max_speech_duration_s=max_speech_s,
    )

    return get_speech_timestamps(waveform, vad_options, sampling_rate=_SAMPLE_RATE)


def _split_long_chunks(
    chunks: List[Dict[str, int]], max_speech_s: float
) -> List[Dict[str, int]]:
    """Force-split any VAD chunk longer than max_speech_s."""
    max_samples = int(max_speech_s * _SAMPLE_RATE)
    if max_samples <= 0:
        return chunks

    out: List[Dict[str, int]] = []
    for chunk in chunks:
        start, end = chunk["start"], chunk["end"]
        if end - start <= max_samples:
            out.append(chunk)
            continue
        for s in range(start, end, max_samples):
            out.append({"start": s, "end": min(s + max_samples, end)})
    return out


def _wenet_decode(recognizer: Any, samples_list: List[np.ndarray]) -> List[str]:
    """Decode a list of audio chunks with the Wenet CTC recognizer."""
    if not samples_list:
        return []

    # Prefer batched decode when available.
    if hasattr(recognizer, "decode_streams"):
        try:
            streams = [recognizer.create_stream() for _ in samples_list]
            for stream, samples in zip(streams, samples_list):
                stream.accept_waveform(_SAMPLE_RATE, samples)
            recognizer.decode_streams(streams)
            return [str(s.result.text) for s in streams]
        except Exception as e:
            logger.warning(f"[WENET] decode_streams failed, falling back to serial decode: {e}")

    texts: List[str] = []
    for samples in samples_list:
        stream = recognizer.create_stream()
        stream.accept_waveform(_SAMPLE_RATE, samples)
        recognizer.decode_stream(stream)
        texts.append(str(stream.result.text))
    return texts


def _whisper_confidence_pass(
    waveform: np.ndarray,
    chunks: List[Dict[str, int]],
    language: str,
    job_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Run faster-whisper on each VAD chunk and return confidence features only."""
    from app.pipeline.transcribe_audio import INITIAL_PROMPT, get_whisper_model

    model = get_whisper_model(source_language=language)
    whisper_lang = "yue" if _is_cantonese(language) else (language or "yue")
    whisper_kwargs = dict(
        language=whisper_lang,
        beam_size=5,
        word_timestamps=True,
        condition_on_previous_text=False,
        initial_prompt=INITIAL_PROMPT,
        compression_ratio_threshold=1.8,
        log_prob_threshold=-0.8,
        no_speech_threshold=0.5,
        vad_filter=False,
    )

    results: List[Dict[str, Any]] = []
    for chunk in chunks:
        start_s = chunk["start"] / _SAMPLE_RATE
        end_s = chunk["end"] / _SAMPLE_RATE
        chunk_samples = waveform[chunk["start"]: chunk["end"]].astype(np.float32)

        if chunk_samples.size == 0:
            results.append({
                "confidence": None,
                "avg_logprob": None,
                "no_speech_prob": None,
                "words": None,
            })
            continue

        try:
            segments_gen, _ = model.transcribe(chunk_samples, **whisper_kwargs)
            segments = list(segments_gen)
        except Exception as e:
            logger.warning(f"[WENET-WHISPER] job={job_id} chunk {start_s:.2f}-{end_s:.2f} failed: {e}")
            results.append({
                "confidence": None,
                "avg_logprob": None,
                "no_speech_prob": None,
                "words": None,
            })
            continue

        if not segments:
            results.append({
                "confidence": None,
                "avg_logprob": None,
                "no_speech_prob": None,
                "words": None,
            })
            continue

        word_list: List[Dict[str, Any]] = []
        total_dur = 0.0
        sum_lp = 0.0
        sum_nsp = 0.0

        for seg in segments:
            seg_dur = max(float(getattr(seg, "end", end_s)) - float(getattr(seg, "start", start_s)), 0.0)
            if seg_dur <= 0:
                seg_dur = 0.001

            avg_lp = getattr(seg, "avg_logprob", -0.5)
            nsp = getattr(seg, "no_speech_prob", None)

            total_dur += seg_dur
            sum_lp += avg_lp * seg_dur
            if nsp is not None:
                sum_nsp += nsp * seg_dur

            for w in getattr(seg, "words", []) or []:
                word_text = str(getattr(w, "word", "")).strip()
                if not word_text:
                    continue
                word_list.append({
                    "word": word_text,
                    "start": round(float(getattr(w, "start", 0)) + start_s, 3),
                    "end": round(float(getattr(w, "end", 0)) + start_s, 3),
                    "confidence": round(float(getattr(w, "probability", 0.5)), 3),
                })

        avg_lp = sum_lp / total_dur if total_dur > 0 else -0.5
        avg_nsp = sum_nsp / total_dur if total_dur > 0 else None
        confidence = round(max(0.0, min(1.0, 1.0 + avg_lp)), 3)

        results.append({
            "confidence": confidence,
            "avg_logprob": round(avg_lp, 3),
            "no_speech_prob": round(avg_nsp, 3) if avg_nsp is not None else None,
            "words": word_list if word_list else None,
        })

    return results


def _post_process_wenet_text(text: str) -> str:
    """Strip Wenet special markers and normalize whitespace."""
    if not text:
        return ""
    text = re.sub(r"\[[^\]]+\]", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _transcribe(
    extract_result: Dict[str, Any],
    audio_path: Optional[str] = None,
    source_language: Optional[str] = None,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Internal implementation: VAD → Wenet text + Whisper confidence."""
    recognizer = _get_wenet_model()

    if audio_path and os.path.exists(audio_path):
        waveform, sample_rate = _load_audio_file(audio_path)
    else:
        waveform, sample_rate = _get_audio_samples(extract_result)

    logger.info(f"[WENET] job={job_id} language={source_language} waveform_samples={len(waveform)}")

    chunks = _get_vad_chunks(waveform)
    max_speech_s = float(os.getenv("WENET_VAD_MAX_SPEECH_S", "20.0"))
    chunks = _split_long_chunks(chunks, max_speech_s)

    if not chunks:
        logger.info(f"[WENET] job={job_id} no speech detected")
        return {"status": "ok", "segments": []}

    samples_list = [waveform[c["start"]: c["end"]].astype(np.float32) for c in chunks]

    # Wenet runs on CPU, Whisper on GPU — execute in parallel.
    wenet_texts: List[str] = []
    whisper_confs: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        wenet_future = executor.submit(_wenet_decode, recognizer, samples_list)
        whisper_future = executor.submit(_whisper_confidence_pass, waveform, chunks, source_language or "yue", job_id)
        wenet_texts = wenet_future.result()
        try:
            whisper_confs = whisper_future.result()
        except Exception:
            logger.exception("[WENET-WHISPER] Confidence pass failed; keeping WenetSpeech output")
            whisper_confs = [{} for _ in chunks]

    segments: List[Dict[str, Any]] = []
    for chunk, wenet_text, conf in zip(chunks, wenet_texts, whisper_confs):
        text = _post_process_wenet_text(wenet_text)
        if not text:
            continue

        seg_start = round(chunk["start"] / _SAMPLE_RATE, 3)
        seg_end = round(chunk["end"] / _SAMPLE_RATE, 3)

        segments.append({
            "start": seg_start,
            "end": seg_end,
            "text": text,
            "speaker": "speaker-1",
            "confidence": conf.get("confidence"),
            "avg_logprob": conf.get("avg_logprob"),
            "no_speech_prob": conf.get("no_speech_prob"),
            "words": conf.get("words"),
            "source": "wenetspeech_yue",
        })

    logger.info(f"[WENET] job={job_id} produced {len(segments)} segments")
    return {"status": "ok", "segments": segments}


def transcribe_with_wenetspeech_yue(
    extract_result: Dict[str, Any],
    audio_path: Optional[str] = None,
    source_language: Optional[str] = None,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Public entry point for WenetSpeech-Yue CTC ASR.

    Returns a dict with ``status`` and ``segments`` compatible with the rest of
    the Cantonese pipeline.  Only runs for Cantonese language variants.
    """
    if not _is_cantonese(source_language):
        return {
            "status": "skipped",
            "reason": "unsupported_language",
            "segments": [],
        }

    try:
        return _transcribe(extract_result, audio_path=audio_path, source_language=source_language, job_id=job_id)
    except Exception as e:
        logger.error(f"[WENET] job={job_id} failed: {e}", exc_info=True)
        return {
            "status": "skipped",
            "reason": "wenet_error",
            "error_message": str(e),
            "segments": [],
        }
