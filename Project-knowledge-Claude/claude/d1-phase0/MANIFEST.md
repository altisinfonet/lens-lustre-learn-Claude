# D1 · Phase 0 · courier manifest — revision 2, 2026-09-02

Deviation **D1-DEV-01** (courier in place of push): this clone's push URL is the literal `DISABLED_NO_PUSH_AUTHORITY`, measured again 2026-09-02 before this revision. Every file below was written to the Project with `local_path`; no file's bytes passed through the session. **I verified the source bytes, not the stored copies** — the Auditor's hash check on read-back is the verification.

Base for all three branches: `origin/staging` = `ef5d4a3790ec9f19c0ffe5ea9f4e533472ecfc95` (Gate Register Revision 2).

## Three branches, three PRs (0-D1-04), all targeting `staging`

| PR | branch | commit | tree | files | lands |
|---|---|---|---|---|---|
| **1** · 0-D1-01 | `d1/P0-db-baseline-20260902` | `dfd268f19727078380013857b2d2c3f7e54ac035` | `71cba423181d406a063bbc332ce4c3521f0b6f5e` | 5 | first |
| **2** · 0-D1-02 | `d1/P0-addendum-recheck-20260902` | `30fbb939171157a49b2dde724dd07ce39f8d6296` | `8892363d7b45b06e5b248f776fe5106576a41b71` | 1 | independent |
| **3** · 0-D1-03 | `d1/P0-db-seed-staging-20260902` | `839c6534357be8229b0c0a2d9d12025746179d23` | `b14303a3762f70ebf2b134a4d217abd85fced924` | 4 | **stacked on PR 1** — the seeder imports `scripts/db-lane-guard.mjs` |

A branch rebuilt from the files at the paths below, off that base, reproduces the tree hash. That is the end-to-end check; the per-file hashes are the itemised one.

## Files — project doc → repository path

| PR | project doc (`claude/d1-phase0/`) | repository path | bytes | sha256 |
|---|---|---|---|---|
| 1 | `db-lane-guard.mjs` | `scripts/db-lane-guard.mjs` | 11,017 | `b0d7f46a13bceffe63b1df96e97cedf6dd20b5b4b84209776756ab959828a9aa` |
| 1 | `db-baseline.mjs` | `scripts/db-baseline.mjs` | 47,378 | `6780d50333c0ae099f910baadfc874a7adc6bb133a16645a94474f720becc374` |
| 1 | `db-baseline.test.mjs` | `scripts/db-baseline.test.mjs` | 12,681 | `846dec5e34138a7e51cf979e9b24b3f23ef50ec9d6ccbcf3c93a14c2da5a58e9` |
| 1 | `d1-baseline.yml` | `.github/workflows/d1-baseline.yml` | 7,058 | `432b8f2ac6f83a50628a4e01249ad6560cecb99694e2e309f4791eb5c0b7a9d1` |
| 1 | `d1-guard-check.yml` | `.github/workflows/d1-guard-check.yml` | 5,646 | `dc777f3fbb454e27249ae062cbca861aa9c0dbf516ca5d055f5a00ac07b7acd2` |
| 2 | `addendum-recheck.md` | `docs/evidence/d1/baseline/addendum-recheck.md` | 18,359 | `2d40f532ce9f2b7760feea3b7ac8c0f283849f9c3089fac2d35cf1c77c564457` |
| 3 | `db-seed-staging.mjs` | `scripts/db-seed-staging.mjs` | 23,807 | `67e97ab646ed3cd97533b2156001b5d5deba86c01f66986555a7898640ec24dd` |
| 3 | `db-seed-staging.test.mjs` | `scripts/db-seed-staging.test.mjs` | 10,039 | `4931c512c3dba0f9200e3537d217533ccfa2e194a4a9cde77ac9557536241774` |
| 3 | `d1-seed-staging.yml` | `.github/workflows/d1-seed-staging.yml` | 7,024 | `2e7348ada1a219b95ef28ea25cace4ca8a90d69f40e9de369d515ac7411a5845` |
| 3 | `d1-seeder-guard-check.yml` | `.github/workflows/d1-seeder-guard-check.yml` | 5,964 | `2174e2ba2ed2203c8113ef2d0934e4da220d329c94988609e50c20413b6ad220` |

## What changed since the revision-1 upload (the flat seven of earlier today)

| doc | change |
|---|---|
| `db-lane-guard.mjs`, `d1-baseline.yml` | unchanged — same hash |
| `db-baseline.mjs` | probe S1 classifies every definer function **trigger / guarded / unguarded** with the rule emitted beside each row (0-D1-01's wording); S1b counts by class |
| `db-baseline.test.mjs` | seeder cases moved out to their own file so PR 1 runs alone; covers `d1-guard-check.yml` |
| `db-seed-staging.mjs` | **`--ack-enqueue-jobs`** added — a refusal distinct from `--yes`, before any write, by the Auditor's instruction; the artefact records both acknowledgements |
| `d1-seed-staging.yml` | boolean input `acknowledge_enqueue_jobs`, passed to the script only when ticked |
| `addendum-recheck.md` | **new path** (the plan's), one row per figure for every listed P-unit; supersedes `ADDENDUM_RECHECK_2026-09-02.md`, which stays in the Project as the earlier record and is not deleted |
| `d1-guard-check.yml`, `d1-seeder-guard-check.yml`, `db-seed-staging.test.mjs` | new |

`ADDENDUM_RECHECK_2026-09-02.md` in this folder is **superseded** by `addendum-recheck.md` and should not be landed.

## PR bodies (§3.3 shape) — unit · gate verbatim · paths · objects reserved · evidence path · cause/symptom

**PR 1 · 0-D1-01** · Gate: *"JSON committed under `docs/evidence/d1/baseline/` with a UTC measurement timestamp on every line."* · Paths: the five above · Objects reserved: **none (read-only)** · Evidence: `docs/evidence/d1/baseline/<lane>/baseline-<UTC>.json` — **not yet produced; BLOCKED on `SUPABASE_DB_URL`** · Cause: n/a, instrument only.

**PR 2 · 0-D1-02** · Gate: *"Disagreements are recorded, not resolved. A figure that moved is a finding, not an error to tidy."* · Path: `docs/evidence/d1/baseline/addendum-recheck.md` · Objects reserved: **none** · Evidence: the file itself; instrument Supabase MCP `execute_sql`, SELECT only, production, 2026-09-02 06:38–06:57Z and 11:42–11:46Z.

**PR 3 · 0-D1-03** · Gate: *"The guard is demonstrated failing against the production ref before the seeder is accepted."* · Paths: the four above · **Seeder table reservation (Auditor's amendment): `public.posts`, only** · Evidence: `d1-seeder-guard-check.yml`'s printed refusal on the PR (no credential needed); `docs/evidence/d1/baseline/seeder-run.json` **does not exist — BLOCKED, the staging credential fails authentication**. Stated limitation: members / roles / votes are not seeded; creating members means `auth.users` rows, an Owner decision.
