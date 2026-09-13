/**
 * DubMaster billing overhaul — Stripe catalog migration.
 *
 *   node --env-file=.env.local scripts/stripe-setup.ts            # DRY RUN (default)
 *   node --env-file=.env.local scripts/stripe-setup.ts --apply    # make the changes
 *
 * What it does:
 *   1. ARCHIVES the legacy products: Basic, Premium, Professional (and any
 *      product whose metadata.plan_type is one of those). Archiving sets
 *      active=false — existing subscriptions keep billing, nothing is deleted,
 *      the products just can't be sold again.
 *   2. CREATES "DubMaster Pro": $49/month and $470/year recurring.
 *   3. CREATES "DubMaster Wallet Credit": a one-time price with a customer-
 *      chosen amount, $10 minimum. $2.50/min is applied by the backend when
 *      the webhook credits the wallet — Stripe only collects the money.
 *
 * Idempotent: re-running finds existing products by metadata.dubmaster_key
 * and skips creation. Every action is printed before it happens; nothing
 * is sent to Stripe without --apply. Prints the env lines to paste at the end.
 *
 * Uses the same `stripe` package and STRIPE_SECRET_KEY as lib/stripe.ts.
 */
import Stripe from "stripe"

const APPLY = process.argv.includes("--apply")
const KEY = process.env.STRIPE_SECRET_KEY
if (!KEY) {
  console.error("STRIPE_SECRET_KEY is not set. Run with --env-file=.env.local")
  process.exit(1)
}
const live = KEY.startsWith("sk_live_")
const stripe = new Stripe(KEY, { apiVersion: "2026-02-25.clover" })

// Legacy catalog match. Real product names carry suffixes ("Basic Plan",
// "Professional Tier", "10 Minute Pack"), and none of them set
// metadata.plan_type — so match by regex on name AND plan_type. Minute
// packs are included: the wallet replaces them. "DubMaster Pro" and
// "DubMaster Wallet Credit" match none of these patterns.
const LEGACY_PATTERNS = [/basic/i, /premium/i, /professional/i, /minute pack/i]

const PRO_KEY = "pro"
const WALLET_KEY = "wallet_credit"
const PRO_MONTHLY_CENTS = 4900
const PRO_YEARLY_CENTS = 47000
const WALLET_MIN_CENTS = 1000

function log(action: string, detail: string) {
  console.log(`${APPLY ? "APPLY " : "DRY   "} ${action.padEnd(8)} ${detail}`)
}

async function listAllProducts(): Promise<Stripe.Product[]> {
  const out: Stripe.Product[] = []
  for await (const p of stripe.products.list({ limit: 100 })) out.push(p)
  return out
}

async function archiveLegacy(products: Stripe.Product[]) {
  const legacy = products.filter((p) => {
    const name = (p.name || "").trim()
    const meta = p.metadata?.plan_type || ""
    return p.active && LEGACY_PATTERNS.some((re) => re.test(name) || re.test(meta))
  })
  if (legacy.length === 0) {
    log("skip", "no active legacy products (Basic/Premium/Professional) found")
    return
  }
  for (const p of legacy) {
    // Deactivate the prices first: an active price on an archived product
    // can still be referenced by a stale STRIPE_PRICE_* env var.
    // A product's DEFAULT price refuses to archive — unlink it first.
    if (APPLY && p.default_price) {
      await stripe.products.update(p.id, { default_price: "" })
    }
    const prices = await stripe.prices.list({ product: p.id, active: true, limit: 100 })
    for (const pr of prices.data) {
      log("archive", `price ${pr.id} (${pr.unit_amount} ${pr.currency}/${pr.recurring?.interval ?? "one-time"}) of "${p.name}"`)
      if (APPLY) await stripe.prices.update(pr.id, { active: false })
    }
    log("archive", `product ${p.id} "${p.name}"`)
    if (APPLY) await stripe.products.update(p.id, { active: false })
  }
}

async function ensureProduct(
  products: Stripe.Product[],
  key: string,
  params: Stripe.ProductCreateParams,
): Promise<Stripe.Product | null> {
  const existing = products.find((p) => p.metadata?.dubmaster_key === key)
  if (existing) {
    log("exists", `product ${existing.id} "${existing.name}" (dubmaster_key=${key})`)
    if (!existing.active) {
      log("reactivate", `product ${existing.id}`)
      if (APPLY) await stripe.products.update(existing.id, { active: true })
    }
    return existing
  }
  log("create", `product "${params.name}" (dubmaster_key=${key})`)
  if (!APPLY) return null
  return stripe.products.create({ ...params, metadata: { ...(params.metadata || {}), dubmaster_key: key } })
}

async function ensurePrice(
  product: Stripe.Product | null,
  lookupKey: string,
  params: Omit<Stripe.PriceCreateParams, "product" | "lookup_key">,
  describe: string,
): Promise<string | null> {
  if (product) {
    const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
    if (found.data[0]) {
      log("exists", `price ${found.data[0].id} ${describe} (lookup_key=${lookupKey})`)
      return found.data[0].id
    }
  }
  log("create", `price ${describe} (lookup_key=${lookupKey})`)
  if (!APPLY || !product) return null
  const price = await stripe.prices.create({ ...params, product: product.id, lookup_key: lookupKey })
  return price.id
}

async function main() {
  console.log(`\nStripe account mode: ${live ? "LIVE" : "TEST"}   run mode: ${APPLY ? "APPLY — changes WILL be made" : "DRY RUN — nothing is sent"}\n`)
  if (live && !APPLY) console.log("(live key detected; dry run only — re-run with --apply to commit)\n")

  const products = await listAllProducts()

  // 1. Archive the three legacy tiers.
  await archiveLegacy(products)

  // 2. Pro plan — monthly and yearly.
  const pro = await ensureProduct(products, PRO_KEY, {
    name: "DubMaster Pro",
    description: "Full professional dub studio. 30 minutes of rendered video included every month; additional minutes from your credit wallet at $2.50/min.",
    metadata: { plan_type: "pro", included_minutes: "30" },
  })
  const proMonthly = await ensurePrice(pro, "dubmaster_pro_monthly", {
    currency: "usd", unit_amount: PRO_MONTHLY_CENTS,
    recurring: { interval: "month" },
    metadata: { plan_type: "pro", interval: "month" },
  }, "$49.00 / month")
  const proYearly = await ensurePrice(pro, "dubmaster_pro_yearly", {
    currency: "usd", unit_amount: PRO_YEARLY_CENTS,
    recurring: { interval: "year" },
    metadata: { plan_type: "pro", interval: "year" },
  }, "$470.00 / year (2 months free)")

  // 3. Wallet credit — customer picks the amount, $10 floor, no ceiling.
  const wallet = await ensureProduct(products, WALLET_KEY, {
    name: "DubMaster Wallet Credit",
    description: "Prepaid render credit at $2.50 per minute of video. Never expires.",
    metadata: { type: "wallet_credit", cents_per_minute: "250" },
  })
  const walletPrice = await ensurePrice(wallet, "dubmaster_wallet_credit", {
    currency: "usd",
    custom_unit_amount: { enabled: true, minimum: WALLET_MIN_CENTS, preset: 2500 },
    metadata: { type: "wallet_credit", min_cents: String(WALLET_MIN_CENTS) },
  }, "custom amount, min $10.00 (preset $25.00), one-time")

  console.log("\n--- env (.env.local) ---")
  console.log(`STRIPE_PRICE_PRO_MONTHLY=${proMonthly ?? "<created on --apply>"}`)
  console.log(`STRIPE_PRICE_PRO_YEARLY=${proYearly ?? "<created on --apply>"}`)
  console.log(`STRIPE_PRICE_WALLET_CREDIT=${walletPrice ?? "<created on --apply>"}`)
  console.log("\nLegacy STRIPE_PRICE_{BASIC,PREMIUM,PROFESSIONAL}_* and STRIPE_PRICE_BONUS_* can be removed once the checkout routes are switched over.")
  if (!APPLY) console.log("\nDry run complete. Re-run with --apply to make these changes.")
}

main().catch((err) => {
  console.error("stripe-setup failed:", err?.message ?? err)
  process.exit(1)
})
