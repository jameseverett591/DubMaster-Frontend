import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Segment, QCFinding, QCScore, QCSeverity, QCFindingType, SidebarTab, EmotionalCurve, EmotionalCurvePoint, PlaybackMode, RebuildStatus, StagedEdit, ChunkStatus } from './editor-types'
import type { AdaptedSegment, VariantType } from './adaptation-types'

/** Chunk-lens window size in seconds — mirrors backend CHUNK_DURATION_SECONDS. */
export const CHUNK_SECONDS = 300

export type { SidebarTab }

// Mirrors a per-index patch into `importedSegments` so an edit written through a
// store action also lands on the copy that actually renders and persists
// (dubverse-editor's `displaySegments` prefers `importedSegments` whenever it is
// set, and `syncSegmentsToBackend` writes that copy to disk).
//
// Additive by design: no call site changes. Takes a patch FUNCTION rather than a
// fixed object so each array derives conditional fields (e.g. `status`) from its
// OWN segment, preserving existing per-array semantics exactly.
//
// Guards:
//  - `importedSegments` not yet seeded (null) -> no-op. Never creates the array;
//    when it is null, `displaySegments` already falls back to `segments`.
//  - length mismatch (mid split/merge, where the two arrays legitimately differ)
//    -> skip and warn. Index-based patching across differently-shaped arrays
//    would silently hit the WRONG segment, which is worse than not mirroring.
function mirrorIntoImported(
  imported: Segment[] | null,
  segments: Segment[],
  index: number,
  patchFor: (seg: Segment) => Partial<Segment>,
): Segment[] | null {
  if (!imported) return imported
  if (imported.length !== segments.length) {
    console.warn(
      `[editor-store] segment mirror skipped at index ${index}: ` +
      `importedSegments(${imported.length}) != segments(${segments.length})`
    )
    return imported
  }
  return imported.map((seg, i) => (i === index ? { ...seg, ...patchFor(seg) } : seg))
}

interface EditorState {
  // Job data
  jobId: string | null
  title: string
  sourceLanguage: string
  targetLanguage: string
  videoUrl: string
  dubbedVideoUrl: string | null
  videoDuration: number
  
  // Segments
  segments: Segment[]
  
  // QC data
  qcScore: QCScore | null
  qcFindings: QCFinding[]
  qcFilterSeverity: QCSeverity | 'all'
  qcFilterType: QCFindingType | 'all'
  
  // Playback
  currentTime: number
  isPlaying: boolean
  playbackMode: PlaybackMode
  
  // Timeline
  zoomLevel: number // 1 = 100%, 0.5 = 50%, 2 = 200%
  scrollPosition: number
  
  // Selection
  selectedSegmentIndex: number | null
  selectedFindingId: string | null
  
  // Sidebar
  activeSidebarTab: SidebarTab
  
  // Correction tool
  activeCorrectionTool: 'timing' | 'translation' | 'voice' | 'sync' | null

  // Adaptation variants
  adaptationVariants: Record<string, AdaptedSegment>
  isAdaptationLoading: boolean

  // Speaker voice assignments: speaker_id → voice key (e.g. "speaker-1" → "male-2")
  speakerVoiceMap: Record<string, string>

  // Speaker character traits (applied — set by the Apply button on the Speakers panel)
  speakerTraitsMap: Record<string, string[]>

  // Per-speaker write-in custom traits added via the Customize input
  speakerCustomTraits: Record<string, string[]>

  // Speaker pitch shifts: speaker_id → semitone offset (e.g. "speaker-1" → 8)
  speakerPitchMap: Record<string, number>

  // Transient UI feedback for speaker assignment
  speakerPulseId: string | null

  // RPT state
  rebuildStatus: RebuildStatus
  rptStitching: boolean

  // Chunk lens (long-video editing). activeChunkIndex null = whole-video mode.
  // stagedEdits is session-local by design: unsaved work does not survive a
  // reload — Save is what makes it durable.
  activeChunkIndex: number | null
  stagedEdits: Record<number, StagedEdit>
  /** Job the persisted stagedEdits belong to. Staged edits are keyed by
   *  transcript_index, which means nothing across jobs — without this stamp a
   *  reload could rehydrate one film's auditions onto another film's segments. */
  stagedEditsJobId: string | null
  chunkStatusMap: Record<string, ChunkStatus>
  // Segments whose commit failed during a chunk Save. A save is
  // commit-what-you-can: the segments that succeed are durable, the ones that
  // fail stay staged and land here so they can be surfaced before MAKE MOVIE
  // and reloaded for re-editing. transcript_index -> reason.
  failedSegments: Record<number, string>
  // Live progress while a Save is running: "3 of 12 done". null when idle.
  saveProgress: { done: number; total: number } | null

  // Actions
  setJobData: (data: {
    jobId: string
    title: string
    sourceLanguage: string
    targetLanguage: string
    videoUrl: string
    dubbedVideoUrl: string | null
    videoDuration: number
    segments: Segment[]
    qcScore?: QCScore | null
    qcFindings?: QCFinding[]
  }) => void
  
  // Playback actions
  setCurrentTime: (time: number) => void
  setIsPlaying: (playing: boolean) => void
  togglePlayback: () => void
  setPlaybackMode: (mode: PlaybackMode) => void
  setRebuildStatus: (status: RebuildStatus) => void
  setRptStitching: (stitching: boolean) => void
  // Chunk lens actions
  setActiveChunk: (index: number | null) => void
  stageEdit: (transcriptIndex: number, edit: StagedEdit) => void
  clearStagedEdits: () => void
  /** Drop specific staged entries (the ones that committed successfully). */
  clearStagedEditsFor: (transcriptIndices: number[]) => void
  setFailedSegments: (failed: Record<number, string>) => void
  clearFailedSegment: (transcriptIndex: number) => void
  setSaveProgress: (progress: { done: number; total: number } | null) => void
  setChunkStatusMap: (map: Record<string, ChunkStatus>) => void
  commitSegmentChanges: (index: number, changes: Partial<Segment>) => void
  markSegmentDirty: (index: number) => void
  clearAllDirty: () => void
  initRPTFromSegments: () => void
  resetEditor: () => void

  // Timeline actions
  setZoomLevel: (zoom: number) => void
  setScrollPosition: (position: number) => void
  
  // Selection actions
  selectSegment: (index: number | null) => void
  selectFinding: (findingId: string | null) => void
  
  // Sidebar actions
  setActiveSidebarTab: (tab: SidebarTab) => void
  
  // Correction tool actions
  openCorrectionTool: (tool: 'timing' | 'translation' | 'voice' | 'sync') => void
  closeCorrectionTool: () => void
  
  // QC filter actions
  setQCFilterSeverity: (severity: QCSeverity | 'all') => void
  setQCFilterType: (type: QCFindingType | 'all') => void
  
  // Segment actions
  updateSegment: (index: number, updates: Partial<Segment>) => void
  updateSegmentSpeaker: (index: number, speakerId: string, speakerLabel?: string) => void
  lockSegment: (index: number) => void
  unlockSegment: (index: number) => void
  updateSegmentText: (index: number, text: string) => void
  updateSegmentTiming: (index: number, startTime: number, endTime: number) => void
  setPreviewText: (index: number, text: string) => void
  commitPreview: (index: number) => void
  cancelPreview: (index: number) => void
  
  // QC navigation
  jumpToNextFinding: () => void
  jumpToPrevFinding: () => void
  jumpToFinding: (findingId: string) => void

  // Adaptation actions
  setAdaptationVariants: (variants: AdaptedSegment[]) => void
  setSelectedVariant: (segmentId: string, variant: VariantType) => void
  applyRecommendedToAll: () => void
  setAdaptationLoading: (loading: boolean) => void

  // Speaker voice actions
  /** Accepts a functional update as well as a plain map. Three call sites pass
   *  `prev => ({...prev, [id]: voice})`; with an object-only setter that
   *  FUNCTION was stored as the map itself, so every lookup returned undefined
   *  and the speakers strip read "(no voice yet)" for everyone. */
  setSpeakerVoiceMap: (
    map: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)
  ) => void
  updateSpeakerVoice: (speakerId: string, voiceKey: string) => void
  setSpeakerTraitsMap: (map: Record<string, string[]>) => void
  setSpeakerTraits: (speakerId: string, traits: string[]) => void
  addCustomTrait: (speakerId: string, trait: string) => void
  setSpeakerPitchMap: (map: Record<string, number>) => void
  updateSpeakerPitch: (speakerId: string, pitch: number) => void
  pulseSpeaker: (speakerId: string) => void

  // Emotional curve actions
  setEmotionalCurve: (index: number, curve: EmotionalCurve) => void
  updateCombinedCurve: (index: number, points: EmotionalCurvePoint[]) => void
  toggleCurveLock: (index: number) => void
  sampleEmotionalCurve: (index: number, t: number) => number
  resetEmotionalCurve: (index: number) => void
  revertToOriginal: (index: number) => void

  // Computed / helpers
  getFilteredFindings: () => QCFinding[]
  getCurrentSegment: () => Segment | null
  getSegmentAtTime: (time: number) => Segment | null

  // Imported segments state
  importedSegments: Segment[] | null
  setImportedSegments: (segments: Segment[] | null | ((prev: Segment[] | null) => Segment[] | null)) => void
  // jobId that owns the current importedSegments — guards against a stale
  // persisted array from a previous job masking a freshly-loaded job.
  importedSegmentsJobId: string | null
  setImportedSegmentsJobId: (jobId: string | null) => void
}

export const useEditorStore = create<EditorState>(
  persist(
    (set, get) => ({
  // Initial state
  jobId: null,
  title: '',
  sourceLanguage: '',
  targetLanguage: '',
  videoUrl: '',
  dubbedVideoUrl: null,
  videoDuration: 0,
  segments: [],
  qcScore: null,
  qcFindings: [],
  qcFilterSeverity: 'all',
  qcFilterType: 'all',
  currentTime: 0,
  isPlaying: false,
  playbackMode: 'preview',
  rebuildStatus: 'idle',
  rptStitching: false,
  activeChunkIndex: null,
  failedSegments: {},
  saveProgress: null,
  stagedEdits: {},
  stagedEditsJobId: null,
  chunkStatusMap: {},
  zoomLevel: 1,
  scrollPosition: 0,
  selectedSegmentIndex: null,
  selectedFindingId: null,
  activeSidebarTab: 'qc',
  activeCorrectionTool: null,
  adaptationVariants: {},
  isAdaptationLoading: false,
  importedSegments: null,
  importedSegmentsJobId: null,
  speakerVoiceMap: {},
  speakerTraitsMap: {},
  speakerCustomTraits: {},
  speakerPitchMap: {},
  speakerPulseId: null,

  // Set job data
  setJobData: (data) => set({
    jobId: data.jobId,
    title: data.title,
    sourceLanguage: data.sourceLanguage,
    targetLanguage: data.targetLanguage,
    videoUrl: data.videoUrl,
    dubbedVideoUrl: data.dubbedVideoUrl,
    videoDuration: data.videoDuration,
    segments: data.segments,
    qcScore: data.qcScore || null,
    qcFindings: data.qcFindings || [],
  }),
  
  // Playback
  setCurrentTime: (time) => set({ currentTime: time }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  togglePlayback: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setPlaybackMode: (mode) => set({ playbackMode: mode }),
  setRebuildStatus: (status) => set({ rebuildStatus: status }),
  setRptStitching: (stitching) => set({ rptStitching: stitching }),
  // Chunk lens actions. stageEdit MERGES — a text edit followed by a regen of
  // the same segment must keep both halves.
  setActiveChunk: (index) => set({ activeChunkIndex: index }),
  stageEdit: (transcriptIndex, edit) => set((state) => ({
    stagedEdits: {
      ...state.stagedEdits,
      [transcriptIndex]: { ...state.stagedEdits[transcriptIndex], ...edit },
    },
  })),
  clearStagedEdits: () => set({ stagedEdits: {}, stagedEditsJobId: null }),
  // Used after a partial save: the successes are dropped, the failures stay
  // staged so the user still has their work and can retry or re-edit.
  clearStagedEditsFor: (transcriptIndices) => set((state) => {
    const next = { ...state.stagedEdits }
    for (const ti of transcriptIndices) delete next[ti]
    return { stagedEdits: next }
  }),
  setFailedSegments: (failed) => set({ failedSegments: failed }),
  clearFailedSegment: (transcriptIndex) => set((state) => {
    const next = { ...state.failedSegments }
    delete next[transcriptIndex]
    return { failedSegments: next }
  }),
  setSaveProgress: (progress) => set({ saveProgress: progress }),
  setChunkStatusMap: (map) => set({ chunkStatusMap: map }),
  commitSegmentChanges: (index, changes) => set((state) => ({
    segments: state.segments.map((seg, i) =>
      i === index
        ? { ...seg, ...changes, rpt_dirty: true, committed_at: new Date().toISOString() }
        : seg
    ),
  })),
  markSegmentDirty: (index) => set((state) => ({
    segments: state.segments.map((seg, i) =>
      i === index ? { ...seg, rpt_dirty: true } : seg
    ),
  })),
  clearAllDirty: () => set((state) => ({
    segments: state.segments.map((seg) => ({ ...seg, rpt_dirty: false })),
  })),
  resetEditor: () => set({
    jobId: null,
    title: '',
    videoUrl: '',
    dubbedVideoUrl: null,
    videoDuration: 0,
    segments: [],
    qcScore: null,
    qcFindings: [],
    importedSegments: null,
    importedSegmentsJobId: null,
    speakerVoiceMap: {},
    speakerTraitsMap: {},
    speakerCustomTraits: {},
    speakerPitchMap: {},
    rebuildStatus: 'idle',
    rptStitching: false,
    activeChunkIndex: null,
    failedSegments: {},
    saveProgress: null,
    stagedEdits: {},
    chunkStatusMap: {},
    selectedSegmentIndex: null,
    selectedFindingId: null,
    currentTime: 0,
    isPlaying: false,
    adaptationVariants: {},
  }),
  initRPTFromSegments: () => set((state) => ({
    segments: state.segments.map((seg) => ({
      ...seg,
      committed_audio_url: seg.committed_audio_url ?? seg.audio_url,
      committed_start_time: seg.committed_start_time ?? seg.start_time,
      committed_end_time: seg.committed_end_time ?? seg.end_time,
      committed_adapted_text: seg.committed_adapted_text ?? seg.target_text,
      rpt_dirty: false,
      committed_at: seg.committed_at ?? new Date().toISOString(),
    })),
  })),

  // Timeline
  setZoomLevel: (zoom) => set({ zoomLevel: Math.max(0.25, Math.min(4, zoom)) }),
  setScrollPosition: (position) => set({ scrollPosition: position }),
  
  // Selection
  selectSegment: (index) => set({ 
    selectedSegmentIndex: index,
    activeCorrectionTool: null,
  }),
  selectFinding: (findingId) => {
    const state = get()
    const finding = state.qcFindings.find(f => f.id === findingId)
    if (finding) {
      set({ 
        selectedFindingId: findingId,
        selectedSegmentIndex: finding.segment_index,
        currentTime: finding.timestamp_start,
      })
    } else {
      set({ selectedFindingId: null })
    }
  },
  
  // Sidebar
  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
  
  // Correction tool
  openCorrectionTool: (tool) => set({ activeCorrectionTool: tool }),
  closeCorrectionTool: () => set({ activeCorrectionTool: null }),
  
  // QC filters
  setQCFilterSeverity: (severity) => set({ qcFilterSeverity: severity }),
  setQCFilterType: (type) => set({ qcFilterType: type }),
  
  // Segment actions
  updateSegment: (index, updates) => set((state) => {
    const patchFor = (seg: Segment): Partial<Segment> => ({
      ...updates,
      status: seg.status === 'locked' ? 'locked' : 'edited',
    })
    return {
      segments: state.segments.map((seg, i) =>
        i === index ? { ...seg, ...patchFor(seg) } : seg
      ),
      importedSegments: mirrorIntoImported(state.importedSegments, state.segments, index, patchFor),
    }
  }),

  updateSegmentSpeaker: (index, speakerId, speakerLabel) => set((state) => ({
    segments: state.segments.map((seg, i) =>
      i === index
        ? { ...seg, speaker_id: speakerId, speaker_label: speakerLabel || seg.speaker_label, status: seg.status === 'locked' ? 'locked' : 'edited' }
        : seg
    )
  })),

  lockSegment: (index) => set((state) => ({
    segments: state.segments.map((seg, i) => 
      i === index ? { 
        ...seg, 
        status: 'locked', 
        locked_at: new Date().toISOString(),
        original_audio_snapshot: seg.audio_url,
      } : seg
    )
  })),
  
  unlockSegment: (index) => set((state) => ({
    segments: state.segments.map((seg, i) => 
      i === index ? { ...seg, status: 'edited', locked_at: undefined } : seg
    )
  })),
  
  updateSegmentText: (index, text) => set((state) => {
    const patchFor = (seg: Segment): Partial<Segment> => ({
      target_text: text,
      active_text: text,
      variant_text: text,
      isUserEdited: true,
      status: seg.status === 'locked' ? 'locked' : 'edited',
    })
    return {
      segments: state.segments.map((seg, i) =>
        i === index ? { ...seg, ...patchFor(seg) } : seg
      ),
      importedSegments: mirrorIntoImported(state.importedSegments, state.segments, index, patchFor),
    }
  }),
  
  updateSegmentTiming: (index, startTime, endTime) => set((state) => ({
    segments: state.segments.map((seg, i) => 
      i === index ? { ...seg, start_time: startTime, end_time: endTime, status: seg.status === 'locked' ? 'locked' : 'edited' } : seg
    )
  })),

  setPreviewText: (index, text) => set((state) => ({
    segments: state.segments.map((seg, i) =>
      i === index ? { ...seg, preview_text: text, isPreviewing: true } : seg
    )
  })),

  commitPreview: (index) => set((state) => ({
    segments: state.segments.map((seg, i) =>
      i === index
        ? {
            ...seg,
            target_text: seg.preview_text ?? seg.target_text,
            active_text: seg.preview_text ?? seg.active_text ?? seg.target_text,
            variant_text: seg.preview_text ?? seg.variant_text ?? seg.target_text,
            isUserEdited: true,
            preview_text: null,
            isPreviewing: false,
          }
        : seg
    )
  })),

  cancelPreview: (index) => set((state) => ({
    segments: state.segments.map((seg, i) =>
      i === index ? { ...seg, preview_text: null, isPreviewing: false } : seg
    )
  })),
  
  // QC navigation
  jumpToNextFinding: () => {
    const state = get()
    const findings = state.getFilteredFindings()
    if (findings.length === 0) return
    
    const currentIndex = findings.findIndex(f => f.id === state.selectedFindingId)
    const nextIndex = currentIndex < findings.length - 1 ? currentIndex + 1 : 0
    const nextFinding = findings[nextIndex]
    
    set({
      selectedFindingId: nextFinding.id,
      selectedSegmentIndex: nextFinding.segment_index,
      currentTime: nextFinding.timestamp_start,
    })
  },
  
  jumpToPrevFinding: () => {
    const state = get()
    const findings = state.getFilteredFindings()
    if (findings.length === 0) return
    
    const currentIndex = findings.findIndex(f => f.id === state.selectedFindingId)
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : findings.length - 1
    const prevFinding = findings[prevIndex]
    
    set({
      selectedFindingId: prevFinding.id,
      selectedSegmentIndex: prevFinding.segment_index,
      currentTime: prevFinding.timestamp_start,
    })
  },
  
  jumpToFinding: (findingId) => {
    const state = get()
    const finding = state.qcFindings.find(f => f.id === findingId)
    if (finding) {
      set({
        selectedFindingId: findingId,
        selectedSegmentIndex: finding.segment_index,
        currentTime: finding.timestamp_start,
        activeSidebarTab: 'qc',
      })
    }
  },
  
  // Adaptation actions
  setAdaptationVariants: (variants) => set((state) => ({
    adaptationVariants: {
      ...state.adaptationVariants,
      ...Object.fromEntries(variants.map((v) => [v.segmentId, v])),
    },
  })),

  setSelectedVariant: (segmentId, variant) => set((state) => {
    const existing = state.adaptationVariants[segmentId]
    if (!existing) return state
    return {
      adaptationVariants: {
        ...state.adaptationVariants,
        [segmentId]: { ...existing, selectedVariant: variant },
      },
    }
  }),

  applyRecommendedToAll: () => set((state) => ({
    adaptationVariants: Object.fromEntries(
      Object.entries(state.adaptationVariants).map(([id, seg]) => [
        id,
        { ...seg, selectedVariant: seg.recommended },
      ])
    ),
  })),

  setAdaptationLoading: (loading) => set({ isAdaptationLoading: loading }),

  setSpeakerVoiceMap: (map) => set((state) => ({
    speakerVoiceMap: typeof map === 'function' ? map(state.speakerVoiceMap) : map,
  })),
  updateSpeakerVoice: (speakerId, voiceKey) => set((state) => ({
    speakerVoiceMap: { ...state.speakerVoiceMap, [speakerId]: voiceKey },
  })),
  pulseSpeaker: (speakerId) => {
    set({ speakerPulseId: speakerId })
    setTimeout(() => set({ speakerPulseId: null }), 1400)
  },
  setSpeakerTraitsMap: (map) => set({ speakerTraitsMap: map }),
  setSpeakerTraits: (speakerId, traits) => set((state) => ({
    speakerTraitsMap: { ...state.speakerTraitsMap, [speakerId]: traits },
  })),
  addCustomTrait: (speakerId, trait) => set((state) => {
    const existing = state.speakerCustomTraits[speakerId] ?? []
    if (existing.includes(trait)) return {}
    return {
      speakerCustomTraits: {
        ...state.speakerCustomTraits,
        [speakerId]: [...existing, trait],
      },
    }
  }),
  setSpeakerPitchMap: (map) => set({ speakerPitchMap: map }),
  updateSpeakerPitch: (speakerId, pitch) => set((state) => ({
    speakerPitchMap: { ...state.speakerPitchMap, [speakerId]: pitch },
  })),

  // Emotional curve actions
  setEmotionalCurve: (index, curve) => set((state) => ({
    segments: state.segments.map((seg, i) =>
      i === index ? { ...seg, emotionalCurve: curve } : seg
    ),
  })),

  updateCombinedCurve: (index, points) => set((state) => ({
    segments: state.segments.map((seg, i) =>
      i === index
        ? {
            ...seg,
            emotionalCurve: {
              ...seg.emotionalCurve,
              combined: points,
              locked: seg.emotionalCurve?.locked ?? false,
              analysis: seg.emotionalCurve?.analysis ?? { facial: [], vocal: [], scene: [] },
            } as EmotionalCurve,
          }
        : seg
    ),
  })),

  toggleCurveLock: (index) => set((state) => ({
    segments: state.segments.map((seg, i) =>
      i === index
        ? {
            ...seg,
            emotionalCurve: {
              ...seg.emotionalCurve,
              combined: seg.emotionalCurve?.combined ?? [],
              locked: !seg.emotionalCurve?.locked,
              analysis: seg.emotionalCurve?.analysis ?? { facial: [], vocal: [], scene: [] },
            } as EmotionalCurve,
          }
        : seg
    ),
  })),

  sampleEmotionalCurve: (index, t) => {
    const state = get()
    const seg = state.segments[index]
    const curve = seg?.emotionalCurve?.combined
    if (!curve || curve.length === 0) return 0.5

    // Sort by x
    const sorted = [...curve].sort((a, b) => a.x - b.x)
    if (t <= sorted[0].x) return sorted[0].y
    if (t >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y

    // Find surrounding points and interpolate with Bezier
    for (let i = 0; i < sorted.length - 1; i++) {
      const p0 = sorted[i]
      const p1 = sorted[i + 1]
      if (t >= p0.x && t <= p1.x) {
        const range = p1.x - p0.x
        if (range === 0) return p0.y
        const localT = (t - p0.x) / range

        if (p0.cp2 && p1.cp1) {
          // Cubic Bezier
          const cp1x = p0.x + (p0.cp2?.x ?? 0) * range
          const cp1y = p0.y + (p0.cp2?.y ?? 0) * (p1.y - p0.y)
          const cp2x = p1.x - (p1.cp1?.x ?? 0) * range
          const cp2y = p1.y - (p1.cp1?.y ?? 0) * (p1.y - p0.y)
          const mt = 1 - localT
          return (
            mt * mt * mt * p0.y +
            3 * mt * mt * localT * cp1y +
            3 * mt * localT * localT * cp2y +
            localT * localT * localT * p1.y
          )
        }

        // Linear fallback
        return p0.y + (p1.y - p0.y) * localT
      }
    }
    return 0.5
  },

  resetEmotionalCurve: (index) => set((state) => ({
    segments: state.segments.map((seg, i) =>
      i === index
        ? {
            ...seg,
            emotionalCurve: {
              ...seg.emotionalCurve,
              combined: [
                { x: 0, y: 0.5 },
                { x: 1, y: 0.5 }
              ],
              locked: false,
              analysis: seg.emotionalCurve?.analysis ?? { facial: [], vocal: [], scene: [] },
            } as EmotionalCurve,
          }
        : seg
    ),
  })),

  revertToOriginal: (index) => set((state) => {
    const seg = state.segments[index]
    if (!seg) return state
    return {
      segments: state.segments.map((s, i) =>
        i === index
          ? {
              ...s,
              preview_text: seg.target_text,
              active_text: seg.target_text,
              target_text: seg.target_text,
            }
          : s
      ),
    }
  }),

  // Computed helpers
  getFilteredFindings: () => {
    const state = get()
    return state.qcFindings.filter(f => {
      if (state.qcFilterSeverity !== 'all' && f.severity !== state.qcFilterSeverity) return false
      if (state.qcFilterType !== 'all' && f.type !== state.qcFilterType) return false
      return true
    })
  },
  
  getCurrentSegment: () => {
    const state = get()
    if (state.selectedSegmentIndex === null) return null
    return state.segments[state.selectedSegmentIndex] || null
  },
  
  getSegmentAtTime: (time) => {
    const state = get()
    return state.segments.find(seg => time >= seg.start_time && time < seg.end_time) || null
  },

  setImportedSegments: (segments) => set((state) => ({
    importedSegments: typeof segments === 'function' ? segments(state.importedSegments) : segments,
  })),

  setImportedSegmentsJobId: (jobId) => set({ importedSegmentsJobId: jobId }),
    }),
    {
      name: 'dubmaster-editor-store',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        importedSegmentsJobId: state.importedSegmentsJobId,
        selectedSegmentIndex: state.selectedSegmentIndex,
        activeSidebarTab: state.activeSidebarTab,
        currentTime: state.currentTime,
        zoomLevel: state.zoomLevel,
        scrollPosition: state.scrollPosition,
        // Staged edits are auditions the user has not committed — the only
        // state in the editor that exists nowhere else. Without persisting it,
        // a refresh silently destroys unsaved work. Kept alongside its job id
        // so one job's auditions can never be rehydrated onto another.
        stagedEdits: state.stagedEdits,
        stagedEditsJobId: state.importedSegmentsJobId,
      }),
    }
  )
)
