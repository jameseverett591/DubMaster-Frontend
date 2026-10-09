import { NextResponse } from "next/server"
import { getStripe } from "@/lib/stripe"

// Exact-amount lip-sync top-up. Unlike the wallet deposit (any amount >= $10),
// this charges precisely the shortfall the editor computed — "pay for what you
// actually want", not a forced $10 deposit. The webhook treats it as a wallet
// credit of amount_total; allow_below_min in metadata tells the backend to
// accept the sub-$10 amount rather than enforcing the deposit floor.
export async function POST(request: Request) {
  try {
    const { user_id, email, amount_cents, job_id } = await request.json()

    if (!user_id || !email || !job_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    const cents = Math.round(Number(amount_cents))
    if (!Number.isFinite(cents) || cents <= 0) {
      return NextResponse.json({ error: "amount_cents must be positive" }, { status: 400 })
    }
    // Stripe's own floor is $0.50; pad to a clean dollar — the excess lands in
    // the wallet as usable credit, never lost.
    const charge = Math.max(cents, 100)

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"

    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "DubMaster lip-sync",
              description: "Wallet credit covering the selected lip-sync charge",
            },
            unit_amount: charge,
          },
          quantity: 1,
        },
      ],
      metadata: {
        user_id,
        type: "wallet_credit",
        allow_below_min: "true",
        job_id,
      },
      // ?lip_paid=1 tells the editor to resume the render it was gated on.
      success_url: `${siteUrl}/editor/${job_id}?lip_paid=1`,
      cancel_url: `${siteUrl}/editor/${job_id}`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    console.error("Lip-sync checkout error:", err)
    const message = err instanceof Error ? err.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
