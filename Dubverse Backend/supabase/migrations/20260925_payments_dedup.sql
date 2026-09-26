-- Dedup the payments audit trail on stripe_payment_id. Stripe redelivers
-- webhooks (at-least-once); without this the same charge was logged once per
-- delivery. Wallet credit itself was already idempotent via the quota ledger —
-- this index protects the audit table only.
--
-- Run in the Supabase SQL editor (service role). Idempotent.

-- Remove historical duplicates first (keep the earliest row per key+status).
delete from public.payments a
using public.payments b
where a.stripe_payment_id is not null
  and a.stripe_payment_id = b.stripe_payment_id
  and a.status = b.status
  and a.id > b.id;

create unique index if not exists payments_stripe_payment_id_status_key
    on public.payments (stripe_payment_id, status)
    where stripe_payment_id is not null;
