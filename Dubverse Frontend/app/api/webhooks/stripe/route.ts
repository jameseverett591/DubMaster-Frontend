import { NextResponse } from "next/server"
import { getStripe } from "@/lib/stripe"
import { createServiceClient } from "@/lib/supabase/server"
import type Stripe from "stripe"
import type { PlanType, SubscriptionStatus } from "@/lib/supabase/types"

// One paid tier. Every subscription checkout is "pro"; tier resolution on the
// backend reads subscriptions.status (active/trialing => pro, else free).
const PRO_PLAN: PlanType = "pro"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

// Server-to-server: hand the completed wallet deposit to the backend, which
// runs quota_add_credits. Idempotent on stripe_payment_id — Stripe may
// redeliver this webhook. A non-2xx throws so Stripe retries; the backend
// returns already_applied on the retry instead of double-crediting.
async function creditWallet(userId: string, amountCents: number, paymentId: string) {
  const res = await fetch(`${API_BASE}/internal/quota/credit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": process.env.INTERNAL_API_SECRET || "",
    },
    body: JSON.stringify({
      user_id: userId,
      amount_cents: amountCents,
      stripe_payment_id: paymentId,
    }),
  })
  if (!res.ok) {
    throw new Error(`quota credit failed: HTTP ${res.status} ${await res.text()}`)
  }
  return res.json()
}

function subPeriod(subscription: Stripe.Subscription) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const item = subscription.items?.data?.[0] as any
  return {
    current_period_start: item?.current_period_start
      ? new Date(item.current_period_start * 1000).toISOString()
      : new Date().toISOString(),
    current_period_end: item?.current_period_end
      ? new Date(item.current_period_end * 1000).toISOString()
      : new Date().toISOString(),
  }
}

export async function POST(request: Request) {
  const body = await request.text()
  const sig = request.headers.get("stripe-signature")

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Webhook signature verification failed"
    console.error("Webhook signature error:", message)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const supabase = await createServiceClient()

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.metadata?.user_id

        if (!userId) {
          console.error("[STRIPE] No user_id in checkout session metadata")
          break
        }

        // Wallet deposit — one-time payment, any amount >= $10.
        if (session.mode === "payment" || session.metadata?.type === "wallet_credit") {
          const paymentId =
            (typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id) ?? session.id
          const amountCents = session.amount_total ?? 0
          const result = await creditWallet(userId, amountCents, paymentId)

          await supabase.from("payments").insert({
            user_id: userId,
            stripe_payment_id: paymentId,
            amount: amountCents,
            currency: session.currency || "usd",
            status: "succeeded",
          })

          console.log(
            `[STRIPE] Wallet credited: user=${userId} cents=${amountCents} ` +
              `seconds=${result.credited_seconds} already_applied=${result.already_applied}`
          )
          break
        }

        // Pro subscription checkout.
        const subscriptionId = session.subscription as string
        const subscription = (await getStripe().subscriptions.retrieve(
          subscriptionId
        )) as unknown as Stripe.Subscription

        const subRow = {
          user_id: userId,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: subscriptionId,
          plan_type: PRO_PLAN,
          status: "active" as SubscriptionStatus,
          ...subPeriod(subscription),
          cancel_at_period_end: subscription.cancel_at_period_end ?? false,
          updated_at: new Date().toISOString(),
        }

        const { data: existing } = await supabase
          .from("subscriptions")
          .select("id")
          .eq("user_id", userId)
          .limit(1)
          .maybeSingle()

        const { error: subError } = existing
          ? await supabase.from("subscriptions").update(subRow).eq("user_id", userId)
          : await supabase.from("subscriptions").insert(subRow)

        if (subError) {
          console.error("[STRIPE] Subscription upsert FAILED:", subError)
          throw subError
        }

        console.log(`[STRIPE] Pro subscription active: user=${userId} sub=${subscriptionId}`)
        break
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.user_id
        if (!userId) break

        let status: SubscriptionStatus = "active"
        if (subscription.status === "canceled") status = "canceled"
        else if (subscription.status === "past_due") status = "past_due"
        else if (subscription.status === "trialing") status = "trialing"

        await supabase
          .from("subscriptions")
          .update({
            plan_type: PRO_PLAN,
            status,
            ...subPeriod(subscription),
            cancel_at_period_end: subscription.cancel_at_period_end ?? false,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id)

        console.log(`[STRIPE] Subscription updated: ${subscription.id} status=${status}`)
        break
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription

        await supabase
          .from("subscriptions")
          .update({
            status: "canceled" as SubscriptionStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", subscription.id)

        console.log(`[STRIPE] Subscription canceled: ${subscription.id} -> free tier`)
        break
      }

      // Renewal paid: restore/confirm pro. Monthly included seconds reset
      // lazily via quota_touch on the next render — no explicit reset needed.
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoice = event.data.object as any
        const customerId = String(invoice.customer)

        const { data: sub } = await supabase
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_customer_id", customerId)
          .limit(1)
          .single()

        if (sub) {
          await supabase
            .from("subscriptions")
            .update({
              status: "active" as SubscriptionStatus,
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_customer_id", customerId)

          const piId =
            typeof invoice.payment_intent === "string"
              ? invoice.payment_intent
              : invoice.payment_intent?.id ?? null
          await supabase.from("payments").insert({
            user_id: sub.user_id,
            stripe_payment_id: piId,
            amount: invoice.amount_paid ?? 0,
            currency: invoice.currency ?? "usd",
            status: "succeeded",
            invoice_url: invoice.hosted_invoice_url ?? null,
          })
          console.log(`[STRIPE] Invoice paid: user=${sub.user_id} -> pro active`)
        }
        break
      }

      // Payment failed: past_due drops tier_for() to free. The wallet is in
      // user_quota, untouched — credits are preserved by doing nothing.
      case "invoice.payment_failed": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoice = event.data.object as any
        const customerId = String(invoice.customer)

        const { data: sub } = await supabase
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_customer_id", customerId)
          .limit(1)
          .single()

        if (sub) {
          await supabase
            .from("subscriptions")
            .update({
              status: "past_due" as SubscriptionStatus,
              updated_at: new Date().toISOString(),
            })
            .eq("stripe_customer_id", customerId)

          const piId =
            typeof invoice.payment_intent === "string"
              ? invoice.payment_intent
              : invoice.payment_intent?.id ?? null
          await supabase.from("payments").insert({
            user_id: sub.user_id,
            stripe_payment_id: piId,
            amount: invoice.amount_due ?? 0,
            currency: invoice.currency ?? "usd",
            status: "failed",
            invoice_url: invoice.hosted_invoice_url ?? null,
          })
          console.log(`[STRIPE] Invoice failed: user=${sub.user_id} -> free (wallet preserved)`)
        }
        break
      }
    }
  } catch (err) {
    console.error("[STRIPE] Webhook handler error:", err)
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
