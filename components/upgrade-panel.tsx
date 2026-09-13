"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Check, Loader2, Wallet } from "lucide-react"
import { useT } from '@/lib/use-t'

// Studio-tab pricing: one Pro tier + wallet top-up. Mirrors /subscribe — keep
// the copy and amounts in step with app/[locale]/subscribe/page.tsx.
const PRO_FEATURES = [
  "30 minutes of renders every month",
  "Full studio — every feature unlocked",
  "Wallet top-ups at $2.50/min when you need more",
]

export function UpgradePanel() {
  const t = useT()
  const [yearly, setYearly] = useState(false)
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const [user, setUser] = useState<{ id: string; email: string } | null>(null)
  const router = useRouter()

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) setUser({ id: data.user.id, email: data.user.email! })
    })
  }, [])

  const handleCheckout = async (planKey: 'pro' | 'wallet', isYearly: boolean) => {
    if (!user) {
      sessionStorage.setItem('pendingPlan', JSON.stringify({ planKey, isYearly }))
      router.push("/signin?redirect=/subscribe")
      return
    }
    setLoadingPlan(planKey)
    try {
      const res = await fetch(
        planKey === 'wallet' ? "/api/create-wallet-checkout" : "/api/create-checkout-session",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: planKey, interval: isYearly ? "year" : "month", user_id: user.id, email: user.email }),
        }
      )
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
        <h2 className="text-2xl font-bold text-white mb-2">{t('Upgrade to Pro')}</h2>
        <p className="text-slate-400">Every feature is already yours — Pro buys render minutes.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 items-stretch max-w-3xl mx-auto" style={{ isolation: 'isolate' }}>
        {/* Pro */}
        <div className="relative">
          <Card className="bg-[#020817]/80 relative overflow-hidden h-full flex flex-col"
            style={{ borderColor: "#A855F780", boxShadow: "0 0 30px #A855F715" }}>
            <div className="absolute top-0 left-0 right-0 h-0.5"
              style={{ background: "linear-gradient(90deg, #A855F7, #7C3AED, #A855F7)" }} />
            <CardHeader className="pt-8">
              <CardTitle className="text-2xl text-white flex items-center gap-2">
                Pro
                <Badge className="bg-gradient-to-r from-[#A855F7] to-[#7C3AED] text-white font-bold px-2 py-0.5 text-xs">$</Badge>
              </CardTitle>
              <div className="mt-4 min-h-[90px]">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className={`text-xs font-medium ${!yearly ? "text-white" : "text-slate-500"}`}>{t('Monthly')}</span>
                  <button
                    onClick={() => setYearly(v => !v)}
                    className="relative w-10 h-5 rounded-full transition-all duration-300"
                    style={{ background: yearly ? "#A855F7" : "#334155" }}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-300 shadow-sm ${yearly ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                  <span className={`text-xs font-medium ${yearly ? "text-white" : "text-slate-500"}`}>{t('Yearly')}</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold" style={{ color: "#A855F7" }}>
                    ${yearly ? "470" : "49"}
                  </span>
                  <span className="text-slate-400 text-lg">/{yearly ? 'yr' : 'mo'}</span>
                </div>
                {yearly
                  ? <p className="text-emerald-400 text-sm mt-1 font-medium">Save $118/year</p>
                  : <p className="text-slate-500 text-xs mt-1">Switch to yearly — save $118</p>
                }
              </div>
              <CardDescription className="mt-2 text-slate-400">For working directors and regular dubbing</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 flex-1 flex flex-col">
              <div className="flex-1 space-y-2.5">
                {PRO_FEATURES.map((feature, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "#A855F7" }} />
                    <span className="text-slate-200 text-sm">{feature}</span>
                  </div>
                ))}
              </div>
              <Button
                onClick={() => handleCheckout('pro', yearly)}
                disabled={loadingPlan !== null}
                className="w-full mt-6 font-semibold transition-all duration-300 bg-gradient-to-r from-[#A855F7] to-[#7C3AED] text-white shadow-[0_0_20px_rgba(168,85,247,0.3)] disabled:opacity-50"
              >
                {loadingPlan === 'pro' && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {loadingPlan === 'pro' ? 'Redirecting…' : 'Get Pro'}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Wallet */}
        <Card className="bg-[#020817]/80 relative overflow-hidden h-full flex flex-col"
          style={{ borderColor: "#FDB0224D" }}>
          <div className="absolute top-0 left-0 right-0 h-0.5"
            style={{ background: "linear-gradient(90deg, #FDB022, #F59E0B, #FDB022)" }} />
          <CardHeader className="pt-8">
            <CardTitle className="text-2xl text-white flex items-center gap-2">
              <Wallet className="h-5 w-5" style={{ color: "#FDB022" }} />
              Pay as you go
            </CardTitle>
            <div className="mt-4 min-h-[90px]">
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold" style={{ color: "#FDB022" }}>$2.50</span>
                <span className="text-slate-400 text-lg">/min</span>
              </div>
              <p className="text-slate-500 text-xs mt-1">$10 minimum · never expires</p>
            </div>
            <CardDescription className="mt-2 text-slate-400">For occasional renders without a subscription</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 flex-1 flex flex-col">
            <div className="flex-1 space-y-2.5">
              {[
                "Top up once, render whenever",
                "Credit never expires",
                "Used after any included minutes",
              ].map((f, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "#FDB022" }} />
                  <span className="text-slate-200 text-sm">{f}</span>
                </div>
              ))}
            </div>
            <Button
              onClick={() => handleCheckout('wallet', false)}
              disabled={loadingPlan !== null}
              className="w-full mt-6 font-semibold transition-all duration-300 bg-gradient-to-r from-[#FDB022] to-[#F59E0B] text-black disabled:opacity-50"
            >
              {loadingPlan === 'wallet' && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {loadingPlan === 'wallet' ? 'Redirecting…' : 'Add credit'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
