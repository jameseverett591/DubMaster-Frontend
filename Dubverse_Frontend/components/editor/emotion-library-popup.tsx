'use client'

import { useState } from 'react'
import { EMOTION_LIBRARY, libraryEmotionValue, EMOTION_LIBRARY_COUNT } from '@/lib/emotion-catalog'
import { useT } from '@/lib/use-t'

/**
 * Floating Emotion Library — a searchable, categorized chart of ~194 delivery
 * states. Picking one calls onSelect with the Fish-tag value ("name, description")
 * and the display name, then closes.
 */
export function EmotionLibraryPopup({
  open,
  onClose,
  onSelect,
}: {
  open: boolean
  onClose: () => void
  onSelect: (value: string, name: string) => void
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  if (!open) return null

  const q = query.trim().toLowerCase()
  const filtered = EMOTION_LIBRARY.map((cat) => ({
    ...cat,
    emotions: q
      ? cat.emotions.filter(
          (e) => e.name.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q),
        )
      : cat.emotions,
  })).filter((cat) => cat.emotions.length > 0)

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[min(940px,92vw)] max-h-[85vh] flex flex-col rounded-2xl border border-violet-500/40 bg-[#0d1220] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <span className="text-violet-300 font-semibold text-sm">🎭 Emotion Library</span>
          <span className="text-[10px] text-slate-500">{EMOTION_LIBRARY_COUNT} states</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emotions…"
            className="ml-auto w-64 text-xs px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/60"
          />
          <button onClick={onClose} className="text-slate-500 hover:text-white text-lg leading-none px-1" title={t('Close')}>
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-4">
          {filtered.length === 0 && (
            <div className="text-slate-500 text-sm py-10 text-center">No emotions match “{query}”.</div>
          )}
          {filtered.map((cat) => (
            <div key={cat.key}>
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5 sticky top-0 bg-[#0d1220] py-1 z-10">
                {cat.icon} {cat.label} <span className="text-slate-600 normal-case">({cat.emotions.length})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cat.emotions.map((e) => (
                  <button
                    key={e.name}
                    title={e.desc}
                    onClick={() => {
                      onSelect(libraryEmotionValue(e), e.name)
                      onClose()
                    }}
                    className="text-[11px] px-2 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700 hover:bg-violet-500/25 hover:text-violet-200 hover:border-violet-400/50 transition-colors select-none"
                  >
                    {e.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
