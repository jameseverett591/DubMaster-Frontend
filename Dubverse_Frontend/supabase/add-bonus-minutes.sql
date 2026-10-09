-- ============================================================
-- Bonus Minutes Migration (run AFTER initial migration.sql)
-- Adds overage/bonus minutes system for one-time purchases
-- Run in Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- 1. Bonus minutes balance (one row per user, carries over forever)
create table if not exists public.bonus_minutes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null unique,
  balance integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_bonus_minutes_user_id on public.bonus_minutes(user_id);

alter table public.bonus_minutes enable row level security;

create policy "Users can view own bonus minutes"
  on public.bonus_minutes for select
  using (auth.uid() = user_id);

create policy "Service role manages bonus minutes"
  on public.bonus_minutes for all
  using (auth.role() = 'service_role');

-- 2. Bonus minutes ledger (audit trail of all purchases/deductions)
create table if not exists public.bonus_minutes_ledger (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  amount integer not null,
  source text not null,
  stripe_payment_id text,
  created_at timestamptz default now()
);

create index if not exists idx_bonus_ledger_user_id on public.bonus_minutes_ledger(user_id);

alter table public.bonus_minutes_ledger enable row level security;

create policy "Users can view own bonus ledger"
  on public.bonus_minutes_ledger for select
  using (auth.uid() = user_id);

create policy "Service role manages bonus ledger"
  on public.bonus_minutes_ledger for all
  using (auth.role() = 'service_role');

-- 3. Helper: get bonus balance for a user
create or replace function public.get_user_bonus_minutes(p_user_id uuid)
returns integer as $$
  select coalesce(balance, 0)
  from public.bonus_minutes
  where user_id = p_user_id
  limit 1;
$$ language sql security definer;
