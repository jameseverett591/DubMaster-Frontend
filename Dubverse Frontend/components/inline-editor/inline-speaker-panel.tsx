"use client"

import { useState } from "react"
import { User, Pencil, Check, X } from "lucide-react"
import type { InlineSpeaker } from "./types"

interface InlineSpeakerPanelProps {
  speakers: InlineSpeaker[]
  onUpdateSpeaker: (speakerId: string, updates: Partial<InlineSpeaker>) => void
  segmentCounts: Record<string, number>
}

const GENDER_ICONS: Record<string, string> = {
  male: "♂",
  female: "♀",
  unknown: "?",
}

export function InlineSpeakerPanel({
  speakers,
  onUpdateSpeaker,
  segmentCounts,
}: InlineSpeakerPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")

  const handleStartEdit = (speaker: InlineSpeaker) => {
    setEditingId(speaker.id)
    setEditName(speaker.name)
  }

  const handleSave = (speakerId: string) => {
    if (editName.trim()) {
      onUpdateSpeaker(speakerId, { name: editName.trim() })
    }
    setEditingId(null)
  }

  const handleCancel = () => {
    setEditingId(null)
    setEditName("")
  }

  return (
    <div className="rounded-lg bg-gray-900/60 border border-gray-800 overflow-hidden">
      <div className="px-4 py-3 bg-gray-800 border-b border-gray-700">
        <h3 className="text-sm font-medium text-[#94A3B8] flex items-center gap-2">
          <User size={16} />
          Speakers
        </h3>
      </div>
      <div className="divide-y divide-[#1E293B]">
        {speakers.map((speaker) => (
          <div
            key={speaker.id}
            className="flex items-center gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors"
          >
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: speaker.color }}
            />
            <div className="flex-1 min-w-0">
              {editingId === speaker.id ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 bg-[#0F172A] border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSave(speaker.id)
                      if (e.key === "Escape") handleCancel()
                    }}
                  />
                  <button
                    onClick={() => handleSave(speaker.id)}
                    className="p-1 hover:bg-emerald-600/20 rounded text-emerald-400"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={handleCancel}
                    className="p-1 hover:bg-red-600/20 rounded text-red-400"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-medium">{speaker.name}</span>
                    <span className="text-[#475569] text-xs">{GENDER_ICONS[speaker.gender]}</span>
                    {speaker.age_estimate && (
                      <span className="text-[#64748B] text-xs">~{speaker.age_estimate}y</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleStartEdit(speaker)}
                    className="p-1 opacity-0 group-hover:opacity-100 hover:bg-[#334155] rounded transition-all"
                  >
                    <Pencil size={12} className="text-[#94A3B8]" />
                  </button>
                </div>
              )}
              <div className="mt-1 text-xs text-[#64748B]">
                {segmentCounts[speaker.id] || 0} segments
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
