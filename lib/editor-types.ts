// Editor Types for QC-Driven Dubbing Editor

export type SegmentStatus = 'auto' | 'edited' | 'locked'

export type QCFindingType = 'timing' | 'translation' | 'delivery' | 'sync' | 'pronunciation'

export type QCSeverity = 'error' | 'warning' | 'info'

export interface QCFinding {
  id: string
  segment_index: number
  type: QCFindingType
  severity: QCSeverity
  message: string
  suggestion?: string
  timestamp_start: number
  timestamp_end: number
  details?: Record<string, unknown>
}

export interface Segment {
  id: string
  index: number
  status: SegmentStatus
  start_time: number
  end_time: number
  source_text: string
  target_text: string
  speaker_id: string
  speaker_label?: string
  audio_url?: string
  original_audio_snapshot?: string
  locked_at?: string
  qc_findings: QCFinding[]
}

export interface QCScore {
  overall: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  components: {
    timing: number
    translation: number
    delivery: number
    sync: number
    pronunciation: number
  }
  total_findings: number
  errors: number
  warnings: number
  info: number
}

export interface EditorJob {
  id: string
  title: string
  source_language: string
  target_language: string
  video_url: string
  dubbed_video_url?: string
  video_duration: number
  segments: Segment[]
  qc_score?: QCScore
  created_at: string
  updated_at: string
}

// Speaker colors for visual distinction
export const SPEAKER_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  'speaker-1': { bg: 'bg-blue-500/20', border: 'border-blue-500', text: 'text-blue-400' },
  'speaker-2': { bg: 'bg-purple-500/20', border: 'border-purple-500', text: 'text-purple-400' },
  'speaker-3': { bg: 'bg-emerald-500/20', border: 'border-emerald-500', text: 'text-emerald-400' },
  'speaker-4': { bg: 'bg-amber-500/20', border: 'border-amber-500', text: 'text-amber-400' },
  'speaker-5': { bg: 'bg-rose-500/20', border: 'border-rose-500', text: 'text-rose-400' },
  'speaker-6': { bg: 'bg-cyan-500/20', border: 'border-cyan-500', text: 'text-cyan-400' },
}

export function getSpeakerColor(speakerId: string) {
  const index = parseInt(speakerId.replace(/\D/g, '')) || 1
  const key = `speaker-${((index - 1) % 6) + 1}`
  return SPEAKER_COLORS[key] || SPEAKER_COLORS['speaker-1']
}

// QC severity colors
export const QC_SEVERITY_COLORS: Record<QCSeverity, { bg: string; border: string; text: string; icon: string }> = {
  error: { bg: 'bg-red-500/20', border: 'border-red-500', text: 'text-red-400', icon: 'text-red-500' },
  warning: { bg: 'bg-yellow-500/20', border: 'border-yellow-500', text: 'text-yellow-400', icon: 'text-yellow-500' },
  info: { bg: 'bg-blue-500/20', border: 'border-blue-500', text: 'text-blue-400', icon: 'text-blue-500' },
}

// Status colors
export const STATUS_COLORS: Record<SegmentStatus, { bg: string; border: string }> = {
  auto: { bg: 'bg-slate-700', border: 'border-slate-600' },
  edited: { bg: 'bg-amber-500/20', border: 'border-amber-500' },
  locked: { bg: 'bg-emerald-500/20', border: 'border-emerald-500' },
}

// Helper to format time as MM:SS.ms
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`
}

// Helper to parse time string to seconds
export function parseTime(timeStr: string): number {
  const [minSec, ms] = timeStr.split('.')
  const [mins, secs] = minSec.split(':').map(Number)
  return mins * 60 + secs + (parseInt(ms) || 0) / 10
}
