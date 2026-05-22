import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Segment, QCFinding, QCScore, QCSeverity, QCFindingType, SidebarTab, EmotionalCurve, EmotionalCurvePoint, PlaybackMode, RebuildStatus } from './editor-types'
import type { AdaptedSegment, VariantType } from './adaptation-types'

export type { SidebarTab }

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

  // Speaker pitch shifts: speaker_id → semitone offset (e.g. "speaker-1" → 8)
  speakerPitchMap: Record<string, number>

  // RPT state
  rebuildStatus: RebuildStatus
  rptStitching: boolean

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
  commitSegmentChanges: (index: number, changes: Partial<Segment>) => void
  markSegmentDirty: (index: number) => void
  clearAllDirty: () => void
  initRPTFromSegments: () => void

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
  setSpeakerVoiceMap: (map: Record<string, string>) => void
  updateSpeakerVoice: (speakerId: string, voiceKey: string) => void
  setSpeakerPitchMap: (map: Record<string, number>) => void
  updateSpeakerPitch: (speakerId: string, pitch: number) => void

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
  playbackMode: 'dubbed',
  rebuildStatus: 'idle',
  rptStitching: false,
  zoomLevel: 1,
  scrollPosition: 0,
  selectedSegmentIndex: null,
  selectedFindingId: null,
  activeSidebarTab: 'qc',
  activeCorrectionTool: null,
  adaptationVariants: {},
  isAdaptationLoading: false,
  importedSegments: null,
  speakerVoiceMap: {},
  speakerPitchMap: {},

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
  updateSegment: (index, updates) => set((state) => ({
    segments: state.segments.map((seg, i) => 
      i === index ? { ...seg, ...updates, status: seg.status === 'locked' ? 'locked' : 'edited' } : seg
    )
  })),

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
  
  updateSegmentText: (index, text) => set((state) => ({
    segments: state.segments.map((seg, i) => 
      i === index ? { ...seg, target_text: text, active_text: text, variant_text: text, isUserEdited: true, status: seg.status === 'locked' ? 'locked' : 'edited' } : seg
    )
  })),
  
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

  setSpeakerVoiceMap: (map) => set({ speakerVoiceMap: map }),
  updateSpeakerVoice: (speakerId, voiceKey) => set((state) => ({
    speakerVoiceMap: { ...state.speakerVoiceMap, [speakerId]: voiceKey },
  })),
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
              preview_text: seg.source_text,
              active_text: seg.source_text,
              target_text: seg.source_text,
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
    }),
    {
      name: 'dubmaster-editor-store',
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      partialize: (state) => ({
        importedSegments: state.importedSegments,
        selectedSegmentIndex: state.selectedSegmentIndex,
        activeSidebarTab: state.activeSidebarTab,
        currentTime: state.currentTime,
        zoomLevel: state.zoomLevel,
        scrollPosition: state.scrollPosition,
        playbackMode: state.playbackMode,
      }),
    }
  )
)
