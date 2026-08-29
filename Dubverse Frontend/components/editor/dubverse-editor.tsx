'use client'

import { useEffect, useLayoutEffect, useCallback, useState, useRef, useMemo, memo, type ReactNode } from 'react'
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
  ArrowRightLeft,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import type { RegenerateSegmentRequest, RetentionState } from '@/lib/api-client'
import { VoiceLibraryPanel } from '@/components/voice-library-modal'
import { CustomVoicesModal } from '@/components/editor/custom-voices-modal'
import { TestClipsPanel } from '@/components/editor/test-clips-panel'
import { EmotionLibraryPopup } from '@/components/editor/emotion-library-popup'
import { CharacterProfilePopover } from '@/components/editor/character-profile-popover'
import { useEditorStore, type SidebarTab, CHUNK_SECONDS } from '@/lib/editor-store'
import type { Segment, Scene, QCScore, QCFinding, QCFindingType, QCReport, SegmentNuances, NuanceMarker, NuanceMarkerType, StagedEdit } from '@/lib/editor-types'
import { normalizeScenes } from '@/lib/editor-types'
import { DEFAULT_NUANCES, NUANCE_MARKER_META, newSegmentId, newSceneId, getSegmentKey, defaultScenes, computeVideoFadeOpacity, timelineToSourceTime, sourceToTimelineTime } from '@/lib/editor-types'
import { formatTime, getSpeakerColor } from '@/lib/editor-types'
import { applyQCFix } from '@/lib/qc-fixes'
import { VideoRecorder } from '@/components/video-recorder'
import { QCQualityPanel } from '@/components/editor/qc-quality-panel'
import { SegmentQCPanel } from '@/components/editor/segment-qc-panel'
import { EmotionLedTrack } from '@/components/editor/emotion-led-track'
import { FloatingEmotionChart } from '@/components/editor/floating-emotion-chart'
import { AdvancedChordBrowser } from '@/components/editor/advanced-chord-browser'
import { CharacterProfilesPanel } from '@/components/editor/character-profiles-panel'
import { AdaptationPanel } from '@/components/editor/adaptation-panel'
import VelmaPanel from '@/components/editor/velma-panel'
import RespeecherPanel from '@/components/editor/respeecher-panel'
import SeedLibraryPanel, { buildSeedLibrary } from '@/components/editor/seed-library-panel'
import PerformPanel from '@/components/editor/perform-panel'
import { HeatmapBar } from '@/components/timeline/HeatmapBar'
import { SpeakerVoicePanel } from '@/components/editor/speaker-voice-panel'
import { ExportModal } from '@/components/editor/export-modal'
import { ReviewQueuePanel } from '@/components/editor/review-queue-panel'
import { stitchRPT, stitchRPTWindow, overlayStagedEdits, clearCache, scheduleRPTPlayback, effStart, effEnd, CROSSFADE_MAX_SEC, CROSSFADE_WARN_SEC } from '@/lib/rpt-engine'
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
import { LayoutList, AudioLines, Zap, GitBranch, Sliders, MessageCircle, ArrowUp, AlertCircle } from 'lucide-react'
import { usePlan } from '@/lib/use-plan'
import { useUsage } from '@/hooks/use-usage'

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
  // Identity of the segment this menu is for. `index` is still the row position
  // (used for the on* callbacks); this is what the transient collections key on.
  segmentKey: string
  lockedSegments: Set<string>
  lockedPairs: Set<string>
  stagedEmotions: Record<string, string>
  emotions: string[]
  onSplit: (index: number) => void
  onSplitAtWord: (index: number) => void
  onAddAfter: (index: number) => void
  onMerge: (index: number) => void
  canMergeNext: boolean
  onDelete: (index: number) => void
  onToggleLock: (index: number) => void
  onLockScene: (index: number) => void
  onUnlockScene: (index: number) => void
  onTogglePair: (index: number) => void
  onRevert: (index: number) => void
  onUndoLastEdit: (index: number) => void
  onUndoSplit: (index: number) => void
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
  segmentKey,
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
  onLockScene,
  onUnlockScene,
  onTogglePair,
  onRevert,
  onUndoLastEdit,
  onUndoSplit,
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
          onContextMenu={(e) => {
            coordsRef.current = { x: e.clientX, y: e.clientY }
            // The timeline as a whole is also a context-menu trigger, for empty
            // track space. Stop here so the innermost target wins and two menus
            // never open on one click.
            e.stopPropagation()
          }}
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
        <ContextMenuItem
          disabled={!canMergeNext}
          onClick={(e) => { e.stopPropagation(); onUndoSplit(index) }}
          className="text-xs gap-2">
          ✂ Undo Segment Split
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
          {lockedSegments.has(segmentKey) ? '🔓 Unlock' : '🔒 Lock'}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={(e) => {
            e.stopPropagation()
            if (lockedSegments.has(segmentKey)) onUnlockScene(index)
            else onLockScene(index)
          }}
          className="text-xs gap-2">
          {lockedSegments.has(segmentKey) ? '🔓 Unlock Scene' : '🔒 Lock Scene…'}
        </ContextMenuItem>
        <ContextMenuItem onClick={(e) => { e.stopPropagation(); onTogglePair(index) }} className="text-xs gap-2">
          {lockedPairs.has(segmentKey) ? '🔗 Unpair' : '🔗 Pair with Next'}
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
                    stagedEmotions[segmentKey] === emotion
                      ? "bg-amber-500/20 text-amber-400 font-medium"
                      : "text-slate-300 hover:bg-slate-700 hover:text-white"
                  )}>
                  {stagedEmotions[segmentKey] === emotion && '✓ '}{emotion}
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
  scenes?: Scene[]
  snapshotSegments?: Segment[]
  qcScore?: QCScore | null
  qcFindings?: QCFinding[]
  qcAnalysis?: any
  qcLoading?: boolean
  qcUpdatedAt?: string | null
  canReanalyze?: boolean
  onReanalyze?: () => void
  speakerGenders?: Record<string, string>
  voiceMapping?: Record<string, string>
  traitsMapping?: Record<string, string[]>
  onExport?: () => void
  onShare?: () => void
  onGenerateSpeech?: () => void
  onTranslateAndDub?: () => void
  // Chunk-lens editor: persisted per-chunk status from segments.json
  chunkStatus?: Record<string, string>
  /** Deletion countdown from segments.json, surfaced by the editor page. */
  retention?: RetentionState
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
  // The backend emits silences.silences (analyze_dub.py:459), not .gaps. Reading
  // the wrong key meant the panel showed "N unexpected" in the header with an
  // empty list beneath it, and no silence findings were ever generated.
  ;(silences.silences ?? []).forEach((gap: any, i: number) => {
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
    // When the analysis was actually produced, not when this mapping ran —
    // stamping "now" made a cached result from an earlier dub look current.
    generated_at: analysis.generated_at ?? new Date().toISOString(),
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
      // Backend key is mean_speed_ratio (analyze_dub.py:527). Reading speed_mean
      // always fell through to the 1.0 default, so the panel reported "Mean 1x"
      // regardless of what the audio did.
      mean: speedData.mean_speed_ratio ?? 1.0,
      std_dev: speedData.speed_std_dev ?? 0.1,
    },
    silence_gaps: {
      unexpected_count: silences.unexpected_silences ?? 0,
      gaps: (silences.silences ?? []).map((g: any) => ({
        start: g.start ?? 0,
        end: g.end ?? 0,
        duration: g.duration ?? 0,
      })),
    },
    loudness: {
      within_spec: analysis.loudness?.within_spec ?? true,
      // These three were reading keys the backend does not emit
      // (analyze_dub.py:572-574), so the panel displayed its own fallback
      // literals — -23 LUFS / -1.0 peak / 7.0 range — as if they were measured.
      // -23 LUFS is outside the -14±3 spec the backend scores against, so the
      // "within spec" badge and the numbers beside it contradicted each other.
      lufs: analysis.loudness?.integrated_loudness_lufs ?? -23,
      peak_db: analysis.loudness?.true_peak_dbfs ?? -1,
      range_lu: analysis.loudness?.loudness_range_lu ?? 7,
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
/** Validate a write-in draft. Returns an error message, or null when it's safe
 *  to send. Shared by the live onChange check and submit()'s final guard so the
 *  two can never disagree. Empty is not an error — just nothing to do yet. */
function validateWriteIn(draft: string): string | null {
  const d = draft.trim()
  if (!d) return null
  const opens  = (d.match(/\[/g) ?? []).length
  const closes = (d.match(/\]/g) ?? []).length
  // "[Defiant}" makes the tag-stripping regex run on to the NEXT square ],
  // swallowing the line text with it — and Fish voices whatever it can't parse.
  if (/[{}]/.test(d)) return 'Use [square] brackets — { } will be spoken aloud.'
  if (opens !== closes) {
    return opens > closes
      ? 'Unclosed [ — every tag needs a matching ].'
      : 'Stray ] — check your tags.'
  }
  const outside  = d.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
  const isScript = opens > 0 && outside.length > 0
  if (!isScript && outside.split(/\s+/).filter(Boolean).length > 12) {
    return 'That looks like a line, not an emotion — put delivery notes in [brackets].'
  }
  return null
}

/** True when the draft is a Delivery Script (tags AND prose outside them)
 *  rather than a bare emotion descriptor. Assumes validateWriteIn() passed. */
function isDeliveryScript(draft: string): boolean {
  const d = draft.trim()
  const opens = (d.match(/\[/g) ?? []).length
  const outside = d.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
  return opens > 0 && outside.length > 0
}

/** Playback tracing. Off in every build — these fire during play and scrub,
 *  so they are console noise in a shipped product and cost real time when
 *  DevTools is open. Flip to true locally to trace the playhead or the RPT
 *  scheduling effect; never commit it as true. */
/** Where the playhead begins, in px from the top of the timeline container.
 *
 *  Composed rather than hard-coded so it survives a track being resized:
 *  the clickable seek header (h-6), the time ruler (h-10), then the layover
 *  track (h-20) which the needle deliberately does NOT cross.
 *
 *  The layover bay is where sections lifted out of the picture are parked. A
 *  needle running through it would say its contents play at that moment, which
 *  is precisely what being parked means they do not.
 */
const SEEK_HEADER_H = 24   // h-6
const LAYOVER_TRACK_H = 80 // h-20
const MID_RULER_H = 20     // h-5, between the parking bay and the picture
// The overhead ruler is gone: the scale that matters sits directly above the
// picture, where a cut is actually aligned to a timecode.
const PLAYHEAD_TOP = SEEK_HEADER_H + LAYOVER_TRACK_H + MID_RULER_H

const DEBUG_PLAYBACK = false

/**
 * Timeline ruler ticks — one per second across the whole film.
 *
 * Split out of DubVerseEditor and memoized because it is the single most
 * expensive thing in the render. A 105-minute feature is 6,297 ticks, and the
 * editor renders TWO of these, so ~13,000 element slots were being reconciled
 * on every state change anywhere in the component. Measured on Ip Man 2: a
 * click on the header cost 2.2s, play/pause 4.8s, and the seek header 9.6s
 * (INP, against a 200ms "good" threshold) — all of it this.
 *
 * Every prop here is a primitive, so memo skips the whole subtree unless the
 * zoom level or the film changes. Keep it that way: passing an object, an
 * array, or an inline callback would defeat the memo and quietly restore the
 * old cost.
 */
interface TimeRulerProps {
  /** Film duration in seconds. */
  durationSec: number
  /** Pixels per second — `40 * zoomLevel` in the editor. */
  pps: number
  /** 'top' draws 3-level ticks with major+mid labels; 'bottom' is half-height,
   *  major ticks labelled, minor ticks omitted entirely; 'mid' is the strip between
   *  the parking bay and the picture — second-by-second markers, labelled at 10s. */
  variant: 'top' | 'bottom' | 'mid'
}

const TimeRuler = memo(function TimeRuler({ durationSec, pps, variant }: TimeRulerProps) {
  const ticks = Math.ceil(durationSec) + 1

  if (variant === 'mid') {
    return (
      <div
        className="h-5 shrink-0 bg-[#0d1018] border-b border-neutral-700/80 relative select-none"
        style={{
          // Second markers are painted as a background gradient, NOT as elements.
          // A feature film is 6,000+ seconds, and rendering a node per tick is
          // precisely what once made a click take five seconds. The gradient costs
          // one paint and lines up exactly, because it steps by the same pps the
          // blocks and the needle use.
          backgroundImage:
            `repeating-linear-gradient(to right, rgba(148,163,184,0.40) 0px, ` +
            `rgba(148,163,184,0.40) 1px, transparent 1px, transparent ${pps}px)`,
          backgroundSize: '100% 5px',
          backgroundPosition: 'left bottom',
          backgroundRepeat: 'repeat-x',
        }}
      >
        {Array.from({ length: ticks }).map((_, i) => {
          const isMajor = i % 10 === 0
          const isMid = i % 5 === 0 && !isMajor
          if (!isMajor && !isMid) return null
          return (
            <div
              key={i}
              className="absolute bottom-0 flex flex-col-reverse items-start"
              style={{ left: i * pps }}
            >
              <div className={cn('w-px', isMajor ? 'h-3 bg-slate-300' : 'h-2 bg-slate-500')} />
              {isMajor && (
                <span className="text-[8px] font-mono leading-none mb-0.5 ml-0.5 text-slate-400 whitespace-nowrap">
                  {formatTime(i)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  if (variant === 'bottom') {
    return (
      <div className="h-5 shrink-0 bg-[#0d1018] border-t border-neutral-700/80 relative select-none">
        {Array.from({ length: ticks }).map((_, i) => {
          const isMajor = i % 10 === 0
          const isMid = i % 5 === 0 && !isMajor
          if (!isMajor && !isMid) return null
          return (
            <div
              key={i}
              className="absolute top-0 flex flex-col items-start"
              style={{ left: i * pps }}
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
    )
  }

  return (
    <div className="h-10 shrink-0 bg-[#0d1018] border-b border-neutral-700/80 relative z-10 select-none">
      {Array.from({ length: ticks }).map((_, i) => {
        const isMajor = i % 10 === 0
        const isMid = i % 5 === 0 && !isMajor

        const tickH = isMajor ? 'h-4' : isMid ? 'h-3' : 'h-1.5'
        const tickColor = isMajor ? 'bg-slate-300' : isMid ? 'bg-slate-500' : 'bg-slate-700'

        return (
          <div
            key={i}
            className="absolute bottom-0 flex flex-col-reverse items-start"
            style={{ left: i * pps }}
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
  )
})

export function DubVerseEditor({
  jobId,
  title,
  sourceLanguage,
  targetLanguage,
  videoUrl,
  dubbedVideoUrl,
  videoDuration,
  segments: initialSegments,
  scenes: initialScenes,
  snapshotSegments,
  qcScore,
  qcFindings = [],
  qcAnalysis,
  qcLoading = false,
  qcUpdatedAt = null,
  canReanalyze = false,
  onReanalyze,
  speakerGenders,
  voiceMapping: initialVoiceMapping,
  traitsMapping: initialTraitsMapping,
  onExport,
  onShare,
  onGenerateSpeech,
  onTranslateAndDub,
  chunkStatus: initialChunkStatus,
  retention: initialRetention,
}: DubVerseEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoFadeOverlayRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const layoverTrackRef = useRef<HTMLDivElement>(null)
  const videoTrackRef = useRef<HTMLDivElement>(null)
  const overviewBarRef = useRef<HTMLDivElement>(null)
  const overviewThumbRef = useRef<HTMLDivElement>(null)
  /** True while a pan drag owns the thumb, so the scroll listener does not also
   *  measure. Every measurement during a drag is a forced synchronous layout. */
  const panningRef = useRef(false)

  /** Move the overview thumb to match the timeline, writing style directly.
   *
   *  This was a state bump, which re-rendered the whole editor on every scroll
   *  event and every pointermove of a pan — the same thing that made the fade
   *  handles lag half a second behind the cursor. Scrolling fires far more often
   *  than dragging does, so it was worse here. The thumb is one element and its
   *  position derives entirely from the DOM; React never needed to be involved.
   */
  // Re-derive when the content width changes: zoom, duration, tracks added.
  const syncOverviewThumb = useCallback(() => {
    const tl = timelineRef.current
    const thumb = overviewThumbRef.current
    if (!tl || !thumb) return
    const total = Math.max(1, tl.scrollWidth)
    const view = tl.clientWidth
    const frac = Math.min(1, view / total)
    const pos = total > view ? (tl.scrollLeft / (total - view)) * (1 - frac) : 0
    thumb.style.width = `${frac * 100}%`
    thumb.style.left = `${pos * 100}%`
  }, [])
  const playheadRef = useRef<HTMLDivElement>(null)
  // Size the needle to the LAST track rather than to the timeline container.
  // `bottom-0` looked right but stopped the needle at the foot of the Original
  // track — the container's own box ends short of the rows painted below it, so
  // anchoring to it silently truncated the needle. Measuring the last
  // [data-timeline-track] ends it exactly at the bottom of the Emotion track and
  // stays correct if tracks are added, removed or toggled off.
  useLayoutEffect(() => {
    let ro: ResizeObserver | null = null
    let raf = 0
    let tries = 0
    const measure = (): boolean => {
      const el = playheadRef.current
      const container = el?.closest('[data-timeline-container]') as HTMLElement | null
      if (!el || !container) return false
      const tracks = container.querySelectorAll('[data-timeline-track]')
      const last = tracks[tracks.length - 1] as HTMLElement | undefined
      if (!last) return false
      const bottom = last.getBoundingClientRect().bottom - container.getBoundingClientRect().top
      const h = Math.max(0, bottom - PLAYHEAD_TOP)
      if (h <= 0) return false
      el.style.height = `${h}px`
      // Only start observing once there is something real to observe.
      if (!ro) {
        ro = new ResizeObserver(() => { measure() })
        ro.observe(container)
      }
      return true
    }
    // RETRY UNTIL IT LANDS. The needle and the track rows are not necessarily in
    // the DOM on the first layout pass, and a single attempt that returned early
    // left the box zero-height forever, because [] deps mean this never runs
    // again. The head still painted (it is absolutely positioned) while the body
    // vanished and the drag handle — top-0 bottom-0 — had no area to grab.
    const tick = () => {
      if (measure()) return
      if (++tries > 300) return   // ~5s; give up rather than spin forever
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => { cancelAnimationFrame(raf); ro?.disconnect() }
  }, [])
  const timeDisplayRef = useRef<HTMLSpanElement>(null)
  const chunkBarRef = useRef<HTMLDivElement>(null)
  const dragLastStateUpdateRef = useRef(0)
  const router = useRouter()
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const waveformCanvasLRef = useRef<HTMLCanvasElement>(null)
  const waveformCanvasRRef = useRef<HTMLCanvasElement>(null)
  /** Per-bucket amplitude peaks from the backend, already normalised to 0..1. */
  const peaksRef = useRef<{ left: Float32Array; right: Float32Array } | null>(null)
  const groupMoveStartXRef = useRef(0)
  const groupMoveActiveRef = useRef(false)

  const {
    setJobData,
    segments,
    scenes,
    setScenes,
    updateScene,
    splitSceneAtTime,
    mergeSceneWithPrevious,
    mergeSceneWithNext,
    parkScene,
    restoreScene,
    removeScene,
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
    setSpeakerVoiceSource,
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
    activeChunkIndex,
    setActiveChunk,
    stagedEdits,
    stageEdit,
    clearStagedEdits,
    clearStagedEditsFor,
    failedSegments,
    setFailedSegments,
    clearFailedSegment,
    saveProgress,
    setSaveProgress,
    chunkStatusMap,
    setChunkStatusMap,
  } = useEditorStore()

  const zoomLevelRef = useRef(zoomLevel)
  zoomLevelRef.current = zoomLevel

  const importedSegments = useEditorStore((state) => state.importedSegments)
  const importedSegmentsJobId = useEditorStore((state) => state.importedSegmentsJobId)
  const setImportedSegmentsRaw = useEditorStore((state) => state.setImportedSegments)
  const { hasFeature, recordingLimit, isPremium, isProfessional } = usePlan()
  const usage = useUsage()
  // Wrap the store setter so every write to importedSegments also stamps the
  // owning jobId directly via Zustand's static setState — always available,
  // never undefined, never dependent on a store action that may be missing
  // in a stale HMR session. Only a NON-NULL array claims ownership: clearing to
  // null must not stamp this job, or an emptied store gets relabelled as ours.
  // importedSegments is not persisted (see partialize in editor-store) — a reload
  // restores the stamp alone, never a (segments, jobId) pair.
  const setImportedSegments = useCallback(
    (segments: Segment[] | null | ((prev: Segment[] | null) => Segment[] | null)) => {
      setImportedSegmentsRaw(segments)
      // Read back the committed value rather than re-invoking the updater, so a
      // non-pure updater can't run its side effect twice.
      if (useEditorStore.getState().importedSegments !== null) {
        useEditorStore.setState({ importedSegmentsJobId: jobId })
      }
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
  const [rightPanelTab, setRightPanelTab] = useState<'result' | 'quality' | 'velma' | 'respeecher' | 'perform' | 'seeds' | 'studio' | 'adaptation' | 'speakers' | 'library' | 'emotions' | 'ei-library' | 'nuances' | 'chord' | 'advanced' | 'characters' | 'testclips'>('result')
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
    // Only clear on an explicit sign-out — see the same guard in the editor page.
    // Supabase emits events with a null session while the user is still signed
    // in, and clearing on those left every authenticated request tokenless.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token) {
        apiClient.setToken(session.access_token)
      } else if (event === 'SIGNED_OUT') {
        apiClient.setToken(null)
      }
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
  const qcMonitorRef = useRef<HTMLDivElement>(null)

  // Track label column width — resizable, persisted
  const [trackLabelWidth, setTrackLabelWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dubverse.editor.trackLabelWidth')
      return saved ? parseInt(saved, 10) : 112
    }
    return 112
  })
  const [isResizingTrackLabel, setIsResizingTrackLabel] = useState(false)
  const trackLabelRef = useRef<HTMLDivElement>(null)
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
  const [lockedPairs, setLockedPairs] = useState<Set<string>>(new Set())
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
  const [stagedSpeeds, setStagedSpeeds] = useState<Record<string, number>>({})
  const [stagedEmotions, setStagedEmotions] = useState<Record<string, string>>({})
  const [stagedVoices, setStagedVoices] = useState<Record<string, string>>({})
  const [renamingSpeakerId, setRenamingSpeakerId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [stagedPitches, setStagedPitches] = useState<Record<string, number>>({})
  const [stagedNuances, setStagedNuances] = useState<Record<string, Partial<SegmentNuances>>>({})
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
  // Live validation message for the open write-in box; null = valid. Only one
  // write-in is open at a time (inlineEmotionWriteIn), so a single slot is enough.
  const [writeInError, setWriteInError] = useState<string | null>(null)
  // Transient notice, write-in only: the Delivery Script moves the segment off
  // Respeecher, which the user didn't ask for and would otherwise only notice
  // from the engine chip. A pill rather than a modal — it reports, it doesn't
  // need an answer.
  const [engineNotice, setEngineNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!engineNotice) return
    const t = setTimeout(() => setEngineNotice(null), 3000)
    return () => clearTimeout(t)
  }, [engineNotice])
  // Emotion Library popup: which segment it targets + whether picking stages the
  // emotion pill ('stage') or inserts a [tag] into the write-in draft ('insert').
  const [emotionLibraryTarget, setEmotionLibraryTarget] = useState<{ index: number; mode: 'stage' | 'insert' } | null>(null)
  const [userInitials, setUserInitials] = useState("JA")
  const [showRevertAllConfirm, setShowRevertAllConfirm] = useState(false)
  const [showReviewQueue, setShowReviewQueue] = useState(false)
  // Advanced ▸ "Release for render": lets MAKE MOVIE proceed with failed
  // segments outstanding. Deliberately NOT persisted — releasing is a decision
  // about one render, not a standing preference, and it should have to be made
  // again if the user reloads and reconsiders.
  const [releasedForRender, setReleasedForRender] = useState(false)
  // Deletion countdown. Loaded with the segments; the card only appears inside
  // the warning window so it is a warning, not permanent furniture.
  const [retention, setRetention] = useState<RetentionState | null>(null)
  const [retentionDismissed, setRetentionDismissed] = useState(false)
  const [isResubmitting, setIsResubmitting] = useState(false)
  const [resubmitError, setResubmitError] = useState<string | null>(null)

  // Switch-chunk guard. stagedEdits is session-local, so leaving a chunk with
  // unsaved takes would discard the user's work silently — the one failure mode
  // that loses effort with no warning and no way back.
  const [pendingChunkSwitch, setPendingChunkSwitch] = useState<number | null>(null)
  const [chunkSwitchBusy, setChunkSwitchBusy] = useState<'save' | 'discard' | null>(null)
  const isDraggingNeedleRef = useRef(false)
  // Ref bridge to the RPT stop helper, which is declared later in the component.
  const stopAllRptAudioRef = useRef<() => void>(() => {})
  // Ref bridge to dynamic chunk boundaries, computed later in the component.
  const chunkBoundariesRef = useRef<number[]>([0])

  /** Jump the viewport and the playhead to a specific chunk. */
  const goToChunk = useCallback((target: number) => {
    if (videoRef.current) {
      videoRef.current.pause()
    }
    stopAllRptAudioRef.current()
    setIsPlaying(false)
    const newStart = chunkBoundariesRef.current[target] ?? target * CHUNK_SECONDS
    setActiveChunk(target)
    setCurrentTime(newStart)
    if (videoRef.current) {
      videoRef.current.currentTime = timelineToSourceTime(newStart, scenesRef.current) ?? newStart
    }
    const container = timelineRef.current
    if (container) {
      container.scrollLeft = Math.max(0, newStart * 40 * zoomLevel)
    }
  }, [setActiveChunk, setCurrentTime, setIsPlaying, zoomLevel])

  // commitOrStage is declared further down (it needs chunkMode and jobId), but
  // four edit handlers above it must reach it. A ref keeps them on the current
  // version instead of one closed over from an earlier render.
  const commitOrStageRef = useRef<
    ((ti: number, data: Record<string, unknown>) => Promise<unknown>) | null
  >(null)

  // Same reason: the timeline's native drop listener is installed above
  // applyVoiceToSpeaker's declaration but must call it.
  const applyVoiceToSpeakerRef = useRef<
    ((speakerId: string, voiceId: string) => Promise<unknown>) | null
  >(null)

  /** Chunk navigation goes through here: it asks first when work is staged.
   *  Auditioned voices, speeds and emotions live only in staged state, so
   *  leaving a window without asking would throw them away. */
  const requestChunkSwitch = useCallback((target: number) => {
    if (Object.keys(stagedEdits).length === 0) {
      goToChunk(target)
      return
    }
    setPendingChunkSwitch(target)
  }, [stagedEdits, goToChunk])

  // resolveChunkSwitch is defined after handleSaveStaged (it calls it).

  const handleResubmitRetention = useCallback(async () => {
    if (!jobId || isResubmitting) return
    setIsResubmitting(true)
    try {
      const next = await apiClient.resubmitRetention(jobId)
      // Updating retention is the feedback: the countdown card's condition is
      // days_left <= warn_days, so a successful resubmit makes it disappear.
      setRetention(next)
      setRetentionDismissed(false)
      setResubmitError(null)
    } catch (err: any) {
      setResubmitError(err?.message || 'Could not postpone deletion')
    } finally {
      setIsResubmitting(false)
    }
  }, [jobId, isResubmitting])
  const [contextSegmentIndex, setContextSegmentIndex] = useState<number | null>(null)
  const [dragSpeedPreview, setDragSpeedPreview] = useState<{ index: number; speed: number } | null>(null)
  const [waveformReady, setWaveformReady] = useState(false)
  // Briefly surface an "Updated <time>" note under the Re-analyze button after a
  // successful re-analyze, then fade it out.
  const [showReanalyzedNote, setShowReanalyzedNote] = useState(false)
  const [dragReorder, setDragReorder] = useState<{
    fromIndex: number
    toIndex: number | null
    isDragging: boolean
  } | null>(null)

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
        commitOrStageRef.current!(displaySegmentsRef.current[drag.index]?.transcript_index ?? drag.index, {
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
    // The browser fires this instead of mouseup when it takes over a gesture.
    window.addEventListener('pointercancel', handleInterrupt)
    document.addEventListener('visibilitychange', handleInterrupt)
    return () => {
      window.removeEventListener('mouseup', handleInterrupt)
      window.removeEventListener('blur', handleInterrupt)
      window.removeEventListener('pointercancel', handleInterrupt)
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
            const dropKey = displaySegmentsRef.current[hit.index]?.id ?? ''
            setStagedVoices(prev => ({ ...prev, [dropKey]: parsed.voice_id }))
            if (speakerId) {
              setSpeakerVoiceMap(prev => ({ ...prev, [speakerId]: parsed.voice_id }))
              setStagedVoices(prev => {
                const next = { ...prev }
                displaySegmentsRef.current.forEach((seg, i) => {
                  if (seg.speaker_id === speakerId && i !== hit.index) delete next[getSegmentKey(seg)]
                })
                return next
              })
            }
            selectSegment(hit.index)
            setCurrentTime(displaySegmentsRef.current[hit.index].start_time)
            console.log('[VOICE-DROP] calling handleGenerateSpeech (native)', { index: hit.index, voice_id: parsed.voice_id })
            // A Fish voice implies the Fish engine — same reason as the React
            // onDrop below. Missed here originally because the timeline drop is
            // handled by this native listener rather than that one, so dropping
            // onto the Dubbed track fell through to the backend's unknown-voice
            // backstop instead of saying what it meant.
            if (speakerId) {
              // Same outcome as the transcript-row drop and the Assign to…
              // dropdown: the voice belongs to the SPEAKER across this window,
              // not just to the one line it was dropped on.
              setVoiceAppliedFeedback({ segmentIndex: hit.index, voiceName: parsed.name })
              setTimeout(() => setVoiceAppliedFeedback(null), 2200)
              applyVoiceToSpeakerRef.current?.(speakerId, parsed.voice_id)
            } else {
              handleGenerateSpeechRef.current(hit.index, parsed.voice_id, undefined, undefined, 'fish-audio').then(ok => {
                if (ok) {
                  console.log('[VOICE-DROP] regen succeeded — showing applied chip (native)', { index: hit.index, voiceName: parsed.name })
                  setVoiceAppliedFeedback({ segmentIndex: hit.index, voiceName: parsed.name })
                  setTimeout(() => setVoiceAppliedFeedback(null), 2200)
                } else {
                  console.warn('[VOICE-DROP] regen failed — no confirmation chip (native)')
                }
              })
            }
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

  // Fetch precomputed waveform peaks — runs once on mount.
  //
  // This used to fetch the separated stem itself and decode it here. A stem is
  // full-length uncompressed WAV — 1.06 GB for a 105-minute feature — and
  // decodeAudioData needs it again as float32, so it threw EncodingError every
  // time: a gigabyte transferred and no waveform, on every editor load. The
  // backend now reduces it to per-bucket peaks once and caches them: 57 KB.
  //
  // Nothing is lost by it. A waveform is only ever drawn at screen resolution,
  // so the samples were being discarded by the renderer regardless.
  useEffect(() => {
    if (!jobId) return
    const url = apiClient.toAbsoluteUrl(`/api/media/${jobId}/waveform/accompaniment`)
    fetch(url)
      .then(res => {
        // 404 is expected, not a failure: the stem only exists when separation
        // ran, and long-form sources skip it (see the backend's
        // ACCOMPANIMENT_MAX_DURATION_S guard). No stem, no background waveform.
        if (res.status === 404) return null
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: { left: number[]; right: number[] } | null) => {
        if (!data?.left?.length) return
        // Stored as int8 (-127..127) because the renderer maps them to 48px of
        // height; normalised here once rather than per draw.
        peaksRef.current = {
          left: Float32Array.from(data.left, v => v / 127),
          right: Float32Array.from(data.right ?? data.left, v => v / 127),
        }
        setWaveformReady(true)
      })
      .catch(err => {
        console.warn('[waveform] peaks unavailable:', err)
      })
  }, [jobId])

  // Redraw the waveform when the peaks arrive or the zoom changes.
  useEffect(() => {
    const peaks = peaksRef.current
    if (!waveformReady || !peaks) return
    const canvasWidth = Math.min(Math.floor(videoDuration * 40 * zoomLevel), 16000)
    const canvasHeight = 48 // h-12 = 48px per channel row
    const barW = 2
  
    // Peaks are a fixed 8000 buckets regardless of zoom, so each bar takes the
    // loudest bucket it covers. Zoomed in that is fewer than one bucket per bar
    // and the same value repeats — the honest result, since the backend cannot
    // send detail the renderer could not have drawn anyway.
    const bucketsPerPx = peaks.left.length / Math.max(1, canvasWidth)
  
    const drawChannel = (canvasRef: React.RefObject<HTMLCanvasElement>, data: Float32Array) => {
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
      for (let x = 0; x < canvasWidth; x += barW) {
        const from = Math.floor(x * bucketsPerPx)
        const to = Math.max(from + 1, Math.floor((x + barW) * bucketsPerPx))
        let peak = 0
        for (let b = from; b < to && b < data.length; b++) {
          if (data[b] > peak) peak = data[b]
        }
        const h = peak * (canvasHeight - 1) * 0.75
        if (h > 0.5) ctx.fillRect(x, canvasHeight - h, barW, h)
      }
    }
  
    drawChannel(waveformCanvasLRef, peaks.left)
    drawChannel(waveformCanvasRRef, peaks.right)
  }, [waveformReady, zoomLevel, videoDuration])

  // Re-derive the overview thumb when the content width changes: zoom, duration,
  // or a track being added all change scrollWidth without a scroll event firing.
  useEffect(() => { syncOverviewThumb() }, [syncOverviewThumb, zoomLevel, videoDuration, scenes.length])
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
  const currentTimeRef = useRef(currentTime)
  currentTimeRef.current = currentTime
  // Tracks where playback started so Stop returns to that position (not 0)
  const lastStartPosRef = useRef(0)
  // AudioContext.currentTime when the latest RPT playback started, so the
  // playhead can follow the audio even if the video element stalls.
  const audioStartTimeRef = useRef<number | null>(null)
  // Pending regen while one is in flight (depth 1, last-write-wins).
  // engineOverride and extraPayload ride along: a deferred regen replayed without
  // them silently falls back to the segment's stored engine and loses any pinned
  // seed, so a voice drop or a library recall issued while another regen was in
  // flight would come back on the wrong engine or as a fresh race.
  const regenQueueRef = useRef<{
    segIdx?: number
    voiceOverride?: string
    textOverride?: string
    ttsTextOverride?: string
    engineOverride?: string
    extraPayload?: Partial<RegenerateSegmentRequest>
  } | null>(null)
  const autoRegenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingAutoRegenRef = useRef<number | null>(null)
  const [editingText, setEditingText] = useState('')
  // Live value of the edit box. The Input is UNCONTROLLED: a controlled input
  // here re-rendered the whole editor on every keystroke — timeline, QC monitor,
  // every visible row — which made backspace lag and the caret jump. Typing now
  // writes only to this ref, so it costs nothing; readers take .current.
  const editingTextRef = useRef('')
  const [previewWidth, setPreviewWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dubverse.editor.previewWidth')
      return saved ? parseInt(saved, 10) : 520
    }
    return 520
  })
  const [isResizingPreview, setIsResizingPreview] = useState(false)
  const previewPanelRef = useRef<HTMLDivElement>(null)
  const [timelineHeight, setTimelineHeight] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dubverse.editor.timelineHeight')
      return saved ? parseInt(saved, 10) : 360
    }
    return 360
  })
  const [isResizingTimeline, setIsResizingTimeline] = useState(false)

  /** Whether the timeline scrolls to keep the playhead centred.
   *
   *  OFF by default. Following is what you want while WATCHING a pass; while
   *  editing it means the view slides out from under you the moment playback
   *  moves, and a line you were correcting ends up somewhere you have to go and
   *  find. Editing is the common case here, so the timeline holds still unless
   *  asked otherwise. */
  const [followPlayhead, setFollowPlayhead] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('dubverse.editor.followPlayhead') === '1'
    }
    return false
  })
  const followPlayheadRef = useRef(followPlayhead)
  followPlayheadRef.current = followPlayhead
  const timelinePanelRef = useRef<HTMLDivElement>(null)

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

  // Every recorded Respeecher take across the job, flattened out of the segments.
  // Built here rather than inside the panel so the tab can be sized without
  // mounting it, and so it recomputes on the same input the timeline renders from.
  const seedLibrary = useMemo(() => buildSeedLibrary(displaySegments), [displaySegments])

  /** Segments whose committed window collides with a neighbour's.
   *
   *  Overlapping audio is never valid output — two lines play over each other.
   *  The backend now refuses to create one, but overlaps written before that
   *  guard existed are still on disk (17 of 817 on the first feature) and no
   *  regen will revisit them unless the user goes back. Surfacing them on the
   *  row is what turns "why is this running into the next line" into something
   *  actionable. Compared in time order, not array order: the two can diverge
   *  after splits and moves. */
  const overlapById = useMemo(() => {
    const byTime = displaySegments
      .map((seg, index) => ({ index, start: effStart(seg), end: effEnd(seg) }))
      .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end))
      .sort((a, b) => a.start - b.start)
    const out = new Map<number, number>()
    for (let i = 0; i < byTime.length - 1; i++) {
      const by = byTime[i].end - byTime[i + 1].start
      if (by > 0.01) {
        out.set(byTime[i].index, Math.max(out.get(byTime[i].index) ?? 0, by))
        out.set(byTime[i + 1].index, Math.max(out.get(byTime[i + 1].index) ?? 0, by))
      }
    }
    return out
  }, [displaySegments])

  /**
   * Resolve a row position to the stable key of whatever segment is sitting
   * there RIGHT NOW. Every transient collection (staged voices/emotions/speeds/
   * pitches/nuances, locks, pairs, glow) is keyed by segment identity, never by
   * position — so a delete or insert can no longer slide someone else's staged
   * settings onto a segment.
   *
   * Resolving position -> identity at the moment of use is correct: when the
   * user clicks row 4 they mean the segment currently in row 4. What was wrong
   * before was STORING that position and reading it back later, after the array
   * had moved underneath it.
   *
   * Returns '' for an out-of-range index, which no collection will ever match.
   */
  const keyAt = useCallback((i: number | null | undefined): string => {
    if (i == null) return ''
    const s = displaySegments[i]
    return s ? getSegmentKey(s) : ''
  }, [displaySegments])

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
    return Math.abs(draggedIdx - index) === 1 && lockedPairs.has(keyAt(Math.min(draggedIdx, index)))
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
    const rightSegment = { ...segment, id: newSegmentId(), transcript_index: undefined, start_time: currentTime, target_text: '', source_text: '', active_text: '', preview_text: null, ...audioCleared }
    setImportedSegments(prev => {
      const base = prev ?? displaySegments
      const result = [...base]
      result.splice(index, 1, leftSegment, rightSegment)
      return result
    })
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
    undoStack.current.push({ kind: 'segment-split', index, at: 'playhead' })
    setUndoSplitLabel('Segment Split')
  }, [displaySegments, currentTime, syncSegmentsToBackend])

  /** Sections lifted out of the picture. Laid out by arrival, not by timeline
   *  position — a parked scene owns no position, which is the point of it. */
  const parkedScenes = useMemo(() => scenes.filter(sc => sc.parked), [scenes])
  /** Scenes claiming the same instant as another scene.
   *
   *  Scenes may now be placed freely, so an overlap is a real possibility rather
   *  than something the normaliser quietly removed. It is not necessarily a
   *  mistake while work is in progress — but the render has to pick ONE source for
   *  an overlapped instant, so it cannot go out unnoticed. Flagged, not corrected. */
  const overlappingSceneIds = useMemo(() => {
    const live = scenes.filter(sc => !sc.parked).sort((a, b) => a.start - b.start)
    const bad = new Set<string>()
    for (let i = 1; i < live.length; i++) {
      if (live[i].start < live[i - 1].end - 0.001) {
        bad.add(live[i].id)
        bad.add(live[i - 1].id)
      }
    }
    return bad
  }, [scenes])
  const [parkedMenu, setParkedMenu] = useState<{ x: number; y: number; sceneId: string } | null>(null)
  // Drag state for reordering parked scenes or pulling one back to the picture.
  const [draggingParkedId, setDraggingParkedId] = useState<string | null>(null)


  /** Right-click target on the video strip. */
  /** Segment the timeline-wide context menu acts on. The selected one, or the
   *  first segment when nothing is selected — the menu's playhead-based actions
   *  (Split at Playhead, Merge with Next) already work from the playhead, so this
   *  only decides which row Copy/Paste/Lock apply to. */
  const timelineCtxIndex = Math.max(0, Math.min(selectedSegmentIndex ?? 0, Math.max(0, displaySegments.length - 1)))

  const [sceneMenu, setSceneMenu] = useState<{ x: number; y: number; sceneId: string } | null>(null)

  /** Persist scenes, repairing the list first.
   *
   *  Scene drags only ever wrote the scene being dragged, so moving a boundary
   *  left its neighbour where it was and the list stopped being a partition of
   *  the timeline — overlapping scenes whose fade ramps both drew, stacked, over
   *  continuous footage. Normalising here catches every route to disk rather than
   *  relying on each call site to remember.
   */
  const persistScenes = useCallback(() => {
    const fixed = normalizeScenes(useEditorStore.getState().scenes, videoDuration)
    setScenes(fixed)
    return apiClient.updateScenes(jobId, fixed)
  }, [jobId, setScenes, videoDuration])

  const handleSplitSceneAtPlayhead = useCallback(() => {
    const t = currentTimeRef.current
    if (!Number.isFinite(t) || t <= 0.05 || t >= videoDuration - 0.05) return
    splitSceneAtTime(t)
    const updatedScenes = useEditorStore.getState().scenes
    // The new scene is the one that now begins exactly at the split point. Record
    // it so undo knows which boundary to dissolve — splitSceneAtTime mints the id
    // internally and does not hand it back.
    const created = updatedScenes.find(sc => Math.abs(sc.start - t) < 0.001)
    if (created) { undoStack.current.push({ kind: 'scene-split', sceneId: created.id }); setUndoSplitLabel('Video Split') }
    persistScenes().catch(err => console.warn('[SCENE-SPLIT]', err))
  }, [splitSceneAtTime, videoDuration, jobId])

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
    const rightSegment = { ...segment, id: newSegmentId(), transcript_index: undefined, start_time: splitTime, end_time: segment.end_time, target_text: rightText, active_text: rightText, preview_text: null, ...audioCleared }
    setImportedSegments(prev => {
      const base = prev ?? displaySegments
      const result = [...base]
      result.splice(index, 1, leftSegment, rightSegment)
      return result
    })
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
    undoStack.current.push({ kind: 'segment-split', index, at: 'word' })
    setUndoSplitLabel('Word Split')
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
        id: newSegmentId(),
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
    const nowPaired = !lockedPairs.has(keyAt(index))
    setLockedPairs(prev => {
      const next = new Set(prev)
      nowPaired ? next.add(keyAt(index)) : next.delete(keyAt(index))
      return next
    })
    setFlashingPair(index)
    setTimeout(() => setFlashingPair(null), 300)
    // Persist so pairs survive refresh / crash — stored on the LEFT segment.
    const ti = displaySegmentsRef.current[index]?.transcript_index ?? index
    apiClient.commitSegmentTiming(jobId, ti, { paired_with_next: nowPaired })
      .catch(err => console.warn('[PAIR] persist failed:', err))
  }, [lockedPairs, jobId, keyAt])

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
  // ALL live stitch source nodes, not just the latest — so a hard stop can kill
  // every one (orphans can accumulate when isPlaying rapidly toggles, e.g. when the
  // video fails to play and effect 2458's catch flips isPlaying).
  const rptSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set())
  const rptGainRef = useRef<GainNode | null>(null)
  const rptCancelRef = useRef<boolean>(false)
  const scenesRef = useRef(scenes)
  scenesRef.current = scenes

  // Authoritative "silence everything now" — stops every registered stitch source,
  // syncs the refs so nothing reschedules. Callers handle the video element.
  const stopAllRptAudio = useCallback(() => {
    isPlayingRef.current = false
    rptCancelRef.current = true
    rptSourcesRef.current.forEach(src => {
      try { src.onended = null } catch {}
      try { src.stop() } catch {}
      try { src.disconnect() } catch {}
    })
    rptSourcesRef.current.clear()
    rptSourceRef.current = null
  }, [])
  stopAllRptAudioRef.current = stopAllRptAudio

  // Register a freshly-scheduled source so stopAllRptAudio can reach it.
  const registerRptSource = useCallback((src: AudioBufferSourceNode) => {
    rptSourcesRef.current.add(src)
    src.onended = () => {
      rptSourcesRef.current.delete(src)
      if (rptSourceRef.current === src) rptSourceRef.current = null
    }
    rptSourceRef.current = src
  }, [])
  const [isMutedRPT, setIsMutedRPT] = useState(false)
  const [rptVolume, setRptVolume] = useState(80)
  const [rptPlaybackRate, setRptPlaybackRate] = useState(1.0)
  // Read inside the rAF loop, which does not re-subscribe on rate changes.
  const rptPlaybackRateRef = useRef(rptPlaybackRate)
  rptPlaybackRateRef.current = rptPlaybackRate
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
  const [lockedSegments, setLockedSegments] = useState<Set<string>>(new Set())
  // Read by the scene helpers, which are declared before setSegmentLocked and run
  // long after the render that created them.
  const lockedSegmentsRef = useRef(lockedSegments)
  lockedSegmentsRef.current = lockedSegments
  const setSegmentLockedRef = useRef<((index: number, lock: boolean) => void) | null>(null)
  // Segments showing the transient "just locked" green glow. Added on Shift+L,
  // removed after 7s — the lock itself persists, only the glow is temporary.
  const [lockGlowIndices, setLockGlowIndices] = useState<Set<string>>(new Set())
  // Restore persisted locks AND pairs once per job load, from the backend `locked`
  // and `paired_with_next` flags (the page loader carries both onto the segment).
  const locksInitRef = useRef<string | null>(null)
  useEffect(() => {
    if (locksInitRef.current === jobId) return
    if (!displaySegments.length) return
    const restoredLocks = new Set<string>()
    const restoredPairs = new Set<string>()
    displaySegments.forEach((s) => {
      const k = getSegmentKey(s)
      if (s.status === 'locked' || (s as unknown as { locked?: boolean }).locked) restoredLocks.add(k)
      if ((s as unknown as { paired_with_next?: boolean }).paired_with_next) restoredPairs.add(k)
    })
    if (restoredLocks.size) setLockedSegments(restoredLocks)
    if (restoredPairs.size) setLockedPairs(restoredPairs)
    locksInitRef.current = jobId
  }, [displaySegments, jobId])

  // Lock / unlock a segment: update local state, flash the 7s glow (lock only),
  // and persist the flag so it survives a hard refresh.
  const setSegmentLocked = useCallback((index: number, lock: boolean) => {
    // Resolve the clicked row to a segment identity once. The 7s glow timer
    // below fires long after the array may have changed, so it must close over
    // the key rather than the position.
    const key = keyAt(index)
    if (!key) return
    setLockedSegments(prev => {
      const next = new Set(prev)
      if (lock) next.add(key)
      else next.delete(key)
      return next
    })
    // Persist immediately. Locking used to live only in component state until the
    // next Save, so a lock set to protect finished work was gone after a refresh —
    // exactly the case where you most expect it to hold. The backend has always
    // accepted a locked flag on commit_segment_timing; nothing was sending it.
    const _ti = displaySegmentsRef.current[index]?.transcript_index ?? index
    commitOrStageRef.current?.(_ti, { locked: lock })
      ?.catch(err => console.warn('[LOCK] persist failed', err))
    setImportedSegments(prev => prev ? prev.map((seg, i) =>
      i === index ? { ...seg, locked: lock, status: lock ? 'locked' as const : 'auto' as const } : seg
    ) : prev)
    if (lock) {
      setLockGlowIndices(prev => new Set(prev).add(key))
      setTimeout(() => setLockGlowIndices(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      }), 7000)
    } else {
      setLockGlowIndices(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
    const ti = displaySegmentsRef.current[index]?.transcript_index ?? index
    apiClient.commitSegmentTiming(jobId, ti, { locked: lock })
      .catch(err => console.warn('[LOCK] persist failed:', err))
  }, [jobId, keyAt])
  // Published for the scene helpers above, which are declared earlier in the file.
  setSegmentLockedRef.current = setSegmentLocked

  const canMergeWithNext = useCallback((index: number): boolean => {
    const first = displaySegments[index]
    const second = displaySegments[index + 1]
    if (!first || !second) return false
    if (first.speaker_id !== second.speaker_id) return false
    if (lockedSegments.has(keyAt(index)) || lockedSegments.has(keyAt(index + 1))) return false
    if (lockedPairs.has(keyAt(index)) || lockedPairs.has(keyAt(index + 1))) return false
    return true
  }, [displaySegments, lockedSegments, lockedPairs, keyAt])

  const handleMergeWithNextRef = useRef<((index: number) => void) | null>(null)
  const handleMergeWithNext = useCallback((index: number) => {
    const first = displaySegments[index]
    const second = displaySegments[index + 1]
    if (!first || !second) return
    if (first.speaker_id !== second.speaker_id) return
    if (lockedSegments.has(keyAt(index)) || lockedSegments.has(keyAt(index + 1))) return
    if (lockedPairs.has(keyAt(index)) || lockedPairs.has(keyAt(index + 1))) return

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
      // No new id: the merged segment keeps `first`'s identity via the spread
      // above, matching the transcript_index it already inherits. A fresh id
      // would leave frontend and backend disagreeing about which segment this
      // is — and would remount the row for no reason.
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

    setImportedSegments(prev => {
      const base = prev ?? displaySegments
      const result = [...base]
      result.splice(index, 2, mergedSegment)
      return result
    })
    selectSegment(index)
    setTimeout(() => syncSegmentsToBackend(displaySegmentsRef.current), 0)
  }, [displaySegments, lockedSegments, lockedPairs, selectSegment, syncSegmentsToBackend, keyAt])
  handleMergeWithNextRef.current = handleMergeWithNext

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
    // Fires on mount as well as on an in-place switch. The editor unmounts while
    // the next job loads, so prevId is null when it remounts and a prevId-based
    // check never ran — meanwhile the module-level store still held the previous
    // job's array, which the next writer then re-stamped as this job's. Ask the
    // STORE who owns the segments, not this component's ref.
    if (prevId !== jobId) {
      const ownerJobId = useEditorStore.getState().importedSegmentsJobId
      if (ownerJobId !== null && ownerJobId !== jobId) {
        // Raw setter: the wrapper would re-stamp jobId, which is the whole bug.
        setImportedSegmentsRaw(null)
        useEditorStore.setState({ importedSegmentsJobId: null })
      }
    }
    prevJobIdRef.current = jobId

    const segmentsWithFindings = initialSegments.map((seg, idx) => {
      return {
        ...seg,
        id: seg.id || newSegmentId(),
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
      scenes: initialScenes?.length
        ? normalizeScenes(initialScenes, videoDuration)
        : defaultScenes(videoDuration),
      qcScore,
      qcFindings,
    })

    // Restore staged emotions from committed_emotion saved in segments.json
    const restoredEmotions: Record<string, string> = {}
    segmentsWithFindings.forEach((seg) => {
      if (seg.committed_emotion) restoredEmotions[getSegmentKey(seg)] = seg.committed_emotion
    })
    if (Object.keys(restoredEmotions).length > 0) {
      setStagedEmotions(prev => ({ ...restoredEmotions, ...prev }))
    }

    // Same for voice and speed. committed_voice_id / committed_speed are WRITTEN
    // on every commit but were never read back, so a per-segment voice override
    // survived on disk and vanished from the UI on refresh — the casting looked
    // like it had reverted to the speaker default. stagedVoices/stagedSpeeds are
    // component state, not persisted, so segments.json is the only way home.
    const restoredVoices: Record<string, string> = {}
    const restoredSpeeds: Record<string, number> = {}
    segmentsWithFindings.forEach((seg) => {
      if (seg.committed_voice_id) restoredVoices[getSegmentKey(seg)] = seg.committed_voice_id
      if (seg.committed_speed != null && seg.committed_speed !== 1.0) {
        restoredSpeeds[getSegmentKey(seg)] = seg.committed_speed
      }
    })
    if (Object.keys(restoredVoices).length > 0) {
      setStagedVoices(prev => ({ ...restoredVoices, ...prev }))
    }
    if (Object.keys(restoredSpeeds).length > 0) {
      setStagedSpeeds(prev => ({ ...restoredSpeeds, ...prev }))
    }

    // Speaker voice/traits maps: only initialize on initial mount or job switch.
    // Without this gate, any unrelated prop reference change (e.g. a QC poll
    // re-render passing a fresh [] for qcFindings) would re-run this effect and
    // setSpeakerVoiceMap(initialVoiceMapping) would clobber the user's
    // just-assigned voices from the Library panel.
    if (isNewJob) {
      // Ground truth for who sounds like whom is what was actually synthesised:
      // every segment carries the voice_id it was rendered with. Deriving from
      // that survives a browser wipe and cannot drift from the audio on disk.
      // A speaker may hold more than one voice_id (a mid-film reassignment), so
      // take the dominant one rather than the first seen.
      const _voiceTally: Record<string, Record<string, number>> = {}
      for (const seg of segmentsWithFindings) {
        const _vid = (seg as any).voice_id
        if (!seg.speaker_id || !_vid) continue
        _voiceTally[seg.speaker_id] ??= {}
        _voiceTally[seg.speaker_id][_vid] = (_voiceTally[seg.speaker_id][_vid] ?? 0) + 1
      }
      const _derived: Record<string, string> = {}
      for (const [_spk, _counts] of Object.entries(_voiceTally)) {
        _derived[_spk] = Object.entries(_counts).sort((a, b) => b[1] - a[1])[0][0]
      }

      // A deliberate human assignment outranks machine inference. A stale
      // persisted entry is recoverable (you hear the wrong voice and reassign);
      // derived silently overwriting a cast decision is invisible and wrong.
      const _st = useEditorStore.getState()
      const _persisted = _st.speakerVoiceMapJobId === jobId ? _st.speakerVoiceMap : {}

      // Provenance drives the strip colour: green = the user chose it, purple =
      // the dub did. Everything resolved here except a persisted entry is 'auto'.
      const _markAuto = (m: Record<string, string>) =>
        Object.fromEntries(Object.keys(m).map(k => [k, 'auto' as const]))

      if (Object.keys(_persisted).length > 0) {
        setSpeakerVoiceMap({ ..._derived, ..._persisted })
        setSpeakerVoiceSource({
          ..._markAuto(_derived),
          ...Object.fromEntries(Object.keys(_persisted).map(k => [k, 'user' as const])),
        })
      } else if (Object.keys(_derived).length > 0) {
        setSpeakerVoiceMap(_derived)
        setSpeakerVoiceSource(_markAuto(_derived))
      } else if (initialVoiceMapping && Object.keys(initialVoiceMapping).length > 0) {
        setSpeakerVoiceMap(initialVoiceMapping)
        setSpeakerVoiceSource(_markAuto(initialVoiceMapping))
      } else {
        const genders = speakerGenders ?? {}
        const voicesByGender: Record<string, string[]> = {
          // ONLY voices that actually exist in FISH_VOICE_*. An unconfigured key
          // silently resolves to the first voice in the map (male-1), which is how
          // several speakers ended up sharing one voice. Honest defaults that admit
          // "two males share a voice" beat fake variety. Extend these as the env
          // gains FISH_VOICE_MALE_3 / _4 entries.
          male:   ['male-1', 'male-2'],
          female: ['female-1'],
          child:  ['child-1'],
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
        setSpeakerVoiceSource(_markAuto(defaultMap))
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
    // Distinct URL for the crossorigin thumbnail request so it gets its own cache
    // entry — otherwise it reuses the main player's cached no-cors response (which
    // lacks Access-Control-Allow-Origin) and fails CORS in a retry loop.
    tempVideo.src = videoSrc + (videoSrc.includes('?') ? '&' : '?') + 'thumb=1'
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
  
  // Handle pause state changes. Play is driven synchronously from the play button
  // so it stays inside the user gesture; a separate effect re-playing here can
  // fail and then flip isPlaying back off, leaving RPT audio running while the
  // video (and therefore the timeline) freezes.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!isPlaying) {
      video.pause()
    }
  }, [isPlaying])

  /** Bumped whenever a stitch finishes.
   *
   *  A REF CANNOT WAKE AN EFFECT. The scheduler below starts a stitch when the
   *  buffer is missing and then returns, because the stitch is async. Writing
   *  rptBufferRef when it resolves changes no dependency, so nothing ever went
   *  back and scheduled the audio — Play produced silence until some unrelated
   *  render happened to re-run the effect. That was survivable while the buffer
   *  outlived edits; now that any edit invalidates it, it is the common path.
   *
   *  This is state, so the effect re-runs and schedules the moment audio exists. */
  const [stitchVersion, setStitchVersion] = useState(0)
  /** One stitch at a time. A drag can invalidate the buffer many times in a
   *  second, and each stitch decodes every segment in the window. */
  const stitchInFlightRef = useRef(false)

  // RPT audio playback — separate effect to avoid hook rules violation
  useEffect(() => {
    const video = videoRef.current
    if (DEBUG_PLAYBACK) console.log('[RPT-EFFECT] fired — isPlaying:', isPlaying,
      'playbackMode:', playbackMode,
      'buffer:', !!rptBufferRef.current,
      'ctx:', audioContextRef.current?.state ?? 'null',
      'gain:', rptGainRef.current?.gain.value ?? 'null',
      'rptVolume:', rptVolume,
      'isMutedRPT:', isMutedRPT)
    if (playbackMode !== 'preview') {
      // Stop RPT audio when leaving preview mode
      stopAllRptAudio()
      return
    }

    // On first switch to Preview, seed RPT manifest
    // from current dubbed segments if not yet seeded
    if (!rptBufferRef.current && !stitchInFlightRef.current) {
      initRPTFromSegments()
      // Trigger stitch immediately after seeding
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext()
      }
      const ctx = audioContextRef.current
      // THE LIVE LIST, NOT THE PROP. displaySegments is what the timeline draws;
      // the prop holds the timings the job was LOADED with. Stitching from it played
      // every line at its original position while the blocks sat where they had been
      // moved to — audio at 2:40, block at 2:50 — so the user ends up dragging
      // segments to match audio instead of placing audio against the picture.
      const resolved = displaySegmentsRef.current.map(seg => ({
        ...seg,
        audio_url: apiClient.refreshAudioUrl(jobId, seg.audio_url),
        committed_audio_url: apiClient.refreshAudioUrl(jobId, seg.committed_audio_url),
      }))
      stitchInFlightRef.current = true
      stitchWith(resolved, ctx).then(result => {
        if (result) rptBufferRef.current = result.buffer
      }).catch(err => {
        console.warn('[RPT] stitch failed', err)
      }).finally(() => {
        stitchInFlightRef.current = false
        // Wake the effect so it schedules what was just built. Without this the
        // audio exists and simply never plays.
        setStitchVersion(v => v + 1)
      })
    }

    if (!rptBufferRef.current || !audioContextRef.current) return

    if (isPlaying) {
      const ctx = audioContextRef.current
      rptCancelRef.current = false
      // Pin the start time to the editor playhead, not the video element, so a
      // stalled video does not cause the RPT audio to start from the wrong place.
      const startTime = useEditorStore.getState().currentTime
      lastStartPosRef.current = startTime
      audioStartTimeRef.current = ctx.currentTime
      const doSchedule = () => {
        if (rptCancelRef.current) return
        // Kill any existing sources first so we never layer stitch playback.
        rptSourcesRef.current.forEach(s => { try { s.onended = null } catch {} try { s.stop() } catch {} try { s.disconnect() } catch {} })
        rptSourcesRef.current.clear()
        rptSourceRef.current = null
        if (!rptGainRef.current) {
          rptGainRef.current = ctx.createGain()
          rptGainRef.current.connect(ctx.destination)
        }
        rptGainRef.current!.gain.value = isMutedRPT ? 0 : rptVolume / 100
        registerRptSource(scheduleRPTPlayback(
          rptBufferRef.current!,
          rptOffsetFor(startTime),
          ctx,
          rptGainRef.current!,
          rptPlaybackRate
        ))
      }
      // WAIT FOR THE PICTURE TO ACTUALLY START.
      //
      // play() only requests playback. The element still has to decode and, when
      // muted, the browser may deprioritise it — so the audio was scheduled and
      // running while the picture was still getting going. Everything you heard
      // then sat ahead of the needle by however long that took: about 1.4s here,
      // and not a constant, which is why it never looked like a timing-data bug.
      //
      // "playing" fires when playback genuinely begins. That is the starting gun.
      const armed = () => {
        if (ctx.state === 'suspended') ctx.resume().then(doSchedule)
        else doSchedule()
      }
      const video = videoRef.current
      if (video && video.paused) {
        const onPlaying = () => {
          // Re-pin to where the picture actually is now, not where it was when
          // Play was pressed.
          lastStartPosRef.current = useEditorStore.getState().currentTime
          audioStartTimeRef.current = ctx.currentTime
          armed()
        }
        video.addEventListener('playing', onPlaying, { once: true })
        // If the element never reports playing (already running, or a source that
        // will not start), do not hang silently.
        setTimeout(() => {
          if (audioStartTimeRef.current === ctx.currentTime) return
          video.removeEventListener('playing', onPlaying)
          armed()
        }, 400)
      } else {
        armed()
      }
    } else {
      stopAllRptAudio()
    }
  }, [isPlaying, playbackMode, isMutedRPT, rptVolume, rptPlaybackRate, stitchVersion])

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
    const resolved = displaySegmentsRef.current.map(seg => ({
      ...seg,
      audio_url: apiClient.refreshAudioUrl(jobId, seg.audio_url),
      committed_audio_url: apiClient.refreshAudioUrl(jobId, seg.committed_audio_url),
    }))
    stitchWith(resolved, ctx).then(result => {
      if (result) rptBufferRef.current = result.buffer
    })
  }, [segments.length, videoDuration, jobId])

  // RPT seek sync — restart RPT audio from new position when user scrubs
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleSeeked = () => {
      if (playbackMode !== 'preview') return
      if (!rptBufferRef.current || !audioContextRef.current) return

      // Stop ALL current RPT sources (not just the latest) before re-seeking.
      rptSourcesRef.current.forEach(s => { try { s.onended = null } catch {} try { s.stop() } catch {} try { s.disconnect() } catch {} })
      rptSourcesRef.current.clear()
      rptSourceRef.current = null

      // Only restart if video is playing (read ref to avoid stale closure)
      if (!isPlayingRef.current) return

      const ctx = audioContextRef.current
      if (ctx.state === 'suspended') ctx.resume()
      if (!rptGainRef.current) {
        rptGainRef.current = ctx.createGain()
        rptGainRef.current.connect(ctx.destination)
      }
      // In chunk mode the buffer only covers the active window: a scrub
      // outside it has nothing to play, so stop rather than scheduling
      // window-start audio at the wrong absolute position.
      if (chunkModeRef.current) {
        const t = video.currentTime
        if (t < chunkStartRef.current || t >= chunkEndRef.current) {
          return
        }
      }
      rptGainRef.current.gain.value = isMutedRPT ? 0 : rptVolume / 100
      registerRptSource(scheduleRPTPlayback(
        rptBufferRef.current,
        rptOffsetFor(video.currentTime),
        ctx,
        rptGainRef.current,
        rptPlaybackRate
      ))
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
      rptSourcesRef.current.forEach(s => { try { s.stop() } catch {} })
      rptSourcesRef.current.clear()
      rptSourceRef.current = null
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {})
        audioContextRef.current = null
      }
    }
  }, [])

  // THE PICTURE FOLLOWS THE PLAYHEAD. One place, so every way of moving the
  // playhead lands the same way — needle drag, chunk buttons, skip-to-start,
  // clicking a segment — instead of each call site remembering to seek.
  //
  // Two faults this replaces. It compared video.currentTime against currentTime
  // directly, but those are different domains once a scene is retimed: the video
  // is in SOURCE time and the playhead in TIMELINE time, so the comparison could
  // read as "close enough" and skip a seek that was needed. And it bailed on
  // isPlaying, which also covers dragging the needle mid-playback — where the
  // user is the clock and the picture must follow.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    // While genuinely advancing, the video IS the clock and seeking it here
    // would fight playback. Dragging is the exception.
    if (isPlaying && !isDraggingNeedleRef.current) return
    const target = timelineToSourceTime(currentTime, scenesRef.current) ?? currentTime
    if (!Number.isFinite(target)) return
    const seek = () => {
      if (Math.abs(video.currentTime - target) > 0.05) video.currentTime = target
    }
    // A seek issued before metadata exists is silently dropped, which leaves the
    // picture frozen on the last frame it managed to decode.
    if (video.readyState === 0) {
      video.addEventListener('loadedmetadata', seek, { once: true })
      return () => video.removeEventListener('loadedmetadata', seek)
    }
    seek()
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
      // Chunk lens: playback stops at the window boundary — the user is
      // auditioning one window, not the whole film.
      if (chunkModeRef.current && videoRef.current.currentTime >= chunkEndRef.current - 0.05) {
        stopAllRptAudio()
        videoRef.current.pause()
        setIsPlaying(false)
        setCurrentTime(chunkEndRef.current)
        return
      }
      setCurrentTime(videoRef.current.currentTime)
      if (timelineRef.current) {
        const container = timelineRef.current
        const pps = 40 * zoomLevel
        const playheadPx = videoRef.current.currentTime * pps
        const visibleLeft = container.scrollLeft
        const visibleRight = container.scrollLeft + container.clientWidth
        // Keep the playhead in the middle third of the timeline viewport.
        // Direct scrollLeft avoids browsers where smooth scrollTo stalls.
        const margin = container.clientWidth * 0.3
        // Playing implies following: losing the playhead off-screen mid-pass is
        // never wanted. The toggle governs the PAUSED case — seeks and jumps while
        // editing, where a moving view is what made the work hard.
        if (
          (isPlayingRef.current || followPlayheadRef.current) &&
          (playheadPx < visibleLeft + margin || playheadPx > visibleRight - margin)
        ) {
          container.scrollLeft = Math.max(0, playheadPx - container.clientWidth * 0.5)
        }
      }
    }
  }, [setCurrentTime, zoomLevel])

  // requestAnimationFrame loop drives the playhead and timeline scroll directly
  // via DOM refs so the UI is smooth even when the browser throttles the native
  // timeupdate event. React state is only written every 200ms, which keeps the
  // component re-render count low while the needle, clock, and chunk fill stay fluid.
  const rafLastTimeRef = useRef(0)
  const rafLastStateUpdateRef = useRef(0)
  const rafLastScrollRef = useRef(0)
  const rafLastLogRef = useRef(0)
  /** When the audio was last dragged back onto the picture. Rate-limits the
   *  drift corrector: a reschedule is audible, so it must not chatter. */
  const rafLastResyncRef = useRef(0)
  useEffect(() => {
    let raf: number
    const loop = () => {
      const video = videoRef.current
      const container = timelineRef.current
      if (!video) {
        raf = requestAnimationFrame(loop)
        return
      }
      const now = performance.now()
      if (now - rafLastTimeRef.current < 50) {
        raf = requestAnimationFrame(loop)
        return
      }
      rafLastTimeRef.current = now

      // Don't override the state when paused or dragging; otherwise the playhead snaps
      // back to the video element's stale time and causes the chunk to flicker.
      const isAdvancing = (isPlayingRef.current || !video.paused) && !isDraggingNeedleRef.current
      if (!isAdvancing) {
        raf = requestAnimationFrame(loop)
        return
      }

      const sourceT = video.currentTime
      let t = sourceToTimelineTime(sourceT, scenesRef.current) ?? sourceT
      // Keep the black fade overlay in sync even when paused/scrubbed.
      if (videoFadeOverlayRef.current) {
        videoFadeOverlayRef.current.style.opacity = String(computeVideoFadeOpacity(t, scenesRef.current))
      }
      // If the video element is paused but RPT audio is supposed to be playing,
      // derive the playhead from the AudioContext clock so the timeline keeps moving.
      if (isPlayingRef.current && video.paused && audioStartTimeRef.current !== null) {
        const ctx = audioContextRef.current
        if (ctx) {
          t = lastStartPosRef.current + (ctx.currentTime - audioStartTimeRef.current)
        }
      }
      if (DEBUG_PLAYBACK && now - rafLastLogRef.current > 500) {
        rafLastLogRef.current = now
        console.log('[RAF]', { t, videoTime: video.currentTime, videoPaused: video.paused, isPlaying: isPlayingRef.current, isDragging: isDraggingNeedleRef.current, scrollLeft: container?.scrollLeft, clientWidth: container?.clientWidth, chunkStart: chunkStartRef.current, chunkEnd: chunkEndRef.current })
      }
      // KEEP THE AUDIO UNDER THE PICTURE.
      //
      // Two clocks run this: the needle follows the video element, the stitched
      // audio free-runs on the AudioContext once scheduled. Nothing reconciled
      // them, so they drifted apart and the sound played ahead of the blocks.
      //
      // The picture is the reference — it is what sync is judged against — so the
      // audio moves to it, never the reverse. Corrections are rate-limited: a
      // reschedule is audible, and one that chattered would be worse than the
      // drift it was fixing.
      if (
        isPlayingRef.current &&
        rptBufferRef.current &&
        audioContextRef.current &&
        audioStartTimeRef.current !== null &&
        useEditorStore.getState().playbackMode === 'preview' &&
        now - rafLastResyncRef.current > 1500
      ) {
        const actx = audioContextRef.current
        const audioPos = lastStartPosRef.current + (actx.currentTime - audioStartTimeRef.current)
        if (Math.abs(audioPos - t) > 0.15) {
          rafLastResyncRef.current = now
          rptSourcesRef.current.forEach(src => {
            try { src.onended = null } catch {}
            try { src.stop() } catch {}
            try { src.disconnect() } catch {}
          })
          rptSourcesRef.current.clear()
          rptSourceRef.current = null
          lastStartPosRef.current = t
          audioStartTimeRef.current = actx.currentTime
          if (rptGainRef.current) {
            registerRptSource(scheduleRPTPlayback(
              rptBufferRef.current,
              rptOffsetFor(t),
              actx,
              rptGainRef.current,
              rptPlaybackRateRef.current,
            ))
          }
        }
      }
      const pps = 40 * zoomLevel
      // Update the needle, time display, and active chunk fill directly in the DOM.
      if (playheadRef.current) playheadRef.current.style.left = `${t * pps}px`
      // Follow the playhead HERE, right beside the line that moves it.
      //
      // This used to live in the else of the chunk-boundary check below. The
      // needle kept moving while the view never followed, which is only possible
      // if that branch was swallowing it. Anything that reaches the needle now
      // reaches the scroll, so the two can no longer disagree.
      //
      // Throttled to 500ms: setting scrollLeft on a timeline with hundreds of
      // thumbnails forces a layout, and doing it every frame once made this
      // handler take ~5 seconds.
      if (
        container &&
        (isPlayingRef.current || followPlayheadRef.current) &&
        now - rafLastScrollRef.current > 500
      ) {
        const headPx = t * pps
        const viewLeft = container.scrollLeft
        const margin = container.clientWidth * 0.3
        if (headPx < viewLeft + margin || headPx > viewLeft + container.clientWidth - margin) {
          rafLastScrollRef.current = now
          container.scrollLeft = Math.max(0, headPx - container.clientWidth * 0.5)
        }
      }
      if (timeDisplayRef.current) timeDisplayRef.current.textContent = `${formatTime(t)} / ${formatTime(videoDuration)}`
      const activeFill = chunkBarRef.current?.querySelector('[data-active-chunk-fill]') as HTMLElement | null
      if (activeFill && chunkBoundariesRef.current.length > 1) {
        const b = chunkBoundariesRef.current
        let cur = 0
        for (let i = 0; i < b.length - 1; i++) {
          if (t >= b[i] && t < b[i + 1]) { cur = i; break }
        }
        const progress = Math.min(1, Math.max(0, (t - b[cur]) / (b[cur + 1] - b[cur])))
        activeFill.style.width = `${progress * 100}%`
      }
      currentTimeRef.current = t
      // Chunk lens: stop at the window boundary.
      if (chunkModeRef.current && t >= chunkEndRef.current - 0.05) {
        stopAllRptAudioRef.current()
        video.pause()
        setIsPlaying(false)
        // Land just inside the window that was playing, not on its boundary.
        // chunkEnd is the NEXT window's start, so stopping exactly there made
        // the derived auto-follow advance the window — and windowed rendering
        // then hid the five minutes the user had just watched. Stop here and
        // the segments stay on screen, ready to work on.
        setCurrentTime(chunkEndRef.current - 0.05)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [setCurrentTime, setIsPlaying, zoomLevel, videoDuration])
  
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

  /** Scene lock — pick a contiguous run and freeze it.
   *
   *  Deliberately a SEPARATE mode from group move, not a shared selection with
   *  two buttons on it. The gesture is the same (ctrl+click each end) but the
   *  intents are opposites: one moves a run, the other guarantees a run cannot
   *  move. Sharing state would mean every action had to ask which mode armed the
   *  selection, and one wrong answer relocates work the user locked to protect. */
  const [sceneLockMode, setSceneLockMode] = useState(false)
  const [sceneAnchor, setSceneAnchor] = useState<number | null>(null)
  const [sceneRange, setSceneRange] = useState<{ start: number; end: number } | null>(null)

  useEffect(() => {
    if (!sceneLockMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSceneLockMode(false); setSceneAnchor(null); setSceneRange(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sceneLockMode])

  const exitSceneLockMode = useCallback(() => {
    setSceneLockMode(false)
    setSceneAnchor(null)
    setSceneRange(null)
  }, [])

  const handleSceneRangeClick = useCallback((index: number) => {
    setSceneAnchor(prev => {
      if (prev === null) { setSceneRange({ start: index, end: index }); return index }
      setSceneRange({ start: Math.min(prev, index), end: Math.max(prev, index) })
      return prev
    })
  }, [])

  /** Lock every segment in the picked run. Goes through setSegmentLocked so each
   *  one persists individually — a scene half-written to disk is worse than none,
   *  and per-segment commits mean a failure loses one segment, not the scene. */
  const lockScene = useCallback((from: number, to: number) => {
    for (let i = from; i <= to; i++) setSegmentLockedRef.current?.(i, true)
    exitSceneLockMode()
  }, [exitSceneLockMode])

  /** Unlock the contiguous run of locked segments containing `index`. The scene IS
   *  the run, so there is no scene id to store, migrate, or keep in sync. */
  const unlockScene = useCallback((index: number) => {
    const segs = displaySegmentsRef.current
    const isLocked = (i: number) => !!segs[i] && lockedSegmentsRef.current.has(keyAt(i))
    if (!isLocked(index)) return
    let from = index, to = index
    while (from - 1 >= 0 && isLocked(from - 1)) from--
    while (to + 1 < segs.length && isLocked(to + 1)) to++
    for (let i = from; i <= to; i++) setSegmentLockedRef.current?.(i, false)
  }, [keyAt])

  const handleSegmentClick = useCallback((index: number, e?: React.MouseEvent) => {
    // In group-selection mode a Ctrl+click builds the range instead of selecting
    // /seeking; stopPropagation keeps the context-menu wrapper from also selecting.
    // Scene lock is checked FIRST: if both modes were somehow armed, freezing a
    // run is the safer of the two to perform by accident.
    if (sceneLockMode && e && (e.ctrlKey || e.metaKey)) {
      e.stopPropagation()
      handleSceneRangeClick(index)
      return
    }
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
  }, [selectSegment, groupSelectMode, handleGroupRangeClick, sceneLockMode, handleSceneRangeClick])
  
  // Handle preview panel resize
  const handlePreviewResizeStart = useCallback((e: React.MouseEvent) => {
    // Frozen by the layout lock — the panes hold their size.
    if (layoutLocked) return
    e.preventDefault()
    setIsResizingPreview(true)

    const startX = e.clientX
    const startWidth = previewWidth
    let finalWidth = previewWidth

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX
      const newWidth = Math.min(Math.max(startWidth + delta, 300), 1100)
      finalWidth = newWidth
      // Update the DOM directly during the drag so the whole editor doesn't
      // re-render on every mousemove — same fix that made the playhead smooth.
      if (previewPanelRef.current) {
        previewPanelRef.current.style.width = `${newWidth}px`
      }
    }

    const handleMouseUp = () => {
      setIsResizingPreview(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('pointercancel', handleMouseUp)
      window.removeEventListener('blur', handleMouseUp)
      setPreviewWidth(finalWidth)
      if (!layoutLocked) {
        localStorage.setItem('dubverse.editor.previewWidth', finalWidth.toString())
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('pointercancel', handleMouseUp)
    window.addEventListener('blur', handleMouseUp)
  }, [previewWidth, layoutLocked])
  
  // Handle timeline resize (vertical)
  const handleTimelineResizeStart = useCallback((e: React.MouseEvent) => {
    // Frozen by the layout lock — the panes hold their size.
    if (layoutLocked) return
    e.preventDefault()
    setIsResizingTimeline(true)
    
    const startY = e.clientY
    const startHeight = timelineHeight
    let finalHeight = timelineHeight
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY
      const newHeight = Math.min(Math.max(startHeight + delta, 150), 700)
      finalHeight = newHeight
      if (timelinePanelRef.current) {
        timelinePanelRef.current.style.height = `${newHeight}px`
      }
    }
    
    const handleMouseUp = () => {
      setIsResizingTimeline(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('pointercancel', handleMouseUp)
      window.removeEventListener('blur', handleMouseUp)
      setTimelineHeight(finalHeight)
      if (!layoutLocked) {
        localStorage.setItem('dubverse.editor.timelineHeight', finalHeight.toString())
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('pointercancel', handleMouseUp)
    window.addEventListener('blur', handleMouseUp)
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

  // Native wheel zoom on the timeline: non-passive listener so we can prevent
  // the default horizontal scroll, current zoom via ref so rapid notches stack,
  // and the mouse pointer is kept over the same time so the timeline expands
  // and contracts around the cursor rather than jumping left/right.
  useEffect(() => {
    const el = timelineRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // Shift+wheel = horizontal scroll; leave it alone.
      if (e.shiftKey) return
      e.preventDefault()
      const delta = e.deltaY || e.deltaX
      if (!delta) return
      const currentZoom = zoomLevelRef.current
      const factor = 1.3
      const newZoom = delta < 0
        ? Math.min(currentZoom * factor, 4)
        : Math.max(currentZoom / factor, 0.25)
      const rect = el.getBoundingClientRect()
      const pps = 40 * currentZoom
      const timeUnderMouse = (e.clientX - rect.left + el.scrollLeft) / pps
      zoomLevelRef.current = newZoom
      setZoomLevel(newZoom)
      // Apply the scroll correction after React re-renders the wider timeline.
      requestAnimationFrame(() => {
        const timeline = timelineRef.current
        if (!timeline) return
        const newScrollLeft = timeUnderMouse * 40 * newZoom - (e.clientX - rect.left)
        timeline.scrollLeft = Math.max(0, newScrollLeft)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Handle needle/playhead drag
  const handleNeedleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    isDraggingNeedleRef.current = true
    if (playheadRef.current) {
      playheadRef.current.style.transition = 'none'
    }

    const timelineElement = timelineRef.current
    if (!timelineElement) {
      isDraggingNeedleRef.current = false
      if (playheadRef.current) playheadRef.current.style.transition = ''
      return
    }

    const pps = 40 * zoomLevel

    const updateTimeFromMouse = (clientX: number) => {
      const rect = timelineElement.getBoundingClientRect()
      const scrollLeft = timelineElement.scrollLeft
      const x = clientX - rect.left + scrollLeft
      const newTime = Math.max(0, Math.min(x / pps, videoDuration))
      // Don't write React state on every mousemove — the 5-second render was
      // making the needle feel 3 seconds behind. DOM + video are updated here;
      // the store is written once on mouseup.
      currentTimeRef.current = newTime
      if (videoRef.current) {
        videoRef.current.currentTime = timelineToSourceTime(newTime, scenesRef.current) ?? newTime
      }
      // Update the needle directly so it tracks the cursor exactly.
      if (playheadRef.current) {
        playheadRef.current.style.left = `${newTime * pps}px`
      }

      // Auto-scroll when dragging near edges (gentle so it doesn't fight the needle).
      const relX = clientX - rect.left
      const scrollZone = 80
      const speed = 0.15
      if (relX < scrollZone) {
        timelineElement.scrollLeft -= (scrollZone - relX) * speed
      } else if (relX > rect.width - scrollZone) {
        timelineElement.scrollLeft += (relX - (rect.width - scrollZone)) * speed
      }
    }

    updateTimeFromMouse(e.clientX)

    const handleMouseMove = (moveEvent: MouseEvent) => {
      updateTimeFromMouse(moveEvent.clientX)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('pointercancel', handleMouseUp)
      window.removeEventListener('blur', handleMouseUp)
      isDraggingNeedleRef.current = false
      if (playheadRef.current) playheadRef.current.style.transition = ''
      setCurrentTime(currentTimeRef.current)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('pointercancel', handleMouseUp)
    window.addEventListener('blur', handleMouseUp)
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
          commitOrStageRef.current!(segment.transcript_index ?? index, {
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
  /** Undo history. A discriminated union rather than a second stack: "undo last
   *  edit" has to mean the last thing you actually did, and two parallel stacks
   *  would undo a text change you made five minutes ago in preference to the
   *  split you made a second ago. */
  type UndoEntry =
    | { kind: 'text'; index: number; prevText: string }
    // A scene boundary on the video strip. Reversed by dissolving the boundary.
    | { kind: 'scene-split'; sceneId: string }
    // A segment cut in two, at the playhead or at a word. Both splice one segment
    // into two at index/index+1, so both are reversed by merging index with next.
    // `at` exists only to name the action in the menu — undoing them is identical.
    | { kind: 'segment-split'; index: number; at: 'playhead' | 'word' }
  const undoStack = useRef<UndoEntry[]>([])
  // Hume auto-fire guard, lifted out of FloatingEmotionChart so Clear Segment
  // and text edits can reset it (re-fire emotion analysis on next dwell).
  const emotionAutoFiredRef = useRef<Set<number>>(new Set())

  const _applyUndo = useCallback((index: number, prevText: string) => {
    setPreviewText(index, prevText)
    updateSegment(index, { preview_text: prevText, active_text: prevText, isUserEdited: true })
    setImportedSegments(p => p ? p.map((seg, i) => i === index ? { ...seg, preview_text: prevText, active_text: prevText } : seg) : p)
  }, [setPreviewText, updateSegment])

  const _splitLabelOf = (e: UndoEntry): string | null =>
    e.kind === 'scene-split' ? 'Video Split'
      : e.kind === 'segment-split' ? (e.at === 'word' ? 'Word Split' : 'Segment Split')
      : null

  const _refreshUndoSplit = useCallback(() => {
    const stack = undoStack.current
    for (let i = stack.length - 1; i >= 0; i--) {
      const lbl = _splitLabelOf(stack[i])
      if (lbl) { setUndoSplitLabel(lbl); return }
    }
    setUndoSplitLabel(null)
  }, [])

  // Global undo — pops the most recent edit off the stack (any segment).
  const handleGlobalUndo = useCallback(() => {
    const entry = undoStack.current.pop()
    if (!entry) return
    if (entry.kind === 'scene-split') {
      // Dissolve the boundary rather than deleting the scene, or the timeline
      // is left with a hole where that footage was.
      mergeSceneWithPrevious(entry.sceneId)
      persistScenes()
        .catch(err => console.warn('[UNDO-SPLIT]', err))
      _refreshUndoSplit()
      return
    }
    if (entry.kind === 'segment-split') {
      // Rejoin the two halves. Same merge the context menu offers, so there is no
      // second un-split path that could drift from it.
      handleMergeWithNextRef.current?.(entry.index)
      _refreshUndoSplit()
      return
    }
    _applyUndo(entry.index, entry.prevText)
  }, [_applyUndo, mergeSceneWithPrevious, jobId, _refreshUndoSplit])

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
      // Segment-scoped: skip scene splits, which belong to no segment. They stay
      // on the stack and remain reachable through the global undo.
      const e = stackArr[i]
      if (e.kind === 'text' && e.index === index) {
        stackArr.splice(i, 1)
        _applyUndo(e.index, e.prevText)
        return
      }
    }
  }, [_applyUndo])

  /** Undo the most recent scene split, wherever it was made.
   *
   *  Separate from "Undo Last Edit", which is segment-scoped and deliberately
   *  skips scene splits — a split belongs to no segment, so that entry could
   *  never reach one. This walks the same single stack for the newest split and
   *  dissolves that boundary, merging the two halves back into one scene. */
  /** Names the split that Undo Split will reverse, or null when there is none.
   *  A label rather than a boolean: with three kinds of split in play, an entry
   *  reading just "Undo Split" gives no way to tell whether it is about to
   *  dissolve a scene boundary or rejoin two lines of dialogue. */
  const [undoSplitLabel, setUndoSplitLabel] = useState<string | null>(null)
  const handleUndoSplit = useCallback((index: number) => {
    // Segment context menu: undo the split at this segment by rejoining it with
    // the next one. If the split is still on the undo stack, remove it so the
    // global undo doesn't try to re-merge the same boundary again.
    const stack = undoStack.current
    for (let i = stack.length - 1; i >= 0; i--) {
      const e = stack[i]
      if (e.kind === 'segment-split' && e.index === index) {
        stack.splice(i, 1)
        _refreshUndoSplit()
        break
      }
    }
    handleMergeWithNextRef.current?.(index)
  }, [jobId, _refreshUndoSplit])

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
    setStagedVoices(prev => { const next = { ...prev }; delete next[keyAt(index)]; return next })
    setStagedEmotions(prev => { const next = { ...prev }; delete next[keyAt(index)]; return next })
    emotionAutoFiredRef.current.delete(index)
    updateSegment(index, clearedFields)
    setImportedSegments(prev => {
      if (!prev) return prev
      return prev.map((seg, i) => i === index ? { ...seg, ...clearedFields } : seg)
    })
    if (editingSegmentIndex === index) {
      setEditingText(''); editingTextRef.current = ''
      setEditingSegmentIndex(null)
    }
    setCustomEmotionDrafts(prev => { const n = { ...prev }; delete n[index]; return n })
    setStagedEmotions(prev => { const n = { ...prev }; delete n[keyAt(index)]; return n })
    setStagedSpeeds(prev => { const n = { ...prev }; delete n[keyAt(index)]; return n })
    setStagedVoices(prev => { const n = { ...prev }; delete n[keyAt(index)]; return n })
    setStagedPitches(prev => { const n = { ...prev }; delete n[keyAt(index)]; return n })
    setLockedSegments(prev => { const next = new Set(prev); next.delete(keyAt(index)); return next })
    setDroppedTranslations(prev => prev.filter(t => t.segmentIndex !== index))
    // reset_segment (routes.py) matches on transcript_index, NOT array position.
    // The two diverge permanently after any split (a split's right half gets a
    // fresh, unrelated transcript_index), so sending the raw index would clear a
    // DIFFERENT segment — or 404 into the swallowed .catch below and look like
    // it worked. Same pattern already used by the regenerate/commit call sites.
    apiClient.resetSegment(jobId, displaySegments[index]?.transcript_index ?? index)
      .catch(err => console.warn('[CLEAR]', err))
  }, [initialSegments, jobId, updateSegment, editingSegmentIndex, displaySegments, keyAt])

  // Handle Generate Speech - calls backend TTS regeneration for the selected segment
  const handleGenerateSpeech = useCallback(async (segIdx?: number, voiceOverride?: string, textOverride?: string, ttsTextOverride?: string, engineOverride?: string, extraPayload?: Partial<RegenerateSegmentRequest>): Promise<boolean> => {
    const activeIndex = segIdx ?? selectedSegmentIndex
    console.log('[REGEN] called', { segIdx, voiceOverride, textOverride, activeIndex, isRegenerating, selectedSegmentIndex })
    if (activeIndex === null) { console.warn('[REGEN] aborted — activeIndex null'); return false }
    if (isRegeneratingRef.current) {
      // Queue instead of dropping (depth 1, last-write-wins); drained in finally.
      regenQueueRef.current = { segIdx, voiceOverride, textOverride, ttsTextOverride, engineOverride, extraPayload }
      setQueuedSegmentIndex(activeIndex)
      console.warn('[REGEN] queued — regen already in flight', { segIdx, voiceOverride })
      return false
    }
    const segment = displaySegments[activeIndex]
    if (!segment) { console.warn('[REGEN] aborted — no segment at index', activeIndex); return false }

    // KEEP THE OLD TAKE UNTIL THE NEW ONE LANDS.
    //
    // This used to clear audio_url and committed_audio_url the moment the text
    // changed, so nothing could play the previous line. The cost was worse than
    // the problem: if regeneration is slow, fails, or never fires, the segment
    // is left pointing at nothing and is SILENT with no fallback — the exact
    // state that made nine segments mute and took a day to trace.
    //
    // A stale take playing at the block's current position for a couple of
    // seconds is a smaller fault than a hole in the film: it is wrong content,
    // briefly, rather than no content at all. The regenerated take replaces it
    // when it arrives.

    const incomingText = (activeIndex === selectedSegmentIndex && editingTextRef.current.trim())
      ? editingTextRef.current.trim()
      : (segment.preview_text ?? segment.active_text ?? segment.target_text)
    const committedText = segment.committed_adapted_text ?? segment.target_text
    const textChanged = incomingText !== committedText

    // Lock freezes POSITION, not the segment. A locked scene still plays, still
    // takes a new voice, emotion or speed, and still regenerates — what it will
    // not do is move. This used to refuse regeneration outright, which made lock
    // unusable for its actual purpose: pinning finished timing while continuing
    // to work on the performance. Movement is blocked where movement happens —
    // the drag handler and the merge guard — not here.

    selectSegment(activeIndex)
    setRegenError(null)
    isRegeneratingRef.current = true
    setIsRegenerating(true)
    setRegeneratingSegmentIndex(activeIndex)
    try {
      const emotionIntensity = sampleEmotionalCurve(activeIndex, 0.5)
      const finalVoiceKey = voiceOverride ?? stagedVoices[keyAt(activeIndex)] ?? speakerVoiceMap[segment.speaker_id]
      // Priority: explicit textOverride (passed by saveEditing — immune to stale
      // closures) > live editingText for the selected segment > committed adapted text
      // > stored preview/active text.
      const regenerateText = (textOverride && textOverride.trim())
        ? textOverride.trim()
        : (activeIndex === selectedSegmentIndex && editingTextRef.current.trim())
          ? editingTextRef.current.trim()
          : segment.committed_adapted_text
            ? segment.committed_adapted_text
            : (segment.preview_text ?? segment.active_text ?? segment.target_text)
      console.log('[REGEN] calling backend', { activeIndex, finalVoiceKey, regenerateText, textOverride, preview_text: segment.preview_text, active_text: segment.active_text, editing: editingTextRef.current.trim() })
      // Live timeline boundaries, straight from the on-screen segment — segments.json
      // on the backend can lag behind a split/resize whose commitSegmentTiming call
      // is fire-and-forget (see the interrupt handler above). Sending these lets the
      // fit-check use what the user is actually looking at instead of a stale copy.
      const liveStart = effStart(segment)
      const liveEnd = effEnd(segment)
      const nextSegment = displaySegments[activeIndex + 1]
      const liveNextStart = nextSegment ? effStart(nextSegment) : undefined
      // The backend grows a segment backwards as well as forwards, but only had a
      // live value for the forward boundary — so backward growth used its own copy
      // of the previous segment, which lags a fire-and-forget commit. That is how a
      // segment gets moved back into a neighbour that was already extended.
      // Scanned by time, not array position: order can diverge after splits/moves.
      const livePrevEnd = displaySegments.reduce<number | undefined>((acc, s, i) => {
        if (i === activeIndex) return acc
        const e = effEnd(s)
        if (e <= liveStart + 0.01 && (acc === undefined || e > acc)) return e
        return acc
      }, undefined)
      const regenPayload = {
        text: regenerateText,
        speed: stagedSpeeds[keyAt(activeIndex)] ?? 1.0,
        // '' = explicit clear (backend pops seg["emotion"]); undefined = unset → use committed
        emotion: stagedEmotions[keyAt(activeIndex)] ?? segment.committed_emotion,
        // attached_traits = frozen on first keystroke. undefined = no change; [] = clear; non-empty = set
        traits: segment.attached_traits ?? undefined,
        voice_key: voiceOverride ?? stagedVoices[keyAt(activeIndex)] ?? speakerVoiceMap[segment.speaker_id],
        pitch: stagedPitches[keyAt(activeIndex)] ?? speakerPitchMap[segment.speaker_id] ?? 0,
        emotionIntensity,
        nuances: stagedNuances[keyAt(activeIndex)] ?? segment.nuances,
        nuance_markers: segment.nuance_markers,
        custom_nuance: segment.custom_nuance,
        // Delivery Script: verbatim line + tags, applied only when generated from the
        // write-in (explicit override). A normal regen sends nothing → clean/pill mode,
        // so there's no sticky-forever state to get trapped in.
        tts_text: ttsTextOverride,
        // Omitted on a normal regen, so the backend keeps whatever engine this
        // segment last rendered with — no sticky state to get trapped in.
        engine: engineOverride,
        live_segment_start: liveStart,
        live_segment_end: liveEnd,
        live_next_segment_start: liveNextStart,
        live_prev_segment_end: livePrevEnd,
        // Engine-specific extras (Respeecher sampling_params / seed). Last so an
        // explicit caller value wins over the defaults assembled above.
        ...(extraPayload ?? {}),
        // Audition mode. In chunk mode the take is written as a *_staged file
        // and segments.json is left alone, so trying a voice, speed or emotion
        // costs nothing until the user presses Save.
        stage: chunkModeRef.current,
      }
      console.log('[REGEN] payload', { activeIndex, regenPayload })
      const response = await apiClient.regenerateSegment(jobId, segment.transcript_index ?? activeIndex, regenPayload)
      console.log('[REGEN] backend response', { path: response.segment.path, voice_id: response.segment.voice_id, status: response.status })
      // The backend still reports timing_exclusion, but it is no longer allowed to
      // block the render or raise a dialog. Judging it needs the CURRENT timeline,
      // and the backend reads segments.json — which lags the editor, because the
      // ripple that makes room after an Expand is committed fire-and-forget. Three
      // attempts to reconcile the two produced three different wrong answers, each
      // refusing a generate the user had already made room for.
      //
      // The overlap badge on the row does the same job from the frontend, where the
      // timeline is authoritative and no staleness is possible. It informs rather
      // than blocks, which is the right trade for something that was wrong this
      // often. Logged so the backend's view is still visible when debugging.
      if (response.segment.timing_exclusion) {
        console.warn('[TIMING] backend reported an exclusion (not blocking)', {
          activeIndex,
          audioDuration: response.segment.timing_audio_duration,
          slotDuration: response.segment.timing_slot_duration,
          overlap: response.segment.timing_overlap,
        })
      }
      const filename = response.segment.path.split('/').pop() ?? ''
      const audio_url = filename
        ? apiClient.getAudioFileUrl(jobId, filename, true)
        : segment.audio_url
      // Record where the audition landed. Save reads stagedPath to promote the
      // take (the backend then sets both path and committed_audio_url); without
      // this the file would sit on disk and Save would promote nothing.
      if (chunkModeRef.current) {
        stageEdit(segment.transcript_index ?? activeIndex, {
          stagedPath: response.segment.path,
          stagedAudioUrl: audio_url,
        })
      }
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
        commitOrStageRef.current!(segment.transcript_index ?? activeIndex, {
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
        commitOrStageRef.current!(segment.transcript_index ?? activeIndex, {
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
              committed_emotion: stagedEmotions[keyAt(activeIndex)] ?? seg.committed_emotion,
              ...(shouldShrink ? { end_time: shrunkEnd } : {}),
              // Read the engine + take metadata off the RESPONSE, never off the
              // request: the backend re-routes to Fish on a child voice, a missing
              // API key, or a voice outside Respeecher's catalogue, so what was
              // asked for is not necessarily what rendered.
              // Assigned unconditionally, including when absent, so that a render
              // which drops the take list actually clears it — spreading ...seg
              // alone left the panel auditioning takes the backend had discarded
              // and showing an engine chip for the previous engine.
              engine: response.segment.engine ?? undefined,
              respeecher_takes: response.segment.respeecher_takes ?? undefined,
              respeecher_take_seeds: response.segment.respeecher_take_seeds ?? undefined,
              respeecher_fits: response.segment.respeecher_fits ?? undefined,
              respeecher_duration: response.segment.respeecher_duration ?? undefined,
              respeecher_seed: response.segment.respeecher_seed ?? null,
              respeecher_sampling_params: response.segment.respeecher_sampling_params ?? null,
              // Not cleared when absent, unlike the fields above: history is
              // cumulative and a Fish render simply has nothing to add to it.
              respeecher_seed_history:
                response.segment.respeecher_seed_history ?? seg.respeecher_seed_history,
            }
          : seg)
      })
      setPlaybackMode('preview')
      const _committedVoice = response.segment.voice_id ?? voiceOverride ?? stagedVoices[keyAt(activeIndex)] ?? speakerVoiceMap[segment.speaker_id]
      const _committedSpeed = stagedSpeeds[keyAt(activeIndex)] ?? 1.0
      commitSegmentChanges(activeIndex, {
        committed_audio_url: audio_url,
        committed_voice_id: _committedVoice,
        committed_speed: _committedSpeed,
        committed_emotion: stagedEmotions[keyAt(activeIndex)],
      })
      // ...and to disk. commitSegmentChanges only touches the store, so the
      // casting choice died on refresh: committed_voice_id was written on 0 of
      // 817 segments even though the backend has always accepted it. Voice and
      // speed are not text or timing, so commitOrStage sends them straight
      // through even in chunk mode — the choice should not wait for Save.
      if (_committedVoice) {
        commitOrStageRef.current!(segment.transcript_index ?? activeIndex, {
          committed_voice_id: _committedVoice,
          committed_speed: _committedSpeed,
        }).catch(err => console.warn('[REGEN] voice persist failed', err))
      }
      applyFlagOutcome(activeIndex, 'voice')
      requestStitchWith(
        displaySegments.map((seg, segArrayIdx) => {
          // For the segment just generated, use the new audio_url directly
          // so the stitch reflects the edit without waiting for store update.
          // Compare by array position — activeIndex indexes into this same
          // displaySegments array, so seg.index (which may diverge after
          // splits/reorders) is unreliable here.
          const isActiveSegment = segArrayIdx === activeIndex
          return {
            ...seg,
            audio_url: isActiveSegment ? audio_url : apiClient.refreshAudioUrl(jobId, seg.audio_url),
            committed_audio_url: isActiveSegment
              ? audio_url
              : apiClient.refreshAudioUrl(jobId, seg.committed_audio_url),
            start_time: seg.start_time,
            end_time: seg.end_time,
          }
        }),
        (() => {
          if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext()
          }
          return audioContextRef.current
        })(),
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
          handleGenerateSpeechRef.current(queued.segIdx, queued.voiceOverride, queued.textOverride, queued.ttsTextOverride, queued.engineOverride, queued.extraPayload)
        }, 0)
      }
    }
  }, [selectedSegmentIndex, isRegenerating, displaySegments, jobId, droppedTranslations, updateSegment, stagedSpeeds, lockedSegments, selectSegment, setImportedSegments, setPlaybackMode, keyAt])

  const handleGenerateSpeechRef = useRef(handleGenerateSpeech)
  handleGenerateSpeechRef.current = handleGenerateSpeech
  const displaySegmentsRef = useRef(displaySegments)
  // KEEP IT CURRENT. This was declared and never assigned, so it held the FIRST
  // render's segments for the life of the editor — the timings the job was loaded
  // with. Everything reading it (the preview stitch, the bulk voice apply) was
  // working from the original arrangement while the timeline showed the edited
  // one, which is why moving a block never moved its audio.
  displaySegmentsRef.current = displaySegments

  // ── Chunk lens (long-video editing) ──────────────────────────────────────
  // Active for videos longer than two chunks (>10 min). One ~5-minute window is
  // edited at a time; boundaries snap to the nearest segment end within 3s so
  // playback never stops mid-sentence. Short videos keep today's behavior
  // (chunkMode false → every call site below falls through unchanged).
  const chunkMode = videoDuration > CHUNK_SECONDS * 2
  const chunkBoundaries = useMemo(() => {
    if (!chunkMode || videoDuration <= 0) return [0, videoDuration]
    const segments = displaySegments
      .map((seg) => ({ start: effStart(seg), end: effEnd(seg) }))
      .sort((a, b) => a.start - b.start)
    const idealCount = Math.max(1, Math.ceil(videoDuration / CHUNK_SECONDS))
    const boundaries = [0]
    const SNAP_TOLERANCE = 5
    for (let i = 1; i < idealCount; i++) {
      const ideal = i * CHUNK_SECONDS
      // If a segment spans the ideal boundary, end the chunk at its end so the
      // boundary never lands in the middle of a sentence.
      const spanning = segments.find((s) => s.start <= ideal && ideal < s.end)
      if (spanning) {
        boundaries.push(Math.max(boundaries[boundaries.length - 1], Math.min(videoDuration, spanning.end)))
        continue
      }
      // Otherwise snap to the nearest segment end within 5s.
      let nearest = ideal
      let bestDist = Infinity
      for (const seg of segments) {
        const dist = Math.abs(seg.end - ideal)
        if (dist <= SNAP_TOLERANCE && dist < bestDist) {
          bestDist = dist
          nearest = seg.end
        }
      }
      boundaries.push(Math.max(boundaries[boundaries.length - 1], Math.min(videoDuration, nearest)))
    }
    boundaries.push(videoDuration)
    return boundaries
  }, [chunkMode, videoDuration, displaySegments])
  const chunkCount = chunkBoundaries.length - 1
  const activeChunk = chunkMode ? (activeChunkIndex ?? 0) : null
  const chunkStart = activeChunk !== null ? chunkBoundaries[activeChunk] : 0
  const chunkEnd = activeChunk !== null ? chunkBoundaries[activeChunk + 1] : videoDuration
  const findChunkForTime = useCallback((t: number) => {
    for (let i = 0; i < chunkBoundaries.length - 1; i++) {
      if (t >= chunkBoundaries[i] && t < chunkBoundaries[i + 1]) return i
    }
    return Math.max(0, chunkBoundaries.length - 2)
  }, [chunkBoundaries])
  // Refs for effects/handlers that must not capture stale window bounds.
  const chunkModeRef = useRef(chunkMode)
  const chunkStartRef = useRef(chunkStart)
  const chunkEndRef = useRef(chunkEnd)
  chunkModeRef.current = chunkMode
  chunkStartRef.current = chunkStart
  chunkEndRef.current = chunkEnd
  chunkBoundariesRef.current = chunkBoundaries
  const stagedEditCount = Object.keys(stagedEdits).length

  // Staged edits are keyed by transcript_index, which is meaningless across
  // jobs: index 42 is a different line in a different film. Persisting them
  // through a reload is what makes this reachable, so discard any that belong
  // to another job before they can be promoted onto this one's segments.
  useEffect(() => {
    if (!jobId) return
    const owner = useEditorStore.getState().stagedEditsJobId
    if (owner && owner !== jobId) {
      console.warn(`[staged] discarding staged edits from job ${owner} — now on ${jobId}`)
      clearStagedEdits()
    }
    useEditorStore.setState({ stagedEditsJobId: jobId })
  }, [jobId, clearStagedEdits])

  // Suppress the OS/browser right-click menu while the editor is mounted.
  //
  // Right-click is a working gesture here — segment actions, the gender filter,
  // removing a speaker from a voice, deleting a curve point — and the native menu
  // appearing over the app's own menu (or instead of it, on any surface without a
  // handler) reads as the app misbehaving.
  //
  // Text entry is exempt: Paste/Undo/spellcheck live in that menu and there is no
  // in-app replacement for them. Scoped to this component's lifetime, so the rest
  // of the site keeps normal browser behaviour.
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
    }
    document.addEventListener('contextmenu', onCtx)
    return () => document.removeEventListener('contextmenu', onCtx)
  }, [])

  // Repaint staged edits after a reload.
  //
  // stagedEdits survives a refresh (it is in the store's persist partialize —
  // it is the only editor state that exists nowhere else). importedSegments does
  // NOT: it is refetched from segments.json. Nothing else reads stagedEdits.text
  // back into a row, so after a refresh the user saw the OLD text and the old
  // audio while the counter still said "N staged" — the work was intact but
  // invisible, which reads as "my edit reverted every time I refresh".
  //
  // Painted as preview_text/isPreviewing, the editor's existing representation
  // for an uncommitted edit, so it keeps the orange styling and Commit/Clear.
  // It must NOT look saved: it is still staged until Save promotes it.
  const stagedRepaintedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!jobId || stagedRepaintedRef.current === jobId) return
    const staged = useEditorStore.getState().stagedEdits
    if (Object.keys(staged).length === 0) return
    const base = displaySegmentsRef.current
    if (!base || base.length === 0) return
    stagedRepaintedRef.current = jobId
    let painted = 0
    setImportedSegments(prev => {
      const src = prev ?? base
      return src.map(seg => {
        const e = staged[seg.transcript_index ?? -1]
        if (!e) return seg
        painted++
        return {
          ...seg,
          ...(e.text ? { preview_text: e.text, isPreviewing: true } : {}),
          ...(e.stagedAudioUrl ? { audio_url: e.stagedAudioUrl } : {}),
          ...(e.start_time != null ? { committed_start_time: e.start_time } : {}),
          ...(e.end_time != null ? { committed_end_time: e.end_time } : {}),
        }
      })
    })
    if (painted > 0) console.log(`[staged] repainted ${painted} staged edit(s) after reload`)
  }, [jobId, displaySegments.length, setImportedSegments])

  // A commit that fails is lost work, and almost every call site is
  // fire-and-forget. api-client announces failures globally; catching them here
  // routes them into the same failedSegments banner and MAKE MOVIE gate that
  // already exist, so a silent loss becomes a visible one.
  const failedSegmentsRef = useRef(failedSegments)
  failedSegmentsRef.current = failedSegments
  useEffect(() => {
    const onCommitFailed = (e: Event) => {
      const { index, error } = (e as CustomEvent).detail ?? {}
      if (typeof index !== 'number') return
      setFailedSegments({
        ...failedSegmentsRef.current,
        [index]: error || 'Edit failed to save',
      })
    }
    window.addEventListener('segment-commit-failed', onCommitFailed)
    return () => window.removeEventListener('segment-commit-failed', onCommitFailed)
  }, [setFailedSegments])

  // Edits commit as they are made, so "reviewed" — not "saved" — is what gates
  // the render: Save marks a window as one the user has been through. Short
  // films have no windows, so there is nothing to gate on.
  const savedWindowCount = Object.values(chunkStatusMap).filter(s => s === 'saved').length
  const allWindowsReviewed = !chunkMode || savedWindowCount >= chunkCount

  // Seed the persisted per-chunk status (from segments.json) once per job.
  useEffect(() => {
    if (initialChunkStatus) setChunkStatusMap(initialChunkStatus as Record<string, 'saved' | 'dirty'>)
    if (initialRetention) setRetention(initialRetention)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  // Refs so the stitch wrappers never capture stale stagedEdits/videoDuration.
  const stagedEditsRef = useRef(stagedEdits)
  const videoDurationRef = useRef(videoDuration)
  stagedEditsRef.current = stagedEdits
  videoDurationRef.current = videoDuration

  // THE stitch entry point. Every RPT stitch in this component goes through
  // here — chunk mode stitches only the active window (local timebase, ~53 MB
  // buffer) instead of the whole film (~2.5 GB at 2 hours), and staged takes
  // are overlaid so Preview always plays what the user is actually working on.
  // Callers pass their own segment array when they need a just-edited value
  // inlined ahead of the store update; the overlay still applies on top.
  const stitchWith = useCallback((segs: Segment[], ctx: AudioContext) => {
    // Resolve tokens HERE, after the staged overlay. A staged take's URL is minted
    // when the take is rendered and then persisted in stagedEdits, so once Supabase
    // rotates the JWT that stored URL 401s — the audio is on disk and unplayable.
    // Committed URLs were already refreshed by some callers; doing it centrally
    // covers the staged ones too, which no caller could reach.
    const overlaid = overlayStagedEdits(segs, stagedEditsRef.current).map(seg => ({
      ...seg,
      audio_url: apiClient.refreshAudioUrl(jobId, seg.audio_url),
      committed_audio_url: apiClient.refreshAudioUrl(jobId, seg.committed_audio_url),
    }))
    if (chunkModeRef.current) {
      return stitchRPTWindow(overlaid, chunkStartRef.current, chunkEndRef.current, ctx)
    }
    return stitchRPT(overlaid, videoDurationRef.current, ctx)
    // jobId is needed to rebuild media URLs above. It is stable for the life of the
    // editor, but leaving it out of the deps would be a stale closure waiting to
    // happen if the editor ever switches job in place.
  }, [jobId])

  // Debounced variant for edit-driven re-stitches (mirrors requestRPTStitch).
  const editorStitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestStitchWith = useCallback((segs: Segment[], ctx: AudioContext) => {
    if (editorStitchTimerRef.current) clearTimeout(editorStitchTimerRef.current)
    editorStitchTimerRef.current = setTimeout(async () => {
      const result = await stitchWith(segs, ctx)
      if (result) rptBufferRef.current = result.buffer
      editorStitchTimerRef.current = null
    }, 500)
  }, [stitchWith])

  // Schedule offset for the RPT buffer: windowed buffers are local-timebase,
  // so an absolute playhead of 5:00 into window 2's buffer is offset 0 — not
  // 300s past the end of a 300s buffer (which played silence).
  const rptOffsetFor = useCallback((absTime: number) => {
    return chunkModeRef.current ? Math.max(0, absTime - chunkStartRef.current) : absTime
  }, [])

  // Route a server commit through the chunk-lens staging gate. In chunk mode,
  // audio-affecting fields (text/timing) are recorded in stagedEdits and NOT
  // sent; pure-metadata fields (locks, pairs, flag review) still commit
  // immediately. Outside chunk mode this is a transparent passthrough.
  const commitOrStage = useCallback((
    ti: number,
    data: {
      committed_start_time?: number
      committed_end_time?: number
      committed_adapted_text?: string
      [key: string]: unknown
    },
  ) => {
    if (!chunkModeRef.current) {
      return apiClient.commitSegmentTiming(jobId, ti, data)
    }
    const staged: { text?: string; start_time?: number; end_time?: number } = {}
    if (typeof data.committed_adapted_text === 'string') staged.text = data.committed_adapted_text
    if (typeof data.committed_start_time === 'number') staged.start_time = data.committed_start_time
    if (typeof data.committed_end_time === 'number') staged.end_time = data.committed_end_time
    if (Object.keys(staged).length > 0) stageEdit(ti, staged)
    const rest = Object.fromEntries(
      Object.entries(data).filter(([k]) =>
        !['committed_start_time', 'committed_end_time', 'committed_adapted_text'].includes(k))
    )
    if (Object.keys(rest).length > 0) {
      return apiClient.commitSegmentTiming(jobId, ti, rest)
    }
    return Promise.resolve()
  }, [jobId, stageEdit])
  commitOrStageRef.current = commitOrStage
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
    if (indices.length === 0) {
      // Silence here read as "the button is broken": assigning to a speaker with
      // no segments in the current window did nothing and said nothing.
      setRegenError(
        chunkModeRef.current
          ? 'That speaker has no segments in this window — move to a window where they speak, or assign from the full timeline.'
          : 'That speaker has no segments to apply the voice to.'
      )
      return
    }
    setRegenError(null)
    setSpeakerRegenQueue(new Set(indices))
    try {
      // Confine the change to the window under review. Assigning a voice while
      // working on one 5-minute block should not rewrite that speaker across
      // the rest of the film.
      const res = await apiClient.applyVoiceToSpeaker(
        jobId, speakerId, voiceId,
        chunkModeRef.current
          ? { start: chunkStartRef.current, end: chunkEndRef.current }
          : undefined,
      )
      const byTi = new Map(res.regenerated.map(r => [r.transcript_index, r]))
      setImportedSegments(prev => {
        const base = prev ?? displaySegmentsRef.current
        return base.map(seg => {
          const r = seg.transcript_index != null ? byTi.get(seg.transcript_index) : undefined
          if (!r) return seg
          const filename = (r.path || '').split('/').pop()
          const url = filename ? apiClient.getAudioFileUrl(jobId, filename, true) : seg.committed_audio_url
          return { ...seg, committed_voice_id: r.voice_id, committed_audio_url: url, audio_url: url, status: 'edited' as const, rpt_dirty: false }
        })
      })
      clearCache()
      // Rebuild the preview audio so playback reflects the new voices. Without this
      // the files regenerate but you keep hearing the old stitch — the "assignment
      // does nothing" symptom (the single-segment path already re-stitches).
      if (audioContextRef.current == null) {
        audioContextRef.current = new AudioContext()
      }
      const stitchSegs = displaySegmentsRef.current.map(seg => {
        const r = seg.transcript_index != null ? byTi.get(seg.transcript_index) : undefined
        if (r) {
          const fn = (r.path || '').split('/').pop()
          const url = fn ? apiClient.getAudioFileUrl(jobId, fn, true) : apiClient.refreshAudioUrl(jobId, seg.committed_audio_url)
          return { ...seg, audio_url: url, committed_audio_url: url }
        }
        return { ...seg, audio_url: apiClient.refreshAudioUrl(jobId, seg.audio_url), committed_audio_url: apiClient.refreshAudioUrl(jobId, seg.committed_audio_url) }
      })
      requestStitchWith(stitchSegs, audioContextRef.current)
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
  applyVoiceToSpeakerRef.current = applyVoiceToSpeaker

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
      next.delete(keyAt(selectedSegmentIndex))
      return next
    })
    setDroppedTranslations(prev => prev.filter(t => t.segmentIndex !== selectedSegmentIndex))
    setStagedSpeeds(prev => { const next = { ...prev }; delete next[keyAt(selectedSegmentIndex)]; return next })
    setStagedEmotions(prev => { const next = { ...prev }; delete next[keyAt(selectedSegmentIndex)]; return next })
  }, [selectedSegmentIndex, initialSegments, jobId, updateSegment, setImportedSegments, keyAt])

  // Commit every staged edit, one at a time, reporting progress as it goes.
  //
  // Deliberately sequential and commit-what-you-can: a batch Promise.all would
  // give no "N of M" and no way to say WHICH segment failed. Segments that
  // commit are durable immediately; segments that fail keep their staged work
  // and are recorded in failedSegments so they can be surfaced before MAKE
  // MOVIE and reloaded for re-editing.
  const handleSaveStaged = useCallback(async (): Promise<{ succeeded: number[]; failed: Record<number, string> }> => {
    const entries = Object.entries(stagedEdits)
    if (!entries.length || !jobId) return { succeeded: [], failed: {} }

    const succeeded: number[] = []
    const failed: Record<number, string> = {}
    setSaveProgress({ done: 0, total: entries.length })

    for (let i = 0; i < entries.length; i++) {
      const ti = Number(entries[i][0])
      const edit = entries[i][1] as StagedEdit
      try {
        await apiClient.commitSegmentTiming(jobId, ti, {
          // Promotes the audition take to committed audio; the backend sets
          // both path and committed_audio_url so the rebuild merges it.
          ...(edit.stagedPath ? { staged_path: edit.stagedPath } : {}),
          ...(edit.text !== undefined ? { committed_adapted_text: edit.text, text: edit.text } : {}),
          ...(edit.start_time !== undefined ? { committed_start_time: edit.start_time } : {}),
          ...(edit.end_time !== undefined ? { committed_end_time: edit.end_time } : {}),
        })
        succeeded.push(ti)
      } catch (err: any) {
        failed[ti] = err?.message || 'Commit failed'
        console.error(`[chunk-save] segment ${ti} failed:`, err)
      }
      setSaveProgress({ done: i + 1, total: entries.length })
    }

    clearStagedEditsFor(succeeded)
    // Drop segments that have now committed. Merging failures alone meant one
    // transient error marked a segment failed forever — the red banner stayed
    // up and MAKE MOVIE stayed blocked even after a successful retry.
    const nextFailed = { ...failedSegments }
    succeeded.forEach(ti => { delete nextFailed[ti] })
    setFailedSegments({ ...nextFailed, ...failed })
    setSaveProgress(null)
    return { succeeded, failed }
  }, [stagedEdits, jobId, failedSegments, clearStagedEditsFor, setFailedSegments, setSaveProgress])

  /** Resolve the switch-chunk guard. Defined here because it calls
   *  handleSaveStaged above. */
  const resolveChunkSwitch = useCallback(async (action: 'save' | 'discard' | 'stay') => {
    const target = pendingChunkSwitch
    if (action === 'stay' || target === null) {
      setPendingChunkSwitch(null)
      return
    }
    setChunkSwitchBusy(action)
    try {
      if (action === 'save') {
        const { failed } = await handleSaveStaged()
        // A failed commit must not be swept away by the navigation: stay put so
        // the user sees which segment did not land.
        if (Object.keys(failed).length > 0) {
          setPendingChunkSwitch(null)
          return
        }
      } else {
        // Discard removes the staged FILES too, not just the browser state —
        // otherwise "discard" would leave the takes on disk forever.
        const indices = Object.keys(stagedEdits).map(Number)
        if (jobId && indices.length) {
          try {
            await apiClient.discardStagedTakes(jobId, indices)
          } catch (err) {
            console.error('[chunk-switch] staged cleanup failed:', err)
          }
        }
        clearStagedEdits()
      }
      goToChunk(target)
    } finally {
      setChunkSwitchBusy(null)
      setPendingChunkSwitch(null)
    }
  }, [pendingChunkSwitch, stagedEdits, jobId, handleSaveStaged, clearStagedEdits, goToChunk])

  const handleSave = useCallback(async () => {
    if (isSaving) return
    const toSave = displaySegments
    if (!toSave.length) return
    setIsSaving(true)
    // Staged takes first: they are the user's auditioned work.
    // Whatever it promotes is then EXCLUDED from the bulk pass below. The bulk
    // PATCH sends the client's committed_audio_url, which for a staged segment
    // still points at the pre-audition take — sending it would overwrite the
    // take that was just promoted and silently discard the audition.
    const { succeeded: promotedIndices } = await handleSaveStaged()
    const promoted = new Set(promotedIndices)
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    // Resolved once, not per segment — a Save can fan out to dozens of PATCHes.
    const authHeaders = await apiClient.ensureAuthHeaders()
    try {
      await Promise.all(
        toSave.map((seg, i) => {
          // Chunk mode saves the window you are working in, not the whole film.
          // Un-scoped this fired one PATCH per segment — 839 on a feature — which
          // looked like a hang and wrote back values that had not changed.
          // Bail inside .map() rather than filtering: `i` feeds keyAt(i) for lock
          // state, so a filtered index would write the wrong segment's locks.
          // Same straddle-aware test as inActiveWindow, inlined because that
          // callback is declared further down the component than this one.
          const _segStart = seg.committed_start_time ?? seg.start_time ?? 0
          const _segEnd = seg.committed_end_time ?? seg.end_time ?? _segStart
          if (chunkMode && !(_segStart < chunkEnd && _segEnd > chunkStart)) return null
          // Just promoted from a staged take — the server already holds the
          // authoritative state for it.
          if (promoted.has(seg.transcript_index ?? seg.index)) return null
          return (
          // Address by transcript_index (the stable id the commit endpoint matches
          // on) — seg.index is array position and drifts after splits/inserts.
          // `locked` is written for every segment so Save is the authoritative
          // checkpoint for lock state, not just the fire-and-forget per-lock write.
          fetch(`${base}/api/segment/commit/${jobId}/${seg.transcript_index ?? seg.index}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({
              committed_audio_url: seg.committed_audio_url,
              committed_adapted_text: seg.committed_adapted_text,
              committed_start_time: seg.committed_start_time,
              committed_end_time: seg.committed_end_time,
              flag_status: seg.flag_status,
              correction_type: seg.correction_type,
              locked: lockedSegments.has(keyAt(i)),
              paired_with_next: lockedPairs.has(keyAt(i)),
              // Persist the display text too so a plain edit doesn't revert on
              // reopen — the loader reads `text` back into target/active text.
              text: seg.active_text ?? seg.target_text,
            }),
          })
          )
        })
      )
      // Mark the window saved so its chip turns green and survives a reload.
      // The bulk Save wrote committed_* for every segment but never recorded
      // chunk_status, so nothing in the chunk bar ever went green.
      if (chunkMode && activeChunk !== null && jobId) {
        try {
          await apiClient.setChunkStatus(jobId, activeChunk, 'saved')
          // Reflect it locally too. chunkStatusMap is only filled at page load,
          // so without this the chip stays amber until the user reloads — the
          // save worked but looked like it hadn't.
          setChunkStatusMap({ ...chunkStatusMap, [String(activeChunk)]: 'saved' })
        } catch (err) {
          console.error('[save] chunk-status write failed:', err)
        }
      }
      // Save project metadata so it appears in My Projects
      await apiClient.saveProject(jobId, {
        title,
        target_language: targetLanguage,
      })
    } finally {
      setIsSaving(false)
    }
  }, [isSaving, displaySegments, jobId, title, targetLanguage, lockedSegments, lockedPairs, keyAt,
      chunkMode, chunkStart, chunkEnd, activeChunk, chunkStatusMap, setChunkStatusMap])

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

  // MAKE MOVIE is never blocked by judgement calls — only by the two states
  // where a click is meaningless (a render already running, a save mid-flight).
  // Everything else becomes a warning on click. A disabled button tells the user
  // "no" without telling them why or what to do about it, and the reason lived
  // in a tooltip, which is undiscoverable. See renderWarnings below.
  const [confirmRender, setConfirmRender] = useState<null | {
    staged: number; unreviewed: number; failed: string[]
    /** Sections still lifted to the layover track. They are excluded from the
     *  render entirely, so anything left up there is footage cut from the film. */
    parked: number; parkedSeconds: number
  }>(null)

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
          // A locked segment keeps its committed line, its rendered audio, and its
          // timing — retranslation has nothing to say about any of them.
          const locked = origSeg?.text_locked === true
          const keep = locked
            ? (origSeg?.committed_adapted_text ?? origSeg?.target_text ?? englishText)
            : englishText
          return {
            ...(origSeg ?? {} as Segment),
            id: raw.auto_split ? newSegmentId() : (origSeg?.id ?? newSegmentId()),
            index: i,
            transcript_index: i,
            status: 'edited',
            start_time: raw.start ?? origSeg?.start_time ?? 0,
            end_time: raw.end ?? origSeg?.end_time ?? 0,
            source_text: raw.source_text || origSeg?.source_text || '',
            target_text: keep,
            active_text: keep,
            variant_text: keep,
            preview_text: null,
            isPreviewing: false,
            isUserEdited: locked,
            committed_adapted_text: locked ? keep : englishText,
            text_locked: locked,
            // Text changed — any previously committed audio/timing no longer
            // matches it and must be regenerated, not silently carried over.
            // A locked segment's text did NOT change, so its clip is still valid.
            committed_audio_url: locked ? origSeg?.committed_audio_url : undefined,
            committed_start_time: locked ? origSeg?.committed_start_time : undefined,
            committed_end_time:   locked ? origSeg?.committed_end_time   : undefined,
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
    setEditingText(currentText); editingTextRef.current = currentText
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
      const text = editingTextRef.current
      // Push pre-edit text onto the global undo stack before applying the change.
      undoStack.current.push({ kind: 'text', index: idx, prevText: displaySegments[idx]?.preview_text ?? displaySegments[idx]?.active_text ?? displaySegments[idx]?.target_text ?? '' })
      emotionAutoFiredRef.current.delete(idx)
      setPreviewText(idx, text)
      setImportedSegments(prev => {
        const base = prev ?? displaySegments
        return base.map((seg, i) =>
          i === idx
            ? { ...seg, preview_text: text, committed_adapted_text: text, text_locked: true }
            : seg
        )
      })
      // Clear editing state so regenerate uses preview_text, not editingText
      setEditingText(''); editingTextRef.current = ''
      setEditingSegmentIndex(null)
      // Persist edited text to disk so regenerate_segment reads it from committed_adapted_text
      applyFlagOutcome(idx, 'text')
      commitOrStage(displaySegments[idx]?.transcript_index ?? idx, { committed_adapted_text: text, text_locked: true }).catch(err =>
        console.warn('[saveEditing] failed to persist text to disk:', err)
      )
      // Auto-regen in PREVIEW only — 2 second debounce.
      //
      // Preview is the editing mode: the blocks are the only audio source there,
      // so re-voicing a rewritten line is what you want. Dubbed and Original are
      // review modes — firing synthesis while someone is watching a render costs
      // money on every one of 818 segments and can fire mid-keystroke.
      if (playbackMode === 'preview') {
        if (autoRegenTimerRef.current) clearTimeout(autoRegenTimerRef.current)
        autoRegenTimerRef.current = setTimeout(() => {
          handleGenerateSpeechRef.current(idx, undefined, text)
          autoRegenTimerRef.current = null
        }, 2000)
      }
    }
  }, [editingSegmentIndex, setPreviewText, displaySegments, playbackMode])

  // Cancel editing
  const cancelEditing = useCallback(() => {
    setEditingSegmentIndex(null)
    setEditingText(''); editingTextRef.current = ''
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
    undoStack.current.push({ kind: 'text', index, prevText: segs[index]?.preview_text ?? segs[index]?.active_text ?? segs[index]?.target_text ?? '' })
    emotionAutoFiredRef.current.delete(index)
    setPreviewText(index, text)
    setImportedSegments(prev => {
      const base = prev ?? displaySegmentsRef.current
      return base.map((seg, i) => i === index
        ? { ...seg, preview_text: text, committed_adapted_text: text, text_locked: true }
        : seg)
    })

    applyFlagOutcome(index, 'text')
    const ti = segs[index]?.transcript_index ?? index
    commitOrStage(ti, { committed_adapted_text: text, text_locked: true }).catch(err =>
      console.warn('[PASTE] failed to persist text:', err)
    )
    // Auto-regen in PREVIEW only — see saveEditing for why.
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

  // Pause and invalidate the RPT buffer when the active chunk changes so the
  // next Play stitches the new window instead of replaying the old one.
  // Scrolling is handled by goToChunk (manual navigation) and by the
  // timeupdate handler during playback, so this effect only stops audio.
  useEffect(() => {
    if (!chunkMode || activeChunk === null) return
    rptBufferRef.current = null
    stopAllRptAudio()
    if (videoRef.current) videoRef.current.pause()
    setIsPlaying(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChunk, chunkMode, chunkStart])

  /** Timing and audio of the segments in play, as a cheap string.
   *
   *  THE PREVIEW MUST FOLLOW THE SEGMENTS. The stitched buffer was invalidated
   *  only when the chunk changed, so after moving a segment Play replayed the
   *  OLD arrangement: the audio stayed where it was while the block moved. That
   *  inverts the whole method — you end up dragging segments to match audio that
   *  cannot move, instead of placing audio against the picture.
   *
   *  Only the active window is measured (tens of segments, not hundreds), and
   *  only the fields that change what you HEAR: where each segment starts and
   *  ends, and which take is playing. */
  const windowAudioSignature = useMemo(() => {
    const inWindow = chunkMode && activeChunk !== null
      ? displaySegments.filter(s => {
          const st = s.committed_start_time ?? s.start_time ?? 0
          return st >= chunkStart && st < chunkEnd
        })
      : displaySegments
    return inWindow.map(s => [
      s.committed_start_time ?? s.start_time ?? 0,
      s.committed_end_time ?? s.end_time ?? 0,
      s.committed_audio_url ?? s.audio_url ?? "",
      s.committed_speed ?? "",
    ].join(":")).join("|")
  }, [displaySegments, chunkMode, activeChunk, chunkStart, chunkEnd])

  // Drop the stitched preview whenever that signature moves, so the next Play
  // rebuilds from what is on the timeline now. Cheaper than re-stitching here:
  // a drag can fire this many times, and only the next Play needs the audio.
  //
  // AND SILENCE THE OLD ARRANGEMENT IF IT IS STILL PLAYING. Invalidating the
  // buffer does nothing to the AudioBufferSourceNode already scheduled — it
  // holds its own copy and plays on to the end regardless. So an edit made
  // during playback left the blocks in one place and the sound in another,
  // which is the whole complaint: the audio must come from the blocks.
  //
  // Bumping stitchVersion wakes the scheduler, which rebuilds from the current
  // arrangement and resumes at the playhead. There is a brief silence while the
  // stitch decodes; that is honest, and far better than hearing the old take.
  useEffect(() => {
    rptBufferRef.current = null
    if (isPlayingRef.current) {
      stopAllRptAudioRef.current()
      setStitchVersion(v => v + 1)
    }
  }, [windowAudioSignature])

  // Segments belonging to the active window. This is the "how many are entered
  // in for editing" number — it has to track navigation, or the counter reads
  // as frozen while the window changes underneath it.
  const segmentsInWindow = useMemo(() => {
    if (!chunkMode || activeChunk === null) return displaySegments.length
    return displaySegments.filter(s => {
      const start = s.committed_start_time ?? s.start_time ?? 0
      return start >= chunkStart && start < chunkEnd
    }).length
  }, [displaySegments, chunkMode, activeChunk, chunkStart, chunkEnd])

  /** Start time a segment is actually drawn at (a dragged take moves). */
  const segStartOf = useCallback((s: Segment | undefined) =>
    s ? (s.committed_start_time ?? s.start_time ?? 0) : 0, [])

  // Timeline blocks are rendered only for the active window. A feature-length
  // film is ~839 segments across four tracks inside a ~585,000px container,
  // which is what makes the editor feel stiff; a window is ~30. Callers bail
  // inside .map() with `return null` rather than filtering, so the array index
  // every drag/save/staged-key handler relies on stays the real one.
  const inActiveWindow = useCallback((s: Segment | undefined) => {
    if (!chunkMode || activeChunk === null || !s) return true
    const start = segStartOf(s)
    const end = s.committed_end_time ?? s.end_time ?? start
    // Overlap test, not containment: a segment that starts before the window
    // but runs into it must still render in the later window.
    return start < chunkEnd && end > chunkStart
  }, [chunkMode, activeChunk, chunkStart, chunkEnd, segStartOf])

  // The chunk that actually contains the current playhead. The active chunk is
  // kept in sync with this so the window boundary, the viewport, and the chunk
  // bar never drift apart — the root cause of the "bar stuck at 00" / freeze.
  const currentChunk = chunkMode
    ? Math.min(chunkCount - 1, Math.max(0, findChunkForTime(currentTime)))
    : null

  useEffect(() => {
    if (!chunkMode || currentChunk === null) return
    if (currentChunk !== activeChunk) {
      setActiveChunk(currentChunk)
    }
  }, [chunkMode, currentChunk, activeChunk, setActiveChunk])

  // A chunk is "finished" once you edited something in it and moved on to work
  // elsewhere — that is the moment the user calls it done, not the save.
  const [completedChunks, setCompletedChunks] = useState<Set<number>>(new Set())
  const prevSelectionRef = useRef<{ index: number; chunk: number } | null>(null)

  // Selecting a segment takes the video and the timeline to it, and retires the
  // segment you just left.
  useEffect(() => {
    if (selectedSegmentIndex === null) return
    const seg = displaySegments[selectedSegmentIndex]
    if (!seg) return
    const start = segStartOf(seg)

    const prev = prevSelectionRef.current
    if (prev && prev.index !== selectedSegmentIndex) {
      // Only an edited segment marks its window done; simply clicking through
      // segments to read them should not turn the film green.
      if (displaySegments[prev.index]?.isUserEdited) {
        setCompletedChunks(s => new Set(s).add(prev.chunk))
      }
    }
    prevSelectionRef.current = {
      index: selectedSegmentIndex,
      chunk: findChunkForTime(start),
    }

    setCurrentTime(start)
    if (videoRef.current) videoRef.current.currentTime = start
    const container = timelineRef.current
    if (container) {
      // ONLY IF IT IS NOT ALREADY ON SCREEN.
      //
      // This scrolled on every selection change, and dragging a segment selects
      // it — so the view jumped out from under the very block being placed. When
      // the work is lining audio up against picture frame by frame, a timeline
      // that moves while you drag makes it impossible.
      //
      // Jumping is still right when the segment is somewhere else entirely: that
      // is navigation, not interference.
      const px = start * PIXELS_PER_SECOND
      const viewLeft = container.scrollLeft
      const viewRight = viewLeft + container.clientWidth
      const margin = 40
      if (px < viewLeft + margin || px > viewRight - margin) {
        // 30% in from the left, so the block lands in view rather than pinned to
        // the edge with its neighbours cut off.
        container.scrollLeft = Math.max(0, px - container.clientWidth * 0.3)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSegmentIndex])

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
      {/* Deletion countdown — centred, modal-weight, and deliberately hard to
          miss. Unrendered work is deleted after its window closes, and losing a
          part-finished feature because a notice sat quietly in a corner would be
          indefensible. Dismissible for this session so it does not block work,
          but it returns on reload until the user resubmits or renders. */}
      {retention?.warn && !retention.expired && !retentionDismissed && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[440px] rounded-2xl border-2 border-red-500/70 bg-[#0B1220] p-6 shadow-[0_0_40px_rgba(239,68,68,0.35)]">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-7 w-7 shrink-0 text-red-400" />
              <h2 className="text-lg font-bold text-red-200">
                Work due for deletion in {Math.max(0, Math.ceil(retention.days_left))} day
                {Math.ceil(retention.days_left) === 1 ? '' : 's'}
              </h2>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              {retention.kind === 'abandoned' ? (
                <>
                  This job has not been rendered. Unrendered work is permanently deleted
                  after four months — the source video,
                  audio, transcript and every edit.
                </>
              ) : (
                <>
                  This film was rendered and its retention window is closing. All source
                  material, audio and edits are permanently deleted on the date below.
                </>
              )}
            </p>

            <p className="mt-3 text-xs font-medium text-slate-400">
              Deletion date: {new Date(retention.deadline).toLocaleDateString(undefined, {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </p>

            <div className="mt-6 flex items-center gap-3">
              {retention.kind === 'abandoned' ? (
                <Button
                  className="flex-1 bg-sky-600 hover:bg-sky-700 text-white font-semibold"
                  onClick={handleResubmitRetention}
                  disabled={isResubmitting}
                >
                  {isResubmitting
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <RefreshCw className="h-4 w-4 mr-2" />}
                  Resubmit — keep this work
                </Button>
              ) : (
                <span className="flex-1 text-xs text-slate-400">
                  Download or export the film before this date to keep it.
                </span>
              )}
              <Button
                variant="outline"
                className="border-slate-700 hover:bg-slate-800"
                onClick={() => setRetentionDismissed(true)}
              >
                Dismiss
              </Button>
            </div>

            {resubmitError && (
              <p className="mt-3 text-xs font-medium text-red-300">{resubmitError}</p>
            )}

            <p className="mt-3 text-[11px] text-slate-500">
              Dismissing hides this for now — it returns next time you open the editor.
              {retention.kind === 'abandoned' && ' Resubmit also lives in Advanced ▸ Resubmit.'}
            </p>
          </div>
        </div>
      )}

      {/* Switch-chunk guard. Staged edits live in the browser only, so leaving
          a chunk without deciding would lose them silently. Three explicit
          outcomes — no "are you sure?" that hides what happens to the work. */}
      {pendingChunkSwitch !== null && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[460px] rounded-2xl border border-amber-500/60 bg-[#0B1220] p-6 shadow-[0_0_40px_rgba(245,158,11,0.25)]">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-6 w-6 shrink-0 text-amber-400" />
              <h2 className="text-lg font-bold text-amber-200">
                {Object.keys(stagedEdits).length} unsaved edit
                {Object.keys(stagedEdits).length === 1 ? '' : 's'} in this chunk
              </h2>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              Staged takes are not committed yet. Saving commits them to the film;
              discarding deletes the takes and returns these segments to their
              previous audio.
            </p>

            <div className="mt-6 flex items-center gap-2">
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                onClick={() => resolveChunkSwitch('save')}
                disabled={chunkSwitchBusy !== null}
              >
                {chunkSwitchBusy === 'save'
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <Save className="h-4 w-4 mr-2" />}
                {chunkSwitchBusy === 'save' && saveProgress
                  ? `Saving ${saveProgress.done}/${saveProgress.total}…`
                  : 'Save and continue'}
              </Button>
              <Button
                variant="outline"
                className="border-red-500/50 text-red-300 hover:bg-red-500/10"
                onClick={() => resolveChunkSwitch('discard')}
                disabled={chunkSwitchBusy !== null}
              >
                {chunkSwitchBusy === 'discard'
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : null}
                Discard
              </Button>
              <Button
                variant="outline"
                className="border-slate-700 hover:bg-slate-800"
                onClick={() => resolveChunkSwitch('stay')}
                disabled={chunkSwitchBusy !== null}
              >
                Stay
              </Button>
            </div>
          </div>
        </div>
      )}

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
        {/* Offset right of true centre: Make Movie now sits at the end of the
            nav and reaches into the middle of the header, which this used to
            overlap. */}
        <span className="absolute left-1/2 -translate-x-1/2 ml-40 text-xs font-mono text-amber-400 select-all">
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

            {/* Edit counters, in the top bar beside MAKE MOVIE — the place the
                user looks before committing to a render.
                  "N staged"      how many segments are entered for editing
                  "3 of 12 done"  live progress while a Save runs
                  "N failed"      commits that did not land, still staged */}
            {/* Segment counter now lives in the segment header row, where the
                user is actually working — it collided with MAKE MOVIE here. */}

            {/* Failed-save warning, immediately before MAKE MOVIE.
                A save is commit-what-you-can, so a failed segment is NOT in the
                render — the user has to know that before spending a full render
                on an incomplete film. Named explicitly ("Segment 7") because
                "some segments failed" gives them nothing to act on. */}
            {Object.keys(failedSegments).length > 0 && (
              <div className={cn(
                "ml-6 flex items-center gap-2 rounded-md border px-3 py-1.5",
                releasedForRender
                  ? "border-amber-500/60 bg-amber-500/15"
                  : "border-red-500/60 bg-red-500/15"
              )}>
                <AlertCircle className={cn("h-4 w-4 shrink-0", releasedForRender ? "text-amber-400" : "text-red-400")} />
                <span className={cn("text-xs font-semibold", releasedForRender ? "text-amber-200" : "text-red-200")}>
                  {Object.keys(failedSegments).length === 1
                    ? `Segment ${Object.keys(failedSegments)[0]} FAILED`
                    : `Segments ${Object.keys(failedSegments).join(', ')} FAILED`}
                  {' — '}
                  {releasedForRender
                    ? 'RELEASED: this render will not contain them.'
                    : `${Object.keys(failedSegments).length === 1 ? 'segment' : 'segments'} will be re-loaded at the end for re-editing.`}
                </span>
              </div>
            )}

            {/* Make Movie lives up here, well away from the transport controls:
                it kicks off a full render, and sitting beside play/stop invited
                mis-clicks on a button you don't want fired by accident.
                Professional only — hidden for Premium. */}
            {isProfessional && (
            <Button
              className={cn(
                "ml-6 h-8 px-5 rounded-full text-xs font-bold tracking-widest uppercase",
                "bg-transparent transition-colors",
                rebuildStatus === 'idle' &&
                  "bg-teal-500/10 hover:bg-teal-500/20 border border-teal-400/70 hover:border-teal-300 " +
                  "text-teal-100 [text-shadow:0_0_6px_rgba(45,212,191,0.9)] " +
                  "shadow-[0_0_10px_rgba(45,212,191,0.25),inset_0_0_12px_rgba(45,212,191,0.12)]",
                rebuildStatus === 'processing' &&
                  "bg-teal-500/15 border border-teal-300 animate-pulse text-teal-50 " +
                  "[text-shadow:0_0_8px_rgba(45,212,191,1)] shadow-[0_0_16px_rgba(45,212,191,0.45)]",
                rebuildStatus === 'complete' &&
                  "bg-emerald-500/10 border border-emerald-400/70 text-emerald-100 " +
                  "[text-shadow:0_0_6px_rgba(52,211,153,0.9)]",
                rebuildStatus === 'error' &&
                  "bg-red-500/10 border border-red-400/70 text-red-100 " +
                  "[text-shadow:0_0_6px_rgba(248,113,113,0.9)]",
              )}
              onClick={() => {
                const staged = Object.keys(stagedEdits).length
                const unreviewed = allWindowsReviewed ? 0 : chunkCount - savedWindowCount
                const failed = releasedForRender ? [] : Object.keys(failedSegments)
                // The layover track is never rendered: the backend filters parked
                // scenes out of both the cut and the fade filters. So a section left
                // up there is footage being dropped from the film — deliberate while
                // working, easy to forget by the time you press this.
                const parked = parkedScenes.length
                const parkedSeconds = parkedScenes.reduce(
                  (t, sc) => t + ((sc.source_end ?? sc.end) - (sc.source_start ?? sc.start)), 0)
                // Clean run: render straight away. A confirm on the happy path is
                // just friction on the button the user came here to press.
                if (staged === 0 && unreviewed === 0 && failed.length === 0 && parked === 0) {
                  handleRebuildVideo()
                  return
                }
                setConfirmRender({ staged, unreviewed, failed, parked, parkedSeconds })
              }}
              // Blocked while any counted segment is still outstanding. A render
              // is expensive and slow, and it assembles from COMMITTED segments
              // only — so staged-but-unsaved edits and failed commits would both
              // be silently missing from the finished film. Better to refuse the
              // render than hand back a movie the user believes contains work it
              // does not.
              disabled={isRebuilding || saveProgress !== null}
              title={
                saveProgress
                  ? `Saving ${saveProgress.done} of ${saveProgress.total} — wait for the save to finish`
                  : isRebuilding
                    ? 'Render in progress'
                    : "Render the finished dubbed video from the current timeline"
              }
            >
              {rebuildStatus === 'complete'
                ? <Check className="h-3.5 w-3.5 mr-1.5" />
                : <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isRebuilding && "animate-spin")} />}
              {rebuildStatus === 'processing' ? 'MAKING MOVIE…'
                : rebuildStatus === 'complete' ? 'MOVIE READY'
                : 'MAKE MOVIE'}
            </Button>
            )}

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
            title={layoutLocked
              ? "Editor locked — click to unlock"
              : "Lock the editor so nothing can be moved or changed while you're away"}
          >
            {layoutLocked ? (
              <>
                <Lock className="h-3.5 w-3.5" />
                <span>Locked</span>
              </>
            ) : (
              <>
                <Unlock className="h-3.5 w-3.5" />
                <span>Lock Editor</span>
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
          {/* Remaining monthly minutes, from the same source as the dashboard.
              The old "pts" half of this badge was dropped: there is no points
              concept anywhere in the product, so it could only ever show a
              made-up constant. */}
          <div
            className="flex items-center gap-1 bg-slate-800/50 rounded-md px-2.5 py-1 border border-slate-700/50"
            title={usage.loading
              ? 'Loading usage…'
              : usage.planLimit > 0
                ? `${usage.minutesUsed} of ${usage.planLimit} min used this month` +
                  (usage.bonusBalance ? ` · ${usage.bonusBalance} bonus min` : '')
                : 'Monthly usage'}
          >
            {usage.loading ? (
              <span className="text-slate-500 text-xs">— min</span>
            ) : (
              <>
                <span className={
                  usage.minutesRemaining === 0 ? 'text-red-400 font-semibold text-sm'
                  : usage.minutesRemaining < 10 ? 'text-amber-400 font-semibold text-sm'
                  : 'text-slate-300 font-medium text-sm'
                }>
                  {usage.minutesRemaining}
                </span>
                <span className="text-slate-500 text-xs">min left</span>
              </>
            )}
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
              {/* Escape hatch: render despite failed segments.
                  A failed commit normally blocks MAKE MOVIE, because the render
                  assembles from committed segments and the film would silently
                  omit that work. But a segment can prove genuinely impossible —
                  a line that will not fit, a voice that will not render — and
                  the user must not be trapped, unable to ship the other 400
                  segments because of one. Releasing renders what IS committed;
                  the failed segments keep their staged work for re-editing. */}
              {/* Resubmit: "I am still working on this." Resets the 4-month
                  abandoned-work countdown without forcing the user to render
                  something they are not ready to render. Always available so
                  they can postpone before the warning appears, not only once
                  the card is already shouting at them. */}
              {retention?.kind === 'abandoned' && (
                <DropdownMenuItem
                  onClick={handleResubmitRetention}
                  disabled={isResubmitting}
                  className="cursor-pointer hover:bg-slate-800"
                >
                  <RefreshCw className={cn("h-4 w-4 mr-2 text-sky-400", isResubmitting && "animate-spin")} />
                  <span className="flex-1">Resubmit (keep this work)</span>
                  {retention.warn && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                      {Math.max(0, Math.ceil(retention.days_left))}d
                    </span>
                  )}
                </DropdownMenuItem>
              )}
              {/* Always listed, disabled when there is nothing to release. A
                  control that materialises only mid-crisis is one the user
                  meets for the first time under pressure; listing it greyed
                  means they have already seen it and know where it lives. */}
              <DropdownMenuItem
                onClick={() => {
                  if (Object.keys(failedSegments).length > 0) setReleasedForRender(v => !v)
                }}
                disabled={Object.keys(failedSegments).length === 0}
                className={cn(
                  Object.keys(failedSegments).length === 0
                    ? "opacity-50 cursor-default"
                    : "cursor-pointer hover:bg-slate-800",
                )}
                title={
                  Object.keys(failedSegments).length === 0
                    ? "Available when a segment fails to save — lets you render without it"
                    : releasedForRender
                      ? "Released: MAKE MOVIE will render without the failed segment(s)"
                      : "Render without the failed segment(s)"
                }
              >
                {Object.keys(failedSegments).length === 0
                  ? <AlertCircle className="h-4 w-4 mr-2 text-slate-500" />
                  : releasedForRender
                    ? <Check className="h-4 w-4 mr-2 text-emerald-400" />
                    : <AlertCircle className="h-4 w-4 mr-2 text-red-400" />}
                <span className="flex-1">Release for render</span>
                <span
                  className={cn(
                    "text-[10px] font-medium px-1.5 py-0.5 rounded tabular-nums",
                    Object.keys(failedSegments).length > 0
                      ? "bg-red-500/20 text-red-300"
                      : "bg-slate-700/40 text-slate-500",
                  )}
                >
                  {String(Object.keys(failedSegments).length).padStart(2, '0')}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => transcriptInputRef.current?.click()}
                className="cursor-pointer hover:bg-slate-800"
              >
                <FileText className="h-4 w-4 mr-2" />
                Import Transcript
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  // Anchor download = browser navigation, so the token has to
                  // ride in the query string (toAbsoluteUrl attaches it).
                  const url = apiClient.toAbsoluteUrl(`/api/transcript/export/${jobId}`)
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
          <VideoRecorder
            onFileCaptured={(file) => {
              const url = URL.createObjectURL(file)
              setImportedVideoUrl(url)
              setImportedVideoFile(file)
            }}
            maxSeconds={recordingLimit}
            triggerClassName="flex items-center gap-1.5 h-8 px-3 text-sm border border-red-500/70 rounded-md bg-red-500/10 hover:bg-red-500/20 hover:border-red-400 text-red-200 transition-colors"
            triggerLabel="Record"
          />
          
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
            {isSaving
              ? (saveProgress ? `Saving ${saveProgress.done}/${saveProgress.total}…` : 'Saving…')
              : 'Save'}
          </Button>
          <Button
            size="sm"
            className="h-8 bg-violet-600 hover:bg-violet-700 text-white font-medium"
            onClick={() => router.push('/subscribe')}
          >
            <Sparkles className="h-4 w-4 mr-1" />
            Upgrade
          </Button>
          {/* Hidden for Professional: Make Movie already rebuilds AND exports,
              opening this same modal when it finishes, so a separate Download
              would be a second door to the same place. Premium has no Make
              Movie, so this is its only route to the file. */}
          {!isProfessional && (
            <Button
              size="sm"
              className="h-8 bg-amber-500 hover:bg-amber-600 text-black font-medium"
              onClick={() => setShowExportModal(true)}
            >
              <Download className="h-4 w-4 mr-1" />
              Download
            </Button>
          )}
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
            {/* Segment counter, in the centre of the segment header row.
                It lived in the top nav and collided with MAKE MOVIE; this row
                is where the user's attention already is while editing, and the
                counter is about the segments in front of them. Always visible,
                reading 00/00 at rest — a gauge that only appears when something
                is wrong is one nobody can find when they need it. */}
            <div className="flex-1 flex items-center justify-center min-w-0">
              <span className="flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900/80 px-3 py-1">
                {/* The live light, inherited from the QC ticker it replaced:
                    emerald when idle and healthy, amber while a save runs, red
                    when a commit has failed. It reads at a glance from across
                    the room, which is the point of an always-on indicator. */}
                <span
                  className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    Object.keys(failedSegments).length > 0
                      ? "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.9)]"
                      : saveProgress
                        ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)] animate-pulse"
                        : "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]",
                  )}
                />
                {/* Labels emerald, numbers amber: the words are chrome, the
                    digits are the reading. Only the count changes, so only the
                    count needs to catch the eye. */}
                <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                  Segment Counter
                </span>
                {saveProgress ? (
                  <span className="text-xs font-semibold text-emerald-400">
                    <span className="text-amber-300 tabular-nums">{saveProgress.done}</span>
                    {' of '}
                    <span className="text-amber-300 tabular-nums">{saveProgress.total}</span>
                    {' done'}
                  </span>
                ) : (
                  <>
                    <span
                      className="text-xs font-semibold text-emerald-400"
                      title={chunkMode
                        ? "Segments in the window you are editing"
                        : "Segments in this film"}
                    >
                      <span className="text-amber-300 tabular-nums">
                        {String(segmentsInWindow).padStart(2, '0')}
                      </span>
                      {chunkMode ? ' in window' : ' total'}
                      {/* Film total alongside the window count: 27 on its own gives no
                          sense of scale — it could be 27 of 30 or 27 of 817. */}
                      {chunkMode && displaySegments.length > 0 && (
                        <span className="text-slate-500 font-normal">
                          {' · '}{displaySegments.length} total
                        </span>
                      )}
                    </span>
                    {chunkMode && (
                      <>
                        <span className="text-slate-700">|</span>
                        {/* Progress across the whole film: how many windows are
                            committed. Reads the same chunkStatusMap the chunk
                            bar's green dots come from, so the two can't disagree. */}
                        <span
                          className="text-xs font-semibold text-emerald-400"
                          title="Windows saved out of the whole film"
                        >
                          <span className="text-amber-300 tabular-nums">
                            {String(
                              Object.values(chunkStatusMap).filter(s => s === 'saved').length
                            ).padStart(2, '0')}
                          </span>
                          {' of '}
                          <span className="text-amber-300 tabular-nums">
                            {String(chunkCount).padStart(2, '0')}
                          </span>
                          {' windows reviewed'}
                        </span>
                      </>
                    )}
                    <span className="text-slate-700">|</span>
                    <span
                      className="text-xs font-semibold text-emerald-400"
                      title="Auditioned edits not yet committed — press Save to keep them"
                    >
                      <span className="text-amber-300 tabular-nums">
                        {String(stagedEditCount).padStart(2, '0')}
                      </span>
                      {' staged'}
                    </span>
                    <span className="text-slate-700">|</span>
                    <span
                      className="text-xs font-semibold text-emerald-400"
                      title="Segments whose save failed — they remain staged for re-editing"
                    >
                      <span
                        className={cn(
                          "tabular-nums",
                          Object.keys(failedSegments).length > 0 ? "text-red-300" : "text-amber-300",
                        )}
                      >
                        {String(Object.keys(failedSegments).length).padStart(2, '0')}
                      </span>
                      {' failed'}
                    </span>
                  </>
                )}
              </span>
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
              // Window the row list the same way the timeline tracks are windowed.
              // A feature is ~817 segments and each row carries emotion/write-in/
              // speed controls plus Commit/Clear, so the full list is thousands of
              // nodes re-rendered on every timeupdate. Bail inside .map() rather
              // than filtering: `index` feeds editingSegmentIndex, keyAt(index) and
              // every commit handler, so a renumbered index would edit the wrong row.
              if (!inActiveWindow(segment)) return null
              const speakerColor = getSpeakerColor(segment.speaker_id)
              const isEditing = editingSegmentIndex === index
              const hasQCFindings = (segment.qc_findings?.length ?? 0) > 0
              const segmentSuggestions = suggestions[index] || []
                  const isAssignmentPulse = speakerPulseId !== null && segment.speaker_id === speakerPulseId
              
              return (
                <SegmentContextMenu
                  key={segment.id}
                  index={index}
                  segmentKey={getSegmentKey(segment)}
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
                  onToggleLock={(idx) => setSegmentLocked(idx, !lockedSegments.has(keyAt(idx)))}
                      onLockScene={(idx) => { setSceneLockMode(true); setSceneAnchor(idx); setSceneRange({ start: idx, end: idx }) }}
                      onUnlockScene={(idx) => unlockScene(idx)}
                  onTogglePair={togglePairWithNext}
                  onRevert={() => handleRevert()}
                  onUndoLastEdit={handleUndoLastEdit}
                  onUndoSplit={handleUndoSplit}
                  onCopyText={handleCopyText}
                  onPasteText={handlePasteText}
                  onClearSegment={handleClearSegment}
                  onSetEmotion={(idx, emotion) => setStagedEmotions(prev => ({ ...prev, [keyAt(idx)]: emotion }))}
                  onClearEmotion={(idx) => {
                    setStagedEmotions(prev => ({ ...prev, [keyAt(idx)]: '' }))
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
                          setStagedVoices(prev => ({ ...prev, [keyAt(index)]: parsed.voice_id }))
                          if (speakerId) {
                            setSpeakerVoiceMap(prev => ({ ...prev, [speakerId]: parsed.voice_id }))
                            setStagedVoices(prev => {
                              const next = { ...prev }
                              displaySegments.forEach((seg, i) => {
                                if (seg.speaker_id === speakerId && i !== index) delete next[getSegmentKey(seg)]
                              })
                              return next
                            })
                          }
                          selectSegment(index)
                          setCurrentTime(displaySegments[index].start_time)
                          if (speakerId) {
                            applyVoiceToSpeaker(speakerId, parsed.voice_id)
                          } else {
                            // A Fish voice implies the Fish engine. Without this the
                            // segment's stored engine wins and the Fish UUID is handed
                            // to Respeecher, which 500s on an unknown voice id.
                            handleGenerateSpeech(index, parsed.voice_id, undefined, undefined, 'fish-audio')
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
                    setStagedVoices(prev => ({ ...prev, [keyAt(index)]: vk }))
                    if (speakerId) {
                      setSpeakerVoiceMap(prev => ({ ...prev, [speakerId]: vk }))
                      setStagedVoices(prev => {
                        const next = { ...prev }
                        displaySegments.forEach((seg, i) => {
                          if (seg.speaker_id === speakerId && i !== index) delete next[getSegmentKey(seg)]
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
                  {segment.transcript_index == null && !segment.committed_audio_url && (
                    <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-1 rounded-l bg-emerald-500" />
                  )}
                  {segment.transcript_index == null && !segment.committed_audio_url && (
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
                          document.removeEventListener('pointercancel', onUp)
                          window.removeEventListener('blur', onUp)
                        }
                        document.addEventListener('mousemove', onMove)
                        document.addEventListener('mouseup', onUp)
                        document.addEventListener('pointercancel', onUp)
                        window.addEventListener('blur', onUp)
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
                        <DropdownMenuContent align="start" className="w-44 max-h-72 overflow-y-auto bg-slate-900 border-slate-700">
                          {/* 15 slots, matching the Voice Library and Test Clips.
                              A feature has far more speaking parts than the 5 Velma
                              tends to return, and a speaker that cannot be named
                              cannot be cast. */}
                          {Array.from({ length: 15 }, (_, i) => i + 1).map(n => {
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
                          key={editingSegmentIndex}
                          defaultValue={editingText}
                          placeholder="Enter text…"
                          onChange={(e) => {
                            // Ref only — no setState, no re-render while typing.
                            editingTextRef.current = e.target.value
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditing()
                            if (e.key === 'Escape') cancelEditing()
                            e.stopPropagation()
                          }}
                          // Without this, clicking anywhere other than Enter abandoned
                          // the typed value: it lived only in the ref and nothing copied
                          // it into preview_text.
                          onBlur={() => { if (editingTextRef.current.trim()) saveEditing() }}
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
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Emotion tag chip — shows the exact tag that will be sent to TTS */}
                        {stagedEmotions[keyAt(index)] ? (() => {
                          // Compact a long custom emotion to a one-word pill; full text on hover.
                          const full = stagedEmotions[keyAt(index)].toLowerCase()
                          const firstWord = full.split(/[\s,]+/).filter(Boolean)[0] ?? full
                          const label = full.length > firstWord.length ? `${firstWord}…` : full
                          return (
                          <span
                            className="inline-flex items-center gap-1 max-w-[9rem] text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-mono cursor-pointer hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/30 transition-colors group"
                            title={`(${full}) — click to remove`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setStagedEmotions(prev => ({ ...prev, [keyAt(index)]: '' }))
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
                          className={
                            "inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full transition-colors cursor-pointer select-none " +
                            (segment.tts_text?.trim()
                              // Active Delivery Script: stay lit so it's obvious at a
                              // glance which segments are driven by a script — and that
                              // their emotion pill and Nuances are inert.
                              ? "text-cyan-300 border border-cyan-500/60 bg-cyan-500/10 hover:bg-cyan-500/20"
                              : "text-slate-600 border border-slate-800 hover:text-cyan-400 hover:border-cyan-500/30")
                          }
                          title={
                            segment.tts_text?.trim()
                              ? `Delivery Script active: ${segment.tts_text.trim().slice(0, 80)}`
                              : "Write a custom emotion descriptor"
                          }
                          onClick={(e) => {
                            e.stopPropagation()
                            selectSegment(null)
                            setSplitWordMode(null)
                            setInlineEmotionPicker(null)
                            setWriteInError(null)
                            setInlineEmotionWriteIn(prev => prev === index ? null : index)
                          }}
                        >
                          <Plus className="h-2 w-2" />write-in
                        </span>
                        {/* Overlap is a timing TECHNIQUE, not a fault — a short one
                            crossfades the join between two separately rendered lines
                            and is a large part of why a dub stops sounding cut
                            together. Below CROSSFADE_MAX_SEC it is invisible. Past
                            CROSSFADE_WARN_SEC two lines really are talking over each
                            other and that is worth saying loudly. */}
                        {overlapById.has(index) && overlapById.get(index)! > CROSSFADE_MAX_SEC && (() => {
                          const _by = overlapById.get(index)!
                          const _bad = _by > CROSSFADE_WARN_SEC
                          return (
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border',
                                _bad
                                  ? 'border-red-500/50 bg-red-500/15 text-red-300'
                                  : 'border-slate-600 bg-slate-700/40 text-slate-300',
                              )}
                              title={_bad
                                ? `Overlaps a neighbour by ${_by.toFixed(2)}s — long enough that two lines are talking over each other. Still crossfaded, but worth shortening.`
                                : `Crossfaded with its neighbour over ${_by.toFixed(2)}s.`}
                            >
                              {_bad && <AlertCircle className="h-2.5 w-2.5" />}
                              {_bad ? `overlaps ${_by.toFixed(2)}s` : `crossfade ${_by.toFixed(2)}s`}
                            </span>
                          )
                        })()}
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
                                    stagedEmotions[keyAt(index)] === emotion
                                      ? 'bg-violet-500/30 text-violet-200 border-violet-400'
                                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-violet-500/20 hover:text-violet-300 hover:border-violet-500/40'
                                  )}
                                  onClick={() => setStagedEmotions(prev => ({ ...prev, [keyAt(index)]: emotion }))}
                                >
                                  {emotion.toLowerCase()}
                                </span>
                              ))}
                              {/* Open the full Emotion Library (~194 states) */}
                              <span
                                title="Open the Emotion Library — 194 delivery states"
                                className="text-[9px] px-1.5 py-0.5 rounded-full cursor-pointer border border-violet-400/50 bg-violet-500/15 text-violet-200 hover:bg-violet-500/30 hover:text-white transition-colors select-none font-mono"
                                onClick={() => setEmotionLibraryTarget({ index, mode: 'stage' })}
                              >
                                ＋ more
                              </span>
                            </div>
                            <button
                              type="button"
                              disabled={isRegenerating}
                              className="w-full text-[10px] py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:bg-slate-600 disabled:hover:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50 text-white font-medium transition-colors mb-1.5"
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
                          // Two modes off ONE box, decided by the SHAPE of the draft rather
                          // than by string overlap with the line:
                          //  - Delivery Script: has [tags] AND prose outside them → send
                          //    VERBATIM to Fish (tags parse, not spoken); display stays clean.
                          //  - Short emotion: no tags, or tags only → stage as an emotion pill.
                          //
                          // The old test required the draft to contain the line's first 10
                          // characters verbatim, so it broke the moment you rewrote the line
                          // ("What!" -> "What?!") — which is the entire point of a Delivery
                          // Script. On a misdetect the whole sentence was staged as the
                          // emotion, composed into one giant [ ] directive, and voiced by
                          // Fish: 6.4s of audio for a three-word line.
                          const submit = () => {
                            const draft = (customEmotionDrafts[index] ?? '').trim()
                            if (!draft) return
                            // Final safety net. The button is disabled while writeInError is
                            // set, but Ctrl+Enter and any future caller must not be able to
                            // bypass validation.
                            const err = validateWriteIn(draft)
                            if (err) { setWriteInError(err); return }
                            const isScript = isDeliveryScript(draft)
                            setWriteInError(null)
                            setInlineEmotionWriteIn(null)
                            selectSegment(index)
                            if (isScript) {
                              setImportedSegments(prev => prev ? prev.map((s, i) => i === index ? { ...s, tts_text: draft } : s) : prev)
                              // Delivery Script is Fish-only — Respeecher ignores it
                              // and would silently render the bubble text instead. Pull
                              // the segment onto Fish so the script is actually spoken.
                              if (displaySegments[index]?.engine === 'respeecher') {
                                setEngineNotice('Delivery Script is Fish-only — moving this segment to Fish Audio.')
                              }
                              handleGenerateSpeech(index, undefined, undefined, draft, 'fish-audio')
                            } else {
                              setStagedEmotions(prev => ({ ...prev, [keyAt(index)]: draft }))
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
                            <span
                              title="Emotion Library — insert a delivery [tag] into the script"
                              className="inline-block text-[9px] px-1.5 py-0.5 mb-1.5 rounded-full cursor-pointer border border-cyan-400/50 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/30 hover:text-white transition-colors select-none font-mono"
                              onClick={() => setEmotionLibraryTarget({ index, mode: 'insert' })}
                            >
                              ＋ Emotion Library
                            </span>
                            <textarea
                              autoFocus
                              rows={2}
                              placeholder="Double-click to load the line, then add [tags] anywhere — or type a short emotion…"
                              value={customEmotionDrafts[index] ?? ''}
                              onChange={(e) => {
                                const v = e.target.value
                                setCustomEmotionDrafts(prev => ({ ...prev, [index]: v }))
                                setWriteInError(validateWriteIn(v))
                              }}
                              onClick={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => {
                                // Double-click the empty field to drop the segment's line in
                                // (so you can add [tags]). If there's already text, let the
                                // browser's double-click word-select behave normally.
                                if (!(customEmotionDrafts[index] ?? '').trim()) {
                                  e.preventDefault()
                                  const line = segment.preview_text ?? segment.committed_adapted_text ?? segment.active_text ?? segment.target_text ?? ''
                                  setCustomEmotionDrafts(prev => ({ ...prev, [index]: line }))
                                  setWriteInError(validateWriteIn(line))
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() }
                              }}
                              className="w-full text-[11px] px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-cyan-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60 mb-1.5 resize-y leading-snug"
                            />
                            {writeInError && (
                              <p className="text-[9px] text-red-400 mb-1.5 leading-snug">{writeInError}</p>
                            )}
                            <button
                              type="button"
                              disabled={isRegenerating || !(customEmotionDrafts[index] ?? '').trim() || !!writeInError}
                              className="w-full text-[10px] py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:bg-slate-600 disabled:hover:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed disabled:opacity-50 text-white font-medium transition-colors mb-1.5"
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
                            stagedSpeeds[keyAt(index)] !== undefined && stagedSpeeds[keyAt(index)] !== 1.0
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
                          {stagedSpeeds[keyAt(index)] !== undefined && stagedSpeeds[keyAt(index)] !== 1.0
                            ? `${stagedSpeeds[keyAt(index)].toFixed(2)}×`
                            : <><Gauge className="h-2 w-2" />speed</>
                          }
                        </span>
                        {splitWordMode === index ? (
                          <div
                            className="text-sm flex flex-wrap gap-x-1 gap-y-1 px-3 py-2 rounded-2xl border-2 border-amber-500 bg-amber-500/10 shadow-[0_0_10px_rgba(251,191,36,0.4)] select-none"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-[10px] text-amber-400 font-medium w-full">✂️ Click a word to split before it</span>
                            {(segment.preview_text ?? segment.committed_adapted_text ?? segment.active_text ?? segment.target_text).split(' ').map((word, wordIdx) => (
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
                              lockedSegments.has(keyAt(index))
                                ? 'border-emerald-400 bg-emerald-500/20 shadow-[0_0_10px_rgba(34,197,94,0.4)]'
                                // Violet = driven by a recording. Deliberately not
                                // greyed or disabled: the text still sets the
                                // subtitle, QC and timing, it just no longer
                                // decides how the segment SOUNDS.
                                : segment.engine === 'elevenlabs-sts'
                                  ? 'border-violet-400 bg-violet-500/10 shadow-[0_0_8px_rgba(167,139,250,0.35)]'
                                : segment.isPreviewing
                                  ? 'border-orange-400 bg-orange-500/10 shadow-[0_0_8px_rgba(251,146,60,0.3)]'
                                  : 'border-amber-400 bg-amber-500/10 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                            )}
                            onDoubleClick={() => {
                              if (lockedSegments.has(keyAt(index)) || segment.isPreviewing) return
                              // When the write-in box is open, double-clicking the line drops it
                              // into that field (Delivery Script) so you can add [tags]. Otherwise
                              // double-click edits the line inline as before.
                              if (inlineEmotionWriteIn === index) {
                                const line = (segment.preview_text ?? segment.committed_adapted_text ?? segment.active_text ?? segment.target_text ?? '')
                                setCustomEmotionDrafts(prev => ({ ...prev, [index]: line }))
                              } else {
                                startEditing(index)
                              }
                            }}
                          >
                            {lockedSegments.has(keyAt(index)) && <Lock className="h-3 w-3 shrink-0" />}
                            {segment.engine === 'elevenlabs-sts' && (
                              <Mic2
                                className="h-3 w-3 shrink-0 text-violet-300"
                                aria-label="Audio comes from a recording"
                              />
                            )}
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
                            // The edit box is uncontrolled, so while a row is being
                            // edited the typed value exists ONLY in editingTextRef.
                            // preview_text is written by saveEditing(), which runs on
                            // Enter/blur — so "type, then click Commit" used to persist
                            // the ORIGINAL text and look like the edit had reverted.
                            // Blur fires before this click, but setImportedSegments is
                            // async, so preview_text is still stale in this tick: read
                            // the ref directly, as handleGenerateSpeech already does.
                            const _liveText =
                              (editingSegmentIndex === index && editingTextRef.current.trim())
                                ? editingTextRef.current.trim()
                                : (displaySegments[index]?.preview_text ?? undefined)
                            commitPreview(index)
                            // Use the bound store action if available, otherwise fall back
                            // to the live store getter to avoid HMR/stale-binding runtime
                            // errors where the destructured binding can be undefined.
                            const _commit = (typeof commitSegmentChanges === 'function')
                              ? commitSegmentChanges
                              : useEditorStore.getState().commitSegmentChanges
                            _commit(index, {
                              committed_adapted_text: _liveText,
                            });
                            // Persist the committed adapted text to the backend so the
                            // user's correction survives refreshes, hard reloads, and shutdowns.
                            (function persistCommittedText(idx) {
                              const ti = displaySegments[idx]?.transcript_index ?? idx
                              commitOrStage(ti, { committed_adapted_text: _liveText, text_locked: true })
                                .catch(err => console.warn('[COMMIT] persist failed', err))
                            })(index)
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) =>
                                i === index
                                  ? {
                                      ...seg,
                                      active_text: _liveText ?? seg.active_text ?? seg.target_text,
                                      target_text: _liveText ?? seg.target_text,
                                      variant_text: _liveText ?? seg.variant_text ?? seg.target_text,
                                      // commitSegmentChanges writes these into the store's
                                      // `segments` array, which is not mirrored here — set them
                                      // on importedSegments too or displaySegments never sees them.
                                      committed_adapted_text: _liveText ?? seg.committed_adapted_text,
                                      text_locked: true,
                                      isUserEdited: true,
                                      preview_text: null,
                                      isPreviewing: false,
                                      committed_emotion: stagedEmotions[keyAt(index)] ?? seg.committed_emotion,
                                    }
                                  : seg
                              )
                            })
                            setEditingSegmentIndex(null)
                            // Pass the text explicitly: handleGenerateSpeech infers it from
                            // editingTextRef only while the row is still the selected one,
                            // and editing has just been closed. Without this the commit
                            // could save the new text but speak the old.
                            handleGenerateSpeech(index, undefined, _liveText)
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
                    selectedSegmentIndex !== null && stagedEmotions[keyAt(selectedSegmentIndex)]
                      ? "text-violet-400 bg-violet-500/10"
                      : "text-slate-400"
                  )}
                >
                  {selectedSegmentIndex !== null && stagedEmotions[keyAt(selectedSegmentIndex)]
                    ? (() => {
                        const full = stagedEmotions[keyAt(selectedSegmentIndex)].toLowerCase()
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
                      selectedSegmentIndex !== null && stagedEmotions[keyAt(selectedSegmentIndex)] === emotion
                        ? "text-violet-300 bg-violet-500/20"
                        : "text-slate-300 hover:text-white hover:bg-slate-700"
                    )}
                    onClick={() => {
                      if (selectedSegmentIndex !== null) {
                        setStagedEmotions(prev => ({ ...prev, [keyAt(selectedSegmentIndex)]: emotion }))
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
                  const emotion = stagedEmotions[keyAt(selectedSegmentIndex)]
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
                          sameSpkIndices.forEach(i => { next[keyAt(i)] = emotion })
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
                      setStagedEmotions(prev => ({ ...prev, [keyAt(selectedSegmentIndex)]: '' }))
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
                  selectedSegmentIndex !== null && lockedSegments.has(keyAt(selectedSegmentIndex))
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
                ) : selectedSegmentIndex !== null && lockedSegments.has(keyAt(selectedSegmentIndex)) ? (
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
                    next.delete(keyAt(idx))
                    return next
                  })
                  setStagedSpeeds(prev => { const n = { ...prev }; delete n[keyAt(idx)]; return n })
                  setStagedEmotions(prev => { const n = { ...prev }; delete n[keyAt(idx)]; return n })
                  setStagedVoices(prev => { const n = { ...prev }; delete n[keyAt(idx)]; return n })
                  setStagedPitches(prev => { const n = { ...prev }; delete n[keyAt(idx)]; return n })
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
          ref={previewPanelRef}
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
                { id: 'respeecher', label: 'Respeecher',   feature: 'respeecher' },
                // Labelled 'Custom Voices' until now, which is what the cloned-voice
                // dialog and the Test Clips tab are also called — three things, one
                // name, and only one of them about custom voices. This panel converts
                // existing audio to another voice; it is the voice changer.
                { id: 'perform',    label: 'Voice Changer', feature: 'voiceChanger' },
                { id: 'seeds',      label: 'Seed Library', feature: 'respeecher' },
                { id: 'studio',     label: 'Studio',       feature: 'studioCollaboration' },
                { id: 'adaptation', label: 'Adaptation' },
                { id: 'speakers',   label: 'Speakers' },
                { id: 'library',    label: 'Voice Library' },
                { id: 'testclips',  label: 'Test Clips',   feature: 'customVoices' },
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
                controls={false}
                // MUTED IN PREVIEW ONLY. Preview is the editing mode: the segment
                // blocks are the audio there, and the video track would double it.
                // But a bare muted attribute silenced every mode, which costs the
                // two things those modes exist for — hearing the source performance
                // to time against in Original, and hearing what actually rendered
                // in Dubbed.
                muted={playbackMode === 'preview'}
              />
              <div
                ref={videoFadeOverlayRef}
                className="absolute top-0 left-0 w-full h-full bg-black pointer-events-none"
                style={{ opacity: 0 }}
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

          {rightPanelTab === 'respeecher' && (
            // overflow-hidden, not auto: the panel manages its own scrolling so the
            // tuning column stays fixed while only the voice list moves.
            <div className="flex-1 min-h-0 overflow-hidden bg-neutral-950">
              <RespeecherPanel
                segment={selectedSegmentIndex !== null ? displaySegments[selectedSegmentIndex] : null}
                jobId={jobId}
                isRegenerating={isRegenerating}
                onGenerate={(voiceId, samplingParams, seed) => {
                  if (selectedSegmentIndex === null) return
                  handleGenerateSpeech(
                    selectedSegmentIndex, voiceId, undefined, undefined, 'respeecher',
                    // seed null = re-roll. The flag is required: without it the
                    // backend falls back to the segment's stored seed and would
                    // replay the very take you're trying to leave.
                    {
                      sampling_params: samplingParams,
                      seed: seed ?? undefined,
                      reroll: seed === null ? true : undefined,
                    },
                  )
                }}
                onUseFish={() => {
                  if (selectedSegmentIndex === null) return
                  // voiceOverride omitted so voice_key falls back to the speaker's
                  // Fish mapping — a Respeecher slug would be meaningless to Fish.
                  handleGenerateSpeech(selectedSegmentIndex, undefined, undefined, undefined, 'fish-audio')
                }}
              />
            </div>
          )}

          {rightPanelTab === 'testclips' && (
            <div className="flex-1 min-h-0 overflow-hidden bg-neutral-950">
              <TestClipsPanel
                jobId={jobId}
                selectedSegmentIndex={selectedSegmentIndex}
                onVoiceAssigned={(speakerId, voiceId) => {
                  // Same propagation the Voice Library uses: clear per-segment
                  // overrides for this speaker so nothing shadows the assignment.
                  setStagedVoices(prev => {
                    const next = { ...prev }
                    displaySegments.forEach((seg) => {
                      if (seg.speaker_id === speakerId) delete next[getSegmentKey(seg)]
                    })
                    return next
                  })
                  setSpeakerVoiceMap(prev => ({ ...prev, [speakerId]: voiceId }))
                  // Then actually render it. Updating the map alone only relabels
                  // the speaker — the audio keeps whatever voice it had, which is
                  // indistinguishable from the assignment doing nothing.
                  if (voiceId) {
                    applyVoiceToSpeaker(speakerId, voiceId)
                  }
                }}
                onApplyToSegment={(segmentIndex, voiceId) => {
                  // Segment-only: stage the voice, then render it so the take is
                  // audible immediately. In chunk mode that writes a *_staged file
                  // and leaves segments.json alone, so it costs nothing until Save.
                  setStagedVoices(prev => ({ ...prev, [keyAt(segmentIndex)]: voiceId }))
                  handleGenerateSpeechRef.current(segmentIndex, voiceId)
                }}
              />
            </div>
          )}

          {rightPanelTab === 'perform' && (
            <div className="flex-1 min-h-0 overflow-hidden bg-neutral-950">
              <PerformPanel
                segment={selectedSegmentIndex !== null ? displaySegments[selectedSegmentIndex] : null}
                jobId={jobId}
                isRegenerating={isRegenerating}
                onPerformed={(updated) => {
                  if (selectedSegmentIndex === null) return
                  // Merge the backend's segment: the engine, the stored
                  // performance and the new audio all come from the response,
                  // never from what we asked for.
                  const u = updated as Record<string, any>
                  updateSegment(selectedSegmentIndex, {
                    engine: u.engine,
                    perf_path: u.perf_path,
                    perf_model_id: u.perf_model_id,
                    perf_denoise: u.perf_denoise,
                    audio_url: u.path ? `${u.path}?ts=${Date.now()}` : undefined,
                    committed_audio_url: u.path,
                    status: 'edited',
                    // Respeecher take metadata no longer describes this audio.
                    respeecher_takes: undefined,
                    respeecher_take_seeds: undefined,
                    respeecher_fits: undefined,
                    respeecher_duration: undefined,
                  })
                }}
              />
            </div>
          )}

          {rightPanelTab === 'seeds' && (
            <div className="flex-1 min-h-0 overflow-hidden bg-neutral-950">
              <SeedLibraryPanel
                entries={seedLibrary}
                isRegenerating={isRegenerating}
                selectedTranscriptIndex={
                  selectedSegmentIndex !== null
                    ? displaySegments[selectedSegmentIndex]?.transcript_index ?? null
                    : null
                }
                onJumpToSegment={(i) => {
                  selectSegment(i)
                  setCurrentTime(displaySegments[i]?.start_time ?? 0)
                }}
                onUse={(e) => {
                  // Recall renders the entry's OWN segment, not the selected one —
                  // the seed only reproduces its take against its own line.
                  handleGenerateSpeech(
                    e.segmentIndex, e.voice, undefined, undefined, 'respeecher',
                    { sampling_params: e.params ?? undefined, seed: e.seed },
                  )
                }}
                onToggleKept={(e, kept) => {
                  const prevHist = displaySegments[e.segmentIndex]?.respeecher_seed_history
                  updateSegment(e.segmentIndex, {
                    respeecher_seed_history: (prevHist ?? []).map(h =>
                      h.seed === e.seed ? { ...h, kept } : h),
                  })
                  apiClient.setSeedKept(jobId, e.transcriptIndex, e.seed, kept)
                    .catch((err) => {
                      console.warn('[SEEDS] lock toggle failed', err)
                      updateSegment(e.segmentIndex, { respeecher_seed_history: prevHist })
                    })
                }}
                onDelete={(e) => {
                  // Optimistic: the row disappears immediately, and a failed
                  // delete restores it rather than leaving a phantom gone.
                  const prevHist = displaySegments[e.segmentIndex]?.respeecher_seed_history
                  updateSegment(e.segmentIndex, {
                    respeecher_seed_history: (prevHist ?? []).filter(h => h.seed !== e.seed),
                  })
                  apiClient.deleteSeedHistoryEntry(jobId, e.transcriptIndex, e.seed)
                    .catch((err) => {
                      console.warn('[SEEDS] delete failed', err)
                      updateSegment(e.segmentIndex, { respeecher_seed_history: prevHist })
                    })
                }}
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
                onOpenCustomVoices={() => setRightPanelTab('testclips')}
                onVoiceAssigned={(speakerId, voiceId) => {
                  // Clear any per-segment staged voice overrides for this speaker so
                  // nothing shadows the assignment, then apply the voice to all of the
                  // speaker's segments atomically on the backend.
                  setStagedVoices(prev => {
                    const next = { ...prev }
                    displaySegments.forEach((seg) => {
                      if (seg.speaker_id === speakerId) delete next[getSegmentKey(seg)]
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
            const cur = { ...DEFAULT_NUANCES, ...seg?.nuances, ...stagedNuances[keyAt(nIdx)] }
            const setN = (key: keyof SegmentNuances, val: number) =>
              setStagedNuances(prev => ({ ...prev, [keyAt(nIdx)]: { ...prev[keyAt(nIdx)], [key]: val } }))
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
                  setStagedEmotions(prev => ({ ...prev, [keyAt(idx)]: emotion }))
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
          segmentKey={keyAt(characterProfileOpen.segmentIndex)}
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

      {/* MAKE MOVIE confirmation. Shown only when something is actually
          outstanding — a clean render never sees it.

          The three warnings are NOT equal, and the dialog says so:
            staged     an edit the user MADE that will be missing, because the
                       render assembles from committed segments only. This is
                       the one with teeth, so it gets a fix ("Save, then make
                       movie") rather than only a yes/no.
            unreviewed windows they simply have not opened yet. Harmless.
            failed     commits that did not land; already surfaced in the banner. */}
      {confirmRender && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
          role="dialog" aria-modal="true" aria-labelledby="confirm-render-title"
          onClick={() => setConfirmRender(null)}>
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <h2 id="confirm-render-title" className="text-base font-semibold text-slate-100">
              Make movie now?
            </h2>

            <div className="mt-3 space-y-2.5">
              {confirmRender.staged > 0 && (
                <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2.5">
                  <div className="text-xs font-semibold text-amber-200">
                    {confirmRender.staged} segment{confirmRender.staged === 1 ? '' : 's'} staged but not saved
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-amber-100/70">
                    These takes will be <strong>missing from the film</strong> — the render
                    uses saved segments only. Save first to include them.
                  </div>
                </div>
              )}

              {confirmRender.failed.length > 0 && (
                <div className="rounded-md border border-red-500/50 bg-red-500/10 p-2.5">
                  <div className="text-xs font-semibold text-red-200">
                    Segment{confirmRender.failed.length === 1 ? '' : 's'} {confirmRender.failed.join(', ')} failed to save
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-red-100/70">
                    These will not be in the film either.
                  </div>
                </div>
              )}

              {confirmRender.parked > 0 && (
                <div className="rounded-md border border-cyan-500/50 bg-cyan-950/40 p-2.5">
                  <div className="text-xs font-semibold text-cyan-200">
                    {confirmRender.parked} section{confirmRender.parked === 1 ? '' : 's'} still lifted to the layover track
                    {' '}({confirmRender.parkedSeconds.toFixed(1)}s of footage)
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-cyan-300/80">
                    The layover track is never rendered. This footage will be CUT from
                    the finished film, and the picture will hold a gap where it was.
                    Drag a section back down into the picture to keep it.
                  </div>
                </div>
              )}
              {confirmRender.unreviewed > 0 && (
                <div className="rounded-md border border-slate-600 bg-slate-800/60 p-2.5">
                  <div className="text-xs font-semibold text-slate-200">
                    {confirmRender.unreviewed} of {chunkCount} windows not reviewed yet
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    Your edits are already saved — this just means you have not been
                    through those windows. The film will still render.
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm"
                onClick={() => setConfirmRender(null)}
                className="h-8 text-xs text-slate-400">
                Cancel
              </Button>
              {confirmRender.staged > 0 && (
                <Button size="sm"
                  onClick={async () => {
                    setConfirmRender(null)
                    await handleSave()
                    handleRebuildVideo()
                  }}
                  className="h-8 text-xs bg-teal-600 hover:bg-teal-700 text-white">
                  Save, then make movie
                </Button>
              )}
              <Button size="sm"
                variant={confirmRender.staged > 0 ? 'outline' : 'default'}
                onClick={() => { setConfirmRender(null); handleRebuildVideo() }}
                className={cn('h-8 text-xs',
                  confirmRender.staged > 0
                    ? 'border-slate-600 text-slate-300'
                    : 'bg-teal-600 hover:bg-teal-700 text-white')}>
                {confirmRender.staged > 0 ? 'Make movie without them' : 'Make movie anyway'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <CustomVoicesModal
        open={customVoicesOpen}
        onOpenChange={setCustomVoicesOpen}
        onChanged={() => setCustomVoicesVersion(v => v + 1)}
      />

      <EmotionLibraryPopup
        open={emotionLibraryTarget !== null}
        onClose={() => setEmotionLibraryTarget(null)}
        onSelect={(value) => {
          const t = emotionLibraryTarget
          if (!t) return
          if (t.mode === 'stage') {
            // Stage as the segment's emotion (pill) — you then Generate.
            setStagedEmotions(prev => ({ ...prev, [keyAt(t.index)]: value }))
            selectSegment(t.index)
          } else {
            // Insert a [tag] into the write-in / Delivery Script draft.
            setCustomEmotionDrafts(prev => {
              const cur = (prev[t.index] ?? '').trim()
              return { ...prev, [t.index]: (cur ? cur + ' ' : '') + `[${value}]` }
            })
          }
        }}
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
                  const onUp = () => {
                    document.removeEventListener('mousemove', onMove)
                    document.removeEventListener('mouseup', onUp)
                    document.removeEventListener('pointercancel', onUp)
                    window.removeEventListener('blur', onUp)
                  }
                  document.addEventListener('mousemove', onMove)
                  document.addEventListener('mouseup', onUp)
                  document.addEventListener('pointercancel', onUp)
                  window.addEventListener('blur', onUp)
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
                {stagedVoices[keyAt(pitchPopupIndex)] && (
                  <span className="text-[10px] font-normal text-slate-400">
                    ({VOICE_OPTIONS.find(v => v.key === stagedVoices[keyAt(pitchPopupIndex)])?.label})
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
                  if (idx !== null) setStagedPitches(prev => ({ ...prev, [keyAt(idx)]: Math.max(-6, (prev[keyAt(idx)] ?? 0) - 1) }))
                  return idx
                })}
              >−</button>
              <span
                className={cn(
                  "text-4xl font-mono w-28 text-center cursor-pointer select-none transition-colors",
                  (stagedPitches[keyAt(pitchPopupIndex)] ?? 0) !== 0 ? "text-cyan-400" : "text-white"
                )}
                title="Click to reset"
                onClick={() => setStagedPitches(prev => { const n = { ...prev }; delete n[keyAt(pitchPopupIndex)]; return n })}
              >
                {(stagedPitches[keyAt(pitchPopupIndex)] ?? 0) > 0 ? '+' : ''}{stagedPitches[keyAt(pitchPopupIndex)] ?? 0}
                <span className="text-lg ml-1 text-slate-400">st</span>
              </span>
              <button
                type="button"
                className="h-9 w-9 rounded-full bg-slate-700 hover:bg-slate-600 text-white text-lg font-bold flex items-center justify-center transition-colors"
                onClick={() => setPitchPopupIndex(idx => {
                  if (idx !== null) setStagedPitches(prev => ({ ...prev, [keyAt(idx)]: Math.min(6, (prev[keyAt(idx)] ?? 0) + 1) }))
                  return idx
                })}
              >+</button>
            </div>

            {/* Slider */}
            <Slider
              value={[stagedPitches[keyAt(pitchPopupIndex)] ?? 0]}
              onValueChange={([v]) => setStagedPitches(prev => ({ ...prev, [keyAt(pitchPopupIndex)]: v }))}
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
                  if (idx !== null) setStagedSpeeds(prev => ({ ...prev, [keyAt(idx)]: Math.max(0.5, parseFloat(((prev[keyAt(idx)] ?? 1.0) - 0.1).toFixed(2))) }))
                  return idx
                })}
              >−</button>
              <span
                className={cn(
                  "text-4xl font-mono w-28 text-center cursor-pointer select-none transition-colors",
                  (stagedSpeeds[keyAt(speedPopupIndex)] ?? 1.0) !== 1.0 ? "text-orange-400" : "text-white"
                )}
                title="Click to reset"
                onClick={() => setStagedSpeeds(prev => { const n = { ...prev }; delete n[keyAt(speedPopupIndex)]; return n })}
              >
                {(stagedSpeeds[keyAt(speedPopupIndex)] ?? 1.0).toFixed(2)}
                <span className="text-lg ml-0.5 text-slate-400">×</span>
              </span>
              <button
                type="button"
                className="h-9 w-9 rounded-full bg-slate-700 hover:bg-slate-600 text-white text-lg font-bold flex items-center justify-center transition-colors"
                onClick={() => setSpeedPopupIndex(idx => {
                  if (idx !== null) setStagedSpeeds(prev => ({ ...prev, [keyAt(idx)]: Math.min(2.0, parseFloat(((prev[keyAt(idx)] ?? 1.0) + 0.1).toFixed(2))) }))
                  return idx
                })}
              >+</button>
            </div>

            {/* Slider */}
            <Slider
              value={[stagedSpeeds[keyAt(speedPopupIndex)] ?? 1.0]}
              onValueChange={([v]) => setStagedSpeeds(prev => ({ ...prev, [keyAt(speedPopupIndex)]: v }))}
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
                  onClick={() => setStagedSpeeds(prev => ({ ...prev, [keyAt(speedPopupIndex)]: preset }))}
                  className={cn(
                    'text-[10px] px-2 py-1 rounded-md border transition-colors font-mono',
                    (stagedSpeeds[keyAt(speedPopupIndex)] ?? 1.0) === preset
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
        ref={timelinePanelRef}
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
              {/* Timecode lives here rather than in the centred group: it is ~90px
                  of left-side weight that pushed everything after it off-centre. */}
              <span ref={timeDisplayRef} className="ml-2 text-sm font-mono text-slate-400 tabular-nums">
                {formatTime(currentTime)} / {formatTime(videoDuration)}
              </span>
            </div>
          </div>

          {/* Playback controls — absolute center */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
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
                    // Pause: stop the stitch source directly + sync the ref so the
                    // seek/effect races can't leave audio running under a paused video.
                    stopAllRptAudio()
                    videoRef.current.pause()
                    // Persist the playhead so UI that reads currentTime state sees the
                    // pause position, not the last 1s snapshot.
                    setCurrentTime(currentTimeRef.current)
                  } else {
                    // Clear any stuck scrub flag. It halts the rAF loop entirely, so
                    // recovering by pressing play beats making the user reload.
                    isDraggingNeedleRef.current = false
                    // Play from the PLAYHEAD, always. The playhead marks the spot.
                    //
                    // This used to snap to the selected segment whenever the playhead
                    // sat outside it, so that pressing play again re-auditioned the
                    // line. The cost was that parking the playhead in a silent stretch
                    // and pressing play jumped to the selected line instead — which
                    // makes timing a dub against picture impossible, because the quiet
                    // run-up to a line is exactly the part you need to watch.
                    //
                    // Auditioning one line still works: clicking a segment seeks to it,
                    // and play then starts there.
                    const _from = currentTime
                    lastStartPosRef.current = _from  // save start pos for Stop
                    rptCancelRef.current = false     // allow the stitch to (re)schedule
                    const sourceFrom = timelineToSourceTime(_from, scenesRef.current) ?? _from
                    videoRef.current.currentTime = sourceFrom
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
                audioStartTimeRef.current = audioContextRef.current?.currentTime ?? null
                // If in Preview and buffer not ready, stitch first
                if (playbackMode === 'preview' && !isPlaying && !rptBufferRef.current) {
                  lastStartPosRef.current = currentTime
                  const ctx = audioContextRef.current
                  const resolved = displaySegmentsRef.current.map(seg => ({
                    ...seg,
                    audio_url: apiClient.refreshAudioUrl(jobId, seg.audio_url),
                    committed_audio_url: apiClient.refreshAudioUrl(jobId, seg.committed_audio_url),
                  }))
                  stitchWith(resolved, ctx).then(result => {
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
                : <Play className={playbackMode === 'preview' ? 'h-4 w-4 text-amber-400' : 'h-4 w-4'} />
              }
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => {
                const returnTo = lastStartPosRef.current
                // Kill EVERY audio source and sync isPlayingRef SYNCHRONOUSLY before
                // moving currentTime. Otherwise the video's 'seeked' handler (which
                // reads isPlayingRef, still true until the next render) restarts the
                // stitch — the "press Stop, it keeps playing" bug.
                stopAllRptAudio()
                setIsPlaying(false)
                if (videoRef.current) {
                  videoRef.current.pause()
                  const sourceReturn = timelineToSourceTime(returnTo, scenesRef.current) ?? returnTo
                  videoRef.current.currentTime = sourceReturn
                }
                setCurrentTime(returnTo)
              }}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentTime(videoDuration)}>
              <SkipForward className="h-4 w-4" />
            </Button>

            <div className="w-px h-5 bg-neutral-700 mx-1" />

            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-neutral-300 hover:text-white gap-1"
              onClick={handleSplitSceneAtPlayhead}
              title="Split the current video scene at the playhead"
            >
              <span>✂️</span> Scene
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
            <button
              type="button"
              onClick={() => {
                const next = !followPlayhead
                setFollowPlayhead(next)
                localStorage.setItem('dubverse.editor.followPlayhead', next ? '1' : '0')
              }}
              title={followPlayhead
                ? 'Following always — the timeline also re-centres on seeks and jumps while paused. Turn it off to keep the view still while editing.'
                : 'Following during playback only — the timeline stays where you put it while paused. Turn it on to re-centre on seeks too.'}
              className={cn(
                'h-7 px-2 rounded text-[11px] font-medium transition-colors whitespace-nowrap',
                followPlayhead
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent',
              )}
            >
              {followPlayhead ? '⇢ always' : '⇢ on play'}
            </button>
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
        
        {/* Chunk bar — the lens over a long film. One 5-minute window is shown
            at a time, so a 2-hour job edits as 24 windows instead of a single
            timeline nobody can navigate. Only appears when the film is long
            enough to need it; short jobs behave exactly as before. */}
        {chunkMode && (
          <div ref={chunkBarRef} className="shrink-0 flex items-center gap-2 border-t border-neutral-800 bg-neutral-950 px-3 py-2 overflow-x-auto">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Chunks
            </span>
            {Array.from({ length: chunkCount }, (_, i) => {
              const isActive = currentChunk === i
              // saved = committed to the film. staged = edits waiting in this
              // browser. Anything else has not been touched.
              const persisted = chunkStatusMap[String(i)]
              const isStagedHere = isActive && stagedEditCount > 0
              // Amber while you are changing a segment in this window, green
              // once you have moved on from it. Unsaved staged work outranks
              // both — it is the one state that can still be lost.
              // Amber the moment you land on a segment here, not only once you
              // change it — the point is knowing which window you are working
              // in the instant you click.
              const editingHere = selectedSegmentIndex !== null
                && findChunkForTime(segStartOf(displaySegments[selectedSegmentIndex])) === i
              const state: 'staged' | 'saved' | 'unedited' =
                isStagedHere ? 'staged'
                  : persisted === 'saved' || completedChunks.has(i) ? 'saved'
                    : editingHere ? 'staged'
                      : 'unedited'
              const from = chunkBoundaries[i]
              const to = chunkBoundaries[i + 1]
              const progress = isActive
                ? Math.min(1, Math.max(0, (currentTime - from) / (to - from)))
                : 0
              const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
              return (
                <button
                  key={i}
                  onClick={() => requestChunkSwitch(i)}
                  title={`${mmss(from)} – ${mmss(to)}${
                    state === 'staged' ? ' · unsaved edits' : state === 'saved' ? ' · saved' : ''
                  }`}
                  className={cn(
                    "relative shrink-0 overflow-hidden rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    isActive
                      ? "border-amber-400 bg-amber-500/15 text-amber-200"
                      : "border-neutral-700 text-slate-400 hover:border-amber-500/40 hover:text-slate-200",
                  )}
                >
                  <span
                    className="absolute inset-y-0 left-0 bg-amber-500/25"
                    style={{ width: `${progress * 100}%` }}
                    {...(isActive ? { 'data-active-chunk-fill': '' } : {})}
                  />
                  <span className="relative flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        state === 'staged' ? "bg-amber-400"
                          : state === 'saved' ? "bg-emerald-400"
                          : "bg-neutral-600",
                      )}
                    />
                    {mmss(from)}
                  </span>
                </button>
              )
            })}
            <span className="ml-auto shrink-0 text-[11px] text-slate-500">
              {activeChunk !== null && `Window ${activeChunk + 1} of ${chunkCount}`}
            </span>
          </div>
        )}

        {/* Timeline tracks */}
        <div className="flex-1 flex overflow-hidden">
          {/* QC Monitor - permanent fixture left of timeline tracks */}
          <div ref={qcMonitorRef} className="shrink-0 border-r border-neutral-700 bg-neutral-950 flex flex-col overflow-hidden relative" style={{ width: qcMonitorWidth }}>
              {/* Resize handle - right edge */}
              <div
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-amber-500/50 transition-colors z-20 group"
                onMouseDown={(e) => {
                  e.preventDefault()
                  const startX = e.clientX
                  const startW = qcMonitorWidth
                  let finalW = qcMonitorWidth
                  setIsResizingQcMonitor(true)
                  const onMove = (ev: MouseEvent) => {
                    const delta = ev.clientX - startX
                    const next = Math.max(200, Math.min(600, startW + delta))
                    finalW = next
                    if (qcMonitorRef.current) {
                      qcMonitorRef.current.style.width = `${next}px`
                    }
                  }
                  const onUp = () => {
                    setIsResizingQcMonitor(false)
                    setQcMonitorWidth(finalW)
                    localStorage.setItem('dubverse.editor.qcMonitorWidth', String(finalW))
                    document.removeEventListener('mousemove', onMove)
                    document.removeEventListener('mouseup', onUp)
                    document.removeEventListener('pointercancel', onUp)
                    window.removeEventListener('blur', onUp)
                  }
                  document.addEventListener('mousemove', onMove)
                  document.addEventListener('mouseup', onUp)
                  document.addEventListener('pointercancel', onUp)
                  window.addEventListener('blur', onUp)
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
          <div ref={trackLabelRef} className="shrink-0 border-r border-neutral-700 bg-neutral-900/80 flex flex-col relative overflow-hidden" style={{ width: trackLabelWidth }}>
            {/* Resize handle - right edge */}
            <div
              className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-amber-500/50 transition-colors z-20 group"
              onMouseDown={(e) => {
                e.preventDefault()
                const startX = e.clientX
                const startW = trackLabelWidth
                let finalW = trackLabelWidth
                setIsResizingTrackLabel(true)
                const onMove = (ev: MouseEvent) => {
                  const delta = ev.clientX - startX
                  const next = Math.max(60, Math.min(280, startW + delta))
                  finalW = next
                  if (trackLabelRef.current) {
                    trackLabelRef.current.style.width = `${next}px`
                  }
                }
                const onUp = () => {
                  setIsResizingTrackLabel(false)
                  setTrackLabelWidth(finalW)
                  localStorage.setItem('dubverse.editor.trackLabelWidth', String(finalW))
                  document.removeEventListener('mousemove', onMove)
                  document.removeEventListener('mouseup', onUp)
                  document.removeEventListener('pointercancel', onUp)
                  window.removeEventListener('blur', onUp)
                }
                document.addEventListener('mousemove', onMove)
                document.addEventListener('mouseup', onUp)
                document.addEventListener('pointercancel', onUp)
                window.addEventListener('blur', onUp)
              }}
            >
              <div className={cn(
                "absolute inset-y-0 right-0 w-0.5 bg-amber-500/30 group-hover:bg-amber-500",
                isResizingTrackLabel && "bg-amber-500"
              )} />
            </div>
            {/* Each spacer/label MUST match its track height exactly */}
            <div className="h-6 shrink-0 border-b border-neutral-800 bg-neutral-900" />
            {/* Layover — where sections lifted out of the picture are parked. */}
            <div className="h-20 shrink-0 flex items-center px-2 text-xs text-cyan-400/80 border-b border-neutral-800 gap-1">
              <span className="truncate">Layover</span>
              {parkedScenes.length > 0 && (
                <span className="text-[9px] px-1 rounded bg-cyan-500/20 border border-cyan-500/40">{parkedScenes.length}</span>
              )}
            </div>
            <div className="h-5 shrink-0 border-b border-neutral-800 bg-neutral-900" />
            <div className="h-20 shrink-0 flex items-center px-2 text-xs text-neutral-400 border-b border-neutral-800">Video</div>
            <div className="h-20 shrink-0 flex flex-col justify-center px-2 text-xs text-neutral-400 border-b border-neutral-800 gap-1">
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
              <div className="h-20 shrink-0 flex flex-col justify-center px-2 text-xs border-b border-amber-800/40 gap-0.5 bg-amber-950/20">
                <span className="truncate text-amber-400/80 font-medium">Reference</span>
                {referenceDetectedLang && (
                  <span className="text-[10px] text-neutral-500 uppercase">{referenceDetectedLang}</span>
                )}
              </div>
            )}

            <div className="h-20 shrink-0 flex flex-col justify-center px-2 text-xs text-neutral-400 border-b border-neutral-800 gap-1">
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
            className="flex-1 overflow-x-auto overflow-y-auto flex flex-col"
            // overflowAnchor none: the browser re-adjusts a scroll container to keep
            // shifting content visually stable. On a timeline that is wrong — moving a
            // segment made the whole view chase it, so the block never appeared to
            // move relative to the ruler. The timeline is the fixed reference; only
            // the segment moves within it.
            style={{ overflowAnchor: 'none' }}
            // Track labels live in a SEPARATE column, so scrolling the tracks
            // vertically without moving the labels would slide every name out of
            // line with its track — the same desync that makes track heights have
            // to be changed in both places. Mirror the scroll instead of trying to
            // merge the two columns, which would mean rebuilding the whole header.
            onScroll={(e) => {
              const top = (e.currentTarget as HTMLElement).scrollTop
              if (trackLabelRef.current) trackLabelRef.current.scrollTop = top
              // The overview thumb reads scrollLeft straight from the DOM, which
              // React cannot observe — nudge it to redraw. Skipped mid-pan: the pan
              // updates the thumb itself from numbers it already has, and measuring
              // here as well cost a second forced layout on every pointermove.
              if (!panningRef.current) syncOverviewThumb()
            }}
          >
            {/* The whole timeline is a context-menu target, so right-click works on empty
                track space, the ruler, and past the last block — not only on a row or a
                scene. Rows and blocks stop propagation, so the innermost one still wins;
                this is the fallback beneath them. It acts on the SELECTED segment, which
                is also what the playhead-based actions in the menu already assume. */}
            <SegmentContextMenu
              index={timelineCtxIndex}
              segmentKey={displaySegments[timelineCtxIndex] ? getSegmentKey(displaySegments[timelineCtxIndex]) : ''}
              lockedSegments={lockedSegments}
              lockedPairs={lockedPairs}
              stagedEmotions={stagedEmotions}
              emotions={EMOTIONS}
              onSelect={(idx) => { selectSegment(idx); setContextSegmentIndex(idx) }}
              onSplit={handleSplitAtPlayhead}
              onSplitAtWord={(idx) => setSplitWordMode(idx)}
              onAddAfter={handleAddSegmentAfter}
              onMerge={handleMergeWithNext}
              canMergeNext={canMergeWithNext(timelineCtxIndex)}
              onDelete={(idx) => setPendingDelete(idx)}
              onToggleLock={(idx) => setSegmentLocked(idx, !lockedSegments.has(keyAt(idx)))}
              onLockScene={(idx) => { setSceneLockMode(true); setSceneAnchor(idx); setSceneRange({ start: idx, end: idx }) }}
              onUnlockScene={(idx) => unlockScene(idx)}
              onTogglePair={togglePairWithNext}
              onRevert={revertToOriginal}
              onUndoLastEdit={handleUndoLastEdit}
              onUndoSplit={handleUndoSplit}
              onCopyText={handleCopyText}
              onPasteText={handlePasteText}
              onClearSegment={handleClearSegment}
              onSetEmotion={(idx, emotion) => setStagedEmotions(prev => ({ ...prev, [keyAt(idx)]: emotion }))}
              onClearEmotion={(idx) => {
                setStagedEmotions(prev => ({ ...prev, [keyAt(idx)]: '' }))
                updateSegment(idx, { committed_emotion: null })
                setImportedSegments(prev => prev ? prev.map((seg, i) => i === idx ? { ...seg, committed_emotion: null } : seg) : prev)
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
              className="flex flex-col min-h-full relative"
              style={{ minWidth: timelineWidth, width: '100%' }}
              data-timeline-container
              // Grab empty track space to pan left and right.
              //
              // Only where nothing else claimed the press: blocks, handles and
              // grips all stopPropagation, so this cannot steal a segment drag or
              // a fade. The cursor stays a plain pointer deliberately — a
              // multi-direction move cursor says the thing under it will be moved,
              // and what actually moves is the view.
              onPointerDown={(e) => {
                if (e.button !== 0) return
                const tgt = e.target as HTMLElement
                // The needle scrubs when grabbed. Panning at the same time dragged
                // the playhead and the view in opposite directions at once — the
                // needle moving WITH a pan is fine, being dragged BY one is not.
                // Scene blocks and boundary handles drag on MOUSEDOWN, and this pan
                // listens on POINTERDOWN — which fires first, so their
                // stopPropagation on the mouse event cannot stop it. Both ran at
                // once: the scene moved right by dx while the view panned left by
                // dx, and the block looked welded in place. Exclusion by name is
                // the only thing that separates them.
                if (tgt.closest('[data-playhead-handle], [data-fade-handle], [data-scene-handle], [data-scene-block], [data-parked-clip], [data-resize-handle], [data-segment-block]')) return
                const tl = timelineRef.current
                if (!tl) return
                const startX = e.clientX
                const startScroll = tl.scrollLeft
                // Measure ONCE. Content width and viewport width cannot change
                // during a drag, and reading them per move — right after writing
                // scrollLeft — forced a synchronous layout every time and left the
                // timeline lagging behind the cursor instead of tracking it.
                const total = Math.max(1, tl.scrollWidth)
                const view = tl.clientWidth
                const maxScroll = Math.max(0, total - view)
                const frac = Math.min(1, view / total)
                const thumb = overviewThumbRef.current
                let panned = false
                const onMove = (ev: PointerEvent) => {
                  // No buttons held means the release was missed — the browser fires
                  // pointercancel instead of pointerup when it takes over a gesture on
                  // a scrollable element, and the drag then latched on after mouse-up.
                  if (ev.buttons === 0) { onUp(); return }
                  const dx = ev.clientX - startX
                  // A few pixels of slop so a click still reads as a click.
                  if (!panned && Math.abs(dx) < 4) return
                  if (!panned) { panned = true; panningRef.current = true }
                  // Clamp here rather than setting and reading back what the browser
                  // clamped to — the read is what costs the layout.
                  const next = Math.max(0, Math.min(maxScroll, startScroll - dx))
                  tl.scrollLeft = next
                  if (thumb && maxScroll > 0) {
                    thumb.style.left = `${(next / maxScroll) * (1 - frac) * 100}%`
                  }
                }
                function onUp() {
                  panningRef.current = false
                  document.removeEventListener('pointermove', onMove)
                  document.removeEventListener('pointerup', onUp)
                  document.removeEventListener('pointercancel', onUp)
                  window.removeEventListener('blur', onUp)
                }
                document.addEventListener('pointermove', onMove)
                document.addEventListener('pointerup', onUp)
                document.addEventListener('pointercancel', onUp)
                // Alt-tabbing away mid-drag also never delivers a release.
                window.addEventListener('blur', onUp)
              }}
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
                  const sourceTime = timelineToSourceTime(newTime, scenes)
                  videoRef.current.currentTime = sourceTime ?? newTime
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
              {/* No background grid. It was a 3-level 10s/5s/1s gradient across the
                  whole timeline, but zoomed out the 1s level lands a line every ~12px
                  and reads as grey striping, and at z-20 it hatched the picture too —
                  which is the one thing that has to stay clean when you are reading
                  frames for sync. The rulers carry the scale instead. */}

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


      {parkedMenu && (
        <div
          className="fixed z-[70] bg-slate-800 border border-slate-700 rounded-md shadow-lg overflow-hidden"
          style={{ left: `${parkedMenu.x}px`, top: `${parkedMenu.y}px` }}
          onMouseLeave={() => setParkedMenu(null)}
        >
          <button
            type="button"
            onClick={() => {
              // Back in at the playhead: the picture from there on shifts right by
              // its duration, so nothing already in sync is overwritten.
              restoreScene(parkedMenu.sceneId, currentTimeRef.current)
              persistScenes().catch(err => console.warn('[RESTORE]', err))
              setParkedMenu(null)
            }}
            className="w-full text-left px-3 py-2 text-xs text-cyan-300 hover:bg-slate-700 whitespace-nowrap"
          >
            ⬇ Put back at playhead
          </button>
          <button
            type="button"
            onClick={() => {
              removeScene(parkedMenu.sceneId)
              persistScenes().catch(err => console.warn('[DISCARD]', err))
              setParkedMenu(null)
            }}
            className="w-full text-left px-3 py-2 text-xs text-red-300 hover:bg-slate-700 whitespace-nowrap"
          >
            🗑 Discard this section
          </button>
          <button
            type="button"
            onClick={() => setParkedMenu(null)}
            className="w-full text-left px-3 py-2 text-xs text-slate-400 hover:bg-slate-700 whitespace-nowrap"
          >
            Cancel
          </button>
        </div>
      )}

      {sceneMenu && (() => {
        // Parked scenes are on the layover track, not in the picture, so they
        // don't count as a neighbour for undoing a split.
        const _sorted = [...scenes].filter(sc => !sc.parked).sort((a, b) => a.start - b.start)
        const _idx = _sorted.findIndex(sc => sc.id === sceneMenu.sceneId)
        // Any in-picture scene that has at least one other in-picture neighbour
        // can have a cut removed. If there is a scene before it, merge into that;
        // otherwise merge the next scene into this one.
        const _hasPrev = _idx > 0
        const _hasNext = _idx >= 0 && _idx < _sorted.length - 1
        const _canMerge = _hasPrev || _hasNext
        return (
          <div
            className="fixed z-[70] bg-slate-800 border border-slate-700 rounded-md shadow-lg overflow-hidden"
            style={{ left: `${sceneMenu.x}px`, top: `${sceneMenu.y}px` }}
            onMouseLeave={() => setSceneMenu(null)}
          >
            <button
              type="button"
              disabled={!_canMerge}
              onClick={() => {
                if (_hasPrev) {
                  mergeSceneWithPrevious(sceneMenu.sceneId)
                } else if (_hasNext) {
                  mergeSceneWithNext(sceneMenu.sceneId)
                }
                persistScenes()
                  .catch(err => console.warn('[UNDO-SPLIT]', err))
                // Drop any undo entry for this split — it has just been undone by
                // hand, and leaving it would make the next global undo dissolve a
                // boundary the user never asked about.
                undoStack.current = undoStack.current.filter(
                  en => !(en.kind === 'scene-split' && en.sceneId === sceneMenu.sceneId))
                setSceneMenu(null)
              }}
              className={cn('w-full text-left px-3 py-2 text-xs whitespace-nowrap',
                _canMerge ? 'text-amber-300 hover:bg-slate-700' : 'text-slate-600 cursor-not-allowed')}
            >
              ✂ Undo video split — {_hasPrev ? 'merge into previous' : 'merge next into this'}
            </button>
            <button
              type="button"
              onClick={() => {
                updateScene(sceneMenu.sceneId, { video_fade_in: 0, video_fade_out: 0 })
                persistScenes()
                  .catch(err => console.warn('[SCENE-FADE]', err))
                setSceneMenu(null)
              }}
              className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 whitespace-nowrap"
            >
              Clear fades
            </button>
            <button
              type="button"
              onClick={() => setSceneMenu(null)}
              className="w-full text-left px-3 py-2 text-xs text-slate-400 hover:bg-slate-700 whitespace-nowrap"
            >
              Cancel
            </button>
          </div>
        )
      })()}

      {/* Scene-lock band: the picked run, pulsing, with the LOCK action in
                  the middle. Positioned in absolute time like every other timeline
                  overlay, so it lines up with the blocks it is describing. */}
              {sceneLockMode && sceneRange && displaySegments[sceneRange.start] && displaySegments[sceneRange.end] && (() => {
                const _s = effStart(displaySegments[sceneRange.start])
                const _e = effEnd(displaySegments[sceneRange.end])
                const _left = _s * PIXELS_PER_SECOND
                const _width = Math.max(8, (_e - _s) * PIXELS_PER_SECOND)
                const _count = sceneRange.end - sceneRange.start + 1
                return (
                  <div
                    className="absolute top-0 bottom-0 z-40 rounded-md border-2 border-emerald-400/70 bg-emerald-400/15 animate-pulse pointer-events-none"
                    style={{ left: _left, width: _width }}
                  >
                    <div className="absolute inset-0 flex items-center justify-center">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); lockScene(sceneRange.start, sceneRange.end) }}
                        title={_count + ' segment(s) — click to freeze their position. They keep playing, and voice, emotion and speed can still be changed.'}
                        className="pointer-events-auto px-4 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold tracking-widest uppercase shadow-lg"
                      >
                        🔒 Lock {_count > 1 ? _count + ' segments' : 'segment'}
                      </button>
                    </div>
                  </div>
                )
              })()}

              {/* Time ruler — taller, 3-level ticks matching Vegas style */}

{/* Video track with thumbnails - tiled background preserves aspect ratio */}
              {/* Layover track. Sits ABOVE the picture: a section that will not sync gets
                  lifted here, the surrounding footage closes up, and it can be dropped back
                  or discarded once the sync around it is settled. A parked scene is drawn
                  directly above the hole it left so the relationship stays obvious. */}
              <div
                ref={layoverTrackRef}
                className="h-20 shrink-0 bg-cyan-950/20 border-b border-cyan-800/40 relative overflow-hidden"
                data-timeline-track
              >
                {/* CEILING OF THE WORKING AREA.
                    A clip is dragged between the parking bay and the picture, and
                    nothing marked where that region began or ended — the drop target
                    was invisible and had to be learned. This is the top edge: above
                    it there is nothing to drop onto. Drawn inside the track so it
                    spans the whole timeline width and scrolls with it. */}
                <div
                  className="absolute top-0 left-0 right-0 h-[2px] bg-cyan-400/70 pointer-events-none z-20"
                  style={{ boxShadow: `0 0 6px rgba(34,211,238,0.45)` }}
                />
                {parkedScenes.length === 0 && (
                  <div className="absolute inset-0 flex items-center pl-3 text-[10px] text-cyan-600/50 pointer-events-none">
                    Lift a scene here to take it out of the picture without losing it
                  </div>
                )}
                {parkedScenes.map((sc) => {
                  const dur = (sc.source_end ?? sc.end) - (sc.source_start ?? sc.start)
                  const w = Math.max(60, dur * PIXELS_PER_SECOND)
                  const left = (sc.layover_time ?? sc.parked_from_start ?? sc.start) * PIXELS_PER_SECOND
                  const isDragging = draggingParkedId === sc.id
                  return (
                    <div
                      key={sc.id}
                      data-parked-clip
                      draggable={false}
                      className="absolute top-2 bottom-2 rounded border-2 border-cyan-400/70 hover:border-cyan-300 bg-neutral-950 overflow-hidden flex items-center justify-center cursor-move select-none shadow-lg shadow-black/60"
                      onDragStart={(e) => { e.preventDefault() }}
                      style={{
                        left,
                        width: w,
                        zIndex: isDragging ? 50 : undefined,
                      }}
                      title={`Parked — ${dur.toFixed(2)}s of footage. Drag down to the picture to restore, or drag left/right to move.`}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setParkedMenu({ x: e.clientX, y: e.clientY, sceneId: sc.id })
                      }}
                      // Pointer drag with capture, exactly as the scene blocks do it.
                      // On mousedown the pan (which listens on POINTERDOWN) had already
                      // claimed the gesture, so the timeline scrolled while the clip
                      // transformed — the two moved opposite ways and the clip appeared
                      // to slide away from the cursor.
                      onPointerDown={(e) => {
                        if (e.button !== 0) return
                        e.preventDefault()
                        e.stopPropagation()
                        const startX = e.clientX
                        const startY = e.clientY
                        // Move the clip by writing transform straight to the element.
                        // Through state this re-rendered the whole editor on every
                        // mousemove — the same mistake as the fade handles, the scene
                        // fades, the overview thumb and the pan. During a drag, write
                        // only; React finds out when the drag ends.
                        const el = e.currentTarget as HTMLElement
                        const pointerId = e.pointerId
                        try { el.setPointerCapture(pointerId) } catch {}
                        let dx = 0
                        let dy = 0
                        // THE BOUNDARIES ARE REAL, NOT DECORATION.
                        // Measured once on the way down: the ceiling is the top of the
                        // parking bay, the floor is the bottom of the picture. The clip
                        // is clamped so no part of it can leave that band. There is
                        // nothing above or below to drop onto, so dragging out there
                        // only ever produced a drop that snapped back unexplained.
                        const elRect = el.getBoundingClientRect()
                        const ceilRect = layoverTrackRef.current?.getBoundingClientRect()
                        const floorRect = videoTrackRef.current?.getBoundingClientRect()
                        const ceilY = ceilRect ? ceilRect.top : elRect.top
                        const floorY = floorRect ? floorRect.bottom : elRect.bottom
                        const minDy = ceilY - elRect.top
                        const maxDy = floorY - elRect.bottom
                        let lastY = startY
                        // Same clipping problem in reverse: dropping back into the
                        // picture meant crossing a boundary both tracks clip, so the
                        // clip vanished behind the edge on the way down.
                        const vTrack = videoTrackRef.current
                        const lTrack = layoverTrackRef.current
                        if (vTrack) vTrack.style.overflow = 'visible'
                        if (lTrack) lTrack.style.overflow = 'visible'
                        el.style.zIndex = '60'
                        el.style.cursor = 'grabbing'
                        el.style.boxShadow = '0 10px 28px rgba(0,0,0,0.85)'
                        el.style.outline = '2px solid rgba(34,211,238,0.9)'
                        el.style.willChange = 'transform'
                        setDraggingParkedId(sc.id)
                        const onMove = (ev: PointerEvent) => {
                          if (ev.buttons === 0) { finish(lastY); return }
                          // Never past the start of the film either: a negative
                          // layover_time puts the clip off the front of the track.
                          dx = Math.max(-left, ev.clientX - startX)
                          dy = Math.min(maxDy, Math.max(minDy, ev.clientY - startY))
                          lastY = ev.clientY
                          el.style.transform = `translate(${dx}px, ${dy}px)`
                        }
                        function finish(dropY: number) {
                          try { el.releasePointerCapture(pointerId) } catch {}
                          el.style.transform = ''
                          el.style.zIndex = ''
                          el.style.cursor = ''
                          el.style.boxShadow = ''
                          el.style.outline = ''
                          el.style.willChange = ''
                          if (vTrack) vTrack.style.overflow = ''
                          if (lTrack) lTrack.style.overflow = ''
                          setDraggingParkedId(null)
                          document.removeEventListener('pointermove', onMove)
                          document.removeEventListener('pointerup', onUp)
                          document.removeEventListener('pointercancel', onUp)
                          window.removeEventListener('blur', onBlur)
                          const videoRect = videoTrackRef.current?.getBoundingClientRect()
                          // Dragged down into the picture track: restore it to its hole.
                          if (videoRect && dropY >= videoRect.top && dropY < videoRect.bottom) {
                            restoreScene(sc.id)
                            persistScenes().catch(err => console.warn('[RESTORE]', err))
                            return
                          }
                          // Still in the layover track: remember where it was dropped.
                          const newLeft = Math.max(0, left + dx)
                          updateScene(sc.id, { layover_time: newLeft / PIXELS_PER_SECOND })
                          persistScenes().catch(err => console.warn('[PARK-MOVE]', err))
                        }
                        const onUp = (ev: PointerEvent) => finish(ev.clientY)
                        const onBlur = () => finish(lastY)
                        document.addEventListener('pointermove', onMove)
                        document.addEventListener('pointerup', onUp)
                        document.addEventListener('pointercancel', onUp)
                        window.addEventListener('blur', onBlur)
                      }}
                    >
                      {/* THE LIFTED FOOTAGE, CARRIED WITH THE CLIP.
                          A translucent cyan wash showed nothing of what had been lifted,
                          so a section in the layover track was indistinguishable from an
                          empty slot — you could not see what you were holding. The clip
                          now shows the frames it actually contains, over an opaque black
                          bed so nothing of the track behind bleeds through.

                          The strip is the SAME continuous filmstrip used by the picture
                          row, shifted left by this scene's source start and clipped to
                          the block, so the frames on the clip are the frames it came
                          from. No second extraction, and it stays correct when the strip
                          is regenerated. */}
                      {videoThumbnails.length > 0 && (
                        <div
                          className="absolute inset-0 flex pointer-events-none"
                          style={{
                            left: -((sc.source_start ?? sc.start) * PIXELS_PER_SECOND),
                            width: videoDuration * PIXELS_PER_SECOND,
                          }}
                        >
                          {videoThumbnails.map((thumb, ti) => (
                            <div
                              key={ti}
                              className="h-full flex-shrink-0"
                              style={{
                                width: `${(videoDuration / videoThumbnails.length) * PIXELS_PER_SECOND}px`,
                                backgroundImage: `url(${thumb})`,
                                backgroundSize: 'auto 100%',
                                backgroundPosition: '0% 50%',
                                backgroundRepeat: 'repeat-x',
                              }}
                            />
                          ))}
                        </div>
                      )}
                      <span className="relative z-10 text-[10px] text-cyan-100 font-semibold px-1.5 py-0.5 rounded bg-black/75 truncate pointer-events-none">
                        {dur.toFixed(1)}s
                      </span>
                    </div>
                  )
                })}
              </div>
              {/* Ruler between the parking bay and the picture. The top ruler is
                  a long way up now that the layover track sits under it, and
                  aligning a cut to a timecode means reading the scale next to the
                  footage rather than across two tracks. */}
              <TimeRuler durationSec={videoDuration} pps={PIXELS_PER_SECOND} variant="mid" />
              <div ref={videoTrackRef} className="h-20 shrink-0 bg-neutral-900/30 border-b border-neutral-700 relative overflow-hidden" data-timeline-track>
                {/* FLOOR OF THE WORKING AREA. The bottom edge of the picture: below
                    it is audio, which a video clip cannot be dropped onto. Together
                    with the ceiling above the parking bay these two lines bound the
                    region a clip travels in, so the gesture reads before you make it
                    rather than after. */}
                <div
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-400/70 pointer-events-none z-20"
                  style={{ boxShadow: `0 0 6px rgba(52,211,153,0.45)` }}
                />
                {/* THE HOLE A LIFTED SECTION LEAVES.
                    The filmstrip is one continuous run of thumbnails across the whole
                    duration — it is not built from scenes — so removing a scene block
                    does not break the picture and lifting looked like it had done
                    nothing. This masks the span the footage came from, which is what
                    makes the gap legible as working space: the point of lifting is to
                    open a hole and adjust the footage either side of it before the cut
                    goes back in or is discarded. Sits above the strip, below the scene
                    blocks, and takes no pointer events so the track still pans. */}
                {parkedScenes.map(sc => {
                  const gs = sc.parked_from_start ?? sc.start
                  const ge = sc.parked_from_end ?? sc.end
                  const gw = Math.max(2, (ge - gs) * PIXELS_PER_SECOND)
                  return (
                    <div
                      key={`hole-${sc.id}`}
                      className="absolute top-0 bottom-0 bg-black border-x-2 border-dashed border-cyan-500/70 z-[15] pointer-events-none flex items-center justify-center"
                      style={{ left: gs * PIXELS_PER_SECOND, width: gw }}
                      title={`Lifted — ${(ge - gs).toFixed(2)}s held in the layover track`}
                    >
                      <span className="text-[9px] text-cyan-400/80 uppercase tracking-widest whitespace-nowrap px-1">lifted</span>
                    </div>
                  )
                })}
                {/* THE CUT ITSELF. A splice is the most consequential edit on this
                    track, and until now it was implied by two scene blocks happening
                    to abut — nothing actually marked the frame it was made on. This
                    runs the full height of the picture so it cannot be mistaken for a
                    ruler tick or a block edge, and the black shadow keeps it readable
                    over both bright and dark thumbnails. Above the blocks, and inert
                    to the pointer so it never intercepts a drag. */}
                {scenes
                  .filter(sc => !sc.parked && sc.start > 0.01)
                  .map(sc => {
                    const sorted = [...scenes].filter(s => !s.parked).sort((a, b) => a.start - b.start)
                    const idx = sorted.findIndex(s => s.id === sc.id)
                    const prev = idx > 0 ? sorted[idx - 1] : null
                    return (
                      <div
                        key={`cut-${sc.id}`}
                        className="absolute top-0 bottom-0 w-[2px] z-[16] pointer-events-auto cursor-pointer hover:w-[4px] hover:bg-amber-400 transition-all"
                        style={{
                          left: sc.start * PIXELS_PER_SECOND - 1,
                          backgroundColor: '#b45309',
                          boxShadow: '0 0 0 1px rgba(0,0,0,0.95), 0 0 7px 2px rgba(0,0,0,0.85)',
                        }}
                        title={`Cut at ${formatTime(sc.start)} — click to undo`}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          // A click on the cut line itself removes the boundary. If there is a
                          // previous scene, merge this scene into it; otherwise this is the first
                          // cut and we merge the next scene into the first one.
                          if (prev) {
                            mergeSceneWithPrevious(sc.id)
                          } else if (sorted.length > 1) {
                            mergeSceneWithNext(sc.id)
                          }
                          persistScenes().catch(err => console.warn('[UNDO-CUT]', err))
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setSceneMenu({ x: e.clientX, y: e.clientY, sceneId: sc.id })
                        }}
                      />
                    )
                  })}
                {/* Scene blocks + fade handles */}
                {/* Full height, not a 24px strip at the top. The blocks are the
                    handle for the picture — grabbing one only worked along its very
                    top edge, which is why the move cursor appeared nowhere else. The
                    block art is a 10% wash, so covering the track does not hide the
                    filmstrip underneath. */}
                <div className="absolute inset-0 z-10">
                  {scenes.map((scene, idx) => {
                    // A LIFTED SCENE IS NOT IN THE PICTURE. Without this it kept
                    // drawing its block here at the old position while also showing
                    // in the layover track, so lifting looked like it had done
                    // nothing — and the hole it is supposed to leave was covered by
                    // the very block that was meant to have moved out of it.
                    if (scene.parked) return null
                    const sceneDuration = scene.end - scene.start
                    if (sceneDuration <= 0) return null
                    return (
                      <div
                        key={scene.id}
                        data-scene-block
                        draggable={false}
                        className="absolute top-0 h-full group cursor-move select-none overflow-hidden"
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setSceneMenu({ x: e.clientX, y: e.clientY, sceneId: scene.id })
                        }}
                        onDragStart={(e) => { e.preventDefault() }}
                        style={{
                          left: scene.start * PIXELS_PER_SECOND,
                          width: Math.max(4, sceneDuration * PIXELS_PER_SECOND),
                        }}
                        // POINTER DRAG, the same shape as the fade handles — the most
                        // precise thing on this timeline. Capture the pointer on the way
                        // down so every move is delivered here even when the cursor
                        // outruns the clip or leaves the window, follow the cursor by
                        // writing transform, and tell React once on release.
                        //
                        // Listening on pointerdown also ends the pointerdown/mousedown
                        // ordering trap: the pan listens on pointerdown, so a mousedown
                        // handler could not stop it and both drags ran at once.
                        onPointerDown={(e) => {
                          if (e.button !== 0) return
                          e.preventDefault()
                          e.stopPropagation()
                          const startX = e.clientX
                          const startY = e.clientY
                          const startStart = scene.start
                          const startEnd = scene.end
                          const duration = startEnd - startStart
                          // FREE TRAVEL, THE FULL LENGTH OF THE TRACK.
                          //
                          // This was clamped to the free space between the neighbours,
                          // so a clip between two abutting scenes could not move at all:
                          // minStart was the previous scene's end and maxStart worked
                          // out to the same value. Sliding picture against audio is how
                          // sync is found without a lipsync engine, so the clip has to
                          // go where it needs to go and nothing else may move to make
                          // room for it.
                          const _minStart = 0
                          const _maxStart = Math.max(0, videoDuration - duration)
                          let didMove = false
                          let newStart = startStart
                          // The clip has to be SEEN leaving the picture. This wrote the
                          // new start to the store on every mousemove, which moved the
                          // block horizontally only — there was no vertical movement at
                          // all, so lifting gave no feedback until the drop. Now the
                          // element is transformed directly (no re-render per move, the
                          // rule this file keeps relearning) and the store is written
                          // once, on drop.
                          const el = e.currentTarget as HTMLElement
                          const pointerId = e.pointerId
                          try { el.setPointerCapture(pointerId) } catch {}
                          const vTrack = videoTrackRef.current
                          const lTrack = layoverTrackRef.current
                          // Both tracks clip their contents, so a clip crossing between
                          // them disappeared behind the boundary instead of rising out
                          // of the picture. Lift the clipping for the duration of the drag.
                          if (vTrack) vTrack.style.overflow = 'visible'
                          if (lTrack) lTrack.style.overflow = 'visible'
                          // Lift it off the backdrop. A clip that stays flat in the row
                          // reads as though the ROW is moving rather than the clip.
                          el.style.zIndex = '60'
                          el.style.cursor = 'grabbing'
                          el.style.boxShadow = '0 10px 28px rgba(0,0,0,0.85)'
                          el.style.outline = '2px solid rgba(52,211,153,0.9)'
                          el.style.willChange = 'transform'
                          // Same band, same reason as the parked clip above.
                          const elRect = el.getBoundingClientRect()
                          const ceilY = lTrack ? lTrack.getBoundingClientRect().top : elRect.top
                          const floorY = vTrack ? vTrack.getBoundingClientRect().bottom : elRect.bottom
                          const minDy = ceilY - elRect.top
                          const maxDy = floorY - elRect.bottom
                          let lastY = startY
                          const onMove = (ev: PointerEvent) => {
                            // A move with no button held means the release was missed.
                            if (ev.buttons === 0) { finish(lastY); return }
                            didMove = true
                            lastY = ev.clientY
                            const delta = (ev.clientX - startX) / PIXELS_PER_SECOND
                            newStart = Math.min(_maxStart, Math.max(_minStart, startStart + delta))
                            // Bounded only by the film itself, so the clip tracks the
                            // cursor one-to-one everywhere in between.
                            const dx = (newStart - startStart) * PIXELS_PER_SECOND
                            const dy = Math.min(maxDy, Math.max(minDy, ev.clientY - startY))
                            el.style.transform = `translate(${dx}px, ${dy}px)`
                          }
                          function finish(dropY: number) {
                            try { el.releasePointerCapture(pointerId) } catch {}
                            el.style.transform = ''
                            el.style.zIndex = ''
                            el.style.cursor = ''
                            el.style.boxShadow = ''
                            el.style.outline = ''
                            el.style.willChange = ''
                            if (vTrack) vTrack.style.overflow = ''
                            if (lTrack) lTrack.style.overflow = ''
                            document.removeEventListener('pointermove', onMove)
                            document.removeEventListener('pointerup', onUp)
                            document.removeEventListener('pointercancel', onUp)
                            window.removeEventListener('blur', onBlur)
                            const layoverRect = layoverTrackRef.current?.getBoundingClientRect()
                            // Drag up into the layover track parks the scene; otherwise
                            // persist the horizontal slide in the picture.
                            if (didMove && layoverRect && dropY >= layoverRect.top && dropY < layoverRect.bottom) {
                              parkScene(scene.id)
                              persistScenes().catch(err => console.warn('[PARK]', err))
                            } else if (didMove) {
                              // Commit the slide once, here, rather than per frame.
                              updateScene(scene.id, { start: newStart, end: newStart + duration })
                              persistScenes().catch(err => console.warn('[SCENE-MOVE]', err))
                            }
                          }
                          const onUp = (ev: PointerEvent) => finish(ev.clientY)
                          // blur carries no pointer position; end it where it stands.
                          const onBlur = () => finish(lastY)
                          document.addEventListener('pointermove', onMove)
                          document.addEventListener('pointerup', onUp)
                          document.addEventListener('pointercancel', onUp)
                          window.addEventListener('blur', onBlur)
                        }}
                      >
                        {/* THE PICTURE BELONGS TO THE SCENE.
                            The filmstrip used to be one continuous run of thumbnails
                            tiled across the whole track, with no knowledge of scenes at
                            all. Sliding a scene therefore moved an empty outline while
                            the footage stayed exactly where it was — the picture could
                            not actually be moved against the audio, which is the one
                            thing this track exists to do.

                            Each scene now draws the frames of its OWN source range,
                            shifted by source_start and clipped to the block, so the
                            footage travels with the clip and retimed scenes show what
                            they will actually play. Gaps show black, which is what a gap
                            renders as. */}
                        {videoThumbnails.length > 0 && (
                          <div
                            className="absolute inset-0 flex pointer-events-none"
                            style={{
                              left: -((scene.source_start ?? scene.start) * PIXELS_PER_SECOND),
                              width: videoDuration * PIXELS_PER_SECOND,
                            }}
                          >
                            {videoThumbnails.map((thumb, ti) => (
                              <div
                                key={ti}
                                className="h-full flex-shrink-0"
                                style={{
                                  width: `${(videoDuration / videoThumbnails.length) * PIXELS_PER_SECOND}px`,
                                  backgroundImage: `url(${thumb})`,
                                  backgroundSize: 'auto 100%',
                                  backgroundPosition: '0% 50%',
                                  backgroundRepeat: 'repeat-x',
                                }}
                              />
                            ))}
                          </div>
                        )}
                        <div className={cn(
                          "absolute inset-0 pointer-events-none",
                          overlappingSceneIds.has(scene.id)
                            ? "bg-amber-500/20 border-x-2 border-amber-400"
                            : "bg-emerald-500/10 border-x border-emerald-500/30"
                        )} />
                        <div className="absolute inset-0 flex items-center justify-center text-[9px] text-emerald-400/70 pointer-events-none">
                          Scene {idx + 1}
                        </div>
                        <button
                          type="button"
                          className="absolute right-1 top-0.5 text-[8px] text-emerald-300 hover:text-white px-1 py-0.5 rounded bg-emerald-950/60 hover:bg-emerald-500/40 pointer-events-auto z-30"
                          title="Render this scene preview"
                          onClick={(e) => {
                            e.stopPropagation()
                            apiClient.renderScenePreview(jobId, scene.id).then(({ url }) => {
                              window.open(apiClient.toAbsoluteUrl(url), '_blank')
                            }).catch(err => {
                              console.warn('[RENDER-SCENE]', err)
                              alert('Scene render failed: ' + (err?.message || 'unknown'))
                            })
                          }}
                        >
                          Render
                        </button>
                        {/* Left boundary drag handle */}
                        <div
                          data-resize-handle
                          className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-emerald-400 z-20"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const startX = e.clientX
                            const startStart = scene.start
                            const prev = scenes[idx - 1]
                            const onMove = (ev: MouseEvent) => {
                              const delta = (ev.clientX - startX) / PIXELS_PER_SECOND
                              const newStart = Math.max(prev ? prev.start + 0.05 : 0, Math.min(scene.end - 0.1, startStart + delta))
                              updateScene(scene.id, { start: newStart })
                              if (prev) updateScene(prev.id, { end: newStart })
                            }
                            const onUp = () => {
                              persistScenes().catch(err => console.warn('[SCENE-MOVE]', err))
                              document.removeEventListener('mousemove', onMove)
                              document.removeEventListener('mouseup', onUp)
                              document.removeEventListener('pointercancel', onUp)
                              window.removeEventListener('blur', onUp)
                            }
                            document.addEventListener('mousemove', onMove)
                            document.addEventListener('mouseup', onUp)
                            document.addEventListener('pointercancel', onUp)
                            window.addEventListener('blur', onUp)
                          }}
                        />
                        {/* Right boundary drag handle */}
                        <div
                          data-resize-handle
                          className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-emerald-400 z-20"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const startX = e.clientX
                            const startEnd = scene.end
                            const next = scenes[idx + 1]
                            const onMove = (ev: MouseEvent) => {
                              const delta = (ev.clientX - startX) / PIXELS_PER_SECOND
                              const newEnd = Math.max(scene.start + 0.1, Math.min(next ? next.end - 0.05 : videoDuration, startEnd + delta))
                              updateScene(scene.id, { end: newEnd })
                              if (next) updateScene(next.id, { start: newEnd })
                            }
                            const onUp = () => {
                              persistScenes().catch(err => console.warn('[SCENE-MOVE]', err))
                              document.removeEventListener('mousemove', onMove)
                              document.removeEventListener('mouseup', onUp)
                              document.removeEventListener('pointercancel', onUp)
                              window.removeEventListener('blur', onUp)
                            }
                            document.addEventListener('mousemove', onMove)
                            document.addEventListener('mouseup', onUp)
                            document.addEventListener('pointercancel', onUp)
                            window.addEventListener('blur', onUp)
                          }}
                        />
                        {/* Fade in. Ramp and grip are SIBLINGS so the ramp can be zero-width
                            (drawing nothing) while the grip still sits on the corner. */}
                        <div
                          data-scene-ramp="in"
                          className="absolute top-0 left-0 h-full pointer-events-none z-10 bg-cyan-400/45"
                          style={{
                            width: Math.min((scene.video_fade_in ?? 0) * PIXELS_PER_SECOND, sceneDuration * PIXELS_PER_SECOND / 2),
                            clipPath: 'polygon(0 0, 100% 0, 0 100%)',
                          }}
                        />
                        <div
                          data-scene-handle="in"
                          className={cn("absolute top-0 w-3 h-3 pointer-events-auto z-40 opacity-0 group-hover:opacity-100 transition-opacity", (scene.video_fade_in ?? 0) > 0 && "animate-pulse")}
                          title={`Fade in ${(scene.video_fade_in ?? 0).toFixed(2)}s`}
                          style={{
                            left: Math.min((scene.video_fade_in ?? 0) * PIXELS_PER_SECOND, sceneDuration * PIXELS_PER_SECOND / 2),
                            background: 'linear-gradient(135deg, rgb(15,23,42) 0%, rgb(0,245,212) 100%)',
                            clipPath: 'polygon(0 0, 100% 0, 0 100%)',
                            boxShadow: '0 0 8px rgba(0,245,212,0.9)',
                            // The scene block itself uses a move cursor for dragging the boundary.
                            // Force the plain pointer back so the tip stays on the grip.
                            cursor: 'default',
                            willChange: 'transform',
                          }}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
                          onPointerDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
                            const grip = e.currentTarget as HTMLElement
                            const ramp = grip.parentElement?.querySelector('[data-scene-ramp="in"]') as HTMLElement | null
                            const startX = e.clientX
                            const startY = e.clientY
                            const initialFade = scene.video_fade_in ?? 0
                            const maxFade = sceneDuration / 2
                            let latest = initialFade
                            // DOM-driven while dragging. updateScene on every move wrote to the
                            // store and re-rendered the editor per mouse event, so the grip lagged
                            // the cursor. The store is written once, on release.
                            // Grows as the grip is pulled right.
                            const onPointerMove = (ev: PointerEvent) => {
                              const delta = (ev.clientX - startX) / PIXELS_PER_SECOND
                              latest = Math.min(Math.max(0, initialFade + delta), maxFade)
                              const px = latest * PIXELS_PER_SECOND
                              if (ramp) ramp.style.width = `${px}px`
                              grip.style.left = `${px}px`
                            }
                            const onPointerUp = (ev: PointerEvent) => {
                              document.removeEventListener('pointermove', onPointerMove)
                              document.removeEventListener('pointerup', onPointerUp)
                              document.removeEventListener('pointercancel', onPointerUp)
                              window.removeEventListener('blur', onPointerUp)
                              const dx = Math.abs(ev.clientX - startX)
                              const dy = Math.abs(ev.clientY - startY)
                              if (dx < 4 && dy < 4) {
                                // Click: snap fade back to 0.
                                latest = 0
                                if (ramp) ramp.style.width = '0px'
                                grip.style.left = '0px'
                              }
                              updateScene(scene.id, { video_fade_in: latest })
                              persistScenes().catch(err => console.warn('[SCENE-FADE]', err))
                            }
                            document.addEventListener('pointermove', onPointerMove)
                            document.addEventListener('pointerup', onPointerUp)
                            document.addEventListener('pointercancel', onPointerUp)
                            window.addEventListener('blur', onPointerUp)
                          }}
                        />
                        {/* Fade out. Ramp and grip are SIBLINGS so the ramp can be zero-width
                            (drawing nothing) while the grip still sits on the corner. */}
                        <div
                          data-scene-ramp="out"
                          className="absolute top-0 right-0 h-full pointer-events-none z-10 bg-cyan-400/45"
                          style={{
                            width: Math.min((scene.video_fade_out ?? 0) * PIXELS_PER_SECOND, sceneDuration * PIXELS_PER_SECOND / 2),
                            clipPath: 'polygon(100% 0, 100% 100%, 0 0)',
                          }}
                        />
                        <div
                          data-scene-handle="out"
                          className={cn("absolute top-0 w-3 h-3 pointer-events-auto z-40 opacity-0 group-hover:opacity-100 transition-opacity", (scene.video_fade_out ?? 0) > 0 && "animate-pulse")}
                          title={`Fade out ${(scene.video_fade_out ?? 0).toFixed(2)}s`}
                          style={{
                            right: Math.min((scene.video_fade_out ?? 0) * PIXELS_PER_SECOND, sceneDuration * PIXELS_PER_SECOND / 2),
                            background: 'linear-gradient(225deg, rgb(15,23,42) 0%, rgb(0,245,212) 100%)',
                            clipPath: 'polygon(100% 0, 100% 100%, 0 0)',
                            boxShadow: '0 0 8px rgba(0,245,212,0.9)',
                            // The scene block itself uses a move cursor for dragging the boundary.
                            // Force the plain pointer back so the tip stays on the grip.
                            cursor: 'default',
                            willChange: 'transform',
                          }}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
                          onPointerDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
                            const grip = e.currentTarget as HTMLElement
                            const ramp = grip.parentElement?.querySelector('[data-scene-ramp="out"]') as HTMLElement | null
                            const startX = e.clientX
                            const startY = e.clientY
                            const initialFade = scene.video_fade_out ?? 0
                            const maxFade = sceneDuration / 2
                            let latest = initialFade
                            // DOM-driven while dragging. updateScene on every move wrote to the
                            // store and re-rendered the editor per mouse event, so the grip lagged
                            // the cursor. The store is written once, on release.
                            // Grows as the grip is pulled left.
                            const onPointerMove = (ev: PointerEvent) => {
                              const delta = (startX - ev.clientX) / PIXELS_PER_SECOND
                              latest = Math.min(Math.max(0, initialFade + delta), maxFade)
                              const px = latest * PIXELS_PER_SECOND
                              if (ramp) ramp.style.width = `${px}px`
                              grip.style.right = `${px}px`
                            }
                            const onPointerUp = (ev: PointerEvent) => {
                              document.removeEventListener('pointermove', onPointerMove)
                              document.removeEventListener('pointerup', onPointerUp)
                              document.removeEventListener('pointercancel', onPointerUp)
                              window.removeEventListener('blur', onPointerUp)
                              const dx = Math.abs(ev.clientX - startX)
                              const dy = Math.abs(ev.clientY - startY)
                              if (dx < 4 && dy < 4) {
                                // Click: snap fade back to 0.
                                latest = 0
                                if (ramp) ramp.style.width = '0px'
                                grip.style.right = '0px'
                              }
                              updateScene(scene.id, { video_fade_out: latest })
                              persistScenes().catch(err => console.warn('[SCENE-FADE]', err))
                            }
                            document.addEventListener('pointermove', onPointerMove)
                            document.addEventListener('pointerup', onPointerUp)
                            document.addEventListener('pointercancel', onPointerUp)
                            window.addEventListener('blur', onPointerUp)
                          }}
                        />
                      </div>
                    )
                  })}
                </div>

                {/* Fallback only. Once scenes exist they carry the picture themselves
                    (see above); a continuous strip underneath them would show the wrong
                    frames wherever a scene has been retimed or moved, and would paint
                    footage across gaps that render as black. */}
                {videoThumbnails.length > 0 && scenes.length === 0 ? (
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
              <div className="h-20 shrink-0 bg-neutral-900/20 border-b border-neutral-700 relative" data-timeline-track>
                {displaySegments.map((segment, index) => {
                  if (!inActiveWindow(segment)) return null
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
                      segmentKey={getSegmentKey(segment)}
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
                      onToggleLock={(idx) => setSegmentLocked(idx, !lockedSegments.has(keyAt(idx)))}
                      onLockScene={(idx) => { setSceneLockMode(true); setSceneAnchor(idx); setSceneRange({ start: idx, end: idx }) }}
                      onUnlockScene={(idx) => unlockScene(idx)}
                      onTogglePair={togglePairWithNext}
                      onRevert={revertToOriginal}
                      onUndoLastEdit={handleUndoLastEdit}
                      onUndoSplit={handleUndoSplit}
                      onCopyText={handleCopyText}
                      onPasteText={handlePasteText}
                      onClearSegment={handleClearSegment}
                      onSetEmotion={(idx, emotion) => setStagedEmotions(prev => ({ ...prev, [keyAt(idx)]: emotion }))}
                      onClearEmotion={(idx) => {
                    setStagedEmotions(prev => ({ ...prev, [keyAt(idx)]: '' }))
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
                        lockedSegments.has(keyAt(index)) && 'ring-1 ring-green-400/60',
                        lockGlowIndices.has(keyAt(index)) && 'ring-2 ring-green-400 shadow-[0_0_16px_4px_rgba(74,222,128,0.95)] animate-pulse',
                        selectedSegmentIndex === index && !lockGlowIndices.has(keyAt(index)) && 'ring-2 ring-amber-400/70 shadow-[0_0_8px_2px_rgba(251,191,36,0.4)] animate-pulse',
                        voiceDragOverIndex === index && 'ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)] animate-pulse',
                        isAssignmentPulse && 'ring-2 ring-amber-400/60 shadow-[0_0_6px_2px_rgba(245,158,11,0.22)] animate-pulse',
                        flashingPair === index && 'ring-1 ring-amber-400',
                        (lockedPairs.has(keyAt(index)) || lockedPairs.has(keyAt(index - 1))) && 'shadow-[0_0_8px_2px_rgba(251,191,36,0.6)] animate-pulse',
                        isDraggingThis ? 'cursor-grabbing' : 'cursor-grab'
                      )}
                      style={{
                        left: (effStart(segment) + delta) * PIXELS_PER_SECOND + ((groupMoveActive && groupSelectedSegments.has(index)) ? groupMoveOffset.x : 0),
                        width: (() => {
                          const dur = effEnd(segment) - effStart(segment)
                          const spd = dragSpeedPreview?.index === index ? dragSpeedPreview.speed : (stagedSpeeds[keyAt(index)] ?? 1.0)
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
                        // Layout lock freezes the timeline: nothing moves.
                        if (layoutLocked) return
                        if (lockedSegments.has(keyAt(index))) return // locked — position frozen
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
                          commitOrStage(segment.transcript_index ?? index, {
                            committed_start_time: Math.max(0, originalStart + deltaTime),
                            committed_end_time: Math.max(0, originalEnd + deltaTime),
                          }).catch(err => console.warn('[COMMIT-TIMING]', err))
                          // Paired neighbor (Shift+P) moves by the same amount — commit
                          // its shifted timing too so it doesn't snap back.
                          const partnerIdx = lockedPairs.has(keyAt(index)) ? index + 1 : (lockedPairs.has(keyAt(index - 1)) ? index - 1 : null)
                          if (partnerIdx != null) {
                            const p = displaySegmentsRef.current[partnerIdx]
                            if (p) {
                              const pStart = Math.max(0, effStart(p) + deltaTime)
                              const pEnd = Math.max(0, effEnd(p) + deltaTime)
                              updateSegment(partnerIdx, { start_time: pStart, end_time: pEnd })
                              commitSegmentChanges(partnerIdx, { committed_start_time: pStart, committed_end_time: pEnd })
                              commitOrStage(p.transcript_index ?? partnerIdx, {
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
                          document.removeEventListener('pointercancel', onMouseUp)
                          window.removeEventListener('blur', onMouseUp)
                          dragMoveListenerRef.current = null
                          dragUpListenerRef.current = null
                        }
                        document.addEventListener('mousemove', onMouseMove)
                        document.addEventListener('mouseup', onMouseUp)
                        document.addEventListener('pointercancel', onMouseUp)
                        window.addEventListener('blur', onMouseUp)
                        dragMoveListenerRef.current = onMouseMove
                        dragUpListenerRef.current = onMouseUp
                      }}
                    >
                      {/* Left handle — drag to move start_time */}
                      <div
                        data-resize-handle={true}
                        className={cn("absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-white/20 rounded-l", (layoutLocked || lockedSegments.has(keyAt(index))) && 'pointer-events-none')}
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
                            commitOrStage(segment.transcript_index ?? index, {
                              committed_start_time: newStart,
                            }).catch(err => console.warn('[RESIZE-LEFT]', err))
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) => i === index ? { ...seg, start_time: newStart, committed_start_time: newStart } : seg)
                            })
                            document.removeEventListener('mousemove', onMouseMove)
                            document.removeEventListener('mouseup', onMouseUp)
                            document.removeEventListener('pointercancel', onMouseUp)
                            window.removeEventListener('blur', onMouseUp)
                          }
                          document.addEventListener('mousemove', onMouseMove)
                          document.addEventListener('mouseup', onMouseUp)
                          document.addEventListener('pointercancel', onMouseUp)
                          window.addEventListener('blur', onMouseUp)
                        }}
                      >
                        <GripHorizontal className="h-3 w-3 rotate-90" />
                      </div>

                      {lockedPairs.has(keyAt(index)) && (
                        <Link2 className="absolute top-0.5 right-0.5 h-2.5 w-2.5 text-amber-400 opacity-80" />
                      )}
                      <div className="px-2 truncate text-[10px] h-full flex items-center text-blue-200/80">
                        {segment.source_text}
                      </div>

                      {/* Right handle — drag to move end_time */}
                      <div
                        data-resize-handle={true}
                        className={cn("absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-white/20 rounded-r", (layoutLocked || lockedSegments.has(keyAt(index))) && 'pointer-events-none')}
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
                            commitOrStage(segment.transcript_index ?? index, {
                              committed_end_time: newEnd,
                            }).catch(err => console.warn('[RESIZE-RIGHT]', err))
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) => i === index ? { ...seg, end_time: newEnd, committed_end_time: newEnd } : seg)
                            })
                            document.removeEventListener('mousemove', onMouseMove)
                            document.removeEventListener('mouseup', onMouseUp)
                            document.removeEventListener('pointercancel', onMouseUp)
                            window.removeEventListener('blur', onMouseUp)
                          }
                          document.addEventListener('mousemove', onMouseMove)
                          document.addEventListener('mouseup', onMouseUp)
                          document.addEventListener('pointercancel', onMouseUp)
                          window.addEventListener('blur', onMouseUp)
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
                <div className="h-20 shrink-0 bg-amber-950/20 border-b border-amber-800/40 relative" data-timeline-track>
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
                  "h-20 shrink-0 bg-neutral-900/20 border-b border-neutral-700 relative",
                  draggedTranslation && "bg-amber-500/10 border-amber-500/30"
                )}
                data-timeline-track
                onDragOver={handleTimelineDragOver}
                onDrop={handleDubbedTrackDrop}
              >
                {displaySegments.map((segment, index) => {
                  if (!inActiveWindow(segment)) return null
                  const droppedTranslation = droppedTranslations.find(t => t.segmentIndex === index)
                  const hasDroppedTranslation = !!droppedTranslation

                  const bgColor = hasDroppedTranslation
                    ? 'bg-amber-500/40 border-amber-400 ring-2 ring-amber-400/50'
                    : 'bg-amber-500/30 border-amber-500/50'
                  
                  return (
                    <SegmentContextMenu
                      key={`dub-${segment.id}`}
                      index={index}
                      segmentKey={getSegmentKey(segment)}
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
                      onToggleLock={(idx) => setSegmentLocked(idx, !lockedSegments.has(keyAt(idx)))}
                      onLockScene={(idx) => { setSceneLockMode(true); setSceneAnchor(idx); setSceneRange({ start: idx, end: idx }) }}
                      onUnlockScene={(idx) => unlockScene(idx)}
                      onTogglePair={togglePairWithNext}
                      onRevert={revertToOriginal}
                      onUndoLastEdit={handleUndoLastEdit}
                      onUndoSplit={handleUndoSplit}
                      onCopyText={handleCopyText}
                      onPasteText={handlePasteText}
                      onClearSegment={handleClearSegment}
                      onSetEmotion={(idx, emotion) => setStagedEmotions(prev => ({ ...prev, [keyAt(idx)]: emotion }))}
                      onClearEmotion={(idx) => {
                    setStagedEmotions(prev => ({ ...prev, [keyAt(idx)]: '' }))
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
                        lockedSegments.has(keyAt(index)) && 'ring-1 ring-green-400/60',
                        lockGlowIndices.has(keyAt(index)) && 'ring-2 ring-green-400 shadow-[0_0_16px_4px_rgba(74,222,128,0.95)] animate-pulse',
                        (index === groupBounds?.firstIdx || index === groupBounds?.lastIdx)
                          ? 'border-yellow-400/90 shadow-[0_0_14px_rgba(250,204,21,0.6)] ring-2 ring-yellow-400/80'
                          : 'border-slate-400/30',
                        selectedSegmentIndex === index && !lockGlowIndices.has(keyAt(index)) && 'ring-2 ring-amber-400/70 shadow-[0_0_8px_2px_rgba(251,191,36,0.4)] animate-pulse',
                        voiceDragOverIndex === index && 'ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)] animate-pulse',
                        flashingPair === index && 'ring-1 ring-amber-400',
                        (lockedPairs.has(keyAt(index)) || lockedPairs.has(keyAt(index - 1))) && 'shadow-[0_0_8px_2px_rgba(251,191,36,0.6)] animate-pulse',
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
                            : (stagedSpeeds[keyAt(index)] ?? 1.0)
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
                        // Layout lock freezes the timeline: nothing moves.
                        if (layoutLocked) return
                        if (lockedSegments.has(keyAt(index))) return // locked — position frozen
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
                          commitOrStage(segment.transcript_index ?? index, {
                            committed_start_time: Math.max(0, originalStart + deltaTime),
                            committed_end_time: Math.max(0, originalEnd + deltaTime),
                          }).catch(err => console.warn('[COMMIT-TIMING]', err))
                          // Paired neighbor (Shift+P) moves by the same amount — commit
                          // its shifted timing too so it doesn't snap back.
                          const partnerIdx = lockedPairs.has(keyAt(index)) ? index + 1 : (lockedPairs.has(keyAt(index - 1)) ? index - 1 : null)
                          if (partnerIdx != null) {
                            const p = displaySegmentsRef.current[partnerIdx]
                            if (p) {
                              const pStart = Math.max(0, effStart(p) + deltaTime)
                              const pEnd = Math.max(0, effEnd(p) + deltaTime)
                              updateSegment(partnerIdx, { start_time: pStart, end_time: pEnd })
                              commitSegmentChanges(partnerIdx, { committed_start_time: pStart, committed_end_time: pEnd })
                              commitOrStage(p.transcript_index ?? partnerIdx, {
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
                            requestStitchWith(
                              displaySegments.map((seg, i) => ({
                                ...seg,
                                start_time: i === index ? newStart : seg.start_time,
                                end_time: i === index ? newEnd : seg.end_time,
                                committed_start_time: i === index ? newStart : seg.committed_start_time,
                                committed_end_time: i === index ? newEnd : seg.committed_end_time,
                                audio_url: apiClient.refreshAudioUrl(jobId, seg.audio_url),
                                committed_audio_url: apiClient.refreshAudioUrl(jobId, seg.committed_audio_url),
                              })),
                              audioContextRef.current,
                            )
                          }
                          setDraggingSegment(null)
                          document.removeEventListener('mousemove', onMouseMove)
                          document.removeEventListener('mouseup', onMouseUp)
                          document.removeEventListener('pointercancel', onMouseUp)
                          window.removeEventListener('blur', onMouseUp)
                          dragMoveListenerRef.current = null
                          dragUpListenerRef.current = null
                        }
                        document.addEventListener('mousemove', onMouseMove)
                        document.addEventListener('mouseup', onMouseUp)
                        document.addEventListener('pointercancel', onMouseUp)
                        window.addEventListener('blur', onMouseUp)
                        dragMoveListenerRef.current = onMouseMove
                        dragUpListenerRef.current = onMouseUp
                      }}
                    >
                      {/* Left timing handle (green) */}
                      <div
                        data-resize-handle={true}
                        className={cn("absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-green-500/40 hover:bg-green-500/70 rounded-l transition-colors", (layoutLocked || lockedSegments.has(keyAt(index))) && 'pointer-events-none')}
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
                            commitOrStage(segment.transcript_index ?? index, {
                              committed_start_time: newStart,
                            }).catch(err => console.warn('[DUBBED-RESIZE-LEFT]', err))
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) => i === index ? { ...seg, start_time: newStart, committed_start_time: newStart } : seg)
                            })
                            document.removeEventListener('mousemove', onMouseMove)
                            document.removeEventListener('mouseup', onMouseUp)
                            document.removeEventListener('pointercancel', onMouseUp)
                            window.removeEventListener('blur', onMouseUp)
                          }
                          document.addEventListener('mousemove', onMouseMove)
                          document.addEventListener('mouseup', onMouseUp)
                          document.addEventListener('pointercancel', onMouseUp)
                          window.addEventListener('blur', onMouseUp)
                        }}
                      >
                        <GripHorizontal className="h-3 w-3 rotate-90" />
                      </div>

                      {/* Lock icon when paired */}
                      {lockedPairs.has(keyAt(index)) && (
                        <Link2 className="absolute top-0.5 right-0.5 h-2.5 w-2.5 text-amber-400 opacity-80" />
                      )}

                      {/* Content */}
                      <div className="px-3 truncate text-[10px] h-full flex items-center text-white/80 gap-1">
                        {dragSpeedPreview?.index === index ? (
                          <span className="text-amber-400 font-mono shrink-0">{dragSpeedPreview.speed.toFixed(2)}x</span>
                        ) : stagedSpeeds[keyAt(index)] !== undefined ? (
                          <>
                            <span className="text-amber-400 font-mono shrink-0">{stagedSpeeds[keyAt(index)].toFixed(2)}x</span>
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
                        className={cn("absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-green-500/40 hover:bg-green-500/70 rounded-r transition-colors", (layoutLocked || lockedSegments.has(keyAt(index))) && 'pointer-events-none')}
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
                            commitOrStage(segment.transcript_index ?? index, {
                              committed_end_time: newEnd,
                            }).catch(err => console.warn('[DUBBED-RESIZE-RIGHT]', err))
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) => i === index ? { ...seg, end_time: newEnd, committed_end_time: newEnd } : seg)
                            })
                            document.removeEventListener('mousemove', onMouseMove)
                            document.removeEventListener('mouseup', onMouseUp)
                            document.removeEventListener('pointercancel', onMouseUp)
                            window.removeEventListener('blur', onMouseUp)
                          }
                          document.addEventListener('mousemove', onMouseMove)
                          document.addEventListener('mouseup', onMouseUp)
                          document.addEventListener('pointercancel', onMouseUp)
                          window.addEventListener('blur', onMouseUp)
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
                  if (!inActiveWindow(seg)) return null
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
                          : (seg.rpt_dirty || seg.isUserEdited)
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
                            const spd = dragSpeedPreview?.index === i ? dragSpeedPreview.speed : (stagedSpeeds[keyAt(i)] ?? 1.0)
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
                        className={cn("absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-blue-500/40 hover:bg-blue-500/70 rounded-l transition-colors z-10", layoutLocked && 'pointer-events-none')}
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
                                setStagedSpeeds(s => ({ ...s, [keyAt(i)]: prev.speed }))
                              }
                              return null
                            })
                            document.removeEventListener('mousemove', onMouseMove)
                            document.removeEventListener('mouseup', onMouseUp)
                            document.removeEventListener('pointercancel', onMouseUp)
                            window.removeEventListener('blur', onMouseUp)
                          }
                          document.addEventListener('mousemove', onMouseMove)
                          document.addEventListener('mouseup', onMouseUp)
                          document.addEventListener('pointercancel', onMouseUp)
                          window.addEventListener('blur', onMouseUp)
                        }}
                      >
                        <GripHorizontal className="h-3 w-3 rotate-90" />
                      </div>
                      {/* Right speed handle (blue) */}
                      <div
                        data-resize-handle={true}
                        className={cn("absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-blue-500/40 hover:bg-blue-500/70 rounded-r transition-colors z-10", layoutLocked && 'pointer-events-none')}
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
                                setStagedSpeeds(s => ({ ...s, [keyAt(i)]: prev.speed }))
                              }
                              return null
                            })
                            document.removeEventListener('mousemove', onMouseMove)
                            document.removeEventListener('mouseup', onMouseUp)
                            document.removeEventListener('pointercancel', onMouseUp)
                            window.removeEventListener('blur', onMouseUp)
                          }
                          document.addEventListener('mousemove', onMouseMove)
                          document.addEventListener('mouseup', onMouseUp)
                          document.addEventListener('pointercancel', onMouseUp)
                          window.addEventListener('blur', onMouseUp)
                        }}
                      >
                        <GripHorizontal className="h-3 w-3 rotate-90" />
                      </div>

                      {/* The fade RAMPS, drawn permanently.
                          Only the drag handles existed before, and they were hidden
                          until hover — so setting a fade and moving the mouse away
                          left no trace of it at all, which reads as the fade having
                          snapped back. The shaded triangle is the attenuated part of
                          the segment: it is what you can actually hear. */}
                      {(seg.fade_in ?? 0) > 0 && (
                        <div
                          className="absolute top-0 bottom-0 left-0 pointer-events-none z-10"
                          style={{
                            width: (seg.fade_in ?? 0) * PIXELS_PER_SECOND,
                            background: 'rgba(16,185,129,0.45)',
                            // Above the ramp line: level rises 0 -> full across the
                            // region, so the missing part is the top-left triangle.
                            clipPath: 'polygon(0 0, 100% 0, 0 100%)',
                          }}
                        />
                      )}
                      {(seg.fade_out ?? 0) > 0 && (
                        <div
                          className="absolute top-0 bottom-0 right-0 pointer-events-none z-10"
                          style={{
                            width: (seg.fade_out ?? 0) * PIXELS_PER_SECOND,
                            background: 'rgba(16,185,129,0.45)',
                            // Mirrored: level falls full -> 0, so the missing part is
                            // the top-right triangle.
                            clipPath: 'polygon(0 0, 100% 0, 100% 100%)',
                          }}
                        />
                      )}

                      {/* Fade handles — only on Preview Audio track */}
                      {!layoutLocked && (
                        <>
                          {/* Fade in — ramp and grip are SIBLINGS, not nested.
                              Nested, the grip's position was tied to the ramp's box and the ramp
                              needed a minimum width to keep the grip reachable — which painted a
                              wedge on every block that had no fade. Separately positioned, the ramp
                              can be zero-width (drawing nothing) while the grip still sits exactly
                              on the block corner. */}
                          <div
                            data-fade-ramp="in"
                            className="absolute top-0 left-0 h-full pointer-events-none z-10 bg-cyan-400/45"
                            style={{
                              width: Math.min((seg.fade_in ?? 0) * PIXELS_PER_SECOND, (endT - startT) * PIXELS_PER_SECOND / 2),
                              clipPath: 'polygon(0 0, 100% 0, 0 100%)',
                            }}
                          />
                          <div
                            data-fade-handle="in"
                            className={cn("absolute top-0 w-3 h-3 pointer-events-auto z-40 opacity-0 group-hover:opacity-100 transition-opacity", (seg.fade_in ?? 0) > 0 && "animate-pulse")}
                            title={`Fade in ${(seg.fade_in ?? 0).toFixed(2)}s`}
                            style={{
                              left: Math.min((seg.fade_in ?? 0) * PIXELS_PER_SECOND, (endT - startT) * PIXELS_PER_SECOND / 2),
                              background: 'linear-gradient(135deg, rgb(15,23,42) 0%, rgb(0,245,212) 100%)',
                              clipPath: 'polygon(0 0, 100% 0, 0 100%)',
                              boxShadow: '0 0 8px rgba(0,245,212,0.9)',
                              willChange: 'transform',
                            }}
                            // The block below also handles click-to-seek. Without this the playhead
                            // jumped to wherever the drag ended, every single time.
                            onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
                            onPointerDown={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
                              const grip = e.currentTarget as HTMLElement
                              const ramp = grip.parentElement?.querySelector('[data-fade-ramp="in"]') as HTMLElement | null
                              const startX = e.clientX
                              const initialFade = seg.fade_in ?? 0
                              const maxFade = (endT - startT) / 2
                              let latest = initialFade
                              // Drive the DOM directly while dragging. This used to call
                              // setImportedSegments on every pointermove, which rebuilt an 818-entry
                              // array and re-rendered the whole editor per mouse event — the handle
                              // arrived where the cursor had been half a second earlier. State is
                              // written once, on release.
                              const onPointerMove = (ev: PointerEvent) => {
                                const delta = (ev.clientX - startX) / PIXELS_PER_SECOND
                                latest = Math.min(Math.max(0, initialFade + delta), maxFade)
                                const px = latest * PIXELS_PER_SECOND
                                if (ramp) ramp.style.width = `${px}px`
                                grip.style.left = `${px}px`
                              }
                              const onPointerUp = () => {
                                document.removeEventListener('pointermove', onPointerMove)
                                document.removeEventListener('pointerup', onPointerUp)
                                document.removeEventListener('pointercancel', onPointerUp)
                                window.removeEventListener('blur', onPointerUp)
                                const finalFade = latest
                                updateSegment(i, { fade_in: finalFade })
                                commitSegmentChanges(i, { fade_in: finalFade })
                                commitOrStage(seg.transcript_index ?? i, { fade_in: finalFade }).catch(err => console.warn('[FADE]', err))
                                setImportedSegments(prev => {
                                  const base = prev ?? displaySegmentsRef.current
                                  return base.map((s, idx) => idx === i ? { ...s, fade_in: finalFade } : s)
                                })
                                if (audioContextRef.current) {
                                  const stitchSegs = displaySegmentsRef.current.map((s, idx) => idx === i ? { ...s, fade_in: finalFade } : s)
                                  requestStitchWith(stitchSegs, audioContextRef.current)
                                }
                              }
                              document.addEventListener('pointermove', onPointerMove)
                              document.addEventListener('pointerup', onPointerUp)
                              document.addEventListener('pointercancel', onPointerUp)
                              window.addEventListener('blur', onPointerUp)
                            }}
                          />
                          {/* Fade out — ramp and grip are SIBLINGS, not nested.
                              Nested, the grip's position was tied to the ramp's box and the ramp
                              needed a minimum width to keep the grip reachable — which painted a
                              wedge on every block that had no fade. Separately positioned, the ramp
                              can be zero-width (drawing nothing) while the grip still sits exactly
                              on the block corner. */}
                          <div
                            data-fade-ramp="out"
                            className="absolute top-0 right-0 h-full pointer-events-none z-10 bg-cyan-400/45"
                            style={{
                              width: Math.min((seg.fade_out ?? 0) * PIXELS_PER_SECOND, (endT - startT) * PIXELS_PER_SECOND / 2),
                              clipPath: 'polygon(100% 0, 100% 100%, 0 0)',
                            }}
                          />
                          <div
                            data-fade-handle="out"
                            className={cn("absolute top-0 w-3 h-3 pointer-events-auto z-40 opacity-0 group-hover:opacity-100 transition-opacity", (seg.fade_out ?? 0) > 0 && "animate-pulse")}
                            title={`Fade out ${(seg.fade_out ?? 0).toFixed(2)}s`}
                            style={{
                              right: Math.min((seg.fade_out ?? 0) * PIXELS_PER_SECOND, (endT - startT) * PIXELS_PER_SECOND / 2),
                              background: 'linear-gradient(225deg, rgb(15,23,42) 0%, rgb(0,245,212) 100%)',
                              clipPath: 'polygon(100% 0, 100% 100%, 0 0)',
                              boxShadow: '0 0 8px rgba(0,245,212,0.9)',
                              willChange: 'transform',
                            }}
                            // The block below also handles click-to-seek. Without this the playhead
                            // jumped to wherever the drag ended, every single time.
                            onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
                            onPointerDown={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
                              const grip = e.currentTarget as HTMLElement
                              const ramp = grip.parentElement?.querySelector('[data-fade-ramp="out"]') as HTMLElement | null
                              const startX = e.clientX
                              const initialFade = seg.fade_out ?? 0
                              const maxFade = (endT - startT) / 2
                              let latest = initialFade
                              // Drive the DOM directly while dragging. This used to call
                              // setImportedSegments on every pointermove, which rebuilt an 818-entry
                              // array and re-rendered the whole editor per mouse event — the handle
                              // arrived where the cursor had been half a second earlier. State is
                              // written once, on release.
                              const onPointerMove = (ev: PointerEvent) => {
                                // Inverted: fade-out grows as the grip is pulled LEFT, back into the
                            // block, mirroring fade-in growing rightward.
                            const delta = (startX - ev.clientX) / PIXELS_PER_SECOND
                                latest = Math.min(Math.max(0, initialFade + delta), maxFade)
                                const px = latest * PIXELS_PER_SECOND
                                if (ramp) ramp.style.width = `${px}px`
                                grip.style.right = `${px}px`
                              }
                              const onPointerUp = () => {
                                document.removeEventListener('pointermove', onPointerMove)
                                document.removeEventListener('pointerup', onPointerUp)
                                document.removeEventListener('pointercancel', onPointerUp)
                                window.removeEventListener('blur', onPointerUp)
                                const finalFade = latest
                                updateSegment(i, { fade_out: finalFade })
                                commitSegmentChanges(i, { fade_out: finalFade })
                                commitOrStage(seg.transcript_index ?? i, { fade_out: finalFade }).catch(err => console.warn('[FADE]', err))
                                setImportedSegments(prev => {
                                  const base = prev ?? displaySegmentsRef.current
                                  return base.map((s, idx) => idx === i ? { ...s, fade_out: finalFade } : s)
                                })
                                if (audioContextRef.current) {
                                  const stitchSegs = displaySegmentsRef.current.map((s, idx) => idx === i ? { ...s, fade_out: finalFade } : s)
                                  requestStitchWith(stitchSegs, audioContextRef.current)
                                }
                              }
                              document.addEventListener('pointermove', onPointerMove)
                              document.addEventListener('pointerup', onPointerUp)
                              document.addEventListener('pointercancel', onPointerUp)
                              window.addEventListener('blur', onPointerUp)
                            }}
                          />
                        </>
                      )}
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
                  if (!inActiveWindow(segment)) return null
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
                {/* No filler grid either — it was the same gradient, and the empty area
                    below the tracks is where the striping showed up worst. */}
                {/* Grid filler body */}
                <div className="flex-1" />
                {/* Bottom ruler — half height of top (h-5), major ticks only */}
                <TimeRuler durationSec={videoDuration} pps={PIXELS_PER_SECOND} variant="bottom" />
              </div>

              {/* Player needle — draggable. Teal to match MAKE MOVIE, deliberately:
                  it is the one marker the eye tracks constantly, and teal is not used
                  by any block, fade or badge on the timeline. */}
              <div
                ref={playheadRef}
                // z-50: fade grips and the selected-scene highlight are z-40, so at
                // z-30 the needle passed underneath them and broke up mid-track.
                className="absolute z-50 pointer-events-none"
                style={{
                  left: `${currentTime * PIXELS_PER_SECOND}px`,
                  // Head sits on the picture, below the parking bay.
                  top: PLAYHEAD_TOP,
                  transition: 'left 0.08s linear',
                }}
              >
                {/* Wide invisible drag handle so the needle is easy to grab */}
                <div
                  data-playhead-handle
                  className="absolute top-0 bottom-0 -left-3 w-6 cursor-ew-resize pointer-events-auto"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleNeedleDragStart(e)
                  }}
                />
                {/* Thin riser through the ruler above, so the needle reads against
                    the tick marks. 1px and left-0 to match the ticks exactly, which
                    the 2px body would sit half a pixel off. */}
                <div
                  className="absolute left-0 w-px pointer-events-none"
                  style={{
                    top: -MID_RULER_H,
                    height: MID_RULER_H,
                    background: '#ccfbf1',
                    boxShadow: '0 0 3px rgba(153,246,228,0.9), 0 0 8px rgba(45,212,191,0.7)',
                  }}
                />
                {/* Head. Sits at the needle's own top — the needle already starts at
                    the video track, so the old 64px nudge for the ruler above it
                    would now push the head a track and a half down the picture. */}
                <div
                  className="absolute top-0 -left-[9px] pointer-events-none"
                  style={{
                    width: 0,
                    height: 0,
                    borderLeft: '9px solid transparent',
                    borderRight: '9px solid transparent',
                    borderTop: '14px solid #5eead4',
                    filter: 'drop-shadow(0 0 3px rgba(240,253,250,0.95)) drop-shadow(0 0 9px rgba(45,212,191,0.8)) drop-shadow(0 0 20px rgba(45,212,191,0.45))',
                  }}
                />
                {/* Needle line. top-0/bottom-0 span the needle's own box, which
                    starts at the picture and ends at the foot of the track stack —
                    so it crosses Original, Dubbed, Preview Audio and Emotion, and
                    stays that way if tracks are added below. */}
                {/* Light spill. A shadow alone still reads as a drawn line; a soft wash
                    either side makes the needle look like it is LIGHTING the tracks it
                    crosses. Sits before the filament so the core paints over it. */}
                <div
                  className="absolute top-0 bottom-0 -left-[10px] w-[22px] pointer-events-none"
                  style={{
                    background:
                      'linear-gradient(to right, rgba(45,212,191,0) 0%, rgba(45,212,191,0.14) 38%, ' +
                      'rgba(45,212,191,0.30) 50%, rgba(45,212,191,0.14) 62%, rgba(45,212,191,0) 100%)',
                  }}
                />
                {/* Filament. White-hot core bleeding to teal at the edges, with the bloom
                    in four falloff stops — one big soft shadow reads as fog, several tight
                    ones read as a source. */}
                <div className="absolute top-0 bottom-0 left-0 w-[2px] pointer-events-none"
                  style={{
                    background: 'linear-gradient(to right, #5eead4, #f0fdfa 50%, #5eead4)',
                    boxShadow:
                      '0 0 3px rgba(240,253,250,0.95), 0 0 8px rgba(45,212,191,0.85), ' +
                      '0 0 18px rgba(45,212,191,0.5), 0 0 32px rgba(45,212,191,0.22)',
                  }} />
              </div>

            </div>
            </SegmentContextMenu>
          </div>
        </div>
        {/* Overview bar — full width, under the track labels as well as the tracks.
            The container's own scrollbar only spans the track area and sits inside a
            panel that scrolls vertically too, so it moves out from under the cursor.
            This is fixed at the bottom and always the whole timeline: the thumb's
            width is the fraction of the film on screen, so it narrows as you zoom in
            and fills the bar when zoomed out. */}
        <div
          ref={overviewBarRef}
          className="h-4 shrink-0 bg-neutral-950 border-t border-neutral-800 relative select-none"
          onPointerDown={(e) => {
            const bar = overviewBarRef.current
            const tl = timelineRef.current
            if (!bar || !tl) return
            try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {}
            const rect = bar.getBoundingClientRect()
            const maxScroll = Math.max(1, tl.scrollWidth - tl.clientWidth)
            const thumbFrac = Math.min(1, tl.clientWidth / Math.max(1, tl.scrollWidth))
            const usable = rect.width * (1 - thumbFrac)
            // Centre the thumb on the press, then track the pointer, so grabbing
            // anywhere on the bar jumps there rather than nudging by a fixed step.
            const thumb = overviewThumbRef.current
            panningRef.current = true
            // Same rule as the timeline pan: everything needed was measured above,
            // so move the thumb from the fraction we just computed rather than
            // re-reading the DOM and forcing a layout on every pointermove.
            const seek = (clientX: number) => {
              const x = clientX - rect.left - (rect.width * thumbFrac) / 2
              const frac = usable > 0 ? Math.min(1, Math.max(0, x / usable)) : 0
              tl.scrollLeft = frac * maxScroll
              if (thumb) thumb.style.left = `${frac * (1 - thumbFrac) * 100}%`
            }
            seek(e.clientX)
            const onMove = (ev: PointerEvent) => {
              if (ev.buttons === 0) { onUp(); return }
              seek(ev.clientX)
            }
            function onUp() {
              panningRef.current = false
              document.removeEventListener('pointermove', onMove)
              document.removeEventListener('pointerup', onUp)
              document.removeEventListener('pointercancel', onUp)
              window.removeEventListener('blur', onUp)
            }
            document.addEventListener('pointermove', onMove)
            document.addEventListener('pointerup', onUp)
            document.addEventListener('pointercancel', onUp)
            window.addEventListener('blur', onUp)
          }}
        >
          {(() => {
            const tl = timelineRef.current
            const total = tl ? Math.max(1, tl.scrollWidth) : 1
            const view = tl ? tl.clientWidth : 1
            const frac = Math.min(1, view / total)
            const pos = total > view ? (tl!.scrollLeft / (total - view)) * (1 - frac) : 0
            return (
              <div
                // The ref MUST be here: syncOverviewThumb writes this element's style
                // directly on scroll and on pan, and without it that function returned
                // early every time and the thumb never moved. The values below are the
                // first paint only — React does not re-render on scroll by design.
                ref={overviewThumbRef}
                className="absolute top-0.5 bottom-0.5 rounded bg-amber-500/40 hover:bg-amber-500/60 transition-colors"
                style={{ left: `${pos * 100}%`, width: `${frac * 100}%` }}
              />
            )
          })()}
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
      {/* Editor lock — a shield, not a set of disabled buttons.
          Covering everything is complete by construction: there is no control
          I could have forgotten to disable, because nothing underneath is
          reachable. It survives a reload (persisted in localStorage), which is
          the point — you lock it and walk away.
          Not security: it stops accidents, not people. Anyone can press Unlock. */}
      {layoutLocked && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center
                        bg-neutral-950/70 backdrop-blur-sm cursor-not-allowed">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/40
                          bg-neutral-900/95 px-8 py-7 shadow-[0_0_40px_rgba(251,191,36,0.15)]">
            <div className="h-12 w-12 rounded-full bg-amber-400/15 flex items-center justify-center">
              <Lock className="h-6 w-6 text-amber-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-white tracking-wide">Editor locked</p>
              <p className="text-xs text-slate-400 mt-1 max-w-[16rem]">
                Nothing can be moved or changed. Your work stays exactly as you left it.
              </p>
            </div>
            <button
              type="button"
              onClick={toggleLayoutLock}
              className="mt-1 inline-flex items-center gap-1.5 rounded-full px-5 py-1.5
                         border border-amber-400/60 bg-amber-400/10 text-amber-200
                         hover:bg-amber-400/20 hover:border-amber-300 text-xs font-bold
                         uppercase tracking-widest transition-colors cursor-pointer"
            >
              <Unlock className="h-3.5 w-3.5" />
              Unlock
            </button>
          </div>
        </div>
      )}

      {engineNotice && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-3.5 py-2 rounded-full
                        border border-amber-500/40 bg-neutral-900/95 shadow-lg
                        text-xs text-amber-200 flex items-center gap-2 pointer-events-none">
          <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" />
          {engineNotice}
        </div>
      )}

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
                      speed: stagedSpeeds[keyAt(idx)] ?? 1.0,
                      emotion: stagedEmotions[keyAt(idx)] ?? seg.committed_emotion,
                      voice_key: stagedVoices[keyAt(idx)] ?? speakerVoiceMap[seg.speaker_id],
                      pitch: stagedPitches[keyAt(idx)] ?? speakerPitchMap[seg.speaker_id] ?? 0,
                      force_timing: true,
                    })
                    const filename = response.segment.path.split('/').pop() ?? ''
                    const audio_url = filename ? apiClient.getAudioFileUrl(jobId, filename, true) : seg.audio_url
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
                      commitOrStage(seg.transcript_index ?? idx, {
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
