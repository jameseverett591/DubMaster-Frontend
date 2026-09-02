"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { createClient, clearCorruptedAuthCookies } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Mic2, Mail, Lock, Github } from "lucide-react"
import Link from "next/link"
import { useT } from '@/lib/use-t'

export default function SignInPage() {
  return (
    <Suspense>
      <SignInContent />
    </Suspense>
  )
}

function SignInContent() {
  const tUi = useT()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)
  const [showReset, setShowReset] = useState(false)

  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get("redirect") || "/studio"

  const supabase = createClient()
  const t = useTranslations('auth')
  const tc = useTranslations('common')
  const tn = useTranslations('nav')

  // Clear corrupted auth cookies that cause "Unexpected end of JSON input"
  useEffect(() => {
    supabase.auth.getSession().catch(() => {
      clearCorruptedAuthCookies()
      // Only reload once to avoid infinite loop
      if (!sessionStorage.getItem("auth-cookie-cleared")) {
        sessionStorage.setItem("auth-cookie-cleared", "1")
        window.location.reload()
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push(redirect)
      router.refresh()
    }
  }

  const handleOAuth = async (provider: "google" | "github") => {
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirect)}`,
      },
    })
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) {
      setError(t('enterEmailFirst'))
      return
    }
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })

    if (error) {
      setError(error.message)
    } else {
      setResetSent(true)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#020817] flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(168,85,247,0.15)_0%,_transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(34,211,238,0.1)_0%,_transparent_50%)]" />

      <Card className="w-full max-w-md bg-[#020817]/80 border-[#A855F7]/30 relative backdrop-blur-sm">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[#A855F7] via-[#22D3EE] to-[#A855F7]" />

        <CardHeader className="text-center pb-2">
          <Link href="/" className="inline-flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 bg-gradient-to-br from-[#A855F7] to-[#22D3EE] rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(168,85,247,0.4)]">
              <Mic2 className="h-6 w-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-white">{tc('dubmaster')}</span>
          </Link>
          <CardTitle className="text-xl text-white">
            {showReset ? t('resetPassword') : t('welcomeBack')}
          </CardTitle>
          <CardDescription className="text-[#94A3B8]">
            {showReset
              ? t('enterEmailForReset')
              : t('signInToAccount')}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {!showReset && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  onClick={() => handleOAuth("google")}
                  className="bg-transparent border-[#334155] text-[#E2E8F0] hover:bg-[#1E293B] hover:text-white cursor-pointer"
                >
                  <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  {t('signInGoogle')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleOAuth("github")}
                  className="bg-transparent border-[#334155] text-[#E2E8F0] hover:bg-[#1E293B] hover:text-white cursor-pointer"
                >
                  <Github className="h-4 w-4 mr-2" />
                  {t('signInGithub')}
                </Button>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#334155]" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-[#020817] px-2 text-[#64748B]">{t('orContinueWith')}</span>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {resetSent ? (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-400 text-sm text-center">
              {t('resetLinkSent')} <strong>{email}</strong>. {t('checkInbox')}
            </div>
          ) : showReset ? (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email" className="text-[#94A3B8]">{t('email')}</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="pl-10 bg-[#0F172A] border-[#334155] text-white placeholder:text-[#475569] focus:border-[#A855F7] focus:ring-[#A855F7]/20"
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                {loading ? t('sending') : t('sendResetLink')}
              </Button>
              <button
                type="button"
                onClick={() => { setShowReset(false); setError(null) }}
                className="w-full text-sm text-[#C084FC] hover:text-[#A855F7] cursor-pointer"
              >
                {t('backToSignIn')}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[#94A3B8]">{t('email')}</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="pl-10 bg-[#0F172A] border-[#334155] text-white placeholder:text-[#475569] focus:border-[#A855F7] focus:ring-[#A855F7]/20"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-[#94A3B8]">{t('password')}</Label>
                  <button
                    type="button"
                    onClick={() => { setShowReset(true); setError(null) }}
                    className="text-xs text-[#C084FC] hover:text-[#A855F7] cursor-pointer"
                  >
                    {t('forgotPassword')}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
                  <Input
                    id="password"
                    type="password"
                    placeholder={tUi('Your password')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pl-10 bg-[#0F172A] border-[#334155] text-white placeholder:text-[#475569] focus:border-[#A855F7] focus:ring-[#A855F7]/20"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white font-semibold hover:opacity-90 cursor-pointer disabled:opacity-50"
              >
                {loading ? t('signingIn') : tn('signIn')}
              </Button>
            </form>
          )}

          <p className="text-center text-sm text-[#64748B]">
            {t('dontHaveAccount')}{" "}
            <Link href="/signup" className="text-[#C084FC] hover:text-[#A855F7] underline underline-offset-2">
              {tn('signUp')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
