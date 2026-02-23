"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Film, Search, Clock, Calendar, Star, Filter } from "lucide-react"
import type { VideoSource } from "@/components/dashboard"

interface PublicDomainLibraryProps {
  onVideoSelect: (video: VideoSource) => void
}

type PublicDomainVideo = {
  id: string
  title: string
  year: number
  genre: string
  thumbnail: string
  duration: string
  rating: number
  description: string
  source: string
}

const PUBLIC_DOMAIN_VIDEOS: PublicDomainVideo[] = [
  {
    id: "pd-1",
    title: "Night of the Living Dead",
    year: 1968,
    genre: "Horror",
    thumbnail: "/classic-horror-movie-poster-night-living-dead.jpg",
    duration: "1:36:00",
    rating: 4.2,
    description: "A group of survivors take refuge in a farmhouse during a zombie apocalypse.",
    source: "Internet Archive",
  },
  {
    id: "pd-2",
    title: "Charade",
    year: 1963,
    genre: "Thriller",
    thumbnail: "/classic-thriller-movie-poster-1960s.jpg",
    duration: "1:53:00",
    rating: 4.5,
    description: "A woman is pursued by several men who want the fortune her late husband had stolen.",
    source: "Internet Archive",
  },
  {
    id: "pd-3",
    title: "His Girl Friday",
    year: 1940,
    genre: "Comedy",
    thumbnail: "/classic-1940s-comedy-movie-poster.jpg",
    duration: "1:32:00",
    rating: 4.3,
    description: "A newspaper editor uses every trick in the book to keep his ex-wife from remarrying.",
    source: "Internet Archive",
  },
  {
    id: "pd-4",
    title: "The General",
    year: 1926,
    genre: "Comedy",
    thumbnail: "/silent-film-comedy-movie-poster-train.jpg",
    duration: "1:07:00",
    rating: 4.7,
    description: "A train engineer must single-handedly recapture his stolen locomotive.",
    source: "Internet Archive",
  },
  {
    id: "pd-5",
    title: "Nosferatu",
    year: 1922,
    genre: "Horror",
    thumbnail: "/nosferatu-classic-horror-vampire-movie-poster.jpg",
    duration: "1:34:00",
    rating: 4.6,
    description: "A mysterious count summons Thomas Hutter to his remote castle in the mountains.",
    source: "Internet Archive",
  },
  {
    id: "pd-6",
    title: "A Trip to the Moon",
    year: 1902,
    genre: "Sci-Fi",
    thumbnail: "/trip-to-moon-classic-silent-film-poster.jpg",
    duration: "0:14:00",
    rating: 4.4,
    description: "A group of astronomers travel to the Moon in a cannon-propelled capsule.",
    source: "Internet Archive",
  },
]

const GENRES = ["All", "Horror", "Comedy", "Thriller", "Sci-Fi", "Drama", "Documentary"]

export function PublicDomainLibrary({ onVideoSelect }: PublicDomainLibraryProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedGenre, setSelectedGenre] = useState("All")

  const filteredVideos = PUBLIC_DOMAIN_VIDEOS.filter((video) => {
    const matchesSearch = video.title.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesGenre = selectedGenre === "All" || video.genre === selectedGenre
    return matchesSearch && matchesGenre
  })

  const handleVideoSelect = (video: PublicDomainVideo) => {
    onVideoSelect({
      id: video.id,
      title: video.title,
      url: `/public-domain/${video.id}`,
      thumbnail: video.thumbnail,
      duration: video.duration,
      source: "public-domain",
    })
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <Card className="backdrop-blur-md bg-card/50 border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Film className="h-5 w-5 text-primary" />
            Public Domain Video Library
          </CardTitle>
          <CardDescription>
            Classic films and content that are freely available for dubbing practice. All content is sourced from the
            Internet Archive and other public domain repositories.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search public domain films..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedGenre} onValueChange={setSelectedGenre}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Genre" />
              </SelectTrigger>
              <SelectContent>
                {GENRES.map((genre) => (
                  <SelectItem key={genre} value={genre}>
                    {genre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Video Grid */}
      <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {filteredVideos.map((video) => (
          <Card
            key={video.id}
            className="group cursor-pointer overflow-hidden transition-all hover:border-primary/50 hover:shadow-xl backdrop-blur-md bg-card/50 border-border/50"
            onClick={() => handleVideoSelect(video)}
          >
            <div className="relative aspect-[2/3] overflow-hidden">
              <img
                src={video.thumbnail || "/placeholder.svg"}
                alt={video.title}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-3">
                <Badge variant="secondary" className="mb-2">
                  {video.genre}
                </Badge>
                <h3 className="line-clamp-2 font-semibold text-white">{video.title}</h3>
              </div>
              <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-xs text-white">
                <Clock className="h-3 w-3" />
                {video.duration}
              </div>
            </div>
            <CardContent className="p-3">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {video.year}
                </span>
                <span className="flex items-center gap-1">
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                  {video.rating}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{video.description}</p>
              <p className="mt-2 text-xs text-muted-foreground">Source: {video.source}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredVideos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Film className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-medium text-foreground">No videos found</h3>
          <p className="mt-1 text-muted-foreground">Try adjusting your search or filter criteria</p>
        </div>
      )}

      {/* Featured Collections */}
      <Card className="backdrop-blur-md bg-card/50 border-border/50">
        <CardHeader>
          <CardTitle>Featured Collections</CardTitle>
          <CardDescription>Curated sets perfect for dubbing practice</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { name: "Silent Film Classics", count: 24, icon: "🎬" },
              { name: "Golden Age Hollywood", count: 48, icon: "🌟" },
              { name: "Classic Horror", count: 16, icon: "🎃" },
              { name: "Educational Films", count: 120, icon: "📚" },
            ].map((collection) => (
              <div
                key={collection.name}
                className="cursor-pointer rounded-lg border border-border p-4 transition-all hover:border-primary/50 hover:bg-muted/50"
              >
                <div className="mb-2 text-3xl">{collection.icon}</div>
                <h4 className="font-medium text-foreground">{collection.name}</h4>
                <p className="text-sm text-muted-foreground">{collection.count} videos</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
