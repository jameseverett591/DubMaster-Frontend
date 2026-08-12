# DubMaster — Data Retention and Deletion

**Status:** Draft policy — **not yet implemented in code** · **Last updated:** 2026-08-12

This is the largest gap in DubMaster's data protection posture. It is also the
one a studio will probe hardest: *"when does my film stop existing on your
systems?"* The current honest answer is **"it doesn't."**

---

## Current state (verified)

| Data | Where | Retention today |
|---|---|---|
| Source video | Cloudflare R2 | Indefinite |
| Source video (copy) | `data/uploads/<job_id>/` | Indefinite — 73 job directories present |
| Separated vocals / accompaniment | `data/separated/` | Indefinite |
| Velma upload copies | `data/separated/velma_source_*.mp3` | Indefinite, no cleanup |
| Transcripts | `data/transcripts/`, `data/projects/` | Indefinite |
| Dubbed output | `data/dubbed/`, `data/projects/<id>/dubbed/` | Indefinite — files exist back to June |
| Job rows, segments | Supabase | Indefinite |
| Scene context | `data/velma/<job_id>.json` | Indefinite |

**There is no code path that deletes a customer's content.** The only deletion
logic that existed (`_delete_runpod_file`) was removed on 2026-08-11 because it
was deleting the wrong thing — the user's own source object — and nothing has
replaced it.

A partial expiry exists for saved projects (`9eeaa673`, "Cap and expire saved
projects"). **UNVERIFIED** whether it removes underlying media or only the
project record. This must be confirmed before the policy below is published.

---

## Proposed policy

### Retention periods

| Class | Period | Rationale |
|---|---|---|
| Source video | 30 days after last job activity | Long enough to re-dub without re-upload |
| Intermediate artefacts (vocals, accompaniment, per-segment audio, Velma uploads) | 7 days after job completion | Derived data, cheaply regenerated |
| Dubbed output | 90 days, or until the user deletes the project | The deliverable — the customer's reason to return |
| Transcripts and scene context | With the project | Small, and the user's editorial work |
| Job metadata (Supabase) | Retained; anonymised on account deletion | Needed for billing history |
| Billing records | 7 years | Statutory accounting retention |

### On user-requested project deletion

Must remove, in one operation:
1. R2 object
2. `data/uploads/<job_id>/`
3. `data/separated/<job_id>_*`
4. `data/transcripts/<job_id>.json`, `data/velma/<job_id>.json`
5. `data/projects/<job_id>/` including `dubbed/`
6. `data/dubbed/<job_id>/`
7. Supabase job rows, segment rows, speaker rows

### On account deletion (GDPR Art. 17)

All of the above for every job, plus the user record. Billing records are
retained under statutory obligation and anonymised where possible — this
exception must be stated in the privacy notice.

### Subprocessor deletion

Deleting our copy is not enough. For each active subprocessor, record whether
they retain inputs and for how long, and whether deletion can be requested.
Several AI vendors retain inputs for abuse monitoring by default; some offer
zero-retention modes. **This must be checked per vendor and written down** — a
studio will ask.

---

## Implementation notes

- Deletion must be **idempotent and best-effort per target**: a missing R2
  object should not prevent local cleanup. The `_delete_runpod_file` incident is
  the cautionary tale — deletion keyed on an assumption about ownership, with no
  check that the object was ours to delete.
- Deletion must be **logged** (what, when, by whom) — that log is the evidence a
  compliance framework asks for.
- Expiry should run as a scheduled sweep, not inside a request path.
- Build **deletion before automatic expiry**. A user-triggered delete that works
  is worth more than a cron job that might remove the wrong thing.

---

## Priority

Ahead of any compliance tooling. Vanta will flag the absence of a retention
policy, but it cannot write the deletion code — and until that code exists,
every framework answer here is aspirational.
