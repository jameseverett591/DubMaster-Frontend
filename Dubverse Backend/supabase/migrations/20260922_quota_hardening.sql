-- Quota hardening, from the PR review findings:
--
--   1. quota_deduct is now IDEMPOTENT per (user, job_id, kind). Two racing
--      Make Movie clicks both used to pass the app-level billed_seconds check
--      and insert two debits. The user_quota row lock already serializes the
--      calls per user; the net-debit lookup makes the second call a no-op.
--      A fully-refunded charge nets to zero, so a retry after a failed render
--      still debits normally.
--
--   2. quota_add_credits gains p_allow_below_min. The lip-sync shortfall
--      checkout deliberately charges exact sub-$10 amounts; the old RPC
--      rejected them at the database, so Stripe took the money and the wallet
--      never credited. The flag must reach the database operation.
--
--   3. Legacy bonus_minutes balances are backfilled into the wallet. At the
--      time of writing the table is empty, so this is a correctness guard,
--      not a data rescue — if purchased balances ever land there they carry
--      over instead of being silently dropped.
--
-- Run in the Supabase SQL editor (service role). Idempotent.
-- Return-type changes mean both functions are dropped and recreated, and the
-- service_role grants + PUBLIC revokes are re-issued below.


-- 1. Idempotent quota_deduct -------------------------------------------------
drop function if exists public.quota_deduct(uuid, text, integer, text, text);

create or replace function public.quota_deduct(
    p_user_id uuid, p_tier text, p_seconds integer, p_job_id text,
    p_kind text default 'render'
) returns table (included_seconds integer, credit_seconds integer,
                 included_remaining integer, credit_remaining integer,
                 already_billed boolean)
language plpgsql security definer set search_path = public as $$
declare
    r           public.user_quota;
    incl_cap    integer := public.quota_included_seconds(p_tier);
    incl_left   integer;
    from_incl   integer;
    from_cred   integer;
    net_owed    integer;
    orig_incl   integer;
    orig_cred   integer;
begin
    if p_seconds is null or p_seconds <= 0 then
        raise exception 'quota_bad_amount: % seconds', p_seconds;
    end if;

    -- Debit kinds only. 'refund'/'deposit' have their own functions; letting
    -- an arbitrary kind through would poison the refund sum.
    if p_kind not in ('render', 'lipsync') then
        raise exception 'quota_bad_kind: %', p_kind;
    end if;

    r := public.quota_touch(p_user_id, p_tier);
    -- quota_touch already took FOR UPDATE on this row and we are in the same
    -- transaction, so the lock is still held — and it is what makes the
    -- check-then-insert below race-free: two racing debits for the same user
    -- serialize here, and the loser sees the winner's committed ledger row.
    select * into r from public.user_quota where user_id = p_user_id for update;

    -- Idempotency: net outstanding debit for this (job_id, kind) key. Debit
    -- rows are negative, refund rows positive, so -sum is what is still owed.
    -- Refund rows are keyed on the same job_id (for lipsync, the charge key),
    -- so a refunded charge nets to zero and a retry debits normally.
    select coalesce(-sum(l.included_seconds + l.credit_seconds), 0)
      into net_owed
      from public.quota_ledger l
     where l.user_id = p_user_id and l.job_id = p_job_id
       and l.kind in (p_kind, 'refund');

    if net_owed > 0 then
        -- Already charged and not refunded: return the original split so the
        -- caller's bookkeeping sees the same numbers, but debit nothing.
        select -sum(l.included_seconds), -sum(l.credit_seconds)
          into orig_incl, orig_cred
          from public.quota_ledger l
         where l.user_id = p_user_id and l.job_id = p_job_id
           and l.kind = p_kind;
        incl_left := greatest(0, incl_cap - r.included_seconds_used);
        return query
            select coalesce(orig_incl, 0), coalesce(orig_cred, 0),
                   incl_left, r.credit_balance_seconds, true;
        return;
    end if;

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
    values (p_user_id, p_job_id, p_kind, -from_incl, -from_cred);

    return query
        select from_incl, from_cred,
               incl_left - from_incl,
               r.credit_balance_seconds - from_cred,
               false;
end $$;

grant execute on function public.quota_deduct(uuid, text, integer, text, text) to service_role;
revoke execute on function public.quota_deduct(uuid, text, integer, text, text) from public, anon, authenticated;


-- 2. Below-minimum crediting for exact shortfall checkouts -------------------
drop function if exists public.quota_add_credits(uuid, text, integer, text);

create or replace function public.quota_add_credits(
    p_user_id uuid, p_tier text, p_amount_cents integer, p_stripe_payment_id text,
    p_allow_below_min boolean default false
) returns table (credited_seconds integer, credit_remaining integer, already_applied boolean)
language plpgsql security definer set search_path = public as $$
declare
    secs integer := floor(p_amount_cents * 60.0 / 250.0);
    existing integer;
    bal integer;
begin
    -- The $10 floor is a UI rule, not an accounting one: the lip-sync
    -- shortfall checkout intentionally charges exact sub-$10 amounts, and
    -- rejecting them here strands money Stripe already collected.
    if p_amount_cents is null or p_amount_cents <= 0
       or (p_amount_cents < 1000 and not p_allow_below_min) then
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

grant execute on function public.quota_add_credits(uuid, text, integer, text, boolean) to service_role;
revoke execute on function public.quota_add_credits(uuid, text, integer, text, boolean) from public, anon, authenticated;


-- 3. Backfill legacy purchased balances --------------------------------------
-- bonus_minutes.balance is in MINUTES (the old ledger's unit); the wallet is
-- seconds. Guarded by to_regclass so this is a no-op where the table never
-- existed, and each backfill writes an 'adjust' ledger row for audit. The
-- not-exists check makes re-runs idempotent.
do $$
begin
    if to_regclass('public.bonus_minutes') is not null then
        -- Create missing wallet rows at ZERO first — inserting the balance
        -- here AND adding it in the UPDATE below would double-credit.
        insert into public.user_quota (user_id, tier)
        select b.user_id, 'free'
          from public.bonus_minutes b
         where b.balance > 0
        on conflict (user_id) do nothing;

        update public.user_quota q
           set credit_balance_seconds = q.credit_balance_seconds
                                      + floor(b.balance * 60)::integer,
               updated_at = now()
          from public.bonus_minutes b
         where b.user_id = q.user_id and b.balance > 0
           and not exists (
               select 1 from public.quota_ledger l
                where l.user_id = b.user_id and l.kind = 'adjust'
                  and l.note = 'legacy bonus_minutes backfill'
           );

        insert into public.quota_ledger (user_id, kind, credit_seconds, note)
        select b.user_id, 'adjust', floor(b.balance * 60)::integer,
               'legacy bonus_minutes backfill'
          from public.bonus_minutes b
         where b.balance > 0
           and not exists (
               select 1 from public.quota_ledger l
                where l.user_id = b.user_id and l.kind = 'adjust'
                  and l.note = 'legacy bonus_minutes backfill'
           );
    end if;
end $$;
