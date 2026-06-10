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
  Clapperboard,
  Save,
  Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import { VoiceLibraryPanel } from '@/components/voice-library-modal'
import { CharacterProfilePopover } from '@/components/editor/character-profile-popover'
import { useEditorStore, type SidebarTab } from '@/lib/editor-store'
import type { Segment, QCScore, QCFinding, QCFindingType, QCReport } from '@/lib/editor-types'
import { formatTime, getSpeakerColor } from '@/lib/editor-types'
import { buildMockQCReport } from '@/lib/qc-mock-data'
import { QCQualityPanel } from '@/components/editor/qc-quality-panel'
import { SegmentQCPanel } from '@/components/editor/segment-qc-panel'
import { QCTicker } from '@/components/editor/qc-ticker'
import { EmotionLedTrack } from '@/components/editor/emotion-led-track'
import { FloatingEmotionChart } from '@/components/editor/floating-emotion-chart'
import { AdaptationPanel } from '@/components/editor/adaptation-panel'
import VelmaPanel from '@/components/editor/velma-panel'
import { HeatmapBar } from '@/components/timeline/HeatmapBar'
import { SpeakerVoicePanel } from '@/components/editor/speaker-voice-panel'
import { EmotionalIntelligencePanel } from '@/components/editor/emotional-intelligence-panel'
import { ExportModal } from '@/components/editor/export-modal'
import { requestRPTStitch, stitchRPT, invalidateCache, scheduleRPTPlayback } from '@/lib/rpt-engine'
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
import { LayoutList, AudioLines, Zap, GitBranch } from 'lucide-react'

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
  onDelete: (index: number) => void
  onToggleLock: (index: number) => void
  onTogglePair: (index: number) => void
  onRevert: (index: number) => void
  onSetEmotion: (index: number, emotion: string) => void
  onClearEmotion: (index: number) => void
  onSelect: (index: number) => void
  onRenameSpeaker: (index: number) => void
  onShowProfile: (index: number, x: number, y: number) => void
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
  onDelete,
  onToggleLock,
  onTogglePair,
  onRevert,
  onSetEmotion,
  onClearEmotion,
  onSelect,
  onRenameSpeaker,
  onShowProfile,
}: SegmentContextMenuProps) {
  const [showEmotions, setShowEmotions] = useState(false)
  const coordsRef = useRef({ x: 0, y: 0 })
  return (
    <ContextMenu onOpenChange={(open) => { if (!open) setShowEmotions(false) }}>
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
          {lockedPairs.has(index) ? '🔗 Unpair' : '🔗 Pair with Original'}
          <ContextMenuShortcut>U</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={(e) => { e.stopPropagation(); onRevert(index) }} className="text-xs gap-2">
          ↩️ Revert to Original
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
  } = useEditorStore()

  const importedSegments = useEditorStore((state) => state.importedSegments)
  const importedSegmentsJobId = useEditorStore((state) => state.importedSegmentsJobId)
  const setImportedSegmentsRaw = useEditorStore((state) => state.setImportedSegments)
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

  const [showExportModal, setShowExportModal] = useState(false)
  const [layoutLocked, setLayoutLocked] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('dubverse.editor.layoutLocked') === 'true'
    }
    return false
  })

  // Right preview panel tab: Result (video) | Quality (QC) | Studio
  const [rightPanelTab, setRightPanelTab] = useState<'result' | 'quality' | 'velma' | 'studio' | 'adaptation' | 'speakers' | 'library' | 'emotions' | 'chord'>('result')

  // QC report — real data from /api/analysis when available, otherwise mock
  const [qcReport, setQcReport] = useState<QCReport | null>(() =>
    qcAnalysis ? mapAnalysisToQCReport(jobId || 'demo', qcAnalysis) : buildMockQCReport(jobId || 'demo')
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
    createClient().auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      const name = (user.user_metadata?.full_name as string | undefined) || user.email || ''
      const parts = name.trim().split(/\s+/)
      setUserInitials(
        parts.length >= 2
          ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
          : name.slice(0, 2).toUpperCase()
      )
    })
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
  const [emotionSource, setEmotionSource] = useState<'auto' | 'manual'>('auto')
  const [floatingEmotionSegment, setFloatingEmotionSegment] = useState<number | null>(null)

  const [activeDubbedVideoUrl, setActiveDubbedVideoUrl] = useState(dubbedVideoUrl)
  const [isRebuilding, setIsRebuilding] = useState(false)
  const [rebuildError, setRebuildError] = useState<string | null>(null)
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
  const [addSegmentFeedback, setAddSegmentFeedback] = useState<'success' | 'error' | null>(null)
  const [pendingOverwriteIndex, setPendingOverwriteIndex] = useState<number | null>(null)
  const [shareCopied, setShareCopied] = useState<'link' | 'video' | null>(null)
  const [askAiOpen, setAskAiOpen] = useState(false)
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
  const [draggedVoice, setDraggedVoice] = useState<string | null>(null)
  const [groupSelectedSegments, setGroupSelectedSegments] = useState<Set<number>>(new Set())
  const [selectionDrag, setSelectionDrag] = useState<{
    startX: number
    startY: number
    currentX: number
    currentY: number
  } | null>(null)
  const [groupMoveActive, setGroupMoveActive] = useState(false)
  const [groupMoveOffset, setGroupMoveOffset] = useState({ x: 0, y: 0 })
  const [voicePaletteOpen, setVoicePaletteOpen] = useState(false)
  const [voiceDragOverIndex, setVoiceDragOverIndex] = useState<number | null>(null)
  const [voiceAppliedFeedback, setVoiceAppliedFeedback] = useState<{ segmentIndex: number; voiceName: string } | null>(null)
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
        apiClient.commitSegmentTiming(jobId, drag.index, {
          committed_start_time: newStart,
          committed_end_time: newEnd,
        }).catch(err => console.warn('[COMMIT-TIMING]', err))
        setImportedSegments(prev => {
          const base = prev ?? displaySegmentsRef.current
          return base.map((seg, i) =>
            i === drag.index ? { ...seg, start_time: newStart, end_time: newEnd } : seg
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
            setStagedVoices(prev => ({ ...prev, [hit.index]: parsed.voice_id }))
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
  // Synchronous in-flight guard — avoids the stale-closure race that React state
  // alone can't prevent when draining the queue on the next macrotask.
  const isRegeneratingRef = useRef(false)
  // Pending regen while one is in flight (depth 1, last-write-wins).
  const regenQueueRef = useRef<{ segIdx?: number; voiceOverride?: string; textOverride?: string } | null>(null)
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

  // Unique speakers across all segments — used for reassignment dropdown
  const uniqueSpeakers = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; gender: 'male' | 'female' | 'child' }>()
    displaySegments.forEach(seg => {
      if (seg.speaker_id && !seen.has(seg.speaker_id)) {
        seen.set(seg.speaker_id, {
          id: seg.speaker_id,
          label: seg.speaker_label || seg.speaker_id,
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
    const leftSegment = { ...segment, end_time: currentTime }
    const rightSegment = { ...segment, id: `split-${Date.now()}`, start_time: currentTime, target_text: '', source_text: '', active_text: '', preview_text: null }
    setImportedSegments(prev => {
      const base = prev ?? displaySegments
      const result = [...base]
      result.splice(index, 1, leftSegment, rightSegment)
      return result
    })
  }, [displaySegments, currentTime])

  const handleSplitAtWord = useCallback((index: number, wordIndex: number) => {
    const segment = displaySegments[index]
    if (!segment || wordIndex <= 0) return
    const words = segment.target_text.split(' ')
    if (wordIndex >= words.length) return
    const leftText = words.slice(0, wordIndex).join(' ')
    const rightText = words.slice(wordIndex).join(' ')
    const splitRatio = wordIndex / words.length
    const splitTime = segment.start_time + splitRatio * (segment.end_time - segment.start_time)
    const leftSegment = { ...segment, end_time: splitTime, target_text: leftText }
    const rightSegment = { ...segment, id: `split-${Date.now()}`, start_time: splitTime, target_text: rightText }
    setImportedSegments(prev => {
      const base = prev ?? displaySegments
      const result = [...base]
      result.splice(index, 1, leftSegment, rightSegment)
      return result
    })
    setSplitWordMode(null)
  }, [displaySegments])

  const handleAddSegmentAfter = useCallback((index: number) => {
    const segment = displaySegments[index]
    if (!segment) return
    const newSegment = {
      ...segment,
      id: `new-${Date.now()}`,
      index: index + 1,
      start_time: segment.end_time,
      end_time: segment.end_time + 2,
      target_text: segment.target_text,
      active_text: segment.active_text,
      preview_text: null,
      source_text: '',
      audio_url: undefined,
      committed_audio_url: undefined,
      committed_start_time: undefined,
      committed_end_time: undefined,
      committed_adapted_text: undefined,
      status: 'auto' as const,
    }
    const expectedLength = displaySegments.length + 1
    setImportedSegments(prev => {
      const base = prev ?? displaySegments
      const result = [...base]
      result.splice(index + 1, 0, newSegment)
      return result
    })
    selectSegment(index + 1)
    // Verify the splice actually rendered. On the next tick, displaySegments
    // should have grown by 1. If it hasn't, the gate swallowed the write.
    setTimeout(() => {
      const grew = displaySegmentsRef.current.length === expectedLength
      setAddSegmentFeedback(grew ? 'success' : 'error')
      setTimeout(() => setAddSegmentFeedback(null), grew ? 2000 : 4000)
    }, 50)
  }, [displaySegments, selectSegment])

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

  // Keyboard shortcuts — U: pair lock, M: QC group lock
  // Placed after displaySegments and qcBoxPosition so dep array has no TDZ
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape — clear group selection and move state
      if (e.key === 'Escape') {
        setGroupSelectedSegments(new Set())
        setSelectionDrag(null)
        setGroupMoveActive(false)
        groupMoveActiveRef.current = false
        setGroupMoveOffset({ x: 0, y: 0 })
        return
      }

      if (e.key === 'u' || e.key === 'U') {
        const target = e.target as HTMLElement
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.contentEditable === 'true'
        ) return
        if (selectedSegmentIndex !== null) {
          setLockedPairs(prev => {
            const next = new Set(prev)
            next.has(selectedSegmentIndex) ? next.delete(selectedSegmentIndex) : next.add(selectedSegmentIndex)
            return next
          })
          setFlashingPair(selectedSegmentIndex)
          setTimeout(() => setFlashingPair(null), 300)
        } else if (lockedPairs.size > 0) {
          setLockedPairs(new Set())
        }
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
  }, [selectedSegmentIndex, lockedPairs, displaySegments, handleSplitAtPlayhead])

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
      // Generate mock segment-level QC data
      const score = Math.floor(Math.random() * 40) + 60 // 60-100
      const problems = [
        'Spoken too fast, sounds mechanical and unnatural',
        'Emotion doesn\'t match the source context',
        'Timing is slightly off from lip movement',
        'Pronunciation unclear on certain words',
        'Delivery lacks energy and expression',
        'Speed variation is inconsistent',
      ]
      const fixes = [
        'Stretch the transcription box on the dubbed track on the timeline until the voice is more natural',
        'Adjust emotion parameter to match source intensity',
        'Fine-tune segment timing to align with lip-sync',
        'Re-record with clearer pronunciation',
        'Increase delivery intensity in the emotion controls',
        'Smooth out speed variations using the timing correction tool',
      ]
      const problemIdx = Math.floor(Math.random() * problems.length)

      return {
        ...seg,
        id: seg.id || `segment-${idx}`,
        index: idx,
        status: seg.status || 'auto',
        qc_findings: qcFindings.filter(f => f.segment_index === idx),
        qc_score: score,
        qc_problem: problems[problemIdx],
        qc_fix: fixes[problemIdx],
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
  
  // Handle video import and automatic transcription
  const handleVideoImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
// Set video URL for preview and store file for waveform extraction
  const url = URL.createObjectURL(file)
  setImportedVideoUrl(url)
  setImportedVideoFile(file)
  
  // Clear previous data
  }, [])
  
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
  
  // Get the actual video URL to use (imported or original)
  const activeVideoUrl = importedVideoUrl || ((playbackMode === 'dubbed' || playbackMode === 'preview') && activeDubbedVideoUrl ? activeDubbedVideoUrl : videoUrl)
  
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

      // Only restart if video is playing
      if (!isPlaying) return

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
  const handleSegmentClick = useCallback((index: number) => {
    selectSegment(index)
  }, [selectSegment])
  
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

  const handleTimelineMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start selection with Shift key
    if (!e.shiftKey) return

    // Don't start selection if clicking on a segment block or resize handle
    const target = e.target as HTMLElement
    if (target.closest('[data-segment-block]') || target.closest('[data-resize-handle]')) return

    e.preventDefault()
    e.stopPropagation()

    const container = e.currentTarget as HTMLElement
    const rect = container.getBoundingClientRect()
    const startX = e.clientX - rect.left
    const startY = e.clientY - rect.top

    setSelectionDrag({ startX, startY, currentX: startX, currentY: startY })
  }, [])

  const handleTimelineMouseMove = useCallback((e: React.MouseEvent) => {
    // Handle group movement during move phase
    if (groupMoveActiveRef.current) {
      setGroupMoveOffset({
        x: e.clientX - groupMoveStartXRef.current,
        y: 0
      })
      return
    }

    // Handle normal selection rectangle drag
    if (!selectionDrag) return

    const container = e.currentTarget as HTMLElement
    const rect = container.getBoundingClientRect()
    const currentX = e.clientX - rect.left
    const currentY = e.clientY - rect.top

    setSelectionDrag(prev => prev ? { ...prev, currentX, currentY } : null)
  }, [selectionDrag])

  const handleTimelineMouseUp = useCallback((e: React.MouseEvent) => {
    if (!selectionDrag) return

    // Define helpers inside callback — no closure risk, tight scope
    const getSelectionRect = () => {
      const x1 = Math.min(selectionDrag.startX, selectionDrag.currentX)
      const x2 = Math.max(selectionDrag.startX, selectionDrag.currentX)
      const y1 = Math.min(selectionDrag.startY, selectionDrag.currentY)
      const y2 = Math.max(selectionDrag.startY, selectionDrag.currentY)
      return { x1, x2, y1, y2, width: x2 - x1, height: y2 - y1 }
    }

    const checkSegmentIntersection = (index: number, selectionRect: ReturnType<typeof getSelectionRect>) => {
      const block = document.querySelector(`[data-segment-block-index="${index}"]`) as HTMLElement
      if (!block) return false
      const rect = block.getBoundingClientRect()
      const container = document.querySelector('[data-timeline-container]') as HTMLElement
      if (!container) return false
      const containerRect = container.getBoundingClientRect()

      // Adjust block position relative to container
      const blockX1 = rect.left - containerRect.left
      const blockX2 = blockX1 + rect.width
      const blockY1 = rect.top - containerRect.top
      const blockY2 = blockY1 + rect.height

      // Check intersection
      return !(selectionRect.x2 < blockX1 ||
              selectionRect.x1 > blockX2 ||
              selectionRect.y2 < blockY1 ||
              selectionRect.y1 > blockY2)
    }

    const selectionRect = getSelectionRect()
    if (!selectionRect) {
      setSelectionDrag(null)
      return
    }

    // Find all intersecting segments
    const selected = new Set<number>()
    displaySegments.forEach((_, index) => {
      if (checkSegmentIntersection(index, selectionRect)) {
        selected.add(index)
      }
    })

    setGroupSelectedSegments(selected)
    setSelectionDrag(null)
    setGroupMoveOffset({ x: 0, y: 0 })
  }, [selectionDrag, displaySegments])

  const handleTimelineMouseUpWrapper = useCallback((e: React.MouseEvent) => {
    // Handle group movement end
    if (groupMoveActiveRef.current) {
      const timeDelta = groupMoveOffset.x / PIXELS_PER_SECOND

      displaySegments.forEach((segment, index) => {
        if (groupSelectedSegments.has(index)) {
          const newStartTime = Math.max(0, segment.start_time + timeDelta)
          const newEndTime = Math.max(0, segment.end_time + timeDelta)

          updateSegment(index, {
            start_time: newStartTime,
            end_time: newEndTime,
          })

          setImportedSegments(prev => {
            if (!prev) return prev
            return prev.map((seg, i) =>
              i === index
                ? { ...seg, start_time: newStartTime, end_time: newEndTime }
                : seg
            )
          })
        }
      })

      setGroupMoveActive(false)
      groupMoveActiveRef.current = false
      return
    }

    // Handle normal selection freeze
    handleTimelineMouseUp(e)
  }, [groupMoveOffset, groupSelectedSegments, displaySegments])

  const handleClearSegment = useCallback((index: number) => {
    const original = initialSegments[index]
    const filename = (original?.audio_url ?? '').split('/').pop() ?? ''
    const audio_url = filename ? apiClient.getAudioFileUrl(jobId, filename) : undefined
    const clearedFields = {
      target_text: original?.target_text ?? '',
      active_text: original?.target_text ?? '',
      variant_text: original?.target_text ?? '',
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
    }
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
  const handleGenerateSpeech = useCallback(async (segIdx?: number, voiceOverride?: string, textOverride?: string): Promise<boolean> => {
    const activeIndex = segIdx ?? selectedSegmentIndex
    console.log('[REGEN] called', { segIdx, voiceOverride, textOverride, activeIndex, isRegenerating, selectedSegmentIndex })
    if (activeIndex === null) { console.warn('[REGEN] aborted — activeIndex null'); return false }
    if (isRegeneratingRef.current) {
      // Queue instead of dropping (depth 1, last-write-wins); drained in finally.
      regenQueueRef.current = { segIdx, voiceOverride, textOverride }
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

    if (lockedSegments.has(activeIndex)) {
      setLockedSegments(prev => {
        const next = new Set(prev)
        next.delete(activeIndex)
        return next
      })
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
      })
      console.log('[REGEN] backend response', { path: response.segment.path, voice_id: response.segment.voice_id, status: response.status })
      const filename = response.segment.path.split('/').pop() ?? ''
      const audio_url = filename
        ? `${apiClient.getAudioFileUrl(jobId, filename)}?ts=${Date.now()}`
        : segment.audio_url
      updateSegment(activeIndex, {
        audio_url,
        status: 'edited',
        start_time: response.segment.start ?? segment.start_time,
        end_time: response.segment.end ?? segment.end_time,
      })
      setImportedSegments(prev => {
        if (!prev) return prev
        return prev.map((seg, i) => i === activeIndex
          ? {
              ...seg,
              audio_url,
              committed_audio_url: audio_url,
              status: 'edited' as const,
              committed_emotion: stagedEmotions[activeIndex] ?? seg.committed_emotion,
              start_time: response.segment.start ?? seg.start_time,
              end_time: response.segment.end ?? seg.end_time,
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
            start_time: isActiveSegment ? (response.segment.start ?? seg.start_time) : seg.start_time,
            end_time: isActiveSegment ? (response.segment.end ?? seg.end_time) : seg.end_time,
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
          handleGenerateSpeechRef.current(queued.segIdx, queued.voiceOverride, queued.textOverride)
        }, 0)
      }
    }
  }, [selectedSegmentIndex, isRegenerating, displaySegments, jobId, droppedTranslations, updateSegment, stagedSpeeds, lockedSegments, selectSegment, setImportedSegments, setPlaybackMode, editingText])

  const handleGenerateSpeechRef = useRef(handleGenerateSpeech)
  handleGenerateSpeechRef.current = handleGenerateSpeech
  const displaySegmentsRef = useRef(displaySegments)
  displaySegmentsRef.current = displaySegments

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
        toSave.map(seg =>
          fetch(`${base}/api/segment/commit/${jobId}/${seg.index}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              committed_audio_url: seg.committed_audio_url,
              committed_adapted_text: seg.committed_adapted_text,
              committed_start_time: seg.committed_start_time,
              committed_end_time: seg.committed_end_time,
            }),
          })
        )
      )
    } finally {
      setIsSaving(false)
    }
  }, [isSaving, displaySegments, jobId])

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

  const handleTimelineDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])
  
  // Start editing a segment — immediately enters preview mode
  const startEditing = useCallback((index: number) => {
    const currentText = displaySegments[index]?.active_text ?? displaySegments[index]?.target_text ?? ''
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
      apiClient.commitSegmentTiming(jobId, idx, { committed_adapted_text: text }).catch(err =>
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
  
  // Get language display name
  const getLanguageName = (code: string) => {
    const names: Record<string, string> = {
      'zh': 'Cantonese (China)',
      'zh-CN': 'Cantonese (China)',
      'en': 'English',
      'en-US': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'ja': 'Japanese',
      'ko': 'Korean',
    }
    return names[code] || code
  }
  
  const EMOTIONS = ['Neutral', 'Happy', 'Excited', 'Calm', 'Sad', 'Angry', 'Fearful', 'Surprised', 'Disgusted', 'Professional', 'Casual', 'Formal', 'Intimate', 'Defiant', 'Confused', 'Whisper', 'Shout', 'Sarcastic', 'Hopeful', 'Melancholic']
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
      <header className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-900">
        <div className="flex items-center gap-4">
          {/* Logo */}
          <Link href="/studio" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <span className="text-white font-bold text-sm">D</span>
            </div>
            <span className="font-bold text-lg text-white">DubMaster</span>
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
          <div className="flex flex-col items-start gap-1">
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-7 text-xs font-bold tracking-wide",
                rebuildStatus === 'idle' && "border-slate-700",
                rebuildStatus === 'processing' && "border-red-500 text-red-400 animate-pulse shadow-[0_0_14px_rgba(239,68,68,0.6)]",
                rebuildStatus === 'complete' && "border-emerald-500 text-emerald-400 shadow-[0_0_14px_rgba(16,185,129,0.6)]",
                rebuildStatus === 'error' && "border-slate-700",
              )}
              onClick={handleRebuildVideo}
              disabled={isRebuilding}
            >
              {rebuildStatus === 'complete'
                ? <Check className="h-3 w-3 mr-1" />
                : <RefreshCw className={cn("h-3 w-3 mr-1", isRebuilding && "animate-spin")} />}
              {rebuildStatus === 'processing' ? 'REBUILD IN PROCESS'
                : rebuildStatus === 'complete' ? 'REBUILD COMPLETE'
                : 'Rebuild Video'}
            </Button>
            {(isRebuilding || rebuildProgress > 0) && (
              <div className="h-1 bg-neutral-700 rounded-full overflow-hidden w-32">
                <div className="h-full bg-amber-500 rounded-full transition-all duration-500"
                  style={{ width: `${rebuildProgress}%` }} />
              </div>
            )}
            {rebuildError && (
              <span className="text-[10px] text-red-400 max-w-[160px] truncate">{rebuildError}</span>
            )}
          </div>
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
          <Button variant="ghost" size="sm" className="h-8">
            <RefreshCw className="h-4 w-4" />
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
                    className="flex-1 flex flex-col items-center gap-1 py-2 rounded-lg bg-[#1877F2]/10 hover:bg-[#1877F2]/25 text-[#1877F2] border border-[#1877F2]/20 hover:border-[#1877F2]/50 transition-colors"
                    onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '')}`, '_blank', 'width=600,height=400')}
                  >
                    <Facebook className="h-4 w-4" />
                    <span className="text-[9px] font-medium">Facebook</span>
                  </button>
                  {/* Twitter / X */}
                  <button
                    type="button"
                    title="Share to X (Twitter)"
                    className="flex-1 flex flex-col items-center gap-1 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white border border-white/10 hover:border-white/30 transition-colors"
                    onClick={() => window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '')}&text=${encodeURIComponent(`Check out my dubbed video — ${title}`)}`, '_blank', 'width=600,height=400')}
                  >
                    <Twitter className="h-4 w-4" />
                    <span className="text-[9px] font-medium">X / Twitter</span>
                  </button>
                  {/* YouTube */}
                  <button
                    type="button"
                    title="Upload to YouTube"
                    className="flex-1 flex flex-col items-center gap-1 py-2 rounded-lg bg-[#FF0000]/10 hover:bg-[#FF0000]/20 text-[#FF0000] border border-[#FF0000]/20 hover:border-[#FF0000]/50 transition-colors"
                    onClick={() => window.open('https://studio.youtube.com/channel/upload', '_blank')}
                  >
                    <Youtube className="h-4 w-4" />
                    <span className="text-[9px] font-medium">YouTube</span>
                  </button>
                  {/* Instagram — copy link (no web API) */}
                  <button
                    type="button"
                    title="Copy link for Instagram"
                    className="flex-1 flex flex-col items-center gap-1 py-2 rounded-lg bg-[#E1306C]/10 hover:bg-[#E1306C]/20 text-[#E1306C] border border-[#E1306C]/20 hover:border-[#E1306C]/50 transition-colors"
                    onClick={() => {
                      const url = activeDubbedVideoUrl ?? (typeof window !== 'undefined' ? window.location.href : '')
                      navigator.clipboard.writeText(url)
                      setShareCopied('link')
                      setTimeout(() => setShareCopied(null), 2000)
                    }}
                  >
                    <Instagram className="h-4 w-4" />
                    <span className="text-[9px] font-medium">{shareCopied === 'link' ? 'Copied!' : 'Instagram'}</span>
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
                onClick={() => {
                  setImportedSegments([])
                  setLockedSegments(new Set())
                  setDroppedTranslations([])
                  setWaveformData([])
                  setImportedVideoUrl(null)
                  setImportedVideoFile(null)
                  setVideoThumbnails([])
                }}
                className="cursor-pointer hover:bg-slate-800 text-red-400"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear All
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowRevertAllConfirm(true)}
                className="cursor-pointer hover:bg-red-950/50 text-red-400"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Revert All Changes
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
            className="h-8 bg-slate-600 hover:bg-slate-700 text-white font-medium"
            onClick={() => router.push('/studio')}
          >
            <Clapperboard className="h-4 w-4 mr-1" />
            Studio
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
            <div className="text-sm font-medium text-slate-300">{getLanguageName(sourceLanguage)}</div>
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
                  if (worst) {
                    setCurrentTime(worst.timestamp_start)
                    setRightPanelTab('quality')
                  }
                }}
              />
            </div>
            <div className="text-sm font-medium text-slate-300">{getLanguageName(targetLanguage)}</div>
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
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
              <Upload className="h-12 w-12 text-neutral-500" />
              <div>
                <p className="text-lg font-medium text-neutral-300">No video loaded</p>
                <p className="text-sm text-neutral-500 mt-1">Click "Import Video" to upload a video and automatically transcribe it</p>
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
                  onDelete={(idx) => setPendingDelete(idx)}
                  onToggleLock={(idx) => setLockedSegments(prev => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next })}
                  onTogglePair={(idx) => setLockedPairs(prev => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next })}
                  onRevert={() => handleRevert()}
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
                    queuedSegmentIndex === index && 'ring-1 ring-cyan-400/60',
                  )}
                  onClick={() => {
                    selectSegment(index)
                    setCurrentTime(displaySegments[index].start_time)
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
                          setStagedVoices(prev => ({ ...prev, [index]: parsed.voice_id }))
                          selectSegment(index)
                          setCurrentTime(displaySegments[index].start_time)
                          console.log('[VOICE-DROP] calling handleGenerateSpeech', { index, voice_id: parsed.voice_id })
                          handleGenerateSpeech(index, parsed.voice_id).then(ok => {
                            if (ok) {
                              console.log('[VOICE-DROP] regen succeeded — showing applied chip', { index, voiceName: parsed.name })
                              setVoiceAppliedFeedback({ segmentIndex: index, voiceName: parsed.name })
                              setTimeout(() => setVoiceAppliedFeedback(null), 2200)
                            } else {
                              console.warn('[VOICE-DROP] regen failed — no confirmation chip')
                            }
                          })
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
                    setStagedVoices(prev => ({ ...prev, [index]: vk }))
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
                      <div className={cn('flex items-center gap-1.5 pl-1 pr-4 py-1 rounded-full border text-xs font-medium shrink-0', speakerColor.bg, speakerColor.text, speakerColor.border)}>
                        <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 bg-black/30">
                          {speakerNumberMap[segment.speaker_id] ?? 1}
                        </span>
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
                            className={cn('flex items-center gap-1.5 pl-1 pr-4 py-1 rounded-full border text-xs font-medium shrink-0 cursor-pointer', speakerColor.bg, speakerColor.text, speakerColor.border)}
                            onClick={(e) => e.stopPropagation()}
                            title="Click to reassign speaker"
                          >
                            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 bg-black/30">
                              {speakerNumberMap[segment.speaker_id] ?? 1}
                            </span>
                            <span>{segment.speaker_label || `Speaker ${speakerNumberMap[segment.speaker_id] ?? 1}`}</span>
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
                        {stagedEmotions[index] ? (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-mono cursor-pointer hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/30 transition-colors group"
                            title="Click to remove emotion"
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
                            ({stagedEmotions[index].toLowerCase()})
                            <X className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </span>
                        ) : (
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
                        {inlineEmotionWriteIn === index && (
                          <div
                            className="w-full mt-1 p-2 rounded-xl border border-cyan-500/40 bg-[#0d1525] shadow-lg shadow-cyan-900/30"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="text"
                              autoFocus
                              placeholder="Type a custom emotion (e.g. bitterly resigned)…"
                              value={customEmotionDrafts[index] ?? ''}
                              onChange={(e) => setCustomEmotionDrafts(prev => ({ ...prev, [index]: e.target.value }))}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const draft = (customEmotionDrafts[index] ?? '').trim()
                                  if (draft) {
                                    setStagedEmotions(prev => ({ ...prev, [index]: draft }))
                                    selectSegment(index)
                                  }
                                  setInlineEmotionWriteIn(null)
                                }
                              }}
                              className="w-full text-[11px] px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-cyan-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60"
                            />
                          </div>
                        )}
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
                            onDoubleClick={() => !lockedSegments.has(index) && !segment.isPreviewing && startEditing(index)}
                          >
                            {lockedSegments.has(index) && <Lock className="h-3 w-3 shrink-0" />}
                            {segment.preview_text ?? segment.active_text ?? segment.target_text}
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
            <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-400" onClick={handleRevert} disabled={selectedSegmentIndex === null}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Revert to Original
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
            <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-400">
              <Sparkles className="h-4 w-4 mr-1" />
              Pronunciation
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
                    ? <><span className="font-mono text-[10px]">({stagedEmotions[selectedSegmentIndex].toLowerCase()})</span></>
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
                    <span className="font-mono text-[10px] text-slate-500 mr-2 w-20 shrink-0">
                      ({emotion.toLowerCase()})
                    </span>
                    {emotion}
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
              <span>This will remove all edits and return to the original pipeline output. Are you sure?</span>
              <Button size="sm" className="h-6 text-xs bg-red-600 hover:bg-red-700 text-white px-2"
                onClick={() => {
                  setImportedSegments(null)
                  setLockedSegments(new Set())
                  setStagedSpeeds({})
                  setStagedEmotions({})
                  setLockedPairs(new Set())
                  setGroupedSegments(new Set())
                  selectSegment(null)
                  setCurrentTime(0)
                  if (videoRef.current) videoRef.current.currentTime = 0
                  setShowRevertAllConfirm(false)
                }}>
                Revert
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
                { id: 'result', label: 'Video' },
                { id: 'quality', label: 'Quality' },
                { id: 'velma', label: 'Velma' },
                { id: 'studio', label: 'Studio' },
                { id: 'adaptation', label: 'Adaptation' },
                { id: 'speakers', label: 'Speakers' },
                { id: 'library', label: 'Voice Library' },
                { id: 'emotions', label: 'E.I.' },
                { id: 'chord', label: 'Chord' },
              ] as const).map((t) => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => {
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

          {/* Result tab — Video (always mounted to keep ref stable; hidden when not active) */}
          <div
            className="flex-1 min-h-0 relative bg-black"
            style={{ display: rightPanelTab === 'result' ? 'block' : 'none' }}
          >
            <video
              ref={videoRef}
              src={activeVideoUrl}
              className="absolute top-0 left-0 w-full h-full object-cover"
              onTimeUpdate={handleVideoTimeUpdate}
              controls={false}
            />
            {selectedSegmentIndex !== null && displaySegments[selectedSegmentIndex] && (
              <div className="absolute bottom-8 left-0 right-0 text-center">
                <span className="bg-black/75 px-4 py-2 rounded text-white text-sm">
                  {displaySegments[selectedSegmentIndex].preview_text ?? displaySegments[selectedSegmentIndex].active_text ?? displaySegments[selectedSegmentIndex].target_text}
                </span>
              </div>
            )}
            <div className="absolute bottom-2 right-2 flex items-center gap-1 text-xs text-slate-500">
              <span>Video Translated by DubMaster</span>
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
          {rightPanelTab === 'velma' && (
            <div className="flex-1 min-h-0 overflow-y-auto bg-neutral-950">
              <VelmaPanel
                segment={selectedSegmentIndex !== null ? displaySegments[selectedSegmentIndex] : null}
                voices={[]}
                setRightPanelTab={setRightPanelTab}
              />
            </div>
          )}

          {/* Studio tab — placeholder */}
          {rightPanelTab === 'studio' && (
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
              <VoiceLibraryPanel />
            </div>
          )}

          {rightPanelTab === 'emotions' && (
            <EmotionalIntelligencePanel
              jobId={jobId}
              selectedSegmentIndex={selectedSegmentIndex}
              onApplyChord={(emotion, state, trait, intensity) => {
                if (selectedSegmentIndex !== null) {
                  setStagedEmotions(prev => ({ ...prev, [selectedSegmentIndex]: emotion }))
                  updateSegment(selectedSegmentIndex, { committed_emotion: emotion })
                }
              }}
            />
          )}

          {/* Chord tab — always mounted to preserve curve state; hidden when not active */}
          <div
            className="flex-1 min-h-0 flex flex-col overflow-hidden"
            style={{ display: rightPanelTab === 'chord' ? 'flex' : 'none' }}
          >
            {floatingEmotionSegment !== null && displaySegments[floatingEmotionSegment] ? (
              <FloatingEmotionChart
                embedded
                segment={displaySegments[floatingEmotionSegment]}
                segmentIndex={floatingEmotionSegment}
                jobId={jobId}
                onClose={() => { setFloatingEmotionSegment(null); setRightPanelTab('result') }}
                onCommitEmotion={(idx, emotion) => {
                  setStagedEmotions(prev => ({ ...prev, [idx]: emotion }))
                  updateSegment(idx, { committed_emotion: emotion })
                }}
                onUpdateCurve={(idx, curve) => {
                  updateSegment(idx, { velma_emotion_curve: curve })
                }}
                onUpdateProgression={(idx, markers) => {
                  updateSegment(idx, { velma_progression: markers })
                }}
                onSaveChord={async (name, chord, intensity) => {
                  await apiClient.saveEmotionalChord({
                    name,
                    emotion: chord.emotion,
                    state: chord.state,
                    trait: chord.trait,
                    intensity,
                  })
                }}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
                Double-click a segment in the Emotion track to edit its chord
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

      {/* Ask AI — draggable floating panel */}
      {askAiOpen && (() => {
        const seg = selectedSegmentIndex !== null ? displaySegments[selectedSegmentIndex] : null
        const QUICK = [
          'Make this sound more natural',
          'Match the character\'s emotion',
          'Shorten to fit lip-sync',
          'Improve the translation',
        ]
        const submit = async (prompt: string) => {
          if (!prompt.trim() || askAiLoading) return
          setAskAiLoading(true)
          setAskAiResult(null)
          try {
            const res = await apiClient.askAI({
              prompt,
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
              className="fixed z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[440px] animate-in fade-in-0 zoom-in-95 duration-150 flex flex-col"
              style={{ left: askAiPos.x, top: askAiPos.y }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag handle / header */}
              <div
                className="flex items-center justify-between px-4 py-3 border-b border-slate-800 cursor-grab active:cursor-grabbing select-none"
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

              <div className="p-4 space-y-3">
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
                      className="px-2 py-1 rounded-full text-[11px] bg-slate-800 hover:bg-amber-500/20 text-slate-400 hover:text-amber-300 border border-slate-700 hover:border-amber-500/40 transition-colors"
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
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
                    placeholder="Ask anything about this segment…"
                    value={askAiPrompt}
                    onChange={e => setAskAiPrompt(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submit(askAiPrompt) }}
                  />
                  <Button
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white shrink-0"
                    onClick={() => submit(askAiPrompt)}
                    disabled={!askAiPrompt.trim() || askAiLoading}
                  >
                    {askAiLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  </Button>
                </div>

                {/* AI response */}
                {askAiLoading && (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    Claude is thinking…
                  </div>
                )}
                {askAiResult && !askAiLoading && (
                  <div className="bg-amber-500/10 border border-amber-500/25 rounded-lg p-3 space-y-2">
                    <p className="text-sm text-amber-200 font-medium">"{askAiResult.suggestion}"</p>
                    {askAiResult.explanation && (
                      <p className="text-xs text-slate-400">{askAiResult.explanation}</p>
                    )}
                    {askAiResult.suggestion && selectedSegmentIndex !== null && (
                      <Button
                        size="sm"
                        className="w-full mt-1 bg-amber-600 hover:bg-amber-700 text-white text-xs h-7"
                        onClick={() => {
                          updateSegment(selectedSegmentIndex, { target_text: askAiResult!.suggestion, active_text: askAiResult!.suggestion, variant_text: askAiResult!.suggestion, preview_text: null, isPreviewing: false, isUserEdited: false, status: 'edited' })
                          setAskAiOpen(false)
                        }}
                      >
                        <Check className="h-3 w-3 mr-1" />
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
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
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
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          {/* Playback controls */}
          <div className="flex items-center gap-2">
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
                  if (isPlaying) videoRef.current.pause()
                  else videoRef.current.play().catch(() => {})
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
              {selectedSegmentIndex !== null
                ? isSegmentPreviewing
                  ? <Pause className="h-4 w-4 text-amber-400" />
                  : <PlayCircle className="h-4 w-4 text-amber-400" />
                : isPlaying
                  ? <Pause className={playbackMode === 'preview' ? 'h-4 w-4 text-amber-400' : 'h-4 w-4'} />
                  : <Play className={playbackMode === 'preview' ? 'h-4 w-4 text-amber-400' : 'h-4 w-4'} />
              }
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 w-8 p-0"
              onClick={() => {
                setIsPlaying(false)
                setCurrentTime(0)
              }}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setCurrentTime(videoDuration)}>
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>
          
          {/* Zoom controls */}
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
                    onClick={() => setEmotionSource('manual')}
                    className={`text-[9px] px-2 py-0.5 rounded font-semibold transition-colors ${
                      emotionSource === 'manual'
                        ? 'bg-violet-400/20 text-violet-300 border border-violet-400/40'
                        : 'text-slate-500 border border-slate-700'
                    }`}
                  >Manual</button>
                </div>
              </div>
            </div>
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
              onMouseDown={handleTimelineMouseDown}
              onMouseMove={handleTimelineMouseMove}
              onMouseUp={handleTimelineMouseUpWrapper}
              onClick={(e) => {
                // Don't move needle during group move
                if (groupMoveActiveRef.current) return

                const target = e.target as HTMLElement
                if (target.closest('[data-segment-block]')) return
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

              {/* Velma heatmap bar */}
              {(() => {
                const activeSegment = selectedSegmentIndex !== null ? displaySegments[selectedSegmentIndex] : null
                return activeSegment ? (
                  <HeatmapBar data={computeHeatmap(activeSegment)} />
                ) : null
              })()}

              {/* Original audio track */}
              <div className="h-14 shrink-0 bg-neutral-900/20 border-b border-neutral-700 relative" data-timeline-track>
                {displaySegments.map((segment, index) => {
                  const isDraggingThis = draggingSegment?.index === index && draggingSegment?.track === 'original'
                  const isDraggingPaired = draggingSegment?.index === index && draggingSegment?.track === 'dubbed' && lockedPairs.has(index)
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
                      onDelete={(idx) => setPendingDelete(idx)}
                      onToggleLock={(idx) => setLockedSegments(prev => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next })}
                      onTogglePair={(idx) => setLockedPairs(prev => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next })}
                      onRevert={revertToOriginal}
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
                    >
                    <div
                      data-segment-drop-zone
                      data-index={index}
                      className={cn(
                        'absolute top-1 bottom-1 bg-blue-500/30 border border-blue-500/50 rounded group',
                        selectedSegmentIndex === index && 'ring-2 ring-amber-400/70 shadow-[0_0_8px_2px_rgba(251,191,36,0.4)] animate-pulse',
                        voiceDragOverIndex === index && 'ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)] animate-pulse',
                        isAssignmentPulse && 'ring-2 ring-amber-400/60 shadow-[0_0_6px_2px_rgba(245,158,11,0.22)] animate-pulse',
                        flashingPair === index && 'ring-1 ring-amber-400',
                        lockedPairs.has(index) && 'shadow-[0_0_8px_2px_rgba(251,191,36,0.6)] animate-pulse',
                        isDraggingThis ? 'cursor-grabbing' : 'cursor-grab'
                      )}
                      style={{
                        left: (segment.start_time + delta) * PIXELS_PER_SECOND,
                        width: (() => {
                          const dur = segment.end_time - segment.start_time
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
                        const originalStart = segment.start_time
                        const originalEnd = segment.end_time
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
                          apiClient.commitSegmentTiming(jobId, index, {
                            committed_start_time: Math.max(0, originalStart + deltaTime),
                            committed_end_time: Math.max(0, originalEnd + deltaTime),
                          }).catch(err => console.warn('[COMMIT-TIMING]', err))
                          if (lockedPairs.has(index)) {
                            updateSegment(index, {
                              start_time: Math.max(0, originalStart + deltaTime),
                              end_time: Math.max(0, originalEnd + deltaTime),
                            })
                          }
                          setImportedSegments(prev => {
                            const base = prev ?? displaySegments
                            return base.map((seg, i) =>
                              i === index
                                ? { ...seg, start_time: Math.max(0, originalStart + deltaTime), end_time: Math.max(0, originalEnd + deltaTime) }
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
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-white/20 rounded-l"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const startX = e.clientX
                          const originalStart = segment.start_time
                          const onMouseMove = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX
                            const newStart = Math.max(0, Math.min(segment.end_time - 0.1, originalStart + dx / PIXELS_PER_SECOND))
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) => i === index ? { ...seg, start_time: newStart } : seg)
                            })
                          }
                          const onMouseUp = () => {
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
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-white/20 rounded-r"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const startX = e.clientX
                          const originalEnd = segment.end_time
                          const onMouseMove = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX
                            const newEnd = Math.max(segment.start_time + 0.1, originalEnd + dx / PIXELS_PER_SECOND)
                            setImportedSegments(prev => {
                              const base = prev ?? displaySegments
                              return base.map((seg, i) => i === index ? { ...seg, end_time: newEnd } : seg)
                            })
                          }
                          const onMouseUp = () => {
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
                      onDelete={(idx) => setPendingDelete(idx)}
                      onToggleLock={(idx) => setLockedSegments(prev => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next })}
                      onTogglePair={(idx) => setLockedPairs(prev => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next })}
                      onRevert={revertToOriginal}
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
                    >
                    <div
                      data-segment-drop-zone
                      data-index={index}
                      className={cn(
                        'absolute top-1 bottom-1 rounded group border transition-colors',
                        bgColor,
                        groupSelectedSegments.has(index)
                          ? 'border-yellow-400/70 shadow-[0_0_12px_rgba(250,204,21,0.4)] ring-1 ring-yellow-400/50'
                          : 'border-slate-400/30',
                        selectedSegmentIndex === index && 'ring-2 ring-amber-400/70 shadow-[0_0_8px_2px_rgba(251,191,36,0.4)] animate-pulse',
                        voiceDragOverIndex === index && 'ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)] animate-pulse',
                        flashingPair === index && 'ring-1 ring-amber-400',
                        lockedPairs.has(index) && 'shadow-[0_0_8px_2px_rgba(251,191,36,0.6)] animate-pulse',
                        draggingSegment?.index === index && draggingSegment?.track === 'dubbed' ? 'cursor-grabbing' : 'cursor-grab'
                      )}
                      style={{
                        left: (() => {
                          const isDraggingThis = draggingSegment?.index === index && draggingSegment?.track === 'dubbed'
                          const isDraggingPaired = draggingSegment?.index === index && draggingSegment?.track === 'original' && lockedPairs.has(index)
                          const delta = (isDraggingThis || isDraggingPaired) ? draggingSegment!.currentDelta : 0
                          const groupDelta = (groupMoveActive && groupSelectedSegments.has(index)) ? groupMoveOffset.x : 0
                          return (segment.start_time + delta) * PIXELS_PER_SECOND + groupDelta
                        })(),
                        width: (() => {
                          const originalDuration = segment.end_time - segment.start_time
                          const activeSpeed = dragSpeedPreview?.index === index
                            ? dragSpeedPreview.speed
                            : (stagedSpeeds[index] ?? 1.0)
                          return (originalDuration / activeSpeed) * PIXELS_PER_SECOND
                        })(),
                      }}
                      data-segment-block={true}
                      data-segment-block-index={index}
                      onClick={() => handleSegmentClick(index)}
                      onDrop={(e) => handleTimelineDrop(e, index)}
                      onDragOver={handleTimelineDragOver}
                      onMouseDown={(e) => {
                        const t = e.target as HTMLElement
                        if (t.closest('[data-resize-handle]')) return

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
                        const startX = e.clientX
                        const originalStart = segment.start_time
                        const originalEnd = segment.end_time
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
                          apiClient.commitSegmentTiming(jobId, index, {
                            committed_start_time: Math.max(0, originalStart + deltaTime),
                            committed_end_time: Math.max(0, originalEnd + deltaTime),
                          }).catch(err => console.warn('[COMMIT-TIMING]', err))
                          if (lockedPairs.has(index)) {
                            updateSegment(index, {
                              start_time: Math.max(0, originalStart + deltaTime),
                              end_time: Math.max(0, originalEnd + deltaTime),
                            })
                          }
                          setImportedSegments(prev => {
                            const base = prev ?? displaySegments
                            return base.map((seg, i) =>
                              i === index
                                ? { ...seg, start_time: Math.max(0, originalStart + deltaTime), end_time: Math.max(0, originalEnd + deltaTime) }
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
                      {/* Left stretch handle */}
                      <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-white/20 rounded-l">
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

                      {/* Right stretch handle */}
                      <div
                        data-resize-handle={true}
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-white/20 rounded-r"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          const startX = e.clientX
                          const originalDuration = segment.end_time - segment.start_time
                          const onMouseMove = (ev: MouseEvent) => {
                            const dx = ev.clientX - startX
                            const newDuration = Math.max(0.1, originalDuration + dx / PIXELS_PER_SECOND)
                            const newSpeed = Math.min(2.0, Math.max(0.5, originalDuration / newDuration))
                            setDragSpeedPreview({ index, speed: newSpeed })
                          }
                          const onMouseUp = () => {
                            setDragSpeedPreview(prev => {
                              if (prev?.index === index) {
                                setStagedSpeeds(s => ({ ...s, [index]: prev.speed }))
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
                    </SegmentContextMenu>
                  )
                })}
              </div>


              {/* RPT Audio track */}
              <div className="h-14 shrink-0 bg-neutral-900/10 border-b border-neutral-700 relative" data-timeline-track>
                {displaySegments.map((seg, i) => {
                  const hasAudio = !!(seg.committed_audio_url ?? seg.audio_url)
                  const startT = seg.start_time ?? seg.committed_start_time ?? 0
                  const endT = seg.end_time ?? seg.committed_end_time ?? startT
                  const groupDelta = (groupMoveActive && groupSelectedSegments.has(i)) ? groupMoveOffset.x : 0
                  return (
                    <div
                      key={seg.id + '-rpt-audio'}
                      data-segment-drop-zone
                      data-index={i}
                      className={cn(
                        'absolute top-1 bottom-1 rounded opacity-70 transition-all',
                        voiceDragOverIndex === i
                          ? 'bg-emerald-500/70 border-2 border-emerald-400 ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.7)] animate-pulse'
                          : !hasAudio
                          ? 'bg-neutral-500/30 border border-neutral-600/50'
                          : regeneratingSegmentIndex === i
                          ? 'bg-amber-500/70 border border-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                          : queuedSegmentIndex === i
                          ? 'bg-cyan-500/40 border border-cyan-400/70 border-dashed animate-pulse'
                          : confirmingSegmentIndex === i
                          ? 'bg-amber-400/80 border border-amber-300 animate-[pulse_0.3s_ease-in-out_2]'
                          : seg.rpt_dirty
                          ? 'bg-amber-500/50 border border-amber-500/70'
                          : seg.committed_audio_url
                          ? 'bg-amber-400/60 border border-amber-400/80'
                          : 'bg-emerald-500/50 border border-emerald-500/70'
                      )}
                      style={{
                        left: startT * PIXELS_PER_SECOND + groupDelta,
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
                    />
                  )
                })}
                {rptStitching && (
                  <div className="absolute inset-0 flex items-center justify-center text-[10px] text-amber-400 animate-pulse pointer-events-none">
                    Building preview…
                  </div>
                )}
              </div>

              {/* Emotional curve track */}
              <div className="h-24 shrink-0 bg-neutral-900/20 border-b border-neutral-700 relative overflow-hidden" data-timeline-track>
                {displaySegments.map((segment, index) => {
                  const segWidth = (segment.end_time - segment.start_time) * PIXELS_PER_SECOND
                  return (
                    <div
                      key={`emotion-${segment.id}`}
                      className="absolute top-0 bottom-0"
                      onDoubleClick={() => {
                        setFloatingEmotionSegment(prev => prev === index ? null : index)
                        setRightPanelTab('chord')
                      }}
                      style={{
                        left: segment.start_time * PIXELS_PER_SECOND,
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
                            emotionSource === 'manual'
                              ? segment.velma_emotion_curve ?? Array.from({ length: 20 }, () => 0.25)
                              : segment.velma_emotion_curve
                          }
                          trackDuration={segment.end_time - segment.start_time}
                          emotionLabel={segment.velma_emotion}
                          progressionMarkers={segment.velma_progression}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>

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

              {/* Selection rectangle overlay — appears during Shift+drag, disappears on mouseup */}
              {selectionDrag && (() => {
                const x1 = Math.min(selectionDrag.startX, selectionDrag.currentX)
                const x2 = Math.max(selectionDrag.startX, selectionDrag.currentX)
                const y1 = Math.min(selectionDrag.startY, selectionDrag.currentY)
                const y2 = Math.max(selectionDrag.startY, selectionDrag.currentY)
                return (
                  <div
                    className="absolute pointer-events-none bg-yellow-400/20 border border-yellow-400/50 rounded"
                    style={{
                      left: `${x1}px`,
                      top: `${y1}px`,
                      width: `${x2 - x1}px`,
                      height: `${y2 - y1}px`,
                      zIndex: 40,
                    }}
                  />
                )
              })()}
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
    </div>
  )
}
