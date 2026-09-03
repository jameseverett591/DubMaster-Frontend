"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Mic2, Mail, Lock, User, Github, Check, Loader2, Eye, EyeOff } from "lucide-react"
import Link from "next/link"
import { useT } from '@/lib/use-t'

export default function SignUpPage() {
  const tUi = useT()
  const [selectedPlan, setSelectedPlan] = useState<"basic" | "premium" | "professional">("basic")
  const [isYearly, setIsYearly] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const router = useRouter()
  const supabase = createClient()
  const t = useTranslations('auth')
  const tc = useTranslations('common')
  const tn = useTranslations('nav')
  const tp = useTranslations('pricing')
  const te = useTranslations('errors')

  const tiers = [
    {
      key: "basic" as const,
      name: tp('basic.name'),
      tagline: tp('basic.tagline'),
      monthlyPrice: 20,
      yearlyPrice: 192,
      yearlySavings: 48,
      color: "#22D3EE",
      features: [
        tp('basic.features.minutes'),
        tp('basic.features.voiceCloning'),
        tp('basic.features.autoDubbing'),
        tp('basic.features.languages'),
        tp('basic.features.qc'),
        tp('basic.features.turnaround'),
      ],
    },
    {
      key: "premium" as const,
      name: tp('premium.name'),
      tagline: tp('premium.taglineShort'),
      monthlyPrice: 49,
      yearlyPrice: 470,
      yearlySavings: 118,
      color: "#A855F7",
      features: [
        tp('premium.features.minutes'),
        tp('premium.features.editor'),
        tp('premium.features.qc'),
        tp('premium.features.turnaround'),
        tp('premium.features.emotion'),
        tp('premium.features.rollover'),
      ],
      popular: true,
    },
    {
      key: "professional" as const,
      name: tp('professional.name'),
      tagline: tp('professional.taglineShort'),
      monthlyPrice: 149,
      yearlyPrice: 1430,
      yearlySavings: 358,
      color: "#FDB022",
      features: [
        tp('professional.features.unlimited'),
        tp('professional.features.allFeatures'),
        tp('professional.features.revisions'),
        tp('professional.features.manager'),
        tp('professional.features.whiteLabel'),
        tp('professional.features.api'),
      ],
    },
  ]

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // Validate password confirmation
    if (password !== confirmPassword) {
      setError(te('passwordMismatch'))
      setLoading(false)
      return
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?plan=${selectedPlan}&interval=${isYearly ? 'year' : 'month'}`,
        data: { full_name: fullName },
      },
    })

    if (signUpError) {
      setError(signUpError.message)
      setLoading(false)
    } else if (data.user) {
      if (data.session) {
        // Email confirmation not required — go straight to checkout
        router.push(`/checkout?plan=${selectedPlan}&interval=${isYearly ? 'year' : 'month'}`)
      } else {
        // Email confirmation required — the email link includes plan/interval
        setSuccess(true)
        setLoading(false)
      }
    }
  }

  const handleOAuth = async (provider: "google" | "github") => {
    // Store selected plan before OAuth redirect
    sessionStorage.setItem('selectedPlan', JSON.stringify({
      planKey: selectedPlan,
      isYearly
    }))

    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?plan=${selectedPlan}&interval=${isYearly ? 'year' : 'month'}`,
      },
    })
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#020817] flex items-center justify-center px-4">
        <Card className="w-full max-w-md bg-[#020817]/80 border-[#A855F7]/30">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-gradient-to-br from-[#A855F7] to-[#22D3EE] rounded-xl flex items-center justify-center mb-4">
              <Mail className="h-6 w-6 text-white" />
            </div>
            <CardTitle className="text-2xl text-white">{t('checkEmail')}</CardTitle>
            <CardDescription className="text-[#94A3B8]"
              dangerouslySetInnerHTML={{ __html: t('confirmEmailMessage', { email, plan: tiers.find(tier => tier.key === selectedPlan)?.name ?? selectedPlan }) }}
            />
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#020817] py-8 px-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(168,85,247,0.15)_0%,_transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(34,211,238,0.1)_0%,_transparent_50%)]" />

      <div className="relative max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 bg-gradient-to-br from-[#A855F7] to-[#22D3EE] rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(168,85,247,0.4)]">
              <Mic2 className="h-6 w-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-white">{tc('dubmaster')}</span>
          </Link>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
            {t('choosePlanAndCreate')}
          </h1>
          <p className="text-[#94A3B8] text-lg">
            {t('selectPlanAndStart')}
          </p>
        </div>

        {/* Billing Toggle */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <span className={`text-sm font-medium transition-colors ${!isYearly ? "text-white" : "text-[#64748B]"}`}>
            {tp('monthly')}
          </span>
          <button
            onClick={() => setIsYearly(!isYearly)}
            className="relative w-12 h-6 rounded-full transition-all duration-300 bg-[#A855F7] shadow-[0_0_10px_rgba(168,85,247,0.4)]"
          >
            <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-300 ${isYearly ? "translate-x-6" : "translate-x-0"}`} />
          </button>
          <span className={`text-sm font-medium transition-colors ${isYearly ? "text-white" : "text-[#64748B]"}`}>
            {tp('yearly')} <span className="text-[#10B981]">({tp('saveUpTo')})</span>
          </span>
        </div>

        {/* Plan Selection Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {tiers.map((tier) => {
            const isSelected = selectedPlan === tier.key
            const isPremium = tier.popular

            return (
              <button
                key={tier.key}
                onClick={() => setSelectedPlan(tier.key)}
                className="relative text-left transition-all duration-300"
              >
                {isPremium && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="bg-gradient-to-r from-[#FDB022] to-[#F59E0B] text-black font-bold px-3 py-1 text-xs">
                      {tp('mostPopular')}
                    </Badge>
                  </div>
                )}

                <Card
                  className={`h-full transition-all duration-300 ${
                    isSelected
                      ? "border-2 shadow-[0_0_30px_rgba(168,85,247,0.4)] scale-105"
                      : "border hover:border-[#A855F7]/50"
                  }`}
                  style={{
                    borderColor: isSelected ? tier.color : "#334155",
                    backgroundColor: "#020817",
                  }}
                >
                  <div
                    className="absolute top-0 left-0 right-0 h-0.5"
                    style={{
                      background: `linear-gradient(90deg, ${tier.color}, ${tier.color}80, ${tier.color})`,
                    }}
                  />

                  <CardHeader className={isPremium ? "pt-8" : "pt-6"}>
                    <CardTitle className="text-xl text-white flex items-center justify-between">
                      {tier.name}
                      {isSelected && (
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: tier.color }}
                        >
                          <Check className="h-4 w-4 text-white" />
                        </div>
                      )}
                    </CardTitle>

                    <div className="mt-4">
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-bold" style={{ color: tier.color }}>
                          ${isYearly ? tier.yearlyPrice.toLocaleString() : tier.monthlyPrice.toLocaleString()}
                        </span>
                        <span className="text-[#94A3B8]">/{isYearly ? tp('perYear') : tp('perMonth')}</span>
                      </div>
                      {isYearly && (
                        <p className="text-[#10B981] text-sm mt-1 font-medium">
                          {tp('savePerYear', { amount: tier.yearlySavings.toLocaleString() })}
                        </p>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    <p className="text-[#94A3B8] text-sm italic mb-3">{tier.tagline}</p>
                    {tier.features.map((feature, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: tier.color }} />
                        <span className="text-[#E2E8F0] text-sm">{feature}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </button>
            )
          })}
        </div>

        {/* Sign Up Form */}
        <Card className="max-w-md mx-auto bg-[#020817]/80 border-[#A855F7]/30 backdrop-blur-sm">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[#A855F7] via-[#22D3EE] to-[#A855F7]" />

          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl text-white">{t('createAccount')}</CardTitle>
            <CardDescription className="text-[#94A3B8]">
              {t('youSelected')} <strong style={{ color: tiers.find(t => t.key === selectedPlan)?.color }}>
                {tiers.find(t => t.key === selectedPlan)?.name}
              </strong> ({isYearly ? tp('yearly') : tp('monthly')})
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* OAuth buttons */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={() => handleOAuth("google")}
                className="bg-transparent border-[#334155] text-[#E2E8F0] hover:bg-[#1E293B] hover:text-white cursor-pointer"
              >
                <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.10z" fill="#4285F4" />
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

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleSignUp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-[#94A3B8]">{t('fullName')}</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
                  <Input
                    id="name"
                    type="text"
                    placeholder={tUi('Ip Man')}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="pl-10 bg-[#0F172A] border-[#334155] text-white placeholder:text-[#475569] focus:border-[#A855F7] focus:ring-[#A855F7]/20"
                  />
                </div>
              </div>

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
                <Label htmlFor="password" className="text-[#94A3B8]">{t('password')}</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder={tUi('Min. 6 characters')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="pl-10 pr-10 bg-[#0F172A] border-[#334155] text-white placeholder:text-[#475569] focus:border-[#A855F7] focus:ring-[#A855F7]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#A855F7] transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-[#94A3B8]">{t('confirmPassword')}</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#64748B]" />
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder={tUi('Re-enter password')}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                    className="pl-10 pr-10 bg-[#0F172A] border-[#334155] text-white placeholder:text-[#475569] focus:border-[#A855F7] focus:ring-[#A855F7]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#A855F7] transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white font-semibold hover:opacity-90 cursor-pointer disabled:opacity-50"
                style={{
                  background: loading ? undefined : `linear-gradient(90deg, ${tiers.find(t => t.key === selectedPlan)?.color}, #22D3EE)`,
                }}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {t('creatingAccount')}
                  </>
                ) : (
                  t('createAccountAndStart', { plan: tiers.find(t => t.key === selectedPlan)?.name })
                )}
              </Button>
            </form>

            <p className="text-center text-sm text-[#64748B]">
              {t('alreadyHaveAccount')}{" "}
              <Link href="/signin" className="text-[#C084FC] hover:text-[#A855F7] underline underline-offset-2">
                {tn('signIn')}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
