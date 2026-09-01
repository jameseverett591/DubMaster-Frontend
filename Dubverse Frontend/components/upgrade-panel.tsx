"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Check, Loader2 } from "lucide-react"
import { useT } from '@/lib/use-t'

export function UpgradePanel() {
  const t = useT()
  const [yearlyTiers, setYearlyTiers] = useState<Record<string, boolean>>({})
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const [user, setUser] = useState<{ id: string; email: string } | null>(null)
  const [layoutReady, setLayoutReady] = useState(false)
  const router = useRouter()
  const tp = useTranslations('pricing')

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
      includedFrom: undefined as string | undefined,
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
      monthlyPrice: 149,
      yearlyPrice: 1430,
      yearlySavings: 358,
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
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) setUser({ id: data.user.id, email: data.user.email! })
    })
    const t = setTimeout(() => setLayoutReady(true), 300)
    return () => clearTimeout(t)
  }, [])

  const isYearlyFor = (key: string) => yearlyTiers[key] ?? false
  const toggleYearly = (key: string) => setYearlyTiers(prev => ({ ...prev, [key]: !prev[key] }))

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
        body: JSON.stringify({ plan: planKey, interval: isYearly ? "year" : "month", user_id: user.id, email: user.email }),
      })
      const { url, error } = await res.json()
      if (error) throw new Error(error)
      if (url) window.location.href = url
    } catch {
      setLoadingPlan(null)
    }
  }

  return (
    <div className="py-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">{t('Choose Your Plan')}</h2>
        <p className="text-slate-400">{t('Unlock more minutes, advanced editing, and professional tools.')}</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6 items-stretch" style={{ isolation: 'isolate' }}>
        {tiers.map(tier => {
          const isPremium = tier.popular
          const yearly = isYearlyFor(tier.key)
          return (
            <div
              key={isPremium ? `${tier.key}-${layoutReady}` : tier.key}
              className="relative"
              style={{
                zIndex: isPremium ? 50 : 1,
                ...(isPremium && layoutReady && { marginTop: '-12px', marginBottom: '12px', paddingLeft: '4px', paddingRight: '4px' }),
              }}
            >
              {isPremium && layoutReady && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                  <Badge className="bg-gradient-to-r from-[#FDB022] to-[#F59E0B] text-black font-bold px-4 py-1 text-sm shadow-[0_0_20px_rgba(253,176,34,0.4)]">
                    {t('Most Popular')}
                  </Badge>
                </div>
              )}

              <Card
                className="bg-[#020817]/80 relative overflow-hidden transition-all duration-300 hover:-translate-y-1 h-full flex flex-col"
                style={{ borderColor: `${tier.color}${isPremium ? "80" : "4D"}`, boxShadow: isPremium ? `0 0 30px ${tier.color}15` : undefined }}
              >
                <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: `linear-gradient(90deg, ${tier.color}, ${tier.colorAlt}, ${tier.color})` }} />

                <CardHeader className={isPremium ? "pt-10" : "pt-8"}>
                  <CardTitle className="text-2xl text-white">{tier.name}</CardTitle>
                  <div className="mt-4 min-h-[100px]">
                    <div className="flex items-center gap-2.5 mb-3">
                      <span className={`text-xs font-medium ${!yearly ? "text-white" : "text-slate-500"}`}>{t('Monthly')}</span>
                      <button
                        onClick={() => toggleYearly(tier.key)}
                        className="relative w-10 h-5 rounded-full transition-all duration-300"
                        style={{ background: yearly ? tier.color : "#334155" }}
                      >
                        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-300 shadow-sm ${yearly ? "translate-x-5" : "translate-x-0"}`} />
                      </button>
                      <span className={`text-xs font-medium ${yearly ? "text-white" : "text-slate-500"}`}>{t('Yearly')}</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold" style={{ color: tier.color }}>
                        ${yearly ? tier.yearlyPrice.toLocaleString() : tier.monthlyPrice.toLocaleString()}
                      </span>
                      <span className="text-slate-400 text-lg">/{yearly ? 'yr' : 'mo'}</span>
                    </div>
                    {yearly
                      ? <p className="text-emerald-400 text-sm mt-1 font-medium">Save ${tier.yearlySavings.toLocaleString()}/year</p>
                      : <p className="text-slate-500 text-xs mt-1">Switch to yearly — save ${tier.yearlySavings.toLocaleString()}</p>
                    }
                  </div>
                  <CardDescription className="mt-2 text-slate-400">For {tier.audience}</CardDescription>
                </CardHeader>

                <CardContent className="space-y-3 flex-1 flex flex-col">
                  {tier.includedFrom && (
                    <p className="text-sm text-slate-400 italic mb-1">Everything in {tier.includedFrom}, plus:</p>
                  )}
                  <div className="flex-1 space-y-2.5">
                    {tier.features.map((feature, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: tier.color }} />
                        <span className="text-slate-200 text-sm">{feature}</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    onClick={() => handleSubscribe(tier.key, yearly)}
                    disabled={loadingPlan !== null}
                    className={`w-full mt-6 font-semibold transition-all duration-300 ${
                      isPremium
                        ? "bg-gradient-to-r from-[#A855F7] to-[#7C3AED] text-white shadow-[0_0_20px_rgba(168,85,247,0.3)]"
                        : tier.key === "professional"
                          ? "bg-gradient-to-r from-[#FDB022] to-[#F59E0B] text-black"
                          : "bg-gradient-to-r from-[#22D3EE] to-[#06B6D4] text-black"
                    } disabled:opacity-50`}
                  >
                    {loadingPlan === tier.key && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    {loadingPlan === tier.key ? 'Redirecting…' : tier.cta}
                  </Button>
                </CardContent>
              </Card>
              <p className="text-center text-xs text-slate-500 mt-3">{tier.tagline}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
