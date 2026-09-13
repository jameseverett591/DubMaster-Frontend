-- DubMaster billing overhaul: one Pro plan + prepaid credit wallet, metered
-- only on the Make Movie render.
--
-- Run in the Supabase SQL editor (service role). Idempotent.
--
-- Units are SECONDS throughout. The spec named the columns *_minutes_used,
-- but the wallet is credit_balance_seconds and renders are billed ceil-to-
-- second, so mixing units in one row invited exactly the rounding bugs the
-- old minutes ledger had. Minutes are a display concern.
--
-- Deduction order (quota_deduct): included monthly seconds first (3 min
-- free, or 30 min Pro — Pro REPLACES free, it does not stack), then the
-- wallet at $2.50/min. If both are short the call raises and nothing is
-- debited.

create table if not exists public.user_quota (
    user_id                uuid primary key references auth.users(id) on delete cascade,
    tier                   text not null default 'free' check (tier in ('free', 'pro')),
    included_seconds_used  integer not null default 0 check (included_seconds_used >= 0),
    credit_balance_seconds integer not null default 0 check (credit_balance_seconds >= 0),
    period_start           date not null default (date_trunc('month', now() at time zone 'utc'))::date,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);

-- Every movement, for audit and for idempotent Stripe crediting.
create table if not exists public.quota_ledger (
    id                 bigserial primary key,
    user_id            uuid not null references auth.users(id) on delete cascade,
    job_id             text,
    kind               text not null check (kind in ('render', 'refund', 'deposit', 'adjust', 'period_reset')),
    included_seconds   integer not null default 0,   -- signed: - on render, + on refund
    credit_seconds     integer not null default 0,   -- signed
    amount_cents       integer,                      -- deposits only
    stripe_payment_id  text,
    note               text,
    created_at         timestamptz not null default now()
);
create index if not exists quota_ledger_user_idx on public.quota_ledger (user_id, created_at desc);
-- A Stripe webhook can be delivered more than once. The same payment must
-- never credit the wallet twice.
create unique index if not exists quota_ledger_stripe_payment_uidx
    on public.quota_ledger (stripe_payment_id) where stripe_payment_id is not null;

-- First render of a job is charged; re-renders of the same job are free.
alter table public.jobs add column if not exists billed_seconds integer;

alter table public.user_quota  enable row level security;
alter table public.quota_ledger enable row level security;
drop policy if exists "own quota"  on public.user_quota;
drop policy if exists "own ledger" on public.quota_ledger;
create policy "own quota"  on public.user_quota  for select using (auth.uid() = user_id);
create policy "own ledger" on public.quota_ledger for select using (auth.uid() = user_id);
-- Writes go through the service-role client only (the RPCs below are
-- security definer, so the backend calls them with the service key).


-- Included seconds for a tier. Single source of truth for the two numbers.
create or replace function public.quota_included_seconds(p_tier text)
returns integer language sql immutable as $$
    select case p_tier when 'pro' then 1800 else 180 end;
$$;


-- Ensure the row exists, set the tier, and roll the month over if
-- period_start is stale. Called by every other RPC first. Rolling over on
-- read means no cron: the first touch in a new month resets the counter.
create or replace function public.quota_touch(p_user_id uuid, p_tier text)
returns public.user_quota
language plpgsql security definer set search_path = public as $$
declare
    r public.user_quota;
    cur_period date := (date_trunc('month', now() at time zone 'utc'))::date;
begin
    insert into public.user_quota (user_id, tier)
    values (p_user_id, p_tier)
    on conflict (user_id) do nothing;

    select * into r from public.user_quota where user_id = p_user_id for update;

    if r.period_start < cur_period then
        insert into public.quota_ledger (user_id, kind, included_seconds, note)
        values (p_user_id, 'period_reset', -r.included_seconds_used,
                format('period %s -> %s', r.period_start, cur_period));
        update public.user_quota
           set included_seconds_used = 0, period_start = cur_period, updated_at = now()
         where user_id = p_user_id;
    end if;

    if r.tier is distinct from p_tier then
        update public.user_quota set tier = p_tier, updated_at = now()
         where user_id = p_user_id;
    end if;

    select * into r from public.user_quota where user_id = p_user_id;
    return r;
end $$;


-- Atomic debit for one render. Returns the split; raises 'quota_exceeded'
-- (with shortfall in the message) when included + wallet cannot cover it,
-- leaving the row untouched.
create or replace function public.quota_deduct(
    p_user_id uuid, p_tier text, p_seconds integer, p_job_id text
) returns table (included_seconds integer, credit_seconds integer,
                 included_remaining integer, credit_remaining integer)
language plpgsql security definer set search_path = public as $$
declare
    r          public.user_quota;
    incl_cap   integer := public.quota_included_seconds(p_tier);
    incl_left  integer;
    from_incl  integer;
    from_cred  integer;
begin
    if p_seconds is null or p_seconds <= 0 then
        raise exception 'quota_bad_amount: % seconds', p_seconds;
    end if;

    r := public.quota_touch(p_user_id, p_tier);
    -- quota_touch already took FOR UPDATE on this row and we are in the same
    -- transaction, so the lock is still held. This second SELECT is not for
    -- locking — it re-reads the row AFTER quota_touch's possible month
    -- rollover / tier update, so the arithmetic below sees current values.
    select * into r from public.user_quota where user_id = p_user_id for update;

    incl_left := greatest(0, incl_cap - r.included_seconds_used);
    from_incl := least(p_seconds, incl_left);
    from_cred := p_seconds - from_incl;

    if from_cred > r.credit_balance_seconds then
        raise exception 'quota_exceeded: need % more seconds', from_cred - r.credit_balance_seconds
            using errcode = 'P0001';
    end if;

    update public.user_quota
       set included_seconds_used  = included_seconds_used + from_incl,
           credit_balance_seconds = credit_balance_seconds - from_cred,
           updated_at = now()
     where user_id = p_user_id;

    insert into public.quota_ledger (user_id, job_id, kind, included_seconds, credit_seconds)
    values (p_user_id, p_job_id, 'render', -from_incl, -from_cred);

    return query
        select from_incl, from_cred,
               incl_left - from_incl,
               r.credit_balance_seconds - from_cred;
end $$;


-- Reverse a render charge (render failed after debit). Idempotent per job:
-- refunds only what the 'render' rows for that job debited, minus any
-- refund already issued.
create or replace function public.quota_refund(p_user_id uuid, p_job_id text)
returns table (included_seconds integer, credit_seconds integer)
language plpgsql security definer set search_path = public as $$
declare
    net_incl integer;
    net_cred integer;
begin
    select coalesce(-sum(l.included_seconds), 0), coalesce(-sum(l.credit_seconds), 0)
      into net_incl, net_cred
      from public.quota_ledger l
     where l.user_id = p_user_id and l.job_id = p_job_id and l.kind in ('render', 'refund');

    if net_incl <= 0 and net_cred <= 0 then
        return query select 0, 0;
        return;
    end if;

    -- greatest(0, ...) on the included side is DELIBERATE, not a guard against
    -- a bug. If the month rolled over between the render and this refund,
    -- included_seconds_used is already 0 and the debited allowance belonged
    -- to LAST month — it is gone, exactly as unused allowance would be. Do
    -- not "fix" this by carrying it into the new month or converting it to
    -- wallet credit: included minutes are use-it-or-lose-it by design. The
    -- wallet side (net_cred) is always refunded in full because wallet credit
    -- never expires.
    update public.user_quota
       set included_seconds_used  = greatest(0, included_seconds_used - net_incl),
           credit_balance_seconds = credit_balance_seconds + net_cred,
           updated_at = now()
     where user_id = p_user_id;

    insert into public.quota_ledger (user_id, job_id, kind, included_seconds, credit_seconds)
    values (p_user_id, p_job_id, 'refund', net_incl, net_cred);

    return query select net_incl, net_cred;
end $$;


-- Wallet top-up from a Stripe payment. $2.50/min => 250 cents buys 60s.
-- Idempotent on stripe_payment_id: a redelivered webhook returns the
-- existing credit and adds nothing.
create or replace function public.quota_add_credits(
    p_user_id uuid, p_tier text, p_amount_cents integer, p_stripe_payment_id text
) returns table (credited_seconds integer, credit_remaining integer, already_applied boolean)
language plpgsql security definer set search_path = public as $$
declare
    secs integer := floor(p_amount_cents * 60.0 / 250.0);
    existing integer;
    bal integer;
begin
    if p_amount_cents is null or p_amount_cents < 1000 then
        raise exception 'quota_min_deposit: % cents is below the $10 minimum', p_amount_cents;
    end if;

    if p_stripe_payment_id is not null then
        select l.credit_seconds into existing from public.quota_ledger l
         where l.stripe_payment_id = p_stripe_payment_id limit 1;
        if found then
            select credit_balance_seconds into bal from public.user_quota where user_id = p_user_id;
            return query select existing, coalesce(bal, 0), true;
            return;
        end if;
    end if;

    perform public.quota_touch(p_user_id, p_tier);

    -- Ledger row FIRST, balance second. The unique index on stripe_payment_id
    -- is the real idempotency guard: two deliveries of the same webhook can
    -- both pass the SELECT above, but only one INSERT can succeed. The loser
    -- lands in the handler below and reports already_applied instead of
    -- raising — Stripe sees a 2xx, the balance was credited exactly once.
    -- (The whole function is one transaction, so the winner's UPDATE and
    -- INSERT commit together or not at all.)
    begin
        insert into public.quota_ledger (user_id, kind, credit_seconds, amount_cents, stripe_payment_id)
        values (p_user_id, 'deposit', secs, p_amount_cents, p_stripe_payment_id);
    exception when unique_violation then
        select l.credit_seconds into existing from public.quota_ledger l
         where l.stripe_payment_id = p_stripe_payment_id limit 1;
        select credit_balance_seconds into bal from public.user_quota where user_id = p_user_id;
        return query select coalesce(existing, secs), coalesce(bal, 0), true;
        return;
    end;

    update public.user_quota
       set credit_balance_seconds = credit_balance_seconds + secs, updated_at = now()
     where user_id = p_user_id
    returning credit_balance_seconds into bal;

    return query select secs, bal, false;
end $$;

grant execute on function public.quota_included_seconds(text)                     to service_role;
grant execute on function public.quota_touch(uuid, text)                           to service_role;
grant execute on function public.quota_deduct(uuid, text, integer, text)           to service_role;
grant execute on function public.quota_refund(uuid, text)                          to service_role;
grant execute on function public.quota_add_credits(uuid, text, integer, text)      to service_role;
