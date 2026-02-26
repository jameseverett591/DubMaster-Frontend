"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VideoUpload } from "@/components/video-upload"
import { YouTubeIntegration } from "@/components/youtube-integration"
import { PublicDomainLibrary } from "@/components/public-domain-library"
import { CreatorCollaboration } from "@/components/creator-collaboration"
import { DubbingWorkspace } from "@/components/dubbing-workspace"
import { Header } from "@/components/header"
import { Upload, Youtube, Film, Users, Mic2 } from "lucide-react"
import { RecentProjects } from "@/components/recent-projects"

export type VideoSource = {
  id: string
  title: string
  url: string
  thumbnail: string
  duration: string
  source: "upload" | "youtube" | "public-domain"
  jobId?: string
}

export type DetectedVoice = {
  id: string
  type: "male" | "female" | "child"
  characterName: string
  timeRanges: { start: number; end: number }[]
  selectedVoice: string
}

// Background images for each tab
const tabBackgrounds: Record<string, string> = {
  upload: "/backgrounds/marvel-stormy.jpg",
  youtube: "/backgrounds/ipman-kungfu.jpg",
  library: "/backgrounds/streaming-library.jpg",
  collaborate: "/backgrounds/anime-motion-teal.jpg",
  projects: "/backgrounds/anime-dark-collage.jpg",
}

export function Dashboard() {
  const [activeTab, setActiveTab] = useState("upload")
  const [selectedVideo, setSelectedVideo] = useState<VideoSource | null>(null)
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false)

  const handleVideoSelect = (video: VideoSource) => {
    setSelectedVideo(video)
    setIsWorkspaceOpen(true)
  }

  const handleCloseWorkspace = () => {
    setIsWorkspaceOpen(false)
    setSelectedVideo(null)
  }

  const currentBackground = tabBackgrounds[activeTab] || tabBackgrounds.upload

  return (
    <div className="min-h-screen bg-background relative">
      {/* Background Image - Full Coverage, Changes per Tab */}
      <div 
        className="fixed inset-0 z-0 opacity-60 transition-all duration-700"
        style={{
          backgroundImage: `url('${currentBackground}')`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundAttachment: "fixed"
        }}
      />
      <div className="fixed inset-0 z-0 bg-background/30" />
      
      <div className="relative z-10">
        <Header activeTab={activeTab} onNavigate={setActiveTab} />

        {isWorkspaceOpen && selectedVideo ? (
          <DubbingWorkspace video={selectedVideo} onClose={handleCloseWorkspace} />
        ) : (
          <main className="container mx-auto px-4 py-8">
            <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-foreground">DubVerse Studio</h1>
                <p className="mt-2 text-muted-foreground">
                  AI-powered video dubbing with intelligent voice detection and multi-language support
                </p>
              </div>
              <h2 
                className="text-xl font-bold italic text-right leading-tight"
                style={{ 
                  background: "linear-gradient(180deg, #fce38a 0%, #d4a843 25%, #f9e77f 45%, #c5952a 60%, #f0d060 75%, #a67c2e 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                  filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.8))",
                }}
              >
                Watch Award Winning Movies<br />In Your Own Language
              </h2>
            </div>

            <Tabs value={activeTab} onValueChange={(value) => {
              console.log("[v0] Tab changed to:", value)
              setActiveTab(value)
            }} className="w-full">
              <TabsList className="mb-8 grid w-full grid-cols-5 lg:w-auto lg:inline-flex bg-background/50 backdrop-blur-md pointer-events-auto">
                <TabsTrigger value="upload" className="gap-2 cursor-pointer" onClick={() => console.log("[v0] Upload clicked")}>
                  <Upload className="h-4 w-4" />
                  <span className="hidden sm:inline">Upload</span>
                </TabsTrigger>
                <TabsTrigger value="youtube" className="gap-2 cursor-pointer" onClick={() => console.log("[v0] YouTube clicked")}>
                  <Youtube className="h-4 w-4" />
                  <span className="hidden sm:inline">YouTube</span>
                </TabsTrigger>
                <TabsTrigger value="library" className="gap-2 cursor-pointer" onClick={() => console.log("[v0] Library clicked")}>
                  <Film className="h-4 w-4" />
                  <span className="hidden sm:inline">Library</span>
                </TabsTrigger>
                <TabsTrigger value="collaborate" className="gap-2 cursor-pointer" onClick={() => console.log("[v0] Collaborate clicked")}>
                  <Users className="h-4 w-4" />
                  <span className="hidden sm:inline">Collaborate</span>
                </TabsTrigger>
                <TabsTrigger value="projects" className="gap-2 cursor-pointer" onClick={() => console.log("[v0] Projects clicked")}>
                  <Mic2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Projects</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upload">
                <VideoUpload onVideoSelect={handleVideoSelect} />
              </TabsContent>
              <TabsContent value="youtube">
                <YouTubeIntegration onVideoSelect={handleVideoSelect} />
              </TabsContent>
              <TabsContent value="library">
                <PublicDomainLibrary onVideoSelect={handleVideoSelect} />
              </TabsContent>
              <TabsContent value="collaborate">
                <CreatorCollaboration />
              </TabsContent>
              <TabsContent value="projects">
                <RecentProjects onVideoSelect={handleVideoSelect} />
              </TabsContent>
            </Tabs>
          </main>
        )}
      </div>
    </div>
  )
}
