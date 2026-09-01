"use client"

import { useEffect, useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Mic2 } from "lucide-react"
import Link from "next/link"
import { useT } from '@/lib/use-t'

export default function CheckoutPage() {
  const t = useT()
  return (
    <Suspense>
      <CheckoutContent />
    </Suspense>
  )
}

function CheckoutContent() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    const createCheckoutSession = async () => {
      const plan = searchParams.get("plan")
      const interval = searchParams.get("interval")

      if (!plan || !interval) {
        setError("Missing plan or interval parameter")
        return
      }

      try {
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
          router.push("/signin")
          return
        }

        const res = await fetch("/api/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan,
            interval,
            user_id: user.id,
            email: user.email,
          }),
        })

        const { url, error: apiError } = await res.json()

        if (apiError) {
          setError(apiError)
          return
        }

        if (url) {
          window.location.href = url
        } else {
          setError("Failed to create checkout session")
        }
      } catch (err) {
        console.error("Checkout error:", err)
        setError("An unexpected error occurred")
      }
    }

    createCheckoutSession()
  }, [searchParams, router, supabase.auth])

  return (
    <div className="min-h-screen bg-[#020817] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(168,85,247,0.15)_0%,_transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(34,211,238,0.1)_0%,_transparent_50%)]" />

      <Card className="w-full max-w-md bg-[#020817]/80 border-[#A855F7]/30 relative backdrop-blur-sm">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-[#A855F7] via-[#22D3EE] to-[#A855F7]" />

        <CardHeader className="text-center">
          <Link href="/" className="inline-flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 bg-gradient-to-br from-[#A855F7] to-[#22D3EE] rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(168,85,247,0.4)]">
              <Mic2 className="h-6 w-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-white">DubMaster</span>
          </Link>

          {error ? (
            <>
              <CardTitle className="text-2xl text-white">{t('Oops! Something went wrong')}</CardTitle>
              <CardDescription className="text-red-400 mt-4">
                {error}
              </CardDescription>
              <div className="mt-6">
                <Link
                  href="/subscribe"
                  className="text-[#A855F7] hover:text-[#C084FC] underline underline-offset-2"
                >
                  {t('Try again')}
                </Link>
              </div>
            </>
          ) : (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-[#A855F7] mx-auto mb-4" />
              <CardTitle className="text-2xl text-white">{t('Redirecting to checkout...')}</CardTitle>
              <CardDescription className="text-[#94A3B8] mt-2">
                {t('Please wait while we prepare your payment page')}
              </CardDescription>
            </>
          )}
        </CardHeader>
      </Card>
    </div>
  )
}
