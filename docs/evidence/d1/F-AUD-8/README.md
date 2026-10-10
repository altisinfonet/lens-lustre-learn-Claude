# F-AUD-8 · SEC-P9-2 rotation support (D1, T1)

Rotates the **cron secret** (`x-cron-secret`, Edge secret `CRON_SECRET`) and/or the **service key** in every database copy, without a value ever appearing in SQL text, a file, `cron.job`, `cron.job_run_details`, the server log or `pg_stat_statements`.

## Files
| file | what |
|---|---|
| `supabase/migrations/20261010_0001_faud8_cron_credential_rotate.sql` | rotate (re-runnable, one run per rotation) |
| `supabase/rollback/20261010_0001_…_ROLLBACK.sql` | put every changed copy back byte for byte (only before 0002) |
| `supabase/migrations/20261010_0002_faud8_cron_credential_finalize.sql` | delete the way back + run-history rows holding a retired value (contract step) |
| `supabase/rollback/20261010_0002_…_ROLLBACK.sql` | refuses by design (restoring revoked credentials is the exposure) |
| `supabase/migrations/PROBE_faud8_cron_credentials.sql` | read-only; SHA-256 comparison only |

## Copies covered (selected by name prefix, so each lane's own set)
`p9_cron_http:<job>` (live targets: 0003's six, 0006 process-email-queue, P5-b publish-scheduled-posts) and `p9_cron_previous:<job>`.
Staging read 2026-10-10 07:5x UTC: 4 + 4 (incl. publish-scheduled-posts, which also carries the service key). Production: up to 8 + 8.

## Decision: `p9_cron_previous:*`
Rewritten, never left stale or deleted. Same key form → the old value is replaced in the stored command text (inline vault reads stay inline). JWT ↔ `sb_secret_` → rebuilt from the new live target. Either way the rewritten command, evaluated, must equal the new live target (PREV-001). A later 0003/0006/0007 rollback then restores a **working** job with the new credentials (shown in step 6 with the real 0003 rollback), no longer the byte-exact pre-P9 command.

## Key forms
- legacy JWT: same headers, `Bearer` kept; must be `role = service_role` and the same `ref` as the old key (refuses an anon key or another project's key).
- `sb_secret_`: not a JWT. Supabase rejects `Authorization: Bearer sb_secret_…` as "Invalid JWT", so the key moves to the `apikey` header and the Bearer header is removed. **Outside the database:** every called function must then run with `verify_jwt = false` (D2 / Owner).

## Order on a lane
1. Owner: set the new value where functions read it (Edge secret `CRON_SECRET`; new key in Settings → API Keys). Keep the old key active.
2. Owner: Dashboard → Vault → Add secret: `faud8_new:cron_secret` and/or `faud8_new:service_key` (value only, no spaces or line breaks).
3. Auditor: dispatch `20261010_0001` → check the next run of a moved job answers 2xx.
4. Auditor: dispatch `20261010_0002` → `PROBE_faud8_cron_credentials.sql`.
5. Owner: revoke the old key.
If step 3 fails: dispatch the 0001 rollback (only while the old values still work).

## Evidence
`faud8-run-tests.sh` → `faud8-transcript.txt`: 129 PASS / 0 FAIL, staging + production shapes (PG 16 + pg_cron 1.6, vault/pg_net stubbed with real signatures; copies made by the real 0003).
Covers: fail-first, 11 refusals (each changes nothing), rotate → rollback → rotate → finalize → PROBE, 6 PROBE mutants, the real 0003 rollback, JWT→`sb_secret_`→`sb_secret_`, and the log / pg_stat_statements check with positive controls.
Real staging (read-only, 07:5x UTC): vault 0.3.1 `update_secret` present; PROBE scan 13,641 candidates / 600 sources in 0.6 s on PG 17.6; CONTAIN-001 would name nothing.
