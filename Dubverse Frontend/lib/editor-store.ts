import { create } from 'zustand'
import type { Segment, QCFinding, QCScore, QCSeverity, QCFindingType, SidebarTab } from './editor-types'
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
  playbackMode: 'original' | 'dubbed'
  
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
  setPlaybackMode: (mode: 'original' | 'dubbed') => void
  
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
  lockSegment: (index: number) => void
  unlockSegment: (index: number) => void
  updateSegmentText: (index: number, text: string) => void
  updateSegmentTiming: (index: number, startTime: number, endTime: number) => void
  
  // QC navigation
  jumpToNextFinding: () => void
  jumpToPrevFinding: () => void
  jumpToFinding: (findingId: string) => void

  // Adaptation actions
  setAdaptationVariants: (variants: AdaptedSegment[]) => void
  setSelectedVariant: (segmentId: string, variant: VariantType) => void
  applyRecommendedToAll: () => void
  setAdaptationLoading: (loading: boolean) => void

  // Computed / helpers
  getFilteredFindings: () => QCFinding[]
  getCurrentSegment: () => Segment | null
  getSegmentAtTime: (time: number) => Segment | null
}

export const useEditorStore = create<EditorState>((set, get) => ({
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
  zoomLevel: 1,
  scrollPosition: 0,
  selectedSegmentIndex: null,
  selectedFindingId: null,
  activeSidebarTab: 'qc',
  activeCorrectionTool: null,
  adaptationVariants: {},
  isAdaptationLoading: false,

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
      i === index ? { ...seg, target_text: text, status: seg.status === 'locked' ? 'locked' : 'edited' } : seg
    )
  })),
  
  updateSegmentTiming: (index, startTime, endTime) => set((state) => ({
    segments: state.segments.map((seg, i) => 
      i === index ? { ...seg, start_time: startTime, end_time: endTime, status: seg.status === 'locked' ? 'locked' : 'edited' } : seg
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
}))
