"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Film } from "lucide-react"
import { apiClient, API_BASE_URL } from "@/lib/api-client"
import { createClient } from "@/lib/supabase/client"
import { expiryLevel, daysUntil } from "@/lib/plan-features"

type Project = {
  project_id: string
  job_id: string
  title: string
  video_filename: string | null
  source_language: string | null
  target_language: string | null
  thumbnail_url: string | null
  status: string
  progress: number
  created_at: string
  updated_at: string
  /** Retention date. null/absent = permanent (Professional). */
  expires_at?: string | null
}

interface RecentProjectsProps {
  onVideoSelect?: (video: any) => void
}

export function RecentProjects({ onVideoSelect }: RecentProjectsProps) {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) apiClient.setToken(session.access_token)
      apiClient.listProjects().then(p => {
        setProjects(p)
        setLoading(false)
      }).catch(() => setLoading(false))
    })
  }, [])

  const openProject = (project: Project) => {
    router.push(`/editor/${project.job_id}`)
  }

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    } catch {
      return ''
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading projects…
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <Film className="h-10 w-10 text-slate-600" />
        <p className="text-slate-400 font-medium">No saved projects yet</p>
        <p className="text-slate-600 text-sm">Open a job in the editor and click Save to add it here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">My Projects</h2>
        <span className="text-sm text-slate-500">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {projects.map(project => (
          <div
            key={project.project_id}
            className="group cursor-pointer overflow-hidden rounded-xl border border-border/50 bg-card/50 backdrop-blur-md transition-all hover:border-primary/50 hover:shadow-lg"
            onClick={() => openProject(project)}
          >
            {/* Thumbnail */}
            <div className="relative aspect-video bg-slate-900 flex items-center justify-center">
              {project.thumbnail_url ? (
                <img
                  src={project.thumbnail_url.startsWith('http') ? project.thumbnail_url : `${API_BASE_URL}${project.thumbnail_url}`}
                  alt={project.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Film className="h-10 w-10 text-slate-700" />
              )}
              {/* Retention traffic light. Three dots, the live one lit:
                  green > 10 days, amber 3-10, red under 3. Professional
                  projects never expire, so nothing is shown at all rather
                  than a permanently green light that means nothing. */}
              {(() => {
                const level = expiryLevel(project.expires_at)
                if (level === 'none') return null
                const left = daysUntil(project.expires_at)
                const dots = [
                  { key: 'green', on: level === 'green', lit: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]' },
                  { key: 'amber', on: level === 'amber', lit: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]' },
                  { key: 'red',   on: level === 'red',   lit: 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]' },
                ]
                return (
                  <div
                    className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-1 backdrop-blur-sm"
                    title={left === 0
                      ? 'Expires today'
                      : `Expires in ${left} day${left === 1 ? '' : 's'}`}
                  >
                    {dots.map(d => (
                      <span
                        key={d.key}
                        className={`h-1.5 w-1.5 rounded-full ${d.on ? d.lit : 'bg-white/20'}`}
                      />
                    ))}
                  </div>
                )
              })()}
              {project.target_language && (
                <div className="absolute left-2 top-2 rounded bg-primary/90 px-2 py-1 text-xs font-medium text-primary-foreground uppercase">
                  {project.target_language}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="p-4">
              <h3 className="font-medium text-foreground group-hover:text-primary truncate" title={project.title}>
                {project.title || project.video_filename || project.job_id.slice(0, 8)}
              </h3>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span className="capitalize">{project.status}</span>
                <span>{formatDate(project.updated_at)}</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, project.progress ?? 0)}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
