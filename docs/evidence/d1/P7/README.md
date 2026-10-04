# P7 · Schema-cache reload discipline — evidence (D1, T1)

**Gate (GATE_REGISTER P7):** "no schema-cache reload is triggered outside a deployment; the introspection queries' share of database time is re-measured and recorded."

**R-82 (Owner, 2026-10-04):** the traffic half is proved by design + an enforced guard + a synthetic test, not by a production reading.

## How a reload happens
PostgREST re-runs its whole schema introspection whenever it hears `NOTIFY pgrst`. On Supabase, two event triggers send it; both bodies were read verbatim from staging on 2026-10-04:
- `extensions.pgrst_ddl_watch` fires on create/alter of schemas, tables, views, functions, triggers, types and rules, and on `COMMENT`.
- `extensions.pgrst_drop_watch` fires on dropping any of those.

`pg_temp` objects are exempt from both. A migration's DDL is the deployment, and one reload then is correct. DDL that runs inside a function, a procedure or a cron command reloads the cache on every call.

## The guard (two halves)
| Half | What it judges | Where |
|---|---|---|
| Build time | The last definition of every function, procedure and cron job in git, under rules A (static DDL), B (dynamic DDL) and C (`NOTIFY pgrst`), with a reasoned allow-list (empty) | `scripts/db-p7-runtime-ddl-check.mjs`, run by `.github/workflows/d1-p7-runtime-ddl.yml`, which runs the self-test (29 cases) first |
| Live | Every public function and procedure in the database, plus every `cron.job` command, under the same rules | `supabase/migrations/PROBE_p7_no_runtime_ddl.sql` (read-only, ends in ROLLBACK) |

## Results (transcript: `p7-transcript.txt`)
| Test | Result |
|---|---|
| Self-test | 29/29 pass. Every shape that must go red goes red, and every neighbour stays green: temp tables, the words "comment on" in a message, DDL in a comment, and migration-level DDL. |
| Real staging tree | Green. 677 applied migration files, 347 function and procedure definitions, 7 cron jobs. No historic definition had a hit either. |
| **Fail-first, build** | Planting one migration with a runtime `COMMENT ON` turns the check red (exit 1) and names the function. |
| **Synthetic request count** (PG 17.11, Supabase's triggers verbatim) | Runtime DDL: **500 reloads in 500 calls**. The guarded shape (temp table + DML): **0 reloads in 500 calls**. |
| **Fail-first, live PROBE** | It refuses on runtime DDL, dynamic `EXECUTE format('ALTER TABLE …')`, `pg_notify('pgrst', …)` and a cron job running DDL. It passes once those are gone. |
| Staging, live (read-only SELECT of the PROBE's rules via the Supabase MCP, 2026-10-04 08:05 UTC) | **0 hits** among 389 judged objects (376 public functions + 13 cron jobs) |

## Findings
- **F-P7-1:** on staging, 24 live public functions appear in no applied migration. They were created outside git (dashboard or tool), so the build check cannot see them. The live PROBE can, which is why it exists.
- **F-P7-2:** the 10.3 % production baseline is not explained by any runtime DDL in git or on staging. The remaining sources are out-of-git DDL on production (dashboard, Lovable, the Management API). Running the PROBE on production names any live one. A deploy that issues DDL is a deployment, and its reload is allowed by the gate.

## To close on the lanes (Owner dispatch, `apply-migration.yml`)
`supabase/migrations/PROBE_p7_no_runtime_ddl.sql`: on staging, then on production. It is read-only.
