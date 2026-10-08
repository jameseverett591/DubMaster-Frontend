-- Director rulebook: user-scoped global rules carried across every job.
-- The table was created manually in the live project; this migration makes
-- it reproducible for fresh deploys and documents the schema the code in
-- app/services/rulebook.py actually writes (see save_global_rule._COLS).
--
-- Idempotent — safe to run against a project where the table already exists.

create table if not exists public.director_rules (
    id               text primary key,
    user_id          uuid not null references auth.users(id) on delete cascade,
    class            text not null,
    scope            text not null default 'global',
    source_pattern   text not null default '',
    target           text not null default '',
    conditions       jsonb not null default '{}'::jsonb,
    enabled          boolean not null default true,
    inferred         boolean not null default false,
    created_from_job text,
    notes            text not null default '',
    created_at       timestamptz not null default now()
);

create index if not exists director_rules_user_idx
    on public.director_rules (user_id, created_at);

alter table public.director_rules enable row level security;
drop policy if exists "own director rules" on public.director_rules;
create policy "own director rules" on public.director_rules
    for select using (auth.uid() = user_id);
-- Writes go through the service-role client only.
