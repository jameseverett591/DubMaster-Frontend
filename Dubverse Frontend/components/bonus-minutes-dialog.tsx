"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Loader2, Clock, Sparkles, ArrowUpRight } from "lucide-react"
import Link from "next/link"

const BONUS_PACKS = [
  { minutes: 10, price: 5, priceId: "price_1T95pVRvIweJqT6RkIuvs57O" },
  { minutes: 20, price: 10, priceId: "price_1T95tORvIweJqT6Ril5wiPDa" },
  { minutes: 45, price: 20, priceId: "price_1T95uERvIweJqT6RdC9NBtQg", bestValue: true },
] as const

interface BonusMinutesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  planMinutesUsed: number
  planMinutesLimit: number
  bonusBalance: number
  planType?: string
}

export function BonusMinutesDialog({
  open,
  onOpenChange,
  planMinutesUsed,
  planMinutesLimit,
  bonusBalance,
  planType,
}: BonusMinutesDialogProps) {
  const [loadingPack, setLoadingPack] = useState<string | null>(null)
  const supabase = createClient()

  const handlePurchase = async (priceId: string) => {
    setLoadingPack(priceId)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        window.location.href = "/signin"
        return
      }

      const res = await fetch("/api/create-bonus-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price_id: priceId,
          user_id: user.id,
          email: user.email,
        }),
      })

      const { url, error } = await res.json()
      if (error) throw new Error(error)
      if (url) window.location.href = url
    } catch (err) {
      console.error("Bonus checkout error:", err)
      setLoadingPack(null)
    }
  }

  const planExhausted = planMinutesUsed >= planMinutesLimit && planMinutesLimit > 0
  const totalAvailable = Math.max(0, planMinutesLimit - planMinutesUsed) + bonusBalance

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-[#020817]/95 border-[#A855F7]/30 backdrop-blur-md">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[#A855F7] via-[#22D3EE] to-[#A855F7]" />

        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Clock className="h-5 w-5 text-[#A855F7]" />
            {planExhausted ? "Monthly Minutes Used Up" : "Purchase Bonus Minutes"}
          </DialogTitle>
          <DialogDescription className="text-[#94A3B8]">
            Bonus minutes never expire and carry over month-to-month.
          </DialogDescription>
        </DialogHeader>

        {/* Current usage status */}
        <div className="bg-[#0F172A] rounded-lg p-4 border border-[#1E293B] space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#94A3B8]">
              {planType ? `${planType.charAt(0).toUpperCase() + planType.slice(1)} Plan` : "Plan"}
            </span>
            <span className={`font-medium ${planExhausted ? "text-red-400" : "text-white"}`}>
              {planMinutesUsed} / {planMinutesLimit} minutes used
            </span>
          </div>
          {bonusBalance > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#94A3B8]">Bonus Minutes</span>
              <span className="text-[#22D3EE] font-medium">{bonusBalance} minutes banked</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm border-t border-[#1E293B] pt-2">
            <span className="text-[#94A3B8]">Total Available</span>
            <span className="text-white font-semibold">{totalAvailable} minutes remaining</span>
          </div>
        </div>

        {/* Bonus packs */}
        <div className="space-y-3">
          <p className="text-sm text-[#94A3B8] font-medium">Purchase additional minutes:</p>
          <div className="grid gap-3">
            {BONUS_PACKS.map((pack) => (
              <button
                key={pack.priceId}
                onClick={() => handlePurchase(pack.priceId)}
                disabled={loadingPack !== null}
                className={`relative flex items-center justify-between p-4 rounded-lg border transition-all cursor-pointer disabled:opacity-50 ${
                  pack.bestValue
                    ? "border-[#A855F7]/60 bg-[#A855F7]/10 hover:bg-[#A855F7]/20"
                    : "border-[#1E293B] bg-[#0F172A] hover:bg-[#1E293B]"
                }`}
              >
                {pack.bestValue && (
                  <Badge className="absolute -top-2 right-3 bg-gradient-to-r from-[#A855F7] to-[#7C3AED] text-white text-[10px] px-2 py-0.5">
                    <Sparkles className="h-3 w-3 mr-1" />
                    Best Value
                  </Badge>
                )}
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold ${
                    pack.bestValue
                      ? "bg-[#A855F7]/20 text-[#A855F7]"
                      : "bg-[#22D3EE]/10 text-[#22D3EE]"
                  }`}>
                    {pack.minutes}
                  </div>
                  <div className="text-left">
                    <p className="text-white font-medium">{pack.minutes} minutes</p>
                    <p className="text-[#64748B] text-xs">
                      ${(pack.price / pack.minutes).toFixed(2)}/min
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {loadingPack === pack.priceId ? (
                    <Loader2 className="h-4 w-4 text-[#A855F7] animate-spin" />
                  ) : (
                    <span className={`text-lg font-bold ${
                      pack.bestValue ? "text-[#A855F7]" : "text-white"
                    }`}>
                      ${pack.price}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Upgrade CTA */}
        {planType && planType !== "professional" && (
          <div className="text-center pt-2">
            <p className="text-[#64748B] text-xs mb-2">Or upgrade for more monthly minutes</p>
            <Button asChild variant="outline" size="sm" className="border-[#334155] text-[#E2E8F0] hover:bg-[#1E293B]">
              <Link href="/subscribe?upgrade=true">
                Upgrade Plan
                <ArrowUpRight className="h-3 w-3 ml-1" />
              </Link>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
