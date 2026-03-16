"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Check, Mic2, Loader2 } from "lucide-react"
import Link from "next/link"

export default function SubscribePage() {
  return (
    <Suspense>
      <SubscribeContent />
    </Suspense>
  )
}

function SubscribeContent() {
  const [yearlyTiers, setYearlyTiers] = useState<Record<string, boolean>>({})
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const [user, setUser] = useState<{ id: string; email: string } | null>(null)
  const [layoutReady, setLayoutReady] = useState(false)

  const router = useRouter()
  const searchParams = useSearchParams()
  const isUpgrade = searchParams.get("upgrade") === "true"

  const supabase = createClient()
  const tp = useTranslations('pricing')
  const tc = useTranslations('common')

  const tiers = [
    {
      key: "basic" as const,
      name: tp('basic.name'),
      tagline: tp('basic.tagline'),
      audience: tp('basic.audience'),
      monthlyPrice: 20,
      yearlyPrice: 192,
      yearlySavings: 48,
      color: "#22D3EE",
      colorAlt: "#06B6D4",
      features: [
        tp('basic.features.minutes'),
        tp('basic.features.voiceCloning'),
        tp('basic.features.autoDubbing'),
        tp('basic.features.languages'),
        tp('basic.features.qc'),
        tp('basic.features.turnaround'),
        tp('basic.features.downloadRights'),
        tp('basic.features.support'),
      ],
      cta: tp('basic.cta'),
      popular: false,
    },
    {
      key: "premium" as const,
      name: tp('premium.name'),
      tagline: tp('premium.tagline'),
      audience: tp('premium.audience'),
      monthlyPrice: 49,
      yearlyPrice: 470,
      yearlySavings: 118,
      color: "#A855F7",
      colorAlt: "#7C3AED",
      features: [
        tp('premium.features.minutes'),
        tp('premium.features.editor'),
        tp('premium.features.qc'),
        tp('premium.features.turnaround'),
        tp('premium.features.voiceRefinement'),
        tp('premium.features.emotion'),
        tp('premium.features.prioritySupport'),
        tp('premium.features.rollover'),
      ],
      includedFrom: tp('basic.name'),
      cta: tp('premium.cta'),
      popular: true,
    },
    {
      key: "professional" as const,
      name: tp('professional.name'),
      tagline: tp('professional.tagline'),
      audience: tp('professional.audience'),
      monthlyPrice: 1400,
      yearlyPrice: 13440,
      yearlySavings: 3360,
      color: "#FDB022",
      colorAlt: "#F59E0B",
      features: [
        tp('professional.features.unlimited'),
        tp('professional.features.allFeatures'),
        tp('professional.features.editor'),
        tp('professional.features.revisions'),
        tp('professional.features.manager'),
        tp('professional.features.whiteLabel'),
        tp('professional.features.api'),
        tp('professional.features.workflows'),
        tp('professional.features.sla'),
        tp('professional.features.humanQc'),
        tp('professional.features.theatrical'),
        tp('professional.features.turnaround'),
      ],
      includedFrom: tp('premium.name'),
      cta: tp('professional.cta'),
      popular: false,
    },
  ]

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser({ id: data.user.id, email: data.user.email! })
      }
    })
  }, [supabase.auth])

  useEffect(() => {
    const timer = setTimeout(() => {
      setLayoutReady(true)
    }, 500)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (user && typeof window !== 'undefined') {
      const pendingPlan = sessionStorage.getItem('pendingPlan')
      if (pendingPlan) {
        try {
          const { planKey, isYearly } = JSON.parse(pendingPlan)
          sessionStorage.removeItem('pendingPlan')
          handleSubscribe(planKey, isYearly)
        } catch (err) {
          console.error('Failed to parse pending plan:', err)
          sessionStorage.removeItem('pendingPlan')
        }
      }
    }
  }, [user])

  const isYearlyFor = (name: string) => yearlyTiers[name] ?? false
  const toggleYearly = (name: string) =>
    setYearlyTiers((prev) => ({ ...prev, [name]: !prev[name] }))

  const handleSubscribe = async (planKey: string, isYearly: boolean) => {
    if (!user) {
      sessionStorage.setItem('pendingPlan', JSON.stringify({ planKey, isYearly }))
      router.push("/signin?redirect=/subscribe")
      return
    }

    setLoadingPlan(planKey)

    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: planKey,
          interval: isYearly ? "year" : "month",
          user_id: user.id,
          email: user.email,
        }),
      })

      const { url, error } = await res.json()
      if (error) throw new Error(error)
      if (url) window.location.href = url
    } catch (err) {
      console.error("Checkout error:", err)
      setLoadingPlan(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#020817] relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(168,85,247,0.12)_0%,_transparent_50%)] pointer-events-none" />

      {/* Header */}
      <div className="relative z-10 pt-8 pb-4 text-center">
        <Link href="/" className="inline-flex items-center gap-2 mb-8">
          <div className="w-8 h-8 bg-gradient-to-br from-[#A855F7] to-[#22D3EE] rounded-lg flex items-center justify-center">
            <Mic2 className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold text-white">{tc('dubmaster')}</span>
        </Link>
        <h1 className="text-3xl md:text-5xl font-bold text-white mb-3">
          {isUpgrade ? tp('upgradePlan') : tp('chooseYourPlan')}
        </h1>
        <p className="text-[#94A3B8] text-lg">
          {isUpgrade ? tp('unlockAdvanced') : tp('startDubbing')}
        </p>
      </div>

      {/* Pricing Cards */}
      <div className="relative max-w-6xl mx-auto px-4 py-12" style={{ zIndex: 10 }}>
        <div className="grid md:grid-cols-3 gap-6 items-stretch" style={{ isolation: 'isolate' }}>
          {tiers.map((tier) => {
            const isPremium = tier.popular
            const yearly = isYearlyFor(tier.key)

            return (
              <div
                key={isPremium ? `${tier.key}-${layoutReady}` : tier.key}
                className="relative"
                style={{
                  zIndex: isPremium ? 50 : 1,
                  pointerEvents: 'auto',
                  position: 'relative',
                  ...(isPremium && layoutReady && {
                    marginTop: '-12px',
                    marginBottom: '12px',
                    paddingLeft: '4px',
                    paddingRight: '4px',
                  }),
                }}
              >
                {isPremium && layoutReady && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                    <Badge className="bg-gradient-to-r from-[#FDB022] to-[#F59E0B] text-black font-bold px-4 py-1 text-sm shadow-[0_0_20px_rgba(253,176,34,0.4)]">
                      {tp('mostPopular')}
                    </Badge>
                  </div>
                )}

                <Card
                  className="bg-[#020817]/80 relative overflow-hidden transition-all duration-300 hover:-translate-y-2 h-full flex flex-col"
                  style={{
                    borderColor: `${tier.color}${isPremium ? "80" : "4D"}`,
                    boxShadow: isPremium ? `0 0 30px ${tier.color}15` : undefined,
                    pointerEvents: 'auto',
                    position: 'relative',
                    zIndex: 1,
                  }}
                >
                  <div
                    className="absolute top-0 left-0 right-0 h-0.5"
                    style={{
                      background: `linear-gradient(90deg, ${tier.color}, ${tier.colorAlt}, ${tier.color})`,
                      backgroundSize: "200% 100%",
                      animation: "gradientFlow 3s linear infinite",
                    }}
                  />

                  <CardHeader className={isPremium ? "pt-10" : "pt-8"}>
                    <CardTitle className="text-2xl text-white">{tier.name}</CardTitle>

                    <div className="mt-4 min-h-[100px]">
                      <div className="flex items-center gap-2.5 mb-3">
                        <span className={`text-xs font-medium transition-colors duration-300 ${!yearly ? "text-white" : "text-[#64748B]"}`}>
                          {tp('monthly')}
                        </span>
                        <button
                          onClick={() => toggleYearly(tier.key)}
                          className="relative w-10 h-5 rounded-full transition-all duration-300 cursor-pointer"
                          style={{
                            background: yearly ? tier.color : "#334155",
                            boxShadow: yearly ? `0 0 10px ${tier.color}40` : "none",
                          }}
                        >
                          <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-300 shadow-sm ${yearly ? "translate-x-5" : "translate-x-0"}`} />
                        </button>
                        <span className={`text-xs font-medium transition-colors duration-300 ${yearly ? "text-white" : "text-[#64748B]"}`}>
                          {tp('yearly')}
                        </span>
                      </div>

                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-bold" style={{ color: tier.color }}>
                          ${yearly ? tier.yearlyPrice.toLocaleString() : tier.monthlyPrice.toLocaleString()}
                        </span>
                        <span className="text-[#94A3B8] text-lg">/{yearly ? tp('perYear') : tp('perMonth')}</span>
                      </div>

                      {yearly ? (
                        <p className="text-[#10B981] text-sm mt-1 font-medium">
                          {tp('savePerYear', { amount: tier.yearlySavings.toLocaleString() })}
                        </p>
                      ) : (
                        <p className="text-[#94A3B8] text-xs mt-1">
                          {tp('switchToYearly', { amount: tier.yearlySavings.toLocaleString() })}
                        </p>
                      )}
                    </div>

                    <CardDescription className="mt-2 text-[#94A3B8]">
                      {tp('forAudience', { audience: tier.audience })}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-3 flex-1 flex flex-col">
                    {tier.includedFrom && (
                      <p className="text-sm text-[#94A3B8] italic mb-1">
                        {tp('everythingIn', { plan: tier.includedFrom })}
                      </p>
                    )}

                    <div className="flex-1 space-y-3">
                      {tier.features.map((feature, i) => (
                        <div key={i} className="flex items-start gap-3">
                          <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: tier.color }} />
                          <span className="text-[#E2E8F0] text-sm">{feature}</span>
                        </div>
                      ))}
                    </div>

                    <Button
                      onClick={() => handleSubscribe(tier.key, yearly)}
                      disabled={loadingPlan !== null}
                      className={`w-full mt-6 font-semibold cursor-pointer transition-all duration-300 ${
                        isPremium
                          ? "bg-gradient-to-r from-[#A855F7] to-[#7C3AED] text-white shadow-[0_0_20px_rgba(168,85,247,0.3)]"
                          : tier.key === "professional"
                            ? "bg-gradient-to-r from-[#FDB022] to-[#F59E0B] text-black"
                            : "bg-gradient-to-r from-[#22D3EE] to-[#06B6D4] text-black"
                      } disabled:opacity-50`}
                      style={{
                        pointerEvents: loadingPlan !== null ? 'none' : 'auto',
                        position: 'relative',
                        zIndex: 10,
                        touchAction: 'manipulation',
                      }}
                    >
                      {loadingPlan === tier.key ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      {loadingPlan === tier.key ? tp('redirecting') : tier.cta}
                    </Button>
                  </CardContent>
                </Card>
                <p className="text-center text-xs text-[#94A3B8] mt-3">{tier.tagline}</p>
              </div>
            )
          })}
        </div>

        <p className="text-center text-sm text-[#94A3B8] mt-12">
          {tp('allPlansInclude')}
        </p>
      </div>

      <style jsx>{`
        @keyframes gradientFlow {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
      `}</style>
    </div>
  )
}
