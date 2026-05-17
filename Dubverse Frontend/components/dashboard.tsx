"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VideoUpload } from "@/components/video-upload"
import { YouTubeIntegration } from "@/components/youtube-integration"
import { PublicDomainLibrary } from "@/components/public-domain-library"
import { CreatorCollaboration } from "@/components/creator-collaboration"
import { StudioModeSelector } from "@/components/studio-mode-selector"
import { DubbingWorkspace } from "@/components/dubbing-workspace"
import { AdvancedDubbingEditor } from "@/components/advanced-dubbing-editor"
import { Header } from "@/components/header"
import { Upload, Youtube, Film, Clapperboard, Mic2, AlertTriangle } from "lucide-react"
import { RecentProjects } from "@/components/recent-projects"
import { BonusMinutesDialog } from "@/components/bonus-minutes-dialog"
import { createClient } from "@/lib/supabase/client"
import { apiClient } from "@/lib/api-client"

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

export type EditorMode = "automatic" | "professional"

// Background images for each tab
const tabBackgrounds: Record<string, string> = {
  upload: "/backgrounds/marvel-stormy.jpg",
  youtube: "/backgrounds/ipman-kungfu.jpg",
  library: "/backgrounds/streaming-library.jpg",
  studio: "/backgrounds/anime-motion-teal.jpg",
  collaborate: "/backgrounds/anime-motion-teal.jpg",
  projects: "/backgrounds/anime-dark-collage.jpg",
}

export function Dashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') ?? "upload")

  useEffect(() => {
    const tab = searchParams.get('tab') ?? 'upload'
    setActiveTab(tab)
  }, [searchParams])
  const [selectedVideo, setSelectedVideo] = useState<VideoSource | null>(null)
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<EditorMode>("automatic")

  // Usage tracking state
  const [planType, setPlanType] = useState<string>("premium")
  const [planLimit, setPlanLimit] = useState<number>(90)
  const [minutesUsed, setMinutesUsed] = useState<number>(0)
  const [bonusBalance, setBonusBalance] = useState<number>(0)
  const [bonusDialogOpen, setBonusDialogOpen] = useState(false)
  const [loadingUsage, setLoadingUsage] = useState(true)

  const supabase = createClient()

  // Fetch usage data on component mount
  useEffect(() => {
    async function fetchUsageData() {
      setLoadingUsage(true)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const user = session.user
        apiClient.setToken(session.access_token)

        // Fetch subscription info
        const { data: subData } = await supabase
          .from("subscriptions")
          .select("plan_type")
          .eq("user_id", user.id)
          .in("status", ["active", "trialing"])
          .limit(1)
          .single()

        // Fetch current month usage
        const { data: usageData } = await supabase
          .from("usage")
          .select("minutes_used")
          .eq("user_id", user.id)
          .order("month", { ascending: false })
          .limit(1)
          .single()

        // Fetch bonus minutes (use maybeSingle to avoid error if no record exists)
        const { data: bonusData } = await supabase
          .from("bonus_minutes")
          .select("balance")
          .eq("user_id", user.id)
          .maybeSingle()

        // Set plan limits
        const PLAN_LIMITS: Record<string, number> = {
          basic: 45,
          premium: 90,
          professional: -1, // unlimited
        }

        const plan = subData?.plan_type || "basic"
        const limit = PLAN_LIMITS[plan] || 45
        const used = usageData?.minutes_used || 0
        const bonus = bonusData?.balance || 0

        setPlanType(plan)
        setPlanLimit(limit)
        setMinutesUsed(used)
        setBonusBalance(bonus)
      } catch (error) {
        console.error("Failed to fetch usage data:", error)
        // Set defaults on error to prevent blank UI
        setPlanType("basic")
        setPlanLimit(45)
        setMinutesUsed(0)
        setBonusBalance(0)
      } finally {
        setLoadingUsage(false)
      }
    }

    fetchUsageData()
  }, [])

  // Keep API client token in sync with Supabase auth state
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        apiClient.setToken(session?.access_token ?? null)
      }
    )
    return () => subscription.unsubscribe()
  }, [])

  const handleVideoSelect = (video: VideoSource) => {
    setSelectedVideo(video)
    setIsWorkspaceOpen(true)
  }

  const handleCloseWorkspace = () => {
    setIsWorkspaceOpen(false)
    setSelectedVideo(null)
  }

  const handleEditorModeChange = (mode: EditorMode) => {
    setEditorMode(mode)
  }

  const handleOpenEditor = () => {
    router.push('/editor')
  }

  const currentBackground = tabBackgrounds[activeTab] || tabBackgrounds.upload

  return (
    <div className="min-h-screen bg-[#020817] relative overflow-hidden">
      {/* Very dark background */}
      <div className="fixed inset-0 z-0 bg-[#020817]" />

      {/* Subtle purple/cyan ambient glow */}
      <div className="fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top,_rgba(168,85,247,0.08)_0%,_transparent_50%)]" />
      <div className="fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_bottom,_rgba(34,211,238,0.05)_0%,_transparent_50%)]" />


      <div className="relative z-10">
        <Header
          activeTab={activeTab}
          onNavigate={setActiveTab}
          editorMode={editorMode}
          onEditorModeChange={handleEditorModeChange}
        />

        {isWorkspaceOpen && selectedVideo ? (
          editorMode === "professional" ? (
            <AdvancedDubbingEditor
              videoTitle={selectedVideo.title}
              videoUrl={selectedVideo.url}
              onBack={handleCloseWorkspace}
              onExport={() => {}}
            />
          ) : (
            <DubbingWorkspace video={selectedVideo} onClose={handleCloseWorkspace} planType={planType} />
          )
        ) : (
          <main className="relative z-10 flex items-center justify-center px-4" style={{ minHeight: 'calc(100vh - 256px)', paddingTop: '220px', paddingBottom: '160px' }}>
            <div className="max-w-6xl w-full mx-auto">
              {/* USAGE TRACKING CARD - Compact */}
              <div className="mb-6">
                <div className="relative bg-gradient-to-r from-[#0F172A]/80 to-[#1E293B]/80 backdrop-blur-xl border border-[#A855F7]/30 rounded-xl p-4 shadow-[0_0_40px_rgba(168,85,247,0.2)]">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-[#A855F7] via-[#FDB022] to-[#22D3EE] rounded-xl opacity-20 blur-xl" />

                  <div className="relative grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                    {/* Plan Info */}
                    <div>
                      <p className="text-[#94A3B8] text-xs mb-1">Your Plan</p>
                      <p className="text-white text-xl font-bold bg-gradient-to-r from-[#A855F7] to-[#FDB022] bg-clip-text text-transparent capitalize">
                        {loadingUsage ? "..." : planType}
                      </p>
                    </div>

                    {/* Usage Stats */}
                    <div className="md:col-span-2">
                      {!loadingUsage && (() => {
                        const planRemaining = planLimit > 0 ? Math.max(0, planLimit - minutesUsed) : Infinity
                        const totalRemaining = planRemaining === Infinity ? Infinity : planRemaining + bonusBalance
                        const usagePercent = planLimit > 0 ? Math.min((minutesUsed / planLimit) * 100, 100) : 0
                        const isLowUsage = totalRemaining !== Infinity && totalRemaining < 10
                        const isExhausted = totalRemaining === 0

                        return (
                          <>
                            <div className="flex justify-between items-center mb-1.5">
                              <p className="text-[#94A3B8] text-xs">Monthly Usage</p>
                              <p className="text-white text-sm font-bold">
                                <span className={isExhausted ? "text-red-400" : isLowUsage ? "text-[#FDB022]" : "text-[#22D3EE]"}>
                                  {planLimit > 0 ? minutesUsed : "Unlimited"}
                                </span>
                                {planLimit > 0 && (
                                  <>
                                    <span className="text-[#64748B]"> / </span>
                                    <span className="text-[#94A3B8]">{planLimit} min</span>
                                  </>
                                )}
                              </p>
                            </div>

                            {planLimit > 0 && (
                              <>
                                {/* Progress Bar */}
                                <div className="relative h-2 bg-[#0F172A] rounded-full overflow-hidden border border-[#334155]">
                                  <div
                                    className={`absolute inset-y-0 left-0 rounded-full shadow-[0_0_15px_rgba(168,85,247,0.6)] ${
                                      isExhausted
                                        ? "bg-gradient-to-r from-red-500 to-red-600"
                                        : isLowUsage
                                        ? "bg-gradient-to-r from-[#FDB022] to-[#F59E0B]"
                                        : "bg-gradient-to-r from-[#A855F7] via-[#C084FC] to-[#22D3EE]"
                                    }`}
                                    style={{ width: `${usagePercent}%` }}
                                  />
                                </div>

                                <div className="flex justify-between mt-1.5">
                                  <div className="text-[10px]">
                                    {isExhausted ? (
                                      <span className="text-red-400 font-semibold flex items-center gap-1">
                                        <AlertTriangle className="h-3 w-3" />
                                        Quota exceeded
                                      </span>
                                    ) : isLowUsage ? (
                                      <span className="text-[#FDB022] font-semibold flex items-center gap-1">
                                        <AlertTriangle className="h-3 w-3" />
                                        Only {Math.floor(totalRemaining)} min remaining
                                      </span>
                                    ) : (
                                      <span className="text-[#64748B]">
                                        <span className="text-[#22D3EE] font-semibold">{Math.floor(planRemaining)} min</span> plan
                                        {bonusBalance > 0 && <span className="text-[#22D3EE] font-semibold"> + {bonusBalance} bonus</span>}
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => setBonusDialogOpen(true)}
                                    className="text-[#FDB022] text-[10px] font-semibold hover:text-[#FDB022]/80 transition-colors"
                                  >
                                    Buy More →
                                  </button>
                                </div>
                              </>
                            )}
                          </>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              {/* CINEMATIC TITLE - Compact */}
              <div className="text-center mb-6">
                <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-[#A855F7] via-[#FDB022] to-[#22D3EE] bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(168,85,247,0.8)] mb-2">
                  DubMaster Studio
                </h1>
                <p className="text-[#94A3B8] text-base md:text-lg italic">
                  Transform Your Content. Reach The World.
                </p>
              </div>

              {/* TABS - Above upload */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full mb-6">
                <TabsList className="w-full grid grid-cols-5 bg-[#0F172A]/60 backdrop-blur-xl border border-[#A855F7]/20 shadow-[0_0_20px_rgba(168,85,247,0.15)] p-1 rounded-xl">
                  <TabsTrigger
                    value="upload"
                    className="gap-2 cursor-pointer data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#A855F7]/30 data-[state=active]:to-[#22D3EE]/30 data-[state=active]:text-white text-[#64748B] hover:text-[#A855F7] transition-all rounded-lg"
                  >
                    <Upload className="h-4 w-4" />
                    <span className="hidden sm:inline">Upload</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="youtube"
                    className="gap-2 cursor-pointer data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#A855F7]/30 data-[state=active]:to-[#22D3EE]/30 data-[state=active]:text-white text-[#64748B] hover:text-[#A855F7] transition-all rounded-lg"
                  >
                    <Youtube className="h-4 w-4" />
                    <span className="hidden sm:inline">YouTube</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="library"
                    className="gap-2 cursor-pointer data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#A855F7]/30 data-[state=active]:to-[#22D3EE]/30 data-[state=active]:text-white text-[#64748B] hover:text-[#A855F7] transition-all rounded-lg"
                  >
                    <Film className="h-4 w-4" />
                    <span className="hidden sm:inline">Library</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="studio"
                    className="gap-2 cursor-pointer data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#A855F7]/30 data-[state=active]:to-[#22D3EE]/30 data-[state=active]:text-white text-[#64748B] hover:text-[#A855F7] transition-all rounded-lg"
                  >
                    <Clapperboard className="h-4 w-4" />
                    <span className="hidden sm:inline">Studio</span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="projects"
                    className="gap-2 cursor-pointer data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#A855F7]/30 data-[state=active]:to-[#22D3EE]/30 data-[state=active]:text-white text-[#64748B] hover:text-[#A855F7] transition-all rounded-lg"
                  >
                    <Mic2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Projects</span>
                  </TabsTrigger>
                </TabsList>

                {/* GLASS MORPHISM UPLOAD BOX - Compact */}
                <TabsContent value="upload" className="mt-0">
                  <div className="relative group">
                    {/* Outer glow */}
                    <div className="absolute -inset-1 bg-gradient-to-r from-[#A855F7] via-[#FDB022] to-[#22D3EE] rounded-2xl opacity-30 blur-2xl group-hover:opacity-50 transition-opacity duration-500" />

                    {/* Glass container */}
                    <div className="relative bg-gradient-to-br from-[#0F172A]/60 to-[#1E293B]/60 backdrop-blur-2xl border-2 border-[#A855F7]/40 rounded-2xl p-8 shadow-[0_0_60px_rgba(168,85,247,0.3)] group-hover:shadow-[0_0_80px_rgba(168,85,247,0.5)] group-hover:border-[#A855F7]/60 transition-all duration-500">
                      <VideoUpload
                        onVideoSelect={handleVideoSelect}
                        quotaExceeded={!loadingUsage && planLimit > 0 && (planLimit - minutesUsed + bonusBalance) <= 0}
                        remainingMinutes={planLimit > 0 ? Math.max(0, planLimit - minutesUsed + bonusBalance) : Infinity}
                        onBuyMore={() => setBonusDialogOpen(true)}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="youtube">
                  <YouTubeIntegration onVideoSelect={handleVideoSelect} />
                </TabsContent>
                <TabsContent value="library">
                  <PublicDomainLibrary onVideoSelect={handleVideoSelect} />
                </TabsContent>
                <TabsContent value="studio">
                  <StudioModeSelector
                    editorMode={editorMode}
                    onEditorModeChange={handleEditorModeChange}
                    onStartProject={() => setActiveTab("upload")}
                    onOpenEditor={handleOpenEditor}
                  />
                </TabsContent>
                <TabsContent value="projects">
                  <RecentProjects onVideoSelect={handleVideoSelect} />
                </TabsContent>
              </Tabs>
            </div>
          </main>
        )}
      </div>

      {/* Bonus Minutes Dialog */}
      <BonusMinutesDialog
        open={bonusDialogOpen}
        onOpenChange={setBonusDialogOpen}
        planMinutesUsed={minutesUsed}
        planMinutesLimit={planLimit}
        bonusBalance={bonusBalance}
        planType={planType}
      />
    </div>
  )
}
