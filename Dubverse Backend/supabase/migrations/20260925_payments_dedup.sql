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

-- NOT partial: Postgres can't use a WHERE-qualified index as an ON CONFLICT
-- arbiter, and NULLs are already exempt from uniqueness — the predicate was
-- both harmful and redundant. New name (drop the old partial one if applied).
drop index if exists payments_stripe_payment_id_status_key;
create unique index if not exists payments_stripe_payment_id_status_uq
    on public.payments (stripe_payment_id, status);
