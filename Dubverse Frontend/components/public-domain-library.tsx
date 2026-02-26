"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { 
  Globe2, 
  Play, 
  Download, 
  Trash2, 
  MoreVertical, 
  Search, 
  Filter, 
  FolderOpen,
  Clock,
  Languages,
  Calendar,
  Share2,
  Pencil,
  Copy,
  Grid3X3,
  List
} from "lucide-react"
import type { VideoSource } from "@/components/dashboard"

interface SavedVideo {
  id: string
  title: string
  thumbnail: string
  originalLanguage: string
  dubbedLanguage: string
  duration: string
  createdAt: string
  fileSize: string
  status: "completed" | "processing" | "failed"
}

interface PublicDomainLibraryProps {
  onVideoSelect: (video: VideoSource) => void
}

export function PublicDomainLibrary({ onVideoSelect }: PublicDomainLibraryProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [selectedVideo, setSelectedVideo] = useState<SavedVideo | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Sample saved videos - in production this would come from a database
  const [savedVideos] = useState<SavedVideo[]>([
    {
      id: "1",
      title: "Marketing Campaign Q4 2025",
      thumbnail: "/marketing-video-thumbnail.png",
      originalLanguage: "English",
      dubbedLanguage: "Spanish",
      duration: "5:32",
      createdAt: "2026-01-28",
      fileSize: "245 MB",
      status: "completed"
    },
    {
      id: "2", 
      title: "Product Tutorial - Getting Started",
      thumbnail: "/tutorial-video-thumbnail.png",
      originalLanguage: "English",
      dubbedLanguage: "French",
      duration: "12:45",
      createdAt: "2026-01-25",
      fileSize: "512 MB",
      status: "completed"
    },
    {
      id: "3",
      title: "Company Introduction Video",
      thumbnail: "/uploaded-video-thumbnail.png",
      originalLanguage: "English",
      dubbedLanguage: "German",
      duration: "3:18",
      createdAt: "2026-01-20",
      fileSize: "156 MB",
      status: "completed"
    },
    {
      id: "4",
      title: "Training Module 1 - Safety",
      thumbnail: "/javascript-programming-course-thumbnail.jpg",
      originalLanguage: "English",
      dubbedLanguage: "Japanese",
      duration: "28:00",
      createdAt: "2026-01-15",
      fileSize: "1.2 GB",
      status: "processing"
    },
  ])

  const filteredVideos = savedVideos.filter(video =>
    video.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    video.dubbedLanguage.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handlePlayVideo = (video: SavedVideo) => {
    setSelectedVideo(video)
    setPreviewOpen(true)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    })
  }

  return (
    <div className="space-y-6">
      {/* Dubverse Studio Header */}
      <Card className="backdrop-blur-md bg-card/50 border-border/50">
        <CardContent className="py-6 px-6">
          <div className="flex items-center gap-3">
            <Globe2 className="h-10 w-10 text-primary" />
            <div>
              <h1 className="text-3xl font-bold text-foreground">Dubverse Studio</h1>
              <p className="text-sm text-muted-foreground">Your saved dubbed videos</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* View toggle and search */}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="icon"
          className={`bg-transparent ${viewMode === "grid" ? "border-primary text-primary" : ""}`}
          onClick={() => setViewMode("grid")}
        >
          <Grid3X3 className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className={`bg-transparent ${viewMode === "list" ? "border-primary text-primary" : ""}`}
          onClick={() => setViewMode("list")}
        >
          <List className="h-4 w-4" />
        </Button>
      </div>

      {/* Search and Filter Bar */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search your dubbed videos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-background/50 backdrop-blur-sm border-border/50"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2 bg-transparent">
              <Filter className="h-4 w-4" />
              Filter
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-background/95 backdrop-blur-md">
            <DropdownMenuItem>All Videos</DropdownMenuItem>
            <DropdownMenuItem>Completed</DropdownMenuItem>
            <DropdownMenuItem>Processing</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Spanish Dubs</DropdownMenuItem>
            <DropdownMenuItem>French Dubs</DropdownMenuItem>
            <DropdownMenuItem>German Dubs</DropdownMenuItem>
            <DropdownMenuItem>Japanese Dubs</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Videos Grid/List */}
      {filteredVideos.length > 0 ? (
        viewMode === "grid" ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredVideos.map((video) => (
              <Card 
                key={video.id} 
                className="group overflow-hidden backdrop-blur-md bg-card/50 border-border/50 hover:border-primary/50 transition-all cursor-pointer"
              >
                <div className="relative aspect-video bg-muted">
                  <img
                    src={video.thumbnail || "/placeholder.svg"}
                    alt={video.title}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Button 
                      size="icon" 
                      variant="secondary" 
                      className="h-10 w-10"
                      onClick={() => handlePlayVideo(video)}
                    >
                      <Play className="h-5 w-5" />
                    </Button>
                    <Button size="icon" variant="secondary" className="h-10 w-10">
                      <Download className="h-5 w-5" />
                    </Button>
                  </div>
                  <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
                    {video.duration}
                  </div>
                  {video.status === "processing" && (
                    <div className="absolute top-2 left-2">
                      <Badge variant="secondary" className="bg-yellow-500/80 text-white">
                        Processing
                      </Badge>
                    </div>
                  )}
                </div>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-foreground truncate">{video.title}</h3>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <Languages className="h-3 w-3" />
                        <span>{video.originalLanguage} → {video.dubbedLanguage}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>{formatDate(video.createdAt)}</span>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-background/95 backdrop-blur-md">
                        <DropdownMenuItem className="gap-2">
                          <Play className="h-4 w-4" /> Play
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2">
                          <Download className="h-4 w-4" /> Download
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2">
                          <Share2 className="h-4 w-4" /> Share
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2">
                          <Pencil className="h-4 w-4" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem className="gap-2">
                          <Copy className="h-4 w-4" /> Duplicate & Re-dub
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="gap-2 text-destructive">
                          <Trash2 className="h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="backdrop-blur-md bg-card/50 border-border/50">
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {filteredVideos.map((video) => (
                  <div 
                    key={video.id} 
                    className="flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <div className="relative w-32 aspect-video rounded overflow-hidden bg-muted shrink-0">
                      <img
                        src={video.thumbnail || "/placeholder.svg"}
                        alt={video.title}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded">
                        {video.duration}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-foreground truncate">{video.title}</h3>
                        {video.status === "processing" && (
                          <Badge variant="secondary" className="bg-yellow-500/80 text-white text-xs">
                            Processing
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Languages className="h-3 w-3" />
                          {video.originalLanguage} → {video.dubbedLanguage}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {video.duration}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(video.createdAt)}
                        </span>
                        <span>{video.fileSize}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className="gap-1 bg-transparent" onClick={() => handlePlayVideo(video)}>
                        <Play className="h-4 w-4" /> Play
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1 bg-transparent">
                        <Download className="h-4 w-4" /> Download
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-background/95 backdrop-blur-md">
                          <DropdownMenuItem className="gap-2">
                            <Share2 className="h-4 w-4" /> Share
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2">
                            <Pencil className="h-4 w-4" /> Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2">
                            <Copy className="h-4 w-4" /> Duplicate & Re-dub
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="gap-2 text-destructive">
                            <Trash2 className="h-4 w-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )
      ) : (
        /* Empty State */
        <Card className="backdrop-blur-md bg-card/50 border-border/50">
          <CardContent className="py-16">
            <div className="text-center">
              <FolderOpen className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-foreground mb-2">No dubbed videos yet</h2>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Your dubbed videos will appear here once you complete your first dubbing project.
              </p>
              <Button size="lg" className="gap-2">
                Start Your First Dub
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Video Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl bg-background/95 backdrop-blur-md">
          <DialogHeader>
            <DialogTitle>{selectedVideo?.title}</DialogTitle>
            <DialogDescription>
              {selectedVideo?.originalLanguage} → {selectedVideo?.dubbedLanguage} | {selectedVideo?.duration} | {selectedVideo?.fileSize}
            </DialogDescription>
          </DialogHeader>
          <div className="aspect-video bg-black rounded-lg flex items-center justify-center">
            <div className="text-center text-white">
              <Play className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <p className="text-muted-foreground">Video player would load here</p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" className="gap-2 bg-transparent">
              <Share2 className="h-4 w-4" /> Share
            </Button>
            <Button className="gap-2">
              <Download className="h-4 w-4" /> Download
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
