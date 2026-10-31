# P9-c · the last six HTTP cron jobs: target and secrets into vault (D1, T1) · `20261005_0003`

**Gate.** GATE_REGISTER P9, ruled in R-95: the vault is read once per real HTTP call, with no secret in a cron command. Also SEC-P9-4 and F-P6-1 (literals copied into `cron.job_run_details` on every run).

**What is there today:**
- **Production** (Owner's read, 2026-10-04): `apply-scheduled-boosts` (`*/5`), `autoscale-ad-traffic` (`0 */6`), `expire-gift-credits` (`15 0`), `judging-invariants-nightly` (`0 2`), `send-reengagement-emails` (`0 9`) and `backup-reminder` (`0 8 * * 1`). Each is `select net.http_post(url, headers {Authorization: <service key literal>, x-cron-secret: <literal>})`.
- **Staging** (read-only, 2026-10-05): the first three, same shape. A live read returns exactly those three as the only jobs with HTTP in the command plus a long literal. That is the fail-first reading.

## Design (same capture as 0006/0007)
- **Capture into vault.** Each job's own `net.http_post(...)` arguments are evaluated once, in-database, into vault `p9_cron_http:<job>`. The previous job goes to `p9_cron_previous:<job>`, for a byte-exact rollback.
- **Same schedule, new command.** The job keeps its schedule and becomes `SELECT public.cron_http_call('<job>');`.
- **Missing target raises.** If the vault target is missing, `cron_http_call` raises, so the run shows as failed instead of being silently skipped. It refuses a malformed name. It is SECURITY DEFINER and revoked from the API roles.
- **Absent jobs are skipped.** A job not on the lane gets a NOTICE; no job is created.
- **Refusals that change nothing:**
  - another command shape (PRE-002, the job is named, its command is never printed);
  - a non-edge-function url (MOVE-001);
  - a NULL header, meaning an inline vault secret missing on that lane (MOVE-002).
- **Whole-lane check.** `PROBE_p9c_cron_http.sql` C2 judges **every** job on the lane. Once 0006 and 0007 are applied too, it reads as P9 closed for that lane.

## Proof — `p9c-run-tests.sh` → `p9c-transcript.txt` (ALL CASES PASS)
Scratch PG 17 with real pg_cron 1.6; vault and pg_net stubbed with their real signatures; invented credentials.

| Reading | Before | After |
|---|---|---|
| PROBE | refuses (not installed) | passes; C2 reads 7 jobs, and `rollup-engagement-daily`'s short literals are not a hit |
| Real scheduler run of `backup-reminder` | its history row **holds the literal credential** | run succeeded; **0** history rows hold it; the call was made |
| The six commands executed | 6 calls, md5 `71f3f85e…` | **byte-identical** requests (url, headers, body, timeout) |
| Schedules | — | all six unchanged |
| PROBE mutants (each red, each undone) | — | a job put back to literal HTTP · a NEW job with an inline vault read · a vault target deleted · `authenticated` granted |
| Rollback | — | lane-guarded; **all six byte for byte**; vault and function gone; PROBE red |
| Staging shape (3 of 6) | — | 3 moved, 3 skipped, none created; PROBE passes; rollback exact |
| Refusals | — | missing inline secret → MOVE-002, nothing changed · another shape → PRE-002 naming the job |

**Rotation (SEC-P9-2), for the Owner after this reaches production:** rotate `x-cron-secret` and the service key, then update the `p9_cron_http:*` vault secrets. D1 never handles them.
**Finding F-D1-2 (minor):** the OPEN list in 0006's PROBE uses the older literal regex, which can name a job whose two short literals sit 17+ characters apart. It is informational only; this PROBE's C2 uses the correct in-order literal scan.
