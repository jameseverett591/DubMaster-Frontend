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
  youtube: "/backgrounds/kungfu-action.jpg",
  library: "/backgrounds/marvel-theater.jpg",
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
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-foreground">DubVerse Studio</h1>
              <p className="mt-2 text-muted-foreground">
                AI-powered video dubbing with intelligent voice detection and multi-language support
              </p>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="mb-8 grid w-full grid-cols-5 lg:w-auto lg:inline-flex bg-background/50 backdrop-blur-md">
                <TabsTrigger value="upload" className="gap-2">
                  <Upload className="h-4 w-4" />
                  <span className="hidden sm:inline">Upload</span>
                </TabsTrigger>
                <TabsTrigger value="youtube" className="gap-2">
                  <Youtube className="h-4 w-4" />
                  <span className="hidden sm:inline">YouTube</span>
                </TabsTrigger>
                <TabsTrigger value="library" className="gap-2">
                  <Film className="h-4 w-4" />
                  <span className="hidden sm:inline">Library</span>
                </TabsTrigger>
                <TabsTrigger value="collaborate" className="gap-2">
                  <Users className="h-4 w-4" />
                  <span className="hidden sm:inline">Collaborate</span>
                </TabsTrigger>
                <TabsTrigger value="projects" className="gap-2">
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
