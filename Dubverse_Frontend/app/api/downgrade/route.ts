import { NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { stripe } from "@/lib/stripe"
import { createServiceClient } from "@/lib/supabase/server"

// Downgrade to Free: cancel the caller's own active subscription at Stripe and
// mark the subscriptions row canceled. Immediate — not at period end — because
// the flow is the user's explicit plan pick, and tier_for() only reads
// status (the webhook's customer.subscription.deleted handler writes the same
// status, so this is belt-and-braces for when webhooks lag or aren't wired).
export async function POST() {
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

    const { data: sub, error: lookupError } = await supabase
      .from("subscriptions")
      .select("id, stripe_subscription_id")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing"])
      .limit(1)
      .maybeSingle()

    if (lookupError) {
      console.error("[DOWNGRADE] subscriptions lookup failed:", lookupError)
      return NextResponse.json({ error: "Could not check subscription" }, { status: 500 })
    }

    if (!sub) {
      return NextResponse.json({ ok: true, downgraded: false })
    }

    if (sub.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(sub.stripe_subscription_id)
      } catch (stripeErr) {
        const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr)
        // A sub Stripe no longer knows (deleted/expired upstream) can't be
        // billed again — safe to mark the row canceled below.
        if (!/No such subscription/i.test(msg)) {
          console.error("[DOWNGRADE] Stripe cancel failed:", msg)
          return NextResponse.json({ error: msg }, { status: 502 })
        }
      }
    }

    const service = await createServiceClient()
    // Cancel only the row whose Stripe subscription was actually canceled (or
    // confirmed gone) above — a blanket user update would mark other active
    // subscriptions canceled while Stripe keeps billing them.
    const { error: updateError } = await service
      .from("subscriptions")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("id", sub.id)
      .in("status", ["active", "trialing"])

    if (updateError) {
      console.error("[DOWNGRADE] subscriptions update failed:", updateError)
      return NextResponse.json({ error: "Downgrade failed" }, { status: 500 })
    }

    return NextResponse.json({ ok: true, downgraded: true })
  } catch (err: unknown) {
    console.error("[DOWNGRADE] error:", err)
    const message = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
