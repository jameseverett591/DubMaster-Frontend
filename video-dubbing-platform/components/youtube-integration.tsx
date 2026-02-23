"use client"

import React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { 
  Youtube, 
  Search, 
  Clock, 
  Eye, 
  Languages, 
  AlertCircle, 
  Upload, 
  FileText, 
  Download, 
  Link2, 
  CheckCircle2,
  Info,
  Play,
  Edit3
} from "lucide-react"
import type { VideoSource } from "@/components/dashboard"

interface YouTubeIntegrationProps {
  onVideoSelect: (video: VideoSource) => void
}

type YouTubeVideo = {
  id: string
  title: string
  channel: string
  thumbnail: string
  duration: string
  views: string
  hasCaptions: boolean
  captionLanguages: string[]
}

type TranscriptLine = {
  id: string
  start: number
  end: number
  text: string
  speaker?: string
}

const SAMPLE_VIDEOS: YouTubeVideo[] = [
  {
    id: "yt-1",
    title: "Complete JavaScript Course 2024",
    channel: "Code Academy",
    thumbnail: "/javascript-programming-course-thumbnail.jpg",
    duration: "1:45:30",
    views: "2.5M",
    hasCaptions: true,
    captionLanguages: ["English", "Spanish", "French"],
  },
  {
    id: "yt-2",
    title: "Learn React in 30 Minutes",
    channel: "Tech Tutorials",
    thumbnail: "/react-tutorial-video-thumbnail.jpg",
    duration: "32:15",
    views: "890K",
    hasCaptions: true,
    captionLanguages: ["English", "German"],
  },
  {
    id: "yt-3",
    title: "AI and Machine Learning Explained",
    channel: "Science Channel",
    thumbnail: "/artificial-intelligence-explainer-video.jpg",
    duration: "58:42",
    views: "1.2M",
    hasCaptions: true,
    captionLanguages: ["English", "Japanese", "Korean", "Chinese"],
  },
]

const SAMPLE_TRANSCRIPT: TranscriptLine[] = [
  { id: "1", start: 0, end: 4.5, text: "Welcome to this comprehensive JavaScript course.", speaker: "Instructor" },
  { id: "2", start: 4.5, end: 9.2, text: "In this video, we'll cover everything you need to know.", speaker: "Instructor" },
  { id: "3", start: 9.2, end: 14.8, text: "Let's start with the basics of variables and data types.", speaker: "Instructor" },
  { id: "4", start: 14.8, end: 20.1, text: "JavaScript has three ways to declare variables: var, let, and const.", speaker: "Instructor" },
  { id: "5", start: 20.1, end: 26.5, text: "The let keyword was introduced in ES6 and is now the preferred way.", speaker: "Instructor" },
  { id: "6", start: 26.5, end: 32.0, text: "Constants, declared with const, cannot be reassigned after initialization.", speaker: "Instructor" },
  { id: "7", start: 32.0, end: 38.2, text: "Now let's look at some practical examples in our code editor.", speaker: "Instructor" },
  { id: "8", start: 38.2, end: 44.5, text: "Here I'm creating a variable called userName and assigning it a string value.", speaker: "Instructor" },
]

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

export function YouTubeIntegration({ onVideoSelect }: YouTubeIntegrationProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<YouTubeVideo[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [activeMode, setActiveMode] = useState("captions")
  
  // Transcript extraction state
  const [extractedTranscript, setExtractedTranscript] = useState<TranscriptLine[] | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractProgress, setExtractProgress] = useState(0)
  const [selectedVideo, setSelectedVideo] = useState<YouTubeVideo | null>(null)
  
  // Own video upload state
  const [ownVideoFile, setOwnVideoFile] = useState<File | null>(null)
  const [captionSource, setCaptionSource] = useState<"youtube" | "upload" | null>(null)

  const handleSearch = () => {
    if (!searchQuery.trim()) return
    setIsSearching(true)
    setTimeout(() => {
      setSearchResults(SAMPLE_VIDEOS)
      setIsSearching(false)
    }, 1000)
  }

  const handleVideoSelect = (video: YouTubeVideo) => {
    onVideoSelect({
      id: video.id,
      title: video.title,
      url: `https://www.youtube.com/watch?v=${video.id}`,
      thumbnail: video.thumbnail,
      duration: video.duration,
      source: "youtube",
    })
  }

  const handleUrlSubmit = () => {
    if (!youtubeUrl.trim()) return
    const videoId = youtubeUrl.split("v=")[1]?.split("&")[0] || "demo"
    onVideoSelect({
      id: videoId,
      title: "YouTube Video",
      url: youtubeUrl,
      thumbnail: "/youtube-thumbnail.png",
      duration: "Unknown",
      source: "youtube",
    })
  }

  const handleExtractTranscript = (video: YouTubeVideo) => {
    setSelectedVideo(video)
    setIsExtracting(true)
    setExtractProgress(0)
    
    // Simulate transcript extraction with progress
    const interval = setInterval(() => {
      setExtractProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval)
          setIsExtracting(false)
          setExtractedTranscript(SAMPLE_TRANSCRIPT)
          return 100
        }
        return prev + 10
      })
    }, 200)
  }

  const handleDownloadTranscript = (format: "srt" | "vtt" | "txt" | "json") => {
    if (!extractedTranscript) return
    
    let content = ""
    let filename = `transcript.${format}`
    
    if (format === "srt") {
      content = extractedTranscript.map((line, i) => {
        const startTime = formatSrtTime(line.start)
        const endTime = formatSrtTime(line.end)
        return `${i + 1}\n${startTime} --> ${endTime}\n${line.text}\n`
      }).join("\n")
    } else if (format === "vtt") {
      content = "WEBVTT\n\n" + extractedTranscript.map((line) => {
        const startTime = formatVttTime(line.start)
        const endTime = formatVttTime(line.end)
        return `${startTime} --> ${endTime}\n${line.text}\n`
      }).join("\n")
    } else if (format === "txt") {
      content = extractedTranscript.map(line => line.text).join("\n")
    } else if (format === "json") {
      content = JSON.stringify(extractedTranscript, null, 2)
    }
    
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const formatSrtTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 1000)
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`
  }

  const formatVttTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 1000)
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`
  }

  const handleOwnVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setOwnVideoFile(file)
    }
  }

  const handleStartDubbingWithOwnVideo = () => {
    if (!ownVideoFile || !extractedTranscript) return
    
    onVideoSelect({
      id: `own-${Date.now()}`,
      title: ownVideoFile.name,
      url: URL.createObjectURL(ownVideoFile),
      thumbnail: "/youtube-thumbnail.png",
      duration: "Unknown",
      source: "upload",
    })
  }

  return (
    <div className="space-y-8">
      {/* Important Notice */}
      <Card className="backdrop-blur-md bg-blue-500/10 border-blue-500/30">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
            <div className="space-y-2">
              <p className="font-medium text-blue-400">About YouTube Integration</p>
              <p className="text-sm text-blue-300/80">
                Due to YouTube's Terms of Service, we cannot directly download video files from YouTube. However, we CAN legally:
              </p>
              <ul className="text-sm text-blue-300/80 list-disc list-inside space-y-1 ml-2">
                <li>Extract captions and transcripts with full timestamps for translation</li>
                <li>Embed YouTube videos for playback reference while dubbing</li>
                <li>Help you dub videos you already own or have downloaded yourself</li>
              </ul>
              <p className="text-sm text-blue-300/80 mt-2">
                <strong>Tip:</strong> If you own a YouTube video or have legal download rights, upload your video file in the Upload tab, 
                then use this section to extract the captions for perfect synchronization.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Tabs */}
      <Tabs value={activeMode} onValueChange={setActiveMode} className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-background/50 backdrop-blur-md">
          <TabsTrigger value="captions" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Extract Captions
          </TabsTrigger>
          <TabsTrigger value="own-video" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Your Own Video
          </TabsTrigger>
          <TabsTrigger value="browse" className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            Browse Videos
          </TabsTrigger>
        </TabsList>

        {/* Extract Captions Tab */}
        <TabsContent value="captions" className="space-y-6 mt-6">
          <Card className="backdrop-blur-md bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Youtube className="h-5 w-5 text-red-500" />
                Extract YouTube Transcripts
              </CardTitle>
              <CardDescription>
                Paste a YouTube URL to extract captions with timestamps for dubbing
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <Input
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={() => {
                  if (youtubeUrl) {
                    handleExtractTranscript(SAMPLE_VIDEOS[0])
                  }
                }}>
                  <FileText className="mr-2 h-4 w-4" />
                  Extract Captions
                </Button>
              </div>
              
              {isExtracting && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Extracting transcript...</span>
                    <span className="text-primary">{extractProgress}%</span>
                  </div>
                  <Progress value={extractProgress} className="h-2" />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Extracted Transcript Display */}
          {extractedTranscript && (
            <Card className="backdrop-blur-md bg-card/50 border-border/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      Transcript Extracted
                    </CardTitle>
                    <CardDescription>
                      {extractedTranscript.length} segments with timestamps
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleDownloadTranscript("srt")}>
                      <Download className="mr-2 h-4 w-4" />
                      SRT
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleDownloadTranscript("vtt")}>
                      <Download className="mr-2 h-4 w-4" />
                      VTT
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleDownloadTranscript("json")}>
                      <Download className="mr-2 h-4 w-4" />
                      JSON
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px] rounded-lg border border-border/50 bg-background/30">
                  <div className="p-4 space-y-3">
                    {extractedTranscript.map((line) => (
                      <div 
                        key={line.id} 
                        className="flex gap-4 p-3 rounded-lg hover:bg-muted/30 transition-colors group"
                      >
                        <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground min-w-[80px]">
                          <span className="font-mono bg-muted/50 px-2 py-1 rounded">
                            {formatTime(line.start)}
                          </span>
                          <span className="text-muted-foreground/50">to</span>
                          <span className="font-mono bg-muted/50 px-2 py-1 rounded">
                            {formatTime(line.end)}
                          </span>
                        </div>
                        <div className="flex-1">
                          {line.speaker && (
                            <span className="text-xs font-medium text-primary mb-1 block">
                              {line.speaker}
                            </span>
                          )}
                          <p className="text-foreground">{line.text}</p>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Edit3 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                
                <div className="mt-4 flex gap-3">
                  <Button className="flex-1" onClick={handleUrlSubmit}>
                    <Play className="mr-2 h-4 w-4" />
                    Start Dubbing with Embedded Video
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Your Own Video Tab */}
        <TabsContent value="own-video" className="space-y-6 mt-6">
          <Card className="backdrop-blur-md bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-primary" />
                Dub Your Own YouTube Video
              </CardTitle>
              <CardDescription>
                Upload a video you own and pair it with YouTube captions for perfect sync
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Step 1: Upload Video */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    1
                  </div>
                  <h4 className="font-medium">Upload Your Video File</h4>
                </div>
                <div className="ml-8">
                  <label 
                    className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border/50 bg-background/30 p-6 transition-colors hover:border-primary/50 hover:bg-muted/20"
                  >
                    <Upload className="h-10 w-10 text-muted-foreground mb-3" />
                    <span className="text-sm font-medium text-foreground">
                      {ownVideoFile ? ownVideoFile.name : "Click to upload your video"}
                    </span>
                    <span className="text-xs text-muted-foreground mt-1">
                      MP4, WebM, MOV up to 10GB
                    </span>
                    <input 
                      type="file" 
                      accept="video/*" 
                      className="hidden" 
                      onChange={handleOwnVideoUpload}
                    />
                  </label>
                  {ownVideoFile && (
                    <div className="mt-2 flex items-center gap-2 text-sm text-green-500">
                      <CheckCircle2 className="h-4 w-4" />
                      Video ready: {ownVideoFile.name}
                    </div>
                  )}
                </div>
              </div>

              {/* Step 2: Get Captions */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    2
                  </div>
                  <h4 className="font-medium">Get Captions from YouTube</h4>
                </div>
                <div className="ml-8 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Paste the YouTube URL of this video to extract its captions:
                  </p>
                  <div className="flex gap-3">
                    <Input
                      placeholder="https://www.youtube.com/watch?v=..."
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      className="flex-1"
                    />
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        if (youtubeUrl) {
                          setCaptionSource("youtube")
                          handleExtractTranscript(SAMPLE_VIDEOS[0])
                        }
                      }}
                    >
                      <Link2 className="mr-2 h-4 w-4" />
                      Extract
                    </Button>
                  </div>
                  
                  {extractedTranscript && captionSource === "youtube" && (
                    <div className="flex items-center gap-2 text-sm text-green-500">
                      <CheckCircle2 className="h-4 w-4" />
                      {extractedTranscript.length} caption segments extracted
                    </div>
                  )}
                </div>
              </div>

              {/* Step 3: Start Dubbing */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    ownVideoFile && extractedTranscript 
                      ? "bg-primary text-primary-foreground" 
                      : "bg-muted text-muted-foreground"
                  }`}>
                    3
                  </div>
                  <h4 className={`font-medium ${!ownVideoFile || !extractedTranscript ? "text-muted-foreground" : ""}`}>
                    Start Dubbing
                  </h4>
                </div>
                <div className="ml-8">
                  <Button 
                    className="w-full" 
                    disabled={!ownVideoFile || !extractedTranscript}
                    onClick={handleStartDubbingWithOwnVideo}
                  >
                    <Languages className="mr-2 h-4 w-4" />
                    Start Dubbing Your Video
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Browse Videos Tab */}
        <TabsContent value="browse" className="space-y-6 mt-6">
          {/* Search */}
          <Card className="backdrop-blur-md bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle>Search YouTube Videos</CardTitle>
              <CardDescription>Find videos with available captions for dubbing practice</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search for videos..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    className="pl-10"
                  />
                </div>
                <Button onClick={handleSearch} disabled={isSearching}>
                  {isSearching ? "Searching..." : "Search"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-foreground">Search Results</h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {searchResults.map((video) => (
                  <Card
                    key={video.id}
                    className="cursor-pointer overflow-hidden transition-all hover:border-primary/50 hover:shadow-lg backdrop-blur-md bg-card/50 border-border/50"
                    onClick={() => handleVideoSelect(video)}
                  >
                    <div className="relative aspect-video">
                      <img
                        src={video.thumbnail || "/placeholder.svg"}
                        alt={video.title}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/80 px-2 py-1 text-xs text-white">
                        <Clock className="h-3 w-3" />
                        {video.duration}
                      </div>
                      {video.hasCaptions && (
                        <div className="absolute left-2 top-2 rounded bg-green-500/90 px-2 py-1 text-xs font-medium text-white">
                          CC Available
                        </div>
                      )}
                    </div>
                    <CardContent className="p-4">
                      <h4 className="line-clamp-2 font-medium text-foreground">{video.title}</h4>
                      <p className="mt-1 text-sm text-muted-foreground">{video.channel}</p>
                      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          {video.views}
                        </span>
                        <span className="flex items-center gap-1">
                          <Languages className="h-3 w-3" />
                          {video.captionLanguages.length} languages
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {video.captionLanguages.slice(0, 3).map((lang) => (
                          <Badge key={lang} variant="secondary" className="text-xs">
                            {lang}
                          </Badge>
                        ))}
                        {video.captionLanguages.length > 3 && (
                          <Badge variant="secondary" className="text-xs">
                            +{video.captionLanguages.length - 3}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Popular for Practice */}
          <Card className="backdrop-blur-md bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle>Popular for Translation Practice</CardTitle>
              <CardDescription>Educational content with professional captions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {SAMPLE_VIDEOS.map((video) => (
                  <div
                    key={video.id}
                    className="group flex cursor-pointer gap-3 rounded-lg border border-border/50 p-3 transition-all hover:border-primary/50 hover:bg-muted/50 backdrop-blur-sm"
                    onClick={() => handleVideoSelect(video)}
                  >
                    <img
                      src={video.thumbnail || "/placeholder.svg"}
                      alt={video.title}
                      className="h-20 w-32 rounded-lg object-cover"
                    />
                    <div className="flex-1">
                      <h4 className="line-clamp-2 text-sm font-medium text-foreground group-hover:text-primary">
                        {video.title}
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground">{video.channel}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{video.duration}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
