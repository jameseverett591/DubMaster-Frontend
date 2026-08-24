/**
 * RPT Engine — Rebuild Preview Track Audio Engine
 *
 * Stitches committed segment audio files into a single AudioBuffer
 * representing what the final rebuild will sound like.
 * Frontend-only — no backend calls required.
 */

import type { Segment, StagedEdit } from './editor-types'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RPTStitchResult {
  buffer: AudioBuffer
  duration: number
  segmentCount: number
  /** Segments that had audio but failed to load — these play as SILENCE. */
  skipped: { index: number; url: string }[]
}

// ─── Effective timing ────────────────────────────────────────────────────────
// committed_start_time/committed_end_time are the authoritative, corrected
// position after any edit (drag, resize, lip-sync fix, etc.) — raw start_time/
// end_time can lag behind. Every timeline read site should resolve through
// these instead of reading the raw fields directly.

export function effStart(seg: { start_time: number; committed_start_time?: number | null }): number {
  return seg.committed_start_time ?? seg.start_time
}

export function effEnd(seg: { end_time: number; committed_end_time?: number | null }): number {
  return seg.committed_end_time ?? seg.end_time
}

// ─── Crossfade ───────────────────────────────────────────────────────────────

/** Overlap at or below this is a deliberate timing technique — crossfaded
 *  silently, no badge. Above it the editor starts telling you about it. */
export const CROSSFADE_MAX_SEC = 0.3

/** Above this, two lines are genuinely talking over each other. Still crossfaded
 *  — a blend beats a hard cut either way — but flagged red. */
export const CROSSFADE_WARN_SEC = 1.0

/** One decoded segment, with where its audio ACTUALLY sits on the timeline. */
interface Placed {
  index: number
  buffer: AudioBuffer
  /** Absolute time the audio starts. */
  start: number
  /** Absolute time the audio ENDS — placement plus however much of the buffer
   *  survives the slot clamp, which is not the same as the slot end. */
  audioEnd: number
  /** Fades set by hand on the segment's corner handles, in seconds. */
  manualFadeIn: number
  manualFadeOut: number
}

/**
 * Fade lengths in SECONDS, measured from where the audio really is.
 *
 * This used to read slot boundaries, which are only the same thing when a
 * segment's audio fills its slot. Where the audio was shorter, widening a slot
 * produced a phantom overlap: a fade was scheduled over the end of the audio,
 * which had already finished before the next line began. The result was a dip on
 * the outgoing tail AND a gap before the incoming line — worse than the hard cut
 * it replaced, and impossible to tell apart from a badly timed overlap by ear.
 *
 * Both sides of one overlap must share a length, or the curves stop being
 * complementary and their sum dips or peaks in the middle. Each is capped by both
 * segments' audible durations, or a short line beside a long overlap fades across
 * its whole length and disappears.
 *
 * Only consecutive pairs in time order are considered. A segment long enough to
 * span two later ones would only crossfade with the first; that has not come up,
 * and handling it properly means an interval tree rather than a sort.
 */
function computeFades(
  placed: Placed[],
): Map<number, { fadeIn: number; fadeOut: number }> {
  const order = [...placed].sort((a, b) => a.start - b.start)

  const fades = new Map<number, { fadeIn: number; fadeOut: number }>()
  const get = (i: number) => {
    let f = fades.get(i)
    if (!f) { f = { fadeIn: 0, fadeOut: 0 }; fades.set(i, f) }
    return f
  }

  // Hand-set fades come first: a fade dragged onto a corner is an explicit
  // instruction and must be audible even where nothing overlaps. The overlap pass
  // below then takes the GREATER of the two — a crossfade the timing needs is
  // never shortened by a smaller manual fade, and a longer manual fade is never
  // cut back by a shorter overlap.
  for (const item of order) {
    const dur = Math.max(0, item.audioEnd - item.start)
    const f = get(item.index)
    f.fadeIn = Math.min(Math.max(0, item.manualFadeIn), dur)
    f.fadeOut = Math.min(Math.max(0, item.manualFadeOut), dur)
  }

  for (let i = 0; i < order.length - 1; i++) {
    const a = order[i]
    const b = order[i + 1]
    const overlapSec = a.audioEnd - b.start
    if (overlapSec <= 0.001) continue
    const n = Math.min(
      overlapSec,
      a.audioEnd - a.start,
      b.audioEnd - b.start,
    )
    if (n <= 0) continue
    get(a.index).fadeOut = Math.max(get(a.index).fadeOut, n)
    get(b.index).fadeIn = Math.max(get(b.index).fadeIn, n)
  }
  return fades
}
// ─── Cache ───────────────────────────────────────────────────────────────────

const audioCache = new Map<string, AudioBuffer>()

function getCached(url: string): AudioBuffer | undefined {
  return audioCache.get(url)
}

function setCache(url: string, buffer: AudioBuffer): void {
  audioCache.set(url, buffer)
}

export function invalidateCache(url: string): void {
  audioCache.delete(url)
}

export function clearCache(): void {
  audioCache.clear()
}

/** Surface segments that dropped out of a stitch. A skipped segment is a line
 *  the viewer will not hear, so it is an error, not a debug note. */
function reportSkipped(
  skipped: { index: number; url: string }[],
  stitchedCount: number
): void {
  if (skipped.length === 0) return
  console.error(
    `[RPT] ${skipped.length} segment(s) FAILED to load and will play as silence ` +
    `(${stitchedCount} stitched OK):`,
    skipped
  )
}

// ─── Audio fetch + decode ─────────────────────────────────────────────────────

/** Fetch + decode one segment's audio.
 *
 *  Returns null on any failure, but NEVER silently: a segment that fails to
 *  load is dropped from the stitch and plays as silence, which is
 *  indistinguishable by ear from a line that was never dubbed. On a
 *  feature-length dub that means lines can vanish from a delivered render with
 *  nothing to point at. Every failure path here logs the URL and the reason. */
async function fetchAndDecode(
  url: string,
  audioContext: AudioContext
): Promise<AudioBuffer | null> {
  const cached = getCached(url)
  if (cached) return cached

  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.error(`[RPT] segment audio fetch failed — HTTP ${response.status} ${response.statusText}`, url)
      return null
    }
    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength === 0) {
      console.error('[RPT] segment audio is empty (0 bytes)', url)
      return null
    }
    const decoded = await audioContext.decodeAudioData(arrayBuffer)
    setCache(url, decoded)
    return decoded
  } catch (err) {
    console.error('[RPT] segment audio decode failed', url, err)
    return null
  }
}

// ─── Stitch ───────────────────────────────────────────────────────────────────

/**
 * Stitch all committed segment audio files into a single AudioBuffer.
 * Each segment is placed at its committed_start_time (falling back to
 * start_time). Gaps between segments are silence.
 *
 * @param segments  All segments from the editor store
 * @param duration  Total video duration in seconds
 * @param audioContext  Shared AudioContext from the editor
 */
export async function stitchRPT(
  segments: Segment[],
  duration: number,
  audioContext: AudioContext
): Promise<RPTStitchResult | null> {
  if (!segments.length || duration <= 0) return null

  const sampleRate = audioContext.sampleRate
  const totalSamples = Math.ceil(duration * sampleRate)
  const outputBuffer = audioContext.createBuffer(2, totalSamples, sampleRate)
  const leftChannel = outputBuffer.getChannelData(0)
  const rightChannel = outputBuffer.getChannelData(1)

  const skipped: { index: number; url: string }[] = []

  // PASS 1 — decode everything, and record where each segment's audio really
  // lands. Nothing is written yet: the crossfade lengths depend on how far the
  // audio actually overlaps, which is not knowable from the slots alone.
  const placed: (Placed & { startSample: number; copyLength: number })[] = []
  await Promise.all(
    segments.map(async (seg, segIndex) => {
      const audioUrl = seg.committed_audio_url ?? seg.audio_url
      if (!audioUrl) return

      const startTime = effStart(seg)
      const endTime   = effEnd(seg)
      const startSample = Math.floor(startTime * sampleRate)
      const maxSlotSamples = Math.ceil(endTime * sampleRate) - startSample

      const segBuffer = await fetchAndDecode(audioUrl, audioContext)
      if (!segBuffer) {
        skipped.push({ index: seg.transcript_index ?? seg.index ?? -1, url: audioUrl })
        return
      }
      if (segBuffer.numberOfChannels < 1) return

      const copyLength = Math.min(
        segBuffer.length,
        maxSlotSamples,
        totalSamples - startSample,
      )
      if (copyLength <= 0) return

      placed.push({
        index: segIndex,
        buffer: segBuffer,
        start: startTime,
        // The slot can cut the audio short, so this is the audible end, not the
        // slot end — the whole point of measuring after decode.
        audioEnd: startTime + copyLength / sampleRate,
        manualFadeIn: seg.fade_in ?? 0,
        manualFadeOut: seg.fade_out ?? 0,
        startSample,
        copyLength,
      })
    })
  )

  const fades = computeFades(placed)

  // PASS 2 — mix. Sequential because it is pure CPU work on a shared buffer;
  // parallelism would buy nothing and reintroduce ordering questions.
  for (const item of placed) {
    const srcLeft = item.buffer.getChannelData(0)
    const srcRight = item.buffer.numberOfChannels > 1 ? item.buffer.getChannelData(1) : srcLeft
    const { startSample, copyLength } = item

    // Equal-power crossfade, ADDING rather than assigning.
    //
    // Assignment let the last decode to finish win an overlap outright: the
    // earlier line was cut off mid-word, and which one survived depended on
    // network timing, so two plays of the same timeline could differ. Adding
    // complementary curves is commutative, so order stops mattering.
    //
    // cos/sin rather than a linear ramp: the two sources are different voices and
    // so uncorrelated, where a linear fade sums to an audible dip at the midpoint.
    // Equal-power holds the perceived level across the join.
    const f = fades.get(item.index)
    const fadeIn = Math.min(Math.floor((f?.fadeIn ?? 0) * sampleRate), copyLength)
    const fadeOut = Math.min(Math.floor((f?.fadeOut ?? 0) * sampleRate), copyLength - fadeIn)
    const fadeOutFrom = copyLength - fadeOut

    for (let i = 0; i < copyLength; i++) {
      let gain = 1
      if (fadeIn > 0 && i < fadeIn) {
        gain = Math.sin((i / fadeIn) * Math.PI / 2)
      } else if (fadeOut > 0 && i >= fadeOutFrom) {
        gain = Math.cos(((i - fadeOutFrom) / fadeOut) * Math.PI / 2)
      }
      leftChannel[startSample + i] += srcLeft[i] * gain
      rightChannel[startSample + i] += srcRight[i] * gain
    }
  }

  const stitchedCount = placed.length
  reportSkipped(skipped, stitchedCount)

  return {
    buffer: outputBuffer,
    duration,
    segmentCount: stitchedCount,
    skipped,
  }
}

// ─── Chunk-lens staged overlay ────────────────────────────────────────────────

/**
 * Return copies of `segments` with staged (unsaved) edits applied over the
 * committed fields: a staged take becomes the segment's committed_audio_url,
 * staged timing becomes its committed_* window. Only used for audition
 * playback — never written back to the store or server.
 */
export function overlayStagedEdits(
  segments: Segment[],
  stagedEdits: Record<number, StagedEdit>
): Segment[] {
  const keys = Object.keys(stagedEdits)
  if (keys.length === 0) return segments
  return segments.map((seg) => {
    const edit = stagedEdits[seg.transcript_index ?? -1]
    if (!edit) return seg
    return {
      ...seg,
      committed_audio_url: edit.stagedAudioUrl ?? seg.committed_audio_url,
      committed_start_time: edit.start_time ?? seg.committed_start_time,
      committed_end_time: edit.end_time ?? seg.committed_end_time,
    }
  })
}

/**
 * Stitch one chunk window into a LOCAL-timebase AudioBuffer (0 = window.start).
 * Feature-length dubs can't afford a full-length Float32 stitch (a 2-hour
 * stereo buffer is ~2.5 GB), so chunk mode stitches only the window being
 * edited. Segments outside the window are skipped; audio is clipped at the
 * window edges.
 */
export async function stitchRPTWindow(
  segments: Segment[],
  windowStart: number,
  windowEnd: number,
  audioContext: AudioContext
): Promise<RPTStitchResult | null> {
  const duration = windowEnd - windowStart
  if (!segments.length || duration <= 0) return null

  const sampleRate = audioContext.sampleRate
  const totalSamples = Math.ceil(duration * sampleRate)
  const outputBuffer = audioContext.createBuffer(2, totalSamples, sampleRate)
  const leftChannel = outputBuffer.getChannelData(0)
  const rightChannel = outputChannelData(outputBuffer)

  const skipped: { index: number; url: string }[] = []

  // PASS 1 — decode, and record where each segment's audio really lands. See
  // stitchRPT: crossfade lengths depend on actual audio overlap, not slots.
  const placed: (Placed & {
    absStart: number; absEnd: number
    dstStartSample: number; srcOffsetSamples: number; copyLength: number; ratio: number
  })[] = []

  await Promise.all(
    segments.map(async (seg, segIndex) => {
      const audioUrl = seg.committed_audio_url ?? seg.audio_url
      if (!audioUrl) return

      const absStart = effStart(seg)
      const absEnd = effEnd(seg)
      // Skip segments fully outside the window
      if (absEnd <= windowStart || absStart >= windowEnd) return

      const segBuffer = await fetchAndDecode(audioUrl, audioContext)
      if (!segBuffer) {
        skipped.push({ index: seg.transcript_index ?? seg.index ?? -1, url: audioUrl })
        return
      }
      if (segBuffer.numberOfChannels < 1) return

      // Source offset when the segment starts before the window (clip left edge)
      const srcOffsetSamples = absStart < windowStart
        ? Math.floor((windowStart - absStart) * segBuffer.sampleRate)
        : 0
      const dstStartSample = Math.max(0, Math.floor((absStart - windowStart) * sampleRate))
      const maxSlotSamples = Math.ceil((absEnd - windowStart) * sampleRate) - dstStartSample

      const copyLength = Math.max(0, Math.min(
        segBuffer.length - srcOffsetSamples,
        maxSlotSamples,
        totalSamples - dstStartSample,
      ))
      if (copyLength <= 0) return

      // Audible extent in ABSOLUTE time. Measured from the segment's own start,
      // not the clipped one, so a segment straddling the window edge still
      // reports the same span it would in a full-film stitch — the fade must not
      // change depending on which window happens to be open.
      const audibleSec = Math.min(
        segBuffer.duration,
        absEnd - absStart,
      )

      placed.push({
        index: segIndex,
        buffer: segBuffer,
        start: absStart,
        audioEnd: absStart + audibleSec,
        manualFadeIn: seg.fade_in ?? 0,
        manualFadeOut: seg.fade_out ?? 0,
        absStart, absEnd,
        dstStartSample, srcOffsetSamples, copyLength,
        ratio: segBuffer.sampleRate / sampleRate,
      })
    })
  )

  const fades = computeFades(placed)

  // PASS 2 — mix.
  for (const item of placed) {
    const srcLeft = item.buffer.getChannelData(0)
    const srcRight = item.buffer.numberOfChannels > 1 ? item.buffer.getChannelData(1) : srcLeft
    const { absStart, absEnd, dstStartSample, srcOffsetSamples, copyLength, ratio } = item

    // Fade bounds are resolved in ABSOLUTE time and then translated into this
    // window's index space, because a segment can start before the window: its
    // fade-in may lie partly or wholly outside, and measuring from the clipped
    // start would place the curve in the wrong spot.
    const f = fades.get(item.index)
    const fadeInSec = f?.fadeIn ?? 0
    const fadeOutSec = f?.fadeOut ?? 0
    const fadeInEnd = fadeInSec > 0
      ? Math.floor((absStart + fadeInSec - windowStart) * sampleRate) - dstStartSample
      : 0
    const fadeInLen = Math.floor(fadeInSec * sampleRate)
    // Anchored to the AUDIBLE end, not the slot end — they differ whenever the
    // audio is shorter than its slot, which is exactly the case this pass exists
    // to get right.
    const fadeOutFrom = fadeOutSec > 0
      ? Math.floor((item.audioEnd - fadeOutSec - windowStart) * sampleRate) - dstStartSample
      : Number.POSITIVE_INFINITY
    const fadeOutLen = Math.floor(fadeOutSec * sampleRate)

    const gainAt = (i: number): number => {
      if (fadeInLen > 0 && i < fadeInEnd) {
        // Distance back to the segment's true start, which may precede i = 0.
        const pos = fadeInLen - (fadeInEnd - i)
        if (pos < fadeInLen) return Math.sin((Math.max(0, pos) / fadeInLen) * Math.PI / 2)
      }
      if (fadeOutLen > 0 && i >= fadeOutFrom) {
        const pos = i - fadeOutFrom
        return Math.cos((Math.min(fadeOutLen, pos) / fadeOutLen) * Math.PI / 2)
      }
      return 1
    }

    if (Math.abs(ratio - 1) < 0.001) {
      for (let i = 0; i < copyLength; i++) {
        const g = gainAt(i)
        leftChannel[dstStartSample + i] += srcLeft[srcOffsetSamples + i] * g
        rightChannel[dstStartSample + i] += srcRight[srcOffsetSamples + i] * g
      }
    } else {
      for (let i = 0; i < copyLength; i++) {
        const si = srcOffsetSamples + Math.floor(i * ratio)
        if (si >= item.buffer.length) break
        const g = gainAt(i)
        leftChannel[dstStartSample + i] += srcLeft[si] * g
        rightChannel[dstStartSample + i] += srcRight[si] * g
      }
    }
  }

  const stitchedCount = placed.length
  reportSkipped(skipped, stitchedCount)

  return { buffer: outputBuffer, duration, segmentCount: stitchedCount, skipped }
}

function outputChannelData(buffer: AudioBuffer): Float32Array {
  return buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)
}

// ─── Playback ─────────────────────────────────────────────────────────────────

/**
 * Schedule playback of an RPT buffer from a given time offset.
 * Returns the AudioBufferSourceNode so the caller can stop it.
 */
export function scheduleRPTPlayback(
  buffer: AudioBuffer,
  startAtSeconds: number,
  audioContext: AudioContext,
  gainNode?: GainNode,
  playbackRate = 1.0
): AudioBufferSourceNode {
  const source = audioContext.createBufferSource()
  source.buffer = buffer
  source.playbackRate.value = playbackRate

  const destination = gainNode ?? audioContext.destination
  source.connect(destination)

  const offset = Math.max(0, Math.min(startAtSeconds, buffer.duration))
  source.start(0, offset)

  return source
}

// ─── Debounced stitch trigger ─────────────────────────────────────────────────

let stitchTimer: ReturnType<typeof setTimeout> | null = null
const STITCH_DEBOUNCE_MS = 500

/**
 * Request a re-stitch of the RPT buffer.
 * Debounced to avoid thrashing on rapid segment edits.
 */
export function requestRPTStitch(
  segments: Segment[],
  duration: number,
  audioContext: AudioContext,
  onStart: () => void,
  onComplete: (result: RPTStitchResult | null) => void
): void {
  if (stitchTimer) clearTimeout(stitchTimer)
  stitchTimer = setTimeout(async () => {
    onStart()
    const result = await stitchRPT(segments, duration, audioContext)
    onComplete(result)
    stitchTimer = null
  }, STITCH_DEBOUNCE_MS)
}
