# P9 → P5-b · the e-mail queue woken by an event — evidence (D1, T1) · `20261004_0006`

**Gates.** GATE_REGISTER **P9**: "the outbound HTTP helper no longer performs an inline `vault.decrypted_secrets` lookup per call" (Addendum: "vault secret decrypted once per worker, not once per message"). **P5** clause 2: "queue workers are woken by an event"; clause 3: "idle back-off is implemented and its effect measured". R-82: design + enforced guard + synthetic test at launch scale.
**Input:** the Owner's production read, 2026-10-04 ~15:10 UTC (`claude/2026-10-04-OWNER-P9-P5-PRODUCTION-READ-result.md`) — A-P9-1 (`process-email-queue`, every 10 s, HTTP whether or not mail is queued, literal service key + `x-cron-secret` in the command) and A-P9-3 (`delete_email` has no queue allow-list; LOW).

## Design
| Before (production) | After 0006 |
|---|---|
| `'10 seconds'` → `select net.http_post(url, headers {literal key, literal secret})` — 8,640 HTTP calls a day idle | **enqueue → wake at commit** (statement trigger on `pgmq.q_auth_emails` / `q_transactional_emails`; pg_net sends after commit, a rolled-back enqueue sends nothing) |
| a backlog drains 20 messages per 10-s tick | **the worker's last delete of a batch wakes the next run** while unclaimed work remains — batches back to back, one worker at a time |
| — | **one outstanding wake**: none while a wake is unread (30-s guard for a lost one), none while a batch is claimed, none while rate-limited; decisions serialised by one advisory lock taken before the queue is read |
| — | **idle back-off**: job `* * * * *` → `email_queue_tick()`: index probes only; HTTP and the vault are touched only when there is unclaimed work |
| secrets as literals in `cron.job` and in every `cron.job_run_details` row (F-P6-1) | the job's own `net.http_post(...)` arguments are **evaluated inside the database** into vault (`p9_cron_http:process-email-queue`) by re-pointing the command at a `pg_temp` function with `net.http_post`'s exact parameters. No person or file sees them. The old job goes to vault too, for an exact rollback |
| `delete_email` reaches any queue | allow-list `transactional_emails`, `auth_emails` (42501 otherwise), like its three siblings |

A wake failure never fails the enqueue: the trigger traps it as a WARNING, and the sweep delivers. On a lane without the job (staging today), 0006 creates none and wakes answer `no target`.

## Proof
| Kind | File | Fails first on |
|---|---|---|
| Build | `scripts/db-p9-cron-http-check.mjs` + self-test (12 cases), CI `d1-p9-cron-http.yml` | production's job **planted as a migration**: H1 (HTTP from cron) + H3 (literal credential); production's `publish-scheduled-posts` shape: H1 + H2 (inline vault) |
| Live | `supabase/migrations/PROBE_p9_email_queue_wake.sql` (read-only, E1–E4) | the pre-0006 state; plus 6 mutants (10-s schedule, HTTP command, trigger disabled, queue re-created without trigger, allow-list removed, anon grant) — each red, each undone |
| Synthetic | `p9-email-run-tests.sh` + `p9-email-fixture.sql` → `p9-email-transcript.txt` | — |

## Synthetic test — scratch PG 17, **real pg_cron 1.6 + real pgmq 1.5.1**; vault and pg_net stubbed with their real signatures; the four e-mail functions verbatim from staging; the edge function simulated by its own calls (`read_email_batch(10, vt 30)`, one `delete_email` per message, each its own transaction)
| Reading | Before | After |
|---|---|---|
| HTTP calls, 30 s idle, real pg_cron | 3 (→ **8,640/day**) | **0** |
| A full idle day (1,440 ticks) | 8,640 HTTP calls + vault reads | **0 HTTP calls, 0 vault decrypts** |
| Literal credential in `cron.job_run_details` | every run | the command is `SELECT public.email_queue_tick();` |
| 1 enqueue | waits up to 10 s | **woken at commit**; a rolled-back enqueue: nothing |
| 50 enqueues, separate transactions | — | **1 wake**; 5 runs deliver all 50; the sweep never used |
| 500 in one statement | 20 per 10-s tick → ≥ 250 s | **1 wake, 50 runs back to back**, all 500 sent |
| enqueue while a batch is claimed | — | no second worker; that batch's **last** delete wakes the next; all delivered |
| rate-limited / lost wake / pg_net failing | — | no call / retried after 30 s, not before / enqueue still commits (WARNING), next tick delivers |
| rollback | — | lane-guarded; job and `delete_email` restored **byte for byte**; triggers and vault secrets gone; PROBE red again |

## What this unit does not do (stated)
- The edge function is unchanged.
- **P9-c (OPEN):** the other HTTP cron jobs on production (`apply-scheduled-boosts`, `autoscale-ad-traffic`, `expire-gift-credits`, `judging-invariants-nightly`, `send-reengagement-emails`, `backup-reminder`) still carry literal headers; the PROBE names them in its PASS line. The same in-database capture moves them, one migration, when ordered.
- `push_on_notification()` reads its secret from `public.push_config`, not vault — a separate P9 item for the Auditor.
- **For the Auditor (P9 wording):** the vault is read once per HTTP call actually made, never per tick and never per message; the gate's "per call" cost goes from 8,640 a day to the number of real wakes.
