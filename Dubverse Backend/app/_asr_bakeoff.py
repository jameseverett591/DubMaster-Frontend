"""
ASR bake-off — run Deepgram, Whisper, and Paraformer on the same audio
slice and print their source-language transcripts side by side.

Used to answer "which engine actually hears Cantonese film dialogue" —
compare CHINESE output only; translation quality is a separate stage.

Usage (inside the backend container):
    python app/_asr_bakeoff.py <audio.wav|mp4> [--start SEC] [--end SEC] [--lang yue]

Example — first 90 seconds of a job's extracted vocals:
    python app/_asr_bakeoff.py data/uploads/<job_id>/vocals.wav --end 90 --lang yue

Each engine's segments are printed as:  [start-end] (conf) text
"""

import argparse
import os
import sys
import tempfile

import numpy as np


def _load_audio(path: str, start: float, end: float):
    """Load a wav slice as (mono float32 numpy, sr). Video files go through
    ffmpeg to a temp wav first."""
    import soundfile as sf

    src = path
    tmp = None
    if not path.lower().endswith((".wav", ".flac", ".ogg")):
        import subprocess
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.close()
        subprocess.run(
            ["ffmpeg", "-y", "-i", path, "-vn", "-ac", "1", "-ar", "16000", tmp.name],
            check=True, capture_output=True,
        )
        src = tmp.name

    data, sr = sf.read(src, always_2d=True)
    mono = data.mean(axis=1)
    s = int(start * sr)
    e = int(end * sr) if end > 0 else len(mono)
    return mono[s:e], sr, tmp


def _write_slice(mono: np.ndarray, sr: int) -> str:
    import soundfile as sf
    f = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    f.close()
    sf.write(f.name, mono, sr)
    return f.name


def _run_deepgram(wav_path: str, lang: str):
    from app.pipeline.deepgram_asr import transcribe_with_deepgram
    r = transcribe_with_deepgram(
        {"status": "ok"}, audio_path=wav_path, source_language=lang, job_id="bakeoff"
    )
    return r.get("segments", []), r.get("reason") or r.get("error_message")


def _run_whisper(mono: np.ndarray, sr: int, lang: str):
    import torch
    from app.pipeline.transcribe_audio import transcribe_audio
    r = transcribe_audio(
        {"status": "ok", "audio": torch.from_numpy(mono).float(), "sample_rate": sr},
        "bakeoff_whisper",
        source_language=lang,
    )
    return r.get("segments", []), r.get("reason") or r.get("error_message")


def _run_paraformer(wav_path: str, lang: str):
    try:
        from app.pipeline.paraformer_asr import transcribe_with_paraformer
    except ImportError:
        return [], "paraformer not installed"
    r = transcribe_with_paraformer(audio_path=wav_path, language=lang, job_id="bakeoff")
    return r.get("segments", []), r.get("reason") or r.get("error_message")


def _print(name: str, segs, err):
    print(f"\n{'='*70}\n{name}\n{'='*70}")
    if err:
        print(f"  (skipped/failed: {err})")
    for s in segs:
        conf = s.get("confidence")
        conf_s = f"{conf:.2f}" if isinstance(conf, (int, float)) else "  - "
        print(f"  [{s.get('start', 0):7.2f}-{s.get('end', 0):7.2f}] ({conf_s}) {s.get('text', '')}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("audio", help="audio or video file path")
    p.add_argument("--start", type=float, default=0.0)
    p.add_argument("--end", type=float, default=0.0, help="0 = whole file")
    p.add_argument("--lang", default="yue")
    p.add_argument("--engines", default="deepgram,whisper,paraformer")
    args = p.parse_args()

    mono, sr, tmp = _load_audio(args.audio, args.start, args.end)
    wav = _write_slice(mono, sr)
    print(f"audio: {args.audio}  range {args.start}-{args.end or len(mono)/sr:.1f}s  lang={args.lang}")

    engines = [e.strip() for e in args.engines.split(",") if e.strip()]
    try:
        if "deepgram" in engines:
            segs, err = _run_deepgram(wav, args.lang)
            _print("DEEPGRAM", segs, err)
        if "whisper" in engines:
            segs, err = _run_whisper(mono, sr, args.lang)
            _print("WHISPER", segs, err)
        if "paraformer" in engines:
            segs, err = _run_paraformer(wav, args.lang)
            _print("PARAFORMER", segs, err)
    finally:
        os.unlink(wav)
        if tmp:
            os.unlink(tmp.name)


if __name__ == "__main__":
    main()
