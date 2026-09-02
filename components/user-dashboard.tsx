"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { apiClient, API_BASE_URL, type JobStatus } from "@/lib/api-client"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  AlertTriangle,
  Film,
  User,
  Shield,
  Activity,
  RefreshCw,
  Save,
  Mail,
  Clock,
} from "lucide-react"
import { useT } from '@/lib/use-t'

const STATUS_CONFIG: Record<string, { label: string; classes: string }> = {
  completed:                { label: "Completed",   classes: "text-green-400  border-green-400/30  bg-green-400/10"  },
  failed:                   { label: "Failed",      classes: "text-red-400    border-red-400/30    bg-red-400/10"    },
  cancelled:                { label: "Cancelled",   classes: "text-gray-400   border-gray-400/30   bg-gray-400/10"   },
  pending:                  { label: "Pending",     classes: "text-yellow-400 border-yellow-400/30 bg-yellow-400/10" },
  uploading:                { label: "Uploading",   classes: "text-blue-400   border-blue-400/30   bg-blue-400/10"   },
  processing:               { label: "Processing",  classes: "text-purple-400 border-purple-400/30 bg-purple-400/10" },
  chunking:                 { label: "Chunking",    classes: "text-purple-400 border-purple-400/30 bg-purple-400/10" },
  extracting_audio:         { label: "Extracting",  classes: "text-purple-400 border-purple-400/30 bg-purple-400/10" },
  diarizing:                { label: "Diarizing",   classes: "text-purple-400 border-purple-400/30 bg-purple-400/10" },
  transcribing:             { label: "Transcribing",classes: "text-purple-400 border-purple-400/30 bg-purple-400/10" },
  translating:              { label: "Translating", classes: "text-cyan-400   border-cyan-400/30   bg-cyan-400/10"   },
  synthesizing:             { label: "Synthesizing",classes: "text-cyan-400   border-cyan-400/30   bg-cyan-400/10"   },
  reassembling:             { label: "Assembling",  classes: "text-cyan-400   border-cyan-400/30   bg-cyan-400/10"   },
  ready_for_voice_selection:{ label: "Ready",       classes: "text-yellow-400 border-yellow-400/30 bg-yellow-400/10" },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    classes: "text-gray-400 border-gray-400/30 bg-gray-400/10",
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.classes}`}
    >
      {cfg.label}
    </span>
  )
}

function formatDate(iso: string): string {
  try {
    const safeIso = iso.endsWith('Z') ? iso : iso + 'Z'
    return new Date(safeIso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "—"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

const PLAN_LABELS: Record<string, string> = {
  basic: "Basic",
  premium: "Premium",
  professional: "Professional",
}

export function UserDashboard() {
  const t = useT()
  const supabase = createClient()

  const [token, setToken] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState("")
  const [userId, setUserId] = useState("")

  const [jobs, setJobs] = useState<JobStatus[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [clearAllOpen, setClearAllOpen] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)

  const [displayName, setDisplayName] = useState("")
  const [displayNameSaving, setDisplayNameSaving] = useState(false)
  const [displayNameSaved, setDisplayNameSaved] = useState(false)
  const [planType, setPlanType] = useState("basic")
  const [passwordResetSent, setPasswordResetSent] = useState(false)
  const [passwordResetLoading, setPasswordResetLoading] = useState(false)

  const [activeTab, setActiveTab] = useState("activity")

  const loadJobs = useCallback(async () => {
    setJobsLoading(true)
    setJobsError(null)
    try {
      const data = await apiClient.listJobs()
      setJobs(data)
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : "Failed to load jobs")
    } finally {
      setJobsLoading(false)
    }
  }, [])

  const loadProfile = useCallback(async (uid: string) => {
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", uid)
        .maybeSingle()
      if (profile?.display_name) setDisplayName(profile.display_name)

      const { data: sub } = await supabase
        .from("subscriptions")
        .select("plan_type")
        .eq("user_id", uid)
        .in("status", ["active", "trialing"])
        .limit(1)
        .single()
      if (sub?.plan_type) setPlanType(sub.plan_type)
    } catch {
      // defaults fine
    }
  }, [supabase])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      setToken(session.access_token)
      setUserEmail(session.user.email ?? "")
      setUserId(session.user.id)
      apiClient.setToken(session.access_token)
      loadJobs()
      loadProfile(session.user.id)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const t = session?.access_token ?? null
        setToken(t)
        apiClient.setToken(t)
      }
    )
    return () => subscription.unsubscribe()
  }, [loadJobs, loadProfile, supabase.auth])

  const handleDeleteJob = async (jobId: string) => {
    setDeletingId(jobId)
    try {
      await apiClient.deleteJob(jobId)
      setJobs(prev => prev.filter(j => j.job_id !== jobId))
    } catch (err) {
      console.error("Delete failed:", err)
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  const handleClearAll = async () => {
    setClearingAll(true)
    try {
      await fetch(`${API_BASE_URL}/api/jobs/clear-all?force=true`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      setJobs([])
    } catch (err) {
      console.error("Clear all failed:", err)
    } finally {
      setClearingAll(false)
      setClearAllOpen(false)
    }
  }

  const handleSaveDisplayName = async () => {
    if (!userId || !displayName.trim()) return
    setDisplayNameSaving(true)
    try {
      await supabase
        .from("profiles")
        .upsert({ id: userId, display_name: displayName.trim() })
      setDisplayNameSaved(true)
      setTimeout(() => setDisplayNameSaved(false), 3000)
    } catch {
      // silent
    } finally {
      setDisplayNameSaving(false)
    }
  }

  const handlePasswordReset = async () => {
    if (!userEmail) return
    setPasswordResetLoading(true)
    try {
      await supabase.auth.resetPasswordForEmail(userEmail)
      setPasswordResetSent(true)
    } catch {
      // silent
    } finally {
      setPasswordResetLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#020817] relative overflow-hidden">
      <div className="fixed inset-0 z-0 bg-[#020817]" />
      <div className="fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top,_rgba(168,85,247,0.08)_0%,_transparent_50%)]" />
      <div className="fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_bottom,_rgba(34,211,238,0.05)_0%,_transparent_50%)]" />

      <div className="relative z-10">
        <Header activeTab="dashboard" />

        <main className="max-w-5xl mx-auto px-4 py-10">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white">{t('Dashboard')}</h1>
            <p className="text-[#94A3B8] mt-1 text-sm">
              {t('Your dubbing history and account settings')}
            </p>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="bg-[#0F172A]/60 backdrop-blur-xl border border-[#A855F7]/20 p-1 rounded-xl mb-6">
              <TabsTrigger
                value="activity"
                className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#A855F7]/30 data-[state=active]:to-[#22D3EE]/30 data-[state=active]:text-white text-[#64748B] rounded-lg"
              >
                <Activity className="h-4 w-4" />
                {t('Activity')}
              </TabsTrigger>
              <TabsTrigger
                value="account"
                className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#A855F7]/30 data-[state=active]:to-[#22D3EE]/30 data-[state=active]:text-white text-[#64748B] rounded-lg"
              >
                <User className="h-4 w-4" />
                {t('Account')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="activity">
              <div className="relative bg-gradient-to-br from-[#0F172A]/60 to-[#1E293B]/60 backdrop-blur-xl border border-[#A855F7]/20 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <Film className="h-5 w-5 text-[#A855F7]" />
                    <h2 className="text-white font-semibold text-lg">{t('Dubbing History')}</h2>
                    {!jobsLoading && (
                      <span className="text-xs text-[#64748B] ml-1">
                        ({jobs.length} job{jobs.length !== 1 ? "s" : ""})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={loadJobs}
                      disabled={jobsLoading}
                      className="text-[#94A3B8] hover:text-[#C084FC] hover:bg-[#A855F7]/10 h-8 px-3"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${jobsLoading ? "animate-spin" : ""}`} />
                      {t('Refresh')}
                    </Button>
                    {jobs.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setClearAllOpen(true)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-8 px-3"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                        {t('Delete All')}
                      </Button>
                    )}
                  </div>
                </div>

                {jobsLoading && (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-8 w-8 text-[#A855F7] animate-spin" />
                  </div>
                )}

                {!jobsLoading && jobsError && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <AlertTriangle className="h-8 w-8 text-red-400" />
                    <p className="text-red-400 text-sm">{jobsError}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={loadJobs}
                      className="text-[#94A3B8] hover:text-white"
                    >
                      {t('Try again')}
                    </Button>
                  </div>
                )}

                {!jobsLoading && !jobsError && jobs.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <Film className="h-10 w-10 text-[#334155]" />
                    <p className="text-[#64748B] text-sm">{t('No dubbing jobs yet')}</p>
                    <p className="text-[#475569] text-xs">
                      {t('Upload a video in DubMaster Studio to get started')}
                    </p>
                  </div>
                )}

                {!jobsLoading && !jobsError && jobs.length > 0 && (
                  <div className="space-y-3">
                    {jobs.map(job => (
                      <div
                        key={job.job_id}
                        className="group relative bg-[#0F172A]/50 border border-[#1E293B] hover:border-[#A855F7]/30 rounded-xl p-4 transition-all duration-200"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <p className="text-white font-medium text-sm truncate max-w-xs">
                                {job.video_filename}
                              </p>
                              <StatusBadge status={job.status} />
                            </div>

                            {job.progress > 0 && job.progress < 100 && (
                              <div className="h-1 bg-[#1E293B] rounded-full overflow-hidden mb-2 max-w-xs">
                                <div
                                  className="h-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] rounded-full transition-all"
                                  style={{ width: `${job.progress}%` }}
                                />
                              </div>
                            )}

                            <div className="flex items-center gap-4 text-xs text-[#64748B] flex-wrap">
                              {job.source_language && (
                                <span>
                                  Lang:{" "}
                                  <span className="text-[#94A3B8]">
                                    {job.source_language.toUpperCase()}
                                  </span>
                                </span>
                              )}
                              {job.video_duration && (
                                <span>
                                  Duration:{" "}
                                  <span className="text-[#94A3B8]">
                                    {formatDuration(job.video_duration)}
                                  </span>
                                </span>
                              )}
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatDate(job.created_at)}
                              </span>
                              {job.status === "completed" && (
                                <span className="text-green-400 flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3" />
                                  {t('Done')}
                                </span>
                              )}
                              {job.status === "failed" && (
                                <span className="text-red-400 flex items-center gap-1">
                                  <XCircle className="h-3 w-3" />
                                  {job.error_message
                                    ? job.error_message.slice(0, 60)
                                    : "Failed"}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex-shrink-0">
                            {confirmDeleteId === job.job_id ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-[#94A3B8]">{t('Delete?')}</span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleDeleteJob(job.job_id)}
                                  disabled={deletingId === job.job_id}
                                  className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 text-xs"
                                >
                                  {deletingId === job.job_id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    "Yes"
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="h-7 px-2 text-[#64748B] hover:text-white text-xs"
                                >
                                  No
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setConfirmDeleteId(job.job_id)}
                                className="h-8 w-8 p-0 text-[#334155] hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                aria-label={t('Delete job')}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="account">
              <div className="space-y-4">
                <div className="relative bg-gradient-to-br from-[#0F172A]/60 to-[#1E293B]/60 backdrop-blur-xl border border-[#A855F7]/20 rounded-2xl p-6">
                  <div className="flex items-center gap-2 mb-5">
                    <User className="h-5 w-5 text-[#A855F7]" />
                    <h2 className="text-white font-semibold text-lg">{t('Profile')}</h2>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between py-3 border-b border-[#1E293B]">
                      <span className="text-[#94A3B8] text-sm">{t('Plan')}</span>
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border border-[#A855F7]/40 bg-[#A855F7]/10 text-[#C084FC]">
                        {PLAN_LABELS[planType] ?? planType}
                      </span>
                    </div>

                    <div className="flex items-center justify-between py-3 border-b border-[#1E293B]">
                      <span className="text-[#94A3B8] text-sm">{t('Email')}</span>
                      <span className="text-white text-sm font-medium flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-[#64748B]" />
                        {userEmail || "—"}
                      </span>
                    </div>

                    <div className="py-3 border-b border-[#1E293B]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[#94A3B8] text-sm">{t('Display name')}</span>
                        {displayNameSaved && (
                          <span className="text-green-400 text-xs flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> {t('Saved')}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={displayName}
                          onChange={e => setDisplayName(e.target.value)}
                          placeholder={t('Your display name')}
                          className="flex-1 bg-[#0F172A] border border-[#334155] focus:border-[#A855F7]/60 rounded-lg px-3 py-2 text-sm text-white placeholder-[#475569] outline-none transition-colors"
                        />
                        <Button
                          size="sm"
                          onClick={handleSaveDisplayName}
                          disabled={displayNameSaving || !displayName.trim()}
                          className="bg-[#A855F7]/20 hover:bg-[#A855F7]/30 border border-[#A855F7]/40 text-[#C084FC] h-9 px-4"
                        >
                          {displayNameSaving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="relative bg-gradient-to-br from-[#0F172A]/60 to-[#1E293B]/60 backdrop-blur-xl border border-[#A855F7]/20 rounded-2xl p-6">
                  <div className="flex items-center gap-2 mb-5">
                    <Shield className="h-5 w-5 text-[#A855F7]" />
                    <h2 className="text-white font-semibold text-lg">{t('Security')}</h2>
                  </div>

                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-[#94A3B8] text-sm">{t('Password')}</p>
                      <p className="text-white text-base tracking-[0.25em] mt-0.5">
                        ••••••••
                      </p>
                    </div>
                    <div className="text-right">
                      {passwordResetSent ? (
                        <div className="text-green-400 text-sm flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4" />
                          {t('Reset email sent')}
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handlePasswordReset}
                          disabled={passwordResetLoading}
                          className="text-[#94A3B8] hover:text-[#C084FC] hover:bg-[#A855F7]/10 h-8 px-3 text-sm"
                        >
                          {passwordResetLoading && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          )}
                          Change Password
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </main>
      </div>

      <Dialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <DialogContent className="bg-[#0F172A] border-[#A855F7]/30 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              {t('Delete All Jobs')}
            </DialogTitle>
            <DialogDescription className="text-[#94A3B8]">
              This will permanently delete all {jobs.length} job
              {jobs.length !== 1 ? "s" : ""} and their files. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 mt-2">
            <Button
              variant="ghost"
              onClick={() => setClearAllOpen(false)}
              disabled={clearingAll}
              className="text-[#94A3B8] hover:text-white"
            >
              {t('Cancel')}
            </Button>
            <Button
              onClick={handleClearAll}
              disabled={clearingAll}
              className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 hover:text-red-300"
            >
              {clearingAll ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
