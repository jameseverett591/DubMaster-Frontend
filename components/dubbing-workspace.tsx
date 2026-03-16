"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ArrowLeft,
  Play,
  Pause,
  Volume2,
  VolumeX,
  SkipBack,
  SkipForward,
  Download,
  Settings2,
  AudioWaveform as Waveform,
  User,
  Baby,
  Mic2,
  Languages,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  BarChart3,
  Film,
  Crown,
  Lock,
} from "lucide-react"
import type { VideoSource, DetectedVoice } from "@/components/dashboard"
import { VoiceSelector } from "@/components/voice-selector"
import { TranscriptEditor } from "@/components/transcript-editor"
import { TimelineEditor } from "@/components/timeline-editor"
import { DubbedVideoResult } from "@/components/dubbed-video-result"
import { QualityAnalysisPanel } from "@/components/quality-analysis"
import {
  apiClient,
  isTerminalStatus,
  JobNotFoundError,
  type Transcript,
  type Voice,
  type JobStatus,
} from "@/lib/api-client"

interface DubbingWorkspaceProps {
  video: VideoSource
  onClose: () => void
}

const LANGUAGES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", flag: "🇵🇹" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
  { code: "zh", name: "Chinese", flag: "🇨🇳" },
  { code: "ar", name: "Arabic", flag: "🇸🇦" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "ru", name: "Russian", flag: "🇷🇺" },
  { code: "nl", name: "Dutch", flag: "🇳🇱" },
]

// ── Helpers ────────────────────────────────────────────────────────────────

function buildDetectedVoices(
  transcript: Transcript,
  speakerGenders?: Record<string, string> | null
): DetectedVoice[] {
  const map: Record<string, { start: number; end: number }[]> = {}
  for (const seg of transcript.segments) {
    if (!map[seg.speaker]) map[seg.speaker] = []
    map[seg.speaker].push({ start: seg.start, end: seg.end })
  }

  return Object.entries(map).map(([speakerId, timeRanges]) => {
    const gender = speakerGenders?.[speakerId]
    const type: DetectedVoice["type"] =
      gender === "female" ? "female" : gender === "child" ? "child" : "male"
    const label =
      speakerId.charAt(0).toUpperCase() +
      speakerId.slice(1).replace(/-/g, " ").replace(/_/g, " ")
    const defaultVoice = type === "female" ? "female-1" : type === "child" ? "child-1" : "male-1"
    return {
      id: speakerId,
      type,
      characterName: `${label} (${type})`,
      timeRanges,
      selectedVoice: defaultVoice,
    }
  })
}

// ── Component ──────────────────────────────────────────────────────────────

export function DubbingWorkspace({ video, onClose }: DubbingWorkspaceProps) {
  const [targetLanguage, setTargetLanguage] = useState("en")
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(80)
  const [isMuted, setIsMuted] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(true)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [detectedVoices, setDetectedVoices] = useState<DetectedVoice[]>([])
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [speakerGenders, setSpeakerGenders] = useState<Record<string, string> | null>(null)
  const [availableVoices, setAvailableVoices] = useState<Voice[]>([])
  const [isDubbing, setIsDubbing] = useState(false)
  const [dubbingProgress, setDubbingProgress] = useState(0)
  const [dubbingError, setDubbingError] = useState<string | null>(null)
  const [voiceSettingsMap, setVoiceSettingsMap] = useState<Record<string, { pitch: number; speed: number }>>({})
  const [activeTab, setActiveTab] = useState("voices")
  const [dubbingComplete, setDubbingComplete] = useState(false)
  const [dubbedVideoUrl, setDubbedVideoUrl] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [videoBounds, setVideoBounds] = useState<{ bottom: number; right: number } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoContainerRef = useRef<HTMLDivElement>(null)

  // The video source shown in the main player
  const mainVideoSrc =
    dubbingComplete && dubbedVideoUrl && !showOriginal
      ? dubbedVideoUrl
      : video.url

  // ── Load voices & TTS provider from backend ─────────────────────────────
  const [ttsProvider, setTtsProvider] = useState<string>("elevenlabs")
  const [providerInfo, setProviderInfo] = useState<Record<string, { available: boolean; voice_cloning?: boolean }>>({})
  const [switchingProvider, setSwitchingProvider] = useState(false)

  const loadVoicesForProvider = async () => {
    try {
      const { voices, provider } = await apiClient.getVoices()
      setAvailableVoices(voices)
      setTtsProvider(provider)
    } catch {}
  }

  useEffect(() => {
    loadVoicesForProvider()
    apiClient.getTTSProvider()
      .then(({ providers }) => setProviderInfo(providers))
      .catch(() => {})
  }, [])

  // ── Load dubbing engines from backend ────────────────────────────────────
  const [dubbingEngine, setDubbingEngine] = useState<'dubmaster' | 'vozo'>('dubmaster')
  const [engineInfo, setEngineInfo] = useState<Record<string, { available: boolean; description: string; features: string[] }>>({})

  useEffect(() => {
    apiClient.getDubbingEngines()
      .then(({ engines }) => setEngineInfo(engines))
      .catch(() => {})
  }, [])

  const handleSwitchProvider = async (provider: string) => {
    if (provider === ttsProvider || switchingProvider) return
    setSwitchingProvider(true)
    try {
      const result = await apiClient.setTTSProvider(provider)
      setTtsProvider(result.active)
      setProviderInfo(result.providers)
      // Reload voices for the new provider
      await loadVoicesForProvider()
    } catch (err) {
      console.error("Failed to switch provider:", err)
    } finally {
      setSwitchingProvider(false)
    }
  }

  // ── Analyse video: fetch transcript (or simulate if no jobId) ─────────────
  useEffect(() => {
    if (!video.jobId) {
      const timer = setTimeout(() => {
        setIsAnalyzing(false)
        setDetectedVoices([
          {
            id: "voice-1",
            type: "male",
            characterName: "Speaker 1 (Male)",
            timeRanges: [
              { start: 0, end: 15 },
              { start: 45, end: 78 },
              { start: 120, end: 180 },
            ],
            selectedVoice: "male-1",
          },
          {
            id: "voice-2",
            type: "female",
            characterName: "Speaker 2 (Female)",
            timeRanges: [
              { start: 16, end: 44 },
              { start: 79, end: 119 },
            ],
            selectedVoice: "female-1",
          },
          {
            id: "voice-3",
            type: "child",
            characterName: "Speaker 3 (Child)",
            timeRanges: [{ start: 181, end: 220 }],
            selectedVoice: "child-1",
          },
        ])
      }, 3000)
      return () => clearTimeout(timer)
    }

    let cancelled = false

    const applyCompletedJob = async (status: JobStatus) => {
      if (cancelled) return
      setSpeakerGenders(status.speaker_genders ?? null)
      try {
        const t = await apiClient.getTranscript(video.jobId!)
        if (cancelled) return
        setTranscript(t)
        setDetectedVoices(buildDetectedVoices(t, status.speaker_genders))
        setIsAnalyzing(false)
      } catch {
        if (!cancelled) {
          setAnalyzeError("Transcript not available. Try re-uploading the video.")
          setIsAnalyzing(false)
        }
      }
    }

    let retries = 0
    const MAX_RETRIES = 360
    let interval = 5000

    const poll = async () => {
      if (cancelled || retries >= MAX_RETRIES) {
        if (!cancelled && retries >= MAX_RETRIES) {
          setAnalyzeError("Processing is taking longer than expected. Please try again.")
          setIsAnalyzing(false)
        }
        return
      }
      retries++

      try {
        const status = await apiClient.getJobStatus(video.jobId!)
        if (cancelled) return
        interval = 5000

        if (status.status === "completed") {
          await applyCompletedJob(status)
          return
        }

        if (status.status === "failed") {
          if (!cancelled) {
            setAnalyzeError(status.error_message || "Processing failed on the server.")
            setIsAnalyzing(false)
          }
          return
        }

        if (!isTerminalStatus(status.status)) {
          setTimeout(poll, interval)
        }
      } catch (err) {
        if (err instanceof JobNotFoundError) {
          if (!cancelled) {
            setAnalyzeError("Job was deleted or is no longer available.")
            setIsAnalyzing(false)
          }
          return
        }
        interval = Math.min(interval * 1.5, 15000)
        if (!cancelled) setTimeout(poll, interval)
      }
    }

    poll()

    return () => {
      cancelled = true
    }
  }, [video.jobId])

  // ── Video player handlers ─────────────────────────────────────────────────
  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  const handleTimeUpdate = () => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime)
  }

  const handleLoadedMetadata = () => {
    if (videoRef.current) setDuration(videoRef.current.duration)
    updateVideoBounds()
  }

  const handleSeek = (value: number[]) => {
    if (videoRef.current) {
      videoRef.current.currentTime = value[0]
      setCurrentTime(value[0])
    }
  }

  const handleVolumeChange = (value: number[]) => {
    setVolume(value[0])
    if (videoRef.current) videoRef.current.volume = value[0] / 100
    setIsMuted(value[0] === 0)
  }

  const toggleMute = () => {
    if (videoRef.current) {
      if (isMuted) {
        videoRef.current.volume = volume / 100
        setIsMuted(false)
      } else {
        videoRef.current.volume = 0
        setIsMuted(true)
      }
    }
  }

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const handleVoiceChange = (voiceId: string, newVoice: string) => {
    setDetectedVoices((prev) => prev.map((v) => (v.id === voiceId ? { ...v, selectedVoice: newVoice } : v)))
  }

  // Reset to original when switching sources
  useEffect(() => {
    setIsPlaying(false)
  }, [showOriginal])

  // ── Dubbing ───────────────────────────────────────────────────────────────
  const progressRef = useRef(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const simulateDubbing = () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    progressRef.current = 0
    const targetSequence = [12, 25, 35, 55, 70, 88, 95, 100]
    let targetIdx = 0
    intervalRef.current = setInterval(() => {
      const target = targetSequence[targetIdx]
      progressRef.current = Math.min(progressRef.current + 1 + Math.random() * 4, target)
      if (progressRef.current >= target) {
        progressRef.current = target
        targetIdx++
      }
      const newProgress = Math.round(progressRef.current * 10) / 10
      setDubbingProgress(newProgress)
      if (newProgress >= 100) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        intervalRef.current = null
        setDubbingProgress(100)
        setIsDubbing(false)
        setDubbingComplete(true)
      }
    }, 350)
  }

  const pollDubbingStatus = (jobId: string) => {
    let cancelled = false
    let retries = 0
    const MAX_RETRIES = 360
    let interval = 5000

    const poll = async () => {
      if (cancelled) return
      if (retries >= MAX_RETRIES) {
        setIsDubbing(false)
        setDubbingError("Dubbing is taking longer than expected. Please check back later.")
        return
      }
      retries++

      try {
        const status = await apiClient.getJobStatus(jobId)
        if (cancelled) return
        interval = 5000
        setDubbingProgress(status.progress)

        if (status.status === "completed") {
          setDubbingProgress(100)
          setIsDubbing(false)
          setDubbingComplete(true)
          if (status.dubbed_video_url) {
            const fullUrl = status.dubbed_video_url.startsWith("http")
              ? status.dubbed_video_url
              : `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}${status.dubbed_video_url}`
            setDubbedVideoUrl(fullUrl)
          }
          return
        }

        if (status.status === "failed") {
          setIsDubbing(false)
          setDubbingError(status.error_message || "Dubbing failed on the server.")
          return
        }

        if (!isTerminalStatus(status.status)) setTimeout(poll, interval)
      } catch (err) {
        if (err instanceof JobNotFoundError) {
          if (!cancelled) {
            setIsDubbing(false)
            setDubbingError("Job was deleted or is no longer available.")
          }
          return
        }
        interval = Math.min(interval * 1.5, 15000)
        if (!cancelled) setTimeout(poll, interval)
      }
    }
    setTimeout(poll, 3000)
    return () => { cancelled = true }
  }

  const handleStartDubbing = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current)

    setIsDubbing(true)
    setDubbingProgress(0)
    setDubbingComplete(false)
    setDubbingError(null)
    setDubbedVideoUrl(null)
    setShowOriginal(false)
    setActiveTab("result")

    if (!video.jobId) {
      simulateDubbing()
      return
    }

    try {
      const voiceMapping: Record<string, string> = {}
      for (const v of detectedVoices) {
        voiceMapping[v.id] = v.selectedVoice
      }

      const transcriptSegments = transcript
        ? transcript.segments
        : detectedVoices.flatMap((v) =>
            v.timeRanges.map((r) => ({
              text: "",
              start: r.start,
              end: r.end,
              speaker: v.id,
            }))
          )

      // Convert UI pitch/speed settings to backend voice_settings format.
      // pitch -> style (0=flat, 100=expressive), speed is handled by TTS provider.
      const voiceSettings: Record<string, Record<string, number>> = {}
      for (const [voiceId, settings] of Object.entries(voiceSettingsMap)) {
        voiceSettings[voiceId] = {
          style: settings.pitch / 100,
          stability: 1 - (settings.pitch / 100) * 0.5,  // higher pitch variance = lower stability
          similarity_boost: 0.9,
        }
      }

      await apiClient.startDubbing({
        job_id: video.jobId,
        target_language: targetLanguage,
        transcript: transcriptSegments,
        voice_mapping: voiceMapping,
        dubbing_engine: dubbingEngine,
        ...(Object.keys(voiceSettings).length > 0 && { voice_settings: voiceSettings }),
      })

      pollDubbingStatus(video.jobId)
    } catch (err) {
      setIsDubbing(false)
      setDubbingError(err instanceof Error ? err.message : "Failed to start dubbing.")
    }
  }

  const handleRegenerate = () => {
    handleStartDubbing()
  }

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  // ── Compute actual video content bounds within the object-contain container ──
  const updateVideoBounds = useCallback(() => {
    const vid = videoRef.current
    const container = videoContainerRef.current
    if (!vid || !container || !vid.videoWidth || !vid.videoHeight) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    const videoAspect = vid.videoWidth / vid.videoHeight
    const containerAspect = cw / ch
    let renderW: number, renderH: number
    if (videoAspect > containerAspect) {
      renderW = cw
      renderH = cw / videoAspect
    } else {
      renderH = ch
      renderW = ch * videoAspect
    }
    const offsetBottom = (ch - renderH) / 2
    const offsetRight = (cw - renderW) / 2
    setVideoBounds({ bottom: offsetBottom + 8, right: offsetRight + 12 })
  }, [])

  useEffect(() => {
    updateVideoBounds()
    window.addEventListener("resize", updateVideoBounds)
    return () => window.removeEventListener("resize", updateVideoBounds)
  }, [updateVideoBounds])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 14rem)', marginTop: '10rem', marginBottom: '9rem' }}>
      {/* Top Bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/50 bg-background/50 backdrop-blur-md px-4 py-2">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h2 className="font-semibold text-foreground text-sm truncate">{video.title}</h2>
            <p className="text-xs text-muted-foreground">
              {video.duration} • {video.source === "upload" ? "Uploaded" : video.source}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={targetLanguage} onValueChange={setTargetLanguage}>
            <SelectTrigger className="w-[160px] h-8 text-sm">
              <Languages className="mr-2 h-3.5 w-3.5" />
              <SelectValue placeholder="Target Language" />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>
                  <span className="mr-2">{lang.flag}</span>
                  {lang.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8">
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Dubbing Engine</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={dubbingEngine} onValueChange={(v) => setDubbingEngine(v as 'dubmaster' | 'vozo')}>
                <DropdownMenuRadioItem value="dubmaster">
                  DubMaster (Local)
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="vozo" disabled={!engineInfo.vozo?.available}>
                  Vozo AI (Cloud)
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              {dubbingEngine === "dubmaster" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>TTS Engine</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup value={ttsProvider} onValueChange={handleSwitchProvider}>
                    <DropdownMenuRadioItem value="elevenlabs" disabled={!providerInfo.elevenlabs?.available}>
                      ElevenLabs
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="fish-audio" disabled={!providerInfo["fish-audio"]?.available}>
                      Fish Audio S1 {providerInfo["fish-audio"]?.voice_cloning && "(Voice Clone)"}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Badge variant="outline" className={`text-xs h-6 font-normal ${switchingProvider ? "animate-pulse" : ""}`}>
            {dubbingEngine === "vozo"
              ? "Vozo AI"
              : ttsProvider === "fish-audio" ? "Fish Audio S1" : "ElevenLabs"}
          </Badge>
          <Button
            onClick={handleStartDubbing}
            disabled={isAnalyzing || isDubbing}
            className="gap-2 h-8 text-sm"
            variant={dubbingComplete ? "outline" : "default"}
          >
            {isDubbing ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Dubbing... {Math.round(dubbingProgress)}%
              </>
            ) : dubbingComplete ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                Dub Complete
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Generate Dub
              </>
            )}
          </Button>
          <Button variant="secondary" className="gap-2 h-8 text-sm" disabled={!dubbingComplete || !dubbedVideoUrl}>
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Video Player Section — takes all remaining space */}
        <div className="flex flex-1 flex-col min-w-0">
          <div ref={videoContainerRef} className="relative flex-1 bg-black min-h-0">
            <video
              ref={videoRef}
              src={mainVideoSrc}
              className="absolute inset-0 h-full w-full object-contain"
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              poster={video.thumbnail}
              onClick={handlePlayPause}
            />

            {/* Timestamp overlay — positioned inside the actual video content */}
            <div
              className="absolute z-10 bg-black/70 text-white font-mono text-sm px-3 py-1.5 rounded-md select-none pointer-events-none tabular-nums tracking-wide"
              style={{
                bottom: videoBounds?.bottom ?? 16,
                right: videoBounds?.right ?? 16,
              }}
            >
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>

            {/* AI Analysis Overlay */}
            {isAnalyzing && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
                <div className="flex flex-col items-center gap-4 text-white">
                  <Waveform className="h-16 w-16 animate-pulse text-primary" />
                  <div className="text-center">
                    <p className="text-lg font-medium">Analyzing Audio</p>
                    <p className="text-sm text-gray-400">
                      {video.jobId
                        ? "Waiting for transcription to complete..."
                        : "Detecting voices and identifying speakers..."}
                    </p>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-blue-400" />
                      <span>Male voices</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-pink-400" />
                      <span>Female voices</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Baby className="h-4 w-4 text-green-400" />
                      <span>Children</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Analysis error */}
            {analyzeError && !isAnalyzing && (
              <div className="absolute inset-x-4 bottom-4 flex items-center gap-2 rounded-lg bg-destructive/90 p-3 text-sm text-white z-10">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {analyzeError}
              </div>
            )}

            {/* Original / Dubbed toggle — shown when dub is complete */}
            {dubbingComplete && dubbedVideoUrl && (
              <div className="absolute left-4 top-4 flex gap-2 z-10">
                <Button
                  size="sm"
                  variant={showOriginal ? "outline" : "default"}
                  onClick={() => setShowOriginal(false)}
                  className="text-xs h-7"
                >
                  Dubbed
                </Button>
                <Button
                  size="sm"
                  variant={showOriginal ? "default" : "outline"}
                  onClick={() => setShowOriginal(true)}
                  className="text-xs h-7"
                >
                  Original
                </Button>
              </div>
            )}
          </div>

          {/* Video Controls */}
          <div className="shrink-0 border-t border-border/50 bg-card/50 backdrop-blur-md px-4 py-2">
            <div className="mb-2">
              <Slider
                value={[currentTime]}
                max={duration || 100}
                step={0.1}
                onValueChange={handleSeek}
                className="cursor-pointer"
              />
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <SkipBack className="h-4 w-4" />
                </Button>
                <Button size="icon" className="h-8 w-8" onClick={handlePlayPause}>
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleMute}>
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </Button>
                <div className="w-20">
                  <Slider value={[isMuted ? 0 : volume]} max={100} step={1} onValueChange={handleVolumeChange} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Panel — fixed width, fits in viewport */}
        <div className="w-80 shrink-0 border-l border-border/50 bg-card/50 backdrop-blur-md flex flex-col min-h-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col min-h-0">
            <TabsList className="mx-3 mt-3 grid grid-cols-6 shrink-0">
              <TabsTrigger value="voices" className="gap-1 text-xs px-1">
                <Mic2 className="h-3.5 w-3.5" />
                Voices
              </TabsTrigger>
              <TabsTrigger value="transcript" className="gap-1 text-xs px-1">
                <Waveform className="h-3.5 w-3.5" />
                Script
              </TabsTrigger>
              <TabsTrigger value="timeline" className="gap-1 text-xs px-1">
                <Settings2 className="h-3.5 w-3.5" />
                Timeline
              </TabsTrigger>
              <TabsTrigger value="result" className="gap-1 text-xs px-1 relative">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Result
                {dubbingComplete && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-green-500" />}
              </TabsTrigger>
              <TabsTrigger value="quality" className="gap-1 text-xs px-1">
                <BarChart3 className="h-3.5 w-3.5" />
                Quality
              </TabsTrigger>
              <TabsTrigger value="studio" className="gap-1 text-xs px-1 relative">
                <Film className="h-3.5 w-3.5" />
                Studio
                <Crown className="absolute -right-1 -top-1 h-2.5 w-2.5 text-amber-400" />
              </TabsTrigger>
            </TabsList>

            <TabsContent value="voices" className="flex-1 min-h-0 overflow-hidden">
              <ScrollArea className="h-full p-3">
                <VoiceSelector
                  detectedVoices={detectedVoices}
                  targetLanguage={targetLanguage}
                  onVoiceChange={handleVoiceChange}
                  onSettingsChange={(voiceId, settings) =>
                    setVoiceSettingsMap((prev) => ({ ...prev, [voiceId]: settings }))
                  }
                  isAnalyzing={isAnalyzing}
                  availableVoices={availableVoices}
                />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="transcript" className="flex-1 min-h-0 overflow-hidden">
              <ScrollArea className="h-full p-3">
                <TranscriptEditor
                  currentTime={currentTime}
                  targetLanguage={targetLanguage}
                  segments={transcript?.segments}
                  speakerGenders={speakerGenders ?? undefined}
                />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="timeline" className="flex-1 min-h-0 overflow-hidden">
              <ScrollArea className="h-full p-3">
                <TimelineEditor detectedVoices={detectedVoices} currentTime={currentTime} duration={duration} />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="result" className="flex-1 min-h-0 overflow-hidden">
              <ScrollArea className="h-full p-3">
                {isDubbing || dubbingComplete ? (
                  <DubbedVideoResult
                    originalVideo={video}
                    targetLanguage={targetLanguage}
                    detectedVoices={detectedVoices}
                    dubbingProgress={dubbingProgress}
                    isDubbing={isDubbing}
                    dubbedVideoUrl={dubbedVideoUrl ?? undefined}
                    dubbingError={dubbingError ?? undefined}
                    onRegenerate={handleRegenerate}
                    onClose={onClose}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center p-6">
                    <div className="rounded-full bg-muted p-4 mb-4">
                      <Sparkles className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="font-semibold text-foreground text-sm">No Dubbed Video Yet</h3>
                    <p className="mt-2 text-xs text-muted-foreground max-w-xs">
                      Select your target language, configure voice settings, then click &quot;Generate Dub&quot; to create your
                      dubbed video.
                    </p>
                    <Button className="mt-4 gap-2 text-sm h-8" onClick={handleStartDubbing} disabled={isAnalyzing}>
                      <Sparkles className="h-3.5 w-3.5" />
                      Generate Dub Now
                    </Button>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="quality" className="flex-1 min-h-0 overflow-hidden">
              <QualityAnalysisPanel
                jobId={video.jobId ?? ""}
                language={targetLanguage}
                dubbingComplete={dubbingComplete}
              />
            </TabsContent>

            <TabsContent value="studio" className="flex-1 min-h-0 overflow-hidden">
              <ScrollArea className="h-full p-3">
                <div className="space-y-4">
                  {/* Pro Header */}
                  <div className="rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-orange-500/5 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Crown className="h-5 w-5 text-amber-400" />
                      <h3 className="font-semibold text-sm text-foreground">Studio Editor</h3>
                      <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">PRO</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Professional video editor with timeline, lip-sync adjustment, and frame-by-frame control.
                    </p>
                  </div>

                  {/* Features List */}
                  <div className="rounded-lg border border-border bg-card p-3 space-y-3">
                    <h4 className="text-xs font-medium text-foreground">Studio Features</h4>
                    {[
                      { icon: Film, label: "Multi-track timeline editor", desc: "Edit audio & video tracks independently" },
                      { icon: Mic2, label: "Per-segment voice tuning", desc: "Adjust pitch, speed & emotion per line" },
                      { icon: Languages, label: "Real-time lip-sync preview", desc: "Frame-accurate mouth movement sync" },
                      { icon: Waveform, label: "Waveform audio editor", desc: "Trim, fade & crossfade audio segments" },
                    ].map(({ icon: Icon, label, desc }) => (
                      <div key={label} className="flex gap-2.5">
                        <div className="rounded-md bg-muted p-1.5 h-fit shrink-0">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-foreground">{label}</p>
                          <p className="text-[10px] text-muted-foreground">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Launch Button */}
                  {dubbingComplete ? (
                    <Button
                      className="w-full gap-2 h-9 text-xs bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0"
                      onClick={() => {
                        // Open studio editor with current job context
                        window.open(`/studio?job=${video.jobId}&lang=${targetLanguage}`, "_blank")
                      }}
                    >
                      <Film className="h-3.5 w-3.5" />
                      Open in Studio Editor
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <Button
                        className="w-full gap-2 h-9 text-xs"
                        variant="outline"
                        disabled
                      >
                        <Lock className="h-3.5 w-3.5" />
                        Complete Dubbing to Unlock
                      </Button>
                      <p className="text-[10px] text-center text-muted-foreground">
                        Generate a dub first, then open it in the Studio Editor for fine-tuning.
                      </p>
                    </div>
                  )}

                  {/* Subscription CTA */}
                  <div className="rounded-lg bg-muted/50 p-3 text-center">
                    <p className="text-[10px] text-muted-foreground">
                      Studio Editor is available on <span className="text-amber-400 font-medium">Professional</span> and <span className="text-amber-400 font-medium">Enterprise</span> plans.
                    </p>
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
