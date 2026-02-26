"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  ArrowLeft,
  Play,
  Pause,
  Volume2,
  VolumeX,
  SkipBack,
  SkipForward,
  Maximize2,
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
} from "lucide-react"
import type { VideoSource, DetectedVoice } from "@/components/dashboard"
import { VoiceSelector } from "@/components/voice-selector"
import { TranscriptEditor } from "@/components/transcript-editor"
import { TimelineEditor } from "@/components/timeline-editor"
import { DubbedVideoResult } from "@/components/dubbed-video-result"
import {
  apiClient,
  isTerminalStatus,
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
  const [activeTab, setActiveTab] = useState("voices")
  const [dubbingComplete, setDubbingComplete] = useState(false)
  const [dubbedVideoUrl, setDubbedVideoUrl] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // ── Load voices from backend ──────────────────────────────────────────────
  useEffect(() => {
    apiClient.getVoices().then(setAvailableVoices).catch(() => {
      // Non-fatal — fall back to hardcoded options in VoiceSelector
    })
  }, [])

  // ── Analyse video: fetch transcript (or simulate if no jobId) ─────────────
  useEffect(() => {
    if (!video.jobId) {
      // No backend job (e.g. YouTube/library) — use 3s simulation
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

    // Real backend job — poll until completed, then fetch transcript
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

    const poll = async () => {
      try {
        const status = await apiClient.getJobStatus(video.jobId!)
        if (cancelled) return

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
          setTimeout(poll, 2000)
        }
      } catch {
        if (!cancelled) setTimeout(poll, 4000)
      }
    }

    // Check immediately — if already done we won't wait unnecessarily
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
    const poll = async () => {
      if (cancelled) return
      try {
        const status = await apiClient.getJobStatus(jobId)
        if (cancelled) return
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

        if (!isTerminalStatus(status.status)) setTimeout(poll, 2000)
      } catch {
        if (!cancelled) setTimeout(poll, 4000)
      }
    }
    setTimeout(poll, 2000)
    // Return cleanup so callers can cancel if needed
    return () => { cancelled = true }
  }

  const handleStartDubbing = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current)

    setIsDubbing(true)
    setDubbingProgress(0)
    setDubbingComplete(false)
    setDubbingError(null)
    setDubbedVideoUrl(null)
    setActiveTab("result")

    if (!video.jobId) {
      // No real backend job — run simulation
      simulateDubbing()
      return
    }

    try {
      // Build voice mapping: speaker_id → voice_id
      // If a selected voice looks like a fallback ID (male-1 etc.), we omit it
      // and let the backend auto-assign by gender detection.
      const voiceMapping: Record<string, string> = {}
      for (const v of detectedVoices) {
        const isFallback = /^(male|female|child)-\d+$/.test(v.selectedVoice)
        if (!isFallback) {
          voiceMapping[v.id] = v.selectedVoice
        }
      }

      // Use the (possibly user-edited) transcript segments if available
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

      await apiClient.startDubbing({
        job_id: video.jobId,
        target_language: targetLanguage,
        transcript: transcriptSegments,
        voice_mapping: voiceMapping,
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-transparent relative">
      {/* Top Bar */}
      <div className="flex items-center justify-between border-b border-border/50 bg-background/50 backdrop-blur-md px-4 py-3">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="font-semibold text-foreground">{video.title}</h2>
            <p className="text-sm text-muted-foreground">
              {video.duration} • {video.source === "upload" ? "Uploaded" : video.source}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={targetLanguage} onValueChange={setTargetLanguage}>
            <SelectTrigger className="w-[180px]">
              <Languages className="mr-2 h-4 w-4" />
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
          <Button variant="outline" size="icon">
            <Settings2 className="h-4 w-4" />
          </Button>
          <Button
            onClick={handleStartDubbing}
            disabled={isAnalyzing || isDubbing}
            className="gap-2"
            variant={dubbingComplete ? "outline" : "default"}
          >
            {isDubbing ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Dubbing... {Math.round(dubbingProgress)}%
              </>
            ) : dubbingComplete ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Dub Complete
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate Dub
              </>
            )}
          </Button>
          <Button variant="secondary" className="gap-2" disabled={!dubbingComplete || !dubbedVideoUrl}>
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Video Player Section */}
        <div className="flex flex-1 flex-col">
          <div className="relative flex-1 bg-black">
            <video
              ref={videoRef}
              src={video.url}
              className="h-full w-full object-contain"
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              poster={video.thumbnail}
            />

            {/* AI Analysis Overlay */}
            {isAnalyzing && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="flex flex-col items-center gap-4 text-white">
                  <div className="relative">
                    <Waveform className="h-16 w-16 animate-pulse text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-medium">Analyzing Audio</p>
                    <p className="text-sm text-gray-400">
                      {video.jobId
                        ? "Waiting for transcription to complete…"
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
              <div className="absolute inset-x-4 bottom-24 flex items-center gap-2 rounded-lg bg-destructive/90 p-3 text-sm text-white">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {analyzeError}
              </div>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4 bg-black/50 text-white hover:bg-black/70"
            >
              <Maximize2 className="h-5 w-5" />
            </Button>
          </div>

          {/* Video Controls */}
          <div className="border-t border-border/50 bg-card/50 backdrop-blur-md p-4">
            <div className="mb-4">
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
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon">
                  <SkipBack className="h-5 w-5" />
                </Button>
                <Button size="icon" onClick={handlePlayPause}>
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </Button>
                <Button variant="ghost" size="icon">
                  <SkipForward className="h-5 w-5" />
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" onClick={toggleMute}>
                  {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </Button>
                <div className="w-24">
                  <Slider value={[isMuted ? 0 : volume]} max={100} step={1} onValueChange={handleVolumeChange} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Panel */}
        <div className="w-96 border-l border-border/50 bg-card/50 backdrop-blur-md">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col">
            <TabsList className="mx-4 mt-4 grid grid-cols-4">
              <TabsTrigger value="voices" className="gap-1.5">
                <Mic2 className="h-4 w-4" />
                Voices
              </TabsTrigger>
              <TabsTrigger value="transcript" className="gap-1.5">
                <Waveform className="h-4 w-4" />
                Script
              </TabsTrigger>
              <TabsTrigger value="timeline" className="gap-1.5">
                <Settings2 className="h-4 w-4" />
                Timeline
              </TabsTrigger>
              <TabsTrigger value="result" className="gap-1.5 relative">
                <CheckCircle2 className="h-4 w-4" />
                Result
                {dubbingComplete && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-green-500" />}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="voices" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full p-4">
                <VoiceSelector
                  detectedVoices={detectedVoices}
                  targetLanguage={targetLanguage}
                  onVoiceChange={handleVoiceChange}
                  isAnalyzing={isAnalyzing}
                  availableVoices={availableVoices}
                />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="transcript" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full p-4">
                <TranscriptEditor
                  currentTime={currentTime}
                  targetLanguage={targetLanguage}
                  segments={transcript?.segments}
                  speakerGenders={speakerGenders ?? undefined}
                />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="timeline" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full p-4">
                <TimelineEditor detectedVoices={detectedVoices} currentTime={currentTime} duration={duration} />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="result" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full p-4">
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
                  <div className="flex h-full flex-col items-center justify-center text-center p-8">
                    <div className="rounded-full bg-muted p-4 mb-4">
                      <Sparkles className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <h3 className="font-semibold text-foreground">No Dubbed Video Yet</h3>
                    <p className="mt-2 text-sm text-muted-foreground max-w-xs">
                      Select your target language, configure voice settings, then click "Generate Dub" to create your
                      dubbed video.
                    </p>
                    <Button className="mt-6 gap-2" onClick={handleStartDubbing} disabled={isAnalyzing}>
                      <Sparkles className="h-4 w-4" />
                      Generate Dub Now
                    </Button>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
