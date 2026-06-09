'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiClient, type EmotionalChord } from '@/lib/api-client'
import { Trash2 } from 'lucide-react'

interface Props {
  jobId: string
  selectedSegmentIndex: number | null
  onApplyChord: (emotion: string, state: string, trait: string, intensity: number) => void
}

export function EmotionalIntelligencePanel({ jobId, selectedSegmentIndex, onApplyChord }: Props) {
  const [chords, setChords] = useState<EmotionalChord[]>([])
  const [loading, setLoading] = useState(true)

  const fetchChords = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiClient.getEmotionalLibrary()
      setChords(data)
    } catch (err) {
      console.warn('[EmotionalLibrary] fetch error', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchChords() }, [fetchChords])

  const handleDelete = async (id: string) => {
    try {
      await apiClient.deleteEmotionalChord(id)
      setChords(prev => prev.filter(c => c.id !== id))
    } catch (err) {
      console.warn('[EmotionalLibrary] delete error', err)
    }
  }

  const handleClearAll = async () => {
    try {
      await apiClient.clearEmotionalLibrary()
      setChords([])
    } catch (err) {
      console.warn('[EmotionalLibrary] clear error', err)
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#0f0f1a] text-slate-200 select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-violet-900/40">
        <span className="text-[11px] font-semibold text-violet-300 tracking-wide uppercase">
          Emotional Library
        </span>
        {chords.length > 0 && (
          <button
            type="button"
            onClick={handleClearAll}
            className="text-[9px] text-slate-500 hover:text-red-400 px-2 py-0.5 rounded border border-slate-700 hover:border-red-800 transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-[10px] text-slate-500 animate-pulse">Loading library…</span>
          </div>
        ) : chords.length === 0 ? (
          <div className="flex items-center justify-center h-full px-4 text-center">
            <span className="text-[10px] text-slate-500 leading-relaxed">
              No chords saved yet. Use Manual mode in the emotion chart to build your library.
            </span>
          </div>
        ) : (
          chords.map(chord => (
            <div
              key={chord.id}
              onClick={() => onApplyChord(chord.emotion, chord.state, chord.trait, chord.intensity)}
              className="group flex items-center gap-2 px-2.5 py-2 rounded bg-slate-900/60 hover:bg-violet-950/50 border border-transparent hover:border-violet-800/50 cursor-pointer transition-all"
            >
              {/* Chord info */}
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold text-slate-100 truncate">{chord.name}</div>
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  <span className="text-[9px] text-red-400">{chord.emotion}</span>
                  <span className="text-[8px] text-slate-600">→</span>
                  <span className="text-[9px] text-amber-400">{chord.state}</span>
                  <span className="text-[8px] text-slate-600">→</span>
                  <span className="text-[9px] text-sky-400">{chord.trait}</span>
                </div>
              </div>

              {/* Intensity */}
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                <span className="text-[9px] text-violet-400 font-mono">
                  {Math.round(chord.intensity * 100)}%
                </span>
                <div className="w-10 h-1 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-violet-500"
                    style={{ width: `${chord.intensity * 100}%` }}
                  />
                </div>
              </div>

              {/* Delete */}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); handleDelete(chord.id) }}
                className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all p-0.5 rounded shrink-0"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer — apply hint */}
      {chords.length > 0 && selectedSegmentIndex !== null && (
        <div className="px-3 py-1.5 border-t border-violet-900/30">
          <span className="text-[9px] text-slate-600">
            Click a chord to apply to segment {selectedSegmentIndex + 1}
          </span>
        </div>
      )}
      {chords.length > 0 && selectedSegmentIndex === null && (
        <div className="px-3 py-1.5 border-t border-violet-900/30">
          <span className="text-[9px] text-slate-600">
            Select a segment first, then click a chord to apply.
          </span>
        </div>
      )}
    </div>
  )
}
