"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ArrowLeft, Play, Pause, Volume2, VolumeX, SkipBack, SkipForward, Maximize2, Download, Settings2, AudioWaveform as Waveform, User, Baby, Mic2, Languages, Sparkles, RefreshCw, CheckCircle2 } from "lucide-react"
import type { VideoSource, DetectedVoice } from "@/components/dashboard"
import { VoiceSelector } from "@/components/voice-selector"
import { TranscriptEditor } from "@/components/transcript-editor"
import { TimelineEditor } from "@/components/timeline-editor"
import { DubbedVideoResult } from "@/components/dubbed-video-result"
import PipelineMonitor from "@/components/pipeline-monitor"
import { useJobStatus } from "@/hooks/use-job-status"
import { getStatusMessage } from "@/lib/api-client"
import { useToast } from "@/hooks/use-toast"

interface DubbingWorkspaceProps {
  video: VideoSource
  onClose: () => void
}

const LANGUAGES = [
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

export function DubbingWorkspace({ video, onClose }: DubbingWorkspaceProps) {
  const { toast } = useToast()
  const [targetLanguage, setTargetLanguage] = useState("es")
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(80)
  const [isMuted, setIsMuted] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(true)
  const [detectedVoices, setDetectedVoices] = useState<DetectedVoice[]>([])
  const [isDubbing, setIsDubbing] = useState(false)
  const [dubbingProgress, setDubbingProgress] = useState(0)
  const [activeTab, setActiveTab] = useState("pipeline")
  const [dubbingComplete, setDubbingComplete] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const { status: jobStatus, loading: jobLoading, error: jobError } = useJobStatus({
    jobId: video.id,
    pollInterval: 2000,
    onComplete: (finalStatus) => {
      toast({
        title: "Processing Complete",
        description: `Video processed successfully with ${finalStatus.chunks?.length || 0} chunks`,
      })
      setIsAnalyzing(false)
    },
    onError: (errorMessage) => {
      toast({
        title: "Processing Failed",
        description: errorMessage,
        variant: "destructive",
      })
      setIsAnalyzing(false)
    }
  })

  // Update analyzing state based on backend status
  useEffect(() => {
    if (jobStatus) {
      if (jobStatus.status === 'completed') {
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
      } else if (jobStatus.status === 'processing' || jobStatus.status === 'pending') {
        setIsAnalyzing(true)
      } else if (jobStatus.status === 'failed') {
        setIsAnalyzing(false)
      }
    }
  }, [jobStatus])

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
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime)
    }
  }

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration)
    }
  }

  const handleSeek = (value: number[]) => {
    if (videoRef.current) {
      videoRef.current.currentTime = value[0]
      setCurrentTime(value[0])
    }
  }

  const handleVolumeChange = (value: number[]) => {
    setVolume(value[0])
    if (videoRef.current) {
      videoRef.current.volume = value[0] / 100
    }
    if (value[0] === 0) {
      setIsMuted(true)
    } else {
      setIsMuted(false)
    }
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

  const handleStartDubbing = () => {
    setIsDubbing(true)
    setDubbingProgress(0)
    setDubbingComplete(false)
    setActiveTab("result")

    // Simulate dubbing progress
    let progress = 0
    const interval = setInterval(() => {
      progress += Math.random() * 5
      if (progress >= 100) {
        progress = 100
        clearInterval(interval)
        setIsDubbing(false)
        setDubbingComplete(true)
      }
      setDubbingProgress(progress)
    }, 500)
  }

  const handleRegenerate = () => {
    handleStartDubbing()
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col bg-transparent relative">
      {/* Backend Status Loading State */}
      {jobLoading && !jobStatus && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-foreground">Connecting to backend...</p>
          </div>
        </div>
      )}

      {/* Backend Status Error State */}
      {jobError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="text-center max-w-md p-8">
            <div className="text-destructive text-4xl mb-4">⚠</div>
            <h3 className="text-xl font-semibold text-foreground mb-2">Connection Error</h3>
            <p className="text-muted-foreground mb-6">{jobError}</p>
            <Button onClick={onClose}>Back to Dashboard</Button>
          </div>
        </div>
      )}

      {/* Backend Processing Status Overlay */}
      {jobStatus && (jobStatus.status === 'pending' || jobStatus.status === 'processing') && (
        <div className="absolute top-16 right-4 z-40 bg-card border border-border rounded-lg p-4 shadow-lg max-w-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
            <span className="font-medium text-foreground">{getStatusMessage(jobStatus.status)}</span>
          </div>
          <p className="text-sm text-muted-foreground mb-3">{jobStatus.current_step}</p>
          <div className="space-y-1">
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{ width: `${jobStatus.progress}%` }}
              />
            </div>
            <p className="text-xs text-right text-muted-foreground">{jobStatus.progress}%</p>
          </div>
          {jobStatus.chunks && jobStatus.chunks.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              {jobStatus.chunks.length} chunks processed
            </p>
          )}
        </div>
      )}

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
          <Button variant="secondary" className="gap-2" disabled={!dubbingComplete}>
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
                    <p className="text-lg font-medium">
                      {jobStatus ? getStatusMessage(jobStatus.status) : 'Analyzing Audio'}
                    </p>
                    <p className="text-sm text-gray-400">
                      {jobStatus?.current_step || 'Detecting voices and identifying speakers...'}
                    </p>
                  </div>
                  {jobStatus && (
                    <div className="w-64">
                      <div className="w-full bg-secondary rounded-full h-2 mb-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all duration-300"
                          style={{ width: `${jobStatus.progress}%` }}
                        />
                      </div>
                      <p className="text-xs text-center text-gray-400">{jobStatus.progress}% complete</p>
                    </div>
                  )}
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

            {/* Fullscreen button */}
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
            {/* Progress Bar */}
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

            {/* Control Buttons */}
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
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={toggleMute}>
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </Button>
                <Slider
                  value={[isMuted ? 0 : volume]}
                  max={100}
                  step={1}
                  onValueChange={handleVolumeChange}
                  className="w-24"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div className="w-96 border-l border-border/50 bg-card/50 backdrop-blur-md flex flex-col">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-5 rounded-none border-b border-border/50">
              <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
              <TabsTrigger value="voices">Voices</TabsTrigger>
              <TabsTrigger value="transcript">Script</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="result">Result</TabsTrigger>
            </TabsList>
            <ScrollArea className="flex-1">
              <TabsContent value="pipeline" className="m-0 p-4">
                <PipelineMonitor jobId={video.id} />
              </TabsContent>
              <TabsContent value="voices" className="m-0 p-4">
                <VoiceSelector
                  detectedVoices={detectedVoices}
                  targetLanguage={targetLanguage}
                  onVoiceChange={handleVoiceChange}
                  isAnalyzing={isAnalyzing}
                />
              </TabsContent>
              <TabsContent value="transcript" className="m-0 p-4">
                <TranscriptEditor
                  currentTime={currentTime}
                  targetLanguage={targetLanguage}
                />
              </TabsContent>
              <TabsContent value="timeline" className="m-0 p-4">
                <TimelineEditor
                  detectedVoices={detectedVoices}
                  currentTime={currentTime}
                  duration={duration}
                />
              </TabsContent>
              <TabsContent value="result" className="m-0 p-4">
                <DubbedVideoResult
                  originalVideo={video}
                  targetLanguage={targetLanguage}
                  detectedVoices={detectedVoices}
                  dubbingProgress={dubbingProgress}
                  isDubbing={isDubbing}
                  onRegenerate={handleRegenerate}
                  onClose={onClose}
                />
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
