FOUNDATION FIX — IN PROGRESS

# Foundation fix runner — status

Started 2026-10-30 06:07Z. Source: foundation audit (PR #622, `docs/evidence/cloud/FOUNDATION_AUDIT.md` on `status/foundation-audit`).
Owner exclusions honoured: backups/PITR drills, judging objects. No feature switched on.

| # | Unit | State | PR | Merged shas | SQL runs | Live check |
|---|---|---|---|---|---|---|
| 1 | One truth (capture live-only DB objects + drift CI) | PROBE 0200 in CI | #646 (U1a, read PROBE) | — | — | — |
| 2 | Account deletion complete | INSPECT | — | — | — | — |
| 3 | Alarms independent of GitHub cron | built + tested locally, PR next | — | — | — | — |
| 4 | High-severity dependencies | SKIP (stages runner #634 already merged to staging: 14 → 1 high) — main carry to verify | #634 (not mine) | b51e0366 | n/a | — |

## Unit 1 — proof of problem
Audit PROBE 0901 logs (prod run 40995060552, staging 40993828632) diffed against git, CREATE statements only:
37 functions, 5 tables, 5 policies, 14 app triggers, 6 cron jobs live and in no migration (matches the audit).
Judging — later (not captured): `judge_apply_single_tag`, `get_public_final_votes`, `release_award_certs_on_publish` + `trg_release_award_certs_on_publish`, `held_result_notifications` (+ its policy), cron `judging-invariants-nightly`.
Constraint found: CI gate P9 rejects a cron in git whose command calls HTTP inline; any live cron of that shape will be recorded hash-only, not re-created (decided per job once definitions are read).

## Unit 3 — design
Detection in production's own pg_cron (`ops-monitor-tick`, every 5 min): uptime GET of www + apex via pg_net (2 failures in a row = alarm), dead-man reads GitHub's public API for the last successful `health.yml` (none in 3 h = alarm; API unreadable 3 h = "blind" alarm). Alarms in `ops_alarms`; Admin → Health banner; `alarm-relay.yml` opens/closes issues labelled ALARM (read-only DB). One setting: `ops_alarm_settings.destination`.
Local evidence: self-test PROBE 0301 — 6/6 pass with the migration, fails without it.

## Heartbeat
- 06:07Z runner started; status PR #645.
- 06:12Z #646 opened (U1a read PROBE). Reviewer round 1 BLOCKING (credential screen gaps) → fixed 5d2ab43 → round 2 NOTHING BLOCKING. CI queued (repo has ~196 queued runs).
- 06:35Z Unit 3 built and tested locally; Unit 4 found already done by the stages runner.

## Owner list
(none yet)
