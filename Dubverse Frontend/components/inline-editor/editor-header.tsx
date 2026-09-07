"use client"

import { CheckCircle2, Save, Download, SkipBack, Play, Pause, SkipForward, Settings } from "lucide-react"

interface EditorHeaderProps {
  projectName: string
  isPlaying: boolean
  onPlayPause: () => void
  onSkipBack: () => void
  onSkipForward: () => void
  onApproveAll: () => void
  onSave?: () => void
  onExport?: () => void
  isSaving?: boolean
}

export function EditorHeader({
  projectName,
  isPlaying,
  onPlayPause,
  onSkipBack,
  onSkipForward,
  onApproveAll,
  onSave,
  onExport,
  isSaving,
}: EditorHeaderProps) {
  return (
    <div className="flex items-center justify-between px-5 py-3 bg-gray-900 border-b border-gray-800 rounded-t-lg">
      {/* Left: project name */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-xs font-bold text-white">
          TC
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white leading-tight">{projectName}</h2>
          <p className="text-[10px] text-[#64748B]">Transcription Editor</p>
        </div>
      </div>

      {/* Center: playback controls */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onSkipBack}
          className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
          title="Previous segment"
        >
          <SkipBack size={18} className="text-[#94A3B8]" />
        </button>
        <button
          type="button"
          onClick={onPlayPause}
          className="p-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 transition-colors"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause size={18} className="text-white" />
          ) : (
            <Play size={18} className="text-white ml-0.5" />
          )}
        </button>
        <button
          type="button"
          onClick={onSkipForward}
          className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
          title="Next segment"
        >
          <SkipForward size={18} className="text-[#94A3B8]" />
        </button>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onApproveAll}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors"
        >
          <CheckCircle2 size={15} />
          Approve All
        </button>
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors disabled:opacity-50"
          >
            <Save size={15} />
            Save
          </button>
        )}
        {onExport && (
          <button
            type="button"
            onClick={onExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors border border-gray-700"
          >
            <Download size={15} />
            Export
          </button>
        )}
        <button
          type="button"
          className="p-2 rounded-lg hover:bg-gray-800 transition-colors"
          title="Settings"
        >
          <Settings size={16} className="text-[#64748B]" />
        </button>
      </div>
    </div>
  )
}
