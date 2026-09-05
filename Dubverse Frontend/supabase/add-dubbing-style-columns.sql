-- ============================================================
-- jobs.dubbing_style / localized_aliases Migration
-- Run in Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================
--
-- The backend now persists the requested dubbing style and any per-job
-- localized name/role mappings on the Job object and writes them through
-- _upsert_job. Without these columns every job upsert fails, so the jobs
-- row is never created, which then cascades into a segments_job_id_fkey
-- failure when the pipeline tries to persist segment metadata.
--
-- dubbing_style: "natural" (localized/natural English dub) or "literal"
--                (word-for-word preservation of romanization).  Defaults
--                to "natural" for rows that pre-date this feature.
-- localized_aliases: optional JSONB map of source -> target names/roles
--                      (e.g. {"根哥": "Broker", "三姑": "Auntie"}).

alter table public.jobs
  add column if not exists dubbing_style text default 'natural';

alter table public.jobs
  add column if not exists localized_aliases jsonb;
