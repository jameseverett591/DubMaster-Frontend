import { NextResponse } from "next/server"
import { getStripe } from "@/lib/stripe"

// One paid tier. `plan` is accepted for caller compatibility — anything other
// than "pro" is rejected, and the legacy tiers' STRIPE_PRICE_* vars are gone.
const PRICE_IDS: Record<string, string> = {
  month: process.env.STRIPE_PRICE_PRO_MONTHLY || "",
  year: process.env.STRIPE_PRICE_PRO_YEARLY || "",
}

export async function POST(request: Request) {
  try {
    const { plan, interval, user_id, email } = await request.json()

    if (!interval || !user_id || !email) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    if (plan && plan !== "pro") {
      return NextResponse.json({ error: `Unknown plan "${plan}" — only "pro" exists` }, { status: 400 })
    }

    const priceId = PRICE_IDS[interval]
    if (!priceId) {
      return NextResponse.json(
        { error: `No Stripe price configured for pro/${interval}. Set STRIPE_PRICE_PRO_* env vars.` },
        { status: 400 }
      )
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"

    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        user_id,
        plan_type: "pro",
        interval,
      },
      subscription_data: {
        metadata: {
          user_id,
          plan_type: "pro",
        },
      },
      success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/subscribe`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    console.error("Stripe checkout error:", err)
    const message = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
