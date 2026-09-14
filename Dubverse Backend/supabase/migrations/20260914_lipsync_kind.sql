-- Lip-sync billing: a real 'lipsync' ledger kind so billing history is
-- readable without parsing job_id strings, and so quota_refund sees
-- lip-sync debits.
--
-- Run in the Supabase SQL editor (service role). Idempotent.
--
-- Three coupled changes, in this order:
--   1. quota_ledger.kind check constraint gains 'lipsync' — without this the
--      new debit rows violate the constraint and every lip-sync charge fails.
--   2. quota_deduct gains p_kind (default 'render') and inserts it. The
--      parameter list changes, so the old signature is dropped first and the
--      service_role grant is re-issued.
--   3. quota_refund widens its sum filter to ('render','lipsync','refund') —
--      without this a 'lipsync' debit is invisible to the refund RPC and a
--      rejected lip-sync pass would silently never be credited back.


-- 1. Widen the kind check constraint ---------------------------------------
alter table public.quota_ledger
    drop constraint if exists quota_ledger_kind_check;
alter table public.quota_ledger
    add constraint quota_ledger_kind_check
    check (kind in ('render', 'lipsync', 'refund', 'deposit', 'adjust', 'period_reset'));


-- 2. quota_deduct with a kind parameter ------------------------------------
-- create or replace cannot change the parameter list, so drop the old
-- 4-arg signature first. Existing callers keep working: p_kind defaults to
-- 'render', which is exactly what the old body hardcoded.
drop function if exists public.quota_deduct(uuid, text, integer, text);

create or replace function public.quota_deduct(
    p_user_id uuid, p_tier text, p_seconds integer, p_job_id text,
    p_kind text default 'render'
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

    -- Debit kinds only. 'refund'/'deposit' have their own functions; letting
    -- an arbitrary kind through would poison the refund sum.
    if p_kind not in ('render', 'lipsync') then
        raise exception 'quota_bad_kind: %', p_kind;
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
    values (p_user_id, p_job_id, p_kind, -from_incl, -from_cred);

    return query
        select from_incl, from_cred,
               incl_left - from_incl,
               r.credit_balance_seconds - from_cred;
end $$;

grant execute on function public.quota_deduct(uuid, text, integer, text, text) to service_role;


-- 3. quota_refund sees lip-sync debits --------------------------------------
-- Only the sum filter changes: 'lipsync' joins 'render' so a lip-sync debit
-- under its own job_id key refunds cleanly, and 'refund' stays so repeat
-- calls remain idempotent.
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
     where l.user_id = p_user_id and l.job_id = p_job_id
       and l.kind in ('render', 'lipsync', 'refund');

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


-- 4. Close the default PUBLIC grant -----------------------------------------
-- Postgres grants EXECUTE on new functions to PUBLIC by default, and a
-- SECURITY DEFINER function that trusts caller-supplied user/tier/amount
-- values is an open debit of anyone's wallet via the anon key. Revoke from
-- PUBLIC/anon/authenticated on ALL quota RPCs — not just the two recreated
-- here; quota_touch and quota_add_credits carried the same exposure from
-- 20260912 — and leave only the service_role grant.
revoke execute on function public.quota_deduct(uuid, text, integer, text, text) from public, anon, authenticated;
revoke execute on function public.quota_refund(uuid, text)                          from public, anon, authenticated;
revoke execute on function public.quota_touch(uuid, text)                           from public, anon, authenticated;
revoke execute on function public.quota_add_credits(uuid, text, integer, text)      from public, anon, authenticated;
revoke execute on function public.quota_included_seconds(text)                      from public, anon, authenticated;
