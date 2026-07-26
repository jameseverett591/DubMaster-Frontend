'use client'

import { useEffect, useCallback, useState, useRef, useMemo, type ReactNode } from 'react'
import {
  Lock,
  Unlock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Trash2,
  Check,
  Clock,
  Volume2,
  VolumeX,
  Play,
  Pause,
  PlayCircle,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
  MessageSquare,
  Waves,
  RefreshCw,
  Grid3X3,
  GripHorizontal,
  X,
  Bell,
  ArrowLeft,
  ArrowDownCircle,
  Share2,
  Download,
  User,
  Upload,
  Plus,
  FileText,
  Settings,
  Square,
  Link2,
  Scissors,
  Gauge,
  Music2,
  Languages,
  Mic2,
  Youtube,
  Twitter,
  Facebook,
  Instagram,
  Save,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import { VoiceLibraryPanel } from '@/components/voice-library-modal'
import { CustomVoicesModal } from '@/components/editor/custom-voices-modal'
import { CharacterProfilePopover } from '@/components/editor/character-profile-popover'
import { useEditorStore, type SidebarTab } from '@/lib/editor-store'
import type { Segment, QCScore, QCFinding, QCFindingType, QCReport, SegmentNuances, NuanceMarker, NuanceMarkerType } from '@/lib/editor-types'
import { DEFAULT_NUANCES, NUANCE_MARKER_META } from '@/lib/editor-types'
import { formatTime, getSpeakerColor } from '@/lib/editor-types'
import { applyQCFix } from '@/lib/qc-fixes'
import { VideoRecorder } from '@/components/video-recorder'
import { QCQualityPanel } from '@/components/editor/qc-quality-panel'
import { SegmentQCPanel } from '@/components/editor/segment-qc-panel'
import { QCTicker } from '@/components/editor/qc-ticker'
import { EmotionLedTrack } from '@/components/editor/emotion-led-track'
import { FloatingEmotionChart } from '@/components/editor/floating-emotion-chart'
import { AdvancedChordBrowser } from '@/components/editor/advanced-chord-browser'
import { CharacterProfilesPanel } from '@/components/editor/character-profiles-panel'
import { AdaptationPanel } from '@/components/editor/adaptation-panel'
import VelmaPanel from '@/components/editor/velma-panel'
import { HeatmapBar } from '@/components/timeline/HeatmapBar'
import { SpeakerVoicePanel } from '@/components/editor/speaker-voice-panel'
import { ExportModal } from '@/components/editor/export-modal'
import { ReviewQueuePanel } from '@/components/editor/review-queue-panel'
import { requestRPTStitch, stitchRPT, invalidateCache, scheduleRPTPlayback, effStart, effEnd } from '@/lib/rpt-engine'
import { LanguageSwitcher } from '@/components/language-switcher'
import { createClient } from '@/lib/supabase/client'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Slider } from '@/components/ui/slider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

// Additional QC tab icons not in main import block
import { LayoutList, AudioLines, Zap, GitBranch, Sliders, MessageCircle, ArrowUp } from 'lucide-react'
import { usePlan } from '@/lib/use-plan'

// QC Tab definitions - main navigation tabs + QC-specific tabs
type QCCategory = 'speech' | 'lip-sync' | 'pipeline' | 'voices' | 'script' | 'timeline-tab' | 'timing' | 'pronunciation' | 'translation' | 'delivery' | 'sync'

const QC_TABS: { id: QCCategory; label: string; icon: React.ComponentType<{ className?: string }>; qcType?: QCFindingType; isQCTab?: boolean }[] = [
  // Main navigation tabs
  { id: 'speech', label: 'Speech', icon: MessageSquare },
  { id: 'lip-sync', label: 'Lip Sync', icon: Waves },
  { id: 'pipeline', label: 'Pipeline', icon: GitBranch },
  { id: 'voices', label: 'Voices', icon: Mic2 },
  { id: 'script', label: 'Script', icon: FileText },
  { id: 'timeline-tab', label: 'Timeline', icon: LayoutList },
  // QC-specific tabs below - clicking highlights issues in timeline
  { id: 'timing', label: 'Timing', icon: Clock, qcType: 'timing', isQCTab: true },
  { id: 'pronunciation', label: 'Pronun.', icon: AudioLines, qcType: 'pronunciation', isQCTab: true },
  { id: 'translation', label: 'Transl.', icon: Languages, qcType: 'translation', isQCTab: true },
  { id: 'delivery', label: 'Delivery', icon: Zap, qcType: 'delivery', isQCTab: true },
  { id: 'sync', label: 'Sync', icon: Music2, qcType: 'sync', isQCTab: true },
]

// Suggestion type - alternative translations
interface Suggestion {
  id: string
  text: string
  confidence: number
  source: 'ai' | 'memory' | 'user'
  emotion?: string
}

function inferEmotion(text: string): string {
  if (text.includes('[Formal]') || text.includes('formal')) return 'Professional'
  if (text.includes('[casual]') || text.includes('casual')) return 'Calm'
  if (text.includes('Alt:')) return 'Neutral'
  if (text.includes('!')) return 'Excited'
  return 'Calm'
}

interface SegmentContextMenuProps {
  index: number
  children: ReactNode
  lockedSegments: Set<number>
  lockedPairs: Set<number>
  stagedEmotions: Record<number, string>
  emotions: string[]
  onSplit: (index: number) => void
  onSplitAtWord: (index: number) => void
  onAddAfter: (index: number) => void
  onMerge: (index: number) => void
  canMergeNext: boolean
  onDelete: (index: number) => void
  onToggleLock: (index: number) => void
  onTogglePair: (index: number) => void
  onRevert: (index: number) => void
  onUndoLastEdit: (index: number) => void
  onCopyText: (index: number) => void
  onPasteText: (index: number) => void
  onClearSegment: (index: number) => void
  onSetEmotion: (index: number, emotion: string) => void
  onClearEmotion: (index: number) => void
  onSelect: (index: number) => void
  onRenameSpeaker: (index: number) => void
  onShowProfile: (index: number, x: number, y: number) => void
  onGroupSelect: () => void
  onClearGroup: () => void
  groupSelectActive: boolean
}

function SegmentContextMenu({
  index,
  children,
  lockedSegments,
  lockedPairs,
  stagedEmotions,
  emotions,
  onSplit,
  onSplitAtWord,
  onAddAfter,
  onMerge,
  canMergeNext,
  onDelete,
  onToggleLock,
  onTogglePair,
  onRevert,
  onUndoLastEdit,
  onCopyText,
  onPasteText,
  onClearSegment,
  onSetEmotion,
  onClearEmotion,
  onSelect,
  onRenameSpeaker,
  onShowProfile,
  onGroupSelect,
  onClearGroup,
  groupSelectActive,
}: SegmentContextMenuProps) {
  const [showEmotions, setShowEmotions] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const confirmClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const coordsRef = useRef({ x: 0, y: 0 })
  return (
    <ContextMenu onOpenChange={(open) => { if (!open) { setShowEmotions(false); setConfirmClear(false); if (confirmClearTimer.current) clearTimeout(confirmClearTimer.current) } }}>
      <ContextMenuTrigger asChild>
        <span
          style={{ display: 'contents' }}
          onClick={() => onSelect(index)}
          onContextMenu={(e) => { coordsRef.current = { x: e.clientX, y: e.clientY } }}
        >
          {children}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent className={cn("bg-neutral-900 border-neutral-700", showEmotions ? "w-72" : "w-52")}>
        <ContextMenuItem onClick={(e) => { e.stopPropagation(); onUndoLastEdit(index) }} className="text-xs gap-2">
          ↶ Undo Last Edit
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={(e) => { e.stopPropagation(); onCopyText(index) }} className="text-xs gap-2">
          📋 Copy Text
        </ContextMenuItem>
        <ContextMenuItem onClick={(e) => { e.stopPropagation(); onPasteText(index) }} className="text-xs gap-2">
          📥 Paste Text
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={(e) => { e.stopPropagation(); onSplit(index) }} className="text-xs gap-2">
          ✂️ Split at Playhead
          <ContextMenuShortcut>C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={(e) => { e.stopPropagation(); onSplitAtWord(index) }} className="text-xs gap-2">
          ✂️ Split at Word…
        </ContextMenuItem>
        <ContextMenuItem onClick={(e) => { e.stopPropagation(); onAddAfter(index) }} className="text-xs gap-2">
          ➕ Add Segment After
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canMergeNext}
          onClick={(e) => { e.stopPropagation(); onMerge(index) }}
          className="text-xs gap-2">
          🔗 Merge with Next
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={(e) => { e.stopPropagation(); onGroupSelect() }} className="text-xs gap-2">
          ⛶ Group Selection
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!groupSelectActive}
          onClick={(e) => { e.stopPropagation(); onClearGroup() }}
          className="text-xs gap-2">
          ✖ Clear Group
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={(e) => { e.stopPropagation(); onDelete(index) }}
          className="text-xs gap-2 text-red-400 focus:text-red-400">
          🗑️ Delete Segment
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={(e) => { e.stopPropagation(); onToggleLock(index) }} className="text-xs gap-2">
          {lockedSegments.has(index) ? '🔓 Unlock' : '🔒 Lock'}
        </ContextMenuItem>
        <ContextMenuItem onClick={(e) => { e.stopPropagation(); onTogglePair(index) }} className="text-xs gap-2">
          {lockedPairs.has(index) ? '🔗 Unpair' : '🔗 Pair with Next'}
          <ContextMenuShortcut>⇧P</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={(e) => { e.stopPropagation(); onRevert(index) }} className="text-xs gap-2">
          ↩️ Revert to Original
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(e) => {
            if (!confirmClear) {
              e.preventDefault()
              setConfirmClear(true)
              if (confirmClearTimer.current) clearTimeout(confirmClearTimer.current)
              confirmClearTimer.current = setTimeout(() => setConfirmClear(false), 2000)
            } else {
              if (confirmClearTimer.current) clearTimeout(confirmClearTimer.current)
              setConfirmClear(false)
              onClearSegment(index)
            }
          }}
          className="text-xs gap-2 text-red-400 focus:text-red-400">
          {confirmClear ? 'Confirm Clear ↩' : '🧹 Clear Segment'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={(e) => { e.stopPropagation(); onRenameSpeaker(index) }} className="text-xs gap-2 text-purple-400 focus:text-purple-400">
          ✏️ Rename Speaker
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={(e) => { e.stopPropagation(); onShowProfile(index, coordsRef.current.x, coordsRef.current.y) }}
          className="text-xs gap-2"
        >
          🎭 Character Profile
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-xs gap-2 text-blue-400 focus:text-blue-400">
          🔤 Spell Check
        </ContextMenuItem>
        <ContextMenuItem className="text-xs gap-2 text-green-400 focus:text-green-400">
          🌐 Translate to English
        </ContextMenuItem>
        <ContextMenuSeparator />
        <div
          onClick={(e) => { e.stopPropagation(); setShowEmotions(!showEmotions) }}
          className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-slate-700 rounded-sm"
        >
          🎭 Set Emotion
          {showEmotions ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
        </div>
        {showEmotions && (
          <>
            <div className="grid grid-cols-2 gap-1 px-1 py-1.5 bg-neutral-800/50 rounded">
              {emotions.map(emotion => (
                <div
                  key={emotion}
                  onClick={(e) => { e.stopPropagation(); onSetEmotion(index, emotion) }}
                  className={cn(
                    "text-left text-xs rounded px-2 py-1.5 cursor-pointer transition-colors select-none",
                    stagedEmotions[index] === emotion
                      ? "bg-amber-500/20 text-amber-400 font-medium"
                      : "text-slate-300 hover:bg-slate-700 hover:text-white"
                  )}>
                  {stagedEmotions[index] === emotion && '✓ '}{emotion}
                </div>
              ))}
            </div>
            <div
              onClick={(e) => { e.stopPropagation(); onClearEmotion(index) }}
              className="text-center text-xs text-slate-400 hover:text-slate-200 py-1.5 mt-1 rounded hover:bg-neutral-800 transition-colors cursor-pointer select-none"
            >
              Clear Emotion
            </div>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface DubVerseEditorProps {
  jobId: string
  title: string
  sourceLanguage: string
  targetLanguage: string
  videoUrl: string
  dubbedVideoUrl: string | null
  videoDuration: number
  segments: Segment[]
  snapshotSegments?: Segment[]
  qcScore?: QCScore | null
  qcFindings?: QCFinding[]
  qcAnalysis?: any
  qcLoading?: boolean
  qcUpdatedAt?: string | null
  canReanalyze?: boolean
  onReanalyze?: () => void
  pointsLeft?: number
  minutesAvailable?: number
  speakerGenders?: Record<string, string>
  voiceMapping?: Record<string, string>
  traitsMapping?: Record<string, string[]>
  onExport?: () => void
  onShare?: () => void
  onGenerateSpeech?: () => void
  onTranslateAndDub?: () => void
}

type AskAiMessage = { role: 'user' | 'assistant'; content: string; displayed?: string }

// Ask DubMaster AI's bot icon — outlined, brand-gradient linework. `id` must be unique per instance (SVG gradient ids can't repeat on a page).
function AskAiBotIcon({ id, size = 20 }: { id: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="50%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect x="5" y="7" width="14" height="11" rx="4" stroke={`url(#${id})`} strokeWidth="1.6" fill="none" />
      <circle cx="9.3" cy="12.2" r="1.5" fill={`url(#${id})`} />
      <circle cx="14.7" cy="12.2" r="1.5" fill={`url(#${id})`} />
      <line x1="12" y1="3.5" x2="12" y2="7" stroke={`url(#${id})`} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="12" cy="3" r="1" fill={`url(#${id})`} />
    </svg>
  )
}

// Lightweight markdown renderer for Ask DubMaster AI replies — headings, bold, lists, rules, paragraphs.
// No react-markdown dependency: the assistant's system prompt only ever produces
// this subset (bold, lists, headers, rules, paragraphs, and GFM pipe tables — the
// last so "show me the emotion chart" renders as an actual on-screen table).
function renderMarkdownLite(text: string): ReactNode[] {
  const renderInline = (line: string, key: number): ReactNode => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g)
    return (
      <span key={key}>
        {parts.map((part, i) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={i}>{part.slice(2, -2)}</strong>
            : part
        )}
      </span>
    )
  }

  const lines = text.split('\n')
  const nodes: ReactNode[] = []
  let listItems: string[] | null = null
  let listOrdered = false

  const flushList = () => {
    if (!listItems) return
    const Tag = listOrdered ? 'ol' : 'ul'
    nodes.push(
      <Tag key={nodes.length} className={cn("pl-5 space-y-1", listOrdered ? "list-decimal" : "list-disc")}>
        {listItems.map((item, i) => <li key={i}>{renderInline(item, i)}</li>)}
      </Tag>
    )
    listItems = null
  }

  // GFM pipe-table helpers
  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
  const isTableSep = (l: string) => /-/.test(l) && /\|/.test(l) && /^[\s|:\-]+$/.test(l)
  const splitCells = (l: string) =>
    l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Table = header row + separator row + zero-or-more body rows
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushList()
      const header = splitCells(line)
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && isTableRow(lines[j])) {
        rows.push(splitCells(lines[j]))
        j++
      }
      nodes.push(
        <div key={nodes.length} className="my-1.5 overflow-x-auto rounded border border-white/10">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-white/5">
                {header.map((h, hi) => (
                  <th key={hi} className="text-left font-semibold px-2 py-1 border-b border-white/15">{renderInline(h, hi)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-white/5 last:border-0">
                  {r.map((c, ci) => (
                    <td key={ci} className="align-top px-2 py-1">{renderInline(c, ci)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      i = j
      continue
    }

    const bullet = line.match(/^[-*]\s+(.*)/)
    const numbered = line.match(/^\d+\.\s+(.*)/)
    if (bullet) {
      if (listItems && listOrdered) flushList()
      listOrdered = false
      listItems = [...(listItems ?? []), bullet[1]]
      i++; continue
    }
    if (numbered) {
      if (listItems && !listOrdered) flushList()
      listOrdered = true
      listItems = [...(listItems ?? []), numbered[1]]
      i++; continue
    }
    flushList()

    if (/^(---|\*\*\*)\s*$/.test(line)) {
      nodes.push(<hr key={nodes.length} className="border-white/10 my-1" />)
    } else if (line.startsWith('### ')) {
      nodes.push(<h4 key={nodes.length} className="font-semibold text-sm mt-1">{renderInline(line.slice(4), i)}</h4>)
    } else if (line.startsWith('## ')) {
      nodes.push(<h3 key={nodes.length} className="font-semibold text-base mt-1">{renderInline(line.slice(3), i)}</h3>)
    } else if (line.startsWith('# ')) {
      nodes.push(<h2 key={nodes.length} className="font-bold text-lg mt-1">{renderInline(line.slice(2), i)}</h2>)
    } else if (line.trim() === '') {
      nodes.push(<div key={nodes.length} className="h-1" />)
    } else {
      nodes.push(<p key={nodes.length}>{renderInline(line, i)}</p>)
    }
    i++
  }
  flushList()
  return nodes
}

function mapAnalysisToQCReport(jobId: string, analysis: any): QCReport {
  const summary = analysis.summary ?? {}
  const compScores = summary.component_scores ?? {}
  const findings: QCFinding[] = []

  const silences = analysis.silences ?? {}
  ;(silences.gaps ?? []).forEach((gap: any, i: number) => {
    findings.push({
      id: `qc-silence-${i}`,
      segment_index: -1,
      type: 'timing',
      severity: (gap.duration ?? 0) > 1.5 ? 'error' : 'warning',
      message: `${((gap.duration ?? 0) as number).toFixed(1)}s silence gap`,
      suggestion: 'Adjust segment timing or add filler audio',
      timestamp_start: gap.start ?? 0,
      timestamp_end: gap.end ?? 0,
    })
  })

  const retrans = analysis.retranscription ?? {}
  ;(retrans.segments ?? []).forEach((seg: any, i: number) => {
    if ((seg.confidence ?? 1) < 0.8) {
      findings.push({
        id: `qc-pronun-${i}`,
        segment_index: i,
        type: 'pronunciation',
        severity: (seg.confidence ?? 1) < 0.6 ? 'error' : 'warning',
        message: `Retranscription confidence ${Math.round((seg.confidence ?? 0) * 100)}%`,
        timestamp_start: seg.start ?? 0,
        timestamp_end: (seg.end ?? (seg.start ?? 0) + 2),
      })
    }
  })

  const speedData = analysis.speed ?? {}
  ;(speedData.anomalies ?? []).forEach((a: any, i: number) => {
    findings.push({
      id: `qc-speed-${i}`,
      segment_index: a.segment_index ?? i,
      type: 'delivery',
      severity: 'warning',
      message: `Speed anomaly: ${(a.speed_ratio ?? 1).toFixed(2)}x`,
      timestamp_start: a.start ?? 0,
      timestamp_end: a.end ?? 0,
    })
  })

  return {
    job_id: jobId,
    generated_at: new Date().toISOString(),
    grade: (summary.grade ?? 'C') as QCReport['grade'],
    overall: summary.score ?? 50,
    components: {
      timing: compScores.timing ?? 75,
      speed: compScores.speed ?? 75,
      loudness: compScores.loudness ?? 80,
      silences: compScores.silences ?? 80,
      emotion_variance: compScores.emotion_variance ?? 50,
      emotion_intensity: compScores.emotion_intensity ?? 50,
      lip_sync: compScores.lip_sync ?? 50,
      emotion_preservation: compScores.emotion_preservation ?? 50,
    },
    timing: { status: (analysis.timing?.status ?? 'ok') as 'ok' | 'warn' | 'fail' },
    speed: {
      status: (speedData.status ?? 'ok') as 'ok' | 'warn' | 'fail',
      mean: speedData.speed_mean ?? 1.0,
      std_dev: speedData.speed_std_dev ?? 0.1,
    },
    silence_gaps: {
      unexpected_count: silences.unexpected_silences ?? 0,
      gaps: (silences.gaps ?? []).map((g: any) => ({
        start: g.start ?? 0,
        end: g.end ?? 0,
        duration: g.duration ?? 0,
      })),
    },
    loudness: {
      within_spec: analysis.loudness?.within_spec ?? true,
      lufs: analysis.loudness?.integrated_lufs ?? -23,
      peak_db: analysis.loudness?.peak_db ?? -1,
      range_lu: analysis.loudness?.range_lu ?? 7,
    },
    emotion: {
      label: analysis.emotion?.label ?? 'Calm',
      variance: analysis.emotion?.variance ?? 50,
      intensity: analysis.emotion?.intensity ?? 50,
      top: analysis.emotion?.top ?? [],
    },
    retranscription: {
      segment_count: (retrans.segments ?? []).length,
      items: (retrans.segments ?? []).map((s: any) => ({
        start: s.start ?? 0,
        text: s.text ?? '',
        confidence: s.confidence ?? 0.5,
      })),
    },
    findings,
  }
}

function computeHeatmap(segment: import('@/lib/editor-types').Segment): number[] {
  const velma = segment.velma_emotion_curve ?? []
  const dub = segment.emotionalCurve?.combined?.map(p => p.y) ?? []

  const length = Math.min(velma.length, dub.length)
  const result: number[] = []

  for (let i = 0; i < length; i++) {
    const emotionMismatch = Math.abs(velma[i] - dub[i])
    const lip = 0
    const accent = segment.voiceAccent !== segment.velma_accent ? 1 : 0
    const deepfake = segment.velma_deepfake_score ?? 0

    const severity =
      emotionMismatch * 0.5 +
      lip * 0.2 +
      accent * 0.2 +
      deepfake * 0.1

    result.push(Math.min(1, severity))
  }

  return result
}

// When a segment is inserted at array position `at` (split right half, Add
// Segment), every per-segment override keyed by index >= `at` must shift up by
// one so it stays attached to the same segment. Merge already reindexes on
// removal; these are the insertion counterparts.
function shiftIndexMapUp<T>(map: Record<number, T>, at: number): Record<number, T> {
  const next: Record<number, T> = {}
  for (const [k, v] of Object.entries(map)) {
    const n = Number(k)
    next[n >= at ? n + 1 : n] = v
  }
  return next
}
function shiftIndexSetUp(set: Set<number>, at: number): Set<number> {
  const next = new Set<number>()
  set.forEach(n => next.add(n >= at ? n + 1 : n))
  return next
}

export function DubVerseEditor({
  jobId,
  title,
  sourceLanguage,
  targetLanguage,
  videoUrl,
  dubbedVideoUrl,
  videoDuration,
  segments: initialSegments,
  snapshotSegments,
  qcScore,
  qcFindings = [],
  qcAnalysis,
  qcLoading = false,
  qcUpdatedAt = null,
  canReanalyze = false,
  onReanalyze,
  pointsLeft = 6.88,
  minutesAvailable = 2.29,
  speakerGenders,
  voiceMapping: initialVoiceMapping,
  traitsMapping: initialTraitsMapping,
  onExport,
  onShare,
  onGenerateSpeech,
  onTranslateAndDub,
}: DubVerseEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const waveformCanvasLRef = useRef<HTMLCanvasElement>(null)
  const waveformCanvasRRef = useRef<HTMLCanvasElement>(null)
  const decodedBufferRef = useRef<AudioBuffer | null>(null)
  const groupMoveStartXRef = useRef(0)
  const groupMoveActiveRef = useRef(false)

  const {
    setJobData,
    segments,
    activeSidebarTab,
    setActiveSidebarTab,
    selectedSegmentIndex,
    selectSegment,
    currentTime,
    setCurrentTime,
    isPlaying,
    setIsPlaying,
    playbackMode,
    setPlaybackMode,
    zoomLevel,
    setZoomLevel,
    updateSegmentText,
    updateSegment,
    updateSegmentSpeaker,
    setPreviewText,
    commitPreview,
    cancelPreview,
    speakerVoiceMap,
    setSpeakerVoiceMap,
    speakerTraitsMap,
    setSpeakerTraitsMap,
    speakerPitchMap,
    speakerPulseId,
    updateCombinedCurve,
    toggleCurveLock,
    sampleEmotionalCurve,
    resetEmotionalCurve,
    revertToOriginal,
    rptStitching,
    rebuildStatus,
    setRebuildStatus,
    clearAllDirty,
    initRPTFromSegments,
    commitSegmentChanges,
    resetEditor,
  } = useEditorStore()

  const importedSegments = useEditorStore((state) => state.importedSegments)
  const importedSegmentsJobId = useEditorStore((state) => state.importedSegmentsJobId)
  const setImportedSegmentsRaw = useEditorStore((state) => state.setImportedSegments)
  const { hasFeature, recordingLimit, isPremium, isProfessional } = usePlan()
  // Wrap the store setter so every write to importedSegments also stamps the
  // owning jobId directly via Zustand's static setState — always available,
  // never undefined, never dependent on a store action that may be missing
  // in a stale HMR session. Rehydration from localStorage does NOT go through
  // this setter, so a persisted (segments, jobId) pair is restored intact.
  const setImportedSegments = useCallback(
    (segments: Segment[] | null | ((prev: Segment[] | null) => Segment[] | null)) => {
      setImportedSegmentsRaw(segments)
      useEditorStore.setState({ importedSegmentsJobId: jobId })
    },
    [setImportedSegmentsRaw, jobId],
  )

  const getTrailingBuffer = (text: string): number => {
    const trimmed = text.trim()
    const wordCount = trimmed.split(/\s+/).length
    if (wordCount <= 3) return 0.4
    if (trimmed.endsWith('?')) return 0.25
    if (trimmed.endsWith('!')) return 0.2
    return 0.3
  }

  const syncSegmentsToBackend = useCallback((segments: Segment[]) => {
    return apiClient.syncSegments(jobId, segments as unknown as Array<Record<string, unknown>>).then(res => {
      setImportedSegments(prev => {
        if (!prev) return prev
        return prev.map(seg => {
          const synced = res.segments.find((s: { id: string }) => s.id === seg.id)
          if (synced) {
            return { ...seg, transcript_index: synced.transcript_index }
          }
          return seg
        })
      })
      return res
    }).catch(err => { console.warn('[SYNC]', err); return null })
  }, [jobId, setImportedSegments])

  const [showExportModal, setShowExportModal] = useState(false)
  const [layoutLocked, setLayoutLocked] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('dubverse.editor.layoutLocked') === 'true'
    }
    return false
  })

  // Right preview panel tab: Result (video) | Quality (QC) | Studio
  const [rightPanelTab, setRightPanelTab] = useState<'result' | 'quality' | 'velma' | 'studio' | 'adaptation' | 'speakers' | 'library' | 'emotions' | 'ei-library' | 'nuances' | 'chord' | 'advanced' | 'characters'>('result')
  const [velmaEnrichLoading, setVelmaEnrichLoading] = useState(false)
  const [velmaEnrichResult, setVelmaEnrichResult] = useState<{ patched: number; total: number } | null>(null)

  // QC report — real data from /api/analysis only. Never falls back to mock
  // data: a fake score dressed up as real (with a genuine-looking grade/letter)
  // was indistinguishable from a true low score. null means "not yet analyzed"
  // — QCQualityPanel/SegmentQCPanel render an honest empty state for that.
  const [qcReport, setQcReport] = useState<QCReport | null>(() =>
    qcAnalysis ? mapAnalysisToQCReport(jobId || 'demo', qcAnalysis) : null
  )

  // Sync real QC analysis data when it arrives from the page-level poller
  useEffect(() => {
    if (qcAnalysis) {
      setQcReport(mapAnalysisToQCReport(jobId || 'demo', qcAnalysis))
    }
  }, [qcAnalysis, jobId])

  // Merge QC findings from report into individual segment objects
  useEffect(() => {
    if (!qcReport?.findings?.length) return
    const findingsBySegment = new Map<number, QCFinding[]>()
    for (const f of qcReport.findings) {
      if (f.segment_index == null) continue
      const arr = findingsBySegment.get(f.segment_index) ?? []
      arr.push(f)
      findingsBySegment.set(f.segment_index, arr)
    }
    findingsBySegment.forEach((findings, segIdx) => {
      const sorted = [...findings].sort((a, b) => {
        const rank: Record<string, number> = { error: 0, warning: 1, info: 2 }
        return (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2)
      })
      const worst = sorted[0]
      const errors = findings.filter(f => f.severity === 'error').length
      const warnings = findings.filter(f => f.severity === 'warning').length
      const score = Math.max(0, 100 - errors * 25 - warnings * 10)
      updateSegment(segIdx, {
        qc_findings: findings,
        qc_score: score,
        qc_problem: worst.message,
        qc_fix: worst.suggestion,
      })
    })
  }, [qcReport, updateSegment])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) apiClient.setToken(session.access_token)
      const user = session?.user
      if (!user) return
      const name = (user.user_metadata?.full_name as string | undefined) || user.email || ''
      const parts = name.trim().split(/\s+/)
      setUserInitials(
        parts.length >= 2
          ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
          : name.slice(0, 2).toUpperCase()
      )
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      apiClient.setToken(session?.access_token ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Selected re-transcription index for highlighting in QC monitor
  const [selectedRetranscriptionIndex, setSelectedRetranscriptionIndex] = useState<number | null>(null)

  // QC monitor panel width — resizable, persisted
  const [qcMonitorWidth, setQcMonitorWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dubverse.editor.qcMonitorWidth')
      return saved ? parseInt(saved, 10) : 320
    }
    return 320
  })
  const [isResizingQcMonitor, setIsResizingQcMonitor] = useState(false)

  // Track label column width — resizable, persisted
  const [trackLabelWidth, setTrackLabelWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dubverse.editor.trackLabelWidth')
      return saved ? parseInt(saved, 10) : 112
    }
    return 112
  })
  const [isResizingTrackLabel, setIsResizingTrackLabel] = useState(false)
  const [emotionSource, setEmotionSource] = useState<'auto' | 'advanced'>('auto')
  const [advancedBrowserSegment, setAdvancedBrowserSegment] = useState<number | null>(null)
  const [floatingEmotionSegment, setFloatingEmotionSegment] = useState<number | null>(null)
  const [videoSubTab, setVideoSubTab] = useState<'chord' | 'advanced' | 'characters' | 'askai' | null>(null)

  const [activeDubbedVideoUrl, setActiveDubbedVideoUrl] = useState(dubbedVideoUrl)
  const [isRebuilding, setIsRebuilding] = useState(false)
  const [rebuildError, setRebuildError] = useState<string | null>(null)
  const [isRetranslating, setIsRetranslating] = useState(false)
  const [rebuildProgress, setRebuildProgress] = useState(0)
  const rebuildIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [draggingSegment, setDraggingSegment] = useState<{
    index: number
    track: 'original' | 'dubbed'
    startX: number
    originalStart: number
    originalEnd: number
    currentDelta: number
  } | null>(null)
  const [lockedPairs, setLockedPairs] = useState<Set<number>>(new Set())
  const [flashingPair, setFlashingPair] = useState<number | null>(null)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [regenError, setRegenError] = useState<string | null>(null)
  const [timingExclusion, setTimingExclusion] = useState<{
    audioDuration: number
    slotDuration: number
    overlap: number
    segmentIndex: number
  } | null>(null)
  const [addSegmentFeedback, setAddSegmentFeedback] = useState<'success' | 'error' | null>(null)
  const [pendingOverwriteIndex, setPendingOverwriteIndex] = useState<number | null>(null)
  const [shareCopied, setShareCopied] = useState<'link' | 'video' | null>(null)
  const [askAiOpen, setAskAiOpen] = useState(false)
  const [askAiModel, setAskAiModel] = useState<'haiku' | 'sonnet' | 'opus'>('sonnet')
  const [characterProfileOpen, setCharacterProfileOpen] = useState<{
    segmentIndex: number; x: number; y: number
  } | null>(null)
  const [askAiPrompt, setAskAiPrompt] = useState('')
  const [askAiLoading, setAskAiLoading] = useState(false)
  const [askAiResult, setAskAiResult] = useState<{ suggestion: string; explanation: string } | null>(null)
  const [askAiPos, setAskAiPos] = useState({ x: 0, y: 0 })
  const [stagedSpeeds, setStagedSpeeds] = useState<Record<number, number>>({})
  const [stagedEmotions, setStagedEmotions] = useState<Record<number, string>>({})
  const [stagedVoices, setStagedVoices] = useState<Record<number, string>>({})
  const [renamingSpeakerId, setRenamingSpeakerId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [stagedPitches, setStagedPitches] = useState<Record<number, number>>({})
  const [stagedNuances, setStagedNuances] = useState<Record<number, Partial<SegmentNuances>>>({})
  const [nuancesAdvanced, setNuancesAdvanced] = useState(false)
  const [savedCurves, setSavedCurves] = useState<Array<{
    id: string; name: string; description?: string; tags?: string[]
    curve: import('@/lib/editor-types').EmotionalCurvePoint[]
    duration: number; core_emotion: string; source_segment_text?: string; created_at: string
  }>>([])
  const [saveCurveOpen, setSaveCurveOpen] = useState(false)
  const [saveCurveName, setSaveCurveName] = useState('')
  const [saveCurveDesc, setSaveCurveDesc] = useState('')
  const [saveCurveTags, setSaveCurveTags] = useState('')
  const [saveCurveSegIdx, setSaveCurveSegIdx] = useState<number | null>(null)
  const [curveSaveStatus, setCurveSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [deleteConfirmCurveId, setDeleteConfirmCurveId] = useState<string | null>(null)
  const [curveSearchQuery, setCurveSearchQuery] = useState('')
  const [draggedVoice, setDraggedVoice] = useState<string | null>(null)
  const [groupSelectedSegments, setGroupSelectedSegments] = useState<Set<number>>(new Set())
  const [groupMoveActive, setGroupMoveActive] = useState(false)
  const [groupMoveOffset, setGroupMoveOffset] = useState({ x: 0, y: 0 })
  // Group-selection mode (right-click → Group Selection): while active the segment
  // cursor changes and Ctrl+clicking a first then last segment selects that whole
  // run to move as one. Cleared via right-click → Clear Group.
  const [groupSelectMode, setGroupSelectMode] = useState(false)
  const [groupAnchor, setGroupAnchor] = useState<number | null>(null)
  const [voicePaletteOpen, setVoicePaletteOpen] = useState(false)
  const [customVoicesOpen, setCustomVoicesOpen] = useState(false)
  // Bumped whenever custom voices change so the Voice Library re-fetches them.
  const [customVoicesVersion, setCustomVoicesVersion] = useState(0)
  const [voiceDragOverIndex, setVoiceDragOverIndex] = useState<number | null>(null)
  const [voiceAppliedFeedback, setVoiceAppliedFeedback] = useState<{ segmentIndex: number; voiceName: string } | null>(null)
  const [askAiConversations, setAskAiConversations] = useState<{ id: string; messages: AskAiMessage[] }[]>([{ id: 'askai-1', messages: [] }])
  const [askAiCurrentIndex, setAskAiCurrentIndex] = useState(0)
  const [askAiConvListOpen, setAskAiConvListOpen] = useState(false)
  const askAiChatMessages = askAiConversations[askAiCurrentIndex]?.messages ?? []
  const setAskAiChatMessages = useCallback((updater: (prev: AskAiMessage[]) => AskAiMessage[]) => {
    setAskAiConversations(prev => prev.map((conv, i) => i === askAiCurrentIndex ? { ...conv, messages: updater(conv.messages) } : conv))
  }, [askAiCurrentIndex])
  const [askAiChatInput, setAskAiChatInput] = useState('')
  const [askAiChatLoading, setAskAiChatLoading] = useState(false)
  const [askAiChatError, setAskAiChatError] = useState<string | null>(null)
  const askAiChatRafRef = useRef<number | null>(null)

  useEffect(() => {
    const lastIdx = askAiChatMessages.length - 1
    if (lastIdx < 0) return
    const last = askAiChatMessages[lastIdx]
    if (last.role !== 'assistant' || last.displayed === last.content) return
    const CHARS_PER_MS = 0.35
    const startTime = performance.now()
    const startLen = last.displayed?.length ?? 0
    const tick = (now: number) => {
      const elapsed = now - startTime
      const targetLen = Math.min(last.content.length, startLen + Math.floor(elapsed * CHARS_PER_MS))
      setAskAiChatMessages(prev => {
        const next = [...prev]
        next[lastIdx] = { ...next[lastIdx], displayed: last.content.slice(0, targetLen) }
        return next
      })
      if (targetLen < last.content.length) {
        askAiChatRafRef.current = requestAnimationFrame(tick)
      }
    }
    askAiChatRafRef.current = requestAnimationFrame(tick)
    return () => { if (askAiChatRafRef.current) cancelAnimationFrame(askAiChatRafRef.current) }
  }, [askAiChatMessages.length, askAiCurrentIndex])
  const [pitchPopupIndex, setPitchPopupIndex] = useState<number | null>(null)
  const [pitchPopupPos, setPitchPopupPos] = useState({ x: 0, y: 0 })
  const [speedPopupIndex, setSpeedPopupIndex] = useState<number | null>(null)
  const [speedPopupPos, setSpeedPopupPos] = useState({ x: 0, y: 0 })
  const [pendingDelete, setPendingDelete] = useState<number | null>(null)
  const [splitWordMode, setSplitWordMode] = useState<number | null>(null)
  const [inlineEmotionPicker, setInlineEmotionPicker] = useState<number | null>(null)
  const [inlineEmotionWriteIn, setInlineEmotionWriteIn] = useState<number | null>(null)
  const [customEmotionDrafts, setCustomEmotionDrafts] = useState<Record<number, string>>({})
  const [userInitials, setUserInitials] = useState("JA")
  const [showRevertAllConfirm, setShowRevertAllConfirm] = useState(false)
  const [showReviewQueue, setShowReviewQueue] = useState(false)
  const [contextSegmentIndex, setContextSegmentIndex] = useState<number | null>(null)
  const [dragSpeedPreview, setDragSpeedPreview] = useState<{ index: number; speed: number } | null>(null)
  const [isSegmentPreviewing, setIsSegmentPreviewing] = useState(false)
  const [waveformReady, setWaveformReady] = useState(false)
  // Briefly surface an "Updated <time>" note under the Re-analyze button after a
  // successful re-analyze, then fade it out.
  const [showReanalyzedNote, setShowReanalyzedNote] = useState(false)
  const [dragReorder, setDragReorder] = useState<{
    fromIndex: number
    toIndex: number | null
    isDragging: boolean
  } | null>(null)
  const segmentAudioRef = useRef<HTMLAudioElement | null>(null)

  // Mirror of the live block-drag state so the mount-once safety net below can
  // read the current delta at interrupt time without re-subscribing on every move.
  const draggingSegmentRef = useRef(draggingSegment)
  draggingSegmentRef.current = draggingSegment
  // Handles to the in-flight block-move document listeners, so the safety net can
  // tear them down if the normal mouseup is missed. Non-null === a block drag is
  // live and its normal onMouseUp has NOT yet run (used to avoid double-commit).
  const dragMoveListenerRef = useRef<((ev: MouseEvent) => void) | null>(null)
  const dragUpListenerRef = useRef<((ev: MouseEvent) => void) | null>(null)

  useEffect(() => {
    if (segmentAudioRef.current) {
      segmentAudioRef.current.pause()
      segmentAudioRef.current = null
    }
    setIsSegmentPreviewing(false)
  }, [selectedSegmentIndex])

  useEffect(() => {
    if (splitWordMode !== null || selectedSegmentIndex !== null) setInlineEmotionPicker(null)
  }, [splitWordMode, selectedSegmentIndex])

  useEffect(() => {
    const clearDragHover = () => setVoiceDragOverIndex(null)
    document.addEventListener('dragend', clearDragHover)
    return () => document.removeEventListener('dragend', clearDragHover)
  }, [])

  // Show the "Updated" confirmation note for a few seconds after each re-analyze,
  // then let it fade. Re-runs whenever a new re-analysis stamps qcUpdatedAt.
  useEffect(() => {
    if (!qcUpdatedAt) return
    setShowReanalyzedNote(true)
    const t = setTimeout(() => setShowReanalyzedNote(false), 4000)
    return () => clearTimeout(t)
  }, [qcUpdatedAt])

  // Global drag safety net — if a block move / reorder / speed drag is interrupted
  // without a normal mouseup (button released off-window, tab hidden, focus lost),
  // commit the block-move position and clear ALL drag state so a block can never
  // stay stuck to the cursor. Mounted once; reads live state via refs.
  useEffect(() => {
    const handleInterrupt = () => {
      const drag = draggingSegmentRef.current
      // No-op on ordinary mouseups when nothing is in flight.
      if (!drag && !dragUpListenerRef.current) return
      // Commit the block-move position — but only if the normal onMouseUp has not
      // already run. It nulls dragUpListenerRef synchronously and fires on the
      // document BEFORE this window-level handler, so this guard prevents a
      // double-commit on a normal release.
      if (drag && dragUpListenerRef.current) {
        const newStart = Math.max(0, drag.originalStart + drag.currentDelta)
        const newEnd = Math.max(0, drag.originalEnd + drag.currentDelta)
        updateSegment(drag.index, { start_time: newStart, end_time: newEnd })
        commitSegmentChanges(drag.index, {
          committed_start_time: newStart,
          committed_end_time: newEnd,
        })
        applyFlagOutcome(drag.index, 'timing')
        apiClient.commitSegmentTiming(jobId, displaySegmentsRef.current[drag.index]?.transcript_index ?? drag.index, {
          committed_start_time: newStart,
          committed_end_time: newEnd,
        }).catch(err => console.warn('[COMMIT-TIMING]', err))
        setImportedSegments(prev => {
          const base = prev ?? displaySegmentsRef.current
          return base.map((seg, i) =>
            i === drag.index ? { ...seg, start_time: newStart, end_time: newEnd, committed_start_time: newStart, committed_end_time: newEnd } : seg
          )
        })
      }
      // Tear down any orphaned block-move document listeners.
      if (dragMoveListenerRef.current) {
        document.removeEventListener('mousemove', dragMoveListenerRef.current)
        dragMoveListenerRef.current = null
      }
      if (dragUpListenerRef.current) {
        document.removeEventListener('mouseup', dragUpListenerRef.current)
        dragUpListenerRef.current = null
      }
      // Clear every drag state so nothing can remain attached to the cursor.
      setDraggingSegment(null)
      setDragReorder(null)
      setDragSpeedPreview(null)
    }
    window.addEventListener('mouseup', handleInterrupt)
    window.addEventListener('blur', handleInterrupt)
    document.addEventListener('visibilitychange', handleInterrupt)
    return () => {
      window.removeEventListener('mouseup', handleInterrupt)
      window.removeEventListener('blur', handleInterrupt)
      document.removeEventListener('visibilitychange', handleInterrupt)
    }
  }, [jobId, updateSegment, commitSegmentChanges, setImportedSegments])

  // Native non-passive drag/drop on the editor container, delegated to
  // [data-segment-row]. Bypasses React's synthetic event system because
  // React 19/Next 16 attaches dragover as a passive listener, which makes
  // preventDefault() a no-op — and without preventDefault the row is not
  // a valid drop target, so onDrop never fires.
  useEffect(() => {
    const container = editorContainerRef.current
    if (!container) return

    const findRow = (target: EventTarget | null): { row: HTMLElement; index: number } | null => {
      let el = target as HTMLElement | null
      while (el && el !== container) {
        if (el.dataset?.segmentRow !== undefined || el.dataset?.segmentDropZone !== undefined) {
          const idx = parseInt(el.dataset.index || '-1', 10)
          if (idx >= 0) return { row: el, index: idx }
        }
        el = el.parentElement
      }
      return null
    }

    const hasVoicePayload = (e: DragEvent): boolean => {
      const types = Array.from(e.dataTransfer?.types || [])
      return types.some(t =>
        t === 'application/x-voice-payload' || t === 'voice_key' || t === 'text/plain'
      )
    }

    const onDragEnter = (e: DragEvent) => {
      if (!hasVoicePayload(e)) return
      const hit = findRow(e.target)
      if (!hit) return
      e.preventDefault()
      setVoiceDragOverIndex(hit.index)
    }

    const onDragOver = (e: DragEvent) => {
      if (!hasVoicePayload(e)) return
      const hit = findRow(e.target)
      if (!hit) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      setVoiceDragOverIndex(hit.index)
    }

    const onDragLeave = (e: DragEvent) => {
      const related = e.relatedTarget as Node | null
      const hit = findRow(e.target)
      if (!hit) return
      if (related && hit.row.contains(related)) return
      setVoiceDragOverIndex(prev => prev === hit.index ? null : prev)
    }

    const onDrop = (e: DragEvent) => {
      const hit = findRow(e.target)
      if (!hit) return
      e.preventDefault()
      setVoiceDragOverIndex(null)
      const payload = e.dataTransfer?.getData('application/x-voice-payload') || ''
      console.log('[VOICE-DROP] onDrop fired (native)', { index: hit.index, payload, types: Array.from(e.dataTransfer?.types || []) })
      if (payload) {
        try {
          const parsed = JSON.parse(payload) as { voice_id: string; name: string }
          console.log('[VOICE-DROP] parsed payload (native)', parsed)
          if (parsed.voice_id) {
            const speakerId = displaySegmentsRef.current[hit.index]?.speaker_id
            setStagedVoices(prev => ({ ...prev, [hit.index]: parsed.voice_id }))
            if (speakerId) {
              setSpeakerVoiceMap(prev => ({ ...prev, [speakerId]: parsed.voice_id }))
              setStagedVoices(prev => {
                const next = { ...prev }
                displaySegmentsRef.current.forEach((seg, i) => {
                  if (seg.speaker_id === speakerId && i !== hit.index) delete next[i]
                })
                return next
              })
            }
            selectSegment(hit.index)
            setCurrentTime(displaySegmentsRef.current[hit.index].start_time)
            console.log('[VOICE-DROP] calling handleGenerateSpeech (native)', { index: hit.index, voice_id: parsed.voice_id })
            handleGenerateSpeechRef.current(hit.index, parsed.voice_id).then(ok => {
              if (ok) {
                console.log('[VOICE-DROP] regen succeeded — showing applied chip (native)', { index: hit.index, voiceName: parsed.name })
                setVoiceAppliedFeedback({ segmentIndex: hit.index, voiceName: parsed.name })
                setTimeout(() => setVoiceAppliedFeedback(null), 2200)
              } else {
                console.warn('[VOICE-DROP] regen failed — no confirmation chip (native)')
              }
            })
          }
        } catch (err) {
          console.error('[VOICE-DROP] payload parse failed (native)', err)
        }
      }
    }

    container.addEventListener('dragenter', onDragEnter, { passive: false })
    container.addEventListener('dragover', onDragOver, { passive: false })
    container.addEventListener('dragleave', onDragLeave, { passive: false })
    container.addEventListener('drop', onDrop, { passive: false })
    return () => {
      container.removeEventListener('dragenter', onDragEnter)
      container.removeEventListener('dragover', onDragOver)
      container.removeEventListener('dragleave', onDragLeave)
      container.removeEventListener('drop', onDrop)
    }
  }, [selectSegment, setCurrentTime])

  // Persist / restore timeline zoom and scroll
  useEffect(() => {
    const savedZoom = localStorage.getItem('dubverse.editor.zoomLevel')
    if (savedZoom) setZoomLevel(parseFloat(savedZoom))
    const savedScroll = localStorage.getItem('dubverse.editor.scrollPosition')
    if (savedScroll) {
      const applyScroll = () => {
        if (timelineRef.current) {
          timelineRef.current.scrollLeft = parseInt(savedScroll, 10)
        } else {
          setTimeout(applyScroll, 100)
        }
      }
      applyScroll()
    }
  }, [setZoomLevel])

  useEffect(() => {
    if (!layoutLocked) {
      localStorage.setItem('dubverse.editor.zoomLevel', zoomLevel.toString())
    }
  }, [zoomLevel, layoutLocked])

  useEffect(() => {
    const el = timelineRef.current
    if (!el) return
    const onScroll = () => {
      if (!layoutLocked) {
        localStorage.setItem('dubverse.editor.scrollPosition', el.scrollLeft.toString())
      }
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [layoutLocked])

  // Fetch and decode separated accompaniment audio for waveform — runs once on mount
  useEffect(() => {
    if (!jobId) return
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    const url = `${apiBase}/api/media/${jobId}/separated/accompaniment`
    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.arrayBuffer()
      })
      .then(arrayBuffer => {
        const audioCtx = new AudioContext()
        return audioCtx.decodeAudioData(arrayBuffer)
      })
      .then(audioBuffer => {
        decodedBufferRef.current = audioBuffer
        setWaveformReady(true)
      })
      .catch(err => {
        console.error('Waveform decode failed:', err)
      })
  }, [jobId])

  // Redraw canvas waveform when buffer is ready or zoom/duration changes
  useEffect(() => {
    if (!waveformReady || !decodedBufferRef.current) return
    const buffer = decodedBufferRef.current
    const canvasWidth = Math.min(Math.floor(videoDuration * 40 * zoomLevel), 16000)
    const canvasHeight = 48 // h-12 = 48px per channel row

    const leftChannel = buffer.getChannelData(0)
    const rightChannel = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : leftChannel
    const samplesPerPixel = Math.max(1, Math.floor(leftChannel.length / canvasWidth))

    const leftPeaks = new Float32Array(canvasWidth)
    const rightPeaks = new Float32Array(canvasWidth)
    for (let i = 0; i < canvasWidth; i++) {
      const start = i * samplesPerPixel
      const end = start + samplesPerPixel
      let lMax = 0
      let rMax = 0
      for (let j = start; j < end && j < leftChannel.length; j++) {
        const lv = Math.abs(leftChannel[j])
        const rv = Math.abs(rightChannel[j])
        if (lv > lMax) lMax = lv
        if (rv > rMax) rMax = rv
      }
      leftPeaks[i] = lMax
      rightPeaks[i] = rMax
    }

    const barW = 2

    const drawChannel = (canvasRef: React.RefObject<HTMLCanvasElement>, peaks: Float32Array) => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = canvasWidth
      canvas.height = canvasHeight
      canvas.style.width = `${canvasWidth}px`
      canvas.style.height = `${canvasHeight}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvasWidth, canvasHeight)
      ctx.fillStyle = '#67c8c8'
      for (let i = 0; i < canvasWidth; i += barW) {
        const h = (peaks[i] ?? 0) * (canvasHeight - 1) * 0.75
        if (h > 0.5) ctx.fillRect(i, canvasHeight - h, barW, h)
      }
    }

    drawChannel(waveformCanvasLRef, leftPeaks)
    drawChannel(waveformCanvasRRef, rightPeaks)
  }, [waveformReady, zoomLevel, videoDuration])
  // Selected finding for the docked QC panel (no floating UI)
  const [selectedQCFinding, setSelectedQCFinding] = useState<QCFinding | null>(null)
  const [editingSegmentIndex, setEditingSegmentIndex] = useState<number | null>(null)
  const [regeneratingSegmentIndex, setRegeneratingSegmentIndex] = useState<number | null>(null)
  const [confirmingSegmentIndex, setConfirmingSegmentIndex] = useState<number | null>(null)
  const [queuedSegmentIndex, setQueuedSegmentIndex] = useState<number | null>(null)
  const [speakerRegenQueue, setSpeakerRegenQueue] = useState<Set<number>>(new Set())
  // Synchronous in-flight guard — avoids the stale-closure race that React state
  // alone can't prevent when draining the queue on the next macrotask.
  const isRegeneratingRef = useRef(false)
  const isPlayingRef = useRef(isPlaying)
  isPlayingRef.current = isPlaying
  // Tracks where playback started so Stop returns to that position (not 0)
  const lastStartPosRef = useRef(0)
  // Pending regen while one is in flight (depth 1, last-write-wins).
  const regenQueueRef = useRef<{ segIdx?: number; voiceOverride?: string; textOverride?: string; ttsTextOverride?: string } | null>(null)
  const autoRegenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingAutoRegenRef = useRef<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const [previewWidth, setPreviewWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dubverse.editor.previewWidth')
      return saved ? parseInt(saved, 10) : 520
    }
    return 520
  })
  const [isResizingPreview, setIsResizingPreview] = useState(false)
  const [timelineHeight, setTimelineHeight] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dubverse.editor.timelineHeight')
      return saved ? parseInt(saved, 10) : 360
    }
    return 360
  })
  const [isResizingTimeline, setIsResizingTimeline] = useState(false)

  // Video import state
  const [importedVideoUrl, setImportedVideoUrl] = useState<string | null>(null)
  const [importedVideoFile, setImportedVideoFile] = useState<File | null>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const transcriptInputRef = useRef<HTMLInputElement>(null)

  // Reference import state (transcribe-only, for emotion analysis / EI Library)
  type RefSegment = { id: string; index: number; start: number; end: number; text: string; speaker_id: string }
  const [referenceSegments, setReferenceSegments] = useState<RefSegment[] | null>(null)
  const [referenceJobId, setReferenceJobId] = useState<string | null>(null)
  const [referenceDetectedLang, setReferenceDetectedLang] = useState<string | null>(null)
  const [selectedReferenceIndex, setSelectedReferenceIndex] = useState<number | null>(null)

  // Active source/target language (user-selectable, initialized from job props)
  const [activeSrcLang, setActiveSrcLang] = useState(sourceLanguage || 'yue')
  const [activeTgtLang, setActiveTgtLang] = useState(targetLanguage || 'en')

  // Transcription state
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null)
  
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null)
  
  // Use imported segments if set (even if empty), otherwise use initial segments.
  // Only trust importedSegments when it belongs to THIS job — a stale persisted
  // array from a previous job (esp. []) must not mask the freshly-fetched prop.
  // Trust importedSegments when it belongs to this job OR is unstamped (null) —
  // "unstamped" means the current session's edits where the jobId stamp never
  // landed (e.g. a missing store action), so a no-op stamp can't silently
  // discard live edits (Original resize handles, drag persistence).
  const displaySegments: Segment[] = ((importedSegmentsJobId === jobId || importedSegmentsJobId === null) && Array.isArray(importedSegments))
    ? importedSegments.filter(Boolean)
    : (Array.isArray(segments) ? segments : []).filter(Boolean)

  // Bounds of the current group selection: the first/last selected segment (only
  // those two get highlighted) and the left/right time span the encasing amber box
  // covers. Null when nothing is grouped.
  const groupBounds = (() => {
    if (groupSelectedSegments.size === 0) return null
    let firstIdx = Infinity, lastIdx = -Infinity, leftT = Infinity, rightT = -Infinity
    groupSelectedSegments.forEach(i => {
      const seg = displaySegments[i]
      if (!seg) return
      if (i < firstIdx) firstIdx = i
      if (i > lastIdx) lastIdx = i
      leftT = Math.min(leftT, effStart(seg))
      rightT = Math.max(rightT, effEnd(seg))
    })
    if (!isFinite(leftT)) return null
    return { firstIdx, lastIdx, leftT, rightT }
  })()

  // Whether a segment should move with the current single-segment drag: it's the
  // one being dragged, or it's paired with it (adjacent, and the left of the two
  // is in lockedPairs). Used so a paired neighbor tracks live on every track.
  const draggedIdx = draggingSegment?.index ?? null
  const movesWithDrag = (index: number) => {
    if (draggedIdx === null) return false
    if (draggedIdx === index) return true
    return Math.abs(draggedIdx - index) === 1 && lockedPairs.has(Math.min(draggedIdx, index))
  }

  // Keep the store's segments array in sync with importedSegments after
  // structural edits (split, add, delete) so that commitPreview /
  // commitSegmentChanges write to the correct segment at the correct index.
  const prevSegCountRef = useRef(displaySegments.length)
  useEffect(() => {
    if (displaySegments.length !== prevSegCountRef.current && displaySegments.length > 0) {
      useEditorStore.setState({ segments: displaySegments })
    }
    prevSegCountRef.current = displaySegments.length
  }, [displaySegments])

  // Unique speakers across all segments — used for reassignment dropdown
  const uniqueSpeakers = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; gender: 'male' | 'female' | 'child' }>()
    displaySegments.forEach(seg => {
      if (seg.speaker_id && !seen.has(seg.speaker_id)) {
        seen.set(seg.speaker_id, {
          id: seg.speaker_id,
          label: seg.speaker_label && !/^\d+$/.test(seg.speaker_label) ? seg.speaker_label : `Speaker ${seen.size + 1}`,
          gender: seg.speaker_gender || 'male',
        })
      }
    })
    return [...seen.values()]
  }, [displaySegments])

  // speaker_id → 1-based number by first appearance (diarization order)
  const speakerNumberMap = useMemo(() => {
    const map: Record<string, number> = {}
    uniqueSpeakers.forEach((spk, i) => { map[spk.id] = i + 1 })
    return map
  }, [uniqueSpeakers])

  const handleSplitAtPlayhead = useCallback((index: number) => {
    const segment = displaySegments[index]
    if (!segment || currentTime <= segment.start_time || currentTime >= segment.end_time) return
    // Both halves own a shorter span than the parent clip — the inherited audio
    // no longer matches either one, so clear it and mark dirty. committed_adapted_text
    // is cleared too so a later Generate Speech regenerates from each half's own
    // text, not the original full text. Same "requires a fresh Generate Speech"
    // contract as Add Segment / Merge.
    const audioCleared = {
      audio_url: undefined,
      committed_audio_url: undefined,
      original_audio_snapshot: undefined,
      committed_adapted_text: undefined,
      status: 'edited' as const,
      rpt_dirty: true,
    }
    const leftText = segment.target_text
    const leftSegment = { ...segment, end_time: currentTime, ...audioCleared }
    const rightSegment = { ...segment, id: `split-${Date.now()}`, transcript_index: undefined, start_time: currentTime, target_text: '', source_text: '', active_text: '', preview_text: null, ...audioCleared }
    setImportedSegments(prev => {
      const base = prev ?? displaySegments
      const result = [...base]
      result.splice(index, 1, leftSegment, rightSegment)
      return result
    })
    // Inserting the right half at index+1 shifts everything after it up by one —
    // reindex per-segment overrides (incl. locks) so they stay on the right segment.
    setStagedVoices(m => shiftIndexMapUp(m, index + 1))
    setStagedEmotions(m => shiftIndexMapUp(m, index + 1))
    setStagedSpeeds(m => shiftIndexMapUp(m, index + 1))
    setStagedNuances(m => shiftIndexMapUp(m, index + 1))
    setStagedPitches(m => shiftIndexMapUp(m, index + 1))
    setLockedSegments(s => shiftIndexSetUp(s, index + 1))
    setLockedPairs(s => shiftIndexSetUp(s, index + 1))
    // Persist the layout, then auto-generate each half that has text (playhead split
    // leaves the right half empty — skip it). Generation must wait for the sync: the
    // right half's real transcript_index comes back in the response, and the extra
    // macrotask yield lets that commit before handleGenerateSpeech reads it — without
    // it, regenerate would target whatever segment currently holds index+1.
    setTimeout(async () => {
      await syncSegmentsToBackend(displaySegmentsRef.current)
      await new Promise(res => setTimeout(res, 0))
      const gen = handleGenerateSpeechRef.current
      if (leftText.trim()) await gen(index, undefined, leftText.trim())
    }, 0)
  }, [displaySegments, currentTime, syncSegmentsToBackend])

  const handleSplitAtWord = useCallback((index: number, wordIndex: number) => {
    const segment = displaySegments[index]
    if (!segment || wordIndex <= 0) return
    const words = segment.target_text.split(' ')
    if (wordIndex >= words.length) return
    const leftText = words.slice(0, wordIndex).join(' ')
    const rightText = words.slice(wordIndex).join(' ')
    const splitRatio = wordIndex / words.length
    const splitTime = segment.start_time + splitRatio * (segment.end_time - segment.start_time)
    // See handleSplitAtPlayhead: each half gets different text, so the inherited
    // audio is stale — clear it (incl. committed_adapted_text) and mark dirty so a
    // fresh Generate Speech regenerates each half from its own text.
    const audioCleared = {
      audio_url: undefined,
      committed_audio_url: undefined,
      original_audio_snapshot: undefined,
      committed_adapted_text: undefined,
      status: 'edited' as const,
      rpt_dirty: true,
    }
    const leftSegment = { ...segment, end_time: splitTime, target_text: leftText, active_text: leftText, preview_text: null, ...audioCleared }
    const rightSegment = { ...segment, id: `split-${Date.now()}`, transcript_index: undefined, start_time: splitTime, end_time: segment.end_time, target_text: rightText, active_text: rightText, preview_text: null, ...audioCleared }
    setImportedSegments(prev => {
      const base = prev ?? displaySegments
      const result = [...base]
      result.splice(index, 1, leftSegment, rightSegment)
      return result
    })
    // Inserting the right half at index+1 shifts everything after it up by one —
    // reindex per-segment overrides (incl. locks) so they stay on the right segment.
    setStagedVoices(m => shiftIndexMapUp(m, index + 1))
    setStagedEmotions(m => shiftIndexMapUp(m, index + 1))
    setStagedSpeeds(m => shiftIndexMapUp(m, index + 1))
    setStagedNuances(m => shiftIndexMapUp(m, index + 1))
    setStagedPitches(m => shiftIndexMapUp(m, index + 1))
    setLockedSegments(s => shiftIndexSetUp(s, index + 1))
    setLockedPairs(s => shiftIndexSetUp(s, index + 1))
    setSplitWordMode(null)
    // Persist the layout, then auto-generate both halves (both carry text on a word
    // split). Wait for the sync + a macrotask so the right half's synced
    // transcript_index is committed before handleGenerateSpeech reads it.
    setTimeout(async () => {
      await syncSegmentsToBackend(displaySegmentsRef.current)
      await new Promise(res => setTimeout(res, 0))
      const gen = handleGenerateSpeechRef.current
      if (leftText.trim()) await gen(index, undefined, leftText.trim())
      if (rightText.trim()) await gen(index + 1, undefined, rightText.trim())
    }, 0)
  }, [displaySegments, syncSegmentsToBackend])

  const handleAddSegmentAfter = useCallback((index: number) => {
    setImportedSegments(prev => {
      const base = prev ?? displaySegments
      const segment = base[index]
      if (!segment) return base
      const nextSeg = base[index + 1]
      const gapStart = segment.end_time
      const gapEnd = nextSeg ? nextSeg.start_time : gapStart + 2
      const availableGap = gapEnd - gapStart
      // If no real gap exists, split the parent segment's duration in half
      // so the new segment gets a fair share of the timeline space.
      let actualStart = gapStart
      let actualDuration: number
      const result = [...base]
      if (availableGap < 0.5) {
        const segDuration = segment.end_time - segment.start_time
        const halfDuration = segDuration / 2
        actualStart = segment.start_time + halfDuration
        actualDuration = halfDuration
        result[index] = { ...segment, end_time: actualStart }
      } else {
        actualDuration = Math.min(2, availableGap)
      }
      const duration = actualDuration
      const newSegment = {
        id: `new-${Date.now()}`,
        index: index + 1,
        transcript_index: undefined,
        status: 'auto' as const,
        start_time: actualStart,
        end_time: actualStart + duration,
        target_text: segment.target_text,
        active_text: segment.active_text,
        preview_text: null,
        source_text: segment.source_text,
        isPreviewing: false,
        isUserEdited: false,
        speaker_id: segment.speaker_id,
        speaker_label: segment.speaker_label,
        speaker_gender: segment.speaker_gender,
        audio_url: undefined,
        committed_audio_url: undefined,
        committed_start_time: undefined,
        committed_end_time: undefined,
        committed_adapted_text: undefined,
        committed_emotion: null,
        committed_voice_id: null,
        committed_speed: null,
        velma_emotion: undefined,
        velma_emotion_curve: undefined,
        velma_progression: undefined,
        qc_findings: [],
        emotionalCurve: segment.emotionalCurve,
      } as typeof segment
      result.splice(index + 1, 0, newSegment)
      return result
    })
    // New segment inserted at index+1 — shift per-segment overrides up so they
    // stay attached to the correct segment.
    setStagedVoices(m => shiftIndexMapUp(m, index + 1))
    setStagedEmotions(m => shiftIndexMapUp(m, index + 1))
    setStagedSpeeds(m => shiftIndexMapUp(m, index + 1))
    setStagedNuances(m => shiftIndexMapUp(m, index + 1))
    setStagedPitches(m => shiftIndexMapUp(m, index + 1))
    setLockedSegments(s => shiftIndexSetUp(s, index + 1))
    setLockedPairs(s => shiftIndexSetUp(s, index + 1))
    setTimeout(() => syncSegmentsToBackend(displaySegmentsRef.current), 0)
    selectSegment(index + 1)
    const expectedLen = displaySegments.length + 1
    setTimeout(() => {
      const grew = displaySegmentsRef.current.length === expectedLen
      setAddSegmentFeedback(grew ? 'success' : 'error')
      setTimeout(() => setAddSegmentFeedback(null), grew ? 2000 : 4000)
    }, 50)
  }, [displaySegments, selectSegment, syncSegmentsToBackend])

  const commitSpeakerRename = useCallback((speakerId: string, newLabel: string) => {
    if (!newLabel.trim()) return
    setImportedSegments(prev => {
      const base = prev ?? displaySegments
      return base.map(seg =>
        seg.speaker_id === speakerId ? { ...seg, speaker_label: newLabel.trim() } : seg
      )
    })
    setRenamingSpeakerId(null)
    setRenameValue('')
  }, [displaySegments])

  // Pair a segment with the one immediately to its right so they move together on
  // the timeline. lockedPairs stores the LEFT index of each pair. Toggles off if
  // already paired; no-op if there is no right neighbor. (Shift+P / context menu.)
  const togglePairWithNext = useCallback((index: number) => {
    if (index + 1 >= displaySegmentsRef.current.length) return
    const nowPaired = !lockedPairs.has(index)
    setLockedPairs(prev => {
      const next = new Set(prev)
      nowPaired ? next.add(index) : next.delete(index)
      return next
    })
    setFlashingPair(index)
    setTimeout(() => setFlashingPair(null), 300)
    // Persist so pairs survive refresh / crash — stored on the LEFT segment.
    const ti = displaySegmentsRef.current[index]?.transcript_index ?? index
    apiClient.commitSegmentTiming(jobId, ti, { paired_with_next: nowPaired })
      .catch(err => console.warn('[PAIR] persist failed:', err))
  }, [lockedPairs, jobId])

  // Keyboard shortcuts — Shift+P: pair with next, C: split
  // Placed after displaySegments and qcBoxPosition so dep array has no TDZ
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape — clear group selection/move state and release all pairs (unpair).
      if (e.key === 'Escape') {
        setGroupSelectedSegments(new Set())
        setGroupMoveActive(false)
        groupMoveActiveRef.current = false
        setGroupMoveOffset({ x: 0, y: 0 })
        setGroupSelectMode(false)
        setGroupAnchor(null)
        // Persist the unpair so refreshing doesn't bring the pairs back.
        lockedPairs.forEach(i => {
          const ti = displaySegmentsRef.current[i]?.transcript_index ?? i
          apiClient.commitSegmentTiming(jobId, ti, { paired_with_next: false })
            .catch(err => console.warn('[PAIR] unpair persist failed:', err))
        })
        setLockedPairs(new Set())
        return
      }

      // Shift+L / Shift+U — lock / unlock the selected segment. A locked segment
      // can't be dragged or resized, and its voice/emotion/speed are frozen (the
      // regenerate guard in handleGenerateSpeech refuses locked segments, and those
      // attachments only take effect on regenerate). Stays until Shift+U.
      if (e.shiftKey && (e.code === 'KeyL' || e.code === 'KeyU')) {
        const target = e.target as HTMLElement
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.contentEditable === 'true'
        ) return
        if (selectedSegmentIndex === null) return
        setSegmentLocked(selectedSegmentIndex, e.code === 'KeyL')
        e.preventDefault()
        return
      }

      // Shift+P — pair the selected segment with the one immediately to its right
      // (they then move together). Press again to unpair.
      if (e.shiftKey && e.code === 'KeyP') {
        const target = e.target as HTMLElement
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.contentEditable === 'true'
        ) return
        if (selectedSegmentIndex === null) return
        togglePairWithNext(selectedSegmentIndex)
        e.preventDefault()
        return
      }

      if (e.key === 'c' || e.key === 'C') {
        if (selectedSegmentIndex === null) return
        const target = e.target as HTMLElement
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.contentEditable === 'true'
        ) return
        handleSplitAtPlayhead(selectedSegmentIndex)
      }

    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedSegmentIndex, lockedPairs, displaySegments, handleSplitAtPlayhead, jobId])

  // Video thumbnails for timeline
  const [videoThumbnails, setVideoThumbnails] = useState<string[]>([])
  const [isExtractingThumbnails, setIsExtractingThumbnails] = useState(false)
  
  // Zoom controls
  const maxZoom = 20
  const minZoom = 0.05
  const [masterVolume, setMasterVolume] = useState(100)
  const [audioVolume, setAudioVolume] = useState(50)
  const [originalTextVolume, setOriginalTextVolume] = useState(100)
  const [dubbedTextVolume, setDubbedTextVolume] = useState(50)
  const [backgroundVolume, setBackgroundVolume] = useState(50)
  const audioContextRef = useRef<AudioContext | null>(null)
  const rptBufferRef = useRef<AudioBuffer | null>(null)
  const rptSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const rptGainRef = useRef<GainNode | null>(null)
  const rptCancelRef = useRef<boolean>(false)
  const [isMutedRPT, setIsMutedRPT] = useState(false)
  const [rptVolume, setRptVolume] = useState(80)
  const [rptPlaybackRate, setRptPlaybackRate] = useState(1.0)
  const [isMuted, setIsMuted] = useState(false)
  const [isMutedOriginal, setIsMutedOriginal] = useState(false)
  const [isMutedDubbed, setIsMutedDubbed] = useState(false)
  
  // Audio waveform data - initialize with sample data so it always renders
  const [waveformData, setWaveformData] = useState<number[]>(() => {
    const samples = 500
    const waveform: number[] = []
    for (let i = 0; i < samples; i++) {
      const t = i / samples
      const base = 0.3 + Math.sin(t * Math.PI * 8) * 0.15 + Math.sin(t * Math.PI * 23) * 0.1
      const noise = (Math.random() - 0.5) * 0.3
      const burst = Math.sin(t * Math.PI * 3) > 0.2 ? 0.15 : 0
      waveform.push(Math.max(0.05, Math.min(1, base + noise + burst)))
    }
    return waveform
  })
  const [isExtractingWaveform, setIsExtractingWaveform] = useState(false)

  // Dragged translation state for timeline
  const [draggedTranslation, setDraggedTranslation] = useState<{ segmentIndex: number; text: string } | null>(null)
  const [droppedTranslations, setDroppedTranslations] = useState<{ segmentIndex: number; text: string; startTime: number; endTime: number }[]>([])
  
  // Locked segments (after Generate Speech)
  const [lockedSegments, setLockedSegments] = useState<Set<number>>(new Set())
  // Segments showing the transient "just locked" green glow. Added on Shift+L,
  // removed after 7s — the lock itself persists, only the glow is temporary.
  const [lockGlowIndices, setLockGlowIndices] = useState<Set<number>>(new Set())
  // Restore persisted locks AND pairs once per job load, from the backend `locked`
  // and `paired_with_next` flags (the page loader carries both onto the segment).
  const locksInitRef = useRef<string | null>(null)
  useEffect(() => {
    if (locksInitRef.current === jobId) return
    if (!displaySegments.length) return
    const restoredLocks = new Set<number>()
    const restoredPairs = new Set<number>()
    displaySegments.forEach((s, i) => {
      if (s.status === 'locked' || (s as unknown as { locked?: boolean }).locked) restoredLocks.add(i)
      if ((s as unknown as { paired_with_next?: boolean }).paired_with_next) restoredPairs.add(i)
    })
    if (restoredLocks.size) setLockedSegments(restoredLocks)
    if (restoredPairs.size) setLockedPairs(restoredPairs)
    locksInitRef.current = jobId
  }, [displaySegments, jobId])

  // Lock / unlock a segment: update local state, flash the 7s glow (lock only),
  // and persist the flag so it survives a hard refresh.
  const setSegmentLocked = useCallback((index: number, lock: boolean) => {
    setLockedSegments(prev => {
      const next = new Set(prev)
      if (lock) next.add(index)
      else next.delete(index)
      return next
    })
    if (lock) {
      setLockGlowIndices(prev => new Set(prev).add(index))
      setTimeout(() => setLockGlowIndices(prev => {
        const next = new Set(prev)
        next.delete(index)
        return next
      }), 7000)
    } else {
      setLockGlowIndices(prev => {
        const next = new Set(prev)
        next.delete(index)
        return next
      })
    }
    const ti = displaySegmentsRef.current[index]?.transcript_index ?? index
    apiClient.commitSegmentTiming(jobId, ti, { locked: lock })
      .catch(err => console.warn('[LOCK] persist failed:', err))
  }, [jobId])

  const canMergeWithNext = useCallback((index: number): boolean => {
    const first = displaySegments[index]
    const second = displaySegments[index + 1]
    if (!first || !second) return false
    if (first.speaker_id !== second.speaker_id) return false
    if (lockedSegments.has(index) || lockedSegments.has(index + 1)) return false
    if (lockedPairs.has(index) || lockedPairs.has(index + 1)) return false
    return true
  }, [displaySegments, lockedSegments, lockedPairs])

  const handleMergeWithNext = useCallback((index: number) => {
    const first = displaySegments[index]
    const second = displaySegments[index + 1]
    if (!first || !second) return
    if (first.speaker_id !== second.speaker_id) return
    if (lockedSegments.has(index) || lockedSegments.has(index + 1)) return
    if (lockedPairs.has(index) || lockedPairs.has(index + 1)) return

    const joinText = (a: string | null | undefined, b: string | null | undefined) => {
      const at = (a ?? '').trim()
      const bt = (b ?? '').trim()
      if (!at) return bt
      if (!bt) return at
      return `${at} ${bt}`
    }
    const mergedSourceText = joinText(first.source_text, second.source_text)
    const mergedTargetText = joinText(
      first.preview_text ?? first.active_text ?? first.target_text,
      second.preview_text ?? second.active_text ?? second.target_text,
    )

    // Merged span reads through committed_start_time/committed_end_time
    // precedence (effStart/effEnd), matching the same read-precedence the
    // Original/Dubbed tracks and Preview Audio already use — reading raw
    // start_time/end_time here would silently reintroduce the drift that
    // precedence fix closed.
    const mergedStart = effStart(first)
    const mergedEnd = effEnd(second)
    const hadCommittedTiming = first.committed_start_time !== undefined || second.committed_end_time !== undefined

    const mergedSegment: typeof first = {
      ...first,
      id: `merge-${Date.now()}`,
      // transcript_index kept from `first` via the spread above. `second`'s
      // transcript_index is retired simply by omitting it from the array —
      // sync_segments matches/updates by transcript_index and only acts on
      // what's actually sent, so no backend-side removal call is needed.
      start_time: mergedStart,
      end_time: mergedEnd,
      ...(hadCommittedTiming ? {
        committed_start_time: mergedStart,
        committed_end_time: mergedEnd,
      } : {}),
      source_text: mergedSourceText,
      target_text: mergedTargetText,
      active_text: mergedTargetText,
      variant_text: mergedTargetText,
      preview_text: null,
      isUserEdited: true,
      isPreviewing: false,
      // Both halves' audio is stale for the new combined span — clear rather
      // than keep either one, so nothing plays silently-wrong content. Same
      // "requires an explicit fresh Generate Speech" contract as Add Segment.
      audio_url: undefined,
      committed_audio_url: undefined,
      original_audio_snapshot: undefined,
      committed_adapted_text: undefined,
      committed_at: undefined,
      status: 'edited' as const,
      rpt_dirty: true,
      was_truncated: false,
      locked_at: undefined,
      qc_findings: [],
      qc_score: undefined,
      qc_problem: undefined,
      qc_fix: undefined,
      flags: [],
      flag_status: 'unreviewed' as const,
      correction_type: null,
      emotionalCurve: undefined,
      velma_emotion: undefined,
      velma_accent: undefined,
      velma_deepfake_score: undefined,
      velma_emotion_curve: undefined,
      velma_progression: undefined,
      dubEmotion: undefined,
      voiceAccent: undefined,
      nuances: undefined,
      nuance_markers: undefined,
      // committed_voice_id / committed_pitch / committed_emotion / committed_speed
      // / attached_traits kept from `first` via the top-level spread — the
      // surviving segment's casting/delivery choices carry over; the
      // same-speaker guard above makes this a safe default.
    }

    const removedIndex = index + 1
    const reindex = <T,>(map: Record<number, T>): Record<number, T> => {
      const next: Record<number, T> = {}
      for (const [kStr, v] of Object.entries(map)) {
        const k = Number(kStr)
        if (k === removedIndex) continue
        next[k > removedIndex ? k - 1 : k] = v
      }
      return next
    }
    const reindexSet = (set: Set<number>): Set<number> => {
      const next = new Set<number>()
      set.forEach(k => {
        if (k === removedIndex) return
        next.add(k > removedIndex ? k - 1 : k)
      })
      return next
    }

    setImportedSegments(prev => {
      const base = prev ?? displaySegments
      const result = [...base]
      result.splice(index, 2, mergedSegment)
      return result
    })
    setStagedVoices(reindex)
    setStagedEmotions(reindex)
    setStagedSpeeds(reindex)
    setStagedNuances(reindex)
    setStagedPitches(reindex)
    setLockedSegments(reindexSet)
    setLockedPairs(reindexSet)
    selectSegment(index)
    setTimeout(() => syncSegmentsToBackend(displaySegmentsRef.current), 0)
  }, [displaySegments, lockedSegments, lockedPairs, selectSegment, syncSegmentsToBackend])

  const [groupedSegments, setGroupedSegments] = useState<Set<number>>(new Set())
  
  // Add segment modal state
  const [showAddSegment, setShowAddSegment] = useState(false)
  const [newSegmentStart, setNewSegmentStart] = useState('')
  const [newSegmentEnd, setNewSegmentEnd] = useState('')
  const [newSegmentOriginal, setNewSegmentOriginal] = useState('')
  const [newSegmentTranslation, setNewSegmentTranslation] = useState('')
  
  // Generate suggestions for a segment
  const [suggestions, setSuggestions] = useState<Record<number, Suggestion[]>>({})
  
  // Initialize store
  const prevJobIdRef = useRef<string | null>(null)
  useEffect(() => {
    // Capture the previous jobId before mutating the ref so we can detect
    // a real job change (mount or switch) vs. a spurious re-run from an
    // unrelated prop reference change (e.g. QC poll on the parent page).
    const prevId = prevJobIdRef.current
    const isNewJob = prevId !== jobId

    // Clear persisted importedSegments when a new job is loaded so stale
    // edits from a previous job don't bleed into this one.
    if (prevId !== null && prevId !== jobId) {
      setImportedSegments(null)
    }
    prevJobIdRef.current = jobId

    const segmentsWithFindings = initialSegments.map((seg, idx) => {
      return {
        ...seg,
        id: seg.id || `segment-${idx}`,
        index: idx,
        status: seg.status || 'auto',
        qc_findings: qcFindings.filter(f => f.segment_index === idx),
        emotionalCurve: seg.emotionalCurve || {
          combined: [
            { x: 0, y: 0.5 },
            { x: 1, y: 0.5 }
          ],
          locked: false,
          analysis: {
            facial: [],
            vocal: [],
            scene: []
          }
        },
      }
    })
    
// Generate 5 mock suggestions for each segment
  const mockSuggestions: Record<number, Suggestion[]> = {}
  segmentsWithFindings.forEach((seg, idx) => {
  mockSuggestions[idx] = [
  { id: `sug-${idx}-1`, text: seg.preview_text ?? seg.active_text ?? seg.target_text, confidence: 0.95, source: 'ai' },
  { id: `sug-${idx}-2`, text: `${seg.preview_text ?? seg.active_text ?? seg.target_text} [casual]`, confidence: 0.88, source: 'ai' },
  { id: `sug-${idx}-3`, text: `[Formal] ${seg.preview_text ?? seg.active_text ?? seg.target_text}`, confidence: 0.82, source: 'ai' },
  { id: `sug-${idx}-4`, text: (seg.preview_text ?? seg.active_text ?? seg.target_text).split(' ').slice(0, 3).join(' ') + '...', confidence: 0.72, source: 'memory' },
  { id: `sug-${idx}-5`, text: `Alt: ${(seg.preview_text ?? seg.active_text ?? seg.target_text).split(' ').reverse().join(' ')}`, confidence: 0.58, source: 'memory' },
  ]
  })
  setSuggestions(mockSuggestions)
    
    setJobData({
      jobId,
      title,
      sourceLanguage,
      targetLanguage,
      videoUrl,
      dubbedVideoUrl,
      videoDuration,
      segments: segmentsWithFindings,
      qcScore,
      qcFindings,
    })

    // Restore staged emotions from committed_emotion saved in segments.json
    const restoredEmotions: Record<number, string> = {}
    segmentsWithFindings.forEach((seg, i) => {
      if (seg.committed_emotion) restoredEmotions[i] = seg.committed_emotion
    })
    if (Object.keys(restoredEmotions).length > 0) {
      setStagedEmotions(prev => ({ ...restoredEmotions, ...prev }))
    }

    // Speaker voice/traits maps: only initialize on initial mount or job switch.
    // Without this gate, any unrelated prop reference change (e.g. a QC poll
    // re-render passing a fresh [] for qcFindings) would re-run this effect and
    // setSpeakerVoiceMap(initialVoiceMapping) would clobber the user's
    // just-assigned voices from the Library panel.
    if (isNewJob) {
      // Initialise speaker voice map from persisted mapping or compute gender defaults
      if (initialVoiceMapping && Object.keys(initialVoiceMapping).length > 0) {
        setSpeakerVoiceMap(initialVoiceMapping)
      } else {
        const genders = speakerGenders ?? {}
        const voicesByGender: Record<string, string[]> = {
          male:   ['male-1',   'male-2',   'male-3',   'male-4'],
          female: ['female-1', 'female-2', 'female-3', 'female-4'],
          child:  ['child-1',  'child-2',  'child-3'],
        }
        const seen = new Set<string>()
        const usage: Record<string, number> = {}
        const defaultMap: Record<string, string> = {}
        for (const seg of segmentsWithFindings) {
          if (seen.has(seg.speaker_id)) continue
          seen.add(seg.speaker_id)
          const gender = (genders[seg.speaker_id] ?? seg.speaker_gender ?? 'male') as string
          const pool = voicesByGender[gender] ?? voicesByGender.male
          const idx = usage[gender] ?? 0
          defaultMap[seg.speaker_id] = pool[idx % pool.length]
          usage[gender] = idx + 1
        }
        setSpeakerVoiceMap(defaultMap)
      }

      // Initialise speaker traits map from persisted mapping (server-side state).
      // Empty by default — traits are explicit user choices, no auto-default.
      if (initialTraitsMapping && Object.keys(initialTraitsMapping).length > 0) {
        setSpeakerTraitsMap(initialTraitsMapping)
      }
    }
    // initialVoiceMapping, qcScore, qcFindings intentionally excluded from deps:
    // they shouldn't trigger a voice-map re-init, and the isNewJob gate above
    // means we only read initialVoiceMapping at the right moment (mount/job switch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, title, sourceLanguage, targetLanguage, videoUrl, dubbedVideoUrl, videoDuration, initialSegments, setJobData, setSpeakerVoiceMap, setSpeakerTraitsMap, speakerGenders, initialTraitsMapping, setImportedSegments])
  
  // Load saved emotion curves on mount
  useEffect(() => {
    apiClient.listEmotionCurves().then(res => {
      setSavedCurves(res.curves as typeof savedCurves)
    }).catch(() => {})
  }, [])

  // Handle video import: upload to /transcribe-video, return segments for Reference track
  const handleVideoImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Local preview immediately
    const url = URL.createObjectURL(file)
    setImportedVideoUrl(url)
    setImportedVideoFile(file)

    // Reset previous reference state
    setReferenceSegments(null)
    setReferenceJobId(null)
    setReferenceDetectedLang(null)
    setSelectedReferenceIndex(null)
    setTranscriptionError(null)
    setIsTranscribing(true)

    try {
      const initial = await apiClient.transcribeVideo(file, activeSrcLang || undefined)
      setReferenceJobId(initial.ref_job_id)

      if (initial.status === 'complete' && initial.segments.length > 0) {
        // Local CPU fallback returned segments immediately
        setReferenceDetectedLang(initial.detected_language)
        setReferenceSegments(initial.segments)
        return
      }

      // RunPod async path — poll until complete
      const poll = async (): Promise<void> => {
        const MAX_WAIT_MS = 10 * 60 * 1000  // 10 minutes
        const INTERVAL_MS = 3000
        const deadline = Date.now() + MAX_WAIT_MS

        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, INTERVAL_MS))
          const result = await apiClient.getRefTranscript(initial.ref_job_id)
          if (result.status === 'complete') {
            setReferenceDetectedLang(result.detected_language ?? '')
            setReferenceSegments(result.segments)
            return
          }
          if (result.status === 'error') {
            throw new Error(result.error || 'Transcription failed on GPU')
          }
          // still "processing" — keep polling
        }
        throw new Error('Transcription timed out after 10 minutes')
      }

      await poll()
    } catch (err: any) {
      setTranscriptionError(err.message || 'Transcription failed')
    } finally {
      setIsTranscribing(false)
      // Reset file input so the same file can be re-imported if needed
      if (videoInputRef.current) videoInputRef.current.value = ''
    }
  }, [activeSrcLang])

  // Parse time string (MM:SS or HH:MM:SS) to seconds
  const parseTimeToSeconds = (timeStr: string): number => {
    const parts = timeStr.split(':').map(p => parseFloat(p))
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2]
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1]
    }
    return parseFloat(timeStr) || 0
  }
  
  // Handle adding a new segment
  const handleAddSegment = useCallback(() => {
    const startTime = parseTimeToSeconds(newSegmentStart)
    const endTime = parseTimeToSeconds(newSegmentEnd)
    
    if (endTime <= startTime) return
    
    const currentSegments = importedSegments ?? []
    const newSegment: Segment = {
      id: `seg-${Date.now()}`,
      index: currentSegments.length,
      start_time: startTime,
      end_time: endTime,
      speaker_id: `speaker-${currentSegments.length + 1}`,
      speaker_label: `Speaker ${currentSegments.length + 1}`,
      speaker_gender: 'male' as const,
      source_text: newSegmentOriginal,
      target_text: newSegmentTranslation || newSegmentOriginal,
      active_text: newSegmentTranslation || newSegmentOriginal,
      preview_text: null,
      isPreviewing: false,
      status: 'auto',
      qc_findings: [],
      emotionalCurve: {
        combined: [
          { x: 0, y: 0.5 },
          { x: 1, y: 0.5 }
        ],
        locked: false,
        analysis: {
          facial: [],
          vocal: [],
          scene: []
        }
      }
    }
    
    // Sort segments by start time
    const updatedSegments = [...currentSegments, newSegment].sort((a, b) => a.start_time - b.start_time)
    setImportedSegments(updatedSegments)
    
    // Reset form
    setNewSegmentStart('')
    setNewSegmentEnd('')
    setNewSegmentOriginal('')
    setNewSegmentTranslation('')
    setShowAddSegment(false)
  }, [newSegmentStart, newSegmentEnd, newSegmentOriginal, newSegmentTranslation, importedSegments])
  
  // Parse SRT timestamp to seconds
  const parseSrtTime = (timeStr: string): number => {
    const [hours, minutes, rest] = timeStr.split(':')
    const [seconds, ms] = rest.replace(',', '.').split('.')
    return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + parseInt(ms || '0') / 1000
  }
  
  // Parse VTT timestamp to seconds
  const parseVttTime = (timeStr: string): number => {
    const parts = timeStr.split(':')
    if (parts.length === 3) {
      const [hours, minutes, rest] = parts
      const [seconds, ms] = rest.split('.')
      return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + parseInt(ms || '0') / 1000
    } else {
      const [minutes, rest] = parts
      const [seconds, ms] = rest.split('.')
      return parseInt(minutes) * 60 + parseInt(seconds) + parseInt(ms || '0') / 1000
    }
  }
  
  // Handle transcript file import (SRT/VTT)
  const handleTranscriptImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      const fileName = file.name.toLowerCase()
      const newSegments: Segment[] = []
      
      if (fileName.endsWith('.srt')) {
        // Parse SRT format
        const blocks = content.trim().split(/\n\n+/)
        blocks.forEach((block, idx) => {
          const lines = block.split('\n')
          if (lines.length >= 3) {
            const timeLine = lines[1]
            const textLines = lines.slice(2).join(' ')
            const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/)
            if (timeMatch) {
              newSegments.push({
                id: `seg-${idx}`,
                index: idx,
                start_time: parseSrtTime(timeMatch[1]),
                end_time: parseSrtTime(timeMatch[2]),
                speaker_id: `speaker-${idx + 1}`,
                speaker_label: `Speaker ${idx + 1}`,
                source_text: textLines,
                target_text: textLines,
                active_text: textLines,
                preview_text: null,
                isPreviewing: false,
                status: 'auto',
                qc_findings: []
              })
            }
          }
        })
      } else if (fileName.endsWith('.vtt')) {
        // Parse VTT format
        const lines = content.split('\n')
        let i = 0
        // Skip WEBVTT header
        while (i < lines.length && !lines[i].includes('-->')) i++
        
        let segIdx = 0
        while (i < lines.length) {
          const timeLine = lines[i]
          const timeMatch = timeLine.match(/(\d{1,2}:\d{2}[:\.]?\d{0,2}\.?\d{0,3})\s*-->\s*(\d{1,2}:\d{2}[:\.]?\d{0,2}\.?\d{0,3})/)
          if (timeMatch) {
            i++
            const textLines: string[] = []
            while (i < lines.length && lines[i].trim() && !lines[i].includes('-->')) {
              textLines.push(lines[i].trim())
              i++
            }
            if (textLines.length > 0) {
              newSegments.push({
                id: `seg-${segIdx}`,
                index: segIdx,
                start_time: parseVttTime(timeMatch[1]),
                end_time: parseVttTime(timeMatch[2]),
                speaker_id: `speaker-${segIdx + 1}`,
                speaker_label: `Speaker ${segIdx + 1}`,
                source_text: textLines.join(' '),
                target_text: textLines.join(' '),
                active_text: textLines.join(' '),
                preview_text: null,
                isPreviewing: false,
                status: 'auto',
                qc_findings: []
              })
              segIdx++
            }
          } else {
            i++
          }
        }
      }
      
      if (newSegments.length > 0) {
        setImportedSegments(newSegments)
        // Reset locked and dropped translations
        setLockedSegments(new Set())
        setDroppedTranslations([])
      }
    }
    reader.readAsText(file)
  }, [])
  
  // Get the actual video URL to use (imported or original).
  // PREVIEW mode plays the ORIGINAL footage (real lip movement) with the live stitched
  // audio + live captions layered on top, so every edit shows instantly with NO rebuild.
  // Only DUBBED mode shows the last rendered dubbed video (with its baked-in audio/subtitles);
  // that render is an export artifact and is intentionally not used for live editing.
  const activeVideoUrl = importedVideoUrl || (playbackMode === 'dubbed' && activeDubbedVideoUrl ? activeDubbedVideoUrl : videoUrl)

  // The caption to show over the video. In preview mode it follows the playhead (the segment
  // being spoken right now), so subtitles are live and disappear during gaps — no stale baked
  // pixels. In other modes it shows the selected segment for context.
  const captionSegment = useMemo(() => {
    if (playbackMode === 'preview') {
      const t = currentTime
      const live = displaySegments.find(s => t >= effStart(s) && t < effEnd(s))
      if (live) return live
      // paused between segments: keep the selected one visible for context; hide while playing
      return isPlaying ? null : (selectedSegmentIndex !== null ? displaySegments[selectedSegmentIndex] : null)
    }
    return selectedSegmentIndex !== null ? displaySegments[selectedSegmentIndex] : null
  }, [playbackMode, currentTime, isPlaying, displaySegments, selectedSegmentIndex])
  
  // Track which URL we've already extracted thumbnails for
  const lastExtractedUrlRef = useRef<string | null>(null)
  
  // Extract video thumbnails for timeline
  const extractVideoThumbnails = useCallback(async (videoSrc: string) => {
    // Don't re-extract for same URL unless thumbnails are missing (e.g. after hot reload)
    if (lastExtractedUrlRef.current === videoSrc && videoThumbnails.length > 0) return
    lastExtractedUrlRef.current = videoSrc
    
    setIsExtractingThumbnails(true)
    setVideoThumbnails([])
    
    const thumbnails: string[] = []
    
    // Create a temporary video element for extraction
    const tempVideo = document.createElement('video')
    tempVideo.crossOrigin = 'anonymous'
    tempVideo.src = videoSrc
    tempVideo.muted = true
    tempVideo.preload = 'metadata'
    
    // Wait for video to load metadata
    await new Promise<void>((resolve) => {
      tempVideo.onloadedmetadata = () => resolve()
      tempVideo.onerror = () => resolve()
    })
    
    const duration = tempVideo.duration || videoDuration
    if (!duration || duration <= 0) {
      setIsExtractingThumbnails(false)
      return
    }
    
    // Extract one frame per second (or less for long videos)
    const frameInterval = Math.max(1, Math.floor(duration / 30)) // Max 30 thumbnails
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    
    // Thumbnail dimensions
    canvas.width = 120
    canvas.height = 96
    
    for (let time = 0; time < duration; time += frameInterval) {
      try {
        tempVideo.currentTime = time
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            tempVideo.removeEventListener('seeked', onSeeked)
            resolve()
          }
          tempVideo.addEventListener('seeked', onSeeked)
          setTimeout(resolve, 1000) // Timeout fallback
        })
        
        if (ctx) {
          ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.5)
          thumbnails.push(dataUrl)
        }
      } catch {
        // Skip failed frames
      }
    }
    
    if (thumbnails.length > 0) {
      setVideoThumbnails(thumbnails)
    }
    setIsExtractingThumbnails(false)
    tempVideo.remove()
  }, [videoDuration, videoThumbnails.length])

  // Extract thumbnails when imported video URL changes
  useEffect(() => {
    if (importedVideoUrl) {
      extractVideoThumbnails(importedVideoUrl)
    }
  }, [importedVideoUrl, extractVideoThumbnails])
  
  // Extract thumbnails when videoUrl prop changes (for loaded jobs)
  useEffect(() => {
    if (videoUrl && !importedVideoUrl) {
      extractVideoThumbnails(videoUrl)
    }
  }, [videoUrl, importedVideoUrl, extractVideoThumbnails])
  
// Regenerate waveform when video is imported
  const regenerateWaveform = useCallback(() => {
    setIsExtractingWaveform(true)
    const samples = 500
    const waveform: number[] = []
    for (let i = 0; i < samples; i++) {
      const t = i / samples
      const base = 0.3 + Math.sin(t * Math.PI * 8) * 0.15 + Math.sin(t * Math.PI * 23) * 0.1
      const noise = (Math.random() - 0.5) * 0.3
      const burst = Math.sin(t * Math.PI * 3) > 0.2 ? 0.15 : 0
      waveform.push(Math.max(0.05, Math.min(1, base + noise + burst)))
    }
    setWaveformData(waveform)
    setIsExtractingWaveform(false)
  }, [])
  
  // Regenerate waveform when video is imported
  useEffect(() => {
    if (importedVideoUrl) {
      regenerateWaveform()
    }
  }, [importedVideoUrl, regenerateWaveform])
  
  // Handle play/pause state changes
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (isPlaying) {
      video.play().catch((err) => {
        console.log('[v0] Video play failed:', err)
        setIsPlaying(false)
      })
    } else {
      video.pause()
    }
  }, [isPlaying, setIsPlaying])

  // RPT audio playback — separate effect to avoid hook rules violation
  useEffect(() => {
    const video = videoRef.current
    console.log('[RPT-EFFECT] fired — isPlaying:', isPlaying,
      'playbackMode:', playbackMode,
      'buffer:', !!rptBufferRef.current,
      'ctx:', audioContextRef.current?.state ?? 'null',
      'gain:', rptGainRef.current?.gain.value ?? 'null',
      'rptVolume:', rptVolume,
      'isMutedRPT:', isMutedRPT)
    if (playbackMode !== 'preview') {
      // Stop RPT audio when leaving preview mode
      if (rptSourceRef.current) {
        try { rptSourceRef.current.stop() } catch {}
        rptSourceRef.current = null
      }
      return
    }

    // On first switch to Preview, seed RPT manifest
    // from current dubbed segments if not yet seeded
    if (!rptBufferRef.current) {
      initRPTFromSegments()
      // Trigger stitch immediately after seeding
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext()
      }
      const ctx = audioContextRef.current
      const resolved = segments.map(seg => {
        const resolveUrl = (url: string | undefined) => {
          if (!url || !jobId) return url
          if (url.startsWith('http')) return url
          const filename = url.split('/').pop()
          return filename ? apiClient.getAudioFileUrl(jobId, filename) : url
        }
        return {
          ...seg,
          audio_url: resolveUrl(seg.audio_url),
          committed_audio_url: resolveUrl(seg.committed_audio_url),
        }
      })
      requestRPTStitch(
        resolved,
        videoDuration,
        ctx,
        () => {},
        (result) => {
          if (result) rptBufferRef.current = result.buffer
        },
      )
    }

    if (!rptBufferRef.current || !audioContextRef.current) return

    if (isPlaying) {
      const ctx = audioContextRef.current
      rptCancelRef.current = false
      const doSchedule = () => {
        if (rptCancelRef.current) return
        if (rptSourceRef.current) {
          try { rptSourceRef.current.stop() } catch {}
          rptSourceRef.current = null
        }
        if (!rptGainRef.current) {
          rptGainRef.current = ctx.createGain()
          rptGainRef.current.connect(ctx.destination)
        }
        rptGainRef.current!.gain.value = isMutedRPT ? 0 : rptVolume / 100
        rptSourceRef.current = scheduleRPTPlayback(
          rptBufferRef.current!,
          video?.currentTime ?? 0,
          ctx,
          rptGainRef.current!,
          rptPlaybackRate
        )
        rptSourceRef.current.onended = () => { rptSourceRef.current = null }
      }
      if (ctx.state === 'suspended') {
        ctx.resume().then(doSchedule)
      } else {
        doSchedule()
      }
    } else {
      rptCancelRef.current = true
      if (rptSourceRef.current) {
        try { rptSourceRef.current.stop() } catch {}
        rptSourceRef.current = null
      }
    }
  }, [isPlaying, playbackMode, isMutedRPT, rptVolume, rptPlaybackRate])

  // Initialize AudioContext and GainNode once on mount so they are ready
  // before the first stitch completes or the user presses Play.
  useEffect(() => {
    const ctx = new AudioContext()
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    audioContextRef.current = ctx
    rptGainRef.current = gain
    return () => {
      ctx.close()
      audioContextRef.current = null
      rptGainRef.current = null
    }
  }, [])

  // Initial RPT stitch — runs once when segments first load
  // so Preview mode works immediately without needing to
  // generate a segment first.
  useEffect(() => {
    if (!segments.length || !videoDuration) return
    const ctx = audioContextRef.current
    if (!ctx) return
    const resolved = segments.map(seg => {
      const resolveUrl = (url: string | undefined) => {
        if (!url || !jobId) return url
        if (url.startsWith('http')) return url
        const filename = url.split('/').pop()
        return filename ? apiClient.getAudioFileUrl(jobId, filename) : url
      }
      return {
        ...seg,
        audio_url: resolveUrl(seg.audio_url),
        committed_audio_url: resolveUrl(seg.committed_audio_url),
      }
    })
    requestRPTStitch(
      resolved,
      videoDuration,
      ctx,
      () => {},
      (result) => {
        if (result) rptBufferRef.current = result.buffer
      },
    )
  }, [segments.length, videoDuration, jobId])

  // RPT seek sync — restart RPT audio from new position when user scrubs
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleSeeked = () => {
      if (playbackMode !== 'preview') return
      if (!rptBufferRef.current || !audioContextRef.current) return

      // Stop current RPT source
      if (rptSourceRef.current) {
        try { rptSourceRef.current.stop() } catch {}
        rptSourceRef.current = null
      }

      // Only restart if video is playing (read ref to avoid stale closure)
      if (!isPlayingRef.current) return

      const ctx = audioContextRef.current
      if (ctx.state === 'suspended') ctx.resume()
      if (!rptGainRef.current) {
        rptGainRef.current = ctx.createGain()
        rptGainRef.current.connect(ctx.destination)
      }
      rptGainRef.current.gain.value = isMutedRPT ? 0 : rptVolume / 100
      rptSourceRef.current = scheduleRPTPlayback(
        rptBufferRef.current,
        video.currentTime,
        ctx,
        rptGainRef.current,
        rptPlaybackRate
      )
      rptSourceRef.current.onended = () => { rptSourceRef.current = null }
    }

    video.addEventListener('seeked', handleSeeked)
    return () => video.removeEventListener('seeked', handleSeeked)
  }, [playbackMode, isPlaying, isMutedRPT, rptVolume, rptPlaybackRate])

  // Sync playback rate changes live — no restart needed
  useEffect(() => {
    if (rptSourceRef.current) {
      rptSourceRef.current.playbackRate.value = rptPlaybackRate
    }
    if (videoRef.current) {
      videoRef.current.playbackRate = rptPlaybackRate
    }
  }, [rptPlaybackRate])

  // Cleanup RPT audio resources on unmount
  useEffect(() => {
    return () => {
      if (rptSourceRef.current) {
        try { rptSourceRef.current.stop() } catch {}
        rptSourceRef.current = null
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {})
        audioContextRef.current = null
      }
    }
  }, [])

  // Sync video time when user seeks (not during playback)
  useEffect(() => {
    const video = videoRef.current
    if (!video || isPlaying) return
    
    if (Math.abs(video.currentTime - currentTime) > 0.1) {
      video.currentTime = currentTime
    }
  }, [currentTime, isPlaying])
  
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const trackMuted = playbackMode === 'preview' ? true : (playbackMode === 'dubbed' ? isMutedDubbed : isMutedOriginal)
    const trackVol = playbackMode === 'preview' ? 0 : (playbackMode === 'dubbed' ? dubbedTextVolume : originalTextVolume)
    video.volume = (isMuted || trackMuted) ? 0 : Math.max(0, Math.min(1, trackVol / 100))
  }, [isMuted, isMutedOriginal, isMutedDubbed, originalTextVolume, dubbedTextVolume, playbackMode])

  useEffect(() => { setPendingDelete(null) }, [selectedSegmentIndex])

  const handleVideoTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime)
      if (timelineRef.current) {
        const container = timelineRef.current
        const pps = 40 * zoomLevel
        const playheadPx = videoRef.current.currentTime * pps
        const visibleLeft = container.scrollLeft
        const visibleRight = container.scrollLeft + container.clientWidth
        if (playheadPx > visibleRight - container.clientWidth * 0.15) {
          container.scrollLeft = playheadPx - container.clientWidth * 0.3
        } else if (playheadPx < visibleLeft) {
          container.scrollLeft = Math.max(0, playheadPx - container.clientWidth * 0.1)
        }
      }
    }
  }, [setCurrentTime, zoomLevel])
  
  // Segment click — always just select; QC is shown in the docked right panel
  // Ctrl+click a first then last segment to select that contiguous run. First
  // click sets the anchor; each later click sets the range end (anchor..index).
  const handleGroupRangeClick = useCallback((index: number) => {
    setGroupAnchor(prev => {
      if (prev === null) {
        setGroupSelectedSegments(new Set([index]))
        return index
      }
      const lo = Math.min(prev, index)
      const hi = Math.max(prev, index)
      const range = new Set<number>()
      for (let i = lo; i <= hi; i++) range.add(i)
      setGroupSelectedSegments(range)
      return prev
    })
  }, [])

  const enterGroupSelectMode = useCallback(() => {
    setGroupSelectMode(true)
    setGroupAnchor(null)
    setGroupSelectedSegments(new Set())
  }, [])

  const clearGroupSelection = useCallback(() => {
    setGroupSelectMode(false)
    setGroupAnchor(null)
    setGroupSelectedSegments(new Set())
    setGroupMoveActive(false)
    groupMoveActiveRef.current = false
    setGroupMoveOffset({ x: 0, y: 0 })
  }, [])

  const handleSegmentClick = useCallback((index: number, e?: React.MouseEvent) => {
    // In group-selection mode a Ctrl+click builds the range instead of selecting
    // /seeking; stopPropagation keeps the context-menu wrapper from also selecting.
    if (groupSelectMode && e && (e.ctrlKey || e.metaKey)) {
      e.stopPropagation()
      handleGroupRangeClick(index)
      return
    }
    selectSegment(index)
    const seg = displaySegmentsRef.current[index]
    if (seg) {
      setCurrentTime(seg.start_time)
      if (videoRef.current) videoRef.current.currentTime = seg.start_time
    }
  }, [selectSegment, groupSelectMode, handleGroupRangeClick])
  
  // Handle preview panel resize
  const handlePreviewResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizingPreview(true)
    
    const startX = e.clientX
    const startWidth = previewWidth
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX
      const newWidth = Math.min(Math.max(startWidth + delta, 300), 1100)
      setPreviewWidth(newWidth)
    }
    
    const handleMouseUp = () => {
      setIsResizingPreview(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      if (!layoutLocked) {
        localStorage.setItem('dubverse.editor.previewWidth', previewWidth.toString())
      }
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [previewWidth, layoutLocked])
  
  // Handle timeline resize (vertical)
  const handleTimelineResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizingTimeline(true)
    
    const startY = e.clientY
    const startHeight = timelineHeight
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY
      const newHeight = Math.min(Math.max(startHeight + delta, 150), 700)
      setTimelineHeight(newHeight)
    }
    
    const handleMouseUp = () => {
      setIsResizingTimeline(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      if (!layoutLocked) {
        localStorage.setItem('dubverse.editor.timelineHeight', timelineHeight.toString())
      }
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [timelineHeight, layoutLocked])
  
  // Toggle layout lock
  const toggleLayoutLock = useCallback(() => {
    const next = !layoutLocked
    setLayoutLocked(next)
    localStorage.setItem('dubverse.editor.layoutLocked', next.toString())
    if (!next) {
      // When unlocking, immediately save current state
      localStorage.setItem('dubverse.editor.previewWidth', previewWidth.toString())
      localStorage.setItem('dubverse.editor.timelineHeight', timelineHeight.toString())
      localStorage.setItem('dubverse.editor.zoomLevel', zoomLevel.toString())
      const el = timelineRef.current
      if (el) localStorage.setItem('dubverse.editor.scrollPosition', el.scrollLeft.toString())
    }
  }, [layoutLocked, previewWidth, timelineHeight, zoomLevel])

  // Handle mouse wheel zoom on timeline
  const handleTimelineWheel = useCallback((e: React.WheelEvent) => {
    // Only zoom if not holding shift (shift = horizontal scroll)
    if (e.shiftKey) return
    
    e.preventDefault()
    const delta = e.deltaY
    
    // Scroll up (negative delta) = zoom in (stretch), scroll down = zoom out (shrink)
    if (delta < 0) {
      // Zoom in - stretch timeline
      setZoomLevel(Math.min(zoomLevel * 1.15, 4))
    } else {
      // Zoom out - shrink timeline
      setZoomLevel(Math.max(zoomLevel / 1.15, 0.25))
    }
  }, [zoomLevel, setZoomLevel])
  
  // Handle needle/playhead drag
  const handleNeedleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const timelineElement = timelineRef.current
    if (!timelineElement) return

    const pps = 40 * zoomLevel

    const updateTimeFromMouse = (clientX: number) => {
      const rect = timelineElement.getBoundingClientRect()
      const scrollLeft = timelineElement.scrollLeft
      const x = clientX - rect.left + scrollLeft
      const newTime = Math.max(0, Math.min(x / pps, videoDuration))
      setCurrentTime(newTime)
      if (videoRef.current) videoRef.current.currentTime = newTime

      // Auto-scroll when dragging near edges
      const relX = clientX - rect.left
      const scrollZone = 60
      if (relX < scrollZone) {
        timelineElement.scrollLeft -= (scrollZone - relX) * 0.4
      } else if (relX > rect.width - scrollZone) {
        timelineElement.scrollLeft += (relX - (rect.width - scrollZone)) * 0.4
      }
    }

    updateTimeFromMouse(e.clientX)

    const handleMouseMove = (moveEvent: MouseEvent) => {
      updateTimeFromMouse(moveEvent.clientX)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [videoDuration, setCurrentTime, zoomLevel])
  
  // Handle drag start for suggestions (English translations)
  const handleDragStart = useCallback((e: React.DragEvent, suggestion: Suggestion, segmentIndex: number) => {
    const segment = displaySegments[segmentIndex]
    e.dataTransfer.setData('application/json', JSON.stringify({ 
      suggestion, 
      segmentIndex,
      startTime: segment?.start_time || 0,
      endTime: segment?.end_time || 0
    }))
    e.dataTransfer.effectAllowed = 'copy'
    setDraggedTranslation({ segmentIndex, text: suggestion.text })
  }, [segments])
  
  // Handle drop on dubbed track in timeline
  const handleTimelineDrop = useCallback((e: React.DragEvent, targetSegmentIndex: number) => {
    e.preventDefault()
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.suggestion) {
        updateSegmentText(targetSegmentIndex, data.suggestion.text)
        // Add to dropped translations for timeline display
        const segment = displaySegments[targetSegmentIndex]
        if (segment) {
          setDroppedTranslations(prev => [
            ...prev.filter(t => t.segmentIndex !== targetSegmentIndex),
            {
              segmentIndex: targetSegmentIndex,
              text: data.suggestion.text,
              startTime: segment.start_time,
              endTime: segment.end_time
            }
          ])
        }
      }
    } catch {}
    setDraggedTranslation(null)
  }, [updateSegmentText, segments])
  
  // Handle drop directly on dubbed track area
  const handleDubbedTrackDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.suggestion && data.startTime !== undefined) {
        // Add the translation to the dropped translations
        setDroppedTranslations(prev => [
          ...prev.filter(t => t.segmentIndex !== data.segmentIndex),
          {
            segmentIndex: data.segmentIndex,
            text: data.suggestion.text,
            startTime: data.startTime,
            endTime: data.endTime
          }
        ])
        // Update the segment text
        updateSegmentText(data.segmentIndex, data.suggestion.text)
      }
    } catch {}
    setDraggedTranslation(null)
  }, [updateSegmentText])

  const handleTimelineMouseMove = useCallback((e: React.MouseEvent) => {
    // Group movement during the drag phase — offset all selected segments live.
    if (groupMoveActiveRef.current) {
      setGroupMoveOffset({
        x: e.clientX - groupMoveStartXRef.current,
        y: 0
      })
    }
  }, [])

  const handleTimelineMouseUpWrapper = useCallback((e: React.MouseEvent) => {
    // Handle group movement end
    if (groupMoveActiveRef.current) {
      const timeDelta = groupMoveOffset.x / PIXELS_PER_SECOND

      displaySegments.forEach((segment, index) => {
        if (groupSelectedSegments.has(index)) {
          // Base on effStart/effEnd and write the committed fields (+ persist), the
          // same way the single-segment drag does — otherwise the group snaps back
          // to its pre-move position because the tracks render through effStart.
          const newStartTime = Math.max(0, effStart(segment) + timeDelta)
          const newEndTime = Math.max(0, effEnd(segment) + timeDelta)

          updateSegment(index, {
            start_time: newStartTime,
            end_time: newEndTime,
          })
          commitSegmentChanges(index, {
            committed_start_time: newStartTime,
            committed_end_time: newEndTime,
          })
          apiClient.commitSegmentTiming(jobId, segment.transcript_index ?? index, {
            committed_start_time: newStartTime,
            committed_end_time: newEndTime,
          }).catch(err => console.warn('[GROUP-MOVE]', err))

          setImportedSegments(prev => {
            if (!prev) return prev
            return prev.map((seg, i) =>
              i === index
                ? { ...seg, start_time: newStartTime, end_time: newEndTime, committed_start_time: newStartTime, committed_end_time: newEndTime }
                : seg
            )
          })
        }
      })

      setGroupMoveActive(false)
      groupMoveActiveRef.current = false
    }
  }, [groupMoveOffset, groupSelectedSegments, displaySegments, commitSegmentChanges, jobId])

  // Global undo stack: each text edit pushes {index, prevText} so the top-bar
  // undo button can step backward through all edits in reverse order.
  const undoStack = useRef<Array<{ index: number; prevText: string }>>([])
  // Hume auto-fire guard, lifted out of FloatingEmotionChart so Clear Segment
  // and text edits can reset it (re-fire emotion analysis on next dwell).
  const emotionAutoFiredRef = useRef<Set<number>>(new Set())

  const _applyUndo = useCallback((index: number, prevText: string) => {
    setPreviewText(index, prevText)
    updateSegment(index, { preview_text: prevText, active_text: prevText, isUserEdited: true })
    setImportedSegments(p => p ? p.map((seg, i) => i === index ? { ...seg, preview_text: prevText, active_text: prevText } : seg) : p)
  }, [setPreviewText, updateSegment])

  // Global undo — pops the most recent edit off the stack (any segment).
  const handleGlobalUndo = useCallback(() => {
    const entry = undoStack.current.pop()
    if (!entry) return
    _applyUndo(entry.index, entry.prevText)
  }, [_applyUndo])

  const submitAskAiChat = useCallback(async () => {
    const text = askAiChatInput.trim()
    if (!text || askAiChatLoading) return
    const history = askAiChatMessages.map(m => ({ role: m.role, content: m.content }))
    setAskAiChatMessages(prev => [...prev, { role: 'user', content: text, displayed: text }])
    setAskAiChatInput('')
    setAskAiChatError(null)
    setAskAiChatLoading(true)
    try {
      const res = await apiClient.askAIChat(jobId, text, history)
      setAskAiChatMessages(prev => [...prev, { role: 'assistant', content: res.reply, displayed: '' }])
    } catch (err) {
      setAskAiChatError(err instanceof Error ? err.message : 'Ask AI is unavailable right now.')
    } finally {
      setAskAiChatLoading(false)
    }
  }, [askAiChatInput, askAiChatLoading, askAiChatMessages, jobId])

  const startNewAskAiChat = useCallback(() => {
    setAskAiConversations(prev => [...prev, { id: `askai-${Date.now()}`, messages: [] }])
    setAskAiCurrentIndex(askAiConversations.length)
    setAskAiChatInput('')
    setAskAiChatError(null)
    setAskAiConvListOpen(false)
  }, [askAiConversations.length])

  const switchAskAiConversation = useCallback((index: number) => {
    setAskAiCurrentIndex(index)
    setAskAiChatInput('')
    setAskAiChatError(null)
    setAskAiConvListOpen(false)
  }, [])

  // Per-segment undo (context menu) — splices the most recent entry for that segment.
  const handleUndoLastEdit = useCallback((index: number) => {
    const stackArr = undoStack.current
    for (let i = stackArr.length - 1; i >= 0; i--) {
      if (stackArr[i].index === index) {
        const [entry] = stackArr.splice(i, 1)
        _applyUndo(entry.index, entry.prevText)
        return
      }
    }
  }, [_applyUndo])

  const handleClearSegment = useCallback((index: number) => {
    const original = initialSegments[index]
    const filename = (original?.audio_url ?? '').split('/').pop() ?? ''
    const audio_url = filename ? apiClient.getAudioFileUrl(jobId, filename) : undefined
    // Full reset: text falls back to the original source transcription (not the
    // translation). Split/new segments have no source_text — the empty value
    // makes the row render its "Enter text…" placeholder.
    const sourceText = displaySegments[index]?.source_text ?? original?.source_text ?? ''
    const clearedFields = {
      target_text: sourceText,
      active_text: sourceText,
      variant_text: sourceText,
      preview_text: null,
      isPreviewing: false,
      isUserEdited: false,
      audio_url,
      status: 'auto' as const,
      rpt_dirty: false,
      committed_emotion: null,
      committed_voice_id: null,
      committed_speed: null,
      committed_audio_url: undefined,
      committed_adapted_text: undefined,
      committed_start_time: undefined,
      committed_end_time: undefined,
      attached_traits: null,
      velma_emotion_curve: undefined,
      velma_progression: undefined,
    }
    // Voice → default, character profile + emotion staging + auto-fire guard cleared.
    setStagedVoices(prev => { const next = { ...prev }; delete next[index]; return next })
    setStagedEmotions(prev => { const next = { ...prev }; delete next[index]; return next })
    emotionAutoFiredRef.current.delete(index)
    updateSegment(index, clearedFields)
    setImportedSegments(prev => {
      if (!prev) return prev
      return prev.map((seg, i) => i === index ? { ...seg, ...clearedFields } : seg)
    })
    if (editingSegmentIndex === index) {
      setEditingText('')
      setEditingSegmentIndex(null)
    }
    setCustomEmotionDrafts(prev => { const n = { ...prev }; delete n[index]; return n })
    setStagedEmotions(prev => { const n = { ...prev }; delete n[index]; return n })
    setStagedSpeeds(prev => { const n = { ...prev }; delete n[index]; return n })
    setStagedVoices(prev => { const n = { ...prev }; delete n[index]; return n })
    setStagedPitches(prev => { const n = { ...prev }; delete n[index]; return n })
    setLockedSegments(prev => { const next = new Set(prev); next.delete(index); return next })
    setDroppedTranslations(prev => prev.filter(t => t.segmentIndex !== index))
    apiClient.resetSegment(jobId, index).catch(err => console.warn('[CLEAR]', err))
  }, [initialSegments, jobId, updateSegment, editingSegmentIndex])

  // Handle Generate Speech - calls backend TTS regeneration for the selected segment
  const handleGenerateSpeech = useCallback(async (segIdx?: number, voiceOverride?: string, textOverride?: string, ttsTextOverride?: string): Promise<boolean> => {
    const activeIndex = segIdx ?? selectedSegmentIndex
    console.log('[REGEN] called', { segIdx, voiceOverride, textOverride, activeIndex, isRegenerating, selectedSegmentIndex })
    if (activeIndex === null) { console.warn('[REGEN] aborted — activeIndex null'); return false }
    if (isRegeneratingRef.current) {
      // Queue instead of dropping (depth 1, last-write-wins); drained in finally.
      regenQueueRef.current = { segIdx, voiceOverride, textOverride, ttsTextOverride }
      setQueuedSegmentIndex(activeIndex)
      console.warn('[REGEN] queued — regen already in flight', { segIdx, voiceOverride })
      return false
    }
    const segment = displaySegments[activeIndex]
    if (!segment) { console.warn('[REGEN] aborted — no segment at index', activeIndex); return false }

    // Guard: if the segment has committed audio AND the text has changed from
    // what was last committed, require explicit confirmation before overwriting.
    const incomingText = (activeIndex === selectedSegmentIndex && editingText.trim())
      ? editingText.trim()
      : (segment.preview_text ?? segment.active_text ?? segment.target_text)
    const committedText = segment.committed_adapted_text ?? segment.target_text
    const textChanged = incomingText !== committedText
    if (segment.committed_audio_url && textChanged && voiceOverride === undefined && segIdx === undefined) {
      setPendingOverwriteIndex(activeIndex)
      return false
    }

    // Locked segment — refuse to regenerate. This is the choke point that freezes
    // voice / emotion / speed: those are staged and only applied on regenerate, so
    // blocking here keeps a locked segment's audio and attachments exactly as-is.
    // Unlock (Shift+U) to change it.
    if (lockedSegments.has(activeIndex)) {
      console.warn('[REGEN] blocked — segment is locked', activeIndex)
      return false
    }

    selectSegment(activeIndex)
    setRegenError(null)
    isRegeneratingRef.current = true
    setIsRegenerating(true)
    setRegeneratingSegmentIndex(activeIndex)
    try {
      const emotionIntensity = sampleEmotionalCurve(activeIndex, 0.5)
      const finalVoiceKey = voiceOverride ?? stagedVoices[activeIndex] ?? speakerVoiceMap[segment.speaker_id]
      // Priority: explicit textOverride (passed by saveEditing — immune to stale
      // closures) > live editingText for the selected segment > stored preview/active text.
      const regenerateText = (textOverride && textOverride.trim())
        ? textOverride.trim()
        : (activeIndex === selectedSegmentIndex && editingText.trim())
          ? editingText.trim()
          : (segment.preview_text ?? segment.active_text ?? segment.target_text)
      console.log('[REGEN] calling backend', { activeIndex, finalVoiceKey, regenerateText, textOverride, preview_text: segment.preview_text, active_text: segment.active_text, editing: editingText.trim() })
      // Live timeline boundaries, straight from the on-screen segment — segments.json
      // on the backend can lag behind a split/resize whose commitSegmentTiming call
      // is fire-and-forget (see the interrupt handler above). Sending these lets the
      // fit-check use what the user is actually looking at instead of a stale copy.
      const liveStart = effStart(segment)
      const liveEnd = effEnd(segment)
      const nextSegment = displaySegments[activeIndex + 1]
      const liveNextStart = nextSegment ? effStart(nextSegment) : undefined
      const response = await apiClient.regenerateSegment(jobId, segment.transcript_index ?? activeIndex, {
        text: regenerateText,
        speed: stagedSpeeds[activeIndex] ?? 1.0,
        // '' = explicit clear (backend pops seg["emotion"]); undefined = unset → use committed
        emotion: stagedEmotions[activeIndex] ?? segment.committed_emotion,
        // attached_traits = frozen on first keystroke. undefined = no change; [] = clear; non-empty = set
        traits: segment.attached_traits ?? undefined,
        voice_key: voiceOverride ?? stagedVoices[activeIndex] ?? speakerVoiceMap[segment.speaker_id],
        pitch: stagedPitches[activeIndex] ?? speakerPitchMap[segment.speaker_id] ?? 0,
        emotionIntensity,
        nuances: stagedNuances[activeIndex] ?? segment.nuances,
        nuance_markers: segment.nuance_markers,
        custom_nuance: segment.custom_nuance,
        // Delivery Script: verbatim line + tags, applied only when generated from the
        // write-in (explicit override). A normal regen sends nothing → clean/pill mode,
        // so there's no sticky-forever state to get trapped in.
        tts_text: ttsTextOverride,
        live_segment_start: liveStart,
        live_segment_end: liveEnd,
        live_next_segment_start: liveNextStart,
      })
      console.log('[REGEN] backend response', { path: response.segment.path, voice_id: response.segment.voice_id, status: response.status })
      if (response.segment.timing_exclusion) {
        setTimingExclusion({
          audioDuration: response.segment.timing_audio_duration ?? 0,
          slotDuration: response.segment.timing_slot_duration ?? 0,
          overlap: response.segment.timing_overlap ?? 0,
          segmentIndex: activeIndex,
        })
        return false
      }
      const filename = response.segment.path.split('/').pop() ?? ''
      const audio_url = filename
        ? `${apiClient.getAudioFileUrl(jobId, filename)}?ts=${Date.now()}`
        : segment.audio_url
      // If the backend GREW the segment into neighboring gaps to fit the audio,
      // adopt its new committed timing so the timeline shows the bigger slot (and we
      // don't then shrink it back). Otherwise keep the frontend's timing as the source
      // of truth — backend timing can lag for split/added segments.
      const bStart = response.segment.start
      const bEnd = response.segment.end
      const expanded = bEnd > liveEnd + 0.02 || bStart < liveStart - 0.02
      if (expanded) {
        updateSegment(activeIndex, { start_time: bStart, end_time: bEnd })
        commitSegmentChanges(activeIndex, { committed_start_time: bStart, committed_end_time: bEnd })
        apiClient.commitSegmentTiming(jobId, segment.transcript_index ?? activeIndex, {
          committed_start_time: bStart, committed_end_time: bEnd,
        }).catch(err => console.warn('[REGEN-EXPAND]', err))
        setImportedSegments(prev => prev ? prev.map((seg, i) => i === activeIndex
          ? { ...seg, start_time: bStart, end_time: bEnd, committed_start_time: bStart, committed_end_time: bEnd }
          : seg) : prev)
      }
      updateSegment(activeIndex, {
        audio_url,
        status: 'edited',
        was_truncated: false,
      })
      const audioDur = response.segment.audio_duration
      const slotDur = segment.end_time - segment.start_time
      const shouldShrink = !expanded && audioDur != null && audioDur > 0 && audioDur < slotDur * 0.85
      let shrunkEnd = segment.end_time
      if (shouldShrink) {
        const buffer = getTrailingBuffer(segment.preview_text ?? segment.active_text ?? segment.target_text ?? '')
        shrunkEnd = segment.start_time + audioDur + buffer
        shrunkEnd = Math.min(shrunkEnd, segment.end_time)
        const nextSeg = displaySegments[activeIndex + 1]
        if (nextSeg) {
          shrunkEnd = Math.min(shrunkEnd, nextSeg.start_time - 0.05)
        }
        shrunkEnd = Math.max(shrunkEnd, segment.start_time + 0.1)
        updateSegment(activeIndex, { end_time: shrunkEnd })
        commitSegmentChanges(activeIndex, { committed_end_time: shrunkEnd })
        apiClient.commitSegmentTiming(jobId, segment.transcript_index ?? activeIndex, {
          committed_end_time: shrunkEnd,
        }).catch(err => console.warn('[AUTO-SHRINK]', err))
      }
      setImportedSegments(prev => {
        if (!prev) return prev
        return prev.map((seg, i) => i === activeIndex
          ? {
              ...seg,
              audio_url,
              committed_audio_url: audio_url,
              status: 'edited' as const,
              was_truncated: false,
              committed_emotion: stagedEmotions[activeIndex] ?? seg.committed_emotion,
              ...(shouldShrink ? { end_time: shrunkEnd } : {}),
            }
          : seg)
      })
      setPlaybackMode('preview')
      commitSegmentChanges(activeIndex, {
        committed_audio_url: audio_url,
        committed_voice_id: response.segment.voice_id ?? voiceOverride ?? stagedVoices[activeIndex] ?? speakerVoiceMap[segment.speaker_id],
        committed_speed: stagedSpeeds[activeIndex] ?? 1.0,
        committed_emotion: stagedEmotions[activeIndex],
      })
      applyFlagOutcome(activeIndex, 'voice')
      requestRPTStitch(
        displaySegments.map((seg, segArrayIdx) => {
          const resolveAudioUrl = (url: string | undefined) => {
            if (!url || !jobId) return url
            if (url.startsWith('http')) return url
            const filename = url.split('/').pop()
            return filename ? apiClient.getAudioFileUrl(jobId, filename) : url
          }
          // For the segment just generated, use the new audio_url directly
          // so the stitch reflects the edit without waiting for store update.
          // Compare by array position — activeIndex indexes into this same
          // displaySegments array, so seg.index (which may diverge after
          // splits/reorders) is unreliable here.
          const isActiveSegment = segArrayIdx === activeIndex
          return {
            ...seg,
            audio_url: isActiveSegment ? audio_url : resolveAudioUrl(seg.audio_url),
            committed_audio_url: isActiveSegment
              ? audio_url
              : resolveAudioUrl(seg.committed_audio_url),
            start_time: seg.start_time,
            end_time: seg.end_time,
          }
        }),
        videoDuration,
        (() => {
          if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext()
          }
          return audioContextRef.current
        })(),
        () => {},
        (result) => {
          if (result) {
            rptBufferRef.current = result.buffer
          }
        },
      )
      if (!droppedTranslations.some(t => t.segmentIndex === activeIndex)) {
        setDroppedTranslations(prev => [
          ...prev,
          {
            segmentIndex: activeIndex,
            text: response.segment.text,
            startTime: segment.start_time,
            endTime: segment.end_time,
          }
        ])
      }
      return true
    } catch (err: any) {
      console.error('[Generate Speech] Failed:', err.message)
      setRegenError('Generation failed — please try again')
      return false
    } finally {
      isRegeneratingRef.current = false
      setIsRegenerating(false)
      setRegeneratingSegmentIndex(null)
      // Two-pulse confirmation
      setConfirmingSegmentIndex(activeIndex)
      setTimeout(() => setConfirmingSegmentIndex(null), 1200)
      // Drain queued regen. The ref guard above is already false, so the next
      // invocation proceeds regardless of React render timing.
      const queued = regenQueueRef.current
      if (queued) {
        regenQueueRef.current = null
        setQueuedSegmentIndex(null)
        setTimeout(() => {
          handleGenerateSpeechRef.current(queued.segIdx, queued.voiceOverride, queued.textOverride, queued.ttsTextOverride)
        }, 0)
      }
    }
  }, [selectedSegmentIndex, isRegenerating, displaySegments, jobId, droppedTranslations, updateSegment, stagedSpeeds, lockedSegments, selectSegment, setImportedSegments, setPlaybackMode, editingText])

  const handleGenerateSpeechRef = useRef(handleGenerateSpeech)
  handleGenerateSpeechRef.current = handleGenerateSpeech
  const displaySegmentsRef = useRef(displaySegments)
  displaySegmentsRef.current = displaySegments

  // Manual "make room" for a segment whose audio won't fit even after the automatic
  // expand-into-gaps. Grows this segment's slot and RIPPLES every later segment right
  // by the same amount (so nothing collides), then regenerates it into the bigger slot.
  // multiplier ×1 = just fit the audio; ×2/×3 = progressively more trailing room.
  const expandTimingSlot = useCallback((multiplier: number) => {
    const ex = timingExclusion
    if (!ex) return
    const idx = ex.segmentIndex
    const segs = displaySegmentsRef.current
    const seg = segs[idx]
    if (!seg) return
    const start = effStart(seg)
    const newSlot = Math.max(ex.slotDuration * multiplier, ex.audioDuration + 0.2)
    const newEnd = start + newSlot
    const nextStart = start + ex.slotDuration           // the neighbor boundary that was constraining
    const delta = Math.max(0, (newEnd + 0.05) - nextStart) // how far to push later segments
    const updated = segs.map((s, i) => {
      if (i === idx) {
        return { ...s, end_time: newEnd, committed_end_time: newEnd, status: 'edited' as const, rpt_dirty: true }
      }
      if (delta > 0 && effStart(s) >= nextStart - 0.01) {
        return {
          ...s,
          start_time: effStart(s) + delta,
          end_time: effEnd(s) + delta,
          committed_start_time: effStart(s) + delta,
          committed_end_time: effEnd(s) + delta,
        }
      }
      return s
    })
    setImportedSegments(updated)
    setTimingExclusion(null)
    // Persist the whole rippled layout, then regenerate this segment into the new
    // (now large enough) slot so it fits with no speed-up and no truncation.
    setTimeout(async () => {
      await syncSegmentsToBackend(displaySegmentsRef.current)
      await new Promise(r => setTimeout(r, 0))
      handleGenerateSpeechRef.current(idx, undefined, undefined)
    }, 0)
  }, [timingExclusion, syncSegmentsToBackend])


  // Apply one voice to EVERY segment of a speaker via the backend bulk endpoint —
  // reliable and atomic (no per-segment client loop that could skip/fail some and
  // leave voices inconsistent). Updates each regenerated segment's audio in place.
  const applyVoiceToSpeaker = useCallback(async (speakerId: string, voiceId: string) => {
    const indices = displaySegmentsRef.current
      .map((seg, i) => ({ seg, i }))
      .filter(({ seg }) => seg.speaker_id === speakerId)
      .map(({ i }) => i)
    if (indices.length === 0) return
    setSpeakerRegenQueue(new Set(indices))
    try {
      const res = await apiClient.applyVoiceToSpeaker(jobId, speakerId, voiceId)
      const byTi = new Map(res.regenerated.map(r => [r.transcript_index, r]))
      setImportedSegments(prev => {
        const base = prev ?? displaySegmentsRef.current
        return base.map(seg => {
          const r = seg.transcript_index != null ? byTi.get(seg.transcript_index) : undefined
          if (!r) return seg
          const filename = (r.path || '').split('/').pop()
          const url = filename ? `${apiClient.getAudioFileUrl(jobId, filename)}?ts=${Date.now()}` : seg.committed_audio_url
          return { ...seg, committed_voice_id: r.voice_id, committed_audio_url: url, audio_url: url, status: 'edited' as const, rpt_dirty: false }
        })
      })
      invalidateCache()
      // Rebuild the preview audio so playback reflects the new voices. Without this
      // the files regenerate but you keep hearing the old stitch — the "assignment
      // does nothing" symptom (the single-segment path already re-stitches).
      if (audioContextRef.current == null) {
        audioContextRef.current = new AudioContext()
      }
      const resolveUrl = (url?: string) => {
        if (!url || !jobId) return url
        if (url.startsWith('http')) return url
        const fn = url.split('/').pop()
        return fn ? apiClient.getAudioFileUrl(jobId, fn) : url
      }
      const stitchSegs = displaySegmentsRef.current.map(seg => {
        const r = seg.transcript_index != null ? byTi.get(seg.transcript_index) : undefined
        if (r) {
          const fn = (r.path || '').split('/').pop()
          const url = fn ? `${apiClient.getAudioFileUrl(jobId, fn)}?ts=${Date.now()}` : resolveUrl(seg.committed_audio_url)
          return { ...seg, audio_url: url, committed_audio_url: url }
        }
        return { ...seg, audio_url: resolveUrl(seg.audio_url), committed_audio_url: resolveUrl(seg.committed_audio_url) }
      })
      requestRPTStitch(stitchSegs, videoDuration, audioContextRef.current, () => {}, (result) => {
        if (result) rptBufferRef.current = result.buffer
      })
      setPlaybackMode('preview')
      if (res.failed.length > 0) {
        setRegenError(`Voice applied, but ${res.failed.length} segment(s) failed — try applying again.`)
      } else if (res.skipped_locked.length > 0) {
        setRegenError(`Voice applied. ${res.skipped_locked.length} locked segment(s) were left unchanged — unlock them to include.`)
      }
    } catch (err) {
      console.warn('[APPLY-VOICE]', err)
      setRegenError('Failed to apply voice to speaker — please try again.')
    } finally {
      setSpeakerRegenQueue(new Set())
    }
  }, [jobId, videoDuration])

  // Preview speech — non-destructive TTS preview using preview_text
  const handlePreviewSpeech = useCallback(async (index: number) => {
    if (isRegenerating) return
    const segment = displaySegments[index]
    if (!segment) return

    const text = segment.preview_text?.trim() || segment.active_text?.trim() || segment.target_text?.trim() || ''
    if (!text) {
      console.warn('No text available for TTS preview')
      return
    }

    setRegenError(null)

    // If segment already has generated audio and no new preview text
    // pending, play existing audio directly without a backend call
    if (segment.status === 'edited' && segment.audio_url && !segment.preview_text) {
      const absUrl = segment.audio_url.startsWith('http')
        ? segment.audio_url
        : apiClient.getAudioFileUrl(jobId, segment.audio_url.split('/').pop() ?? '')
      if (segmentAudioRef.current) {
        segmentAudioRef.current.pause()
        segmentAudioRef.current = null
      }
      const audio = new Audio(absUrl)
      audio.playbackRate = stagedSpeeds[index] ?? 1.0
      audio.volume = isMutedDubbed ? 0 : Math.max(0, Math.min(1, (masterVolume / 100) * (dubbedTextVolume / 100)))
      audio.onended = () => { setIsSegmentPreviewing(false); segmentAudioRef.current = null }
      segmentAudioRef.current = audio
      setIsSegmentPreviewing(true)
      audio.play()
      return
    }

    setIsRegenerating(true)
    try {
      const response = await apiClient.regenerateSegment(jobId, segment.transcript_index ?? index, {
        text,
        speed: stagedSpeeds[index] ?? 1.0,
        emotion: stagedEmotions[index],
        traits: segment.attached_traits ?? undefined,
        voice_key: stagedVoices[index] ?? speakerVoiceMap[segment.speaker_id],
        pitch: stagedPitches[index] ?? speakerPitchMap[segment.speaker_id] ?? 0,
      })
      const filename = response.segment.path.split('/').pop() ?? ''
      const absUrl = filename
        ? `${apiClient.getAudioFileUrl(jobId, filename)}?ts=${Date.now()}`
        : segment.audio_url
      if (!absUrl) return

      if (segmentAudioRef.current) {
        segmentAudioRef.current.pause()
        segmentAudioRef.current = null
      }

      const audio = new Audio(absUrl)
      audio.playbackRate = stagedSpeeds[index] ?? 1.0
      audio.volume = isMutedDubbed ? 0 : Math.max(0, Math.min(1, (masterVolume / 100) * (dubbedTextVolume / 100)))
      audio.onended = () => {
        setIsSegmentPreviewing(false)
        segmentAudioRef.current = null
      }
      segmentAudioRef.current = audio
      setIsSegmentPreviewing(true)
      audio.play()
    } catch (err: any) {
      console.error('[Preview Speech] Failed:', err.message)
      setRegenError('Preview generation failed — please try again')
    } finally {
      setIsRegenerating(false)
    }
  }, [displaySegments, jobId, stagedSpeeds, stagedEmotions, stagedVoices, stagedPitches, speakerVoiceMap, speakerPitchMap, isMutedDubbed, masterVolume, dubbedTextVolume, isRegenerating])

  useEffect(() => {
    if (pendingAutoRegenRef.current === null) return
    const idx = pendingAutoRegenRef.current
    pendingAutoRegenRef.current = null
    handleGenerateSpeech(idx)
  }, [importedSegments?.length, handleGenerateSpeech])

  // Handle Revert to Original — restores text and audio from the initial load snapshot
  const handleRevert = useCallback(() => {
    if (selectedSegmentIndex === null) return
    const original = (snapshotSegments ?? initialSegments)[selectedSegmentIndex]
    if (!original) return

    const filename = (original.audio_url ?? '').split('/').pop() ?? ''
    const audio_url = filename ? apiClient.getAudioFileUrl(jobId, filename) : undefined

    const revertedFields = {
      target_text: original.target_text,
      active_text: original.target_text,
      variant_text: original.target_text,
      preview_text: null,
      isPreviewing: false,
      isUserEdited: false,
      audio_url,
      status: 'auto',
      committed_audio_url: undefined,
      committed_adapted_text: undefined,
      committed_start_time: undefined,
      committed_end_time: undefined,
    }
    updateSegment(selectedSegmentIndex, revertedFields)
    setImportedSegments(prev => {
      if (!prev) return prev
      return prev.map((seg, i) => i === selectedSegmentIndex ? { ...seg, ...revertedFields } : seg)
    })
    setLockedSegments(prev => {
      const next = new Set(prev)
      next.delete(selectedSegmentIndex)
      return next
    })
    setDroppedTranslations(prev => prev.filter(t => t.segmentIndex !== selectedSegmentIndex))
    setStagedSpeeds(prev => { const next = { ...prev }; delete next[selectedSegmentIndex]; return next })
    setStagedEmotions(prev => { const next = { ...prev }; delete next[selectedSegmentIndex]; return next })
  }, [selectedSegmentIndex, initialSegments, jobId, updateSegment, setImportedSegments])

  const handleSave = useCallback(async () => {
    if (isSaving) return
    const toSave = displaySegments
    if (!toSave.length) return
    setIsSaving(true)
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    try {
      await Promise.all(
        toSave.map((seg, i) =>
          // Address by transcript_index (the stable id the commit endpoint matches
          // on) — seg.index is array position and drifts after splits/inserts.
          // `locked` is written for every segment so Save is the authoritative
          // checkpoint for lock state, not just the fire-and-forget per-lock write.
          fetch(`${base}/api/segment/commit/${jobId}/${seg.transcript_index ?? seg.index}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              committed_audio_url: seg.committed_audio_url,
              committed_adapted_text: seg.committed_adapted_text,
              committed_start_time: seg.committed_start_time,
              committed_end_time: seg.committed_end_time,
              flag_status: seg.flag_status,
              correction_type: seg.correction_type,
              locked: lockedSegments.has(i),
              paired_with_next: lockedPairs.has(i),
              // Persist the display text too so a plain edit doesn't revert on
              // reopen — the loader reads `text` back into target/active text.
              text: seg.active_text ?? seg.target_text,
            }),
          })
        )
      )
      // Save project metadata so it appears in My Projects
      await apiClient.saveProject(jobId, {
        title,
        target_language: targetLanguage,
      })
    } finally {
      setIsSaving(false)
    }
  }, [isSaving, displaySegments, jobId, title, targetLanguage, lockedSegments, lockedPairs])

  // Flag outcome helpers — set both flag_status and correction_type together,
  // only on segments that are currently unreviewed and have flags.
  const applyFlagOutcome = useCallback((idx: number, correctionType: 'text' | 'timing' | 'voice' | 'emotion') => {
    const seg = displaySegments[idx]
    if (!seg?.flags?.length || seg.flag_status !== 'unreviewed') return
    updateSegment(idx, { flag_status: 'reviewed_corrected', correction_type: correctionType })
  }, [displaySegments, updateSegment])

  const handleMarkOk = useCallback((idx: number) => {
    updateSegment(idx, { flag_status: 'reviewed_no_change', correction_type: null })
    apiClient.commitSegmentTiming(jobId, displaySegments[idx]?.transcript_index ?? idx, { flag_status: 'reviewed_no_change', correction_type: null })
      .catch(err => console.warn('[REVIEW-QUEUE] mark-ok persist failed:', err))
  }, [jobId, updateSegment, displaySegments])

  const handleRebuildVideo = useCallback(async () => {
    setRebuildError(null)
    setIsRebuilding(true)
    setRebuildStatus('processing')
    setRebuildProgress(0)
    if (rebuildIntervalRef.current) clearInterval(rebuildIntervalRef.current)
    rebuildIntervalRef.current = setInterval(() => {
      setRebuildProgress(prev => Math.min(90, prev + (90 / 56)))
    }, 500)
    try {
      const response = await apiClient.remixDub(jobId)
      if (rebuildIntervalRef.current) clearInterval(rebuildIntervalRef.current)
      setRebuildProgress(100)
      const absUrl = apiClient.toAbsoluteUrl(response.dubbed_video_url)
      setActiveDubbedVideoUrl(absUrl)
      setRebuildStatus('complete')
      clearAllDirty()
      setShowExportModal(true)
      setTimeout(() => setRebuildStatus('idle'), 5000)
      if (videoRef.current) {
        videoRef.current.volume = isMuted ? 0 : masterVolume / 100
      }
      setPlaybackMode('dubbed')
      if (videoRef.current) {
        videoRef.current.load()
        videoRef.current.currentTime = 0
      }
      setCurrentTime(0)
      setTimeout(() => setRebuildProgress(0), 2000)
    } catch (err: any) {
      if (rebuildIntervalRef.current) clearInterval(rebuildIntervalRef.current)
      setRebuildProgress(0)
      setRebuildError(err.message || 'Rebuild failed — please try again')
      setRebuildStatus('error')
      setTimeout(() => setRebuildStatus('idle'), 5000)
    } finally {
      setIsRebuilding(false)
    }
  }, [jobId, setPlaybackMode, setCurrentTime, isMuted, masterVolume, setRebuildStatus, clearAllDirty])

  const handleRetranslate = useCallback(async () => {
    if (isRetranslating) return
    setIsRetranslating(true)
    try {
      const result = await apiClient.retranslateJob(jobId)
      // The backend returns its own segment shape (text/start/end/speaker/
      // segment_id) — not the editor's Segment type (target_text/start_time/
      // end_time/speaker_id/...). Passing it straight into the store left
      // every field the UI reads undefined except what happened to share a
      // name, and speaker_id specifically fell back to a single default
      // color/label for every row. Map it explicitly instead.
      const rawSegs = result.segments as any[]
      if (rawSegs?.length) {
        const priorSegs = displaySegments
        const mapped: Segment[] = rawSegs.map((raw, i) => {
          const origIdx = Number(raw.original_segment_id ?? raw.segment_id ?? i)
          const origSeg = Number.isFinite(origIdx) ? priorSegs[origIdx] : undefined
          const englishText = raw.text ?? raw.translated_text ?? ''
          return {
            ...(origSeg ?? {} as Segment),
            id: raw.auto_split ? `retranslate-${jobId}-${i}` : (origSeg?.id ?? `retranslate-${jobId}-${i}`),
            index: i,
            transcript_index: i,
            status: 'edited',
            start_time: raw.start ?? origSeg?.start_time ?? 0,
            end_time: raw.end ?? origSeg?.end_time ?? 0,
            source_text: raw.source_text || origSeg?.source_text || '',
            target_text: englishText,
            active_text: englishText,
            variant_text: englishText,
            preview_text: null,
            isPreviewing: false,
            isUserEdited: false,
            committed_adapted_text: englishText,
            // Text changed — any previously committed audio/timing no longer
            // matches it and must be regenerated, not silently carried over.
            committed_audio_url: undefined,
            committed_start_time: undefined,
            committed_end_time: undefined,
            speaker_id: raw.speaker || origSeg?.speaker_id || 'speaker-1',
            speaker_label: origSeg?.speaker_label,
            qc_findings: origSeg?.qc_findings ?? [],
          } as Segment
        })
        setImportedSegments(mapped)
      }
      alert(`Re-translation complete — ${result.segments_updated} segments updated. Review the script then Rebuild to generate new audio.`)
    } catch (err: any) {
      alert(`Re-translate failed: ${err.message || 'Unknown error'}`)
    } finally {
      setIsRetranslating(false)
    }
  }, [jobId, isRetranslating, setImportedSegments, displaySegments])

  const handleTimelineDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])
  
  // Start editing a segment — immediately enters preview mode
  const startEditing = useCallback((index: number) => {
    const currentText = displaySegments[index]?.preview_text ?? displaySegments[index]?.committed_adapted_text ?? displaySegments[index]?.active_text ?? displaySegments[index]?.target_text ?? ''
    setEditingSegmentIndex(index)
    setEditingText(currentText)
    // Immediately activate preview so the orange chip + Commit/Cancel appear
    setPreviewText(index, currentText)
    setImportedSegments(prev => {
      const base = prev ?? displaySegments
      return base.map((seg, i) =>
        i === index ? { ...seg, preview_text: currentText, isPreviewing: true } : seg
      )
    })
  }, [displaySegments, setPreviewText])

  // Freeze speaker traits onto segment when editing starts
  useEffect(() => {
    if (editingSegmentIndex !== null) {
      const seg = displaySegments[editingSegmentIndex]
      if (seg && (seg.attached_traits == null) && speakerTraitsMap[seg.speaker_id]?.length) {
        const frozen = [...speakerTraitsMap[seg.speaker_id]]
        setImportedSegments(prev => {
          if (!prev) return prev
          return prev.map((s, i) => i === editingSegmentIndex ? { ...s, attached_traits: frozen } : s)
        })
      }
    }
  }, [editingSegmentIndex, displaySegments, speakerTraitsMap])

  // Save editing — updates preview text while keeping preview mode active
  const saveEditing = useCallback(() => {
    if (editingSegmentIndex !== null) {
      const idx = editingSegmentIndex
      const text = editingText
      // Push pre-edit text onto the global undo stack before applying the change.
      undoStack.current.push({ index: idx, prevText: displaySegments[idx]?.preview_text ?? displaySegments[idx]?.active_text ?? displaySegments[idx]?.target_text ?? '' })
      emotionAutoFiredRef.current.delete(idx)
      setPreviewText(idx, text)
      setImportedSegments(prev => {
        const base = prev ?? displaySegments
        return base.map((seg, i) =>
          i === idx ? { ...seg, preview_text: text } : seg
        )
      })
      // Clear editing state so regenerate uses preview_text, not editingText
      setEditingText('')
      setEditingSegmentIndex(null)
      // Persist edited text to disk so regenerate_segment reads it from committed_adapted_text
      applyFlagOutcome(idx, 'text')
      apiClient.commitSegmentTiming(jobId, displaySegments[idx]?.transcript_index ?? idx, { committed_adapted_text: text }).catch(err =>
        console.warn('[saveEditing] failed to persist text to disk:', err)
      )
      // Auto-regen in Preview mode — 2 second debounce.
      // Call via the ref (latest closure) and pass the edited text explicitly so
      // the regen is immune to the stale displaySegments captured here, which
      // still holds the pre-edit preview_text.
      if (playbackMode === 'preview') {
        if (autoRegenTimerRef.current) clearTimeout(autoRegenTimerRef.current)
        autoRegenTimerRef.current = setTimeout(() => {
          handleGenerateSpeechRef.current(idx, undefined, text)
          autoRegenTimerRef.current = null
        }, 2000)
      }
    }
  }, [editingSegmentIndex, editingText, setPreviewText, displaySegments])

  // Cancel editing
  const cancelEditing = useCallback(() => {
    setEditingSegmentIndex(null)
    setEditingText('')
  }, [])

  // Right-click → Copy Text: put the segment's current dubbed text on the clipboard.
  const handleCopyText = useCallback((index: number) => {
    const seg = displaySegmentsRef.current[index]
    const text = seg?.preview_text ?? seg?.active_text ?? seg?.target_text ?? ''
    if (!navigator.clipboard) { console.warn('[COPY] clipboard API unavailable'); return }
    navigator.clipboard.writeText(text).catch(err => console.warn('[COPY] failed:', err))
  }, [])

  // Right-click → Paste Text: replace the segment's dubbed text with the clipboard
  // contents, applied exactly like an inline text edit (preview_text + persisted
  // committed_adapted_text, undo entry, and a debounced auto-regen in Preview mode).
  const handlePasteText = useCallback(async (index: number) => {
    if (!navigator.clipboard) { console.warn('[PASTE] clipboard API unavailable'); return }
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch (err) {
      console.warn('[PASTE] clipboard read failed (permission?):', err)
      return
    }
    if (text == null) return
    const segs = displaySegmentsRef.current
    undoStack.current.push({ index, prevText: segs[index]?.preview_text ?? segs[index]?.active_text ?? segs[index]?.target_text ?? '' })
    emotionAutoFiredRef.current.delete(index)
    setPreviewText(index, text)
    setImportedSegments(prev => {
      const base = prev ?? displaySegmentsRef.current
      return base.map((seg, i) => i === index ? { ...seg, preview_text: text } : seg)
    })
    applyFlagOutcome(index, 'text')
    const ti = segs[index]?.transcript_index ?? index
    apiClient.commitSegmentTiming(jobId, ti, { committed_adapted_text: text }).catch(err =>
      console.warn('[PASTE] failed to persist text:', err)
    )
    if (playbackMode === 'preview') {
      if (autoRegenTimerRef.current) clearTimeout(autoRegenTimerRef.current)
      autoRegenTimerRef.current = setTimeout(() => {
        handleGenerateSpeechRef.current(index, undefined, text)
        autoRegenTimerRef.current = null
      }, 2000)
    }
  }, [setPreviewText, jobId, playbackMode])

  // Drag-to-reorder refs to avoid stale closures in mousemove
  const dragReorderRef = useRef<{ fromIndex: number; toIndex: number | null; isDragging: boolean } | null>(null)

  const handleRowDragStart = useCallback((fromIndex: number) => {
    const state = { fromIndex, toIndex: null, isDragging: true }
    dragReorderRef.current = state
    setDragReorder(state)
  }, [])

  const handleRowDragMove = useCallback((clientX: number, clientY: number) => {
    const drag = dragReorderRef.current
    if (!drag?.isDragging) return
    // Scan all elements under cursor to find the row
    const els = document.elementsFromPoint(clientX, clientY)
    const row = els.find(el => el.closest?.('[data-segment-row]')) as HTMLElement | undefined
    if (row) {
      const toIndex = parseInt(row.closest('[data-segment-row]')?.getAttribute('data-index') || '-1', 10)
      if (toIndex >= 0 && toIndex !== drag.toIndex) {
        dragReorderRef.current = { ...drag, toIndex }
        setDragReorder(prev => prev ? { ...prev, toIndex } : null)
      }
    }
  }, [])

  const handleRowDragEnd = useCallback(() => {
    const drag = dragReorderRef.current
    if (!drag?.isDragging || drag.toIndex === null) {
      dragReorderRef.current = null
      setDragReorder(null)
      return
    }
    const from = drag.fromIndex
    const to = drag.toIndex
    if (from !== to) {
      setImportedSegments(prev => {
        const base = prev ?? displaySegments
        const newArr = [...base]
        const [removed] = newArr.splice(from, 1)
        newArr.splice(to, 0, removed)
        return newArr
      })
    }
    dragReorderRef.current = null
    setDragReorder(null)
  }, [displaySegments])
  
  const LANGUAGE_LIST: { code: string; label: string }[] = [
    { code: 'yue', label: 'Cantonese (YUE)' },
    { code: 'zh',  label: 'Mandarin (ZH)' },
    { code: 'en',  label: 'English (EN)' },
    { code: 'es',  label: 'Spanish (ES)' },
    { code: 'fr',  label: 'French (FR)' },
    { code: 'de',  label: 'German (DE)' },
    { code: 'ja',  label: 'Japanese (JA)' },
    { code: 'ko',  label: 'Korean (KO)' },
    { code: 'vi',  label: 'Vietnamese (VI)' },
    { code: 'th',  label: 'Thai (TH)' },
    { code: 'hi',  label: 'Hindi (HI)' },
    { code: 'gu',  label: 'Gujarati (GU)' },
    { code: 'ta',  label: 'Tamil (TA)' },
    { code: 'ar',  label: 'Arabic (AR)' },
    { code: 'pt',  label: 'Portuguese (PT)' },
    { code: 'ru',  label: 'Russian (RU)' },
    { code: 'it',  label: 'Italian (IT)' },
    { code: 'id',  label: 'Indonesian (ID)' },
    { code: 'ms',  label: 'Malay (MS)' },
    { code: 'tr',  label: 'Turkish (TR)' },
  ]

  // Get language display name
  const getLanguageName = (code: string) => {
    return LANGUAGE_LIST.find(l => l.code === code)?.label ?? code
  }
  
  const EMOTIONS = ['Neutral', 'Happy', 'Excited', 'Calm', 'Sad', 'Angry', 'Fearful', 'Surprised', 'Disgusted', 'Professional', 'Casual', 'Formal', 'Intimate', 'Defiant', 'Confused', 'Whisper', 'Shout', 'Sarcastic', 'Hopeful', 'Melancholic']
  // What each pill actually asks the voice to do — shown to the user so they can
  // choose informed. Mirrors _S2_EMOTION_STYLE in the backend (dubbing_service.py).
  const EMOTION_DESCRIPTIONS: Record<string, string> = {
    Neutral: 'No steering — plain, natural read',
    Happy: 'Warm and bright, lightly smiling tone',
    Excited: 'Breathless and eager, rising pitch with building anticipation',
    Calm: 'Slow and steady, soft soothing tone',
    Sad: 'Heavy and subdued, downward trailing endings',
    Angry: 'Tense and forceful, clipped hard delivery',
    Fearful: 'Shaky and hushed, quick uneven breaths',
    Surprised: 'Sudden sharp rise in pitch, wide-eyed disbelief',
    Disgusted: 'Recoiling, curled sneering tone',
    Professional: 'Clear, measured and confident broadcast tone',
    Casual: 'Relaxed and easygoing, conversational',
    Formal: 'Poised and precise, controlled cadence',
    Intimate: 'Soft and close, gentle breathy warmth',
    Defiant: 'Firm and unyielding, chin-up challenging tone',
    Confused: 'Hesitant and searching, inquisitive rising ending',
    Whisper: 'Hushed whisper in a small voice',
    Shout: 'Loud and projected, urgent force',
    Sarcastic: 'Dry and mocking, exaggerated flat delivery',
    Hopeful: 'Gentle rising pitch, warm anticipation',
    Melancholic: 'Wistful and slow, trailing pensive endings',
  }
  const VOICE_OPTIONS = [
    { key: 'male-1',   label: 'Male 1'   },
    { key: 'male-2',   label: 'Male 2'   },
    { key: 'female-1', label: 'Female 1' },
    { key: 'child-1',  label: 'Child 1'  },
  ]

  // Timeline constants
  const TRACK_HEIGHT = 48
  const PIXELS_PER_SECOND = 40 * zoomLevel
  const timelineWidth = videoDuration * PIXELS_PER_SECOND

  // Find pending segment count
  const pendingCount = displaySegments.filter(s =>
    s.qc_findings?.some(f => f.severity === 'error' || f.severity === 'warning')
  ).length
  
  return (
    <div
      ref={editorContainerRef}
      tabIndex={0}
      className="h-screen flex flex-col bg-black text-white outline-none"
    >
      {/* Rebuild status banner */}
      {(rebuildStatus === 'processing' || rebuildStatus === 'complete' || rebuildStatus === 'error') && (
        <div
          className={cn(
            "fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-3 py-4",
            "text-sm font-black tracking-widest uppercase select-none",
            rebuildStatus === 'processing' && "bg-red-600 text-white animate-pulse shadow-[0_6px_32px_rgba(239,68,68,0.9)]",
            rebuildStatus === 'complete' && "bg-emerald-600 text-white shadow-[0_6px_32px_rgba(16,185,129,0.9)]",
            rebuildStatus === 'error' && "bg-red-900 text-red-200 shadow-[0_6px_32px_rgba(239,68,68,0.6)]",
          )}
        >
          {rebuildStatus === 'processing' && <RefreshCw className="h-5 w-5 animate-spin" />}
          {rebuildStatus === 'complete' && <Check className="h-5 w-5" />}
          {rebuildStatus === 'error' && <X className="h-5 w-5" />}
          <span>
            {rebuildStatus === 'processing' && 'REBUILD IN PROGRESS'}
            {rebuildStatus === 'complete' && 'REBUILD COMPLETE — DUBBED VIDEO UPDATED'}
            {rebuildStatus === 'error' && (rebuildError?.toUpperCase() || 'REBUILD FAILED — PLEASE TRY AGAIN')}
          </span>
          {rebuildStatus !== 'processing' && (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setRebuildStatus('idle')}
              className="absolute right-5 opacity-70 hover:opacity-100 transition-opacity"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      )}
      {/* Header */}
      <header className="relative flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-900">
        <span className="absolute left-1/2 -translate-x-1/2 text-xs font-mono text-amber-400 select-all">
          {jobId}
        </span>
        <div className="flex items-center gap-4">
          {/* Logo */}
          <Link href="/studio" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <span className="text-white font-bold text-sm">D</span>
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-lg text-white">DubMaster</span>
              {(isProfessional || isPremium) && (
                <span className="text-xs font-semibold uppercase tracking-wide text-cyan-400">
                  {isProfessional ? 'Professional' : 'Premium'}
                </span>
              )}
            </div>
          </Link>
          
          {/* Nav */}
          <nav className="hidden md:flex items-center gap-1 ml-4">
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white" onClick={() => router.push('/dashboard')}>Dashboard</Button>
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white" onClick={() => router.push('/studio?tab=projects')}>My Projects</Button>
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white" onClick={() => router.push('/collaborate')}>Collaborate</Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'text-slate-400 hover:text-white',
                rightPanelTab === 'library' && 'bg-slate-800 text-white'
              )}
              onClick={() => setRightPanelTab('library')}
            >
              Voice Library
            </Button>
            <Button variant="ghost" size="sm" className="bg-slate-800 text-white">Editor</Button>
          </nav>
        </div>
        
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "text-xs gap-1.5",
              layoutLocked
                ? "text-amber-400 bg-amber-400/10 hover:bg-amber-400/20 hover:text-amber-300"
                : "text-slate-400 hover:text-white"
            )}
            onClick={toggleLayoutLock}
            title={layoutLocked ? "Layout locked - click to unlock" : "Click to lock layout"}
          >
            {layoutLocked ? (
              <>
                <Lock className="h-3.5 w-3.5" />
                <span>Locked</span>
              </>
            ) : (
              <>
                <Unlock className="h-3.5 w-3.5" />
                <span>Lock Layout</span>
              </>
            )}
          </Button>
          {/* Language selector */}
          <LanguageSwitcher />
          <Bell className="h-5 w-5 text-slate-400" />
          <Link href="/account" className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center hover:opacity-80 transition-opacity" title="Account">
            <span className="text-sm font-medium text-white">{userInitials}</span>
          </Link>
        </div>
      </header>
      
      {/* Sub-header with project info */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-900/90">
        <div className="flex items-center gap-3">
          <Link href="/studio">
            <Button variant="ghost" size="sm" className="h-8 text-slate-400">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-sm font-medium truncate max-w-[300px]">{title}</h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Points display - compact badge style */}
          <div className="flex items-center gap-2 bg-slate-800/50 rounded-md px-2.5 py-1 border border-slate-700/50">
            <div className="flex items-center gap-1">
              <span className="text-amber-400 font-semibold text-sm">{pointsLeft}</span>
              <span className="text-slate-500 text-xs">pts</span>
            </div>
            <div className="w-px h-4 bg-slate-600" />
            <div className="flex items-center gap-1">
              <span className="text-slate-300 font-medium text-sm">{minutesAvailable}</span>
              <span className="text-slate-500 text-xs">min</span>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-8" onClick={handleGlobalUndo} title="Undo last edit">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Popover onOpenChange={() => setShareCopied(null)}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8">
                <Share2 className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 bg-slate-900 border-slate-700 p-4 space-y-4">
              <p className="text-sm font-semibold text-white flex items-center gap-2">
                <Share2 className="h-4 w-4 text-amber-400" />
                Share Project
              </p>

              {/* Editor link */}
              <div className="space-y-1.5">
                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Editor link</p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    aria-label="Editor link"
                    value={typeof window !== 'undefined' ? window.location.href : ''}
                    className="flex-1 text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-300 truncate focus:outline-none"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn(
                      "h-7 px-2 text-xs border-slate-700 shrink-0 transition-colors",
                      shareCopied === 'link' ? "text-emerald-400 border-emerald-500/40" : "text-slate-300"
                    )}
                    onClick={() => {
                      navigator.clipboard.writeText(window.location.href)
                      setShareCopied('link')
                      setTimeout(() => setShareCopied(null), 2000)
                    }}
                  >
                    {shareCopied === 'link' ? <Check className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
                  </Button>
                </div>
              </div>

              {/* Dubbed video */}
              {activeDubbedVideoUrl ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Dubbed video</p>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      aria-label="Dubbed video link"
                      value={activeDubbedVideoUrl}
                      className="flex-1 text-xs bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-300 truncate focus:outline-none"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className={cn(
                        "h-7 px-2 text-xs border-slate-700 shrink-0 transition-colors",
                        shareCopied === 'video' ? "text-emerald-400 border-emerald-500/40" : "text-slate-300"
                      )}
                      onClick={() => {
                        navigator.clipboard.writeText(activeDubbedVideoUrl)
                        setShareCopied('video')
                        setTimeout(() => setShareCopied(null), 2000)
                      }}
                    >
                      {shareCopied === 'video' ? <Check className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs border-slate-700 text-slate-300 shrink-0"
                      asChild
                    >
                      <a href={activeDubbedVideoUrl} download title="Download dubbed video" target="_blank" rel="noreferrer">
                        <Download className="h-3 w-3" />
                      </a>
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-600 italic">No dubbed video yet — rebuild to generate one.</p>
              )}

              {/* Social share */}
              <div className="space-y-1.5 pt-1 border-t border-slate-800">
                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">Share to</p>
                <div className="flex gap-2">
                  {/* Facebook */}
                  <button
                    type="button"
                    title="Share to Facebook"
                    className="flex-1 flex flex-col items-center gap-1 py-2 rounded-lg bg-[#1877F2] hover:bg-[#1565C0] text-white transition-colors"
                    onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '')}`, '_blank', 'width=600,height=400')}
                  >
                    <Facebook className="h-4 w-4" />
                    <span className="text-[9px] font-medium">Facebook</span>
                  </button>
                  {/* Twitter / X */}
                  <button
                    type="button"
                    title="Share to X (Twitter)"
                    className="flex-1 flex flex-col items-center gap-1 py-2 rounded-lg bg-black hover:bg-neutral-800 text-white transition-colors"
                    onClick={() => window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '')}&text=${encodeURIComponent(`Check out my dubbed video — ${title}`)}`, '_blank', 'width=600,height=400')}
                  >
                    <Twitter className="h-4 w-4" />
                    <span className="text-[9px] font-medium">X / Twitter</span>
                  </button>
                  {/* YouTube — download video then open YouTube Studio */}
                  <button
                    type="button"
                    title="Download for YouTube"
                    className="flex-1 flex flex-col items-center gap-1 py-2 rounded-lg bg-[#FF0000] hover:bg-[#CC0000] text-white transition-colors"
                    onClick={() => {
                      if (activeDubbedVideoUrl) {
                        const a = document.createElement('a')
                        a.href = activeDubbedVideoUrl
                        a.download = `${title || 'dubbed_video'}.mp4`
                        a.click()
                      }
                      window.open('https://studio.youtube.com/channel/upload', '_blank')
                    }}
                  >
                    <Youtube className="h-4 w-4" />
                    <span className="text-[9px] font-medium">YouTube</span>
                  </button>
                  {/* Instagram — download video (no web upload API) */}
                  <button
                    type="button"
                    title="Download for Instagram"
                    className="flex-1 flex flex-col items-center gap-1 py-2 rounded-lg bg-gradient-to-br from-[#833AB4] via-[#E1306C] to-[#F77737] hover:opacity-90 text-white transition-opacity"
                    onClick={() => {
                      if (activeDubbedVideoUrl) {
                        const a = document.createElement('a')
                        a.href = activeDubbedVideoUrl
                        a.download = `${title || 'dubbed_video'}.mp4`
                        a.click()
                      }
                    }}
                  >
                    <Instagram className="h-4 w-4" />
                    <span className="text-[9px] font-medium">Instagram</span>
                  </button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-slate-700 hover:bg-slate-800"
            onClick={() => videoInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-1" />
            Import Video
          </Button>
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleVideoImport}
          />
          <VideoRecorder
            onFileCaptured={(file) => {
              const url = URL.createObjectURL(file)
              setImportedVideoUrl(url)
              setImportedVideoFile(file)
            }}
            maxSeconds={recordingLimit}
            triggerClassName="flex items-center gap-1.5 h-8 px-3 text-sm border border-slate-700 rounded-md hover:bg-slate-800 text-slate-200 transition-colors"
            triggerLabel="Record"
          />
          
          {/* Advanced menu for Import Transcript and Add Segment */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-slate-700 hover:bg-slate-800"
              >
                <Settings className="h-4 w-4 mr-1" />
                Advanced
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-slate-900 border-slate-700">
              {hasFeature('reviewQueue') && (() => {
                const unreviewedCount = displaySegments.filter(s => s.flags?.length && s.flag_status === 'unreviewed').length
                return (
                  <DropdownMenuItem
                    onClick={() => setShowReviewQueue(true)}
                    className="cursor-pointer hover:bg-slate-800"
                  >
                    <AlertTriangle className="h-4 w-4 mr-2 text-amber-400" />
                    <span className="flex-1">Review Queue</span>
                    {unreviewedCount > 0 && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                        {unreviewedCount}
                      </span>
                    )}
                  </DropdownMenuItem>
                )
              })()}
              <DropdownMenuItem
                onClick={() => transcriptInputRef.current?.click()}
                className="cursor-pointer hover:bg-slate-800"
              >
                <FileText className="h-4 w-4 mr-2" />
                Import Transcript
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/transcript/export/${jobId}`
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `transcript_${jobId.slice(0, 8)}.srt`
                  a.click()
                }}
                className="cursor-pointer hover:bg-slate-800"
              >
                <Download className="h-4 w-4 mr-2" />
                Download Transcript
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setShowAddSegment(true)}
                className="cursor-pointer hover:bg-slate-800"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Segment
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleRetranslate}
                disabled={isRetranslating}
                className="cursor-pointer hover:bg-slate-800"
              >
                <RefreshCw className={cn("h-4 w-4 mr-2", isRetranslating && "animate-spin")} />
                {isRetranslating ? 'Re-translating…' : 'Re-translate Script'}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setShowRevertAllConfirm(true)}
                className="cursor-pointer hover:bg-red-950/50 text-red-400"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear Editor
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={transcriptInputRef}
            type="file"
            accept=".srt,.vtt"
            className="hidden"
            onChange={handleTranscriptImport}
          />
          <Button
            size="sm"
            className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            size="sm"
            className="h-8 bg-violet-600 hover:bg-violet-700 text-white font-medium"
            onClick={() => router.push('/subscribe')}
          >
            <Sparkles className="h-4 w-4 mr-1" />
            Upgrade
          </Button>
          <Button
            size="sm"
            className="h-8 bg-amber-500 hover:bg-amber-600 text-black font-medium"
            onClick={() => setShowExportModal(true)}
          >
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
          <Link href="/profile">
            <Button variant="ghost" size="sm" className="h-8" title="Profile">
              <User className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
      
      {/* Main content */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* Transcript area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {/* Transcript header */}
          <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-800">
            <Select defaultValue="all">
              <SelectTrigger className="w-16 h-8 bg-slate-800 border-slate-700">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="errors">Errors</SelectItem>
                <SelectItem value="warnings">Warnings</SelectItem>
              </SelectContent>
            </Select>
            {/* Source language selector */}
            <Select value={activeSrcLang} onValueChange={setActiveSrcLang}>
              <SelectTrigger className="w-44 h-8 bg-slate-800 border-slate-700 text-slate-200 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72 overflow-y-auto">
                {LANGUAGE_LIST.map(l => (
                  <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex-1 flex items-center justify-center min-w-0">
              <QCTicker
                segment={selectedSegmentIndex !== null ? displaySegments[selectedSegmentIndex] : null}
                onApplyFix={() => {
                  if (selectedSegmentIndex === null) return
                  const seg = displaySegments[selectedSegmentIndex]
                  if (!seg?.qc_findings?.length) return
                  const worst = [...seg.qc_findings].sort((a, b) => {
                    const rank: Record<string, number> = { error: 0, warning: 1, info: 2 }
                    return (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2)
                  })[0]
                  if (!worst) return
                  const retranscriptionText = worst.type === 'pronunciation'
                    ? qcReport?.retranscription.items.find(
                        item => Math.abs(item.start - worst.timestamp_start) < 1
                      )?.text
                    : undefined
                  const fixResult = applyQCFix(worst, seg, { retranscriptionText })
                  if (fixResult) updateSegment(selectedSegmentIndex, fixResult.patch)
                  setCurrentTime(worst.timestamp_start)
                  setRightPanelTab('quality')
                }}
              />
            </div>
            {/* Target language selector */}
            <Select
              value={activeTgtLang}
              onValueChange={async (val) => {
                setActiveTgtLang(val)
                try { await apiClient.saveProject(jobId, { target_language: val }) } catch {}
              }}
            >
              <SelectTrigger className="w-44 h-8 bg-slate-800 border-slate-700 text-slate-200 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72 overflow-y-auto">
                {LANGUAGE_LIST.map(l => (
                  <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
{/* Transcription status */}
          {isTranscribing && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
              <div className="w-12 h-12 border-4 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
              <div className="text-center">
                <p className="text-lg font-medium text-white">Transcribing video...</p>
                <p className="text-sm text-neutral-400 mt-1">This may take a few moments depending on video length</p>
              </div>
            </div>
          )}
          
          {/* Transcription error */}
          {transcriptionError && !isTranscribing && (
            <div className="px-4 py-3 bg-red-500/10 border-b border-red-500/30 flex items-center gap-2">
              <X className="h-4 w-4 text-red-400" />
              <span className="text-sm text-red-200">{transcriptionError}</span>
            </div>
          )}
          
          {/* Empty state - no segments */}
          {!isTranscribing && !transcriptionError && displaySegments.length === 0 && (
            <div
              className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center cursor-pointer hover:bg-slate-800/40 transition-colors rounded-lg"
              onClick={() => videoInputRef.current?.click()}
            >
              <Upload className="h-12 w-12 text-[#A855F7]" />
              <div>
                <p className="text-lg font-medium text-neutral-300">Click to upload a video</p>
                <p className="text-sm text-neutral-500 mt-1">Select a video file to upload and automatically transcribe it</p>
              </div>
            </div>
          )}
          
          {/* Transcript rows - scrollable up/down */}
          {!isTranscribing && displaySegments.length > 0 && (
          <ScrollArea className="flex-1 overflow-auto relative">
          {displaySegments.map((segment, index) => {
              const speakerColor = getSpeakerColor(segment.speaker_id)
              const isEditing = editingSegmentIndex === index
              const hasQCFindings = (segment.qc_findings?.length ?? 0) > 0
              const segmentSuggestions = suggestions[index] || []
                  const isAssignmentPulse = speakerPulseId !== null && segment.speaker_id === speakerPulseId
              
              return (
                <SegmentContextMenu
                  key={segment.id}
                  index={index}
                  lockedSegments={lockedSegments}
                  lockedPairs={lockedPairs}
                  stagedEmotions={stagedEmotions}
                  emotions={EMOTIONS}
                  onSelect={(idx) => { selectSegment(idx); setContextSegmentIndex(idx) }}
                  onSplit={handleSplitAtPlayhead}
                  onSplitAtWord={(idx) => setSplitWordMode(idx)}
                  onAddAfter={handleAddSegmentAfter}
                  onMerge={handleMergeWithNext}
                  canMergeNext={canMergeWithNext(index)}
                  onDelete={(idx) => setPendingDelete(idx)}
                  onToggleLock={(idx) => setSegmentLocked(idx, !lockedSegments.has(idx))}
                  onTogglePair={togglePairWithNext}
                  onRevert={() => handleRevert()}
                  onUndoLastEdit={handleUndoLastEdit}
                  onCopyText={handleCopyText}
                  onPasteText={handlePasteText}
                  onClearSegment={handleClearSegment}
                  onSetEmotion={(idx, emotion) => setStagedEmotions(prev => ({ ...prev, [idx]: emotion }))}
                  onClearEmotion={(idx) => {
                    setStagedEmotions(prev => ({ ...prev, [idx]: '' }))
                    updateSegment(idx, { committed_emotion: null })
                    setImportedSegments(prev => {
                      if (!prev) return prev
                      return prev.map((seg, i) => i === idx ? { ...seg, committed_emotion: null } : seg)
                    })
                  }}
                  onRenameSpeaker={(idx) => {
                    const spkId = displaySegments[idx]?.speaker_id
                    if (!spkId) return
                    setRenamingSpeakerId(spkId)
                    setRenameValue(displaySegments[idx]?.speaker_label || `Speaker ${speakerNumberMap[spkId] ?? 1}`)
                  }}
                  onShowProfile={(idx, x, y) => setCharacterProfileOpen({ segmentIndex: idx, x, y })}
                  onGroupSelect={enterGroupSelectMode}
                  onClearGroup={clearGroupSelection}
                  groupSelectActive={groupSelectMode || groupSelectedSegments.size > 0}
                >
                <div
                  data-segment-row
                  data-index={index}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 border-b border-slate-800/50 transition-colors relative group',
                    selectedSegmentIndex === index && 'bg-slate-800/50 ring-2 ring-amber-400/70 shadow-[0_0_8px_2px_rgba(251,191,36,0.4)] animate-pulse',
                    isAssignmentPulse && 'ring-2 ring-amber-400/60 shadow-[0_0_6px_2px_rgba(245,158,11,0.22)] animate-pulse',
                    dragReorder?.fromIndex === index && 'opacity-50 bg-amber-500/10',
                    dragReorder?.toIndex === index && 'border-t-2 border-t-amber-500',
                    draggedVoice !== null && 'ring-1 ring-cyan-500/40',
                    voiceDragOverIndex === index && 'ring-2 ring-emerald-500 bg-emerald-500/10 animate-pulse cursor-copy',
                    confirmingSegmentIndex === index && 'ring-2 ring-amber-400/70 shadow-[0_0_8px_2px_rgba(251,191,36,0.4)] animate-[pulse_0.35s_ease-in-out_2]',
                    (queuedSegmentIndex === index || speakerRegenQueue.has(index)) && 'ring-1 ring-cyan-400/60',
                  )}
                  onClick={() => {
                    selectSegment(index)
                    setCurrentTime(displaySegments[index].start_time)
                    if (videoRef.current) videoRef.current.currentTime = displaySegments[index].start_time
                    editorContainerRef.current?.focus()
                  }}
                  onDragEnter={(e) => {
                    const types = Array.from(e.dataTransfer.types || [])
                    const hasVoicePayload = types.length === 0 || types.some((type) =>
                      type === 'application/x-voice-payload' || type === 'voice_key' || type === 'text/plain'
                    )
                    if (hasVoicePayload) {
                      e.preventDefault()
                      setVoiceDragOverIndex(index)
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setVoiceDragOverIndex(prev => prev === index ? null : prev)
                    }
                  }}
                  onDragOver={(e) => {
                    const types = Array.from(e.dataTransfer.types || [])
                    const hasVoicePayload = types.length === 0 || types.some((type) =>
                      type === 'application/x-voice-payload' || type === 'voice_key' || type === 'text/plain'
                    )
                    if (hasVoicePayload) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'copy'
                      setVoiceDragOverIndex(index)
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    setVoiceDragOverIndex(null)
                    const payload = e.dataTransfer.getData('application/x-voice-payload')
                    console.log('[VOICE-DROP] onDrop fired', { index, payload, types: Array.from(e.dataTransfer.types) })
                    if (payload) {
                      try {
                        const parsed = JSON.parse(payload) as { voice_id: string; name: string }
                        console.log('[VOICE-DROP] parsed payload', parsed)
                        if (parsed.voice_id) {
                          const speakerId = displaySegments[index]?.speaker_id
                          setStagedVoices(prev => ({ ...prev, [index]: parsed.voice_id }))
                          if (speakerId) {
                            setSpeakerVoiceMap(prev => ({ ...prev, [speakerId]: parsed.voice_id }))
                            setStagedVoices(prev => {
                              const next = { ...prev }
                              displaySegments.forEach((seg, i) => {
                                if (seg.speaker_id === speakerId && i !== index) delete next[i]
                              })
                              return next
                            })
                          }
                          selectSegment(index)
                          setCurrentTime(displaySegments[index].start_time)
                          if (speakerId) {
                            applyVoiceToSpeaker(speakerId, parsed.voice_id)
                          } else {
                            handleGenerateSpeech(index, parsed.voice_id)
                          }
                        } else {
                          console.warn('[VOICE-DROP] payload missing voice_id', parsed)
                        }
                      } catch (err) {
                        console.error('[VOICE-DROP] payload parse failed', err)
                      }
                      return
                    }
                    const fallbackVoiceId = e.dataTransfer.getData('text/plain')
                    const vk = draggedVoice ?? e.dataTransfer.getData('voice_key') ?? fallbackVoiceId
                    if (!vk) return
                    const speakerId = displaySegments[index]?.speaker_id
                    setStagedVoices(prev => ({ ...prev, [index]: vk }))
                    if (speakerId) {
                      setSpeakerVoiceMap(prev => ({ ...prev, [speakerId]: vk }))
                      setStagedVoices(prev => {
                        const next = { ...prev }
                        displaySegments.forEach((seg, i) => {
                          if (seg.speaker_id === speakerId && i !== index) delete next[i]
                        })
                        return next
                      })
                    }
                    selectSegment(index)
                    setCurrentTime(displaySegments[index].start_time)
                    setPitchPopupPos({
                      x: Math.max(20, window.innerWidth / 2 - 160),
                      y: Math.max(20, window.innerHeight / 2 - 120),
                    })
                    setPitchPopupIndex(index)
                    setDraggedVoice(null)
                    setVoicePaletteOpen(false)
                  }}
                >
                  {voiceDragOverIndex === index && (
                    <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/30 text-emerald-100 shadow-[0_0_24px_rgba(16,185,129,0.8)] animate-bounce ring-2 ring-emerald-400/80">
                      <ArrowDownCircle className="h-8 w-8" />
                    </div>
                  )}
                  {voiceAppliedFeedback?.segmentIndex === index && (
                    <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/30 text-emerald-100 border border-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.6)] text-xs font-bold animate-[pulse_0.6s_ease-in-out_3]">
                      <span className="text-base leading-none">✓</span>
                      <span>{voiceAppliedFeedback.voiceName}</span>
                    </div>
                  )}
                  {segment.id?.startsWith('new-') && !segment.committed_audio_url && (
                    <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-1 rounded-l bg-emerald-500" />
                  )}
                  {segment.id?.startsWith('new-') && !segment.committed_audio_url && (
                    <span className="absolute top-1 left-3 text-[9px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/15 border border-emerald-500/40 px-1.5 py-0.5 rounded pointer-events-none">
                      NEW
                    </span>
                  )}
                  {/* Speaker drag handle + dropdown */}
                  <div className="flex items-center gap-1">
                    <div
                      className={cn(
                        "cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-400",
                        dragReorder?.fromIndex === index && "text-amber-400"
                      )}
                      title="Drag to reorder speaker"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        handleRowDragStart(index)
                        const onMove = (ev: MouseEvent) => handleRowDragMove(ev.clientX, ev.clientY)
                        const onUp = () => {
                          handleRowDragEnd()
                          document.removeEventListener('mousemove', onMove)
                          document.removeEventListener('mouseup', onUp)
                        }
                        document.addEventListener('mousemove', onMove)
                        document.addEventListener('mouseup', onUp)
                      }}
                    >
                      <GripHorizontal className="h-4 w-4" />
                    </div>
                    {/* Speaker chip / dropdown — click to reassign */}
                    {renamingSpeakerId === segment.speaker_id ? (
                      <div className={cn('flex items-center gap-2 px-5 py-2 rounded-full border text-sm font-semibold shrink-0', speakerColor.bg, speakerColor.text, speakerColor.border)}>
                        <input
                          autoFocus
                          aria-label={`Rename speaker ${speakerNumberMap[segment.speaker_id] ?? 1}`}
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitSpeakerRename(segment.speaker_id, renameValue)
                            if (e.key === 'Escape') { setRenamingSpeakerId(null); setRenameValue('') }
                          }}
                          onBlur={() => commitSpeakerRename(segment.speaker_id, renameValue)}
                          className="bg-transparent outline-none w-20 border-b border-current"
                          onClick={e => e.stopPropagation()}
                        />
                      </div>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <div
                            className={cn('flex items-center px-5 py-2 rounded-full border text-sm font-semibold shrink-0 cursor-pointer', speakerColor.bg, speakerColor.text, speakerColor.border)}
                            onClick={(e) => e.stopPropagation()}
                            title="Click to reassign speaker"
                          >
                            <span>{segment.speaker_label && !/^\d+$/.test(segment.speaker_label) ? segment.speaker_label : `speaker-${speakerNumberMap[segment.speaker_id] ?? 1}`}</span>
                          </div>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-44 bg-slate-900 border-slate-700">
                          {[1, 2, 3, 4, 5].map(n => {
                            const spkId = `speaker-${n}`
                            const spkColor = getSpeakerColor(spkId)
                            const existing = uniqueSpeakers.find(s => s.id === spkId)
                            const label = existing?.label || `Speaker ${n}`
                            return (
                              <DropdownMenuItem
                                key={spkId}
                                onClick={() => {
                                  if (spkId === segment.speaker_id) return
                                  const newLabel = existing?.label || `Speaker ${n}`
                                  updateSegmentSpeaker(index, spkId, newLabel)
                                  if (importedSegments !== null) {
                                    setImportedSegments(prev => {
                                      if (!prev) return prev
                                      const next = [...prev]
                                      next[index] = { ...next[index], speaker_id: spkId, speaker_label: newLabel }
                                      return next
                                    })
                                  }
                                  apiClient.reassignSpeaker(jobId, index, spkId).catch(() => {})
                                }}
                                className={cn(
                                  'cursor-pointer text-slate-200 focus:bg-slate-700 focus:text-white',
                                  spkId === segment.speaker_id && 'bg-slate-700/50'
                                )}
                              >
                                <span className={cn('w-2.5 h-2.5 rounded-full border shrink-0', spkColor.bg, spkColor.border)} />
                                <span>{label}</span>
                              </DropdownMenuItem>
                            )
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  
                  {/* Source text */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-400">{segment.source_text}</p>
                  </div>

                  {/* Target text (editable) */}
                  <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    {isEditing ? (
                      <div
                        className="flex items-center gap-2 rounded-lg p-1.5 border-2 border-amber-400/80 bg-amber-500/10 shadow-[0_0_0_3px_rgba(251,191,36,0.15),0_0_20px_rgba(251,191,36,0.35)]"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => { if ((e.target as HTMLElement).tagName === 'INPUT') e.stopPropagation() }}
                        onMouseUp={(e) => { if ((e.target as HTMLElement).tagName === 'INPUT') e.stopPropagation() }}
                      >
                        <Input
                          value={editingText}
                          placeholder="Enter text…"
                          onChange={(e) => {
                            setEditingText(e.target.value)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditing()
                            if (e.key === 'Escape') cancelEditing()
                            e.stopPropagation()
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onMouseUp={(e) => e.stopPropagation()}
                          onFocus={(e) => {
                            const len = e.target.value.length
                            e.target.setSelectionRange(len, len)
                          }}
                          className="flex-1 h-8 bg-transparent border-amber-400/40 text-white focus-visible:ring-1 focus-visible:ring-amber-400/60 focus-visible:border-amber-400"
                          autoFocus
                        />
                        <Button size="sm" className="h-7 w-7 p-0" onClick={saveEditing}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                          setEditingSegmentIndex(null)
                        }}>
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handlePreviewSpeech(index)}>
                          <Play className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Emotion tag chip — shows the exact tag that will be sent to TTS */}
                        {stagedEmotions[index] ? (() => {
                          // Compact a long custom emotion to a one-word pill; full text on hover.
                          const full = stagedEmotions[index].toLowerCase()
                          const firstWord = full.split(/[\s,]+/).filter(Boolean)[0] ?? full
                          const label = full.length > firstWord.length ? `${firstWord}…` : full
                          return (
                          <span
                            className="inline-flex items-center gap-1 max-w-[9rem] text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-mono cursor-pointer hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/30 transition-colors group"
                            title={`(${full}) — click to remove`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setStagedEmotions(prev => ({ ...prev, [index]: '' }))
                              updateSegment(index, { committed_emotion: null })
                              setImportedSegments(prev => {
                                if (!prev) return prev
                                return prev.map((seg, i) => i === index ? { ...seg, committed_emotion: null } : seg)
                              })
                            }}
                          >
                            ({label})
                            <X className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </span>
                          )
                        })() : (
                          <span
                            className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full text-slate-600 border border-slate-800 hover:text-violet-400 hover:border-violet-500/30 transition-colors cursor-pointer select-none"
                            title="Set emotion for this segment"
                            onClick={(e) => {
                              e.stopPropagation()
                              selectSegment(null)
                              setSplitWordMode(null)
                              setInlineEmotionPicker(prev => prev === index ? null : index)
                            }}
                          >
                            <Plus className="h-2 w-2" />emotion
                          </span>
                        )}
                        {/* Write-in chip — always visible; opens free-form custom emotion input */}
                        <span
                          className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full text-slate-600 border border-slate-800 hover:text-cyan-400 hover:border-cyan-500/30 transition-colors cursor-pointer select-none"
                          title="Write a custom emotion descriptor"
                          onClick={(e) => {
                            e.stopPropagation()
                            selectSegment(null)
                            setSplitWordMode(null)
                            setInlineEmotionPicker(null)
                            setInlineEmotionWriteIn(prev => prev === index ? null : index)
                          }}
                        >
                          <Plus className="h-2 w-2" />write-in
                        </span>
                        {inlineEmotionPicker === index && (
                          <div
                            className="w-full mt-1 p-2 rounded-xl border border-violet-500/40 bg-[#0d1525] shadow-lg shadow-violet-900/30"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex flex-wrap gap-1 mb-2">
                              {EMOTIONS.map((emotion) => (
                                <span
                                  key={emotion}
                                  title={EMOTION_DESCRIPTIONS[emotion]}
                                  className={cn(
                                    'text-[9px] px-1.5 py-0.5 rounded-full cursor-pointer border transition-colors select-none font-mono',
                                    stagedEmotions[index] === emotion
                                      ? 'bg-violet-500/30 text-violet-200 border-violet-400'
                                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-violet-500/20 hover:text-violet-300 hover:border-violet-500/40'
                                  )}
                                  onClick={() => setStagedEmotions(prev => ({ ...prev, [index]: emotion }))}
                                >
                                  {emotion.toLowerCase()}
                                </span>
                              ))}
                            </div>
                            <button
                              type="button"
                              disabled={isRegenerating}
                              className="w-full text-[10px] py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-medium transition-colors mb-1.5"
                              onClick={() => {
                                setInlineEmotionPicker(null)
                                selectSegment(index)
                                handleGenerateSpeech(index)
                              }}
                            >
                              ✦ Generate Speech
                            </button>
                            <span
                              className="text-[9px] text-slate-600 hover:text-slate-400 cursor-pointer block text-right"
                              onClick={() => setInlineEmotionPicker(null)}
                            >
                              ✕ cancel
                            </span>
                          </div>
                        )}
                        {inlineEmotionWriteIn === index && (() => {
                          // Two modes off ONE box:
                          //  - Delivery Script: draft contains the line (loaded via double-click) →
                          //    send VERBATIM to Fish (inline [tags] parse, not spoken); display stays clean.
                          //  - Short emotion: a bare descriptor with no line → prepend as emotion (old behavior).
                          const cleanLine = (segment.preview_text ?? segment.active_text ?? segment.target_text ?? '').replace(/\s+/g, ' ').trim()
                          const submit = () => {
                            const draft = (customEmotionDrafts[index] ?? '').trim()
                            if (!draft) return
                            const stripped = draft.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
                            const key = cleanLine.toLowerCase().slice(0, Math.min(cleanLine.length, 10))
                            const isScript = key.length > 0 && stripped.includes(key)
                            setInlineEmotionWriteIn(null)
                            selectSegment(index)
                            if (isScript) {
                              setImportedSegments(prev => prev ? prev.map((s, i) => i === index ? { ...s, tts_text: draft } : s) : prev)
                              handleGenerateSpeech(index, undefined, undefined, draft)
                            } else {
                              setStagedEmotions(prev => ({ ...prev, [index]: draft }))
                              handleGenerateSpeech(index)
                            }
                          }
                          return (
                          <div
                            className="w-full mt-1 p-2 rounded-xl border border-cyan-500/40 bg-[#0d1525] shadow-lg shadow-cyan-900/30"
                            onClick={(e) => e.stopPropagation()}
                            // Let the browser's native right-click menu (with Paste) work inside
                            // this field instead of the segment's custom context menu.
                            onContextMenu={(e) => e.stopPropagation()}
                          >
                            <textarea
                              autoFocus
                              rows={2}
                              placeholder="Double-click here to load the line, then add [tags] — or type a short emotion…"
                              value={customEmotionDrafts[index] ?? ''}
                              onChange={(e) => setCustomEmotionDrafts(prev => ({ ...prev, [index]: e.target.value }))}
                              onClick={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => {
                                // Double-click the empty field to drop the segment's line in
                                // (so you can add [tags]). If there's already text, let the
                                // browser's double-click word-select behave normally.
                                if (!(customEmotionDrafts[index] ?? '').trim()) {
                                  e.preventDefault()
                                  setCustomEmotionDrafts(prev => ({ ...prev, [index]: (segment.preview_text ?? segment.active_text ?? segment.target_text ?? '') }))
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() }
                              }}
                              className="w-full text-[11px] px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-cyan-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60 mb-1.5 resize-y leading-snug"
                            />
                            <button
                              type="button"
                              disabled={isRegenerating || !(customEmotionDrafts[index] ?? '').trim()}
                              className="w-full text-[10px] py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-medium transition-colors mb-1.5"
                              onClick={submit}
                            >
                              ✦ Generate Speech
                            </button>
                            <span
                              className="text-[9px] text-slate-600 hover:text-slate-400 cursor-pointer block text-right"
                              onClick={() => setInlineEmotionWriteIn(null)}
                            >
                              ✕ cancel
                            </span>
                          </div>
                          )
                        })()}
                        {/* Speed chip */}
                        <span
                          className={cn(
                            'inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full border transition-colors cursor-pointer select-none font-mono',
                            stagedSpeeds[index] !== undefined && stagedSpeeds[index] !== 1.0
                              ? 'bg-orange-500/20 text-orange-300 border-orange-500/40 hover:bg-red-500/20 hover:text-red-300'
                              : 'text-slate-600 border-slate-800 hover:text-orange-400 hover:border-orange-500/30'
                          )}
                          title="Adjust segment speed"
                          onClick={(e) => {
                            e.stopPropagation()
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                            setSpeedPopupPos({
                              x: Math.min(rect.left, window.innerWidth - 300),
                              y: Math.max(10, rect.top - 260),
                            })
                            setSpeedPopupIndex(prev => prev === index ? null : index)
                          }}
                        >
                          {stagedSpeeds[index] !== undefined && stagedSpeeds[index] !== 1.0
                            ? `${stagedSpeeds[index].toFixed(2)}×`
                            : <><Gauge className="h-2 w-2" />speed</>
                          }
                        </span>
                        {splitWordMode === index ? (
                          <div
                            className="text-sm flex flex-wrap gap-x-1 gap-y-1 px-3 py-2 rounded-2xl border-2 border-amber-500 bg-amber-500/10 shadow-[0_0_10px_rgba(251,191,36,0.4)] select-none"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-[10px] text-amber-400 font-medium w-full">✂️ Click a word to split before it</span>
                            {(segment.preview_text ?? segment.active_text ?? segment.target_text).split(' ').map((word, wordIdx) => (
                              <span
                                key={wordIdx}
                                title={wordIdx === 0 ? 'Cannot split before first word' : `Split before "${word}"`}
                                className={cn(
                                  'px-1 py-0.5 rounded transition-colors text-sm',
                                  wordIdx === 0
                                    ? 'text-slate-500 cursor-not-allowed'
                                    : 'text-white cursor-pointer hover:bg-amber-500/40 hover:text-amber-100'
                                )}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (wordIdx > 0) handleSplitAtWord(index, wordIdx)
                                }}
                              >
                                {word}
                              </span>
                            ))}
                            <span
                              className="text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer ml-1 self-center"
                              onClick={(e) => { e.stopPropagation(); setSplitWordMode(null) }}
                            >
                              ✕ cancel
                            </span>
                          </div>
                        ) : (
                          <div
                            className={cn(
                              'text-sm cursor-pointer select-none inline-flex items-center gap-1 px-3 py-1 rounded-full border-2 text-white',
                              lockedSegments.has(index)
                                ? 'border-emerald-400 bg-emerald-500/20 shadow-[0_0_10px_rgba(34,197,94,0.4)]'
                                : segment.isPreviewing
                                  ? 'border-orange-400 bg-orange-500/10 shadow-[0_0_8px_rgba(251,146,60,0.3)]'
                                  : 'border-amber-400 bg-amber-500/10 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                            )}
                            onDoubleClick={() => {
                              if (lockedSegments.has(index) || segment.isPreviewing) return
                              // When the write-in box is open, double-clicking the line drops it
                              // into that field (Delivery Script) so you can add [tags]. Otherwise
                              // double-click edits the line inline as before.
                              if (inlineEmotionWriteIn === index) {
                                const line = (segment.preview_text ?? segment.active_text ?? segment.target_text ?? '')
                                setCustomEmotionDrafts(prev => ({ ...prev, [index]: line }))
                              } else {
                                startEditing(index)
                              }
                            }}
                          >
                            {lockedSegments.has(index) && <Lock className="h-3 w-3 shrink-0" />}
                            {(segment.preview_text ?? segment.active_text ?? segment.target_text)
                              || <span className="text-slate-500 italic">Enter text…</span>}
                          </div>
                        )}
                        {/* Subtle QC icon on hover — clicking selects segment and opens Quality tab */}
                        {hasQCFindings && (
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 text-slate-500 hover:text-amber-400"
                            title="View QC details"
                            onClick={(e) => {
                              e.stopPropagation()
                              selectSegment(index)
                              setRightPanelTab('quality')
                            }}
                          >
                            <Gauge className="h-3.5 w-3.5" />
                          </button>
                        )}
                        </div>
                      </>
                    )}
                    {(isEditing || segment.isPreviewing || segment.status === 'edited') && (
                      <div className="flex items-center gap-1.5 pointer-events-auto cursor-pointer shrink-0 select-none">
                        <button
                          className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors pointer-events-auto cursor-pointer select-none"
                          onClick={(e) => {
                            e.stopPropagation()
                            commitPreview(index)
                            commitSegmentChanges(index, {
                              committed_adapted_text: displaySegments[index]?.preview_text ?? undefined,
                            })
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) =>
                                i === index
                                  ? {
                                      ...seg,
                                      active_text: seg.preview_text ?? seg.active_text ?? seg.target_text,
                                      target_text: seg.preview_text ?? seg.target_text,
                                      variant_text: seg.preview_text ?? seg.variant_text ?? seg.target_text,
                                      isUserEdited: true,
                                      preview_text: null,
                                      isPreviewing: false,
                                      committed_emotion: stagedEmotions[index] ?? seg.committed_emotion,
                                    }
                                  : seg
                              )
                            })
                            setEditingSegmentIndex(null)
                            handleGenerateSpeech(index)
                          }}
                        >
                          Commit
                        </button>
                        <button
                          type="button"
                          className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 hover:text-red-300 transition-colors pointer-events-auto cursor-pointer select-none"
                          title="Reset segment to pipeline-original — wipes all edits, emotion, voice, speed, and audio"
                          onClick={(e) => { e.stopPropagation(); handleClearSegment(index) }}
                        >
                          Clear
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                </SegmentContextMenu>
)
          })}
          </ScrollArea>
          )}
          
          {/* Bottom toolbar */}
          <div className="flex items-center gap-2 px-4 py-2 border-t border-neutral-800 bg-neutral-900/70">
            {/* Ask DubMaster AI — swaps the preview video for the chat panel, same slot */}
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-8 text-xs", videoSubTab === 'askai' ? "text-amber-400 bg-amber-500/10" : "text-slate-400")}
              onClick={() => {
                setRightPanelTab('result')
                setVideoSubTab(v => v === 'askai' ? null : 'askai')
              }}
            >
              <MessageCircle className="h-4 w-4 mr-1" />
              Ask DubMaster AI
            </Button>
            {/* Change Voice — click to reveal draggable chips, drag onto a segment */}
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-8 text-xs", voicePaletteOpen ? "text-cyan-400 bg-cyan-500/10" : "text-slate-400")}
              onClick={() => setVoicePaletteOpen(p => !p)}
            >
              <Mic2 className="h-4 w-4 mr-1" />
              Change Voice
            </Button>
            {voicePaletteOpen && (
              <div className="flex items-center gap-1.5">
                {VOICE_OPTIONS.map(v => (
                  <div
                    key={v.key}
                    draggable
                    onDragStart={(e) => {
                      setDraggedVoice(v.key)
                      e.dataTransfer.setData('voice_key', v.key)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onDragEnd={() => setDraggedVoice(null)}
                    className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-700 text-slate-300 cursor-grab active:cursor-grabbing border border-slate-600 hover:border-cyan-500/60 hover:text-cyan-300 select-none"
                  >
                    {v.label}
                  </div>
                ))}
                <span className="text-[10px] text-slate-600 ml-1">drag to segment</span>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-8 text-xs", hasFeature('customVoices') ? "text-slate-400 hover:text-amber-300" : "text-slate-500 hover:text-violet-300")}
              title={hasFeature('customVoices') ? undefined : 'Custom Voices is a Professional feature — upgrade to add your own voice'}
              onClick={() => hasFeature('customVoices') ? setCustomVoicesOpen(true) : router.push('/subscribe')}
            >
              <Sparkles className="h-4 w-4 mr-1" />
              Custom Voices
              {!hasFeature('customVoices') && <Lock className="h-3 w-3 ml-1" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 text-xs gap-1",
                    selectedSegmentIndex !== null && stagedEmotions[selectedSegmentIndex]
                      ? "text-violet-400 bg-violet-500/10"
                      : "text-slate-400"
                  )}
                >
                  {selectedSegmentIndex !== null && stagedEmotions[selectedSegmentIndex]
                    ? (() => {
                        const full = stagedEmotions[selectedSegmentIndex].toLowerCase()
                        const firstWord = full.split(/[\s,]+/).filter(Boolean)[0] ?? full
                        const label = full.length > firstWord.length ? `${firstWord}…` : full
                        return <span className="font-mono text-[10px] max-w-[8rem] truncate" title={`(${full})`}>({label})</span>
                      })()
                    : 'Emotion'}
                  {Object.keys(stagedEmotions).length > 0 && (
                    <span className="ml-0.5 text-[9px] bg-violet-500/30 text-violet-300 rounded-full px-1">
                      {Object.keys(stagedEmotions).length}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48 bg-[#0F172A] border-slate-700 max-h-80 overflow-y-auto">
                {selectedSegmentIndex === null && (
                  <div className="px-2 py-1.5 text-[10px] text-slate-500">Select a segment first</div>
                )}
                {EMOTIONS.map((emotion) => (
                  <DropdownMenuItem
                    key={emotion}
                    title={EMOTION_DESCRIPTIONS[emotion]}
                    className={cn(
                      "text-xs cursor-pointer",
                      selectedSegmentIndex !== null && stagedEmotions[selectedSegmentIndex] === emotion
                        ? "text-violet-300 bg-violet-500/20"
                        : "text-slate-300 hover:text-white hover:bg-slate-700"
                    )}
                    onClick={() => {
                      if (selectedSegmentIndex !== null) {
                        setStagedEmotions(prev => ({ ...prev, [selectedSegmentIndex]: emotion }))
                      }
                    }}
                  >
                    <div className="flex flex-col gap-0.5 py-0.5">
                      <div className="flex items-center">
                        <span className="font-mono text-[10px] text-slate-500 mr-2 w-16 shrink-0">
                          ({emotion.toLowerCase()})
                        </span>
                        <span className="font-medium">{emotion}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 leading-snug">
                        {EMOTION_DESCRIPTIONS[emotion]}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator className="bg-slate-700" />
                {/* Batch apply to same speaker */}
                {selectedSegmentIndex !== null && (() => {
                  const speaker = displaySegments[selectedSegmentIndex]?.speaker_id
                  const emotion = stagedEmotions[selectedSegmentIndex]
                  if (!emotion || !speaker) return null
                  const sameSpkIndices = displaySegments
                    .map((s, i) => s.speaker_id === speaker ? i : -1)
                    .filter(i => i !== -1)
                  return (
                    <DropdownMenuItem
                      className="text-xs text-blue-400 hover:text-blue-300 hover:bg-slate-700 cursor-pointer"
                      onClick={() => {
                        setStagedEmotions(prev => {
                          const next = { ...prev }
                          sameSpkIndices.forEach(i => { next[i] = emotion })
                          return next
                        })
                      }}
                    >
                      Apply ({emotion.toLowerCase()}) to all {displaySegments[selectedSegmentIndex]?.speaker_label ?? 'speaker'} segments
                    </DropdownMenuItem>
                  )
                })()}
                <DropdownMenuItem
                  className="text-slate-500 hover:text-slate-300 hover:bg-slate-700 cursor-pointer text-xs"
                  onClick={() => {
                    if (selectedSegmentIndex !== null) {
                      setStagedEmotions(prev => ({ ...prev, [selectedSegmentIndex]: '' }))
                      updateSegment(selectedSegmentIndex, { committed_emotion: null })
                      setImportedSegments(prev => {
                        if (!prev) return prev
                        return prev.map((seg, i) => i === selectedSegmentIndex ? { ...seg, committed_emotion: null } : seg)
                      })
                    }
                  }}
                >
                  Clear this segment
                </DropdownMenuItem>
                {Object.keys(stagedEmotions).length > 1 && (
                  <DropdownMenuItem
                    className="text-slate-500 hover:text-red-400 hover:bg-slate-700 cursor-pointer text-xs"
                    onClick={() => setStagedEmotions({})}
                  >
                    Clear all emotions
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-8 text-xs", rightPanelTab === 'nuances' ? "text-violet-400 bg-violet-500/10" : "text-slate-400")}
              onClick={() => setRightPanelTab('nuances')}
            >
              <Sliders className="h-4 w-4 mr-1" />
              Nuances
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-8 text-xs", askAiOpen ? "text-amber-400 bg-amber-500/10" : "text-slate-400")}
              onClick={() => {
                setAskAiOpen(p => !p)
                setAskAiResult(null)
                setAskAiPrompt('')
                setAskAiPos({
                  x: Math.max(20, window.innerWidth / 2 - 220),
                  y: Math.max(20, window.innerHeight / 2 - 180),
                })
              }}
            >
              <Sparkles className="h-4 w-4 mr-1" />
              Ask AI
            </Button>
            <div className="ml-auto flex flex-col items-end gap-1">
              <Button
                size="sm"
                className={cn(
                  "h-8 text-xs",
                  selectedSegmentIndex !== null && lockedSegments.has(selectedSegmentIndex)
                    ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                    : "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                )}
                onClick={() => handleGenerateSpeech()}
                disabled={selectedSegmentIndex === null || isRegenerating}
              >
                {isRegenerating ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                    Generating...
                  </>
                ) : selectedSegmentIndex !== null && lockedSegments.has(selectedSegmentIndex) ? (
                  <>
                    <Lock className="h-4 w-4 mr-1" />
                    Locked
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-1" />
                    Generate Speech
                  </>
                )}
              </Button>
              {regenError && (
                <p className="text-xs text-red-400">{regenError}</p>
              )}
              {addSegmentFeedback === 'error' && (
                <p className="text-xs text-red-400 font-medium">
                  Add Segment failed — please try again or reload the page.
                </p>
              )}
              {addSegmentFeedback === 'success' && (
                <p className="text-xs text-emerald-400">
                  Segment added ✓
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-400"
              onClick={() => setPendingDelete(selectedSegmentIndex)}
              disabled={selectedSegmentIndex === null}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {pendingOverwriteIndex !== null && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-950/50 border border-amber-500/30 rounded text-xs text-amber-300 mx-4 mb-2">
              <span>This will replace the committed audio for this segment. Regenerate with the new text?</span>
              <Button size="sm" className="h-6 text-xs bg-amber-600 hover:bg-amber-700 text-white px-2"
                onClick={() => {
                  const idx = pendingOverwriteIndex
                  setPendingOverwriteIndex(null)
                  handleGenerateSpeech(idx)
                }}>
                Regenerate
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                onClick={() => setPendingOverwriteIndex(null)}>
                Cancel
              </Button>
            </div>
          )}
          {pendingDelete !== null && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-950/50 border border-red-500/30 rounded text-xs text-red-400 mx-4 mb-2">
              <span>Delete this segment?</span>
              <Button size="sm" className="h-6 text-xs bg-red-600 hover:bg-red-700 text-white px-2"
                onClick={() => {
                  const idx = pendingDelete
                  setImportedSegments(prev => {
                    const base = prev ?? displaySegments
                    return base.filter((_, i) => i !== idx)
                  })
                  setTimeout(() => syncSegmentsToBackend(displaySegmentsRef.current), 0)
                  setLockedSegments(prev => {
                    const next = new Set(prev)
                    next.delete(idx)
                    return next
                  })
                  setStagedSpeeds(prev => { const n = { ...prev }; delete n[idx]; return n })
                  setStagedEmotions(prev => { const n = { ...prev }; delete n[idx]; return n })
                  setStagedVoices(prev => { const n = { ...prev }; delete n[idx]; return n })
                  setStagedPitches(prev => { const n = { ...prev }; delete n[idx]; return n })
                  selectSegment(null)
                  setPendingDelete(null)
                }}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                onClick={() => setPendingDelete(null)}>
                Cancel
              </Button>
            </div>
          )}
          {showRevertAllConfirm && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-950/50 border border-red-500/30 rounded text-xs text-red-400 mx-4 mb-2">
              <span>This will clear all editor changes and return to the original pipeline output. Are you sure?</span>
              <Button size="sm" className="h-6 text-xs bg-red-600 hover:bg-red-700 text-white px-2"
                onClick={() => {
                  // Wipe all store state (job, video, segments, speakers, QC)
                  resetEditor()
                  // Local UI state
                  setFloatingEmotionSegment(null)
                  setAdvancedBrowserSegment(null)
                  setVideoSubTab(null)
                  setStagedSpeeds({})
                  setStagedEmotions({})
                  setStagedVoices({})
                  setCustomEmotionDrafts({})
                  setLockedSegments(new Set())
                  setLockedPairs(new Set())
                  setGroupedSegments(new Set())
                  setInlineEmotionPicker(null)
                  setInlineEmotionWriteIn(null)
                  setSplitWordMode(null)
                  // Clear Reference track (local state, not in Zustand store)
                  setReferenceSegments(null)
                  setReferenceJobId(null)
                  setReferenceDetectedLang(null)
                  setSelectedReferenceIndex(null)
                  revertToOriginal()
                  if (videoRef.current) {
                    videoRef.current.pause()
                    videoRef.current.src = ''
                    videoRef.current.load()
                  }
                  setShowRevertAllConfirm(false)
                }}>
                Clear Editor
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2"
                onClick={() => setShowRevertAllConfirm(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>

        {/* Right panel - Video preview (resizable) */}
        <div 
          className="flex flex-col border-l border-neutral-800 bg-neutral-900/50 relative"
          style={{ width: previewWidth }}
        >
          {/* Resize handle */}
          <div
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-amber-500/50 transition-colors z-20 group"
            onMouseDown={handlePreviewResizeStart}
          >
            <div className={cn(
              "absolute inset-y-0 left-0 w-0.5 bg-amber-500/30 group-hover:bg-amber-500",
              isResizingPreview && "bg-amber-500"
            )} />
          </div>
          {/* Right panel tabs: Result / Quality / Studio */}
          <div className="flex items-center justify-between gap-1 px-2 py-1.5 border-b border-slate-800 bg-neutral-900">
            <div className="flex items-center gap-1">
              {([
                { id: 'result',     label: 'Video' },
                { id: 'quality',    label: 'Quality' },
                { id: 'velma',      label: 'Velma',        feature: 'velmaPanel' },
                { id: 'studio',     label: 'Studio',       feature: 'studioCollaboration' },
                { id: 'adaptation', label: 'Adaptation' },
                { id: 'speakers',   label: 'Speakers' },
                { id: 'library',    label: 'Voice Library' },
                { id: 'ei-library', label: 'E.I. Library', feature: 'emotionalIntelligence' },
              ] as const).filter((t) => !('feature' in t) || hasFeature(t.feature as any)).map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => {
                    if (t.id === 'studio') {
                      router.push('/studio')
                      return
                    }
                    setRightPanelTab(t.id)
                  }}
                  className={cn(
                    'text-xs px-3 py-1 rounded-md transition-colors',
                    rightPanelTab === t.id
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  )}
                >
                  {t.label}
                  {t.id === 'quality' && qcReport && (qcReport.grade === 'D' || qcReport.grade === 'F') && (
                    <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                  )}
                </button>
              ))}
            </div>
            <Button
              className={cn(
                "h-7 px-4 text-xs font-bold tracking-widest uppercase text-white",
                rebuildStatus === 'idle' && "bg-red-600 hover:bg-red-700",
                rebuildStatus === 'processing' && "bg-red-800 border border-red-500 animate-pulse shadow-[0_0_14px_rgba(239,68,68,0.5)]",
                rebuildStatus === 'complete' && "bg-emerald-700 hover:bg-emerald-800",
                rebuildStatus === 'error' && "bg-red-600 hover:bg-red-700",
              )}
              onClick={handleRebuildVideo}
              disabled={isRebuilding}
            >
              {rebuildStatus === 'complete'
                ? <Check className="h-3.5 w-3.5 mr-1" />
                : <RefreshCw className={cn("h-3.5 w-3.5 mr-1", isRebuilding && "animate-spin")} />}
              {rebuildStatus === 'processing' ? 'REBUILDING…'
                : rebuildStatus === 'complete' ? 'REBUILD COMPLETE'
                : 'REBUILD VIDEO'}
            </Button>
            {rightPanelTab === 'result' && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn('h-6 text-[11px] px-2', playbackMode === 'original' ? 'text-white' : 'text-slate-500')}
                  onClick={() => setPlaybackMode('original')}
                >
                  Original
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-6 text-[11px] px-3 rounded-full',
                    playbackMode === 'dubbed' ? 'bg-slate-700 text-white' : 'text-slate-500'
                  )}
                  onClick={() => setPlaybackMode('dubbed')}
                >
                  Translated
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-6 text-[11px] px-3 rounded-full',
                    playbackMode === 'preview'
                      ? 'bg-amber-600/40 text-amber-300 ring-1 ring-amber-500/50'
                      : 'text-slate-500'
                  )}
                  onClick={() => setPlaybackMode('preview')}
                >
                  Preview
                </Button>
              </div>
            )}
          </div>

          {/* Result tab — Video fills panel; hidden when a sub-tab is active (sub-tab panel takes over) */}
          <div
            className="flex flex-col min-h-0"
            style={{ display: rightPanelTab === 'result' && !videoSubTab ? 'flex' : 'none', flex: 1 }}
          >
            {/* Video player — fills all space; hidden (not unmounted) when sub-tab is active so ref stays valid */}
            <div
              className="relative bg-black"
              style={{ display: videoSubTab ? 'none' : 'flex', flex: 1, minHeight: 0 }}
            >
              <video
                ref={videoRef}
                src={activeVideoUrl}
                className="absolute top-0 left-0 w-full h-full object-cover"
                onTimeUpdate={handleVideoTimeUpdate}
                controls={false}
              />
              {captionSegment && (
                <div className="absolute bottom-8 left-0 right-0 text-center px-4">
                  <span className="bg-black/75 px-4 py-2 rounded text-white text-sm">
                    {captionSegment.preview_text ?? captionSegment.active_text ?? captionSegment.target_text}
                  </span>
                </div>
              )}
              <div className="absolute bottom-2 right-2 flex items-center gap-1 text-xs text-slate-500">
                <span>Video Translated by DubMaster</span>
              </div>
            </div>
          </div>

          {/* Ask DubMaster AI tab — docked in the preview slot, replaces video (not an overlay); sibling of the Result-tab wrapper, same pattern as Chord/Advanced/Characters below */}
          <div
            className="flex-1 min-h-0 flex flex-col overflow-hidden"
            style={{
              display: videoSubTab === 'askai' && rightPanelTab === 'result' ? 'flex' : 'none',
              background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0) 45%), rgba(14,14,17,0.92)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '2px solid transparent',
              borderRadius: '16px',
              margin: '12px',
              boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
              animation: 'ask-ai-border-glow 6s linear infinite, ask-ai-glow-shadow 6s linear infinite',
            }}
          >
            <div className="relative flex items-center justify-between px-8 py-6 border-b border-white/10 flex-shrink-0 bg-gradient-to-r from-white/[0.04] to-transparent">
              <span className="flex items-center gap-3 text-lg font-semibold text-amber-400">
                <span className="w-11 h-11 rounded-lg bg-[#1c1c20] border border-white/10 flex items-center justify-center shrink-0">
                  <AskAiBotIcon id="askAiBotGradient-header" size={26} />
                </span>
                Ask DubMaster AI
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setAskAiConvListOpen(v => !v)}
                  className="text-xs text-white/50 hover:text-white px-2 py-1 rounded-md hover:bg-white/5 transition-colors"
                >
                  {askAiConversations.length > 1 ? `Chats (${askAiConversations.length})` : 'Chats'}
                </button>
                <button
                  onClick={startNewAskAiChat}
                  className="text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded-md hover:bg-white/5 transition-colors"
                >
                  + New Chat
                </button>
                <button onClick={() => setVideoSubTab(null)} className="text-white/50 hover:text-white text-sm ml-2">✕</button>
              </div>

              {askAiConvListOpen && (
                <div className="absolute right-8 top-full mt-1 w-64 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-[#1c1c20] shadow-xl z-10">
                  {askAiConversations.map((conv, idx) => (
                    <button
                      key={conv.id}
                      onClick={() => switchAskAiConversation(idx)}
                      className={cn(
                        "w-full text-left px-3 py-2 text-xs truncate transition-colors",
                        idx === askAiCurrentIndex ? "text-amber-400 bg-white/5" : "text-white/60 hover:bg-white/5 hover:text-white"
                      )}
                    >
                      {conv.messages.find(m => m.role === 'user')?.content?.slice(0, 32) || `Conversation ${idx + 1}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6 space-y-6">
              {askAiChatMessages.length === 0 && (
                <div className="text-sm text-white/40">Ask me anything about your dub — QC scores, Velma enrichment, exporting, timeline behavior.</div>
              )}
              {askAiChatMessages.map((m, i) => (
                <div key={i} className={cn("flex items-start gap-3", m.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                  {m.role === 'assistant' ? (
                    <span className="w-7 h-7 rounded-lg bg-[#1c1c20] border border-white/10 flex items-center justify-center shrink-0 mt-0.5">
                      <AskAiBotIcon id={`askAiBotGradient-msg-${i}`} size={16} />
                    </span>
                  ) : (
                    <span className="w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center text-[10px] font-medium text-white shrink-0 mt-0.5">{userInitials}</span>
                  )}
                  <div className={cn("text-sm leading-relaxed space-y-1 max-w-[78%]", m.role === 'user' ? "text-white text-right" : "text-emerald-400 text-left")}>
                    {m.role === 'assistant'
                      ? (m.displayed === m.content ? renderMarkdownLite(m.content) : <span className="whitespace-pre-wrap">{m.displayed ?? ''}</span>)
                      : m.content}
                  </div>
                </div>
              ))}
              {askAiChatLoading && <div className="text-sm text-white/40 pl-10">Thinking…</div>}
              {askAiChatError && <div className="text-sm text-red-400 pl-10">{askAiChatError}</div>}
            </div>
            <div className="flex items-center gap-3 px-8 py-6 border-t border-white/10 flex-shrink-0 bg-gradient-to-r from-white/[0.04] to-transparent">
              <div
                className="flex-1 rounded-full"
                style={{
                  border: '1.5px solid transparent',
                  animation: 'ask-ai-border-glow 6s linear infinite, ask-ai-glow-shadow 6s linear infinite',
                }}
              >
                <input
                  value={askAiChatInput}
                  onChange={e => setAskAiChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitAskAiChat() }}
                  placeholder="Ask about your dub..."
                  className="w-full bg-white/5 text-white text-sm rounded-full px-4 py-3 outline-none placeholder:text-white/30"
                />
              </div>
              <button
                onClick={submitAskAiChat}
                disabled={askAiChatLoading || !askAiChatInput.trim()}
                className="w-10 h-10 rounded-full bg-amber-500 disabled:bg-white/10 flex items-center justify-center shrink-0 transition-colors"
              >
                <ArrowUp className="h-5 w-5 text-white" />
              </button>
            </div>
          </div>

          {/* Quality tab — Docked Segment QC Panel */}
          {rightPanelTab === 'quality' && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <SegmentQCPanel
                segment={selectedSegmentIndex !== null ? displaySegments[selectedSegmentIndex] : null}
                report={qcReport}
                onRecalculate={() => {
                  // Placeholder: trigger QC recalculation
                  console.log('Recalculate QC for segment', selectedSegmentIndex)
                }}
                onAutoFix={() => {
                  // Placeholder: trigger auto-fix
                  console.log('Auto-fix segment', selectedSegmentIndex)
                }}
                onRegenerateDub={() => {
                  if (selectedSegmentIndex !== null) handleGenerateSpeech(selectedSegmentIndex)
                }}
              />
            </div>
          )}

          {/* Velma tab */}
          {rightPanelTab === 'velma' && hasFeature('velmaPanel') && (
            <div className="flex-1 min-h-0 overflow-y-auto bg-neutral-950">
              <VelmaPanel
                segment={selectedSegmentIndex !== null ? displaySegments[selectedSegmentIndex] : null}
                voices={[]}
                setRightPanelTab={setRightPanelTab}
              />
            </div>
          )}

          {/* Studio tab — placeholder */}
          {rightPanelTab === 'studio' && hasFeature('studioCollaboration') && (
            <div className="flex-1 min-h-0 flex items-center justify-center text-slate-500 text-sm bg-neutral-950">
              Studio coming soon
            </div>
          )}

          {/* Adaptation tab */}
          {rightPanelTab === 'adaptation' && (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <AdaptationPanel />
            </div>
          )}

          {/* Speakers tab */}
          {rightPanelTab === 'speakers' && (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <SpeakerVoicePanel />
            </div>
          )}

          {/* Library tab — Fish Audio catalog as a paired sibling to Speakers */}
          {rightPanelTab === 'library' && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <VoiceLibraryPanel
                customVoicesVersion={customVoicesVersion}
                onVoiceAssigned={(speakerId, voiceId) => {
                  // Clear any per-segment staged voice overrides for this speaker so
                  // nothing shadows the assignment, then apply the voice to all of the
                  // speaker's segments atomically on the backend.
                  setStagedVoices(prev => {
                    const next = { ...prev }
                    displaySegments.forEach((seg, i) => {
                      if (seg.speaker_id === speakerId) delete next[i]
                    })
                    return next
                  })
                  if (voiceId) {
                    applyVoiceToSpeaker(speakerId, voiceId)
                  }
                }}
              />
            </div>
          )}

          {rightPanelTab === 'nuances' && (() => {
            const nIdx = selectedSegmentIndex ?? 0
            const seg = displaySegments[nIdx]
            const cur = { ...DEFAULT_NUANCES, ...seg?.nuances, ...stagedNuances[nIdx] }
            const setN = (key: keyof SegmentNuances, val: number) =>
              setStagedNuances(prev => ({ ...prev, [nIdx]: { ...prev[nIdx], [key]: val } }))
            const tier1: Array<{ key: keyof SegmentNuances; labels: string[] }> = [
              { key: 'pace', labels: ['Rushed', 'Measured', 'Deliberate'] },
              { key: 'weight', labels: ['Light', 'Normal', 'Heavy'] },
              { key: 'breath', labels: ['Clipped', 'Natural', 'Breathy'] },
              { key: 'delivery', labels: ['Intimate', 'Neutral', 'Projected'] },
              { key: 'tail', labels: ['Sharp', 'Natural', 'Trailing'] },
            ]
            const tier2: Array<{ key: keyof SegmentNuances; min: string; max: string }> = [
              { key: 'prosody', min: 'Flat', max: 'Expressive' },
              { key: 'pitchContour', min: 'Flat', max: 'Melodic' },
              { key: 'volumeDynamics', min: 'Compressed', max: 'Dynamic' },
              { key: 'tempoPacing', min: 'Slow', max: 'Fast' },
              { key: 'pauses', min: 'None', max: 'Heavy' },
              { key: 'breathSounds', min: 'None', max: 'Prominent' },
              { key: 'voiceQuality', min: 'Smooth', max: 'Textured' },
              { key: 'microIntonation', min: 'Robotic', max: 'Human' },
            ]
            const segText = seg?.preview_text ?? seg?.active_text ?? seg?.target_text ?? ''
            const markers: NuanceMarker[] = seg?.nuance_markers ?? []
            const addMarker = (type: NuanceMarkerType) => {
              const el = document.getElementById('nuance-text-display')
              if (!el) return
              const sel = window.getSelection()
              if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
              const range = sel.getRangeAt(0)
              if (!el.contains(range.commonAncestorContainer)) return
              const preRange = document.createRange()
              preRange.setStart(el, 0)
              preRange.setEnd(range.startContainer, range.startOffset)
              const startChar = preRange.toString().length
              const endChar = startChar + range.toString().length
              if (endChar <= startChar) return
              const newMarker: NuanceMarker = {
                id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                startChar,
                endChar,
                type,
                intensity: 70,
              }
              setImportedSegments(prev => {
                if (!prev) return prev
                return prev.map((s, i) => i === nIdx
                  ? { ...s, nuance_markers: [...(s.nuance_markers ?? []), newMarker] }
                  : s)
              })
              sel.removeAllRanges()
            }
            const removeMarker = (markerId: string) => {
              setImportedSegments(prev => {
                if (!prev) return prev
                return prev.map((s, i) => i === nIdx
                  ? { ...s, nuance_markers: (s.nuance_markers ?? []).filter(m => m.id !== markerId) }
                  : s)
              })
            }
            const renderMarkedText = () => {
              if (markers.length === 0) return <span>{segText}</span>
              const sorted = [...markers].sort((a, b) => a.startChar - b.startChar)
              const parts: React.ReactNode[] = []
              let cursor = 0
              sorted.forEach((m, mi) => {
                if (m.startChar > cursor) parts.push(<span key={`t${mi}`}>{segText.slice(cursor, m.startChar)}</span>)
                const meta = NUANCE_MARKER_META[m.type]
                parts.push(
                  <span
                    key={m.id}
                    className={cn('underline decoration-2 cursor-pointer', meta?.color ?? 'text-white')}
                    title={`${meta?.label} — click to remove`}
                    onClick={() => removeMarker(m.id)}
                  >
                    {segText.slice(m.startChar, m.endChar)}
                  </span>
                )
                cursor = m.endChar
              })
              if (cursor < segText.length) parts.push(<span key="tail">{segText.slice(cursor)}</span>)
              return <>{parts}</>
            }
            return (
              <div className="flex-1 min-h-0 flex flex-col overflow-y-auto p-3 space-y-3">
                <div className="text-xs text-slate-400">
                  <span className="font-semibold text-white">{nIdx + 1}</span>
                  {' '}{seg?.speaker_label ?? seg?.speaker_id}
                </div>

                {/* Selectable text with visual markers */}
                <div
                  id="nuance-text-display"
                  className="text-sm text-slate-200 bg-slate-800/50 rounded px-3 py-2 border border-slate-700 select-text cursor-text leading-relaxed"
                >
                  {renderMarkedText()}
                </div>

                {/* Marker toolbar */}
                <div className="flex flex-wrap gap-1">
                  {(Object.keys(NUANCE_MARKER_META) as NuanceMarkerType[]).map(type => {
                    const meta = NUANCE_MARKER_META[type]
                    return (
                      <button
                        key={type}
                        type="button"
                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] border border-slate-700 bg-slate-800 hover:bg-slate-700 transition-colors text-slate-400 hover:text-slate-200"
                        title={`Select text above, then click to add ${meta.label} marker`}
                        onClick={() => addMarker(type)}
                      >
                        <span>{meta.icon}</span>
                        <span>{meta.label}</span>
                      </button>
                    )
                  })}
                </div>

                {markers.length > 0 && (
                  <div className="text-[9px] text-slate-600">
                    Click a colored span to remove its marker
                  </div>
                )}

                <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold pt-1">Basic</div>
                {tier1.map(({ key, labels }) => (
                  <div key={key} className="space-y-1">
                    <div className="text-[11px] text-slate-400 capitalize">{key}</div>
                    <div className="flex gap-1">
                      {labels.map((label, i) => (
                        <button
                          key={i}
                          type="button"
                          className={cn(
                            'flex-1 px-1.5 py-1 rounded text-[10px] border transition-colors',
                            cur[key] === i
                              ? 'bg-violet-500/30 border-violet-400/60 text-violet-300'
                              : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
                          )}
                          onClick={() => setN(key, i)}
                        >{label}</button>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    className={cn(
                      'text-[9px] px-2 py-0.5 rounded font-semibold transition-colors',
                      nuancesAdvanced
                        ? 'bg-violet-400/20 text-violet-300 border border-violet-400/40'
                        : 'text-slate-500 border border-slate-700'
                    )}
                    onClick={() => setNuancesAdvanced(p => !p)}
                  >Advanced</button>
                </div>

                {nuancesAdvanced && (
                  <div className="space-y-3 pt-1">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Advanced</div>
                    {tier2.map(({ key, min, max }) => (
                      <div key={key} className="space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-400">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                          <span className="text-[10px] text-violet-400 font-mono">{cur[key]}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-slate-600 w-16 text-right shrink-0">{min}</span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={cur[key]}
                            onChange={(e) => setN(key, Number(e.target.value))}
                            title={key.replace(/([A-Z])/g, ' $1').trim()}
                            className="flex-1 h-1.5 accent-violet-500 cursor-pointer"
                          />
                          <span className="text-[9px] text-slate-600 w-16 shrink-0">{max}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Free-text write-in — folds into this segment's composed S2 nuance directive */}
                <div className="space-y-1 pt-1">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Write-in</div>
                  <input
                    type="text"
                    value={seg?.custom_nuance ?? ''}
                    onChange={(e) => {
                      const val = e.target.value
                      // Seed from displaySegments when importedSegments is still null/empty
                      // (fresh session with no structural edit yet) — otherwise the update
                      // would be a no-op and the field would appear un-typeable.
                      setImportedSegments(prev => {
                        const base = (prev && prev.length) ? prev : displaySegments
                        return base.map((s, i) => i === nIdx ? { ...s, custom_nuance: val } : s)
                      })
                    }}
                    placeholder="e.g. lingers on the last word, slight tremble"
                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-violet-500/60 focus:outline-none"
                  />
                  <div className="text-[9px] text-slate-600">Free-text delivery note, added to this segment's nuance directive on regenerate.</div>
                </div>

                <div className="pt-3">
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs bg-violet-500/20 text-violet-400 hover:bg-violet-500/30"
                    onClick={() => handleGenerateSpeech(nIdx)}
                    disabled={isRegenerating}
                  >
                    {isRegenerating ? 'Generating...' : 'Regenerate with Nuances'}
                  </Button>
                </div>
              </div>
            )
          })()}

          {/* Chord tab — always mounted to preserve curve state; hidden when not active */}
          <div
            className="flex-1 min-h-0 flex flex-col overflow-hidden"
            style={{ display: videoSubTab === 'chord' && rightPanelTab === 'result' ? 'flex' : 'none' }}
          >
            {(() => {
              // Reference segment takes priority when one is selected
              const refSeg = selectedReferenceIndex !== null ? referenceSegments?.[selectedReferenceIndex] : null
              const activeJobId = refSeg ? (referenceJobId ?? jobId) : jobId
              // Build a minimal Segment-compatible object for FloatingEmotionChart
              const chartSegment = refSeg
                ? {
                    id: refSeg.id,
                    index: refSeg.index,
                    start_time: refSeg.start,
                    end_time: refSeg.end,
                    source_text: refSeg.text,
                    target_text: refSeg.text,
                    active_text: refSeg.text,
                    preview_text: null,
                    isPreviewing: false,
                    speaker_id: refSeg.speaker_id,
                    speaker_label: refSeg.speaker_id,
                    audio_url: undefined,
                    committed_audio_url: undefined,
                    status: 'auto' as const,
                    qc_findings: [],
                    emotionalCurve: { combined: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], locked: false, analysis: { facial: [], vocal: [], scene: [] } },
                  }
                : (floatingEmotionSegment !== null ? displaySegments[floatingEmotionSegment] : null)

              return chartSegment ? (
              <FloatingEmotionChart
                embedded
                active={videoSubTab === 'chord' && rightPanelTab === 'result'}
                autoFiredRef={emotionAutoFiredRef}
                segment={chartSegment as any}
                segmentIndex={refSeg ? -1 : floatingEmotionSegment!}
                jobId={activeJobId}
                onClose={() => { setFloatingEmotionSegment(null); setSelectedReferenceIndex(null); setVideoSubTab(null) }}
                onCommitEmotion={(idx, emotion) => {
                  if (refSeg) return // reference segments don't update the job
                  setStagedEmotions(prev => ({ ...prev, [idx]: emotion }))
                  updateSegment(idx, { committed_emotion: emotion })
                  applyFlagOutcome(idx, 'emotion')
                }}
                onUpdateCurve={(idx, curve) => {
                  if (refSeg) return
                  updateSegment(idx, { velma_emotion_curve: curve })
                }}
                onUpdateProgression={(idx, markers) => {
                  if (refSeg) return
                  updateSegment(idx, { velma_progression: markers })
                }}
                onSaveChord={async (name, description, chord, intensity, curve) => {
                  await apiClient.saveEmotionalChord({
                    name,
                    emotion: chord.emotion,
                    state: chord.state,
                    trait: chord.trait,
                    intensity,
                  })
                  if (curve?.length) {
                    const seg = refSeg ?? (floatingEmotionSegment !== null ? displaySegments[floatingEmotionSegment] : null)
                    const duration = refSeg ? refSeg.end - refSeg.start : seg ? (seg as any).end_time - (seg as any).start_time : 0
                    const text = refSeg ? refSeg.text : (seg as any)?.active_text ?? (seg as any)?.target_text ?? ''
                    const saved = await apiClient.saveEmotionCurve({
                      name,
                      description: description || undefined,
                      curve,
                      duration,
                      core_emotion: chord.emotion,
                      source_segment_text: text,
                    })
                    setSavedCurves(prev => [saved as typeof prev[0], ...prev])
                  }
                }}
                onAnalyzeEmotion={async () => {
                  const startT = refSeg ? refSeg.start : displaySegments[floatingEmotionSegment!].start_time
                  const endT = refSeg ? refSeg.end : displaySegments[floatingEmotionSegment!].end_time
                  return apiClient.analyzeSegmentEmotion(activeJobId, startT, endT)
                }}
              />
              ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
                <div className="border border-slate-700 rounded-lg p-4 w-full max-w-xs flex flex-col gap-3">
                  {velmaEnrichResult && (
                    <p className="text-green-400 text-xs">Enriched {velmaEnrichResult.patched} / {velmaEnrichResult.total} segments</p>
                  )}
                  <button
                    disabled={velmaEnrichLoading}
                    onClick={async () => {
                      setVelmaEnrichLoading(true)
                      try {
                        const res = await apiClient.rediarizeWithVelma(jobId)
                        setVelmaEnrichResult({ patched: res.segments_patched, total: res.total_segments })
                      } catch (err: any) {
                        alert(`Velma enrichment failed: ${err.message}`)
                      } finally {
                        setVelmaEnrichLoading(false)
                      }
                    }}
                    className="px-3 py-1.5 rounded text-xs font-bold tracking-wide transition-all"
                    style={{
                      color: velmaEnrichLoading ? 'rgba(167,139,250,0.4)' : '#a78bfa',
                      background: 'rgba(167,139,250,0.1)',
                      border: '1px solid rgba(167,139,250,0.3)',
                      cursor: velmaEnrichLoading ? 'wait' : 'pointer',
                    }}
                  >
                    {velmaEnrichLoading ? '⏳ Running Velma…' : '🎙 Enrich Job with Velma'}
                  </button>
                </div>
              </div>
              )
            })()}
          </div>

          {/* Characters tab — per-job character profiles for translation */}
          {videoSubTab === 'characters' && rightPanelTab === 'result' && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <CharacterProfilesPanel jobId={jobId} />
            </div>
          )}

          {/* EI Library panel */}
          {rightPanelTab === 'ei-library' && hasFeature('emotionalIntelligence') && (() => {
            const filtered = savedCurves.filter(c =>
              !curveSearchQuery ||
              c.name.toLowerCase().includes(curveSearchQuery.toLowerCase()) ||
              (c.tags ?? []).some(t => t.toLowerCase().includes(curveSearchQuery.toLowerCase()))
            )
            const applyCurve = (saved: typeof savedCurves[0]) => {
              if (selectedSegmentIndex === null) return
              const seg = displaySegments[selectedSegmentIndex]
              if (!seg) return
              const targetDur = seg.end_time - seg.start_time
              const ratio = saved.duration > 0 ? targetDur / saved.duration : 1
              const stretched = saved.curve.map((v: number, i: number) => v)
              setImportedSegments(prev => {
                if (!prev) return prev
                return prev.map((s, i) => i === selectedSegmentIndex
                  ? { ...s, velma_emotion_curve: stretched }
                  : s)
              })
            }
            const deleteCurve = async (id: string) => {
              await apiClient.deleteEmotionCurve(id)
              setSavedCurves(prev => prev.filter(c => c.id !== id))
              setDeleteConfirmCurveId(null)
            }
            const Sparkline = ({ curve }: { curve: number[] }) => {
              if (!curve.length) return null
              const w = 80, h = 28
              const pts = curve.map((v, i) => `${(i / (curve.length - 1)) * w},${h - v * h}`)
              return (
                <svg width={w} height={h} className="shrink-0">
                  <polyline points={pts.join(' ')} fill="none" stroke="#a78bfa" strokeWidth="1.5" />
                </svg>
              )
            }
            const EMOTION_COLORS: Record<string, string> = {
              Excitement: 'bg-orange-500', Euphoria: 'bg-violet-500', Empathy: 'bg-green-500',
              Anger: 'bg-red-500', Sadness: 'bg-blue-500', Fear: 'bg-gray-500',
              Joy: 'bg-yellow-400', Trust: 'bg-teal-500', Anticipation: 'bg-amber-500',
            }
            return (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <div className="px-3 pt-2 pb-1">
                  <input
                    type="text"
                    placeholder="Search curves..."
                    value={curveSearchQuery}
                    onChange={e => setCurveSearchQuery(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white placeholder-slate-500 outline-none focus:border-violet-500"
                  />
                </div>
                {filtered.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center p-6 text-center">
                    <p className="text-xs text-slate-500">
                      {savedCurves.length === 0
                        ? 'No saved curves yet. Set an emotion curve on a segment, name it in the Chord view, and click Save.'
                        : 'No curves match your search.'}
                    </p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto px-2 py-1 space-y-2">
                    {filtered.map(curve => (
                      <div key={curve.id} className="bg-slate-800 border border-slate-700 rounded-lg p-2 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-white truncate">{curve.name}</div>
                            {curve.description && (
                              <div
                                className="text-[10px] text-slate-400 italic mt-0.5"
                                title={curve.description}
                                style={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                              >{curve.description}</div>
                            )}
                            {curve.source_segment_text && (
                              <div className="text-[10px] text-slate-500 italic truncate">&ldquo;{curve.source_segment_text}&rdquo;</div>
                            )}
                          </div>
                          <Sparkline curve={curve.curve as number[]} />
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {curve.core_emotion && (
                            <span className={cn('text-[9px] px-1.5 py-0.5 rounded text-white font-semibold', EMOTION_COLORS[curve.core_emotion] ?? 'bg-violet-600')}>
                              {curve.core_emotion}
                            </span>
                          )}
                          <span className="text-[9px] text-slate-500">{curve.duration?.toFixed(1)}s</span>
                          {(curve.tags ?? []).map(tag => (
                            <span key={tag} className="text-[9px] px-1 py-0.5 rounded bg-slate-700 text-slate-400">{tag}</span>
                          ))}
                        </div>
                        <div className="flex items-center gap-1 pt-0.5">
                          <button
                            type="button"
                            className="flex-1 py-0.5 rounded text-[10px] bg-violet-500/20 text-violet-300 border border-violet-500/40 hover:bg-violet-500/40 transition-colors"
                            onClick={() => applyCurve(curve)}
                            disabled={selectedSegmentIndex === null}
                          >
                            Apply
                          </button>
                          {deleteConfirmCurveId === curve.id ? (
                            <>
                              <button type="button" className="px-2 py-0.5 rounded text-[10px] bg-red-500/30 text-red-300 border border-red-500/40 hover:bg-red-500/50 transition-colors" onClick={() => deleteCurve(curve.id)}>Confirm</button>
                              <button type="button" className="px-2 py-0.5 rounded text-[10px] text-slate-400 border border-slate-700 hover:text-slate-200 transition-colors" onClick={() => setDeleteConfirmCurveId(null)}>Cancel</button>
                            </>
                          ) : (
                            <button type="button" className="px-2 py-0.5 rounded text-[10px] text-slate-500 border border-slate-700 hover:text-red-400 hover:border-red-500/40 transition-colors" onClick={() => setDeleteConfirmCurveId(curve.id)}>Delete</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Advanced tab — embedded chord browser in panel */}
          <div
            className="flex-1 min-h-0 flex flex-col overflow-hidden"
            style={{ display: videoSubTab === 'advanced' && rightPanelTab === 'result' ? 'flex' : 'none' }}
          >
            {advancedBrowserSegment !== null && displaySegments[advancedBrowserSegment] ? (
              <AdvancedChordBrowser
                embedded
                segment={displaySegments[advancedBrowserSegment]}
                segmentIndex={advancedBrowserSegment}
                onClose={() => { setAdvancedBrowserSegment(null); setVideoSubTab(null) }}
                onApply={(markers) => {
                  updateSegment(advancedBrowserSegment, { velma_progression: markers })
                }}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
                Double-click a segment in the Emotion track
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Character Profile — right-click → "Character Profile" floating popover */}
      {characterProfileOpen && displaySegments[characterProfileOpen.segmentIndex] && (
        <CharacterProfilePopover
          segmentIndex={characterProfileOpen.segmentIndex}
          x={characterProfileOpen.x}
          y={characterProfileOpen.y}
          onClose={() => setCharacterProfileOpen(null)}
          onClearSegment={handleClearSegment}
          segment={displaySegments[characterProfileOpen.segmentIndex]}
          speakerVoiceMap={speakerVoiceMap}
          speakerPitchMap={speakerPitchMap}
          stagedEmotions={stagedEmotions}
          stagedSpeeds={stagedSpeeds}
          stagedVoices={stagedVoices}
        />
      )}

      <CustomVoicesModal
        open={customVoicesOpen}
        onOpenChange={setCustomVoicesOpen}
        onChanged={() => setCustomVoicesVersion(v => v + 1)}
      />

      {/* Ask AI — draggable floating panel */}
      {askAiOpen && (() => {
        const seg = selectedSegmentIndex !== null ? displaySegments[selectedSegmentIndex] : null
        const QUICK = [
          'Make this sound more natural',
          "Match the character's emotion",
          'Shorten to fit lip-sync',
          'Improve the translation',
        ]
        const AI_MODELS = [
          { id: 'haiku'  as const, label: 'Haiku 4.5',  desc: 'Fast · everyday edits',            color: '#60a5fa' },
          { id: 'sonnet' as const, label: 'Sonnet 4.6', desc: 'Balanced · recommended',            color: '#a78bfa' },
          { id: 'opus'   as const, label: 'Opus 4.8',   desc: 'Most capable · complex rewrites',   color: '#f59e0b' },
        ]
        const submit = async (prompt: string) => {
          if (!prompt.trim() || askAiLoading) return
          setAskAiLoading(true)
          setAskAiResult(null)
          try {
            const res = await apiClient.askAI({
              prompt,
              model: askAiModel,
              source_text: seg?.source_text ?? '',
              dubbed_text: seg?.preview_text ?? seg?.active_text ?? seg?.target_text ?? '',
              source_language: sourceLanguage,
              target_language: targetLanguage,
              speaker_label: seg?.speaker_label ?? '',
              speaker_gender: seg?.speaker_gender ?? 'male',
            })
            setAskAiResult(res)
          } catch (e: any) {
            setAskAiResult({ suggestion: '', explanation: `Error: ${e.message}` })
          } finally {
            setAskAiLoading(false)
          }
        }
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setAskAiOpen(false)} />
            <div
              className="fixed z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[600px] animate-in fade-in-0 zoom-in-95 duration-150 flex flex-col"
              style={{ left: askAiPos.x, top: askAiPos.y, maxHeight: 'calc(100vh - 80px)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag handle / header */}
              <div
                className="flex items-center justify-between px-4 py-3 border-b border-slate-800 cursor-grab active:cursor-grabbing select-none shrink-0"
                onMouseDown={(e) => {
                  e.preventDefault()
                  const panel = (e.currentTarget as HTMLElement).parentElement as HTMLElement
                  const rect = panel.getBoundingClientRect()
                  const ox = e.clientX - rect.left, oy = e.clientY - rect.top
                  const onMove = (ev: MouseEvent) => setAskAiPos({ x: ev.clientX - ox, y: ev.clientY - oy })
                  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
                  document.addEventListener('mousemove', onMove)
                  document.addEventListener('mouseup', onUp)
                }}
              >
                <span className="text-sm font-semibold text-amber-400 flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  Ask AI
                  {seg && <span className="text-slate-500 font-normal text-xs">— Segment {selectedSegmentIndex! + 1}</span>}
                </span>
                <button type="button" title="Close" onClick={() => setAskAiOpen(false)} className="text-slate-500 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Model selector */}
              <div className="px-4 pt-3 pb-3 border-b border-slate-800 shrink-0">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-2">Select AI Model</p>
                <div className="flex gap-2">
                  {AI_MODELS.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setAskAiModel(m.id)}
                      className="flex-1 flex flex-col items-start px-3 py-2.5 rounded-lg transition-all text-left"
                      style={{
                        background: askAiModel === m.id ? `${m.color}18` : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${askAiModel === m.id ? m.color + '55' : 'rgba(255,255,255,0.08)'}`,
                        boxShadow: askAiModel === m.id ? `0 0 10px ${m.color}22` : 'none',
                      }}
                    >
                      <span className="text-xs font-semibold" style={{ color: askAiModel === m.id ? m.color : '#94a3b8' }}>{m.label}</span>
                      <span className="text-[10px] mt-0.5 leading-snug" style={{ color: askAiModel === m.id ? m.color + 'bb' : '#475569' }}>{m.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 space-y-3 overflow-y-auto">
                {/* Segment context */}
                {seg && (
                  <div className="bg-slate-800 rounded-lg p-3 space-y-1.5 text-xs">
                    <div className="flex gap-2">
                      <span className="text-slate-500 w-14 shrink-0">Original</span>
                      <span className="text-slate-300">{seg.source_text}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-slate-500 w-14 shrink-0">Dubbed</span>
                      <span className="text-amber-300">{seg.preview_text ?? seg.active_text ?? seg.target_text}</span>
                    </div>
                  </div>
                )}

                {/* Quick prompts */}
                <div className="flex flex-wrap gap-1.5">
                  {QUICK.map(q => (
                    <button
                      key={q}
                      type="button"
                      className="px-2.5 py-1.5 rounded-full text-[11px] bg-slate-800 hover:bg-amber-500/20 text-slate-400 hover:text-amber-300 border border-slate-700 hover:border-amber-500/40 transition-colors"
                      onClick={() => { setAskAiPrompt(q); submit(q) }}
                    >
                      {q}
                    </button>
                  ))}
                </div>

                {/* Custom prompt */}
                <div className="flex gap-2">
                  <input
                    aria-label="Ask AI prompt"
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
                    placeholder="Ask anything about this segment…"
                    value={askAiPrompt}
                    onChange={e => setAskAiPrompt(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submit(askAiPrompt) }}
                  />
                  <Button
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white shrink-0 px-4"
                    onClick={() => submit(askAiPrompt)}
                    disabled={!askAiPrompt.trim() || askAiLoading}
                  >
                    {askAiLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  </Button>
                </div>

                {/* AI response */}
                {askAiLoading && (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-3">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Claude {AI_MODELS.find(m => m.id === askAiModel)?.label} is thinking…
                  </div>
                )}
                {askAiResult && !askAiLoading && (
                  <div className="bg-amber-500/10 border border-amber-500/25 rounded-lg p-4 space-y-3">
                    <p className="text-sm text-amber-200 font-medium leading-relaxed">"{askAiResult.suggestion}"</p>
                    {askAiResult.explanation && (
                      <p className="text-xs text-slate-400 leading-relaxed">{askAiResult.explanation}</p>
                    )}
                    {askAiResult.suggestion && selectedSegmentIndex !== null && (
                      <Button
                        size="sm"
                        className="w-full bg-amber-600 hover:bg-amber-700 text-white text-xs h-8"
                        onClick={() => {
                          updateSegment(selectedSegmentIndex, { target_text: askAiResult!.suggestion, active_text: askAiResult!.suggestion, variant_text: askAiResult!.suggestion, preview_text: null, isPreviewing: false, isUserEdited: false, status: 'edited' })
                          setAskAiOpen(false)
                        }}
                      >
                        <Check className="h-3 w-3 mr-1.5" />
                        Apply suggestion
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )
      })()}

      {/* Voice pitch popup — appears after dragging a voice onto a segment */}
      {pitchPopupIndex !== null && (
        <>
          {/* Click-outside overlay */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setPitchPopupIndex(null)}
          />
          <div
            className="fixed z-50 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-5 w-72 animate-in fade-in-0 zoom-in-95 duration-150"
            style={{ left: pitchPopupPos.x, top: pitchPopupPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-cyan-400 flex items-center gap-2">
                <Music2 className="h-4 w-4" />
                Pitch — Segment {pitchPopupIndex + 1}
                {stagedVoices[pitchPopupIndex] && (
                  <span className="text-[10px] font-normal text-slate-400">
                    ({VOICE_OPTIONS.find(v => v.key === stagedVoices[pitchPopupIndex])?.label})
                  </span>
                )}
              </span>
              <button type="button" title="Close" onClick={() => setPitchPopupIndex(null)} className="text-slate-500 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Big pitch display + ± buttons */}
            <div className="flex items-center justify-center gap-4 mb-4">
              <button
                type="button"
                className="h-9 w-9 rounded-full bg-slate-700 hover:bg-slate-600 text-white text-lg font-bold flex items-center justify-center transition-colors"
                onClick={() => setPitchPopupIndex(idx => {
                  if (idx !== null) setStagedPitches(prev => ({ ...prev, [idx]: Math.max(-6, (prev[idx] ?? 0) - 1) }))
                  return idx
                })}
              >−</button>
              <span
                className={cn(
                  "text-4xl font-mono w-28 text-center cursor-pointer select-none transition-colors",
                  (stagedPitches[pitchPopupIndex] ?? 0) !== 0 ? "text-cyan-400" : "text-white"
                )}
                title="Click to reset"
                onClick={() => setStagedPitches(prev => { const n = { ...prev }; delete n[pitchPopupIndex!]; return n })}
              >
                {(stagedPitches[pitchPopupIndex] ?? 0) > 0 ? '+' : ''}{stagedPitches[pitchPopupIndex] ?? 0}
                <span className="text-lg ml-1 text-slate-400">st</span>
              </span>
              <button
                type="button"
                className="h-9 w-9 rounded-full bg-slate-700 hover:bg-slate-600 text-white text-lg font-bold flex items-center justify-center transition-colors"
                onClick={() => setPitchPopupIndex(idx => {
                  if (idx !== null) setStagedPitches(prev => ({ ...prev, [idx]: Math.min(6, (prev[idx] ?? 0) + 1) }))
                  return idx
                })}
              >+</button>
            </div>

            {/* Slider */}
            <Slider
              value={[stagedPitches[pitchPopupIndex] ?? 0]}
              onValueChange={([v]) => setStagedPitches(prev => ({ ...prev, [pitchPopupIndex!]: v }))}
              min={-6}
              max={6}
              step={1}
              className="w-full mb-1"
            />
            <div className="flex justify-between text-[10px] text-slate-600 mb-5">
              <span>−6 st</span><span>0</span><span>+6 st</span>
            </div>

            {/* Generate */}
            <Button
              className="w-full bg-amber-600 hover:bg-amber-700 text-white"
              size="sm"
              onClick={() => { setPitchPopupIndex(null); handleGenerateSpeech() }}
            >
              <Sparkles className="h-4 w-4 mr-1" />
              Generate Speech
            </Button>
          </div>
        </>
      )}

      {/* Speed correction popup */}
      {speedPopupIndex !== null && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSpeedPopupIndex(null)} />
          <div
            className="fixed z-50 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-5 w-72 animate-in fade-in-0 zoom-in-95 duration-150"
            style={{ left: speedPopupPos.x, top: speedPopupPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-orange-400 flex items-center gap-2">
                <Gauge className="h-4 w-4" />
                Speed — Segment {speedPopupIndex + 1}
              </span>
              <button type="button" title="Close" onClick={() => setSpeedPopupIndex(null)} className="text-slate-500 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Big speed display + ± buttons */}
            <div className="flex items-center justify-center gap-4 mb-4">
              <button
                type="button"
                className="h-9 w-9 rounded-full bg-slate-700 hover:bg-slate-600 text-white text-lg font-bold flex items-center justify-center transition-colors"
                onClick={() => setSpeedPopupIndex(idx => {
                  if (idx !== null) setStagedSpeeds(prev => ({ ...prev, [idx]: Math.max(0.5, parseFloat(((prev[idx] ?? 1.0) - 0.1).toFixed(2))) }))
                  return idx
                })}
              >−</button>
              <span
                className={cn(
                  "text-4xl font-mono w-28 text-center cursor-pointer select-none transition-colors",
                  (stagedSpeeds[speedPopupIndex] ?? 1.0) !== 1.0 ? "text-orange-400" : "text-white"
                )}
                title="Click to reset"
                onClick={() => setStagedSpeeds(prev => { const n = { ...prev }; delete n[speedPopupIndex!]; return n })}
              >
                {(stagedSpeeds[speedPopupIndex] ?? 1.0).toFixed(2)}
                <span className="text-lg ml-0.5 text-slate-400">×</span>
              </span>
              <button
                type="button"
                className="h-9 w-9 rounded-full bg-slate-700 hover:bg-slate-600 text-white text-lg font-bold flex items-center justify-center transition-colors"
                onClick={() => setSpeedPopupIndex(idx => {
                  if (idx !== null) setStagedSpeeds(prev => ({ ...prev, [idx]: Math.min(2.0, parseFloat(((prev[idx] ?? 1.0) + 0.1).toFixed(2))) }))
                  return idx
                })}
              >+</button>
            </div>

            {/* Slider */}
            <Slider
              value={[stagedSpeeds[speedPopupIndex] ?? 1.0]}
              onValueChange={([v]) => setStagedSpeeds(prev => ({ ...prev, [speedPopupIndex!]: v }))}
              min={0.5}
              max={2.0}
              step={0.05}
              className="w-full mb-1"
            />
            <div className="flex justify-between text-[10px] text-slate-600 mb-5">
              <span>0.5× slow</span><span>1.0× normal</span><span>2.0× fast</span>
            </div>

            {/* Preset buttons */}
            <div className="flex gap-1.5 mb-4 justify-center">
              {[0.5, 0.75, 1.0, 1.25, 1.5].map(preset => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setStagedSpeeds(prev => ({ ...prev, [speedPopupIndex!]: preset }))}
                  className={cn(
                    'text-[10px] px-2 py-1 rounded-md border transition-colors font-mono',
                    (stagedSpeeds[speedPopupIndex] ?? 1.0) === preset
                      ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                      : 'bg-slate-700 text-slate-400 border-slate-600 hover:bg-slate-600'
                  )}
                >
                  {preset}×
                </button>
              ))}
            </div>

            {/* Generate */}
            <Button
              className="w-full bg-amber-600 hover:bg-amber-700 text-white"
              size="sm"
              onClick={() => { setSpeedPopupIndex(null); handleGenerateSpeech() }}
            >
              <Sparkles className="h-4 w-4 mr-1" />
              Generate Speech
            </Button>
          </div>
        </>
      )}

      
      {/* Timeline - Resizable with 4 tracks */}
      <div 
        className="border-t border-neutral-800 bg-neutral-900 flex flex-col relative"
        style={{ height: timelineHeight }}
      >
        {/* Resize handle at top */}
        <div
          className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-amber-500/50 transition-colors z-20 group"
          onMouseDown={handleTimelineResizeStart}
        >
          <div className={cn(
            "absolute inset-x-0 top-0 h-0.5 bg-amber-500/30 group-hover:bg-amber-500",
            isResizingTimeline && "bg-amber-500"
          )} />
        </div>
        {/* Timeline toolbar */}
        <div className="relative flex items-center justify-between px-4 py-2 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 w-7 p-0"
                    onClick={(e) => {
                      if (e.shiftKey) {
                        setIsMuted(!isMuted)
                        e.preventDefault()
                      }
                    }}
                  >
                    {isMuted ? <VolumeX className="h-4 w-4 text-red-400" /> : <Volume2 className="h-4 w-4" />}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 bg-slate-900 border-slate-700 p-3">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">Master Volume</span>
                      <span className="text-xs text-slate-300 font-mono">{masterVolume}%</span>
                    </div>
                    <Slider
                      value={[masterVolume]}
                      onValueChange={(v) => setMasterVolume(v[0])}
                      max={100}
                      step={1}
                      className="w-full"
                    />
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full h-7 text-xs"
                      onClick={() => setIsMuted(!isMuted)}
                    >
                      {isMuted ? 'Unmute All' : 'Mute All'}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <Grid3X3 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Clear editor" onClick={() => setShowRevertAllConfirm(true)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {/* Playback controls — absolute center */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
            <span className="text-sm font-mono text-slate-400">
              {formatTime(currentTime)} / {formatTime(videoDuration)}
            </span>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentTime(0)}>
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={async () => {
                // Drive video play/pause synchronously BEFORE any await
                // so Chrome's autoplay policy isn't violated for audio
                if (videoRef.current) {
                  if (isPlaying) {
                    videoRef.current.pause()
                  } else {
                    lastStartPosRef.current = currentTime  // save start pos for Stop
                    videoRef.current.play().catch(() => {})
                  }
                }
                // Create and resume AudioContext inside user gesture
                // to satisfy browser autoplay policy
                if (!audioContextRef.current) {
                  audioContextRef.current = new AudioContext()
                }
                if (audioContextRef.current.state === 'suspended') {
                  await audioContextRef.current.resume()
                }
                // If in Preview and buffer not ready, stitch first
                if (playbackMode === 'preview' && !isPlaying && !rptBufferRef.current) {
                  lastStartPosRef.current = currentTime
                  const ctx = audioContextRef.current
                  const resolved = segments.map(seg => {
                    const resolveUrl = (url: string | undefined) => {
                      if (!url || !jobId) return url
                      if (url.startsWith('http')) return url
                      const filename = url.split('/').pop()
                      return filename ? apiClient.getAudioFileUrl(jobId, filename) : url
                    }
                    return {
                      ...seg,
                      audio_url: resolveUrl(seg.audio_url),
                      committed_audio_url: resolveUrl(seg.committed_audio_url),
                    }
                  })
                  stitchRPT(resolved, videoDuration, ctx).then(result => {
                    if (result) {
                      rptBufferRef.current = result.buffer
                      setIsPlaying(true)
                    }
                  })
                } else {
                  setIsPlaying(!isPlaying)
                }
              }}
            >
              {isPlaying
                ? <Pause className={playbackMode === 'preview' ? 'h-4 w-4 text-amber-400' : 'h-4 w-4'} />
                : isSegmentPreviewing
                  ? <Pause className="h-4 w-4 text-amber-400" />
                  : selectedSegmentIndex !== null
                    ? <PlayCircle className="h-4 w-4 text-amber-400" />
                    : <Play className={playbackMode === 'preview' ? 'h-4 w-4 text-amber-400' : 'h-4 w-4'} />
              }
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => {
                const returnTo = lastStartPosRef.current
                if (videoRef.current) {
                  videoRef.current.pause()
                  videoRef.current.currentTime = returnTo
                }
                setIsPlaying(false)
                setCurrentTime(returnTo)
              }}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentTime(videoDuration)}>
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>
          
          {/* Zoom + panel tab toggles — grouped on the right */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setZoomLevel(zoomLevel / 1.5)}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Slider
              className="w-24"
              min={0.25}
              max={4}
              step={0.25}
              value={[zoomLevel]}
              onValueChange={([v]) => setZoomLevel(v)}
            />
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setZoomLevel(zoomLevel * 1.5)}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <div className="w-px h-5 bg-white/10 mx-1" />
            {([
              { id: 'chord',      label: '🎼 Chord',      feature: 'emotionalCurveEditor' },
              { id: 'advanced',   label: '🎛 Advanced',   feature: 'emotionalCurveEditor' },
              { id: 'characters', label: '🎭 Characters', feature: 'characterProfiles' },
            ] as const).filter(t => hasFeature(t.feature as any)).map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setVideoSubTab(prev => prev === t.id ? null : t.id)}
                className="text-xs px-2.5 py-1 rounded-md transition-all font-medium"
                style={{
                  background: videoSubTab === t.id ? 'rgba(167,139,250,0.15)' : 'transparent',
                  color: videoSubTab === t.id ? '#a78bfa' : '#64748b',
                  border: `1px solid ${videoSubTab === t.id ? 'rgba(167,139,250,0.35)' : 'transparent'}`,
                }}
              >
                {t.label}
              </button>
            ))}
            <div className="w-px h-5 bg-white/10 mx-1" />
            <button
              type="button"
              onClick={() => {
                const url = activeDubbedVideoUrl ?? dubbedVideoUrl
                if (!url) return
                const a = document.createElement('a')
                a.href = url
                a.download = `${title || jobId}_dubbed.mp4`
                a.click()
              }}
              title={activeDubbedVideoUrl ?? dubbedVideoUrl ? 'Download dubbed video' : 'No dubbed video yet'}
              className="text-xs px-2.5 py-1 rounded-md transition-all font-medium flex items-center gap-1.5"
              style={{
                background: 'transparent',
                color: (activeDubbedVideoUrl ?? dubbedVideoUrl) ? '#34d399' : '#475569',
                border: '1px solid transparent',
                cursor: (activeDubbedVideoUrl ?? dubbedVideoUrl) ? 'pointer' : 'not-allowed',
                opacity: (activeDubbedVideoUrl ?? dubbedVideoUrl) ? 1 : 0.45,
              }}
            >
              ⬇ Download
            </button>
          </div>
        </div>
        
        {/* Timeline tracks */}
        <div className="flex-1 flex overflow-hidden">
          {/* QC Monitor - permanent fixture left of timeline tracks */}
          <div className="shrink-0 border-r border-neutral-700 bg-neutral-950 flex flex-col overflow-hidden relative" style={{ width: qcMonitorWidth }}>
              {/* Resize handle - right edge */}
              <div
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-amber-500/50 transition-colors z-20 group"
                onMouseDown={(e) => {
                  e.preventDefault()
                  const startX = e.clientX
                  const startW = qcMonitorWidth
                  setIsResizingQcMonitor(true)
                  const onMove = (ev: MouseEvent) => {
                    const delta = ev.clientX - startX
                    const next = Math.max(200, Math.min(600, startW + delta))
                    setQcMonitorWidth(next)
                  }
                  const onUp = () => {
                    setIsResizingQcMonitor(false)
                    localStorage.setItem('dubverse.editor.qcMonitorWidth', String(qcMonitorWidth))
                    document.removeEventListener('mousemove', onMove)
                    document.removeEventListener('mouseup', onUp)
                  }
                  document.addEventListener('mousemove', onMove)
                  document.addEventListener('mouseup', onUp)
                }}
              >
                <div className={cn(
                  "absolute inset-y-0 right-0 w-0.5 bg-amber-500/30 group-hover:bg-amber-500",
                  isResizingQcMonitor && "bg-amber-500"
                )} />
              </div>
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-neutral-900">
                <div className="flex items-center gap-2">
                  <Gauge className={cn("h-4 w-4", qcLoading && !qcAnalysis ? "text-amber-400 animate-pulse" : "text-amber-400")} />
                  <span className="text-sm font-semibold text-white">QC Monitor</span>
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => onReanalyze?.()}
                    disabled={!canReanalyze || qcLoading}
                    title={canReanalyze
                      ? 'Re-run QC analysis on the last rendered video'
                      : 'Rebuild the video first to enable re-analysis'}
                    className={cn(
                      'flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border transition-colors',
                      (!canReanalyze || qcLoading)
                        ? 'border-slate-700 text-slate-500 cursor-not-allowed'
                        : 'border-amber-500/40 text-amber-300 hover:bg-amber-500/10'
                    )}
                  >
                    <RefreshCw className={cn('h-3 w-3', qcLoading && 'animate-spin')} />
                    {qcLoading ? 'Analyzing…' : 'Re-analyze'}
                  </button>
                  {qcUpdatedAt && (
                    <span className={cn(
                      'absolute top-full right-0 mt-1 text-[10px] text-emerald-400/90 whitespace-nowrap transition-opacity duration-700 pointer-events-none',
                      showReanalyzedNote ? 'opacity-100' : 'opacity-0'
                    )}>
                      Updated {new Date(qcUpdatedAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>
              {/* QC Content */}
              <div className="flex-1 overflow-y-auto">
                {qcLoading && !qcAnalysis && (
                  <div className="p-4 space-y-3">
                    <div className="text-xs text-white text-center pb-1">Analyzing dub quality…</div>
                    <div className="space-y-1.5"><div className="h-2.5 w-[72%] rounded-full bg-slate-800 animate-pulse" /><div className="h-1.5 w-[57%] rounded-full bg-slate-800/60 animate-pulse" /></div>
                    <div className="space-y-1.5"><div className="h-2.5 w-[88%] rounded-full bg-slate-800 animate-pulse" /><div className="h-1.5 w-[73%] rounded-full bg-slate-800/60 animate-pulse" /></div>
                    <div className="space-y-1.5"><div className="h-2.5 w-[60%] rounded-full bg-slate-800 animate-pulse" /><div className="h-1.5 w-[45%] rounded-full bg-slate-800/60 animate-pulse" /></div>
                    <div className="space-y-1.5"><div className="h-2.5 w-[80%] rounded-full bg-slate-800 animate-pulse" /><div className="h-1.5 w-[65%] rounded-full bg-slate-800/60 animate-pulse" /></div>
                    <div className="space-y-1.5"><div className="h-2.5 w-[50%] rounded-full bg-slate-800 animate-pulse" /><div className="h-1.5 w-[35%] rounded-full bg-slate-800/60 animate-pulse" /></div>
                  </div>
                )}
                <QCQualityPanel
                  report={qcReport}
                  segment={selectedSegmentIndex !== null ? displaySegments[selectedSegmentIndex] : null}
                  onJumpToTime={(t) => {
                    setCurrentTime(t)
                    if (videoRef.current) videoRef.current.currentTime = t
                    const container = timelineRef.current
                    if (container) {
                      const px = t * PIXELS_PER_SECOND
                      container.scrollLeft = Math.max(0, px - container.clientWidth * 0.3)
                    }
                  }}
                  onSelectFinding={(finding) => {
                    setSelectedQCFinding(finding)
                    setCurrentTime(finding.timestamp_start)
                    if (videoRef.current) videoRef.current.currentTime = finding.timestamp_start
                    const container = timelineRef.current
                    if (container) {
                      const px = finding.timestamp_start * PIXELS_PER_SECOND
                      container.scrollLeft = Math.max(0, px - container.clientWidth * 0.3)
                    }
                    if (finding.segment_index >= 0 && finding.segment_index < displaySegments.length) {
                      selectSegment(finding.segment_index)
                    }
                  }}
                  onApplyFix={(finding) => {
                    if (finding.segment_index < 0 || finding.segment_index >= displaySegments.length) return
                    const seg = displaySegments[finding.segment_index]
                    const retranscriptionText = finding.type === 'pronunciation'
                      ? qcReport?.retranscription.items.find(
                          item => Math.abs(item.start - finding.timestamp_start) < 1
                        )?.text
                      : undefined
                    const fixResult = applyQCFix(finding, seg, { retranscriptionText })
                    if (fixResult) updateSegment(finding.segment_index, fixResult.patch)
                  }}
                  onSelectSegment={(retranscriptionIndex) => {
                    setSelectedRetranscriptionIndex(retranscriptionIndex)
                    // Find the corresponding segment based on the re-transcription timestamp
                    const retranscriptionItem = qcReport?.retranscription.items[retranscriptionIndex]
                    if (retranscriptionItem) {
                      // Find the segment that matches this timestamp
                      const matchingSegmentIndex = displaySegments.findIndex(
                        seg => Math.abs(seg.start_time - retranscriptionItem.start) < 0.5
                      )
                      if (matchingSegmentIndex >= 0) {
                        selectSegment(matchingSegmentIndex)
                        setCurrentTime(displaySegments[matchingSegmentIndex].start_time)
                        if (videoRef.current) videoRef.current.currentTime = displaySegments[matchingSegmentIndex].start_time
                        const container = timelineRef.current
                        if (container) {
                          const px = displaySegments[matchingSegmentIndex].start_time * PIXELS_PER_SECOND
                          container.scrollLeft = Math.max(0, px - container.clientWidth * 0.3)
                        }
                      }
                    }
                  }}
                  selectedRetranscriptionIndex={selectedRetranscriptionIndex ?? undefined}
                />
              </div>
          </div>
          {/* Track labels - resizable left column */}
          <div className="shrink-0 border-r border-neutral-700 bg-neutral-900/80 flex flex-col relative overflow-hidden" style={{ width: trackLabelWidth }}>
            {/* Resize handle - right edge */}
            <div
              className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-amber-500/50 transition-colors z-20 group"
              onMouseDown={(e) => {
                e.preventDefault()
                const startX = e.clientX
                const startW = trackLabelWidth
                setIsResizingTrackLabel(true)
                const onMove = (ev: MouseEvent) => {
                  const delta = ev.clientX - startX
                  const next = Math.max(60, Math.min(280, startW + delta))
                  setTrackLabelWidth(next)
                }
                const onUp = () => {
                  setIsResizingTrackLabel(false)
                  localStorage.setItem('dubverse.editor.trackLabelWidth', String(trackLabelWidth))
                  document.removeEventListener('mousemove', onMove)
                  document.removeEventListener('mouseup', onUp)
                }
                document.addEventListener('mousemove', onMove)
                document.addEventListener('mouseup', onUp)
              }}
            >
              <div className={cn(
                "absolute inset-y-0 right-0 w-0.5 bg-amber-500/30 group-hover:bg-amber-500",
                isResizingTrackLabel && "bg-amber-500"
              )} />
            </div>
            {/* Each spacer/label MUST match its track height exactly */}
            <div className="h-6 shrink-0 border-b border-neutral-800 bg-neutral-900" />
            <div className="h-10 shrink-0 border-b border-neutral-700 bg-neutral-900" />
            <div className="h-16 shrink-0 flex items-center px-2 text-xs text-neutral-400 border-b border-neutral-800">Video</div>
            <div className="h-14 shrink-0 flex flex-col justify-center px-2 text-xs text-neutral-400 border-b border-neutral-800 gap-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setIsMutedOriginal(v => !v)} className="flex-shrink-0">
                    {isMutedOriginal ? <VolumeX className="h-3 w-3 text-red-400" /> : <Volume2 className="h-3 w-3 text-blue-400" />}
                  </button>
                  <span className="truncate">Original</span>
                </div>
                <span className="font-mono text-neutral-500 text-[10px]">{originalTextVolume}</span>
              </div>
              <Slider
                value={[originalTextVolume]}
                onValueChange={(v) => setOriginalTextVolume(v[0])}
                max={100}
                step={1}
                thumbless
                className="w-full h-1"
              />
            </div>
            {/* Reference track label — shown only when a reference video has been imported */}
            {referenceSegments && referenceSegments.length > 0 && (
              <div className="h-14 shrink-0 flex flex-col justify-center px-2 text-xs border-b border-amber-800/40 gap-0.5 bg-amber-950/20">
                <span className="truncate text-amber-400/80 font-medium">Reference</span>
                {referenceDetectedLang && (
                  <span className="text-[10px] text-neutral-500 uppercase">{referenceDetectedLang}</span>
                )}
              </div>
            )}

            <div className="h-14 shrink-0 flex flex-col justify-center px-2 text-xs text-neutral-400 border-b border-neutral-800 gap-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setIsMutedDubbed(v => !v)} className="flex-shrink-0">
                    {isMutedDubbed ? <VolumeX className="h-3 w-3 text-red-400" /> : <Volume2 className="h-3 w-3 text-amber-400" />}
                  </button>
                  <span className="truncate">Dubbed</span>
                </div>
                <span className="font-mono text-neutral-500 text-[10px]">{dubbedTextVolume}</span>
              </div>
              <Slider
                value={[dubbedTextVolume]}
                onValueChange={(v) => setDubbedTextVolume(v[0])}
                max={100}
                step={1}
                thumbless
                className="w-full h-1"
              />
            </div>

            {/* RPT Audio label */}
            <div className="h-20 shrink-0 flex flex-col justify-center px-2 text-xs text-neutral-400 border-b border-neutral-800 gap-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setIsMutedRPT(v => !v)} className="flex-shrink-0">
                    {isMutedRPT ? <VolumeX className="h-3 w-3 text-red-400" /> : <Volume2 className="h-3 w-3 text-amber-400" />}
                  </button>
                  <span className="truncate text-amber-400">Preview Audio</span>
                </div>
                <span className="font-mono text-neutral-500 text-[10px]">{rptVolume}</span>
              </div>
              <Slider
                value={[rptVolume]}
                onValueChange={(v) => setRptVolume(v[0])}
                max={100}
                step={1}
                thumbless
                className="w-full h-1"
              />
              <div className="flex items-center gap-1 pt-0.5">
                {[0.5, 0.75, 1, 1.25, 1.5].map(rate => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setRptPlaybackRate(rate)}
                    className={cn(
                      'text-[9px] px-1.5 py-0.5 rounded border transition-colors',
                      rptPlaybackRate === rate
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                        : 'bg-neutral-800 border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:border-neutral-500'
                    )}
                  >
                    {rate === 1 ? '1×' : `${rate}×`}
                  </button>
                ))}
              </div>
            </div>
            {/* Emotional curve track label */}
            {hasFeature('emotionalCurveEditor') && (
            <div className="h-24 shrink-0 flex items-start px-2 pt-2 text-xs text-neutral-400 border-b border-neutral-700 bg-neutral-900/30">
              <div className="flex flex-col text-xs text-slate-300 select-none">
                <span className="font-semibold mb-1">Emotion</span>

                <div className="flex items-center gap-1 mt-1">
                  <button
                    type="button"
                    onClick={() => setEmotionSource('auto')}
                    className={`text-[9px] px-2 py-0.5 rounded font-semibold transition-colors ${
                      emotionSource === 'auto'
                        ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                        : 'text-slate-500 border border-slate-700'
                    }`}
                  >Auto</button>
                  <button
                    type="button"
                    onClick={() => setEmotionSource('advanced')}
                    className={`text-[9px] px-2 py-0.5 rounded font-semibold transition-colors ${
                      emotionSource === 'advanced'
                        ? 'bg-violet-400/20 text-violet-300 border border-violet-400/40'
                        : 'text-slate-500 border border-slate-700'
                    }`}
                  >Advanced</button>
                </div>
              </div>
            </div>
            )}
            {/* Filler + bottom ruler spacer */}
            <div className="flex-1 bg-neutral-900/50 border-b border-neutral-800" />
            <div className="h-5 shrink-0 bg-neutral-900 border-t border-neutral-700" />
          </div>

          {/* Scrollable timeline */}
          <div 
            ref={timelineRef} 
            className="flex-1 overflow-x-auto overflow-y-hidden flex flex-col"
            onWheel={handleTimelineWheel}
          >
            <div
              className="flex flex-col min-h-full relative"
              style={{ minWidth: timelineWidth, width: '100%' }}
              data-timeline-container
              onMouseMove={handleTimelineMouseMove}
              onMouseUp={handleTimelineMouseUpWrapper}
              onClick={(e) => {
                // Don't move needle during group move
                if (groupMoveActiveRef.current) return

                const target = e.target as HTMLElement
                if (target.closest('[data-segment-block]')) return
                if (target.closest('[data-emotion-segment]')) return
                const rect = timelineRef.current?.getBoundingClientRect()
                if (!rect) return
                const scrollLeft = timelineRef.current?.scrollLeft ?? 0
                const x = e.clientX - rect.left + scrollLeft
                const newTime = Math.max(0, Math.min(x / PIXELS_PER_SECOND, videoDuration))
                setCurrentTime(newTime)
                if (videoRef.current) {
                  videoRef.current.currentTime = newTime
                }
                selectSegment(null)
              }}
            >
              {/* Group selection frame — a transparent amber box encasing the whole
                  run from first to last selected segment; follows the group live
                  during a group move (groupMoveOffset). */}
              {groupBounds && (
                <ContextMenu>
                <ContextMenuTrigger asChild>
                <div
                  className="absolute bottom-0 cursor-move rounded-lg border-2 border-amber-400/80 bg-amber-400/10 hover:bg-amber-400/20 shadow-[0_0_16px_rgba(251,191,36,0.35)] z-30 transition-colors"
                  style={{
                    // Start at the top of the segment tracks: below the h-6 seek
                    // header (24) + h-10 time ruler (40) + h-16 video row (64) = 128px.
                    top: 128,
                    left: groupBounds.leftT * PIXELS_PER_SECOND + (groupMoveActive ? groupMoveOffset.x : 0),
                    width: Math.max(0, (groupBounds.rightT - groupBounds.leftT) * PIXELS_PER_SECOND),
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => {
                    // Right-click (or any non-primary button) is for the context menu,
                    // not a move — let the ContextMenuTrigger handle it.
                    if (e.button !== 0) return
                    // The box sits above the segments — a Ctrl press still adjusts the
                    // range by hit-testing the segment beneath the cursor.
                    if (e.ctrlKey || e.metaKey) {
                      e.preventDefault()
                      e.stopPropagation()
                      const blockEl = document
                        .elementsFromPoint(e.clientX, e.clientY)
                        .find(el => el.getAttribute('data-segment-block-index'))
                      if (blockEl) {
                        const idx = Number(blockEl.getAttribute('data-segment-block-index'))
                        if (!Number.isNaN(idx)) handleGroupRangeClick(idx)
                      }
                      return
                    }
                    // Otherwise drag the box to move the whole group — the container's
                    // onMouseMove/onMouseUp drive the live offset and commit.
                    e.preventDefault()
                    e.stopPropagation()
                    groupMoveActiveRef.current = true
                    groupMoveStartXRef.current = e.clientX
                    setGroupMoveActive(true)
                    setGroupMoveOffset({ x: 0, y: 0 })
                  }}
                />
                </ContextMenuTrigger>
                <ContextMenuContent className="bg-neutral-900 border-neutral-700 w-52">
                  <ContextMenuItem
                    onClick={(e) => { e.stopPropagation(); clearGroupSelection() }}
                    className="text-xs gap-2">
                    ✖ Clear Group
                  </ContextMenuItem>
                </ContextMenuContent>
                </ContextMenu>
              )}
              {/* Infinite repeating grid — 3 levels: 10s / 5s / 1s — always continuous */}
              <div
                className="absolute inset-0 pointer-events-none z-20"
                style={{
                  backgroundImage: [
                    `repeating-linear-gradient(to right, rgba(255,255,255,0.18) 0px, rgba(255,255,255,0.18) 1px, transparent 1px, transparent ${PIXELS_PER_SECOND * 10}px)`,
                    `repeating-linear-gradient(to right, rgba(255,255,255,0.10) 0px, rgba(255,255,255,0.10) 1px, transparent 1px, transparent ${PIXELS_PER_SECOND * 5}px)`,
                    `repeating-linear-gradient(to right, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent ${PIXELS_PER_SECOND}px)`,
                  ].join(', '),
                }}
              />

              {/* Clickable seek header */}
              <div
                className="h-6 shrink-0 bg-neutral-800 border-b border-neutral-700 relative cursor-pointer hover:bg-neutral-750"
                onClick={(e) => {
                  const rect = timelineRef.current?.getBoundingClientRect()
                  if (!rect) return
                  const scrollLeft = timelineRef.current?.scrollLeft ?? 0
                  const x = e.clientX - rect.left + scrollLeft
                  const newTime = Math.max(0, Math.min(x / PIXELS_PER_SECOND, videoDuration))
                  setCurrentTime(newTime)
                  if (videoRef.current) videoRef.current.currentTime = newTime
                }}
              >
              </div>

              {/* Time ruler — taller, 3-level ticks matching Vegas style */}
              <div className="h-10 shrink-0 bg-[#0d1018] border-b border-neutral-700/80 relative z-10 select-none">
                {Array.from({ length: Math.ceil(videoDuration) + 1 }).map((_, i) => {
                  const isMajor = i % 10 === 0
                  const isMid = i % 5 === 0 && !isMajor
                  const isMinor = !isMajor && !isMid

                  const tickH = isMajor ? 'h-4' : isMid ? 'h-3' : 'h-1.5'
                  const tickColor = isMajor ? 'bg-slate-300' : isMid ? 'bg-slate-500' : 'bg-slate-700'

                  return (
                    <div
                      key={i}
                      className="absolute bottom-0 flex flex-col-reverse items-start"
                      style={{ left: i * PIXELS_PER_SECOND }}
                    >
                      <div className={cn('w-px', tickH, tickColor)} />
                      {(isMajor || isMid) && (
                        <span
                          className={cn(
                            'text-[9px] font-mono leading-none mb-1 ml-0.5 whitespace-nowrap',
                            isMajor ? 'text-slate-300' : 'text-slate-500'
                          )}
                        >
                          {formatTime(i)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

{/* Video track with thumbnails - tiled background preserves aspect ratio */}
              <div className="h-16 shrink-0 bg-neutral-900/30 border-b border-neutral-700 relative overflow-hidden" data-timeline-track>
                {(() => {
                  const activeSegment = selectedSegmentIndex !== null ? displaySegments[selectedSegmentIndex] : null
                  return activeSegment ? (
                    <div className="absolute inset-x-0 bottom-0 z-10 pointer-events-none">
                      <HeatmapBar data={computeHeatmap(activeSegment)} />
                    </div>
                  ) : null
                })()}
                {videoThumbnails.length > 0 ? (
                  <div className="absolute inset-y-1 left-1 right-1 rounded overflow-hidden border border-emerald-500/50 flex">
                    {videoThumbnails.map((thumb, idx) => {
                      const thumbDuration = videoDuration / videoThumbnails.length
                      const thumbWidth = thumbDuration * PIXELS_PER_SECOND
                      return (
                        <div
                          key={idx}
                          className="h-full flex-shrink-0"
                          style={{
                            width: `${thumbWidth}px`,
                            backgroundImage: `url(${thumb})`,
                            backgroundSize: 'auto 100%',
                            backgroundPosition: '0% 50%',
                            backgroundRepeat: 'repeat-x',
                          }}
                        />
                      )
                    })}
                  </div>
                ) : isExtractingThumbnails ? (
                  <div className="absolute inset-y-1 left-1 right-1 bg-emerald-600/20 border border-emerald-500/50 rounded flex items-center justify-center">
                    <span className="text-xs text-emerald-400 animate-pulse">Extracting frames...</span>
                  </div>
                ) : null}
              </div>

              {/* Original audio track */}
              <div className="h-14 shrink-0 bg-neutral-900/20 border-b border-neutral-700 relative" data-timeline-track>
                {displaySegments.map((segment, index) => {
                  const isDraggingThis = draggingSegment?.index === index && draggingSegment?.track === 'original'
                  // Any drag of this segment (on any track) moves every track's block
                  // for it, since they all share the one committed position; a paired
                  // neighbor (Shift+P) moves too.
                  const isDraggingPaired = movesWithDrag(index)
                  const isAssignmentPulse = speakerPulseId !== null && segment.speaker_id === speakerPulseId
                  const delta = (isDraggingThis || isDraggingPaired) ? draggingSegment!.currentDelta : 0
                  return (
                    <SegmentContextMenu
                      key={`orig-${segment.id}`}
                      index={index}
                      lockedSegments={lockedSegments}
                      lockedPairs={lockedPairs}
                      stagedEmotions={stagedEmotions}
                      emotions={EMOTIONS}
                      onSelect={(idx) => { selectSegment(idx); setContextSegmentIndex(idx) }}
                      onSplit={handleSplitAtPlayhead}
                      onSplitAtWord={(idx) => setSplitWordMode(idx)}
                      onAddAfter={handleAddSegmentAfter}
                      onMerge={handleMergeWithNext}
                      canMergeNext={canMergeWithNext(index)}
                      onDelete={(idx) => setPendingDelete(idx)}
                      onToggleLock={(idx) => setSegmentLocked(idx, !lockedSegments.has(idx))}
                      onTogglePair={togglePairWithNext}
                      onRevert={revertToOriginal}
                      onUndoLastEdit={handleUndoLastEdit}
                      onCopyText={handleCopyText}
                      onPasteText={handlePasteText}
                      onClearSegment={handleClearSegment}
                      onSetEmotion={(idx, emotion) => setStagedEmotions(prev => ({ ...prev, [idx]: emotion }))}
                      onClearEmotion={(idx) => {
                    setStagedEmotions(prev => ({ ...prev, [idx]: '' }))
                    updateSegment(idx, { committed_emotion: null })
                    setImportedSegments(prev => {
                      if (!prev) return prev
                      return prev.map((seg, i) => i === idx ? { ...seg, committed_emotion: null } : seg)
                    })
                  }}
                      onRenameSpeaker={(idx) => {
                        const spkId = displaySegments[idx]?.speaker_id
                        if (!spkId) return
                        setRenamingSpeakerId(spkId)
                        setRenameValue(displaySegments[idx]?.speaker_label || `Speaker ${speakerNumberMap[spkId] ?? 1}`)
                      }}
                      onShowProfile={(idx, x, y) => setCharacterProfileOpen({ segmentIndex: idx, x, y })}
                      onGroupSelect={enterGroupSelectMode}
                      onClearGroup={clearGroupSelection}
                      groupSelectActive={groupSelectMode || groupSelectedSegments.size > 0}
                    >
                    <div
                      data-segment-drop-zone
                      data-index={index}
                      className={cn(
                        'absolute top-1 bottom-1 bg-blue-500/30 border border-blue-500/50 rounded group',
                        lockedSegments.has(index) && 'ring-1 ring-green-400/60',
                        lockGlowIndices.has(index) && 'ring-2 ring-green-400 shadow-[0_0_16px_4px_rgba(74,222,128,0.95)] animate-pulse',
                        selectedSegmentIndex === index && !lockGlowIndices.has(index) && 'ring-2 ring-amber-400/70 shadow-[0_0_8px_2px_rgba(251,191,36,0.4)] animate-pulse',
                        voiceDragOverIndex === index && 'ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)] animate-pulse',
                        isAssignmentPulse && 'ring-2 ring-amber-400/60 shadow-[0_0_6px_2px_rgba(245,158,11,0.22)] animate-pulse',
                        flashingPair === index && 'ring-1 ring-amber-400',
                        (lockedPairs.has(index) || lockedPairs.has(index - 1)) && 'shadow-[0_0_8px_2px_rgba(251,191,36,0.6)] animate-pulse',
                        isDraggingThis ? 'cursor-grabbing' : 'cursor-grab'
                      )}
                      style={{
                        left: (effStart(segment) + delta) * PIXELS_PER_SECOND + ((groupMoveActive && groupSelectedSegments.has(index)) ? groupMoveOffset.x : 0),
                        width: (() => {
                          const dur = effEnd(segment) - effStart(segment)
                          const spd = dragSpeedPreview?.index === index ? dragSpeedPreview.speed : (stagedSpeeds[index] ?? 1.0)
                          return (dur / spd) * PIXELS_PER_SECOND
                        })(),
                      }}
                      onMouseDown={(e) => {
                        const t = e.target as HTMLElement
                        if (t.closest('[data-resize-handle]')) return
                        e.preventDefault()
                        e.stopPropagation()
                        const startX = e.clientX
                        const originalStart = effStart(segment)
                        const originalEnd = effEnd(segment)
                        if (lockedSegments.has(index)) return // locked — position frozen
                        setDraggingSegment({ index, track: 'original', startX, originalStart, originalEnd, currentDelta: 0 })
                        const onMouseMove = (ev: MouseEvent) => {
                          const deltaTime = (ev.clientX - startX) / PIXELS_PER_SECOND
                          setDraggingSegment(prev => prev ? { ...prev, currentDelta: deltaTime } : null)
                        }
                        const onMouseUp = (ev: MouseEvent) => {
                          const deltaTime = (ev.clientX - startX) / PIXELS_PER_SECOND
                          updateSegment(index, {
                            start_time: Math.max(0, originalStart + deltaTime),
                            end_time: Math.max(0, originalEnd + deltaTime),
                          })
                          commitSegmentChanges(index, {
                            committed_start_time: Math.max(0, originalStart + deltaTime),
                            committed_end_time: Math.max(0, originalEnd + deltaTime),
                          })
                          apiClient.commitSegmentTiming(jobId, segment.transcript_index ?? index, {
                            committed_start_time: Math.max(0, originalStart + deltaTime),
                            committed_end_time: Math.max(0, originalEnd + deltaTime),
                          }).catch(err => console.warn('[COMMIT-TIMING]', err))
                          // Paired neighbor (Shift+P) moves by the same amount — commit
                          // its shifted timing too so it doesn't snap back.
                          const partnerIdx = lockedPairs.has(index) ? index + 1 : (lockedPairs.has(index - 1) ? index - 1 : null)
                          if (partnerIdx != null) {
                            const p = displaySegmentsRef.current[partnerIdx]
                            if (p) {
                              const pStart = Math.max(0, effStart(p) + deltaTime)
                              const pEnd = Math.max(0, effEnd(p) + deltaTime)
                              updateSegment(partnerIdx, { start_time: pStart, end_time: pEnd })
                              commitSegmentChanges(partnerIdx, { committed_start_time: pStart, committed_end_time: pEnd })
                              apiClient.commitSegmentTiming(jobId, p.transcript_index ?? partnerIdx, {
                                committed_start_time: pStart, committed_end_time: pEnd,
                              }).catch(err => console.warn('[PAIR-MOVE]', err))
                              setImportedSegments(prev => {
                                const base = prev ?? displaySegments
                                return base.map((seg, i) => i === partnerIdx
                                  ? { ...seg, start_time: pStart, end_time: pEnd, committed_start_time: pStart, committed_end_time: pEnd }
                                  : seg)
                              })
                            }
                          }
                          setImportedSegments(prev => {
                            const base = prev ?? displaySegments
                            return base.map((seg, i) =>
                              i === index
                                ? {
                                    ...seg,
                                    start_time: Math.max(0, originalStart + deltaTime),
                                    end_time: Math.max(0, originalEnd + deltaTime),
                                    committed_start_time: Math.max(0, originalStart + deltaTime),
                                    committed_end_time: Math.max(0, originalEnd + deltaTime),
                                  }
                                : seg
                            )
                          })
                          setDraggingSegment(null)
                          document.removeEventListener('mousemove', onMouseMove)
                          document.removeEventListener('mouseup', onMouseUp)
                          dragMoveListenerRef.current = null
                          dragUpListenerRef.current = null
                        }
                        document.addEventListener('mousemove', onMouseMove)
                        document.addEventListener('mouseup', onMouseUp)
                        dragMoveListenerRef.current = onMouseMove
                        dragUpListenerRef.current = onMouseUp
                      }}
                    >
                      {/* Left handle — drag to move start_time */}
                      <div
                        data-resize-handle={true}
                        className={cn("absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-white/20 rounded-l", lockedSegments.has(index) && 'pointer-events-none')}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const startX = e.clientX
                          const originalStart = effStart(segment)
                          const originalEnd = effEnd(segment)
                          const onMouseMove = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX
                            const newStart = Math.max(0, Math.min(originalEnd - 0.1, originalStart + dx / PIXELS_PER_SECOND))
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) => i === index ? { ...seg, start_time: newStart, committed_start_time: newStart } : seg)
                            })
                          }
                          const onMouseUp = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX
                            const newStart = Math.max(0, Math.min(originalEnd - 0.1, originalStart + dx / PIXELS_PER_SECOND))
                            updateSegment(index, { start_time: newStart })
                            commitSegmentChanges(index, { committed_start_time: newStart })
                            apiClient.commitSegmentTiming(jobId, segment.transcript_index ?? index, {
                              committed_start_time: newStart,
                            }).catch(err => console.warn('[RESIZE-LEFT]', err))
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) => i === index ? { ...seg, start_time: newStart, committed_start_time: newStart } : seg)
                            })
                            document.removeEventListener('mousemove', onMouseMove)
                            document.removeEventListener('mouseup', onMouseUp)
                          }
                          document.addEventListener('mousemove', onMouseMove)
                          document.addEventListener('mouseup', onMouseUp)
                        }}
                      >
                        <GripHorizontal className="h-3 w-3 rotate-90" />
                      </div>

                      {lockedPairs.has(index) && (
                        <Link2 className="absolute top-0.5 right-0.5 h-2.5 w-2.5 text-amber-400 opacity-80" />
                      )}
                      <div className="px-2 truncate text-[10px] h-full flex items-center text-blue-200/80">
                        {segment.source_text}
                      </div>

                      {/* Right handle — drag to move end_time */}
                      <div
                        data-resize-handle={true}
                        className={cn("absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-white/20 rounded-r", lockedSegments.has(index) && 'pointer-events-none')}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const startX = e.clientX
                          const originalStart = effStart(segment)
                          const originalEnd = effEnd(segment)
                          const onMouseMove = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX
                            const newEnd = Math.max(originalStart + 0.1, originalEnd + dx / PIXELS_PER_SECOND)
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) => i === index ? { ...seg, end_time: newEnd, committed_end_time: newEnd } : seg)
                            })
                          }
                          const onMouseUp = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX
                            const newEnd = Math.max(originalStart + 0.1, originalEnd + dx / PIXELS_PER_SECOND)
                            updateSegment(index, { end_time: newEnd })
                            commitSegmentChanges(index, { committed_end_time: newEnd })
                            apiClient.commitSegmentTiming(jobId, segment.transcript_index ?? index, {
                              committed_end_time: newEnd,
                            }).catch(err => console.warn('[RESIZE-RIGHT]', err))
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) => i === index ? { ...seg, end_time: newEnd, committed_end_time: newEnd } : seg)
                            })
                            document.removeEventListener('mousemove', onMouseMove)
                            document.removeEventListener('mouseup', onMouseUp)
                          }
                          document.addEventListener('mousemove', onMouseMove)
                          document.addEventListener('mouseup', onMouseUp)
                        }}
                      >
                        <GripHorizontal className="h-3 w-3 rotate-90" />
                      </div>
                    </div>
                    </SegmentContextMenu>
                  )
                })}
              </div>

              {/* Reference track — shown only when a video has been imported for transcription */}
              {referenceSegments && referenceSegments.length > 0 && (
                <div className="h-14 shrink-0 bg-amber-950/20 border-b border-amber-800/40 relative" data-timeline-track>
                  {referenceSegments.map((seg, i) => (
                    <div
                      key={seg.id}
                      title={seg.text}
                      className={cn(
                        'absolute top-1 bottom-1 border rounded cursor-pointer group transition-colors',
                        selectedReferenceIndex === i
                          ? 'bg-amber-500/40 border-amber-400 ring-1 ring-amber-400/60'
                          : 'bg-amber-500/15 border-amber-600/50 hover:bg-amber-500/25'
                      )}
                      style={{ left: seg.start * PIXELS_PER_SECOND, width: Math.max(4, (seg.end - seg.start) * PIXELS_PER_SECOND) }}
                      onClick={() => {
                        setSelectedReferenceIndex(i)
                        // Seek video to this segment
                        if (videoRef.current) videoRef.current.currentTime = seg.start
                        // Open chord tab to show emotion analysis
                        setRightPanelTab('result')
                        setVideoSubTab('chord')
                      }}
                    >
                      <div className="px-1.5 truncate text-[10px] h-full flex items-center text-amber-200/80 pointer-events-none">
                        {seg.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}

{/* Dubbed audio track with stretch/squeeze handles */}
              <div
                className={cn(
                  "h-14 shrink-0 bg-neutral-900/20 border-b border-neutral-700 relative",
                  draggedTranslation && "bg-amber-500/10 border-amber-500/30"
                )}
                data-timeline-track
                onDragOver={handleTimelineDragOver}
                onDrop={handleDubbedTrackDrop}
              >
                {displaySegments.map((segment, index) => {
                  const droppedTranslation = droppedTranslations.find(t => t.segmentIndex === index)
                  const hasDroppedTranslation = !!droppedTranslation

                  const bgColor = hasDroppedTranslation
                    ? 'bg-amber-500/40 border-amber-400 ring-2 ring-amber-400/50'
                    : 'bg-amber-500/30 border-amber-500/50'
                  
                  return (
                    <SegmentContextMenu
                      key={`dub-${segment.id}`}
                      index={index}
                      lockedSegments={lockedSegments}
                      lockedPairs={lockedPairs}
                      stagedEmotions={stagedEmotions}
                      emotions={EMOTIONS}
                      onSelect={(idx) => { selectSegment(idx); setContextSegmentIndex(idx) }}
                      onSplit={handleSplitAtPlayhead}
                      onSplitAtWord={(idx) => setSplitWordMode(idx)}
                      onAddAfter={handleAddSegmentAfter}
                      onMerge={handleMergeWithNext}
                      canMergeNext={canMergeWithNext(index)}
                      onDelete={(idx) => setPendingDelete(idx)}
                      onToggleLock={(idx) => setSegmentLocked(idx, !lockedSegments.has(idx))}
                      onTogglePair={togglePairWithNext}
                      onRevert={revertToOriginal}
                      onUndoLastEdit={handleUndoLastEdit}
                      onCopyText={handleCopyText}
                      onPasteText={handlePasteText}
                      onClearSegment={handleClearSegment}
                      onSetEmotion={(idx, emotion) => setStagedEmotions(prev => ({ ...prev, [idx]: emotion }))}
                      onClearEmotion={(idx) => {
                    setStagedEmotions(prev => ({ ...prev, [idx]: '' }))
                    updateSegment(idx, { committed_emotion: null })
                    setImportedSegments(prev => {
                      if (!prev) return prev
                      return prev.map((seg, i) => i === idx ? { ...seg, committed_emotion: null } : seg)
                    })
                  }}
                      onRenameSpeaker={(idx) => {
                        const spkId = displaySegments[idx]?.speaker_id
                        if (!spkId) return
                        setRenamingSpeakerId(spkId)
                        setRenameValue(displaySegments[idx]?.speaker_label || `Speaker ${speakerNumberMap[spkId] ?? 1}`)
                      }}
                      onShowProfile={(idx, x, y) => setCharacterProfileOpen({ segmentIndex: idx, x, y })}
                      onGroupSelect={enterGroupSelectMode}
                      onClearGroup={clearGroupSelection}
                      groupSelectActive={groupSelectMode || groupSelectedSegments.size > 0}
                    >
                    <div
                      data-segment-drop-zone
                      data-index={index}
                      className={cn(
                        'absolute top-1 bottom-1 rounded group border transition-colors',
                        bgColor,
                        lockedSegments.has(index) && 'ring-1 ring-green-400/60',
                        lockGlowIndices.has(index) && 'ring-2 ring-green-400 shadow-[0_0_16px_4px_rgba(74,222,128,0.95)] animate-pulse',
                        (index === groupBounds?.firstIdx || index === groupBounds?.lastIdx)
                          ? 'border-yellow-400/90 shadow-[0_0_14px_rgba(250,204,21,0.6)] ring-2 ring-yellow-400/80'
                          : 'border-slate-400/30',
                        selectedSegmentIndex === index && !lockGlowIndices.has(index) && 'ring-2 ring-amber-400/70 shadow-[0_0_8px_2px_rgba(251,191,36,0.4)] animate-pulse',
                        voiceDragOverIndex === index && 'ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)] animate-pulse',
                        flashingPair === index && 'ring-1 ring-amber-400',
                        (lockedPairs.has(index) || lockedPairs.has(index - 1)) && 'shadow-[0_0_8px_2px_rgba(251,191,36,0.6)] animate-pulse',
                        groupSelectMode && !groupSelectedSegments.has(index) && 'ring-1 ring-yellow-400/30',
                        groupSelectMode
                          ? '!cursor-cell'
                          : draggingSegment?.index === index && draggingSegment?.track === 'dubbed' ? 'cursor-grabbing' : 'cursor-grab'
                      )}
                      style={{
                        left: (() => {
                          const isDraggingThis = draggingSegment?.index === index && draggingSegment?.track === 'dubbed'
                          // Follow any drag of this segment (any track) — shared position;
                          // a paired neighbor (Shift+P) moves too.
                          const isDraggingPaired = movesWithDrag(index)
                          const delta = (isDraggingThis || isDraggingPaired) ? draggingSegment!.currentDelta : 0
                          const groupDelta = (groupMoveActive && groupSelectedSegments.has(index)) ? groupMoveOffset.x : 0
                          return (effStart(segment) + delta) * PIXELS_PER_SECOND + groupDelta
                        })(),
                        width: (() => {
                          const originalDuration = effEnd(segment) - effStart(segment)
                          const activeSpeed = dragSpeedPreview?.index === index
                            ? dragSpeedPreview.speed
                            : (stagedSpeeds[index] ?? 1.0)
                          return (originalDuration / activeSpeed) * PIXELS_PER_SECOND
                        })(),
                      }}
                      data-segment-block={true}
                      data-segment-block-index={index}
                      onClick={(e) => handleSegmentClick(index, e)}
                      onDrop={(e) => handleTimelineDrop(e, index)}
                      onDragOver={handleTimelineDragOver}
                      onMouseDown={(e) => {
                        const t = e.target as HTMLElement
                        if (t.closest('[data-resize-handle]')) return

                        // In group-select mode a Ctrl press builds the range (see onClick) —
                        // don't let it start a drag or group move.
                        if (groupSelectMode && (e.ctrlKey || e.metaKey)) return

                        // Start group move if segment is selected and Shift is not pressed
                        if (groupSelectedSegments.has(index) && !e.shiftKey) {
                          e.preventDefault()
                          e.stopPropagation()
                          groupMoveActiveRef.current = true
                          groupMoveStartXRef.current = e.clientX
                          setGroupMoveActive(true)
                          setGroupMoveOffset({ x: 0, y: 0 })
                          return
                        }

                        e.preventDefault()
                        e.stopPropagation()
                        let startX = e.clientX
                        const originalStart = effStart(segment)
                        const originalEnd = effEnd(segment)
                        if (lockedSegments.has(index)) return // locked — position frozen
                        setDraggingSegment({ index, track: 'dubbed', startX, originalStart, originalEnd, currentDelta: 0 })
                        const onMouseMove = (ev: MouseEvent) => {
                          const deltaTime = (ev.clientX - startX) / PIXELS_PER_SECOND
                          setDraggingSegment(prev => prev ? { ...prev, currentDelta: deltaTime } : null)
                          // Auto-scroll when dragging near the right or left edge
                          const timelineEl = timelineRef.current
                          if (timelineEl) {
                            const containerRect = timelineEl.getBoundingClientRect()
                            const edgeThreshold = 80 // px from edge to trigger scroll
                            const scrollSpeed = 12 // px per frame
                            if (ev.clientX > containerRect.right - edgeThreshold) {
                              timelineEl.scrollLeft += scrollSpeed
                              startX -= scrollSpeed
                            } else if (ev.clientX < containerRect.left + edgeThreshold) {
                              timelineEl.scrollLeft -= scrollSpeed
                              startX += scrollSpeed
                            }
                          }
                        }
                        const onMouseUp = (ev: MouseEvent) => {
                          const deltaTime = (ev.clientX - startX) / PIXELS_PER_SECOND
                          updateSegment(index, {
                            start_time: Math.max(0, originalStart + deltaTime),
                            end_time: Math.max(0, originalEnd + deltaTime),
                          })
                          commitSegmentChanges(index, {
                            committed_start_time: Math.max(0, originalStart + deltaTime),
                            committed_end_time: Math.max(0, originalEnd + deltaTime),
                          })
                          apiClient.commitSegmentTiming(jobId, segment.transcript_index ?? index, {
                            committed_start_time: Math.max(0, originalStart + deltaTime),
                            committed_end_time: Math.max(0, originalEnd + deltaTime),
                          }).catch(err => console.warn('[COMMIT-TIMING]', err))
                          // Paired neighbor (Shift+P) moves by the same amount — commit
                          // its shifted timing too so it doesn't snap back.
                          const partnerIdx = lockedPairs.has(index) ? index + 1 : (lockedPairs.has(index - 1) ? index - 1 : null)
                          if (partnerIdx != null) {
                            const p = displaySegmentsRef.current[partnerIdx]
                            if (p) {
                              const pStart = Math.max(0, effStart(p) + deltaTime)
                              const pEnd = Math.max(0, effEnd(p) + deltaTime)
                              updateSegment(partnerIdx, { start_time: pStart, end_time: pEnd })
                              commitSegmentChanges(partnerIdx, { committed_start_time: pStart, committed_end_time: pEnd })
                              apiClient.commitSegmentTiming(jobId, p.transcript_index ?? partnerIdx, {
                                committed_start_time: pStart, committed_end_time: pEnd,
                              }).catch(err => console.warn('[PAIR-MOVE]', err))
                              setImportedSegments(prev => {
                                const base = prev ?? displaySegments
                                return base.map((seg, i) => i === partnerIdx
                                  ? { ...seg, start_time: pStart, end_time: pEnd, committed_start_time: pStart, committed_end_time: pEnd }
                                  : seg)
                              })
                            }
                          }
                          setImportedSegments(prev => {
                            const base = prev ?? displaySegments
                            return base.map((seg, i) =>
                              i === index
                                ? {
                                    ...seg,
                                    start_time: Math.max(0, originalStart + deltaTime),
                                    end_time: Math.max(0, originalEnd + deltaTime),
                                    committed_start_time: Math.max(0, originalStart + deltaTime),
                                    committed_end_time: Math.max(0, originalEnd + deltaTime),
                                  }
                                : seg
                            )
                          })
                          if (audioContextRef.current) {
                            const newStart = Math.max(0, originalStart + deltaTime)
                            const newEnd = Math.max(0, originalEnd + deltaTime)
                            const resolveUrl = (url: string | undefined) => {
                              if (!url) return url
                              if (url.startsWith('http')) return url
                              const filename = url.split('/').pop()
                              return filename ? apiClient.getAudioFileUrl(jobId, filename) : url
                            }
                            requestRPTStitch(
                              displaySegments.map((seg, i) => ({
                                ...seg,
                                start_time: i === index ? newStart : seg.start_time,
                                end_time: i === index ? newEnd : seg.end_time,
                                committed_start_time: i === index ? newStart : seg.committed_start_time,
                                committed_end_time: i === index ? newEnd : seg.committed_end_time,
                                audio_url: resolveUrl(seg.audio_url),
                                committed_audio_url: resolveUrl(seg.committed_audio_url),
                              })),
                              videoDuration,
                              audioContextRef.current,
                              () => {},
                              (result) => { if (result) rptBufferRef.current = result.buffer },
                            )
                          }
                          setDraggingSegment(null)
                          document.removeEventListener('mousemove', onMouseMove)
                          document.removeEventListener('mouseup', onMouseUp)
                          dragMoveListenerRef.current = null
                          dragUpListenerRef.current = null
                        }
                        document.addEventListener('mousemove', onMouseMove)
                        document.addEventListener('mouseup', onMouseUp)
                        dragMoveListenerRef.current = onMouseMove
                        dragUpListenerRef.current = onMouseUp
                      }}
                    >
                      {/* Left timing handle (green) */}
                      <div
                        data-resize-handle={true}
                        className={cn("absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-green-500/40 hover:bg-green-500/70 rounded-l transition-colors", lockedSegments.has(index) && 'pointer-events-none')}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const startX = e.clientX
                          const originalStart = effStart(segment)
                          const originalEnd = effEnd(segment)
                          const onMouseMove = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX
                            const newStart = Math.max(0, Math.min(originalEnd - 0.1, originalStart + dx / PIXELS_PER_SECOND))
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) => i === index ? { ...seg, start_time: newStart, committed_start_time: newStart } : seg)
                            })
                          }
                          const onMouseUp = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX
                            const newStart = Math.max(0, Math.min(originalEnd - 0.1, originalStart + dx / PIXELS_PER_SECOND))
                            updateSegment(index, { start_time: newStart })
                            commitSegmentChanges(index, { committed_start_time: newStart })
                            apiClient.commitSegmentTiming(jobId, segment.transcript_index ?? index, {
                              committed_start_time: newStart,
                            }).catch(err => console.warn('[DUBBED-RESIZE-LEFT]', err))
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) => i === index ? { ...seg, start_time: newStart, committed_start_time: newStart } : seg)
                            })
                            document.removeEventListener('mousemove', onMouseMove)
                            document.removeEventListener('mouseup', onMouseUp)
                          }
                          document.addEventListener('mousemove', onMouseMove)
                          document.addEventListener('mouseup', onMouseUp)
                        }}
                      >
                        <GripHorizontal className="h-3 w-3 rotate-90" />
                      </div>

                      {/* Lock icon when paired */}
                      {lockedPairs.has(index) && (
                        <Link2 className="absolute top-0.5 right-0.5 h-2.5 w-2.5 text-amber-400 opacity-80" />
                      )}

                      {/* Content */}
                      <div className="px-3 truncate text-[10px] h-full flex items-center text-white/80 gap-1">
                        {dragSpeedPreview?.index === index ? (
                          <span className="text-amber-400 font-mono shrink-0">{dragSpeedPreview.speed.toFixed(2)}x</span>
                        ) : stagedSpeeds[index] !== undefined ? (
                          <>
                            <span className="text-amber-400 font-mono shrink-0">{stagedSpeeds[index].toFixed(2)}x</span>
                            <span className="truncate">{segment.preview_text ?? segment.active_text ?? segment.target_text}</span>
                          </>
                        ) : (
                          segment.preview_text ?? segment.active_text ?? segment.target_text
                        )}
                      </div>

                      {/* Truncated flag */}
                      {segment.was_truncated && (
                        <div
                          className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center cursor-pointer z-10 text-yellow-400 hover:text-yellow-300 hover:scale-110 transition-transform"
                          title="Truncated — click to regenerate"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleGenerateSpeech(index)
                          }}
                        >
                          <span className="text-[10px] drop-shadow">&#9873;</span>
                        </div>
                      )}

                      {/* Right timing handle (green) */}
                      <div
                        data-resize-handle={true}
                        className={cn("absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-green-500/40 hover:bg-green-500/70 rounded-r transition-colors", lockedSegments.has(index) && 'pointer-events-none')}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const startX = e.clientX
                          const originalStart = effStart(segment)
                          const originalEnd = effEnd(segment)
                          const onMouseMove = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX
                            const newEnd = Math.max(originalStart + 0.1, originalEnd + dx / PIXELS_PER_SECOND)
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) => i === index ? { ...seg, end_time: newEnd, committed_end_time: newEnd } : seg)
                            })
                          }
                          const onMouseUp = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX
                            const newEnd = Math.max(originalStart + 0.1, originalEnd + dx / PIXELS_PER_SECOND)
                            updateSegment(index, { end_time: newEnd })
                            commitSegmentChanges(index, { committed_end_time: newEnd })
                            apiClient.commitSegmentTiming(jobId, segment.transcript_index ?? index, {
                              committed_end_time: newEnd,
                            }).catch(err => console.warn('[DUBBED-RESIZE-RIGHT]', err))
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) => i === index ? { ...seg, end_time: newEnd, committed_end_time: newEnd } : seg)
                            })
                            document.removeEventListener('mousemove', onMouseMove)
                            document.removeEventListener('mouseup', onMouseUp)
                          }
                          document.addEventListener('mousemove', onMouseMove)
                          document.addEventListener('mouseup', onMouseUp)
                        }}
                      >
                        <GripHorizontal className="h-3 w-3 rotate-90" />
                      </div>
                    </div>
                    </SegmentContextMenu>
                  )
                })}
              </div>


              {/* RPT Audio track */}
              <div className="h-20 shrink-0 bg-neutral-900/10 border-b border-neutral-700 relative" data-timeline-track>
                {displaySegments.map((seg, i) => {
                  const hasAudio = !!(seg.committed_audio_url ?? seg.audio_url)
                  const startT = effStart(seg)
                  const endT = effEnd(seg)
                  const groupDelta = (groupMoveActive && groupSelectedSegments.has(i)) ? groupMoveOffset.x : 0
                  const dragDelta = movesWithDrag(i) && draggingSegment ? draggingSegment.currentDelta : 0
                  return (
                    <div
                      key={seg.id + '-rpt-audio'}
                      data-segment-drop-zone
                      data-index={i}
                      className={cn(
                        'absolute top-1 bottom-1 rounded opacity-70 transition-colors group',
                        voiceDragOverIndex === i
                          ? 'bg-emerald-500/70 border-2 border-emerald-400 ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.7)] animate-pulse'
                          : !hasAudio
                          ? 'bg-neutral-500/30 border border-neutral-600/50'
                          : regeneratingSegmentIndex === i
                          ? 'bg-amber-500/70 border border-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                          : (queuedSegmentIndex === i || speakerRegenQueue.has(i))
                          ? 'bg-cyan-500/40 border border-cyan-400/70 border-dashed animate-pulse'
                          : confirmingSegmentIndex === i
                          ? 'bg-amber-400/80 border border-amber-300 animate-[pulse_0.3s_ease-in-out_2]'
                          : seg.rpt_dirty
                          ? 'bg-amber-400/50 border border-amber-400/70'
                          : seg.committed_audio_url
                          ? 'bg-amber-400/60 border border-amber-400/80'
                          : 'bg-emerald-500/50 border border-emerald-500/70'
                      )}
                      style={{
                        left: (startT + dragDelta) * PIXELS_PER_SECOND + groupDelta,
                        width: Math.max(
                          (() => {
                            const dur = endT - startT
                            const spd = dragSpeedPreview?.index === i ? dragSpeedPreview.speed : (stagedSpeeds[i] ?? 1.0)
                            return (dur / spd) * PIXELS_PER_SECOND
                          })(),
                          2
                        )
                      }}
                      title={seg.committed_adapted_text ?? seg.active_text ?? seg.target_text}
                    >
                      {/* Left speed handle (blue) */}
                      <div
                        data-resize-handle={true}
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-blue-500/40 hover:bg-blue-500/70 rounded-l transition-colors z-10"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const startX = e.clientX
                          const originalDuration = endT - startT
                          const onMouseMove = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX
                            const newDuration = Math.max(0.1, originalDuration - dx / PIXELS_PER_SECOND)
                            const newSpeed = Math.min(2.0, Math.max(0.5, originalDuration / newDuration))
                            setDragSpeedPreview({ index: i, speed: newSpeed })
                          }
                          const onMouseUp = () => {
                            setDragSpeedPreview(prev => {
                              if (prev?.index === i) {
                                setStagedSpeeds(s => ({ ...s, [i]: prev.speed }))
                              }
                              return null
                            })
                            document.removeEventListener('mousemove', onMouseMove)
                            document.removeEventListener('mouseup', onMouseUp)
                          }
                          document.addEventListener('mousemove', onMouseMove)
                          document.addEventListener('mouseup', onMouseUp)
                        }}
                      >
                        <GripHorizontal className="h-3 w-3 rotate-90" />
                      </div>
                      {/* Right speed handle (blue) */}
                      <div
                        data-resize-handle={true}
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-blue-500/40 hover:bg-blue-500/70 rounded-r transition-colors z-10"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const startX = e.clientX
                          const originalDuration = endT - startT
                          const onMouseMove = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX
                            const newDuration = Math.max(0.1, originalDuration + dx / PIXELS_PER_SECOND)
                            const newSpeed = Math.min(2.0, Math.max(0.5, originalDuration / newDuration))
                            setDragSpeedPreview({ index: i, speed: newSpeed })
                          }
                          const onMouseUp = () => {
                            setDragSpeedPreview(prev => {
                              if (prev?.index === i) {
                                setStagedSpeeds(s => ({ ...s, [i]: prev.speed }))
                              }
                              return null
                            })
                            document.removeEventListener('mousemove', onMouseMove)
                            document.removeEventListener('mouseup', onMouseUp)
                          }
                          document.addEventListener('mousemove', onMouseMove)
                          document.addEventListener('mouseup', onMouseUp)
                        }}
                      >
                        <GripHorizontal className="h-3 w-3 rotate-90" />
                      </div>
                    </div>
                  )
                })}
                {rptStitching && (
                  <div className="absolute inset-0 flex items-center justify-center text-[10px] text-amber-400 animate-pulse pointer-events-none">
                    Building preview…
                  </div>
                )}
              </div>

              {/* Emotional curve track */}
              {hasFeature('emotionalCurveEditor') && <div className="h-24 shrink-0 bg-neutral-900/20 border-b border-neutral-700 relative overflow-hidden" data-timeline-track>
                {displaySegments.map((segment, index) => {
                  const segWidth = (effEnd(segment) - effStart(segment)) * PIXELS_PER_SECOND
                  return (
                    <div
                      key={`emotion-${segment.id}`}
                      className="absolute top-0 bottom-0"
                      data-emotion-segment
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        setAdvancedBrowserSegment(index)
                        setFloatingEmotionSegment(prev => prev === index ? null : index)
                        setRightPanelTab('result')
                        setVideoSubTab('chord')
                      }}
                      style={{
                        left: (effStart(segment) + (movesWithDrag(index) && draggingSegment ? draggingSegment.currentDelta : 0)) * PIXELS_PER_SECOND + ((groupMoveActive && groupSelectedSegments.has(index)) ? groupMoveOffset.x : 0),
                        width: segWidth,
                      }}
                    >
                      <div className="relative w-full h-full overflow-hidden">
                        {/* Grid overlay */}
                        <div className="absolute inset-0 pointer-events-none opacity-30">
                          {[0, 25, 50, 75, 100].map((level) => (
                            <div
                              key={level}
                              className="absolute w-full border-t border-slate-700"
                              style={{ top: `${100 - level}%` }}
                            />
                          ))}
                          {Array.from({ length: Math.ceil((segment.end_time - segment.start_time) / 0.5) }).map((_, i) => (
                            <div
                              key={i}
                              className="absolute h-full border-l border-slate-800"
                              style={{ left: `${(i * 0.5 * 100) / (segment.end_time - segment.start_time)}%` }}
                            />
                          ))}
                        </div>

                        <EmotionLedTrack
                          curveData={
                            segment.velma_emotion_curve ?? Array.from({ length: 20 }, () => 0.25)
                          }
                          trackDuration={segment.end_time - segment.start_time}
                          emotionLabel={segment.velma_emotion}
                          progressionMarkers={segment.velma_progression}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>}

              {/* Filler — fills remaining height, shows grid + bottom ruler */}
              <div className="flex-1 relative bg-[#07090f] flex flex-col">
                {/* Filler grid — same 3-level gradient as main timeline */}
                <div
                  className="absolute inset-0 bottom-6 pointer-events-none"
                  style={{
                    backgroundImage: [
                      `repeating-linear-gradient(to right, rgba(255,255,255,0.18) 0px, rgba(255,255,255,0.18) 1px, transparent 1px, transparent ${PIXELS_PER_SECOND * 10}px)`,
                      `repeating-linear-gradient(to right, rgba(255,255,255,0.10) 0px, rgba(255,255,255,0.10) 1px, transparent 1px, transparent ${PIXELS_PER_SECOND * 5}px)`,
                      `repeating-linear-gradient(to right, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent ${PIXELS_PER_SECOND}px)`,
                    ].join(', '),
                  }}
                />
                {/* Grid filler body */}
                <div className="flex-1" />
                {/* Bottom ruler — half height of top (h-5), major ticks only */}
                <div className="h-5 shrink-0 bg-[#0d1018] border-t border-neutral-700/80 relative select-none">
                  {Array.from({ length: Math.ceil(videoDuration) + 1 }).map((_, i) => {
                    const isMajor = i % 10 === 0
                    const isMid = i % 5 === 0 && !isMajor
                    if (!isMajor && !isMid) return null
                    return (
                      <div
                        key={i}
                        className="absolute top-0 flex flex-col items-start"
                        style={{ left: i * PIXELS_PER_SECOND }}
                      >
                        <div className={cn('w-px', isMajor ? 'h-2 bg-slate-400' : 'h-1.5 bg-slate-600')} />
                        {isMajor && (
                          <span className="text-[8px] font-mono leading-none mt-0.5 ml-0.5 text-slate-500 whitespace-nowrap">
                            {formatTime(i)}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Player needle - yellow triangle head + silver line - DRAGGABLE */}
              <div
                className="absolute top-0 bottom-0 z-30 pointer-events-none"
                style={{ left: `${currentTime * PIXELS_PER_SECOND}px` }}
              >
                {/* Yellow triangle head - positioned below combined seek+ruler (24px+40px=64px) */}
                <div
                  className="absolute top-16 -left-[6px] cursor-ew-resize pointer-events-auto"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleNeedleDragStart(e)
                  }}
                  style={{
                    width: 0,
                    height: 0,
                    borderLeft: '6px solid transparent',
                    borderRight: '6px solid transparent',
                    borderTop: '10px solid #fbbf24',
                  }}
                />
                {/* Needle line — full height, sits on top of ruler and all tracks */}
                <div className="absolute top-0 bottom-0 left-0 w-[1px] bg-amber-400/60 pointer-events-none" />
              </div>

            </div>
          </div>
        </div>
        
        {/* Language indicators */}
        <div className="flex items-center gap-2 px-4 py-1 border-t border-slate-800 text-xs">
          <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-300">EN</span>
          {['VI', 'TH', 'HIN', 'GUJ', 'TA', 'FR', 'AR'].map((lang, i) => (
            <span 
              key={lang}
              className={cn(
                'px-2 py-0.5 rounded cursor-pointer',
                i === 0 ? 'bg-pink-500/20 text-pink-400' :
                i === 1 ? 'bg-blue-500/20 text-blue-400' :
                i === 2 ? 'bg-green-500/20 text-green-400' :
                i === 3 ? 'bg-amber-500/20 text-amber-400' :
                'bg-slate-800 text-slate-500'
              )}
            >
              {lang}
            </span>
          ))}
        </div>
      </div>
      
      {/* Timing Exclusion — Hard block (overlap > 0.3s): rewrite only */}
      {timingExclusion && timingExclusion.overlap > 0.3 && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-neutral-900 border border-red-500/50 rounded-lg p-6 w-[440px] shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                <span className="text-red-400 text-xl">⚠</span>
              </div>
              <h3 className="text-lg font-semibold text-white">Rewrite Text — Timing Exclusion Error</h3>
            </div>
            <p className="text-sm text-neutral-300 mb-4">
              Your allotted space for this text is <span className="text-amber-400 font-mono font-bold">{timingExclusion.slotDuration.toFixed(1)}s</span>.
              Your text exceeds this by <span className="text-red-400 font-mono font-bold">{timingExclusion.overlap.toFixed(1)}s</span>.
            </p>
            <p className="text-sm text-neutral-400 mb-6">
              Rewrite it shorter, or give the segment more room — that pushes the later
              segments over to make space, then refits the audio at a natural pace.
            </p>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs text-neutral-500 shrink-0">Make room:</span>
              {[1, 2, 3].map(m => (
                <button
                  key={m}
                  className="flex-1 px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors"
                  onClick={() => expandTimingSlot(m)}
                  title={m === 1 ? 'Expand just enough to fit the audio' : `${m}× the current space`}
                >
                  Expand ×{m}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                className="px-4 py-2 rounded bg-neutral-700 hover:bg-neutral-600 text-white text-sm font-medium transition-colors"
                onClick={() => setTimingExclusion(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Timing Exclusion — Soft warning (overlap ≤ 0.3s): can generate anyway */}
      {timingExclusion && timingExclusion.overlap <= 0.3 && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-neutral-900 border border-amber-500/50 rounded-lg p-6 w-[440px] shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                <span className="text-amber-400 text-xl">⚠</span>
              </div>
              <h3 className="text-lg font-semibold text-white">Timing Warning</h3>
            </div>
            <p className="text-sm text-neutral-300 mb-4">
              Your allotted space for this text is <span className="text-amber-400 font-mono font-bold">{timingExclusion.slotDuration.toFixed(1)}s</span>.
              Your text exceeds this by <span className="text-amber-400 font-mono font-bold">{timingExclusion.overlap.toFixed(1)}s</span>.
            </p>
            <p className="text-sm text-neutral-400 mb-6">
              This is close enough to fit. You can generate anyway or rewrite the text to shorten it.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 rounded bg-neutral-700 hover:bg-neutral-600 text-white text-sm font-medium transition-colors"
                onClick={() => setTimingExclusion(null)}
              >
                Rewrite Text
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium transition-colors"
                onClick={async () => {
                  const idx = timingExclusion.segmentIndex
                  const seg = displaySegments[idx]
                  if (!seg) return
                  setTimingExclusion(null)
                  setIsRegenerating(true)
                  setRegeneratingSegmentIndex(idx)
                  try {
                    const response = await apiClient.regenerateSegment(jobId, seg.transcript_index ?? idx, {
                      speed: stagedSpeeds[idx] ?? 1.0,
                      emotion: stagedEmotions[idx] ?? seg.committed_emotion,
                      voice_key: stagedVoices[idx] ?? speakerVoiceMap[seg.speaker_id],
                      pitch: stagedPitches[idx] ?? speakerPitchMap[seg.speaker_id] ?? 0,
                      force_timing: true,
                    })
                    const filename = response.segment.path.split('/').pop() ?? ''
                    const audio_url = filename ? `${apiClient.getAudioFileUrl(jobId, filename)}?ts=${Date.now()}` : seg.audio_url
                    const audioDur = response.segment.audio_duration
                    const slotDur = seg.end_time - seg.start_time
                    const shouldShrink = audioDur != null && audioDur > 0 && audioDur < slotDur * 0.85
                    let shrunkEnd = seg.end_time
                    if (shouldShrink) {
                      const buffer = getTrailingBuffer(seg.preview_text ?? seg.active_text ?? seg.target_text ?? '')
                      shrunkEnd = seg.start_time + audioDur + buffer
                      shrunkEnd = Math.min(shrunkEnd, seg.end_time)
                      const nextSeg = displaySegments[idx + 1]
                      if (nextSeg) {
                        shrunkEnd = Math.min(shrunkEnd, nextSeg.start_time - 0.05)
                      }
                      shrunkEnd = Math.max(shrunkEnd, seg.start_time + 0.1)
                      updateSegment(idx, { end_time: shrunkEnd })
                      commitSegmentChanges(idx, { committed_end_time: shrunkEnd })
                      apiClient.commitSegmentTiming(jobId, seg.transcript_index ?? idx, {
                        committed_end_time: shrunkEnd,
                      }).catch(err => console.warn('[AUTO-SHRINK]', err))
                    }
                    updateSegment(idx, { audio_url, status: 'edited', was_truncated: false })
                    setImportedSegments(prev => {
                      if (!prev) return prev
                      return prev.map((s, i) => i === idx ? { ...s, audio_url, committed_audio_url: audio_url, status: 'edited' as const, was_truncated: false, ...(shouldShrink ? { end_time: shrunkEnd } : {}) } : s)
                    })
                    commitSegmentChanges(idx, { committed_audio_url: audio_url })
                  } catch (err: any) {
                    setRegenError('Generation failed — please try again')
                  } finally {
                    setIsRegenerating(false)
                    setRegeneratingSegmentIndex(null)
                  }
                }}
              >
                Generate Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Segment Modal */}
      {showAddSegment && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-6 w-[500px] shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Add New Segment</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddSegment(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm text-neutral-400 mb-1">Start Time (MM:SS or HH:MM:SS)</label>
                  <input
                    type="text"
                    placeholder="00:00"
                    value={newSegmentStart}
                    onChange={(e) => setNewSegmentStart(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-neutral-400 mb-1">End Time (MM:SS or HH:MM:SS)</label>
                  <input
                    type="text"
                    placeholder="00:05"
                    value={newSegmentEnd}
                    onChange={(e) => setNewSegmentEnd(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm text-neutral-400 mb-1">Original Text (Source Language)</label>
                <textarea
                  placeholder="Enter the original spoken text..."
                  value={newSegmentOriginal}
                  onChange={(e) => setNewSegmentOriginal(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:border-blue-500 resize-none h-20"
                />
              </div>
              
              <div>
                <label className="block text-sm text-neutral-400 mb-1">Translation (Target Language)</label>
                <textarea
                  placeholder="Enter the translated text..."
                  value={newSegmentTranslation}
                  onChange={(e) => setNewSegmentTranslation(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:border-amber-500 resize-none h-20"
                />
              </div>
              
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  className="border-neutral-700"
                  onClick={() => setShowAddSegment(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-amber-500 hover:bg-amber-600 text-black"
                  onClick={handleAddSegment}
                  disabled={!newSegmentStart || !newSegmentEnd || !newSegmentOriginal}
                >
                  Add Segment
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showExportModal && jobId && (
        <ExportModal
          jobId={jobId}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {showReviewQueue && (
        <ReviewQueuePanel
          segments={displaySegments}
          onClose={() => setShowReviewQueue(false)}
          onJumpToSegment={(idx) => {
            selectSegment(idx)
            setCurrentTime(displaySegments[idx] ? effStart(displaySegments[idx]) : 0)
          }}
          onMarkOk={handleMarkOk}
        />
      )}
    </div>
  )
}
