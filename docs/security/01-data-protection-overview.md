# DubMaster — Data Protection Overview

**Status:** Draft for internal review · **Owner:** James Everett · **Last updated:** 2026-08-12

Written against the code as it stands on branch `recovery-timeline-layout`.
Every claim below is either verified in the codebase (file references given) or
explicitly marked **UNVERIFIED**. Nothing here should be sent to a customer
until the unverified items are confirmed against the live deployment.

---

## 1. Payment and financial information

**DubMaster never receives, processes, transmits or stores cardholder data.**

Payments use **Stripe Checkout Sessions** — a hosted page on `checkout.stripe.com`.
The customer enters card details on Stripe's domain. Those details do not pass
through the DubMaster frontend, backend, database, or logs.

Verified:
- `app/api/create-checkout-session/route.ts` and `app/api/create-bonus-checkout/route.ts`
  create hosted Checkout Sessions; neither collects card fields.
- No card-data handling exists anywhere in the backend (no PAN, CVC, or card
  field references in `Dubverse Backend/app`).
- Stripe webhooks are signature-verified with `stripe.webhooks.constructEvent`
  against `STRIPE_WEBHOOK_SECRET` (`app/api/webhooks/stripe/route.ts:18`).
- Subscription activation re-fetches the session **from Stripe** server-side and
  requires `payment_status === "paid"` before granting access
  (`app/api/activate-subscription/route.ts`). It cannot be forged by a client.

### PCI DSS scope

This architecture corresponds to **SAQ A** — the minimal PCI validation tier, for
merchants who fully outsource cardholder data handling to a validated third
party. DubMaster's obligations under SAQ A are essentially: keep using the
hosted flow, keep the site free of card fields, and manage the Stripe API keys.

### What billing data we *do* hold

Stored in Supabase, per user:

| Field | Nature |
|---|---|
| `stripe_customer_id` | Opaque Stripe reference |
| `stripe_subscription_id` | Opaque Stripe reference |
| `plan_type`, `status`, period dates | Subscription state |
| `usage.minutes_used`, `bonus_minutes.balance` | Consumption counters |

None of these are financial instruments. They are useless without our Stripe API
key and cannot be used to charge, refund, or identify a card.

**Summary for a customer questionnaire:** *"Card data is handled exclusively by
Stripe via hosted Checkout. DubMaster stores only opaque Stripe identifiers and
subscription state. We are PCI SAQ A."*

---

## 2. Customer content — the higher-risk asset

Financial data is well protected by outsourcing. **Customer video is not
outsourced, and it is the more sensitive asset**: DubMaster processes films,
frequently unreleased and under copyright.

### Where customer content lives

| Location | Contents | Notes |
|---|---|---|
| Cloudflare R2 | Uploaded source video | Intended as permanent source storage |
| Local disk `data/uploads/<job_id>/` | Fetched copy of source | 73 job directories present at time of writing |
| Local disk `data/separated/` | Isolated vocals, compressed Velma uploads | Derived audio |
| Local disk `data/transcripts/`, `data/projects/` | Transcripts, project metadata | Includes dialogue text |
| Local disk `data/dubbed/` | Finished dubbed video | |
| Supabase | Job rows, segments, speakers | Dialogue text may appear in segment rows |
| Third parties | See `02-subprocessors.md` | Audio and transcripts leave our infrastructure |

**Gap:** there is currently **no retention or deletion policy** and no code path
that removes a customer's content on request. See `03-data-retention-and-deletion.md`.

---

## 3. Access control

- **Authentication:** Supabase-issued JWTs. All backend routes require
  authentication (introduced `7ceb99c4`, Aug 7 2026).
- **Authorisation / tenant isolation:** Supabase **Row Level Security is enabled
  and verified against the live database** (2026-08-12). 8 `ENABLE ROW LEVEL
  SECURITY` statements and 17 policies in `Dubverse Frontend/supabase/*.sql`;
  an unauthenticated read with the public key returns an empty set for `jobs`,
  `subscriptions` and `usage`. This is the control that makes multi-tenant
  isolation claimable to a customer.
- **Project ownership:** `/projects` is scoped to the owning user (`5d27b8fb`,
  which fixed a prior leak of every user's work).
- **Secrets:** `Dubverse Backend/.env` and `Dubverse Frontend/.env.local` are
  both gitignored (verified). No Supabase service-role key appears in client
  code; only publishable keys are exposed via `NEXT_PUBLIC_*`.

### Known access-control weaknesses

1. **JWTs in URL query strings.** Media routes accept `?access_token=<JWT>`
   because `<video>` and `<audio>` elements cannot send an `Authorization`
   header (`lib/api-client.ts`, `_mediaUrl`). Tokens therefore appear in server
   access logs, any intermediate proxy logs, and browser history. Observed in
   plaintext in our own backend logs.
   **Remediation:** short-lived signed URLs scoped to one object.

2. **`NEXT_PUBLIC_SKIP_SUBSCRIPTION_CHECK`.** Set to `true` in local
   `.env.local` and read by `middleware.ts:128`. If this variable reaches a
   production environment it disables the subscription gate for all users.
   **Remediation:** ignore the flag unless `NODE_ENV !== "production"`.

---

## 4. Encryption

- **In transit:** HTTPS to Supabase, Stripe, Cloudflare R2, and all AI
  subprocessors. **UNVERIFIED** for the deployed frontend/backend hosts —
  confirm TLS termination and HSTS in the production deployment.
- **At rest, vendor-managed:** Supabase (Postgres) and Cloudflare R2 both
  encrypt at rest by default per their documentation. This is a vendor claim,
  not something we implement.
- **At rest, our own:** the `data/` directory on the processing host is **not
  separately encrypted** by the application. On a developer machine this is
  ordinary; for production it should sit on an encrypted volume.

---

## 5. Prioritised gaps

| # | Gap | Risk | Effort |
|---|---|---|---|
| 1 | No retention/deletion path for customer content | GDPR erasure; content security | Medium |
| 2 | No subprocessor register or DPAs | Blocks any enterprise/studio deal | Low (paperwork) |
| 3 | JWTs in query strings | Token leakage via logs | Medium |
| 4 | `SKIP_SUBSCRIPTION_CHECK` reachable in prod | Paywall bypass | Trivial |
| 5 | RLS application to live DB unverified | Tenant isolation unproven | Trivial to check |
| 6 | `data/` not on an encrypted volume in prod | Content at rest | Deployment config |
| 7 | No voice-cloning consent policy | Legal/ethical, performer rights | Policy work |

---

## 6. Note on industry standard

For film and television work the gating standard is usually **not** SOC 2 but the
**MPA Content Security Best Practices**, assessed via the **Trusted Partner
Network (TPN)**. A studio releasing pre-release material to a dubbing vendor asks
about content handling, access logging, watermarking and subprocessors — the
questions in sections 2 and 3 above, not the questions SOC 2 answers.

SOC 2 remains relevant for non-studio enterprise buyers.
