"""Respeecher Space — real-time TTS as a second engine alongside Fish Audio.

Respeecher is deliberately NOT a drop-in replacement for Fish:

  * It has no directive language.  Fish S2.1-pro parses free-form ``[bracket]``
    delivery notes; Respeecher ignores them and would speak them aloud.  The
    only performance controls are voice choice, punctuation and sentence
    structure.
  * Its sampling parameters are NOT settable.  ``/voices`` reports per-voice
    ``sampling_params`` (temperature, top_p, repetition_penalty, ...) but the
    public generation endpoint silently ignores any you send — verified by
    probe: a request carrying a nonsense field returns 200 just the same, and
    three runs at a fixed ``seed`` produce three different durations.  Treat
    those numbers as read-only metadata describing the voice.
  * It has no child voice.  All 25 voices are male/female adult.  Speakers the
    pipeline classifies as ``child`` must stay on Fish.

The consequence that shapes this module: **output duration is unstable**.  The
same five-word line measured 1.91s to 3.25s across nine runs — a 70% spread,
with no parameter available to constrain it.  For a timing-locked dubbing
platform that is the dominant risk, so ``text_to_speech`` generates several
takes concurrently and keeps the one closest to the segment's slot, rather
than accepting whatever the first roll produced.

API contract (confirmed against the live account, 2026-08-01):

    GET  {base}/voices        -> [{id, full_name, gender, accent, is_best,
                                   sampling_params}, ...]
    POST {base}/tts/bytes     -> audio/wav, 22050 Hz, 16-bit mono PCM
    body {"transcript": str, "voice": {"id": str}, "context_id": str}
    auth X-API-Key header

Note the doubled path segment: ``voices`` sits at the model root while
generation sits under ``/tts/`` — ``{base}/tts/bytes``, not ``{base}/bytes``.
"""

import asyncio
import io
import logging
import os
import wave
from typing import Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

RESPEECHER_API_KEY = os.getenv("RESPEECHER_API_KEY", "")
RESPEECHER_BASE_URL = os.getenv(
    "RESPEECHER_BASE_URL", "https://api.respeecher.com/v1/public/tts/en-rt"
)

# How many takes to race per generation.  Three covers most of the observed
# duration spread at a cost that is trivial for a real-time engine; they run
# concurrently, so wall-clock is roughly one take.
RESPEECHER_TAKES = int(os.getenv("RESPEECHER_TAKES", "3"))

# Beyond roughly this much time-stretch, atempo artifacts become audible.  A
# take that still overruns its slot by more than this is reported as needing
# attention rather than silently squashed to fit.
ATEMPO_SAFE_RATIO = float(os.getenv("RESPEECHER_ATEMPO_SAFE_RATIO", "1.15"))

# The pipeline works at 44.1 kHz mono; Respeecher returns 22.05 kHz.
TARGET_SAMPLE_RATE = 44100

_REQUEST_TIMEOUT = httpx.Timeout(60.0, connect=15.0)


def _wav_duration(payload: bytes) -> Optional[float]:
    """Duration in seconds of an in-memory WAV, or None if it will not parse."""
    try:
        with wave.open(io.BytesIO(payload)) as w:
            rate = w.getframerate()
            return w.getnframes() / rate if rate else None
    except Exception:
        return None


class RespeecherTTS:
    def __init__(self, api_key: str = RESPEECHER_API_KEY):
        self.api_key = api_key
        self.base_url = RESPEECHER_BASE_URL.rstrip("/")
        self.enabled = bool(api_key)
        self._voices_cache: Optional[List[Dict]] = None
        if not self.enabled:
            logger.info("Respeecher disabled — RESPEECHER_API_KEY not set.")

    @property
    def _headers(self) -> Dict[str, str]:
        return {"X-API-Key": self.api_key, "Content-Type": "application/json"}

    async def get_voices(self, refresh: bool = False) -> List[Dict]:
        """The 25 available voices.  Cached — the catalogue is static."""
        if not self.enabled:
            return []
        if self._voices_cache is not None and not refresh:
            return self._voices_cache
        try:
            async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
                r = await client.get(f"{self.base_url}/voices", headers=self._headers)
                r.raise_for_status()
                data = r.json()
            voices = data if isinstance(data, list) else data.get("voices", data.get("data", []))
            self._voices_cache = voices
            logger.info(f"[RESPEECHER] loaded {len(voices)} voices")
            return voices
        except Exception as e:
            logger.error(f"[RESPEECHER] voice list failed: {e}")
            return []

    def has_voice(self, voice_id: str) -> bool:
        """True when voice_id is in the cached catalogue.  Does not fetch."""
        if not self._voices_cache:
            return False
        return any(v.get("id") == voice_id for v in self._voices_cache)

    async def _generate_once(self, client: httpx.AsyncClient, text: str, voice_id: str) -> Optional[bytes]:
        """One take.  Returns raw WAV bytes, or None on failure."""
        try:
            r = await client.post(
                f"{self.base_url}/tts/bytes",
                headers=self._headers,
                json={"transcript": text, "voice": {"id": voice_id}, "context_id": ""},
            )
            r.raise_for_status()
            payload = r.content
            if not payload.startswith(b"RIFF"):
                logger.warning(f"[RESPEECHER] non-WAV response ({len(payload)} bytes)")
                return None
            return payload
        except Exception as e:
            logger.warning(f"[RESPEECHER] take failed: {e}")
            return None

    async def _to_mp3(self, wav_bytes: bytes, output_path: str) -> bool:
        """Transcode a WAV buffer to the pipeline's 44.1 kHz mono output file."""
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-hide_banner", "-nostats", "-loglevel", "error",
            "-f", "wav", "-i", "pipe:0",
            "-ar", str(TARGET_SAMPLE_RATE), "-ac", "1",
            output_path,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate(wav_bytes)
        if proc.returncode != 0:
            logger.error(f"[RESPEECHER] ffmpeg failed: {stderr.decode('utf-8', 'replace')[:300]}")
            return False
        return True

    async def text_to_speech(
        self,
        text: str,
        voice_id: str,
        output_path: str,
        target_duration: Optional[float] = None,
        takes: int = RESPEECHER_TAKES,
        keep_takes: bool = True,
    ) -> Optional[Dict]:
        """Synthesise ``text``, racing several takes and keeping the best fit.

        Parameters
        ----------
        target_duration : float, optional
            The segment's slot, in seconds.  When given, the take whose
            duration is closest to it wins.  When omitted, the first
            successful take wins (no basis on which to prefer another).
        takes : int
            How many concurrent generations to race.
        keep_takes : bool
            Also write the losing takes as ``<stem>_takeN.mp3`` so the editor
            can audition them.  The duration spread is wide enough that the
            alternates are genuinely different reads, not near-duplicates.

        Returns ``{"path", "engine", "duration", "takes", "fits"}`` on success,
        or None on total failure.  ``fits`` is False when even the best take
        overruns ``target_duration`` by more than time-stretch can absorb
        cleanly — the caller should surface that rather than force it.
        """
        if not self.enabled:
            logger.warning("[RESPEECHER] disabled — no API key.")
            return None
        if not text or not text.strip():
            logger.warning("[RESPEECHER] empty text; nothing to synthesise.")
            return None

        n = max(1, takes)
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
            results = await asyncio.gather(
                *(self._generate_once(client, text, voice_id) for _ in range(n)),
                return_exceptions=False,
            )

        candidates = [(p, _wav_duration(p)) for p in results if p]
        candidates = [(p, d) for p, d in candidates if d]
        if not candidates:
            logger.error(f"[RESPEECHER] all {n} takes failed for voice={voice_id}")
            return None

        if target_duration and target_duration > 0:
            candidates.sort(key=lambda c: abs(c[1] - target_duration))
        best_wav, best_dur = candidates[0]

        if not await self._to_mp3(best_wav, output_path):
            return None

        take_paths: List[str] = []
        if keep_takes and len(candidates) > 1:
            stem, ext = os.path.splitext(output_path)
            for i, (wav, _dur) in enumerate(candidates[1:], start=2):
                alt = f"{stem}_take{i}{ext}"
                if await self._to_mp3(wav, alt):
                    take_paths.append(alt)

        fits = True
        if target_duration and target_duration > 0:
            fits = best_dur <= target_duration * ATEMPO_SAFE_RATIO

        spread = f"{min(d for _, d in candidates):.2f}-{max(d for _, d in candidates):.2f}s"
        logger.info(
            f"[RESPEECHER] voice={voice_id} takes={len(candidates)}/{n} "
            f"spread={spread} chose={best_dur:.2f}s "
            f"target={target_duration if target_duration else '—'} fits={fits}"
        )
        if not fits:
            logger.warning(
                f"[RESPEECHER] best take {best_dur:.2f}s overruns slot "
                f"{target_duration:.2f}s beyond {ATEMPO_SAFE_RATIO}x — flagging "
                f"rather than stretching."
            )

        return {
            "path": output_path,
            "engine": "respeecher",
            "duration": best_dur,
            "takes": take_paths,
            "fits": fits,
        }


respeecher_tts = RespeecherTTS()
