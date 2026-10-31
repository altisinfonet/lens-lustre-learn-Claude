# P5 · Polling replaced by events — evidence (D1, T1) · this PR is **P5-a**

**Gate (GATE_REGISTER P5):** "no scheduled job runs more often than once a minute unless it is demonstrably saturated; queue workers are woken by an event; idle back-off is implemented and its effect measured."

**R-82 (Owner, 2026-10-04):** the gate is proved by design, an enforced guard and a synthetic test at launch scale, not by a traffic reading.

| Clause | This PR | Proof |
|---|---|---|
| 1 · nothing more often than once a minute | `process-post-jobs` goes from `5 seconds` to `* * * * *` (20261004_0002) | **Build:** `scripts/db-p5-cron-cadence-check.mjs` + self-test (13 cases), CI `d1-p5-cron-cadence.yml`. **Live:** `PROBE_p5_cron_cadence.sql`, which **fails first** on the staging state and passes after |
| 2 · queue workers woken by an event | **NOT MET here — P5-b.** A database cannot start a worker at commit without an outside caller. The design: the enqueue sends a debounced pg_net wake to an edge-function worker, plus this once-a-minute job as the safety net. The wake needs a secret, so it is built with P9 | — |
| 3 · idle back-off, effect measured | `drain_post_jobs()`: no queue, or nothing visible after one index probe → return at once. Otherwise it drains in batches until a batch comes back short or the 20 s budget is spent | Synthetic test below |

## Synthetic test (`p5-transcript.txt`): scratch PG 17.11, **real pg_cron 1.6 and real pgmq 1.5.1**. The job and `process_post_jobs()` are verbatim from staging.
| Reading | Before | After |
|---|---|---|
| Real pg_cron runs in a 30 s idle window | 5 (≈ 17,280/day by schedule) | **1** (1,440/day) |
| Work done by an idle run | `pgmq.read` + batch loop on every run | **one index probe**; `process_post_jobs()` called **0** times (the positive control on the same counter sees 51) |
| A burst of 5,000 messages | 100 per run → 50 runs ≈ 4 min 10 s at 5 s cadence | **one run: 5,000 processed, 51 batches, 323 ms** |
| Queue absent (staging today) | the job errors | `{idle: true, reason: queue post_jobs does not exist}` |
| Rollback | — | lane-guarded; restores the saved schedule and command **byte for byte**; the PROBE fails again; re-apply works |

## Findings
- **F-P5-1 (staging, read-only, 08:07 UTC):** all **122,591** runs of `process-post-jobs` since 2026-09-27 **FAILED** with "job startup timeout", and the queue `post_jobs` does not exist on staging. These runs are 90 % of `cron.job_run_details` (feeds P6).
- **F-P5-2:** `process-post-jobs` is not in git (it was created outside a migration). This PR puts its schedule under a migration for the first time.
- **F-P5-3 (trade-off, for the Auditor):** tag, reaction and comment notifications wait up to 60 s, instead of up to 5 s, until P5-b lands.
- **F-P5-4:** the production-only `process-email-queue` (5 s, not in git, carries auth e-mails) is **not** changed here, and auth e-mails must not wait 60 s. On production the PROBE will name it. It moves with P5-b/P9.
