-- Free tier bump: 3 min/month -> 5 min/month.
--
-- quota_included_seconds is the single source of truth that quota_touch /
-- quota_deduct / quota_lipsync_deduct use for the included cap. 300 keeps it
-- in step with FREE_INCLUDED_SECONDS in app/services/quota_service.py —
-- the Python constant drives the UI math, this drives the actual debits.
-- Run in the Supabase SQL editor; create-or-replace is a no-downtime swap.

create or replace function public.quota_included_seconds(p_tier text)
returns integer language sql stable as $$
    select case p_tier when 'pro' then 1800 else 300 end;
$$;

revoke execute on function public.quota_included_seconds(text) from public, anon, authenticated;
grant  execute on function public.quota_included_seconds(text) to service_role;
