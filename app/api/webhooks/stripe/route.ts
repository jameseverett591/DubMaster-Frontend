import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { createServiceClient } from "@/lib/supabase/server"
import type Stripe from "stripe"
import type { PlanType, SubscriptionStatus } from "@/lib/supabase/types"

export async function POST(request: Request) {
  const body = await request.text()
  const sig = request.headers.get("stripe-signature")

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
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
          console.error("No user_id in checkout session metadata")
          break
        }

        // Handle bonus minutes one-time purchase
        if (session.metadata?.type === "bonus_minutes") {
          const minutes = parseInt(session.metadata.minutes || "0", 10)
          if (minutes > 0) {
            // Upsert bonus_minutes balance (add to existing)
            const { data: existing } = await supabase
              .from("bonus_minutes")
              .select("balance")
              .eq("user_id", userId)
              .single()

            const newBalance = (existing?.balance || 0) + minutes

            await supabase.from("bonus_minutes").upsert(
              {
                user_id: userId,
                balance: newBalance,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id" }
            )

            // Record in ledger for audit trail
            await supabase.from("bonus_minutes_ledger").insert({
              user_id: userId,
              amount: minutes,
              source: `${minutes}_minute_pack`,
              stripe_payment_id: session.payment_intent as string,
            })

            // Record payment
            await supabase.from("payments").insert({
              user_id: userId,
              stripe_payment_id: session.payment_intent as string,
              amount: session.amount_total || 0,
              currency: session.currency || "usd",
              status: "succeeded",
            })

            console.log(`[STRIPE] Bonus minutes purchased: user=${userId} minutes=${minutes} new_balance=${newBalance}`)
          }
          break
        }

        // Handle subscription checkout
        const planType = (session.metadata?.plan_type || "basic") as PlanType
        const subscriptionId = session.subscription as string
        const subscription = await stripe.subscriptions.retrieve(subscriptionId) as unknown as Stripe.Subscription

        const subRow = {
          user_id: userId,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: subscriptionId,
          plan_type: planType,
          status: "active" as SubscriptionStatus,
          current_period_start: subscription.items?.data?.[0]?.current_period_start
            ? new Date(subscription.items.data[0].current_period_start * 1000).toISOString()
            : new Date().toISOString(),
          current_period_end: subscription.items?.data?.[0]?.current_period_end
            ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
            : new Date().toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end ?? false,
          updated_at: new Date().toISOString(),
        }

        // Check if subscription already exists for this user
        const { data: existing } = await supabase
          .from("subscriptions")
          .select("id")
          .eq("user_id", userId)
          .limit(1)
          .maybeSingle()

        if (existing) {
          const { error: updateError } = await supabase
            .from("subscriptions")
            .update(subRow)
            .eq("user_id", userId)
          if (updateError) {
            console.error(`[STRIPE] Subscription update FAILED:`, updateError)
          } else {
            console.log(`[STRIPE] Subscription updated for user=${userId}`)
          }
        } else {
          const { error: insertError } = await supabase
            .from("subscriptions")
            .insert(subRow)
          if (insertError) {
            console.error(`[STRIPE] Subscription insert FAILED:`, insertError)
          } else {
            console.log(`[STRIPE] Subscription inserted for user=${userId}`)
          }
        }

        // Initialize usage record for current month
        const month = new Date().toISOString().slice(0, 7) + "-01"
        const { data: existingUsage } = await supabase
          .from("usage")
          .select("id")
          .eq("user_id", userId)
          .eq("month", month)
          .maybeSingle()
        if (!existingUsage) {
          const { error: usageError } = await supabase
            .from("usage")
            .insert({ user_id: userId, month, minutes_used: 0 })
          if (usageError) {
            console.error(`[STRIPE] Usage insert FAILED:`, usageError)
          }
        }

        console.log(`[STRIPE] Subscription created: user=${userId} plan=${planType}`)
        break
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription
        const userId = subscription.metadata?.user_id

        if (!userId) break

        const planType = (subscription.metadata?.plan_type || "basic") as PlanType
        let status: SubscriptionStatus = "active"
        if (subscription.status === "canceled") status = "canceled"
        else if (subscription.status === "past_due") status = "past_due"
        else if (subscription.status === "trialing") status = "trialing"

        await supabase
          .from("subscriptions")
          .update({
            plan_type: planType,
            status,
            current_period_start: subscription.items?.data?.[0]?.current_period_start
              ? new Date(subscription.items.data[0].current_period_start * 1000).toISOString()
              : new Date().toISOString(),
            current_period_end: subscription.items?.data?.[0]?.current_period_end
              ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
              : new Date().toISOString(),
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

        console.log(`[STRIPE] Subscription canceled: ${subscription.id}`)
        break
      }

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
          const piId = typeof invoice.payment_intent === "string"
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
        }
        break
      }

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

          const piId = typeof invoice.payment_intent === "string"
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
