# P6 · Cron run-log retention and purge — evidence (D1, T1)

**Gate (GATE_REGISTER P6):** "`cron.job_run_details` retention set to 24–48 hours; purge runs in bounded batches; the table is no longer among the ten largest in the database." Baseline (production): 202,082 rows, 76 MB of 135 MB.

**Staging today** (Supabase MCP, read-only, 2026-10-04 08:25 UTC):
- 135,831 rows, 188 MB of a 224 MB database: **the #1 relation**.
- 107,676 rows are older than 36 h.
- The only purge is `purge-cron-history`, which is not in git: daily, one unbounded 7-day `DELETE`.
- 90 % of the rows come from the failing 5-second `process-post-jobs` (F-P5-1). **P5 removes the inflow and P6 removes the stock.**

| Clause | Change | Proof |
|---|---|---|
| Retention 24–48 h | `public.purge_cron_run_details(_keep 36 h)` refuses a `_keep` outside 24–48 h | **Build:** `scripts/db-p6-cron-history-check.mjs` + self-test (11), CI `d1-p6-cron-history.yml`. It is **red on staging's tree** (no purge job or procedure in git) and green with `20261004_0004`. **Live:** `PROBE_p6_cron_history.sql` fails on staging's state and on any finished run older than 49 h |
| Bounded batches | `DELETE … LIMIT 5,000` with a **COMMIT per batch**, at most 200 batches per run, hourly at :17 | Harness: 23,456 rows take 5 batches and 5 transaction ids, one per batch. **Real pg_cron 1.6 runs the `CALL` to completion**. The procedure refuses to run inside a transaction block |
| Not among the ten largest | One-time `20261004_0005`: purge, then `VACUUM (FULL)` | Harness: after a 1,000,000-row backlog (894 MB, #1), `0004` + `0005` leave 5,102 rows / **4.2 MB, #11**, next to ten 13 MB stand-ins for launch member tables. Applying 200,000 old rows (production's baseline) took 1.9 s, 41 batches |

**Two defects the harness caught before review:**
1. `SET search_path` on a procedure makes `COMMIT` fail ("invalid transaction termination"). It was removed, and every name is schema-qualified (comment in the file).
2. A plain `DELETE` frees space inside the file but does not return it. After the cron purge the rows were gone and the file was still 1.9 GB. That is why `0005` runs `VACUUM FULL`.

**Clause 3 on the real lanes is read by the PROBE after `0005`.** On staging it depends on P5 also landing: the 36 h window holds about 28 MB at today's 5-second cadence and about 5 MB after P5. The ten-largest rule is relative, so on a seeded launch database (P20) 5 MB is far below the member tables.

## Findings
- **F-P6-1:** `cron.job_run_details.command` stores each job's full command on every run. On staging three jobs carry literal secrets in their command (x-cron-secret / x-scheduled-posts-secret, plus the anon key), so those values are copied into every run row. The purge shortens their life to 36 h, and moving the secrets to the vault is P9's design. (The values are deliberately not reproduced here.)
- **F-P6-2:** the ACL on `cron.job_run_details` gives PUBLIC `rd` (SELECT, DELETE). That is pg_cron's default and is filtered by its RLS policy (each user sees their own rows). Recorded for SEC; not changed here.
