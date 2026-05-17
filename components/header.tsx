"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import { Bell, Settings, User, Menu, X, Mic2, Check, Users, LogOut, Clapperboard } from "lucide-react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LanguageSwitcher } from "@/components/language-switcher"

import type { EditorMode } from "@/components/dashboard"

interface HeaderProps {
  activeTab?: string
  onNavigate?: (tab: string) => void
  editorMode?: EditorMode
  onEditorModeChange?: (mode: EditorMode) => void
}

export function Header({ activeTab = "upload", onNavigate, editorMode = "automatic", onEditorModeChange }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [voiceLibraryOpen, setVoiceLibraryOpen] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [planType, setPlanType] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()
  const t = useTranslations('nav')
  const tc = useTranslations('common')

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      setUserEmail(data.user.email ?? null)
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("plan_type")
        .eq("user_id", data.user.id)
        .in("status", ["active", "trialing"])
        .limit(1)
        .single()
      setPlanType(sub?.plan_type ?? null)
    })
  }, [])

  const canAccessEditor = planType === "premium" || planType === "professional"

  const userInitials = userEmail ? userEmail.slice(0, 2).toUpperCase() : "?"

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/signin")
    router.refresh()
  }

  const handleNavClick = (tab: string) => {
    const routes: Record<string, string> = {
      dashboard: "/dashboard",
      projects: "/dashboard?tab=projects",
      collaborate: "/collaborate",
      studio: "/studio",
    }
    router.push(routes[tab] ?? "/")
    setMobileMenuOpen(false)
  }

  const voiceLibrary = [
    { name: "James", type: "Male Adult", language: "English (US)", accent: "American" },
    { name: "Sophia", type: "Female Adult", language: "English (UK)", accent: "British" },
    { name: "Carlos", type: "Male Adult", language: "Spanish", accent: "Castilian" },
    { name: "Maria", type: "Female Adult", language: "Spanish", accent: "Mexican" },
    { name: "Yuki", type: "Female Adult", language: "Japanese", accent: "Tokyo" },
    { name: "Hans", type: "Male Adult", language: "German", accent: "Standard" },
    { name: "Pierre", type: "Male Adult", language: "French", accent: "Parisian" },
    { name: "Mei", type: "Female Adult", language: "Chinese", accent: "Mandarin" },
    { name: "Timmy", type: "Male Child", language: "English (US)", accent: "American" },
    { name: "Emma", type: "Female Child", language: "English (UK)", accent: "British" },
    { name: "Raj", type: "Male Adult", language: "Hindi", accent: "Standard" },
    { name: "Fatima", type: "Female Adult", language: "Arabic", accent: "Modern Standard" },
  ]

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-[#A855F7]/30 bg-[#020817]/80 backdrop-blur-xl shadow-[0_0_20px_rgba(168,85,247,0.1)]">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-10 h-10 bg-gradient-to-br from-[#A855F7] to-[#22D3EE] rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(168,85,247,0.4)]">
              <Mic2 className="h-6 w-6 text-white" />
            </div>
            <span className="text-xl font-bold text-white">{tc('dubmaster')}</span>
          </Link>

          <nav className="hidden items-center gap-6 md:flex">
            <button
              onClick={() => handleNavClick("dashboard")}
              className={`text-sm font-medium transition-colors ${activeTab === "upload" ? "text-[#C084FC]" : "text-[#94A3B8] hover:text-[#C084FC]"}`}
            >
              {t('dashboard')}
            </button>
            <button
              onClick={() => handleNavClick("studio")}
              className={`text-sm font-medium transition-colors ${activeTab === "studio" ? "text-[#C084FC]" : "text-[#94A3B8] hover:text-[#C084FC]"}`}
            >
              Studio
            </button>
            <button
              onClick={() => handleNavClick("projects")}
              className={`text-sm font-medium transition-colors ${activeTab === "projects" ? "text-[#C084FC]" : "text-[#94A3B8] hover:text-[#C084FC]"}`}
            >
              {t('myProjects')}
            </button>

            <button
              onClick={() => handleNavClick("collaborate")}
              className={`text-sm font-medium transition-colors flex items-center gap-1 ${activeTab === "collaborate" ? "text-[#C084FC]" : "text-[#94A3B8] hover:text-[#C084FC]"}`}
            >
              <Users className="h-4 w-4" />
              {t('collaborate')}
            </button>

            <button
              onClick={() => setVoiceLibraryOpen(true)}
              className="text-sm font-medium text-[#94A3B8] transition-colors hover:text-[#C084FC]"
            >
              {t('voiceLibrary')}
            </button>
            {canAccessEditor && (
              <Link
                href="/editor"
                className="text-sm font-medium flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#A855F7]/10 border border-[#A855F7]/30 text-[#C084FC] hover:bg-[#A855F7]/20 hover:border-[#A855F7]/60 transition-all duration-200"
              >
                <Clapperboard className="h-3.5 w-3.5" />
                {t('editor')}
              </Link>
            )}

          </nav>

          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button variant="ghost" size="icon" className="hidden md:flex text-[#94A3B8] hover:text-[#C084FC] hover:bg-[#A855F7]/10">
              <Bell className="h-5 w-5" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="hidden md:flex w-9 h-9 rounded-full bg-gradient-to-br from-[#A855F7] to-[#22D3EE] text-white font-bold text-sm hover:opacity-90 hover:bg-none">
                  {userEmail ? userInitials : <User className="h-5 w-5" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-[#0F172A] border-[#A855F7]/30">
                <DropdownMenuLabel className="text-white">
                  <div className="flex flex-col gap-0.5">
                    <span>{t('myAccount')}</span>
                    {userEmail && <span className="text-xs font-normal text-[#64748B] truncate">{userEmail}</span>}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-[#A855F7]/20" />
                <DropdownMenuItem onClick={() => router.push("/profile")} className="cursor-pointer text-[#94A3B8] hover:text-[#C084FC] hover:bg-[#A855F7]/10">
                  <User className="mr-2 h-4 w-4" />
                  {t('profile')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push("/account")} className="cursor-pointer text-[#94A3B8] hover:text-[#C084FC] hover:bg-[#A855F7]/10">
                  <Settings className="mr-2 h-4 w-4" />
                  {t('settings')}
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-[#A855F7]/20" />
                <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-red-400 hover:text-red-300 hover:bg-red-500/10">
                  <LogOut className="mr-2 h-4 w-4" />
                  {t('signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="ghost" size="icon" className="md:hidden text-white hover:bg-[#A855F7]/10" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-[#A855F7]/30 bg-[#020817]/95 backdrop-blur-xl p-4 md:hidden">
            <nav className="flex flex-col gap-4">
              <button
                onClick={() => handleNavClick("dashboard")}
                className={`text-sm font-medium text-left ${activeTab === "upload" ? "text-[#C084FC]" : "text-[#94A3B8]"}`}
              >
                {t('dashboard')}
              </button>
              <button
                onClick={() => handleNavClick("studio")}
                className={`text-sm font-medium text-left ${activeTab === "studio" ? "text-[#C084FC]" : "text-[#94A3B8]"}`}
              >
                Studio
              </button>
              <button
                onClick={() => handleNavClick("projects")}
                className={`text-sm font-medium text-left ${activeTab === "projects" ? "text-[#C084FC]" : "text-[#94A3B8]"}`}
              >
                {t('myProjects')}
              </button>

              <button
                onClick={() => handleNavClick("collaborate")}
                className={`text-sm font-medium text-left flex items-center gap-2 ${activeTab === "collaborate" ? "text-[#C084FC]" : "text-[#94A3B8]"}`}
              >
                <Users className="h-4 w-4" />
                {t('collaborate')}
              </button>

              <div className="border-t border-[#A855F7]/20 pt-4 mt-2">
                <button
                  onClick={() => { setVoiceLibraryOpen(true); setMobileMenuOpen(false); }}
                  className="text-sm font-medium text-[#94A3B8] text-left"
                >
                  {t('voiceLibrary')}
                </button>
              </div>
              {canAccessEditor && (
                <Link
                  href="/editor"
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-sm font-medium flex items-center gap-2 px-3 py-2 rounded-lg bg-[#A855F7]/10 border border-[#A855F7]/30 text-[#C084FC]"
                >
                  <Clapperboard className="h-4 w-4" />
                  {t('editor')}
                </Link>
              )}

              <div className="border-t border-[#A855F7]/20 pt-4 mt-2">
                <button
                  onClick={() => { handleSignOut(); setMobileMenuOpen(false); }}
                  className="text-sm font-medium text-red-400 hover:text-red-300 text-left flex items-center gap-2"
                >
                  <LogOut className="h-4 w-4" />
                  {t('signOut')}
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* Voice Library Modal */}
      <Dialog open={voiceLibraryOpen} onOpenChange={setVoiceLibraryOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto bg-[#020817]/95 backdrop-blur-md border-[#A855F7]/30">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Mic2 className="h-5 w-5 text-[#A855F7]" />
              Voice Library
            </DialogTitle>
            <DialogDescription className="text-[#94A3B8]">
              Browse our collection of AI voices for dubbing. All voices support multiple emotions and speaking styles.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-4">
            {voiceLibrary.map((voice) => (
              <Card key={voice.name} className="bg-[#0F172A]/50 border-[#A855F7]/30 hover:border-[#A855F7] hover:shadow-[0_0_20px_rgba(168,85,247,0.3)] transition-all cursor-pointer">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base text-white">{voice.name}</CardTitle>
                  <CardDescription className="text-[#94A3B8]">{voice.type}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-[#94A3B8]">
                    <p>{voice.language}</p>
                    <p className="text-xs">{voice.accent} accent</p>
                  </div>
                  <Button variant="outline" size="sm" className="mt-3 w-full bg-transparent border-[#A855F7]/30 text-[#C084FC] hover:bg-[#A855F7]/10 hover:border-[#A855F7]">
                    Preview Voice
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Pricing Modal removed */}
    </>
  )
}
