'use client'

import { useEffect, useCallback, useState, useRef } from 'react'
import {
  Lock,
  Unlock,
  Sparkles,
  ChevronDown,
  RotateCcw,
  Trash2,
  Check,
  Clock,
  Volume2,
  VolumeX,
  Play,
  Pause,
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
  Globe,
  Bell,
  ArrowLeft,
  Share2,
  Download,
  User,
  Upload,
  Plus,
  FileText,
  Settings,
  Square,
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import { useEditorStore, type SidebarTab } from '@/lib/editor-store'
import type { Segment, QCScore, QCFinding, QCFindingType } from '@/lib/editor-types'
import { formatTime, getSpeakerColor } from '@/lib/editor-types'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Slider } from '@/components/ui/slider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

// Import additional icons for QC tabs
import { Mic2, Languages, Gauge, Music2, LayoutList, AudioLines, Zap, GitBranch } from 'lucide-react'

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
  qcScore?: QCScore | null
  qcFindings?: QCFinding[]
  pointsLeft?: number
  minutesAvailable?: number
  onExport?: () => void
  onShare?: () => void
  onGenerateSpeech?: () => void
  onTranslateAndDub?: () => void
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
  qcScore,
  qcFindings = [],
  pointsLeft = 6.88,
  minutesAvailable = 2.29,
  onExport,
  onShare,
  onGenerateSpeech,
  onTranslateAndDub,
}: DubVerseEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  
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
  } = useEditorStore()
  
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [regenError, setRegenError] = useState<string | null>(null)
  const [editingSegmentIndex, setEditingSegmentIndex] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const [activeQCCategory, setActiveQCCategory] = useState<QCCategory | null>(null)
  const [showCorrectionSlider, setShowCorrectionSlider] = useState(false)
  const [correctionValue, setCorrectionValue] = useState(0)
  const [previewWidth, setPreviewWidth] = useState(400)
  const [isResizingPreview, setIsResizingPreview] = useState(false)
  const [timelineHeight, setTimelineHeight] = useState(260)
  const [isResizingTimeline, setIsResizingTimeline] = useState(false)
  
  // QC highlight box state - default position so it shows immediately
  const [qcBoxPosition, setQcBoxPosition] = useState<{ start: number; end: number }>({ start: 1, end: 5 })
  const [qcBoxColor, setQcBoxColor] = useState<'red' | 'yellow' | 'blue' | 'green'>('green')
  const [isDraggingQcBox, setIsDraggingQcBox] = useState(false)
  const [showQcBox, setShowQcBox] = useState(true)
  
  // Video import state
  const [importedVideoUrl, setImportedVideoUrl] = useState<string | null>(null)
  const [importedVideoFile, setImportedVideoFile] = useState<File | null>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const transcriptInputRef = useRef<HTMLInputElement>(null)
  
  // Transcription state
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null)
  
  // Imported segments (from transcript file) - null means use original, empty array means cleared
  const [importedSegments, setImportedSegments] = useState<Segment[] | null>(null)
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null)
  
  // Use imported segments if set (even if empty), otherwise use initial segments
  const displaySegments = importedSegments !== null ? importedSegments : segments
  
  // Video thumbnails for timeline
  const [videoThumbnails, setVideoThumbnails] = useState<string[]>([])
  const [isExtractingThumbnails, setIsExtractingThumbnails] = useState(false)
  
  // Volume controls
  const [masterVolume, setMasterVolume] = useState(80)
  const [audioVolume, setAudioVolume] = useState(100)
  const [originalTextVolume, setOriginalTextVolume] = useState(100)
  const [dubbedTextVolume, setDubbedTextVolume] = useState(100)
  const [backgroundVolume, setBackgroundVolume] = useState(50)
  const [isMuted, setIsMuted] = useState(false)
  
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
  
  // Add segment modal state
  const [showAddSegment, setShowAddSegment] = useState(false)
  const [newSegmentStart, setNewSegmentStart] = useState('')
  const [newSegmentEnd, setNewSegmentEnd] = useState('')
  const [newSegmentOriginal, setNewSegmentOriginal] = useState('')
  const [newSegmentTranslation, setNewSegmentTranslation] = useState('')
  
  // Generate suggestions for a segment
  const [suggestions, setSuggestions] = useState<Record<number, Suggestion[]>>({})
  
  // Initialize store
  useEffect(() => {
    const segmentsWithFindings = initialSegments.map((seg, idx) => ({
      ...seg,
      id: seg.id || `segment-${idx}`,
      index: idx,
      status: seg.status || 'auto',
      qc_findings: qcFindings.filter(f => f.segment_index === idx),
    }))
    
// Generate 5 mock suggestions for each segment
  const mockSuggestions: Record<number, Suggestion[]> = {}
  segmentsWithFindings.forEach((seg, idx) => {
  mockSuggestions[idx] = [
  { id: `sug-${idx}-1`, text: seg.target_text, confidence: 0.95, source: 'ai' },
  { id: `sug-${idx}-2`, text: `${seg.target_text} [casual]`, confidence: 0.88, source: 'ai' },
  { id: `sug-${idx}-3`, text: `[Formal] ${seg.target_text}`, confidence: 0.82, source: 'ai' },
  { id: `sug-${idx}-4`, text: seg.target_text.split(' ').slice(0, 3).join(' ') + '...', confidence: 0.72, source: 'memory' },
  { id: `sug-${idx}-5`, text: `Alt: ${seg.target_text.split(' ').reverse().join(' ')}`, confidence: 0.58, source: 'memory' },
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
  }, [jobId, title, sourceLanguage, targetLanguage, videoUrl, dubbedVideoUrl, videoDuration, initialSegments, qcScore, qcFindings, setJobData])
  
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
      start_time: startTime,
      end_time: endTime,
      speaker_id: `speaker-${(currentSegments.length % 5) + 1}`,
      speaker_label: `Speaker ${(currentSegments.length % 5) + 1}`,
      source_text: newSegmentOriginal,
      target_text: newSegmentTranslation || newSegmentOriginal,
      status: 'pending',
      qc_findings: []
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
                start_time: parseSrtTime(timeMatch[1]),
                end_time: parseSrtTime(timeMatch[2]),
                speaker_id: `speaker-${(idx % 5) + 1}`,
                speaker_label: `Speaker ${(idx % 5) + 1}`,
                source_text: textLines,
                target_text: textLines,
                status: 'pending',
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
                start_time: parseVttTime(timeMatch[1]),
                end_time: parseVttTime(timeMatch[2]),
                speaker_id: `speaker-${(segIdx % 5) + 1}`,
                speaker_label: `Speaker ${(segIdx % 5) + 1}`,
                source_text: textLines.join(' '),
                target_text: textLines.join(' '),
                status: 'pending',
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
  const activeVideoUrl = importedVideoUrl || (playbackMode === 'dubbed' && dubbedVideoUrl ? dubbedVideoUrl : videoUrl)
  
  // Track which URL we've already extracted thumbnails for
  const lastExtractedUrlRef = useRef<string | null>(null)
  
  // Extract video thumbnails for timeline
  const extractVideoThumbnails = useCallback(async (videoSrc: string) => {
    // Don't re-extract for same URL
    if (lastExtractedUrlRef.current === videoSrc) return
    lastExtractedUrlRef.current = videoSrc
    
    setIsExtractingThumbnails(true)
    setVideoThumbnails([])
    
    const thumbnails: string[] = []
    
    // Create a temporary video element for extraction
    const tempVideo = document.createElement('video')
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
    canvas.height = 68
    
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
  }, [videoDuration])
  
  // Extract thumbnails when imported video URL changes
  useEffect(() => {
    if (importedVideoUrl) {
      extractVideoThumbnails(importedVideoUrl)
    }
  }, [importedVideoUrl, extractVideoThumbnails])
  
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
  
  // Sync video time when user seeks (not during playback)
  useEffect(() => {
    const video = videoRef.current
    if (!video || isPlaying) return
    
    if (Math.abs(video.currentTime - currentTime) > 0.1) {
      video.currentTime = currentTime
    }
  }, [currentTime, isPlaying])
  
  const handleVideoTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime)
    }
  }, [setCurrentTime])
  
  // Get severity color for segment based on active QC category
  const getSegmentHighlightColor = useCallback((segment: Segment) => {
    if (!activeQCCategory) return null
    
    const activeQCType = QC_TABS.find(t => t.id === activeQCCategory)?.qcType
    if (!activeQCType) return null
    
    const relevantFindings = segment.qc_findings.filter(f => f.type === activeQCType)
    if (relevantFindings.length === 0) return 'green'
    
    const hasError = relevantFindings.some(f => f.severity === 'error')
    const hasWarning = relevantFindings.some(f => f.severity === 'warning')
    
    if (hasError) return 'red'
    if (hasWarning) return 'yellow'
    return 'green'
  }, [activeQCCategory])
  
// Handle QC category click - toggle highlighting and show QC box
  const handleQCCategoryClick = useCallback((category: QCCategory) => {
    if (activeQCCategory === category) {
      setActiveQCCategory(null)
      setShowCorrectionSlider(false)
    } else {
      setActiveQCCategory(category)
      
      // Find the first segment with issues of this type and position QC box
      const qcType = QC_TABS.find(t => t.id === category)?.qcType
      if (qcType) {
        const segmentWithIssue = displaySegments.find(seg => 
          seg.qc_findings.some(f => f.type === qcType)
        )
        
        if (segmentWithIssue) {
          setQcBoxPosition({
            start: segmentWithIssue.start_time,
            end: segmentWithIssue.end_time
          })
          
          // Determine color based on severity
          const findings = segmentWithIssue.qc_findings.filter(f => f.type === qcType)
          const hasError = findings.some(f => f.severity === 'error')
          const hasWarning = findings.some(f => f.severity === 'warning')
          const hasInfo = findings.some(f => f.severity === 'info')
          
          if (hasError) setQcBoxColor('red')
          else if (hasWarning) setQcBoxColor('yellow')
          else if (hasInfo) setQcBoxColor('blue')
          else setQcBoxColor('green')
        }
      }
    }
  }, [activeQCCategory, segments])
  
  // Handle QC box drag
  const handleQcBoxDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!qcBoxPosition) return
    
    const timelineElement = timelineRef.current
    if (!timelineElement) return
    
    setIsDraggingQcBox(true)
    const boxWidth = qcBoxPosition.end - qcBoxPosition.start
    const startX = e.clientX
    const startBoxStart = qcBoxPosition.start
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const rect = timelineElement.getBoundingClientRect()
      const scrollLeft = timelineElement.scrollLeft
      const deltaX = moveEvent.clientX - startX
      const deltaTime = deltaX / PIXELS_PER_SECOND
      
      const newStart = Math.max(0, Math.min(startBoxStart + deltaTime, videoDuration - boxWidth))
      setQcBoxPosition({
        start: newStart,
        end: newStart + boxWidth
      })
    }
    
    const handleMouseUp = () => {
      setIsDraggingQcBox(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [qcBoxPosition, videoDuration])
  
  // Handle left needle drag - resize box from left
  const handleLeftNeedleDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!qcBoxPosition) return
    
    const timelineElement = timelineRef.current
    if (!timelineElement) return
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const rect = timelineElement.getBoundingClientRect()
      const scrollLeft = timelineElement.scrollLeft
      const x = moveEvent.clientX - rect.left + scrollLeft
      const newStart = Math.max(0, Math.min(x / PIXELS_PER_SECOND, qcBoxPosition.end - 0.5))
      setQcBoxPosition(prev => prev ? { ...prev, start: newStart } : null)
    }
    
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [qcBoxPosition])
  
  // Handle right needle drag - resize box from right
  const handleRightNeedleDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!qcBoxPosition) return
    
    const timelineElement = timelineRef.current
    if (!timelineElement) return
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const rect = timelineElement.getBoundingClientRect()
      const scrollLeft = timelineElement.scrollLeft
      const x = moveEvent.clientX - rect.left + scrollLeft
      const newEnd = Math.max(qcBoxPosition.start + 0.5, Math.min(x / PIXELS_PER_SECOND, videoDuration))
      setQcBoxPosition(prev => prev ? { ...prev, end: newEnd } : null)
    }
    
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [qcBoxPosition, videoDuration])
  
  // Handle segment click when QC category is active
  const handleSegmentClickForQC = useCallback((index: number) => {
    selectSegment(index)
    if (activeQCCategory) {
      const segment = displaySegments[index]
      const qcType = QC_TABS.find(t => t.id === activeQCCategory)?.qcType
      if (qcType) {
        setShowCorrectionSlider(true)
        setCorrectionValue(0)
      }
    }
  }, [activeQCCategory, segments, selectSegment])
  
  // Apply correction from slider
  const applyCorrection = useCallback(() => {
    if (selectedSegmentIndex === null) return
    // In a real app, this would call the API to stretch/adjust the segment
    console.log('Applying correction:', correctionValue, 'to segment', selectedSegmentIndex)
    setShowCorrectionSlider(false)
    setCorrectionValue(0)
  }, [selectedSegmentIndex, correctionValue])
  
  // Handle preview panel resize
  const handlePreviewResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizingPreview(true)
    
    const startX = e.clientX
    const startWidth = previewWidth
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX
      const newWidth = Math.min(Math.max(startWidth + delta, 300), 700)
      setPreviewWidth(newWidth)
    }
    
    const handleMouseUp = () => {
      setIsResizingPreview(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [previewWidth])
  
  // Handle timeline resize (vertical)
  const handleTimelineResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizingTimeline(true)
    
    const startY = e.clientY
    const startHeight = timelineHeight
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY
      const newHeight = Math.min(Math.max(startHeight + delta, 150), 450)
      setTimelineHeight(newHeight)
    }
    
    const handleMouseUp = () => {
      setIsResizingTimeline(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [timelineHeight])
  
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
    
    const updateTimeFromMouse = (clientX: number) => {
      const rect = timelineElement.getBoundingClientRect()
      const scrollLeft = timelineElement.scrollLeft
      const x = clientX - rect.left + scrollLeft
      const newTime = Math.max(0, Math.min(x / PIXELS_PER_SECOND, videoDuration))
      setCurrentTime(newTime)
      
      // Also update video position
      if (videoRef.current) {
        videoRef.current.currentTime = newTime
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
  }, [videoDuration, setCurrentTime])
  
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
  
  // Handle Generate Speech - calls backend TTS regeneration for the selected segment
  const handleGenerateSpeech = useCallback(async () => {
    if (selectedSegmentIndex === null || isRegenerating) return
    const segment = displaySegments[selectedSegmentIndex]
    if (!segment) return

    setRegenError(null)
    setIsRegenerating(true)
    try {
      const response = await apiClient.regenerateSegment(jobId, selectedSegmentIndex, {
        text: segment.target_text,
      })
      const filename = response.segment.path.split('/').pop() ?? ''
      const audio_url = filename
        ? apiClient.getAudioFileUrl(jobId, filename)
        : segment.audio_url
      updateSegment(selectedSegmentIndex, {
        target_text: response.segment.text,
        audio_url,
        status: 'locked',
      })
      setLockedSegments(prev => new Set([...prev, selectedSegmentIndex]))
      if (!droppedTranslations.some(t => t.segmentIndex === selectedSegmentIndex)) {
        setDroppedTranslations(prev => [
          ...prev,
          {
            segmentIndex: selectedSegmentIndex,
            text: response.segment.text,
            startTime: segment.start_time,
            endTime: segment.end_time,
          }
        ])
      }
    } catch (err: any) {
      console.error('[Generate Speech] Failed:', err.message)
      setRegenError('Generation failed — please try again')
    } finally {
      setIsRegenerating(false)
    }
  }, [selectedSegmentIndex, isRegenerating, displaySegments, jobId, droppedTranslations, updateSegment])
  
  // Handle Revert to Original — restores text and audio from the initial load snapshot
  const handleRevert = useCallback(() => {
    if (selectedSegmentIndex === null) return
    const original = initialSegments[selectedSegmentIndex]
    if (!original) return

    const filename = (original.audio_url ?? '').split('/').pop() ?? ''
    const audio_url = filename ? apiClient.getAudioFileUrl(jobId, filename) : undefined

    updateSegment(selectedSegmentIndex, {
      target_text: original.target_text,
      audio_url,
      status: 'auto',
    })
    setLockedSegments(prev => {
      const next = new Set(prev)
      next.delete(selectedSegmentIndex)
      return next
    })
    setDroppedTranslations(prev => prev.filter(t => t.segmentIndex !== selectedSegmentIndex))
  }, [selectedSegmentIndex, initialSegments, jobId, updateSegment])

  const handleTimelineDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])
  
  // Start editing a segment
  const startEditing = useCallback((index: number) => {
    setEditingSegmentIndex(index)
    setEditingText(displaySegments[index]?.target_text || '')
  }, [segments])
  
  // Save editing
  const saveEditing = useCallback(() => {
    if (editingSegmentIndex !== null) {
      updateSegmentText(editingSegmentIndex, editingText)
      setEditingSegmentIndex(null)
    }
  }, [editingSegmentIndex, editingText, updateSegmentText])
  
  // Cancel editing
  const cancelEditing = useCallback(() => {
    setEditingSegmentIndex(null)
    setEditingText('')
  }, [])
  
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
  
  // Timeline constants
  const TRACK_HEIGHT = 48
  const PIXELS_PER_SECOND = 40 * zoomLevel
  const timelineWidth = videoDuration * PIXELS_PER_SECOND
  
  // Find pending segment count
  const pendingCount = displaySegments.filter(s => 
    s.qc_findings.some(f => f.severity === 'error' || f.severity === 'warning')
  ).length
  
  return (
    <div className="h-screen flex flex-col bg-black text-white">
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
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white">Dashboard</Button>
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white">My Projects</Button>
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white">Collaborate</Button>
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white">Voice Library</Button>
            <Button variant="ghost" size="sm" className="bg-slate-800 text-white">Editor</Button>
          </nav>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Language selector */}
          <Button variant="ghost" size="sm" className="text-slate-400">
            <Globe className="h-4 w-4 mr-1" />
            US English
          </Button>
          <Bell className="h-5 w-5 text-slate-400" />
          <div className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center">
            <span className="text-sm font-medium text-white">JA</span>
          </div>
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
          <Button 
            variant="outline" 
            size="sm"
            className="h-7 text-xs border-slate-700"
            onClick={onTranslateAndDub}
          >
            <Sparkles className="h-3 w-3 mr-1" />
            Translate & Dub
          </Button>
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
          <Button variant="ghost" size="sm" className="h-8">
            <Share2 className="h-4 w-4" />
          </Button>
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
            className="h-8 bg-amber-500 hover:bg-amber-600 text-black font-medium"
            onClick={onExport}
          >
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
          <Button variant="ghost" size="sm" className="h-8">
            <User className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      {/* Main content */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left sidebar - QC Tabs */}
        <div className="w-14 flex flex-col items-center py-2 border-r border-neutral-800 bg-neutral-900/70">
          {QC_TABS.map((tab, idx) => (
            <div key={tab.id}>
              {/* Add divider before QC-specific tabs (after 6 main tabs) */}
              {tab.isQCTab && idx === 6 && (
                <div className="w-8 h-px bg-slate-700 my-2" />
              )}
              <button
                className={cn(
                  'w-10 h-10 rounded-lg flex flex-col items-center justify-center mb-1 transition-colors',
                  activeQCCategory === tab.id 
                    ? 'bg-amber-600/20 text-amber-400 ring-1 ring-amber-500/50' 
                    : activeSidebarTab === tab.id 
                      ? 'bg-slate-700 text-white' 
                      : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                )}
                onClick={() => tab.isQCTab ? handleQCCategoryClick(tab.id) : setActiveSidebarTab(tab.id as SidebarTab)}
              >
                <tab.icon className="h-5 w-5" />
                <span className="text-[8px] mt-0.5">{tab.label}</span>
              </button>
            </div>
          ))}
        </div>
        
        {/* Transcript area */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {/* Pending alert */}
          {pendingCount > 0 && (
            <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-400" />
              <span className="text-sm text-amber-200">
                Dubbing for {pendingCount} translated segment{pendingCount > 1 ? 's' : ''} needs to be generated.
              </span>
            </div>
          )}
          
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
            <div className="flex-1" />
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
          <ScrollArea className="flex-1 overflow-auto">
          {displaySegments.map((segment, index) => {
              const speakerColor = getSpeakerColor(segment.speaker_id)
              const highlightColor = getSegmentHighlightColor(segment)
              const isEditing = editingSegmentIndex === index
              const segmentSuggestions = suggestions[index] || []
              
              return (
                <div
                  key={segment.id}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 border-b border-slate-800/50 transition-colors',
                    selectedSegmentIndex === index && 'bg-slate-800/50',
                    highlightColor === 'red' && 'border-l-4 border-l-red-500 bg-red-500/5',
                    highlightColor === 'yellow' && 'border-l-4 border-l-yellow-500 bg-yellow-500/5',
                    highlightColor === 'green' && 'border-l-4 border-l-emerald-500/30',
                  )}
                  onClick={() => selectSegment(index)}
                >
                  {/* Suggestion dropdown - drag to timeline */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          'h-7 px-2 text-xs font-medium shrink-0 min-w-[95px]',
                          speakerColor.bg,
                          speakerColor.text,
                          'border-transparent hover:border-slate-600'
                        )}
                      >
                        Speaker {(index % 5) + 1}
                        <ChevronDown className="h-3 w-3 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-80 bg-slate-900 border-slate-700">
                      <div className="px-2 py-1.5 text-xs text-slate-500 font-medium border-b border-slate-700 mb-1">
                        5 Suggestions - Drag to timeline to replace
                      </div>
                      {segmentSuggestions.map((sug, sugIdx) => (
                        <DropdownMenuItem
                          key={sug.id}
                          className="cursor-grab text-sm p-2"
                          draggable
                          onDragStart={(e) => handleDragStart(e, sug, index)}
                        >
                          <div className="flex items-center gap-2 w-full">
                            <GripHorizontal className="h-4 w-4 text-slate-600 shrink-0" />
                            <span className={cn(
                              'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0',
                              sugIdx === 0 ? 'bg-emerald-500/20 text-emerald-400' :
                              sugIdx === 1 ? 'bg-blue-500/20 text-blue-400' :
                              sugIdx === 2 ? 'bg-purple-500/20 text-purple-400' :
                              sugIdx === 3 ? 'bg-amber-500/20 text-amber-400' :
                              'bg-rose-500/20 text-rose-400'
                            )}>
                              {sugIdx + 1}
                            </span>
                            <span className="truncate flex-1">{sug.text}</span>
                            <span className="text-[10px] text-slate-500 shrink-0">{Math.round(sug.confidence * 100)}%</span>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  
                  {/* Source text */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-400">{segment.source_text}</p>
                  </div>
                  
                  {/* Target text (editable) */}
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-2">
                        <Input
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          className="flex-1 h-8 bg-transparent border-slate-600"
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
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                          // Play preview
                        }}>
                          <Play className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div 
                        className={cn(
                          'text-sm cursor-grab active:cursor-grabbing select-none inline-flex items-center gap-1 px-3 py-1 rounded-full border-2 text-white',
                          lockedSegments.has(index)
                            ? 'border-emerald-400 bg-emerald-500/20 shadow-[0_0_10px_rgba(34,197,94,0.4)]'
                            : 'border-amber-400 bg-amber-500/10 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                        )}
                        draggable={!lockedSegments.has(index)}
                        onDragStart={(e) => {
                          if (lockedSegments.has(index)) {
                            e.preventDefault()
                            return
                          }
                          const mockSuggestion: Suggestion = {
                            id: `direct-${index}`,
                            text: segment.target_text,
                            confidence: 1,
                            source: 'user'
                          }
                          handleDragStart(e, mockSuggestion, index)
                        }}
                        onDoubleClick={() => !lockedSegments.has(index) && startEditing(index)}
                      >
                        {lockedSegments.has(index) && <Lock className="h-3 w-3 shrink-0" />}
                        {segment.target_text}
                      </div>
                    )}
                  </div>
                </div>
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
            <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-400">
              <Sparkles className="h-4 w-4 mr-1" />
              Change Voice
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-400">
              <Sparkles className="h-4 w-4 mr-1" />
              Pronunciation
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-400">
              Emotion
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-400">
              Pause
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-400">
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
                onClick={handleGenerateSpeech}
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
            </div>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-400">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
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
          {/* Original / Translated toggle */}
          <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-slate-800">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 text-xs',
                playbackMode === 'original' ? 'text-white' : 'text-slate-500'
              )}
              onClick={() => setPlaybackMode('original')}
            >
              Original
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 text-xs px-3 rounded-full',
                playbackMode === 'dubbed' ? 'bg-slate-700 text-white' : 'text-slate-500'
              )}
              onClick={() => setPlaybackMode('dubbed')}
            >
              Translated
            </Button>
          </div>
          
{/* Video */}
            <div className="flex-1 min-h-0 relative bg-black">
              <video
                ref={videoRef}
                src={activeVideoUrl}
                className="absolute top-0 left-0 w-full h-full object-cover"
                onTimeUpdate={handleVideoTimeUpdate}
                controls={false}
              />
            
            {/* Subtitle overlay */}
            {selectedSegmentIndex !== null && displaySegments[selectedSegmentIndex] && (
              <div className="absolute bottom-8 left-0 right-0 text-center">
                <span className="bg-black/75 px-4 py-2 rounded text-white text-sm">
                  {displaySegments[selectedSegmentIndex].target_text}
                </span>
              </div>
            )}
            
            {/* Watermark */}
            <div className="absolute bottom-2 right-2 flex items-center gap-1 text-xs text-slate-500">
              <span>Video Translated by DubVerse</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Slide-Rule Correction Tool - pops up above timeline */}
      {showCorrectionSlider && selectedSegmentIndex !== null && activeQCCategory && (
        <div className="absolute bottom-[280px] left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 duration-200">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 shadow-2xl min-w-[450px]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-amber-400 capitalize flex items-center gap-2">
                {activeQCCategory === 'timing' && <Clock className="h-4 w-4" />}
                {activeQCCategory === 'sync' && <Music2 className="h-4 w-4" />}
                {activeQCCategory === 'pronunciation' && <Mic2 className="h-4 w-4" />}
                {activeQCCategory === 'translation' && <Languages className="h-4 w-4" />}
                {activeQCCategory === 'delivery' && <Gauge className="h-4 w-4" />}
                {activeQCCategory} Correction - Segment {selectedSegmentIndex + 1}
              </span>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setShowCorrectionSlider(false)}
                className="text-slate-400 hover:text-white h-6 px-2"
              >
                Cancel
              </Button>
            </div>
            
            {/* Slide Rule Visualization */}
            <div className="relative mb-4">
              <div className="flex justify-between text-xs text-slate-500 mb-2">
                <span>{activeQCCategory === 'timing' ? 'Squeeze -50%' : 'Earlier -500ms'}</span>
                <span className="text-amber-400 font-medium">Center</span>
                <span>{activeQCCategory === 'timing' ? 'Stretch +50%' : 'Later +500ms'}</span>
              </div>
              
              {/* Ruler marks */}
              <div className="relative h-10 bg-slate-700/50 rounded border border-slate-600 mb-2 overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-between px-2">
                  {Array.from({ length: 21 }).map((_, i) => (
                    <div 
                      key={i} 
                      className={cn(
                        'w-px',
                        i === 10 ? 'h-8 bg-amber-500' : i % 5 === 0 ? 'h-5 bg-slate-400' : 'h-3 bg-slate-600'
                      )}
                    />
                  ))}
                </div>
                {/* Current value indicator */}
                <div 
                  className="absolute top-0 bottom-0 w-1 bg-amber-400 transition-all"
                  style={{ 
                    left: `${50 + (correctionValue / (activeQCCategory === 'timing' ? 1 : 10))}%`,
                    transform: 'translateX(-50%)'
                  }}
                />
              </div>
              
              <Slider
                value={[correctionValue]}
                onValueChange={([v]) => setCorrectionValue(v)}
                min={activeQCCategory === 'timing' ? -50 : -500}
                max={activeQCCategory === 'timing' ? 50 : 500}
                step={activeQCCategory === 'timing' ? 1 : 10}
                className="w-full"
              />
              
              <div className="text-center mt-3 text-2xl font-mono text-white">
                {activeQCCategory === 'timing' 
                  ? `${correctionValue > 0 ? '+' : ''}${correctionValue}%`
                  : `${correctionValue > 0 ? '+' : ''}${correctionValue}ms`
                }
              </div>
            </div>
            
            <div className="flex justify-between gap-2">
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setCorrectionValue(activeQCCategory === 'timing' ? -10 : -100)}
                  className="text-xs"
                >
                  -{activeQCCategory === 'timing' ? '10%' : '100ms'}
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setCorrectionValue(0)}
                  className="text-xs"
                >
                  Reset
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setCorrectionValue(activeQCCategory === 'timing' ? 10 : 100)}
                  className="text-xs"
                >
                  +{activeQCCategory === 'timing' ? '10%' : '100ms'}
                </Button>
              </div>
              <Button 
                size="sm" 
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={applyCorrection}
              >
                Apply Correction
              </Button>
            </div>
          </div>
        </div>
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
            {/* Active QC filter indicator */}
            {activeQCCategory && (
              <div className="flex items-center gap-2 bg-amber-600/20 border border-amber-600/40 rounded-full px-3 py-1">
                <span className="text-xs text-amber-400 font-medium capitalize">
                  Showing: {activeQCCategory}
                </span>
                <button 
                  onClick={() => { setActiveQCCategory(null); setShowCorrectionSlider(false); }}
                  className="text-amber-400 hover:text-amber-300"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
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
              onClick={() => setIsPlaying(!isPlaying)}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
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
          {/* Track labels - fixed left column */}
          <div className="w-28 shrink-0 border-r border-neutral-800 bg-neutral-900/80 flex flex-col">
            {/* Time ruler header spacer */}
            <div className="h-6 shrink-0 border-b border-neutral-800 bg-neutral-900" />
            {/* Track labels - equal heights */}
            <div className="h-16 flex items-center px-2 text-xs text-neutral-400 border-b border-neutral-800">
              Video
            </div>
            <div className="h-16 flex flex-col justify-center px-2 text-xs text-neutral-400 border-b border-neutral-600 gap-1">
              <div className="flex items-center">
                <Waves className="h-3 w-3 mr-1 text-green-500" />
                <span>Audio</span>
              </div>
              <Slider
                value={[audioVolume]}
                onValueChange={(v) => setAudioVolume(v[0])}
                max={100}
                step={1}
                thumbless
                className="w-full h-1"
              />
            </div>
            <div className="flex-1 flex flex-col justify-center px-2 text-xs text-neutral-400 border-b border-neutral-800 gap-1">
              <div className="flex items-center">
                <Volume2 className="h-3 w-3 mr-1 text-blue-400" />
                <span className="truncate">Original</span>
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
            <div className="flex-1 flex flex-col justify-center px-2 text-xs text-neutral-400 border-b border-neutral-800 gap-1">
              <div className="flex items-center">
                <Volume2 className="h-3 w-3 mr-1 text-amber-400" />
                <span className="truncate">Dubbed</span>
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
            <div className="flex-1 flex flex-col justify-center px-2 text-xs text-neutral-400 gap-1">
              <div className="flex items-center">
                <Music2 className="h-3 w-3 mr-1 text-purple-400" />
                <span>BG</span>
              </div>
              <Slider
                value={[backgroundVolume]}
                onValueChange={(v) => setBackgroundVolume(v[0])}
                max={100}
                step={1}
                thumbless
                className="w-full h-1"
              />
            </div>
          </div>
          
          {/* Scrollable timeline */}
          <div 
            ref={timelineRef} 
            className="flex-1 overflow-x-auto overflow-y-hidden flex flex-col"
            onWheel={handleTimelineWheel}
          >
            <div 
              className="flex flex-col min-h-full relative" 
              style={{ width: timelineWidth }}
              onClick={(e) => {
                // Only seek if clicking directly on timeline, not on QC box or player needle
                if (e.target !== e.currentTarget && 
                    !(e.target as HTMLElement).closest('[data-timeline-track]')) {
                  return
                }
                // Click to seek - calculate time from click position
                const rect = e.currentTarget.getBoundingClientRect()
                const x = e.clientX - rect.left
                const newTime = Math.max(0, Math.min(x / PIXELS_PER_SECOND, videoDuration))
                setCurrentTime(newTime)
                if (videoRef.current) {
                  videoRef.current.currentTime = newTime
                }
              }}
            >
              {/* Time ruler */}
              <div className="h-6 shrink-0 bg-neutral-900 border-b border-neutral-800 relative" data-timeline-track>
                {Array.from({ length: Math.ceil(videoDuration) }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute top-0 flex flex-col items-center"
                    style={{ left: i * PIXELS_PER_SECOND }}
                  >
                    <div className="h-2 w-px bg-slate-600" />
                    <span className="text-[9px] text-slate-500 mt-0.5">{formatTime(i)}</span>
                  </div>
                ))}
              </div>
              
{/* Video track with thumbnails */}
              <div className="h-16 bg-neutral-900/30 border-b border-neutral-800/50 relative overflow-hidden" data-timeline-track>
                {videoThumbnails.length > 0 ? (
                  <div 
                    className="absolute inset-y-1 left-1 right-1 flex rounded overflow-hidden border border-emerald-500/50"
                  >
                    {videoThumbnails.map((thumb, idx) => (
                      <img
                        key={idx}
                        src={thumb}
                        alt=""
                        className="h-full object-cover flex-shrink-0"
                        style={{ 
                          width: `${(videoDuration / videoThumbnails.length) * PIXELS_PER_SECOND}px`,
                          minWidth: '40px'
                        }}
                        draggable={false}
                      />
                    ))}
                  </div>
                ) : isExtractingThumbnails ? (
                  <div className="absolute inset-y-1 left-1 right-1 bg-emerald-600/20 border border-emerald-500/50 rounded flex items-center justify-center">
                    <span className="text-xs text-emerald-400 animate-pulse">Extracting frames...</span>
                  </div>
                ) : null}
              </div>
              
{/* Audio waveform track - two stereo channels with mirrored waveforms */}
              <div className="h-16 bg-neutral-900/50 border-b border-neutral-600 relative overflow-hidden" data-timeline-track>
                <div className="absolute inset-0 flex flex-col">
                  {/* Top stereo channel */}
                  <div className="flex-1 relative border-b border-neutral-700/50">
                    <svg 
                      className="absolute inset-0 w-full h-full"
                      preserveAspectRatio="none"
                      style={{ shapeRendering: 'crispEdges' }}
                    >
                      {waveformData.map((v, i) => {
                        const barHeight = v * 45
                        const x = (i / waveformData.length) * 100
                        const width = 100 / waveformData.length
                        return (
                          <rect
                            key={i}
                            x={`${x}%`}
                            y={`${50 - barHeight}%`}
                            width={`${width}%`}
                            height={`${barHeight * 2}%`}
                            fill="#22c55e"
                          />
                        )
                      })}
                    </svg>
                  </div>
                  {/* Bottom stereo channel */}
                  <div className="flex-1 relative">
                    <svg 
                      className="absolute inset-0 w-full h-full"
                      preserveAspectRatio="none"
                      style={{ shapeRendering: 'crispEdges' }}
                    >
                      {waveformData.map((v, i) => {
                        const barHeight = v * 42
                        const x = (i / waveformData.length) * 100
                        const width = 100 / waveformData.length
                        return (
                          <rect
                            key={i}
                            x={`${x}%`}
                            y={`${50 - barHeight}%`}
                            width={`${width}%`}
                            height={`${barHeight * 2}%`}
                            fill="#22c55e"
                          />
                        )
                      })}
                    </svg>
                  </div>
                </div>
              </div>
              
              {/* Original audio track */}
              <div className="flex-1 bg-neutral-900/20 border-b border-neutral-800/50 relative" data-timeline-track>
                {displaySegments.map((segment) => (
                  <div
                    key={`orig-${segment.id}`}
                    className="absolute top-1 bottom-1 bg-blue-500/30 border border-blue-500/50 rounded cursor-pointer hover:bg-blue-500/40"
                    style={{
                      left: segment.start_time * PIXELS_PER_SECOND,
                      width: (segment.end_time - segment.start_time) * PIXELS_PER_SECOND,
                    }}
                  />
                ))}
              </div>
              
{/* Dubbed audio track with stretch/squeeze handles */}
              <div
                className={cn(
                  "flex-1 bg-neutral-900/20 border-b border-neutral-800/50 relative",
                  draggedTranslation && "bg-amber-500/10 border-amber-500/30"
                )}
                data-timeline-track
                onDragOver={handleTimelineDragOver}
                onDrop={handleDubbedTrackDrop}
              >
                {displaySegments.map((segment, index) => {
                  const highlightColor = getSegmentHighlightColor(segment)
                  const droppedTranslation = droppedTranslations.find(t => t.segmentIndex === index)
                  const hasDroppedTranslation = !!droppedTranslation
                  
                  const bgColor = hasDroppedTranslation
                    ? 'bg-amber-500/40 border-amber-400 ring-2 ring-amber-400/50'
                    : highlightColor === 'red'
                    ? 'bg-red-500/40 border-red-500 animate-pulse'
                    : highlightColor === 'yellow'
                    ? 'bg-yellow-500/40 border-yellow-500'
                    : highlightColor === 'green'
                    ? 'bg-emerald-500/30 border-emerald-500/50'
                    : 'bg-amber-500/30 border-amber-500/50'
                  
                  return (
                    <div
                      key={`dub-${segment.id}`}
                      className={cn(
                        'absolute top-1 bottom-1 rounded cursor-pointer group border transition-all',
                        bgColor,
                        selectedSegmentIndex === index && 'ring-2 ring-white/50'
                      )}
                      style={{
                        left: segment.start_time * PIXELS_PER_SECOND,
                        width: (segment.end_time - segment.start_time) * PIXELS_PER_SECOND,
                      }}
                      onClick={() => handleSegmentClickForQC(index)}
                      onDrop={(e) => handleTimelineDrop(e, index)}
                      onDragOver={handleTimelineDragOver}
                    >
                      {/* Left stretch handle */}
                      <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-white/20 rounded-l">
                        <GripHorizontal className="h-3 w-3 rotate-90" />
                      </div>
                      
                      {/* Content */}
                      <div className="px-3 truncate text-[10px] h-full flex items-center text-white/80">
                        {segment.target_text}
                      </div>
                      
                      {/* Right stretch handle */}
                      <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 flex items-center justify-center bg-white/20 rounded-r">
                        <GripHorizontal className="h-3 w-3 rotate-90" />
                      </div>
                    </div>
                  )
                })}
              </div>
              
              {/* Background track */}
              <div className="flex-1 bg-neutral-900/10 relative" data-timeline-track>
              </div>
              
              {/* QC Highlight Box - transparent rectangle with independently draggable needles */}
              {showQcBox && qcBoxPosition && (
                <div
                  className="absolute top-0 bottom-0 z-25"
                  style={{
                    left: `${qcBoxPosition.start * PIXELS_PER_SECOND}px`,
                    width: `${(qcBoxPosition.end - qcBoxPosition.start) * PIXELS_PER_SECOND}px`,
                  }}
                >
                  {/* Left needle - independently draggable */}
                  <div 
                    className="absolute left-0 top-0 bottom-0 w-[3px] cursor-ew-resize z-30"
                    style={{
                      backgroundColor: qcBoxColor === 'red' ? '#ef4444' : 
                                       qcBoxColor === 'yellow' ? '#eab308' : 
                                       qcBoxColor === 'blue' ? '#3b82f6' : '#22c55e'
                    }}
                    onMouseDown={handleLeftNeedleDrag}
                  >
                    {/* Left needle hit area */}
                    <div className="absolute -left-2 -right-2 top-0 bottom-0" />
                    {/* Left needle top triangle */}
                    <div 
                      className="absolute top-1 left-1/2 -translate-x-1/2"
                      style={{
                        width: 0,
                        height: 0,
                        borderLeft: '6px solid transparent',
                        borderRight: '6px solid transparent',
                        borderTop: `10px solid ${
                          qcBoxColor === 'red' ? '#ef4444' : 
                          qcBoxColor === 'yellow' ? '#eab308' : 
                          qcBoxColor === 'blue' ? '#3b82f6' : '#22c55e'
                        }`,
                      }}
                    />
                  </div>
                  
                  {/* Transparent colored box - drag to move entire box */}
                  <div 
                    className="absolute inset-x-[3px] top-[24px] bottom-0 cursor-move border-t-2 border-b-2"
                    style={{
                      backgroundColor: qcBoxColor === 'red' ? 'rgba(239, 68, 68, 0.2)' : 
                                       qcBoxColor === 'yellow' ? 'rgba(234, 179, 8, 0.2)' : 
                                       qcBoxColor === 'blue' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(34, 197, 94, 0.2)',
                      borderColor: qcBoxColor === 'red' ? '#ef4444' : 
                                   qcBoxColor === 'yellow' ? '#eab308' : 
                                   qcBoxColor === 'blue' ? '#3b82f6' : '#22c55e',
                    }}
                    onMouseDown={handleQcBoxDragStart}
                  />
                  
                  {/* Right needle - independently draggable */}
                  <div 
                    className="absolute right-0 top-0 bottom-0 w-[3px] cursor-ew-resize z-30"
                    style={{
                      backgroundColor: qcBoxColor === 'red' ? '#ef4444' : 
                                       qcBoxColor === 'yellow' ? '#eab308' : 
                                       qcBoxColor === 'blue' ? '#3b82f6' : '#22c55e'
                    }}
                    onMouseDown={handleRightNeedleDrag}
                  >
                    {/* Right needle hit area */}
                    <div className="absolute -left-2 -right-2 top-0 bottom-0" />
                    {/* Right needle top triangle */}
                    <div 
                      className="absolute top-1 left-1/2 -translate-x-1/2"
                      style={{
                        width: 0,
                        height: 0,
                        borderLeft: '6px solid transparent',
                        borderRight: '6px solid transparent',
                        borderTop: `10px solid ${
                          qcBoxColor === 'red' ? '#ef4444' : 
                          qcBoxColor === 'yellow' ? '#eab308' : 
                          qcBoxColor === 'blue' ? '#3b82f6' : '#22c55e'
                        }`,
                      }}
                    />
                  </div>
                </div>
              )}
              
              {/* Player needle - yellow triangle head + silver line - DRAGGABLE */}
              <div 
                className="absolute top-0 bottom-0 z-30 pointer-events-auto"
                style={{ left: `${currentTime * PIXELS_PER_SECOND}px` }}
              >
                {/* Yellow triangle head in time ruler - clickable to drag */}
                <div 
                  className="absolute top-1 -left-[6px] cursor-ew-resize"
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
                {/* Silver thin needle line - spans all tracks */}
                <div className="absolute top-[14px] bottom-0 left-0 w-[1px] bg-gray-400 pointer-events-none" />
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
    </div>
  )
}
