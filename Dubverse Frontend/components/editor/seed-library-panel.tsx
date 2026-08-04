'use client'

import { useMemo, useState } from 'react'
import { Library, Trash2, Search, Lock, Unlock } from 'lucide-react'
import type { Segment } from '@/lib/editor-types'
import { cn } from '@/lib/utils'

/** One recallable take.
 *
 *  Bound to the segment it was raced on, deliberately. A seed is an RNG
 *  initialisation, not a style handle: replayed against different text it does
 *  not carry the delivery over, it just reads the new words arbitrarily. So an
 *  entry travels with its line and its transcript_index rather than floating
 *  free as a reusable "voice setting" — which is what a cross-segment seed list
 *  would imply, and would be a false promise. */
export interface SeedLibraryEntry {
  segmentIndex: number
  transcriptIndex: number
  text: string
  speaker: string
  seed: number
  voice: string
  params: Record<string, number> | null
  /** True when this seed is the one the segment currently renders from. */
  isLive: boolean
  /** True when the segment is locked, so a recall would be refused (423). */
  segmentLocked: boolean
  /** Locked by the user: exempt from the history cap, never evicted. */
  kept: boolean
}

/** Collect every recorded take across the job, newest segment order preserved.
 *  Kept out of the component so the editor can size the tab badge without
 *  rendering the panel. */
export function buildSeedLibrary(segments: Segment[]): SeedLibraryEntry[] {
  const out: SeedLibraryEntry[] = []
  segments.forEach((seg, i) => {
    for (const h of seg.respeecher_seed_history ?? []) {
      out.push({
        segmentIndex: i,
        transcriptIndex: seg.transcript_index ?? i,
        text: seg.committed_adapted_text || seg.target_text || seg.active_text || '',
        speaker: seg.speaker_id ?? '',
        seed: h.seed,
        voice: h.voice,
        params: h.params ?? null,
        // Engine must match too. respeecher_seed deliberately SURVIVES a render on
        // Fish so the take stays recallable, which means a matching seed alone does
        // not mean you are hearing it — after a Fish render the badge would claim a
        // Respeecher take is live while the segment plays Fish audio.
        isLive: seg.engine === 'respeecher' && seg.respeecher_seed === h.seed,
        kept: h.kept === true,
        // The editor models a frozen segment as status, not a boolean field —
        // it is what the backend's `locked` flag maps to on load.
        segmentLocked: seg.status === 'locked',
      })
    }
  })
  return out
}

export default function SeedLibraryPanel({
  entries,
  isRegenerating,
  selectedTranscriptIndex,
  onUse,
  onDelete,
  onJumpToSegment,
  onToggleKept,
}: {
  entries: SeedLibraryEntry[]
  isRegenerating: boolean
  selectedTranscriptIndex?: number | null
  /** Re-render the entry's OWN segment from its seed — one request, exact. */
  onUse: (entry: SeedLibraryEntry) => void
  onDelete: (entry: SeedLibraryEntry) => void
  onJumpToSegment: (segmentIndex: number) => void
  /** Toggle the entry's exemption from the history cap. */
  onToggleKept: (entry: SeedLibraryEntry, kept: boolean) => void
}) {
  const [q, setQ] = useState('')
  const [mineOnly, setMineOnly] = useState(false)

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return entries.filter((e) => {
      if (mineOnly && e.transcriptIndex !== selectedTranscriptIndex) return false
      if (!needle) return true
      return (
        e.text.toLowerCase().includes(needle) ||
        e.voice.toLowerCase().includes(needle) ||
        String(e.seed).includes(needle)
      )
    })
  }, [entries, q, mineOnly, selectedTranscriptIndex])

  return (
    <div className="h-full flex flex-col p-3 gap-2 text-xs text-slate-300 min-h-0">
      {/* ── header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 text-slate-200 font-medium">
          <Library className="h-3.5 w-3.5 text-teal-400" />
          Seed Library
        </div>
        <span className="text-[9px] font-mono text-teal-400/80">
          {shown.length}/{entries.length}
        </span>
      </div>

      <p className="text-[10px] text-teal-300/70 leading-snug shrink-0">
        Every take Respeecher has raced, as seeds. <span className="text-teal-200">Use</span> re-renders
        that exact read in one request. A seed only reproduces its own line — the text is
        part of the take.
      </p>

      {/* ── filters ────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-600" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by line, voice or seed…"
            className="w-full rounded-md border border-slate-800 bg-slate-900/60 pl-6 pr-2 py-1
                       text-[10px] text-teal-100 placeholder:text-teal-700/60
                       focus:outline-none focus:border-teal-500/60"
          />
        </div>
        <button
          type="button"
          onClick={() => setMineOnly((v) => !v)}
          title="Show only takes for the selected segment"
          className={cn(
            'shrink-0 text-[9px] px-2 py-1 rounded-md border transition-colors',
            mineOnly
              ? 'border-teal-400/60 bg-teal-500/20 text-white'
              : 'border-slate-800 bg-slate-900/60 text-teal-400/70 hover:text-teal-200'
          )}
        >
          this segment
        </button>
      </div>

      {/* ── list ───────────────────────────────────────────────── */}
      {entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center px-6">
          <p className="text-[10px] text-teal-300/60 leading-snug">
            No takes recorded yet. Generate a segment with Respeecher and every seed it
            races is kept here.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[10px] text-teal-300/50">Nothing matches that filter.</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-0.5">
          {shown.map((e) => (
            <div
              key={`${e.transcriptIndex}-${e.seed}`}
              className={cn(
                'group flex items-center gap-1.5 rounded-md px-1.5 py-1 border border-transparent',
                e.transcriptIndex === selectedTranscriptIndex
                  ? 'bg-slate-800/70 border-slate-700/60'
                  : 'hover:bg-slate-900/70'
              )}
            >
              <button
                type="button"
                onClick={() => onJumpToSegment(e.segmentIndex)}
                title="Jump to this segment"
                className="text-[9px] font-mono text-teal-600/70 hover:text-teal-200 shrink-0 w-7 text-left"
              >
                #{e.transcriptIndex}
              </button>

              <span className="text-[10px] text-teal-100 flex-1 min-w-0 truncate" title={e.text}>
                {e.text || <span className="text-teal-700/60">(no text)</span>}
              </span>

              <span
                className="text-[9px] font-mono text-teal-400/80 shrink-0 w-14 truncate"
                title={`voice: ${e.voice}`}
              >
                {e.voice}
              </span>
              <span className="text-[9px] font-mono text-teal-500/70 shrink-0 w-20 text-right">
                {e.seed}
              </span>

              {/* Keep-forever lock. Distinct from the segment lock below, which is
                  rendered as a disabled button rather than a second padlock — two
                  padlocks side by side meaning different things reads as one state. */}
              <button
                type="button"
                onClick={() => onToggleKept(e, !e.kept)}
                title={e.kept
                  ? 'Locked — exempt from the library cap, never evicted. Click to unlock.'
                  : `Lock this take so it is never evicted. Unlocked takes drop off after ${'12'} entries.`}
                className={cn(
                  'shrink-0 h-4 w-4 rounded flex items-center justify-center transition-colors',
                  e.kept
                    ? 'text-amber-300 hover:text-amber-200 bg-amber-500/20'
                    : 'text-white hover:text-amber-300'
                )}
              >
                {e.kept ? <Lock className="h-2.5 w-2.5" /> : <Unlock className="h-2.5 w-2.5" />}
              </button>

              {e.isLive ? (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300 shrink-0 w-10 text-center">
                  live
                </span>
              ) : (
                <button
                  type="button"
                  disabled={isRegenerating || e.segmentLocked}
                  onClick={() => onUse(e)}
                  title={e.segmentLocked
                    ? 'Segment is locked — unlock the segment to recall a take'
                    : `Re-render "${e.text}" from seed ${e.seed} on ${e.voice} — 1 request, byte-identical`}
                  className="shrink-0 w-10 text-[9px] px-1.5 py-0.5 rounded-full border border-teal-400/50
                             bg-teal-500/15 text-white hover:bg-teal-500/35 hover:border-teal-300
                             disabled:opacity-30 disabled:hover:bg-teal-500/15 transition-colors"
                >
                  use
                </button>
              )}

              <button
                type="button"
                onClick={() => onDelete(e)}
                title="Forget this take. Removes the entry only — the segment's current audio is untouched."
                className="shrink-0 h-4 w-4 rounded flex items-center justify-center
                           text-red-500 hover:text-red-300 hover:bg-red-500/15 transition-colors"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
