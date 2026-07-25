/**
 * RPT Engine — Rebuild Preview Track Audio Engine
 *
 * Stitches committed segment audio files into a single AudioBuffer
 * representing what the final rebuild will sound like.
 * Frontend-only — no backend calls required.
 */

import type { Segment } from './editor-types'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RPTStitchResult {
  buffer: AudioBuffer
  duration: number
  segmentCount: number
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

// ─── Audio fetch + decode ─────────────────────────────────────────────────────

async function fetchAndDecode(
  url: string,
  audioContext: AudioContext
): Promise<AudioBuffer | null> {
  const cached = getCached(url)
  if (cached) return cached

  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const arrayBuffer = await response.arrayBuffer()
    const decoded = await audioContext.decodeAudioData(arrayBuffer)
    setCache(url, decoded)
    return decoded
  } catch {
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

  let stitchedCount = 0

  await Promise.all(
    segments.map(async (seg) => {
      const audioUrl = seg.committed_audio_url ?? seg.audio_url
      if (!audioUrl) return

      const startTime = effStart(seg)
      const endTime   = effEnd(seg)
      const startSample = Math.floor(startTime * sampleRate)
      const maxSlotSamples = Math.ceil(endTime * sampleRate) - startSample

      const segBuffer = await fetchAndDecode(audioUrl, audioContext)
      if (!segBuffer) return

      const srcLeft = segBuffer.numberOfChannels > 0
        ? segBuffer.getChannelData(0)
        : null
      const srcRight = segBuffer.numberOfChannels > 1
        ? segBuffer.getChannelData(1)
        : srcLeft

      if (!srcLeft) return

      const copyLength = Math.min(
        segBuffer.length,
        maxSlotSamples,
        totalSamples - startSample
      )

      for (let i = 0; i < copyLength; i++) {
        leftChannel[startSample + i] = srcLeft[i]
        rightChannel[startSample + i] = (srcRight ?? srcLeft)[i]
      }

      stitchedCount++
    })
  )

  return {
    buffer: outputBuffer,
    duration,
    segmentCount: stitchedCount,
  }
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
