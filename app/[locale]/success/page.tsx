"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Check, Mic2, Sparkles } from "lucide-react"
import Link from "next/link"
import { useT } from '@/lib/use-t'

export default function SuccessPage() {
  const t = useT()
  return (
    <Suspense>
      <SuccessContent />
    </Suspense>
  )
}

function SuccessContent() {
  const t = useT()
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("session_id")
  const isBonus = searchParams.get("bonus") === "true"
  const [plan, setPlan] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return

    if (isBonus) {
      // Bonus minutes: just display, no subscription to activate
      fetch(`/api/checkout-session?session_id=${sessionId}`)
        .then((r) => r.json())
        .then((data) => setPlan(data.plan_type))
        .catch(() => {})
      return
    }

    // Subscription checkout: activate in Supabase, then show plan name
    fetch("/api/activate-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    })
      .then((r) => r.json())
      .then((data) => setPlan(data.plan ?? data.plan_type ?? null))
      .catch(() => {
        // Fallback: at least show the plan name even if DB write failed
        fetch(`/api/checkout-session?session_id=${sessionId}`)
          .then((r) => r.json())
          .then((data) => setPlan(data.plan_type))
          .catch(() => {})
      })
  }, [sessionId])

  return (
    <div className="min-h-screen bg-[#020817] flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(168,85,247,0.15)_0%,_transparent_60%)]" />

      <Card className="w-full max-w-lg bg-[#020817]/80 border-[#A855F7]/30 relative backdrop-blur-sm text-center">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[#A855F7] via-[#22D3EE] to-[#A855F7]" />

        <CardHeader className="pt-12 pb-4">
          <div className="mx-auto w-16 h-16 bg-gradient-to-br from-[#A855F7] to-[#22D3EE] rounded-2xl flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(168,85,247,0.4)]">
            <Check className="h-8 w-8 text-white" />
          </div>
          <CardTitle className="text-3xl text-white">
            {isBonus ? t('Minutes Added!') : t('Welcome to DubMaster!')}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6 pb-12">
          {isBonus ? (
            <p className="text-[#94A3B8] text-lg">
              {t('Your bonus minutes have been added to your account. They never expire and carry over month-to-month.')}
            </p>
          ) : (
            <p className="text-[#94A3B8] text-lg">
              Your{" "}
              <span className="text-[#C084FC] font-semibold capitalize">{plan || "subscription"}</span>{" "}
              plan is now active.
            </p>
          )}

          <div className="bg-[#0F172A] rounded-xl p-6 border border-[#334155] space-y-3">
            <div className="flex items-center gap-3 text-[#E2E8F0]">
              <Sparkles className="h-5 w-5 text-[#A855F7]" />
              <span>{isBonus ? t('Your bonus minutes are ready to use') : t('Upload your first video and start dubbing')}</span>
            </div>
            <div className="flex items-center gap-3 text-[#E2E8F0]">
              <Mic2 className="h-5 w-5 text-[#22D3EE]" />
              <span>{t('AI will clone voices and dub in any language')}</span>
            </div>
            <div className="flex items-center gap-3 text-[#E2E8F0]">
              <Check className="h-5 w-5 text-[#10B981]" />
              <span>{t('Quality reports ensure professional results')}</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <Button
              className="flex-1 bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white font-semibold"
              onClick={() => { window.location.href = "/" }}
            >
              {t('Go to Studio')}
            </Button>
            <Button asChild variant="outline" className="flex-1 border-[#334155] text-[#E2E8F0] hover:bg-[#1E293B]">
              <Link href="/account">{t('View Account')}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
