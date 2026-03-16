import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { BONUS_PACKS } from "@/lib/stripe"

export async function POST(request: Request) {
  try {
    const { price_id, user_id, email } = await request.json()

    if (!price_id || !user_id || !email) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const pack = BONUS_PACKS.find((p) => p.priceId === price_id)
    if (!pack) {
      return NextResponse.json({ error: "Invalid bonus pack" }, { status: 400 })
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [{ price: price_id, quantity: 1 }],
      metadata: {
        user_id,
        type: "bonus_minutes",
        minutes: String(pack.minutes),
      },
      success_url: `${siteUrl}/success?session_id={CHECKOUT_SESSION_ID}&bonus=true`,
      cancel_url: `${siteUrl}/studio`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    console.error("Bonus checkout error:", err)
    const message = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
