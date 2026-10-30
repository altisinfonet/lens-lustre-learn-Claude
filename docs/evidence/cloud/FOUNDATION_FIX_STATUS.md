FOUNDATION FIX — IN PROGRESS (U3 carrying to live; U1/U2 measured, fixes drafted; U4 done by stages runner)

# Foundation fix runner — status (heartbeat 08:55Z, 2026-10-30)

Source: foundation audit #622. Owner exclusions honoured: no backup/PITR work, no judging objects touched, no feature switched on.
Constraint all day: the repo's Actions queue held 200–335 runs, so every PR took ~1 h to clear CI and every
`apply-migration.yml` run waited 15–35 min for a runner. GitHub keeps only ONE pending run per lane, so a new
dispatch cancels the one waiting (happened to 3 runs today, 2 caused by me — owners notified on #553 and #645).

| # | Unit | State | PRs | Merged shas | SQL runs (UTC) | Live check |
|---|---|---|---|---|---|---|
| 1 | One truth | MEASURED on production; capture migration + drift CI drafted, not yet in a PR | #646 → staging, #661 → main | 86a08731 (staging), bf6da657 (main) | prod PROBE 0200 **41024992462 PASS 08:34Z** (60 objects, all screened clean) | n/a (read-only) |
| 2 | Account deletion | MEASURED on production; code fix written, fail-first tests seen FAILING; SQL routine not yet written | #651 → staging, #662 → main | 175c9fb0 (staging), c2cefd73 (main) | prod PROBE 0400 **41027566924 PASS 08:45Z** | n/a |
| 3 | Alarms | ON STAGING; carry to main open | #650, #660 → staging; #666 → main (CI running, review NOTHING BLOCKING) | f7ec574d, ea482c8d (staging) | staging 0301 **41024048586 FAIL 08:39Z** (fail-first: no alarm table) → 0300 **41028022097 PASS 08:41Z** → 0301 re-run 41028426756 (in flight) | pending production |
| 4 | High-severity deps | SKIPPED — already done by the stages runner (#634 on staging: 14 → 1 high, lockfile only) | #634 (not mine) | b51e0366 | n/a | main carry is the stages runner's |

## Unit 1 — one truth
- **Proof of problem**: audit PROBE 0901 (prod 40995060552, staging 40993828632) vs git, CREATE statements only: 37 functions, 5 tables, 5 policies, 14 app triggers, 6 cron jobs live and in no migration.
- **Production definitions read** (PROBE 0200, run 41024992462): 34 functions, 14 triggers, 4 policies, 4 tables, 6 crons; 0 withheld by the credential screen; md5 of every decoded body matches. Saved: `docs/evidence/cloud/foundation-fix/u1_production_live_only_definitions_20261030.json` on branch `foundation/u1b-capture-drift`.
- **Finding**: every captured cron already calls one function (`cron_http_call('<job>')`, `email_queue_tick()`), so all can be captured verbatim without breaking the P9 cron gate.
- **Judging — later (not captured)**: `judge_apply_single_tag`, `get_public_final_votes`, `release_award_certs_on_publish` + `trg_release_award_certs_on_publish`, `held_result_notifications` (+ policy), cron `judging-invariants-nightly`.
- **Drift check built** (`scripts/db-drift-check.mjs` + self-test 7/7, branch `foundation/u1b-capture-drift`): live fingerprint (PROBE 0202, names + md5 only) vs git. Live body = latest git → OK; = an older git version → PENDING (apply lag, never fails); = no git version → DRIFT (fails).
- **Next**: run PROBE 0200 on staging (needed so the capture changes nothing there) → generate `20261103_0201_capture_live_only.sql` (CREATE OR REPLACE / IF NOT EXISTS, production-only crons lane-guarded) + equality PROBE + rollback → PROBE-before must PASS → apply staging → carry → production. Then `db-drift.yml` (scheduled on main + dispatch).
- **Cleanup runner** (#644): `posts_dead_host_backup_20260812` is live-only and looks like a one-off backup — a likely DELETE candidate for them, so I will capture its schema only if they keep it.

## Unit 2 — account deletion
- **Proof of problem**:
  - (code) `delete-my-account` deletes the login first, then ~50 deletes whose errors are never read, and removes no files. Tests G1/G2/G3 in `src/__tests__/accountDeletionComplete.test.ts` FAIL on today's file (seen 06:3xZ).
  - (live) PROBE 0400: 53 FKs to auth.users/profiles (48 CASCADE, 4 SET NULL, 1 NO ACTION) and 160 member-id columns; many have no FK and are in neither the function's list nor `admin_purge_orphan_user_data`, e.g. `member_activity_minutes`, `contributor_engagement_daily`, `post_drafts`, `feed_post_signals`, `feed_session_delivered`, `client_errors`, `ad_creative_*`. Files: `post-images` 116 objects (113 keyed by member folder), `avatars` 14 (all keyed by member).
- **Fix written** (branch `foundation/u2-deletion`, not yet a PR):
  - `supabase/functions/_shared/accountDeletion.ts` makes one call to `delete_member_account(_uid)` (all rows and the login last, in one transaction; any error → nothing deleted, member told to retry).
  - Queued files are removed from Supabase Storage AND S3/CDN; failures stay queued and are reported as pending.
  - Behaviour tests: 4/4 pass.
- **Still to do**: write the SQL routine from the PROBE 0400 list. Keep and anonymise money/ledger rows; queue only files no remaining row uses; also make `admin_delete_auth_user` call it so the already-deployed function becomes atomic now. Then add a staging rollback-only end-to-end test (synthetic member → delete → leftover scan over all 160 columns) and do the deploy → "deploy pending Owner token".

## Unit 3 — alarms
- **Built**:
  - production pg_cron `ops-monitor-tick` (every 5 min): pg_net uptime GET of www + apex, plus a dead-man check that reads GitHub's public API for the last successful `health.yml`.
  - `ops_alarms` table; Admin → Health banner; `alarm-relay.yml` (read-only DB) opens/closes issues labelled ALARM.
  - One setting: `ops_alarm_settings.destination`.
- **Proof**:
  - local self-test 6/6.
  - staging fail-first 41024048586 FAIL (`relation "public.ops_alarm_settings" does not exist`).
  - staging apply 41028022097 PASS.
- **Next**:
  - 0301 PASS on staging.
  - Simulation 0302 (down.invalid + never-succeeded workflow) → read 0304 → 0303 off.
  - Merge #666 → production: 0301 (fail) → 0300 → 0301 (pass) → 0304.
  - Live check in 3 browsers.

## Owner list (plain words)
1. Add `SUPABASE_ACCESS_TOKEN` to the staging and production Environments. Without it, the new account-deletion code (and every edge function) cannot be deployed from git.
2. Tell us where alarms should go (an e-mail or phone). Until then they arrive as GitHub issues labelled ALARM (GitHub e-mails you) and as a red banner in Admin → Health.
3. Consider giving the repository more Actions capacity, or fewer parallel runners. Today each change waited about an hour for CI.
4. Optional: give the alarm's GitHub check a token later if GitHub rate-limits it. You would see a "blind" alarm if that happens.
