"""Respeecher Space — real-time TTS as a second engine alongside Fish Audio.

Respeecher is deliberately NOT a drop-in replacement for Fish:

  * It has no directive language.  Fish S2.1-pro parses free-form ``[bracket]``
    delivery notes; Respeecher ignores them and would speak them aloud.  The
    only performance controls are voice choice, punctuation and sentence
    structure.
  * Its sampling parameters ARE settable, but only when nested inside the
    ``voice`` object — ``{"voice": {"id": ..., "sampling_params": {...}}}``.
    A ``sampling_params`` sent at the top level is silently dropped (the API
    accepts unknown top-level keys with a 200), which makes a wrong-shaped
    request look exactly like an ignored parameter.  Nested values are range
    checked: an out-of-range temperature returns 400 with the field named.
    ``/voices`` reports each voice's defaults as a starting point.
  * It has no child voice.  All 25 voices are male/female adult.  Speakers the
    pipeline classifies as ``child`` must stay on Fish.

What shapes this module: **duration is unstable unless you pin a seed**.  The
same five-word line measured 1.91s to 3.25s across nine unseeded runs — a 70%
spread.  With a seed, generation is exactly reproducible: three runs at
``seed=42`` returned byte-identical audio, and a different seed returned a
different but equally repeatable take.

So takes are raced on *random* seeds to discover a good read, and the winning
seed is handed back to the caller.  Persist it and every later regeneration of
that line returns the identical performance — which is what a dubbing platform
needs, since a re-render must not quietly change an approved delivery.

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
import random
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

# How many past takes to remember per segment, as seeds rather than audio files.
# A pinned seed re-renders byte-identically for one request, so the seed IS the
# take — keeping the WAV would only buy instant playback, at the cost of a
# filename scheme, an eviction policy, and files that any later render silently
# overwrites.  Twelve is four races' worth.
SEED_HISTORY_MAX = int(os.getenv("RESPEECHER_SEED_HISTORY", "12"))

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

    async def _generate_once(
        self,
        client: httpx.AsyncClient,
        text: str,
        voice_id: str,
        sampling_params: Optional[Dict] = None,
    ) -> Optional[bytes]:
        """One take.  Returns raw WAV bytes, or None on failure.

        ``sampling_params`` MUST be nested inside the voice object — sent at the
        top level the API drops it silently and still returns 200.
        """
        voice: Dict = {"id": voice_id}
        if sampling_params:
            voice["sampling_params"] = sampling_params
        try:
            r = await client.post(
                f"{self.base_url}/tts/bytes",
                headers=self._headers,
                json={"transcript": text, "voice": voice, "context_id": ""},
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
        sampling_params: Optional[Dict] = None,
        seed: Optional[int] = None,
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

        sampling_params : dict, optional
            Tuning sent to the model, nested inside the voice object.  Start from
            the voice's own defaults (``GET /voices``).  Ranges are enforced by
            the API, which 400s naming the offending field: temperature >= 0,
            top_k -1 or > 0, 0 < top_p <= 1, 0 <= min_p <= 1,
            1 <= repetition_penalty <= 2, 0 <= presence/frequency_penalty <= 2.
        seed : int, optional
            Pin generation.  Same seed + same params + same text = byte-identical
            audio, so a re-render cannot silently change an approved delivery.
            When set, exactly one take is generated — racing identical outputs
            would be waste.  A seed inside ``sampling_params`` takes precedence.

        ``takes`` is the complete ordered list, best fit first — ``takes[0]`` is
        always the chosen take and equals ``path``.  ``take_seeds`` runs parallel
        to it so an alternate can be pinned.

        Returns ``{"path", "engine", "duration", "takes", "take_seeds", "fits",
        "seed", "sampling_params"}`` on success,
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
        base = dict(sampling_params or {})
        pinned = base.pop("seed", None)
        if pinned is None:
            pinned = seed

        if pinned is not None:
            # A pinned seed makes every take byte-identical, so racing is pure
            # waste. One request, exactly reproducible.
            seeds = [int(pinned)]
        else:
            # Random seeds so the takes are genuinely different reads, and the
            # winner's seed can be persisted to reproduce it later.
            seeds = [random.randint(1, 2**31 - 1) for _ in range(n)]

        # Generated SEQUENTIALLY, deliberately. Concurrent requests are batched
        # server-side and batch composition changes the numerics, so a take made
        # concurrently is not reproducible from its seed. That turned take
        # selection into a lie: pick the take that fits, replay its seed, get a
        # different length (observed 4.92s chosen, 14.37s on replay). Sequential
        # costs latency and buys the guarantee that what you picked is what you
        # keep — and what any later regeneration returns.
        results: List[Optional[bytes]] = []
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
            for s in seeds:
                results.append(
                    await self._generate_once(client, text, voice_id, {**base, "seed": s})
                )

        candidates = [
            (payload, _wav_duration(payload), s)
            for payload, s in zip(results, seeds) if payload
        ]
        candidates = [c for c in candidates if c[1]]
        if not candidates:
            logger.error(f"[RESPEECHER] all {len(seeds)} takes failed for voice={voice_id}")
            return None

        if target_duration and target_duration > 0:
            # Prefer takes that FIT the slot, longest first.
            #
            # Sorting by absolute distance was wrong for dubbing: for a 1.93s slot
            # it ranked a 2.32s take above a 1.56s one, and anything over the slot
            # forces regenerate_segment to grow the segment into neighbouring
            # silence — which visibly stretches the block on the timeline (and the
            # ORIGINAL track with it, since both read the same start/end).
            #
            # A take under the slot costs nothing. Among those, the longest is
            # closest to natural pacing. Only if none fit do we take the smallest
            # overrun. The 0.05s tolerance mirrors the fit pass downstream.
            limit = target_duration + 0.05
            candidates.sort(key=lambda c: (0, -c[1]) if c[1] <= limit else (1, c[1]))
        best_wav, best_dur, best_seed = candidates[0]

        if not await self._to_mp3(best_wav, output_path):
            return None

        # takes[0] is always the chosen take (== output_path), then the alternates
        # in fit order. A complete ordered list means the panel can render an
        # audition strip without an extra "selected" index to keep in sync.
        take_paths: List[str] = [output_path]
        # Parallel to take_paths: the seed behind each one, so the editor can pin
        # an alternate take and get it back exactly.
        take_seeds: List[int] = [best_seed]
        if keep_takes and len(candidates) > 1:
            stem, ext = os.path.splitext(output_path)
            for i, (wav, _dur, s) in enumerate(candidates[1:], start=2):
                alt = f"{stem}_take{i}{ext}"
                if await self._to_mp3(wav, alt):
                    take_paths.append(alt)
                    take_seeds.append(s)

        fits = True
        if target_duration and target_duration > 0:
            fits = best_dur <= target_duration * ATEMPO_SAFE_RATIO

        spread = f"{min(c[1] for c in candidates):.2f}-{max(c[1] for c in candidates):.2f}s"
        logger.info(
            f"[RESPEECHER] voice={voice_id} takes={len(candidates)}/{len(seeds)} "
            f"spread={spread} chose={best_dur:.2f}s seed={best_seed} "
            f"{'(pinned)' if pinned is not None else '(raced)'} "
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
            "take_seeds": take_seeds,
            "fits": fits,
            # Persist these two and this exact performance is reproducible.
            "seed": best_seed,
            "sampling_params": ({**base, "seed": best_seed} if best_seed is not None else None),
        }


respeecher_tts = RespeecherTTS()
