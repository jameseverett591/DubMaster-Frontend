"use client"

import { Search, Filter, AlertTriangle, CheckCircle2, XCircle, Clock, FileText } from "lucide-react"
import type { InlineSpeaker, SegmentStatus } from "./types"

interface InlineToolbarProps {
  speakers: InlineSpeaker[]
  searchQuery: string
  onSearchChange: (query: string) => void
  filterSpeaker: string | null
  onFilterSpeakerChange: (speakerId: string | null) => void
  filterStatus: "all" | SegmentStatus
  onFilterStatusChange: (status: "all" | SegmentStatus) => void
  showLowConfidence: boolean
  onShowLowConfidenceChange: (show: boolean) => void
  stats: {
    total: number
    edited: number
    approved: number
    pending: number
    rejected: number
    lowConfidence: number
  }
}

export function InlineToolbar({
  speakers,
  searchQuery,
  onSearchChange,
  filterSpeaker,
  onFilterSpeakerChange,
  filterStatus,
  onFilterStatusChange,
  showLowConfidence,
  onShowLowConfidenceChange,
  stats,
}: InlineToolbarProps) {
  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="flex-1 min-w-[200px] relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
          <input
            type="text"
            placeholder="Search segments..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-[#64748B] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Speaker filter */}
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-[#64748B]" />
          <select
            value={filterSpeaker || ""}
            onChange={(e) => onFilterSpeakerChange(e.target.value || null)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Speakers</option>
            {speakers.map((sp) => (
              <option key={sp.id} value={sp.id}>{sp.name}</option>
            ))}
          </select>
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1 border border-gray-700">
          {([
            { key: "all" as const, label: "All", icon: null },
            { key: "pending" as const, label: "Pending", icon: Clock },
            { key: "approved" as const, label: "Approved", icon: CheckCircle2 },
            { key: "rejected" as const, label: "Rejected", icon: XCircle },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => onFilterStatusChange(key)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filterStatus === key
                  ? key === "approved" ? "bg-emerald-500/20 text-emerald-400"
                  : key === "rejected" ? "bg-red-500/20 text-red-400"
                  : key === "pending" ? "bg-amber-500/20 text-amber-400"
                  : "bg-[#334155] text-white"
                  : "text-[#94A3B8] hover:text-white"
              }`}
            >
              {Icon && <Icon size={13} />}
              {label}
            </button>
          ))}
        </div>

        {/* Low confidence toggle */}
        <button
          onClick={() => onShowLowConfidenceChange(!showLowConfidence)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors border ${
            showLowConfidence
              ? "bg-red-500/20 border-red-500/50 text-red-400"
              : "bg-gray-800 border-gray-700 text-[#94A3B8] hover:text-white"
          }`}
        >
          <AlertTriangle size={13} />
          Low Confidence ({stats.lowConfidence})
        </button>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-5 text-xs">
        <div className="flex items-center gap-1.5">
          <FileText size={12} className="text-[#64748B]" />
          <span className="text-[#94A3B8]">Total:</span>
          <span className="font-medium text-white">{stats.total}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          <span className="text-[#94A3B8]">Edited:</span>
          <span className="font-medium text-white">{stats.edited}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="text-[#94A3B8]">Approved:</span>
          <span className="font-medium text-white">{stats.approved}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          <span className="text-[#94A3B8]">Pending:</span>
          <span className="font-medium text-white">{stats.pending}</span>
        </div>
      </div>
    </div>
  )
}
