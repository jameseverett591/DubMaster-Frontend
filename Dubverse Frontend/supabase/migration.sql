-- ============================================================
-- DubMaster Supabase Schema Migration
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. Custom types
create type public.plan_type as enum ('basic', 'premium', 'professional');
create type public.subscription_status as enum ('active', 'canceled', 'past_due', 'trialing');

-- 2. Profiles (extends auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  avatar_url text,
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Subscriptions
create table public.subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  plan_type public.plan_type not null default 'basic',
  status public.subscription_status not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_subscriptions_user_id on public.subscriptions(user_id);
create index idx_subscriptions_stripe_customer on public.subscriptions(stripe_customer_id);
create index idx_subscriptions_stripe_sub on public.subscriptions(stripe_subscription_id);

alter table public.subscriptions enable row level security;

create policy "Users can view own subscriptions"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Only service role can insert/update/delete subscriptions (via webhooks)
create policy "Service role manages subscriptions"
  on public.subscriptions for all
  using (auth.role() = 'service_role');

-- 4. Usage tracking
create table public.usage (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  month date not null,
  minutes_used integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, month)
);

create index idx_usage_user_month on public.usage(user_id, month);

alter table public.usage enable row level security;

create policy "Users can view own usage"
  on public.usage for select
  using (auth.uid() = user_id);

create policy "Service role manages usage"
  on public.usage for all
  using (auth.role() = 'service_role');

-- 5. Payments
create table public.payments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  stripe_payment_id text,
  amount integer not null,
  currency text default 'usd',
  status text not null,
  invoice_url text,
  created_at timestamptz default now()
);

create index idx_payments_user_id on public.payments(user_id);

alter table public.payments enable row level security;

create policy "Users can view own payments"
  on public.payments for select
  using (auth.uid() = user_id);

create policy "Service role manages payments"
  on public.payments for all
  using (auth.role() = 'service_role');

-- 6. Bonus minutes (carry-over balance for overage packs)
create table public.bonus_minutes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null unique,
  balance integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_bonus_minutes_user_id on public.bonus_minutes(user_id);

alter table public.bonus_minutes enable row level security;

create policy "Users can view own bonus minutes"
  on public.bonus_minutes for select
  using (auth.uid() = user_id);

create policy "Service role manages bonus minutes"
  on public.bonus_minutes for all
  using (auth.role() = 'service_role');

-- 6b. Bonus minutes ledger (purchase history / audit trail)
create table public.bonus_minutes_ledger (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  amount integer not null,
  source text not null,
  stripe_payment_id text,
  created_at timestamptz default now()
);

create index idx_bonus_ledger_user_id on public.bonus_minutes_ledger(user_id);

alter table public.bonus_minutes_ledger enable row level security;

create policy "Users can view own bonus ledger"
  on public.bonus_minutes_ledger for select
  using (auth.uid() = user_id);

create policy "Service role manages bonus ledger"
  on public.bonus_minutes_ledger for all
  using (auth.role() = 'service_role');

-- 7. Helper function: get current subscription for a user
create or replace function public.get_user_subscription(p_user_id uuid)
returns public.subscriptions as $$
  select *
  from public.subscriptions
  where user_id = p_user_id
    and status in ('active', 'trialing')
  order by created_at desc
  limit 1;
$$ language sql security definer;

-- 7. Helper function: get current month usage
create or replace function public.get_user_usage(p_user_id uuid)
returns integer as $$
  select coalesce(minutes_used, 0)
  from public.usage
  where user_id = p_user_id
    and month = date_trunc('month', now())::date
  limit 1;
$$ language sql security definer;
