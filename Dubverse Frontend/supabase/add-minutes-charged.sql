-- ============================================================
-- jobs.minutes_charged Migration
-- Run in Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================
--
-- The backend reserves monthly minutes when a job is created and refunds them
-- if that job later fails or is cancelled. The amount reserved is carried on
-- Job.minutes_charged, and the refund in job_manager.update_job_status is the
-- only thing that reads it.
--
-- Until this column existed the value lived only in process memory, so a
-- restart erased the record and a job that failed afterwards refunded nothing.
-- The column is now part of the jobs upsert payload: without it, every write
-- to `jobs` fails on an unknown column, which takes down job persistence
-- entirely rather than just the refund.
--
-- Nullable by design. NULL means "nothing outstanding" — the refund clears the
-- claim on success, and restores it on failure so it can be retried.

alter table public.jobs
  add column if not exists minutes_charged integer;

-- Finds jobs whose reservation was never returned: terminal, but still holding
-- a claim. Under normal operation this is empty.
create index if not exists idx_jobs_unrefunded
  on public.jobs (status)
  where minutes_charged is not null;
