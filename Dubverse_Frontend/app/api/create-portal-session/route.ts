import { NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { stripe } from "@/lib/stripe"

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {}
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { subscription_id } = body

    // Resolve the caller's Stripe customer from their own subscription row —
    // never trust a posted customer_id, it would let anyone open a portal
    // session (incl. cancellation) for any Stripe customer.
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .limit(1)
      .maybeSingle()

    if (!sub?.stripe_customer_id) {
      return NextResponse.json({ error: "No subscription found" }, { status: 404 })
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"

    // Deep-link straight to Stripe's cancel confirmation when the caller's
    // own subscription id is supplied; otherwise plain portal session.
    const cancelTarget =
      subscription_id && subscription_id === sub.stripe_subscription_id
        ? subscription_id
        : null

    let session
    try {
      session = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        return_url: `${siteUrl}/account`,
        ...(cancelTarget
          ? {
              flow_data: {
                type: "subscription_cancel" as const,
                subscription_cancel: { subscription: cancelTarget },
              },
            }
          : {}),
      })
    } catch (flowErr) {
      // Falls back to the plain portal if the portal configuration rejects the
      // cancel flow (e.g. cancellations disabled in Stripe portal settings).
      if (!cancelTarget) throw flowErr
      console.warn("Cancel flow rejected, falling back to plain portal:", flowErr)
      session = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        return_url: `${siteUrl}/account`,
      })
    }

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    console.error("Portal session error:", err)
    const message = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
