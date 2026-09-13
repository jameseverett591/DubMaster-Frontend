"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Check, Mic2, Loader2, Wallet } from "lucide-react"
import Link from "next/link"

export default function SubscribePage() {
  return (
    <Suspense>
      <SubscribeContent />
    </Suspense>
  )
}

// One subscription + a prepaid wallet. Upload, transcribe, edit — all free.
// Only Make Movie renders are metered: Pro gets 30 min/month included, free
// gets 3; beyond that, wallet credit at $2.50/min.
const FREE_FEATURES = [
  "3 minutes of renders every month",
  "Full studio — every feature unlocked",
  "No card required",
]
const PRO_FEATURES = [
  "30 minutes of renders every month",
  "Full studio — every feature unlocked",
  "Wallet top-ups at $2.50/min when you need more",
]

function SubscribeContent() {
  const [yearly, setYearly] = useState(false)
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const [user, setUser] = useState<{ id: string; email: string } | null>(null)
  const [layoutReady, setLayoutReady] = useState(false)

  const router = useRouter()
  const searchParams = useSearchParams()
  const isUpgrade = searchParams.get("upgrade") === "true"

  const supabase = createClient()
  const tc = useTranslations('common')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser({ id: data.user.id, email: data.user.email! })
      }
    })
  }, [supabase.auth])

  useEffect(() => {
    const timer = setTimeout(() => setLayoutReady(true), 500)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (user && typeof window !== 'undefined') {
      const pendingPlan = sessionStorage.getItem('pendingPlan')
      if (pendingPlan) {
        try {
          const { planKey, isYearly } = JSON.parse(pendingPlan)
          sessionStorage.removeItem('pendingPlan')
          handleCheckout(planKey, isYearly)
        } catch (err) {
          console.error('Failed to parse pending plan:', err)
          sessionStorage.removeItem('pendingPlan')
        }
      }
    }
  }, [user])

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
          body: JSON.stringify({
            plan: planKey,
            interval: isYearly ? "year" : "month",
            user_id: user.id,
            email: user.email,
          }),
        }
      )

      const { url, error } = await res.json()
      if (error) throw new Error(error)
      if (url) window.location.href = url
    } catch (err) {
      console.error("Checkout error:", err)
      setLoadingPlan(null)
    }
  }

  const startFree = () => {
    router.push(user ? "/studio" : "/signin?redirect=/studio")
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
          {isUpgrade ? "Upgrade to Pro" : "The whole studio. One plan."}
        </h1>
        <p className="text-[#94A3B8] text-lg">
          Every feature for everyone — you only pay to render.
        </p>
      </div>

      {/* Pricing Cards — Free + Pro */}
      <div className="relative max-w-4xl mx-auto px-4 py-12" style={{ zIndex: 10 }}>
        <div className="grid md:grid-cols-2 gap-6 items-stretch" style={{ isolation: 'isolate' }}>

          {/* Free */}
          <div className="relative" style={{ zIndex: 1 }}>
            <Card className="bg-[#020817]/80 relative overflow-hidden transition-all duration-300 hover:-translate-y-2 h-full flex flex-col"
              style={{ borderColor: "#22D3EE4D" }}>
              <div className="absolute top-0 left-0 right-0 h-0.5"
                style={{ background: "linear-gradient(90deg, #22D3EE, #06B6D4, #22D3EE)", backgroundSize: "200% 100%", animation: "gradientFlow 3s linear infinite" }} />
              <CardHeader className="pt-8">
                <CardTitle className="text-2xl text-white">Free</CardTitle>
                <div className="mt-4 min-h-[100px]">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold" style={{ color: "#22D3EE" }}>$0</span>
                    <span className="text-[#94A3B8] text-lg">/forever</span>
                  </div>
                </div>
                <CardDescription className="mt-2 text-[#94A3B8]">
                  For trying the studio and short clips.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 flex-1 flex flex-col">
                <div className="flex-1 space-y-3">
                  {FREE_FEATURES.map((f, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "#22D3EE" }} />
                      <span className="text-[#E2E8F0] text-sm">{f}</span>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={startFree}
                  className="w-full mt-6 font-semibold cursor-pointer bg-gradient-to-r from-[#22D3EE] to-[#06B6D4] text-black"
                >
                  Start dubbing
                </Button>
              </CardContent>
            </Card>
            <p className="text-center text-xs text-[#94A3B8] mt-3">3 min/month included, forever.</p>
          </div>

          {/* Pro */}
          <div className="relative" style={{ zIndex: 50, position: 'relative',
            ...(layoutReady && { marginTop: '-12px', marginBottom: '12px', paddingLeft: '4px', paddingRight: '4px' }) }}>
            {layoutReady && (
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                <Badge className="bg-gradient-to-r from-[#A855F7] to-[#7C3AED] text-white font-bold px-4 py-1 text-sm shadow-[0_0_20px_rgba(168,85,247,0.4)]">
                  PRO
                </Badge>
              </div>
            )}
            <Card className="bg-[#020817]/80 relative overflow-hidden transition-all duration-300 hover:-translate-y-2 h-full flex flex-col"
              style={{ borderColor: "#A855F780", boxShadow: "0 0 30px #A855F715" }}>
              <div className="absolute top-0 left-0 right-0 h-0.5"
                style={{ background: "linear-gradient(90deg, #A855F7, #7C3AED, #A855F7)", backgroundSize: "200% 100%", animation: "gradientFlow 3s linear infinite" }} />
              <CardHeader className="pt-10">
                <CardTitle className="text-2xl text-white">Pro</CardTitle>
                <div className="mt-4 min-h-[100px]">
                  <div className="flex items-center gap-2.5 mb-3">
                    <span className={`text-xs font-medium transition-colors duration-300 ${!yearly ? "text-white" : "text-[#64748B]"}`}>Monthly</span>
                    <button
                      onClick={() => setYearly(v => !v)}
                      className="relative w-10 h-5 rounded-full transition-all duration-300 cursor-pointer"
                      style={{ background: yearly ? "#A855F7" : "#334155", boxShadow: yearly ? "0 0 10px #A855F740" : "none" }}
                    >
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-300 shadow-sm ${yearly ? "translate-x-5" : "translate-x-0"}`} />
                    </button>
                    <span className={`text-xs font-medium transition-colors duration-300 ${yearly ? "text-white" : "text-[#64748B]"}`}>Yearly</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold" style={{ color: "#A855F7" }}>
                      ${yearly ? "470" : "49"}
                    </span>
                    <span className="text-[#94A3B8] text-lg">/{yearly ? "year" : "month"}</span>
                  </div>
                  {yearly ? (
                    <p className="text-[#10B981] text-sm mt-1 font-medium">Save $118/year</p>
                  ) : (
                    <p className="text-[#94A3B8] text-xs mt-1">Switch to yearly, save $118</p>
                  )}
                </div>
                <CardDescription className="mt-2 text-[#94A3B8]">
                  For working directors and regular dubbing.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 flex-1 flex flex-col">
                <div className="flex-1 space-y-3">
                  {PRO_FEATURES.map((f, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "#A855F7" }} />
                      <span className="text-[#E2E8F0] text-sm">{f}</span>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={() => handleCheckout('pro', yearly)}
                  disabled={loadingPlan !== null}
                  className="w-full mt-6 font-semibold cursor-pointer transition-all duration-300 bg-gradient-to-r from-[#A855F7] to-[#7C3AED] text-white shadow-[0_0_20px_rgba(168,85,247,0.3)] disabled:opacity-50"
                >
                  {loadingPlan === 'pro' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {loadingPlan === 'pro' ? "Redirecting…" : "Get Pro"}
                </Button>
              </CardContent>
            </Card>
            <p className="text-center text-xs text-[#94A3B8] mt-3">30 min/month included. Cancel anytime.</p>
          </div>
        </div>

        {/* Wallet strip — pay-as-you-go, for anyone */}
        <div className="mt-8">
          <Card className="bg-[#020817]/80 relative overflow-hidden"
            style={{ borderColor: "#FDB0224D" }}>
            <div className="absolute top-0 left-0 right-0 h-0.5"
              style={{ background: "linear-gradient(90deg, #FDB022, #F59E0B, #FDB022)", backgroundSize: "200% 100%", animation: "gradientFlow 3s linear infinite" }} />
            <CardContent className="flex flex-col md:flex-row items-center gap-4 p-6">
              <div className="flex items-center gap-3 flex-1">
                <Wallet className="h-8 w-8" style={{ color: "#FDB022" }} />
                <div>
                  <p className="text-white font-semibold">Pay as you go</p>
                  <p className="text-[#94A3B8] text-sm">
                    Top up render minutes at $2.50/min — $10 minimum, credit never expires.
                  </p>
                </div>
              </div>
              <Button
                onClick={() => handleCheckout('wallet', false)}
                disabled={loadingPlan !== null}
                className="font-semibold cursor-pointer bg-gradient-to-r from-[#FDB022] to-[#F59E0B] text-black disabled:opacity-50"
              >
                {loadingPlan === 'wallet' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {loadingPlan === 'wallet' ? "Redirecting…" : "Add credit"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <p className="text-center text-sm text-[#94A3B8] mt-12">
          Upload, transcribe, translate and edit for free — only Make Movie renders are metered.
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
