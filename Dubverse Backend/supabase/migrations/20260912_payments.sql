-- Payment audit trail. quota_ledger records quota MOVEMENTS (renders,
-- refunds, deposits); payments records MONEY events from Stripe (deposits,
-- subscription invoices, failures) for per-user billing history and support
-- lookups. The old webhook inserted into a `payments` table that never
-- existed — those writes silently failed, so there is no bad data to migrate.
--
-- Run in the Supabase SQL editor (service role). Idempotent.

create table if not exists public.payments (
    id                 bigserial primary key,
    user_id            uuid not null references auth.users(id) on delete cascade,
    stripe_payment_id  text,
    amount             integer not null,     -- cents
    currency           text not null default 'usd',
    status             text not null,        -- 'succeeded' | 'failed'
    invoice_url        text,
    created_at         timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);

alter table public.payments enable row level security;
drop policy if exists "own payments" on public.payments;
create policy "own payments" on public.payments for select using (auth.uid() = user_id);
-- Writes go through the service-role client only (the Stripe webhook uses
-- the Next.js service client; the browser can only read its own rows).
