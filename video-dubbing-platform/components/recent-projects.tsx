"use client"

import type { VideoSource } from "@/components/dashboard"

interface RecentProjectsProps {
  onVideoSelect: (video: VideoSource) => void
}

export function RecentProjects({ onVideoSelect }: RecentProjectsProps) {
  const projects = [
    {
      id: "1",
      title: "Marketing Video - Spanish Dub",
      url: "/marketing-video-thumbnail.png",
      thumbnail: "/marketing-video-thumbnail.png",
      duration: "5:32",
      source: "upload" as const,
      status: "In Progress",
      targetLanguage: "Spanish",
      progress: 65,
    },
    {
      id: "2",
      title: "Tutorial Series - French Dub",
      url: "/tutorial-video-thumbnail.png",
      thumbnail: "/tutorial-video-thumbnail.png",
      duration: "1:24:15",
      source: "upload" as const,
      status: "Completed",
      targetLanguage: "French",
      progress: 100,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Recent Projects</h2>
      </div>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <div
            key={project.id}
            className="group cursor-pointer overflow-hidden rounded-xl border border-border/50 bg-card/50 backdrop-blur-md transition-all hover:border-primary/50 hover:shadow-lg"
            onClick={() => onVideoSelect(project)}
          >
            <div className="relative aspect-video">
              <img
                src={project.thumbnail || "/placeholder.svg"}
                alt={project.title}
                className="h-full w-full object-cover"
              />
              <div className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-1 text-xs text-white">
                {project.duration}
              </div>
              <div className="absolute left-2 top-2 rounded bg-primary/90 px-2 py-1 text-xs font-medium text-primary-foreground">
                {project.targetLanguage}
              </div>
            </div>
            <div className="p-4">
              <h3 className="font-medium text-foreground group-hover:text-primary">{project.title}</h3>
              <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
                <span>{project.status}</span>
                <span>{project.progress}%</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${project.progress}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
