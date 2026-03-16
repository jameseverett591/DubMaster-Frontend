"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  AudioWaveform,
  Subtitles,
  Stamp,
  Waves,
  RotateCcw,
  Mic2,
  Languages,
  SmilePlus,
  Pause,
  Sparkles,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  Download,
  ChevronDown,
  Check,
  Trash2,
  ZoomIn,
  ZoomOut,
  ArrowLeft,
  Upload,
  User,
  Settings,
  LogOut,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

interface TranscriptSegment {
  id: string
  speaker: string
  speakerColor: string
  startTime: number
  endTime: number
  originalText: string
  translatedText: string
  isEditing: boolean
  voiceGenerated: boolean
}

interface AdvancedDubbingEditorProps {
  videoTitle?: string
  videoUrl?: string
  originalLanguage?: string
  targetLanguage?: string
  onBack?: () => void
  onExport?: () => void
}

const SPEAKER_COLORS: Record<string, string> = {
  "Speaker 1": "bg-emerald-600",
  "Speaker 2": "bg-violet-600",
  "Speaker 3": "bg-amber-600",
  "Speaker 4": "bg-rose-600",
  "Speaker 5": "bg-cyan-600",
}

const SAMPLE_TRANSCRIPT: TranscriptSegment[] = [
  {
    id: "1",
    speaker: "Speaker 1",
    speakerColor: "bg-emerald-600",
    startTime: 0.5,
    endTime: 2.3,
    originalText: "咏春，叶问。",
    translatedText: "Wing Chun, Ip Man.",
    isEditing: false,
    voiceGenerated: true,
  },
  {
    id: "2",
    speaker: "Speaker 2",
    speakerColor: "bg-violet-600",
    startTime: 2.5,
    endTime: 4.8,
    originalText: "我真想看看。",
    translatedText: "I really want to see it.",
    isEditing: false,
    voiceGenerated: true,
  },
  {
    id: "3",
    speaker: "Speaker 2",
    speakerColor: "bg-violet-600",
    startTime: 5.0,
    endTime: 8.2,
    originalText: "你一个大男人是怎么打出一套女人拳的?",
    translatedText: "How does a grown man like you fight like a woman?",
    isEditing: false,
    voiceGenerated: false,
  },
  {
    id: "4",
    speaker: "Speaker 1",
    speakerColor: "bg-emerald-600",
    startTime: 8.5,
    endTime: 12.0,
    originalText: "好嘅功夫系唔会分男女老幼，睇人嘅啫。",
    translatedText: "Good martial arts don't distinguish between gender or age; it's all about the person.",
    isEditing: false,
    voiceGenerated: true,
  },
  {
    id: "5",
    speaker: "Speaker 1",
    speakerColor: "bg-emerald-600",
    startTime: 12.2,
    endTime: 15.0,
    originalText: "至于打成点，你一阵咪会知啫。",
    translatedText: "As for how it turns out, you'll find out soon enough.",
    isEditing: false,
    voiceGenerated: true,
  },
  {
    id: "6",
    speaker: "Speaker 2",
    speakerColor: "bg-violet-600",
    startTime: 15.2,
    endTime: 16.5,
    originalText: "请。",
    translatedText: "Please.",
    isEditing: false,
    voiceGenerated: true,
  },
  {
    id: "7",
    speaker: "Speaker 3",
    speakerColor: "bg-amber-600",
    startTime: 16.8,
    endTime: 17.8,
    originalText: "哼。",
    translatedText: "Hmm.",
    isEditing: false,
    voiceGenerated: true,
  },
  {
    id: "8",
    speaker: "Speaker 3",
    speakerColor: "bg-amber-600",
    startTime: 18.0,
    endTime: 19.5,
    originalText: "啊啊啊！",
    translatedText: "Ahh!",
    isEditing: false,
    voiceGenerated: true,
  },
]

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms}`
}

export function AdvancedDubbingEditor({
  videoTitle = "Ip Man (2010) - Ip Man vs. Master Shin Scene",
  videoUrl = "/backgrounds/ipman-kungfu.jpg",
  originalLanguage = "Cantonese (China)",
  targetLanguage = "English",
  onBack,
  onExport,
}: AdvancedDubbingEditorProps) {
  const [segments, setSegments] = useState<TranscriptSegment[]>(SAMPLE_TRANSCRIPT)
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>("3")
  const [activeMode, setActiveMode] = useState<"speech" | "subtitles" | "brand" | "lipsync">("speech")
  const [viewMode, setViewMode] = useState<"original" | "translated">("translated")
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(10.1)
  const [duration] = useState(262.4)
  const [volume, setVolume] = useState(80)
  const [zoom, setZoom] = useState(100)
  const [speakerFilter, setSpeakerFilter] = useState<string>("all")
  const [pendingGeneration, setPendingGeneration] = useState(1)

  const [playerWidth, setPlayerWidth] = useState(400)
  const isResizing = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    isResizing.current = true
    resizeStartX.current = e.clientX
    resizeStartWidth.current = playerWidth
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return
      const delta = resizeStartX.current - e.clientX
      const newWidth = Math.min(700, Math.max(240, resizeStartWidth.current + delta))
      setPlayerWidth(newWidth)
    }
    const onMouseUp = () => {
      if (!isResizing.current) return
      isResizing.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [])

  const router = useRouter()
  const supabase = createClient()
  const timelineRef = useRef<HTMLDivElement>(null)

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/signin")
    router.refresh()
  }

  const handleSegmentClick = (id: string) => {
    setSelectedSegmentId(id)
    // Seek to the segment's start time
    const segment = segments.find((seg) => seg.id === id)
    if (segment) {
      setCurrentTime(segment.startTime)
    }
  }

  const handleTranslationChange = (id: string, newText: string) => {
    setSegments((prev) =>
      prev.map((seg) => (seg.id === id ? { ...seg, translatedText: newText } : seg))
    )
  }

  const handleGenerateSpeech = (id?: string) => {
    if (id) {
      setSegments((prev) =>
        prev.map((seg) => (seg.id === id ? { ...seg, voiceGenerated: true } : seg))
      )
      setPendingGeneration((prev) => Math.max(0, prev - 1))
    } else {
      // Generate all
      setSegments((prev) => prev.map((seg) => ({ ...seg, voiceGenerated: true })))
      setPendingGeneration(0)
    }
  }

  const handleRevertToOriginal = (id: string) => {
    const original = SAMPLE_TRANSCRIPT.find((seg) => seg.id === id)
    if (original) {
      setSegments((prev) =>
        prev.map((seg) => (seg.id === id ? { ...seg, translatedText: original.translatedText } : seg))
      )
    }
  }

  const handleDeleteSegment = (id: string) => {
    setSegments((prev) => prev.filter((seg) => seg.id !== id))
  }

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying)
  }

  const handleSeek = (time: number) => {
    setCurrentTime(time)
  }

  // Simulate playback
  useEffect(() => {
    if (isPlaying) {
      const interval = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= duration) {
            setIsPlaying(false)
            return 0
          }
          return prev + 0.1
        })
      }, 100)
      return () => clearInterval(interval)
    }
  }, [isPlaying, duration])

  const filteredSegments = speakerFilter === "all" 
    ? segments 
    : segments.filter((seg) => seg.speaker === speakerFilter)

  const uniqueSpeakers = [...new Set(segments.map((seg) => seg.speaker))]

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-border/50 bg-background/80 backdrop-blur-md px-4 py-2">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} className="bg-transparent">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="font-medium text-foreground truncate max-w-md">{videoTitle}</span>
          <Button variant="outline" size="sm" className="bg-transparent gap-2">
            <Languages className="h-4 w-4" />
            Translate & Dub
          </Button>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm text-muted-foreground">
            <span 
              className="font-bold"
              style={{ 
                background: "linear-gradient(180deg, #fce38a 0%, #d4a843 25%, #f9e77f 45%, #c5952a 60%, #f0d060 75%, #a67c2e 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              6.88 Points Left
            </span>
            <span className="ml-2 text-xs">2:29 min available</span>
          </div>
          <Button variant="ghost" size="icon" className="bg-transparent">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="bg-transparent">
            <Upload className="h-4 w-4" />
          </Button>
          <Button 
            onClick={onExport}
            className="gap-2"
            style={{ 
              background: "linear-gradient(180deg, #fce38a 0%, #d4a843 50%, #a67c2e 100%)",
              color: "#000",
            }}
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="bg-transparent text-muted-foreground hover:text-foreground">
                <User className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/account")} className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/account")} className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-red-400 focus:text-red-300 focus:bg-red-500/10">
                <LogOut className="mr-2 h-4 w-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Mode Selection */}
        <div className="w-16 border-r border-border/50 bg-card/30 flex flex-col items-center py-4 gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeMode === "speech" ? "secondary" : "ghost"}
                  size="icon"
                  className={`w-12 h-12 flex flex-col gap-1 ${activeMode === "speech" ? "bg-primary/20" : "bg-transparent"}`}
                  onClick={() => setActiveMode("speech")}
                >
                  <AudioWaveform className="h-5 w-5" />
                  <span className="text-[10px]">Speech</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Speech Editor</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeMode === "subtitles" ? "secondary" : "ghost"}
                  size="icon"
                  className={`w-12 h-12 flex flex-col gap-1 ${activeMode === "subtitles" ? "bg-primary/20" : "bg-transparent"}`}
                  onClick={() => setActiveMode("subtitles")}
                >
                  <Subtitles className="h-5 w-5" />
                  <span className="text-[10px]">Subtitles</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Subtitle Editor</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeMode === "brand" ? "secondary" : "ghost"}
                  size="icon"
                  className={`w-12 h-12 flex flex-col gap-1 ${activeMode === "brand" ? "bg-primary/20" : "bg-transparent"}`}
                  onClick={() => setActiveMode("brand")}
                >
                  <Stamp className="h-5 w-5" />
                  <span className="text-[10px]">Brand</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Brand Settings</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeMode === "lipsync" ? "secondary" : "ghost"}
                  size="icon"
                  className={`w-12 h-12 flex flex-col gap-1 ${activeMode === "lipsync" ? "bg-primary/20" : "bg-transparent"}`}
                  onClick={() => setActiveMode("lipsync")}
                >
                  <Waves className="h-5 w-5" />
                  <span className="text-[10px]">Lip Sync</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Lip Sync Settings</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Generation Status Bar */}
          {pendingGeneration > 0 && (
            <div className="flex items-center justify-between px-4 py-2 bg-primary/10 border-b border-border/50">
              <div className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>Dubbing for {pendingGeneration} translated segment needs to be generated.</span>
              </div>
              <Button size="sm" onClick={() => handleGenerateSpeech()} className="gap-2">
                <Sparkles className="h-4 w-4" />
                Generate Speech
              </Button>
            </div>
          )}

          {/* Transcript and Video Split View */}
          <div className="flex-1 flex overflow-hidden">
            {/* Transcript Panel */}
            <div className="flex-1 flex flex-col border-r border-border/50">
              {/* Language Headers */}
              <div className="flex items-center border-b border-border/50 px-4 py-3 bg-card/30">
                <div className="flex items-center gap-2 flex-1">
                  <Select value={speakerFilter} onValueChange={setSpeakerFilter}>
                    <SelectTrigger className="w-20 h-8 bg-transparent">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {uniqueSpeakers.map((speaker) => (
                        <SelectItem key={speaker} value={speaker}>{speaker}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="font-medium text-foreground">{originalLanguage}</span>
                </div>
                <div className="flex items-center gap-2 flex-1">
                  <span className="font-medium text-foreground">{targetLanguage}</span>
                </div>
              </div>

              {/* Transcript Rows */}
              <ScrollArea className="flex-1">
                <div className="divide-y divide-border/30">
                  {filteredSegments.map((segment) => (
                    <div
                      key={segment.id}
                      className={`flex items-start gap-4 px-4 py-3 cursor-pointer transition-colors ${
                        selectedSegmentId === segment.id
                          ? "bg-primary/10"
                          : "hover:bg-card/50"
                      }`}
                      onClick={() => handleSegmentClick(segment.id)}
                    >
                      {/* Speaker Badge */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`${segment.speakerColor} text-white text-xs px-2 py-1 h-7 gap-1`}
                          >
                            {segment.speaker}
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {Object.keys(SPEAKER_COLORS).map((speaker) => (
                            <DropdownMenuItem key={speaker}>
                              <div className={`w-3 h-3 rounded-full ${SPEAKER_COLORS[speaker]} mr-2`} />
                              {speaker}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>

                      {/* Original Text */}
                      <div className="flex-1 text-sm text-muted-foreground">
                        {segment.originalText}
                      </div>

                      {/* Translated Text */}
                      <div className="flex-1">
                        {selectedSegmentId === segment.id ? (
                          <div className="relative">
                            <Input
                              value={segment.translatedText}
                              onChange={(e) => handleTranslationChange(segment.id, e.target.value)}
                              className="pr-16 bg-primary/20 border-primary text-foreground"
                            />
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="h-6 w-6 bg-transparent text-primary">
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-6 w-6 bg-transparent">
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-6 w-6 bg-transparent">
                                <Play className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <span className={`text-sm ${segment.voiceGenerated ? "text-foreground" : "text-amber-400"}`}>
                            {segment.translatedText}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Toolbar */}
              {selectedSegmentId && (
                <div className="flex items-center gap-1 px-4 py-2 border-t border-border/50 bg-card/30 flex-wrap">
                  <Button variant="ghost" size="sm" className="gap-1 text-xs bg-transparent" onClick={() => handleRevertToOriginal(selectedSegmentId)}>
                    <RotateCcw className="h-3 w-3" />
                    Revert to Original
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-1 text-xs bg-transparent">
                    <Mic2 className="h-3 w-3" />
                    Change Voice
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-1 text-xs bg-transparent">
                    <Languages className="h-3 w-3" />
                    Pronunciation
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-1 text-xs bg-transparent">
                    <SmilePlus className="h-3 w-3" />
                    Emotion
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-1 text-xs bg-transparent">
                    <Pause className="h-3 w-3" />
                    Pause
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-1 text-xs bg-transparent">
                    <Sparkles className="h-3 w-3" />
                    Ask AI
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="gap-1 text-xs bg-transparent text-primary"
                    onClick={() => handleGenerateSpeech(selectedSegmentId)}
                  >
                    <Sparkles className="h-3 w-3" />
                    Generate Speech
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 bg-transparent ml-auto" onClick={() => handleDeleteSegment(selectedSegmentId)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              )}
            </div>

            {/* Resize Handle */}
            <div
              className="w-1 cursor-col-resize flex-shrink-0 group relative hover:bg-primary/50 active:bg-primary transition-colors"
              onMouseDown={handleResizeMouseDown}
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <div className="w-0.5 h-4 bg-primary rounded-full" />
                <div className="w-0.5 h-4 bg-primary rounded-full" />
              </div>
            </div>

            {/* Video Preview Panel */}
            <div className="flex flex-col bg-card/20 flex-shrink-0" style={{ width: playerWidth }}>
              {/* View Mode Tabs */}
              <div className="flex items-center justify-center border-b border-border/50 py-2">
                <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "original" | "translated")}>
                  <TabsList className="bg-background/50">
                    <TabsTrigger value="original">Original</TabsTrigger>
                    <TabsTrigger value="translated">Translated</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {/* Video Player */}
              <div className="flex-1 flex flex-col items-center justify-center p-4">
                <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
                  <img
                    src={videoUrl}
                    alt="Video frame"
                    className="w-full h-full object-cover"
                  />
                  {/* Subtitle Overlay */}
                  <div className="absolute bottom-4 left-0 right-0 text-center">
                    <span className="bg-black/70 px-3 py-1 text-sm text-white rounded">
                      {segments.find((s) => currentTime >= s.startTime && currentTime <= s.endTime)?.translatedText || ""}
                    </span>
                  </div>
                  {/* Translated By Badge */}
                  <div className="absolute top-2 right-2 text-xs text-white/70">
                    Video Translated by DubVerse
                  </div>
                </div>

                {/* Video Attribution */}
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-6 h-6 bg-red-600 rounded flex items-center justify-center text-white text-xs font-bold">
                    ▶
                  </div>
                  <span>MOVIECLIPS</span>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="border-t border-border/50 bg-card/30">
            {/* Playback Controls */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/30">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8 bg-transparent">
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 bg-transparent">
                  <Volume2 className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 bg-transparent">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
                  </svg>
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 bg-transparent">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-4">
                <span className="text-sm font-mono text-foreground">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
                <Button variant="ghost" size="icon" className="h-8 w-8 bg-transparent" onClick={() => handleSeek(Math.max(0, currentTime - 5))}>
                  <SkipBack className="h-4 w-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-10 w-10 bg-transparent"
                  onClick={handlePlayPause}
                >
                  {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 bg-transparent" onClick={() => handleSeek(Math.min(duration, currentTime + 5))}>
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8 bg-transparent">
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Slider
                  value={[zoom]}
                  onValueChange={([v]) => setZoom(v)}
                  min={50}
                  max={200}
                  step={10}
                  className="w-24"
                />
                <Button variant="ghost" size="icon" className="h-8 w-8 bg-transparent">
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Timeline Tracks */}
            <div ref={timelineRef} className="relative h-32 overflow-x-auto">
              {/* Time Markers */}
              <div className="absolute top-0 left-0 right-0 h-6 flex items-end text-xs text-muted-foreground border-b border-border/30">
                {Array.from({ length: Math.ceil(duration / 2) }, (_, i) => (
                  <div
                    key={i}
                    className="absolute bottom-0 flex flex-col items-center"
                    style={{ left: `${(i * 2 / duration) * 100}%` }}
                  >
                    <span className="mb-1">{formatTime(i * 2).slice(0, 5)}</span>
                    <div className="w-px h-2 bg-border" />
                  </div>
                ))}
              </div>

              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-primary z-10"
                style={{ left: `${(currentTime / duration) * 100}%` }}
              >
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-primary rotate-45" />
              </div>

              {/* Translated Track */}
              <div className="absolute top-8 left-0 right-0 h-10 flex items-center">
                <span className="absolute -left-1 top-1/2 -translate-y-1/2 text-[10px] text-emerald-400 w-12 pl-1">EN</span>
                <div className="ml-12 relative h-6 w-full">
                  {segments.map((segment) => (
                    <div
                      key={`en-${segment.id}`}
                      className={`absolute h-full rounded text-[10px] text-white flex items-center px-1 truncate cursor-pointer ${
                        selectedSegmentId === segment.id ? "ring-2 ring-primary" : ""
                      } ${segment.speakerColor}`}
                      style={{
                        left: `${(segment.startTime / duration) * 100}%`,
                        width: `${((segment.endTime - segment.startTime) / duration) * 100}%`,
                      }}
                      onClick={() => handleSegmentClick(segment.id)}
                    >
                      {segment.translatedText}
                    </div>
                  ))}
                </div>
              </div>

              {/* Original Track */}
              <div className="absolute top-20 left-0 right-0 h-10 flex items-center">
                <span className="absolute -left-1 top-1/2 -translate-y-1/2 text-[10px] text-amber-400 w-12 pl-1">YUE</span>
                <div className="ml-12 relative h-6 w-full">
                  {segments.map((segment) => (
                    <div
                      key={`yue-${segment.id}`}
                      className={`absolute h-full rounded bg-amber-700/60 text-[10px] text-white flex items-center px-1 truncate cursor-pointer ${
                        selectedSegmentId === segment.id ? "ring-2 ring-primary" : ""
                      }`}
                      style={{
                        left: `${(segment.startTime / duration) * 100}%`,
                        width: `${((segment.endTime - segment.startTime) / duration) * 100}%`,
                      }}
                      onClick={() => handleSegmentClick(segment.id)}
                    >
                      {segment.originalText}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
