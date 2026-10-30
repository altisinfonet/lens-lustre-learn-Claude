FOUNDATION AUDIT COMPLETE — overall: NOT YET STRONG

# Foundation audit — 50mm Retina World — 2026-10-30

Independent, read-only audit. The auditor fixed nothing. Measurements were taken 2026-10-30 02:25Z–03:10Z
from live HTTP, the public GitHub API / GitHub MCP, and three read-only PROBEs run through
`apply-migration.yml` (files: `supabase/migrations/PROBE_20261102_090{1,2,3}_audit_*.sql`, PR #623 → staging,
carried by cherry-pick in PR #625 → main; independent reviewer: "NOTHING BLOCKING — files cannot write").

| PROBE | staging run | production run |
|---|---|---|
| 0901 inventory | 40993828632 (02:48Z) | 40995060552 (03:02Z) |
| 0902 security | 40994239628 (02:53Z) | 40995178954 (03:03Z) |
| 0903 ops / data safety | 40993833982 (02:48Z) | 40995245578 (03:04Z) |

(Run 40993831331 was the first 0902 dispatch, cancelled by the workflow's one-at-a-time rule, then re-run as 40994239628.)

## 1. Scorecard

| # | Area | Score | One-line reason | Evidence |
|---|---|---|---|---|
| 1 | One truth (live == git) | **WEAK** | Staging and production match each other, but **neither matches git**. About 37 functions, 5 tables, 5 policies, ~15 app triggers and 3 (staging) / 6 (production) cron jobs exist live but are created by no migration. `personal_feed` is ON for everyone on production and OFF in git. The apex domain runs through a hand-deployed Worker. | 0901 runs above; `curl -D -` 02:25Z |
| 2 | Deploy pipeline | **WEAK** | SQL, web and Android deploy from git. **Edge functions cannot**: `d1-deploy-functions.yml` has 1 run ever (40941744672, 2026-10-29 19:37Z) and it failed: `SUPABASE_ACCESS_TOKEN is not set on the 'staging' environment`. | runs 40941744672, 40991090922, 40943931632 |
| 3 | Scale (1 M members) | **WEAK (unproven)** | A seed harness exists, but its last run was 2026-09-04 and stopped short (80,200 posts, 513 profiles). Staging today holds ~10.9 k posts and 52 users. No feed p95 at any scale was found. Production today: 138 users, 566 posts. | d1-seed-staging run 33896288912; 0903 `ROWS_EST` |
| 4 | Security | **WEAK** | RLS is on for every public table on both lanes. But 214 of 416 SECURITY DEFINER functions on production are callable by anonymous visitors (98 directly; the other 116 are trigger functions). The 15-function sample found judge-lock functions that trust a caller-supplied judge id, and judging/ad read functions with no caller check. `npm audit`: 14 high, 0 critical. | 0902 runs; `npm audit --omit=dev` 02:29Z |
| 5 | Recovery | **BROKEN (never proven)** | Whether PITR is enabled on production is UNKNOWN. No restore has ever been done. The S11 drills D1 (PITR) and D9 (backup restore → app boots) were **not run**. | `docs/evidence/cloud/S11/drills.md` (#616) |
| 6 | Change quality | **WEAK** | In the sample, 15/15 PRs were green at merge. But only 5/15 had a review posted on the PR, and all of those were posted by the same account that wrote and merged the PR. 4/6 fixes had a fail-first test in the diff. The flake fix #578 is still open. 42 PRs are open; the oldest is 64 days. | PR sample below |
| 7 | Watching | **WEAK** | The monitors pass, but in 48 h GitHub actually ran health.yml 7/24 times, gov-health 8/24 and d2-synthetic ~6/113, with gaps of up to 8.5 h. The only alert is GitHub's failure e-mail; a monitor that silently stops running raises nothing. Admin → Health data does flow (1,138 telemetry rows in 24 h). | runs 40975680395, 40985843329, 40983543018; 0903 production |
| 8 | App (Android / iOS) | **WEAK** | Android builds from main on CI (last 5 succeeded, 1 only on attempt 2). versionName 1.2.31 is the same on main and staging; versionCode = 1000 + run number. There are **no device or emulator tests**: login, camera, share, push, deletion, cold start and deep links all need a human phone. iOS is manual-only; last run 2026-10-17 succeeded. | android-build 40943931632; workflow grep |
| 9 | Data safety | **WEAK** | Likes, comments, posts and payments are protected by unique constraints and idempotency keys, identical on both lanes. **Account deletion has gaps**: about 40 table deletes run with their errors ignored, and no stored photo files are removed. No database rule stops a wallet balance going negative. | 0903 constraints; `supabase/functions/delete-my-account/index.ts` |

### Detail per area

**1 · One truth**
- (a) `main` vs `staging` trees: **6 files differ**. They are `.github/workflows/android-build.yml`, a stray root `android-build.yml` (only on main), `src/integrations/supabase/types.ts`, `src/lib/profilesPublic.ts`, and 2 Android guard tests. Staging is 50 commits ahead; histories diverge (1,610 main-only commits), which is the cherry-pick carry model.
- (b) Database, live vs 730 migration files (name-level; dynamic SQL is not parsed, so treat this as approximate):
  - **Functions**: 37 live, not in git. These include `verify_staff_id`, `increment_managed_page_view`, `process_post_jobs`, `enqueue_post_job`, `password_verification_hook`, `filter_moderated_user_ids` and `get_profile_visible_fields`. Several exist in git only inside a commented-out snapshot (`UNAPPLIED_20260911101721_*`). 0 in git but missing live (production lacks `tg_profiles_record_custom_url_history`, which staging has).
  - **Tables**: 5 live, not in git: `auth_login_attempts`, `competition_entry_counts`, `held_result_notifications`, `office_staff`, `posts_dead_host_backup_20260812`.
  - **Policies**: 5 live, not in git.
  - **Triggers**: ~15 app triggers live, not in git (e.g. `trg_flag_post_review`, `trg_enforce_comment_blocklist`, `trg_enqueue_post_created`).
  - **Cron jobs**: `apply-scheduled-boosts`, `expire-gift-credits` and `judging-invariants-nightly` are live on both lanes but not in git. Production only adds `autoscale-ad-traffic`, `backup-reminder`, `send-reengagement-emails` (not in git) and `process-email-queue`.
  - **Staging vs production**: same functions (−1), same policies, same RLS flags, same constraints. The only difference is the 4 extra production cron jobs.
- (c) Switches. Production: `personal_feed=everyone`, `video_posts=selected(6)`, `video_ads=selected(1)`, everything else off. Staging: `personal_feed=off`. Git creates `personal_feed` OFF (20261018_0003). The claim is confirmed.
- (d) Edge functions: git (main) has 73.
  - An OPTIONS preflight to each of the 73 names (02:32Z) found all 73 on staging and 71 on production. Missing on production: `backfill-media-objects`, `media-verify-upload`; only tests reference them.
  - **Live-not-in-git and live-code-differs: UNKNOWN.** Listing the live functions needs the Management API token, which is missing.
- (e) Cloudflare:
  - `https://50mmretina.com/` answers `x-seo-render: pages:worker-in-front` and `cache-control: public, max-age=0, s-maxage=60`.
  - `https://www.50mmretina.com/` answers `x-seo-render: pages:injected` and `no-store`.
  - So the hand-deployed Worker (source `cloudflare/seo-edge-injector/worker.js`) is still in front of the apex, and the pages' canonical URL is the apex.
  - Bodies are byte-identical today. No workflow deploys the Worker.

**2 · Deploy**
- **Web**: Cloudflare Pages builds from git itself. No workflow deploys it; `web-build.yml` only checks the build. Last main and staging builds were green.
- **SQL**: `apply-migration.yml` works on both lanes: 94 runs in 48 h, 78 success / 16 failure. It is lane-guarded (production only from main).
- **Edge functions**: BROKEN, as above.
- **Android**: `android-build.yml` on push to main, last 5 green.
- **Secret presence**: the `gh` token in this session is invalid, so secrets could not be listed. Known from logs: `SUPABASE_ACCESS_TOKEN` is absent from the staging Environment, and `SUPABASE_DB_URL` is present on both Environments (runs succeed).

**3 · Scale**
- `d1-seed-staging.yml` defaults to 1,000,000 rows but seeds posts, not members.
- 9 runs ever; the last was 2026-09-04.
- The P1 churn study (`docs/evidence/d1/phase2/p1-synthetic-churn.md`) measures autovacuum dead-row ratios at 100 k profiles, not latency.
- Missing: a 1 M-member dataset, a feed p95 at that size, and a load test.

**4 · Security** (production; staging is equivalent)
- **SECURITY DEFINER**: 416 functions; 214 anon-executable, 305 authenticated-executable, 0 without a pinned `search_path`. 98 are directly callable by anon (non-trigger). Of those, 4 write: `increment_managed_page_view`, `record_test_agent_run` (vault token check), `log_app_event` and `log_client_error` (rate-limited by auth.uid). 51 are read-only with no caller check.
- **Riskiest 15, sampled.** Live body via PROBE heuristic plus latest git source. A PoC call was **not** made, so these are "likely":
  - `acquire_judge_lock`, `heartbeat_judge_lock`, `release_judge_lock`: take `_judge_id` from the caller with no `auth.uid()` check. Any signed-in member could take or release judging locks for any judge. **Dangerous (integrity).**
  - `get_round_pending_entries`, `get_judge_entries_page_v1`, `get_needs_review_recipients_for_round`: anon-executable, no caller check in the live body. They may expose unpublished competition entries (EXIF, AI-detection result) and recipient ids during judging. **Dangerous (privacy).**
  - `get_ad_analytics`: anon can read ad performance. Low.
  - `get_notification_email_enabled(_user_id)`: anyone can read a member's e-mail preferences. Low.
  - `media_derivative_record`, `video_converter_begin_version`, `video_source_done`, `video_source_fail`: guarded by a claim token or key derivation. OK.
  - `log_app_event`, `log_client_error`: per-user rate limit. OK.
  - `record_test_agent_run`: vault token. OK.
  - `verify_staff_id`: **no source in git**. Live only, UNKNOWN.
- **Tables**: no public table without RLS. 29 tables have RLS but no policies, which denies everyone; intended for server-only tables.
- **Views**: 3 SECURITY DEFINER views readable by anon (`judge_*_owner_safe`); their purpose needs confirming.
- **Public buckets on production** (object counts only): `avatars` 14, `email-assets` 14, `post-images` 116, `site-assets` 7; `competition-photos`, `course-images`, `journal-images` and `portfolio-images` are 0. `national-ids`, `entry-originals` and `support-attachments` are private. Most member photos live on the S3/CDN path, not in Supabase storage.
- **`npm audit --omit=dev`**: 14 high, 5 moderate, 0 critical (react-router/@remix-run/router, dompurify, lodash, postcss, nanoid, …); all have a fix available.
- **gitleaks 8.21.2** over main + staging history (1,548 commits): 45 hits.
  - 4 private-key: regex code that strips `BEGIN PRIVATE KEY`, a false positive.
  - 4 jwt: `role=anon` for an old project (public by design).
  - 2 gcp-api-key: `google-services.json`, a Firebase key that is public by design.
  - 35 generic-api-key: not individually triaged.
  - **No service-role key or private key found.**
- **Branch protection**:
  - `main`: protected; ruleset requires a PR with **0 approvals**, no force-push, no deletion; ~20 required status checks.
  - `staging`: protected with required checks (classic).
  - **The repository is PUBLIC**, so every workflow log, PROBE output included, is world-readable.
  - GitHub Environment deployment-branch rules and Supabase advisors: UNKNOWN (need an authenticated token).

**5 · Recovery**
- `archive_mode=on`, `archive_command` set, Postgres 17.6 on both lanes. This is consistent with Supabase backups but is **not proof that PITR is enabled**.
- PITR status: UNKNOWN. **Owner item:** Supabase Dashboard → Project jtdtehuqtinjxropkkcn → Database → Backups.
- S11 drills (#616):
  - **D1 and D9 not run** (token missing).
  - D2–D6 executed against staging in 3 browsers. Chromium and WebKit passed 10/10; **Firefox failed 10/10**, on an auth-lock console error that #614 later reclassified.
  - D7 and D8 ran on a local Postgres fixture only, not the real database.
- No restore of production data has ever been executed.

**6 · Change quality**
- 131 PRs were merged 2026-10-28 02:30Z → 2026-10-30 02:30Z (92 to staging, 39 to main), all opened and merged by `altisinfonet`.
- Sample (`random.seed(20261030)`): 483, 486, 498, 508, 513, 514, 518, 533, 550, 552, 558, 559, 571, 572, 592.
  - 15/15 had all checks green at merge; 3 merged ~30 s after the last check.
  - 5/15 had a "nothing blocking" review posted on the PR (483, 486, 498, 518, 533). All 5 were posted by the PR's own account and identified as sub-agent reviews. 6 of the 7 carry-to-main PRs rely on the staging PR's review.
  - Fixes with a fail-first test in the diff: 4/6 (513, 558, 559, 592). #486 (a security SQL purge) has none; #571 is partial.
- **Flakes**:
  - android-build 40943931632 passed only on attempt 2. Attempt 1 hit `ReferenceError: sessionStorage is not defined` from `signOutWipeWiring.test.tsx` after teardown. Fix PR **#578 is still open**.
  - d2-bare-img 40769496997 and d2-nav-harness 40832048434 also needed 2 attempts.
  - The list may be incomplete: ~6,400 runs in 48 h exceed the API's per-query cap.
- **Open PRs**: 42 (6 are status PRs). 28 non-status PRs are older than 3 days; the oldest, #103, is 64 days.

**7 · Watching**
- Monitors are scheduled (`health`/`gov-health` every 2 h, `d2-synthetic` every 15 min) and **0 scheduled runs failed in 48 h**.
- GitHub dropped most firings: health ran 7/24 times, gov-health 8/24, synthetic ~6/113; longest gaps 8 h 27 m, 6 h 57 m and 7 h 02 m.
- Alert path: only GitHub's default failure e-mail. No issue, Slack or webhook, and **nothing alarms on a monitor that stops running**. The same gap let a supervisor session die for ~11 h on 2026-10-29 unnoticed.
- Live data, production, last 24 h:
  - `client_telemetry` 1,138 rows (android 719 / web 419), last row 03:04:14Z.
  - feed_events 575, email_send_log 212.
  - 23 cron jobs ran, all succeeded.
  - pg_net calls: 86 × 2xx, 4 errors.
  - `notification_emit_log` 0.
- On staging every flow table shows 0 rows in 24 h. That is expected for a test lane, but it means staging cannot catch telemetry regressions.

**8 · App**
- `android/` is generated fresh by `npx cap add android` on each build. Android Gradle Plugin and Gradle are pinned by guard checks, which are on staging only (not yet on main).
- versionName 1.2.31 is set in the workflow; versionCode = 1000 + `run_number`.
- Smoke list:
  - Automated proof exists only at web level: the offline harness, nav harness, app-origin journey at `https://localhost`, and kill tests.
  - There are no emulator or device tests (no `connectedAndroidTest`, emulator runner or device farm in any workflow).
  - Google and e-mail login, camera upload, share sheet, push, account deletion, cold start and deep links all need a human with a phone.
- iOS: `ios-build.yml` is manual (`workflow_dispatch`); last run 39021031679 on 2026-10-17 succeeded.

**9 · Data safety** (constraints identical on both lanes)
- **Sign-up**: managed by Supabase Auth. The profile-creation path was not examined — UNKNOWN.
- **Posting**: `UNIQUE (user_id, idempotency_key)` on posts.
- **Likes**: `UNIQUE (post_id, user_id)` (exactly one per member per post); `post_shares UNIQUE (post_id, user_id)`.
- **Comments**: `UNIQUE (user_id, idempotency_key)` on post_comments; comment reactions unique per comment+user.
- **Payments / wallet**:
  - Razorpay verifies the signature and re-fetches the order.
  - Unique indexes on the Razorpay payment id and the PayPal order and capture ids, and the v2 ledger has `UNIQUE (op, idempotency_key)`.
  - Gap: **no CHECK that the wallet balance stays ≥ 0**; this relies on the RPC.
- **Account deletion** (`delete-my-account`):
  - It deletes the auth user first, so 42 FKs cascade, 3 set null and 1 is NO ACTION. It then runs ~40 per-table deletes with `Promise.all` and **never checks their errors**.
  - It **does not delete the member's photo files** in storage or on the CDN.
  - No end-to-end test found.

## 2. Top 10 root-level fixes (ranked by member risk)

| # | Fix | What breaks for members if not fixed | Effort (tokens) | Owner click? |
|---|---|---|---|---|
| 1 | Prove recovery: confirm PITR on production; run D1 (PITR to a branch) and D9 (restore → app boots → feed renders) | A bad migration or deletion could lose every member's posts, with no tested way back | 60–120 k | **Yes**: confirm the PITR add-on, and add `SUPABASE_ACCESS_TOKEN` to both Environments |
| 2 | Guard the judge-lock RPCs with `auth.uid()` / judge role, and add caller checks to `get_round_pending_entries`, `get_judge_entries_page_v1` and `get_needs_review_recipients_for_round` (PoC on staging first) | Any member can block judging or read unpublished entries | 40–80 k | No |
| 3 | Bring the live-only database objects into git (37 functions, 5 tables, 5 policies, ~15 triggers, 6 cron jobs) as captured migrations, then gate "live == git" in CI | A rebuild or restore from git silently loses moderation, blocklist and post-job triggers and the e-mail cron | 120–200 k | No |
| 4 | Unblock edge-function deploys and capture the live-only functions | Edge function fixes can't ship from git; live code is unknown | 30–60 k after the token | **Yes**: add the token |
| 5 | Make account deletion complete and checked: fail on any delete error, remove storage/CDN objects, add an end-to-end test | Deleted members' photos and some rows stay (privacy, Play policy) | 40–70 k | No |
| 6 | An alarm that doesn't depend on GitHub cron: an external uptime ping plus a "no monitor run in 3 h" dead-man alert to a phone/e-mail | Outages and dead supervisor sessions go unseen for hours | 20–40 k | **Yes**: choose where alerts go |
| 7 | Retire the hand-deployed apex Worker (redirect apex → www, or deploy the Worker from git) | The canonical domain runs code nobody can deploy or review | 15–30 k | **Yes**: Cloudflare dashboard |
| 8 | Real review gate: require 1 approval on main, and merge #578 (flake fix) | Unreviewed or flaky changes reach the live site | 10–20 k | **Yes**: branch rule |
| 9 | Prove scale: seed 1 M members (not just posts) on staging and record feed p95 / p99 | The feed may slow down or time out as membership grows | 80–150 k | No |
| 10 | Update the 14 high-severity npm dependencies; set `personal_feed` in git to match production, or switch production back | Known library vulnerabilities; production differs from what git says | 20–40 k | Switch: **Yes** (Owner's call) |

## 3. For the Owner

- **Strong:** every table is locked by row rules; likes, comments and payments can't be counted twice; the site, database changes and Android app all build from the code; the site came back working in every simulated outage in Chrome and Safari.
- **Not strong yet:** a restore from backup has never been tested, so a recovery is not proven.
- The live database has dozens of pieces the code doesn't contain, so the code alone could not rebuild today's site.
- A few judging functions let any member block judging or possibly see entries before results.
- Deleting an account leaves the member's photo files behind.
- Monitoring checks only every few hours (GitHub skips most runs), and nothing alarms when the checks themselves stop.
- 1 million members has never been tested; the biggest test was 80,000 posts.
- **Do first:** (1) check that point-in-time backups are on (Supabase → Database → Backups); (2) add the Supabase access token so the team can test a restore and deploy server functions; (3) pick a phone number or e-mail for real alerts.

## 4. Not verified, and why

- **PITR / backup settings**: needs the Supabase Management API or dashboard. UNKNOWN.
- **Live edge-function list, versions, code differences, and the "10 not in git" claim**: Management API token missing. UNKNOWN; only git → live presence was measured.
- **Secret presence by name, GitHub Environment branch rules, Supabase advisors**: the session's `gh` token is invalid and those APIs need auth. UNKNOWN, except what logs show.
- **Exploitability of the sampled risky functions**: classified from live-body heuristics plus git source; no PoC calls were made (read-only mandate).
- **35 generic-api-key gitleaks hits**: not individually triaged.
- **Complete 48 h re-run and flake count**: the API caps results at 1,000 per query and some windows exceeded it.
- **Sign-up path safety, iOS build reproducibility, Android reproducibility beyond CI success**: not examined.
- **Live Worker source**: only behaviour was observed; whether it equals `cloudflare/seo-edge-injector/worker.js` is UNKNOWN.
- **Parser limits**: the git-side object inventory parses migration text by name and does not follow dynamic SQL. Counts are approximate (±a few).
