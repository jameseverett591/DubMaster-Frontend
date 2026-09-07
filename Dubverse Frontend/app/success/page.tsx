"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

type State = "activating" | "done" | "error"

export default function SuccessPage() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("session_id")

  const [state, setState] = useState<State>("activating")
  const [plan, setPlan] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setErrorMsg("No session ID found.")
      setState("error")
      return
    }

    fetch("/api/activate-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setErrorMsg(data.error)
          setState("error")
        } else {
          setPlan(data.plan)
          setState("done")
          // Hard reload so PlanProvider re-fetches the new plan from Supabase
          setTimeout(() => { window.location.href = "/" }, 3000)
        }
      })
      .catch((err) => {
        setErrorMsg(err.message)
        setState("error")
      })
  }, [sessionId])

  const planLabel =
    plan === "premium" ? "Premium" : plan === "professional" ? "Professional" : plan ?? "upgraded"

  return (
    <div className="min-h-screen bg-[#020817] flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl bg-gradient-to-br from-[#0F172A]/80 to-[#1E293B]/80 backdrop-blur-xl border border-[#A855F7]/30 shadow-[0_0_40px_rgba(168,85,247,0.15)] p-10 text-center">

        {state === "activating" && (
          <>
            <Loader2 className="h-12 w-12 text-[#A855F7] animate-spin mx-auto mb-4" />
            <h1 className="text-xl font-bold text-white mb-2">Activating your plan…</h1>
            <p className="text-sm text-[#64748B]">Just a moment while we set up your account.</p>
          </>
        )}

        {state === "done" && (
          <>
            <div className="relative inline-flex mb-6">
              <div className="absolute inset-0 rounded-full bg-green-500/20 blur-xl" />
              <CheckCircle2 className="relative h-16 w-16 text-green-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">You&apos;re on {planLabel}!</h1>
            <p className="text-sm text-[#94A3B8] mb-8">
              Your subscription is active. Redirecting you to DubMaster Studio…
            </p>
            <Button
              onClick={() => { window.location.href = "/" }}
              className="w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white font-semibold hover:opacity-90"
            >
              Go to Studio
            </Button>
          </>
        )}

        {state === "error" && (
          <>
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-white mb-2">Something went wrong</h1>
            <p className="text-sm text-[#94A3B8] mb-2">{errorMsg}</p>
            <p className="text-xs text-[#64748B] mb-8">
              Your payment may still have gone through — check your email or contact support.
            </p>
            <Button
              onClick={() => { window.location.href = "/" }}
              className="w-full bg-gradient-to-r from-[#A855F7] to-[#22D3EE] text-white font-semibold hover:opacity-90"
            >
              Back to Studio
            </Button>
          </>
        )}

      </div>
    </div>
  )
}
