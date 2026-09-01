"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { usePlan } from "@/lib/use-plan"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Bell, Settings, User, Menu, X, Mic2, Check, Users, LogOut, Clapperboard } from "lucide-react"
import Link from "next/link"
import { LanguageSwitcher } from "@/components/language-switcher"
import { VoiceLibraryModal } from "@/components/voice-library-modal"

import type { EditorMode } from "@/components/dashboard"
import { useT } from '@/lib/use-t'

interface HeaderProps {
  activeTab?: string
  onNavigate?: (tab: string) => void
  editorMode?: EditorMode
  onEditorModeChange?: (mode: EditorMode) => void
}

export function Header({ activeTab = "upload", onNavigate, editorMode = "automatic", onEditorModeChange }: HeaderProps) {
  const tUi = useT()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [voiceLibraryOpen, setVoiceLibraryOpen] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()
  const t = useTranslations('nav')
  const tc = useTranslations('common')
  const { hasFeature } = usePlan()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return
      setUserEmail(data.user.email ?? null)
    })
  }, [])

  const canAccessEditor = hasFeature('editor')

  const userInitials = userEmail ? userEmail.slice(0, 2).toUpperCase() : "?"

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/signin")
    router.refresh()
  }

  const handleNavClick = (tab: string) => {
    const routes: Record<string, string> = {
      dashboard: "/dashboard",
      projects: "/studio?tab=projects",
      collaborate: "/collaborate",
      studio: "/studio",
    }
    router.push(routes[tab] ?? "/")
    setMobileMenuOpen(false)
  }

  // Voice catalog now lives in <VoiceLibraryModal/> — it fetches Fish Audio's
  // real library via /api/voices with pagination + filters + favorites.

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
              className={`text-sm font-medium transition-colors ${activeTab === "dashboard" ? "text-[#C084FC]" : "text-[#94A3B8] hover:text-[#C084FC]"}`}
            >
              {t('dashboard')}
            </button>
            <button
              onClick={() => handleNavClick("studio")}
              className={`text-sm font-medium transition-colors ${activeTab === "studio" || activeTab === "upload" ? "text-[#C084FC]" : "text-[#94A3B8] hover:text-[#C084FC]"}`}
            >
              {tUi('Studio')}
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

            {hasFeature('voiceLibrary') && (
              <button
                onClick={() => setVoiceLibraryOpen(true)}
                className="text-sm font-medium text-[#94A3B8] transition-colors hover:text-[#C084FC]"
              >
                {t('voiceLibrary')}
              </button>
            )}
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
                className={`text-sm font-medium text-left ${activeTab === "dashboard" ? "text-[#C084FC]" : "text-[#94A3B8]"}`}
              >
                {t('dashboard')}
              </button>
              <button
                onClick={() => handleNavClick("studio")}
                className={`text-sm font-medium text-left ${activeTab === "studio" || activeTab === "upload" ? "text-[#C084FC]" : "text-[#94A3B8]"}`}
              >
                {tUi('Studio')}
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

              {hasFeature('voiceLibrary') && (
                <div className="border-t border-[#A855F7]/20 pt-4 mt-2">
                  <button
                    onClick={() => { setVoiceLibraryOpen(true); setMobileMenuOpen(false); }}
                    className="text-sm font-medium text-[#94A3B8] text-left"
                  >
                    {t('voiceLibrary')}
                  </button>
                </div>
              )}
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

      {/* Voice Library Modal — fetches Fish Audio's real catalog with paginated browse */}
      <VoiceLibraryModal open={voiceLibraryOpen} onOpenChange={setVoiceLibraryOpen} />
    </>
  )
}
