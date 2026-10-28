# S8 "Live debt": builder report (cloud session, 2026-10-28)

**Gate:** "every live function == git; 0 missing migrations; each fix verified on live"
**Status:** code only. Nothing was applied, deployed or promoted. Every live clause needs the supervisor's PROBE runs below.

## Units

All PRs target `staging` and were squash-merged pinned to their head SHA. Each had one independent reviewer (sonnet sub-agent, diff only), whose review is posted as a PR comment.

| Unit | PR | Merge sha | Review | LOW notes |
|---|---|---|---|---|
| F-REV4-1 + send-push: deploy path | #483 | 656abf3 | APPROVE, nothing blocking | Fence checks that a `[functions.x]` block exists, not that its verify_jwt matches live (compare with `list` first). `setup-cli version: latest`. Duplicate names are not de-duplicated. |
| F-REV4-2: 0008/0011/0013 lane-guarded, single transaction | #484 | ff690c7 | APPROVE, nothing blocking | New `lock_timeout 5s` fails safe; retry. The PROBE's anon-EXECUTE checks may FAIL where PUBLIC still holds EXECUTE (F-62). If so, that is a true finding. |
| UB-6: 0001 user_blocks rollback unrunnable | #485 | fc26b0b | APPROVE, nothing blocking | none |
| F-P6-1: cron run-history literals, PROBE + guarded purge | #486 | 7b15c53 | APPROVE, nothing blocking | Any quoted literal of 17+ characters counts (fails safe). The no-op rollback has no lane guard. |
| F-P1-6: server ignores the old app builds' timer UPDATE | #487 | 82e0dfa | APPROVE, nothing blocking | An out-of-git BEFORE UPDATE trigger that bumps a column would defeat the skip; the write still succeeds. A `.single()` caller would get PGRST116. |
| UB-5: block notice cap, 10 per blocker per 24 h | #488 | 1ec72b6 | APPROVE, nothing blocking | A race can overshoot the cap by 1. PRE does not check that the trigger exists (the PROBE does). |
| F-P5-1 / F-P7-1: verify PROBEs | #489 | bd4c8e7 | APPROVE, nothing blocking | The OVERALL row sorts inside the list. Overloads are masked. Functions created only by dynamic EXECUTE show as missing. |

## Items not done (budget cap reached) and their state

- **F-REV4-6 (award stamps / judge badge): NOT STARTED, cause identified.** The production views are `security_invoker` (see `20261013_0001_align_staging_locks_to_live.sql:95-110`), so:
  - visitors and ordinary members get 0 award stamps from `judge_tag_assignments_public_r4` (`src/pages/PublicProfile.tsx:392`);
  - a non-admin judge's vote badge from `entry_final_votes` (`src/hooks/judging/usePhotoVoteCount.ts:54`) misses admin adjustments and locked votes.
  - Proposed fix: publish-gated SECURITY DEFINER read functions with guarding WHEREs and a cross-member test, then switch the two readers to RPC. This is a DB+client unit.
- **The 10 live-only functions (F-REV4-1):** run `d1-deploy-functions.yml mode=list` first. The source must come from the live dashboard (supervisor/Owner); none was invented.
- **F-P7-1 capture/drop:** run `PROBE_s8_f_p7_1_functions_not_in_git.sql`, then decide per name.
- **F-D3-1/2/3 (one SEO renderer, canonical host, sitemap), F-D3-8 (preferred_language code), F-D2-13/14 (listener ↔ publication), F-D2-15 (home.ts lazy), SEC-UB-9:** not started.
  - Cause traces already exist: `docs/evidence/d2/phase5/F-D3-3/TRACE.md` and `P17/DECISION.md`.
  - The F-D3 fix touches `functions/_seo.ts` and Cloudflare (the Worker `seo-edge-injector`), which is partly Owner settings.
- **SEC-P9-2 / PR #390: still needed; carry next session.**
  - It adds new files only (`20261010_0001/0002` + rollbacks + PROBE + evidence).
  - Staging has no `20261010_*` file, so there is no name collision.
  - Both files are lane-guarded with BEGIN/COMMIT, and CI was green on 3d8a23e.
  - GitHub reports it as `blocked`: it needs an approval or is out of date.
  - The rotation values are Owner clicks (the vault `faud8_new:*` entries).

## SQL for the supervisor: run staging first, then production

Each PROBE is read-only. Run it before the apply (expect FAIL), then after (expect PASS).

1. `supabase/migrations/PROBE_s8_f93_f96_f94_state.sql`. If it FAILS, apply only the missing ones, in order:
   - `supabase/migrations/20260910_0008_f93_custom_url_change_window.sql`
   - `supabase/migrations/20260910_0011_f96_one_predicate_one_window.sql`
   - `supabase/migrations/20260910_0013_f94_signup_must_not_fail.sql`

   0008 assumes the F-93 0006/0007 objects exist (`custom_url_available`). Then re-run the PROBE.
2. `supabase/migrations/PROBE_s8_f_p1_6_client_presence_write.sql`, then apply `20261029_0002_f_p1_6_ignore_client_presence_write.sql`, then the PROBE again.
3. `supabase/migrations/PROBE_s8_ub_5_mass_block_notice_cap.sql`, then apply `20261029_0003_ub_5_mass_block_notice_cap.sql`, then the PROBE again.
4. `supabase/migrations/PROBE_p9c_cron_http.sql` (existing), then `PROBE_s8_f_p6_1_cron_history_literals.sql`.
   - If R1 PASSES and H1 FAILS, apply `20261029_0001_f_p6_1_purge_cron_history_literals.sql` and re-run the PROBE.
   - If R1 FAILS, apply P9 first; the purge refuses.
5. `supabase/migrations/PROBE_s8_f_p5_1_post_jobs_runs.sql` (staging). If it FAILS with drains=false, apply `20261004_0002_p5_post_jobs_idle_backoff.sql`.
6. `supabase/migrations/PROBE_s8_f_p7_1_functions_not_in_git.sql` (both lanes). This is the inventory for "0 missing migrations".

Rollbacks:
- `supabase/rollback/20261029_000{1,2,3}_*_ROLLBACK.sql`
- `20260910_0013_f94_ROLLBACK.sql` (new)
- `20260910_0006_0010_f93_ROLLBACK.sql` and `20260910_0011_f96_ROLLBACK.sql` (now lane-guarded)

## Deploy steps for the supervisor

These run after the Owner adds `SUPABASE_ACCESS_TOKEN` as a secret on the `staging` and `production` environments.

1. Actions → "Deploy Supabase edge functions" → `target=staging`, `mode=list`, run from `staging`. Save the summary table; it is the staging inventory.
2. Promote to `main` (supervisor), then do the same with `target=production` from `main`.
3. send-push: check that the list shows live `verify_jwt=false`. If it shows `true`, stop; pushes are already failing.
   - Otherwise run `mode=deploy functions=send-push confirm=send-push` on staging and verify a push.
   - Then do the same on production from `main`.
4. For any other function to redeploy: first add a `[functions.<name>]` block with the live verify_jwt to `supabase/config.toml` (one PR), then deploy it by name.

## Owner click list

- `SUPABASE_ACCESS_TOKEN` (Supabase personal access token) as an **environment** secret on GitHub `staging` and `production`.
- Download the source of each "live, not in git" function from Dashboard → Edge Functions and hand it to the supervisor.
- Push-secret rotation: `PUSH_INTERNAL_SECRET` as an Edge secret plus the `push_config.internal_secret` row, changed together. `FCM_SERVICE_ACCOUNT` if it was exposed.
- Converter password: rotate wherever it is stored (not in git).
- SEC-P9-2 (#390): new `CRON_SECRET` and service key, then the vault entries `faud8_new:cron_secret` / `faud8_new:service_key`.

## Old open PRs

None were closed. Supersession could not be verified cheaply: the old branches' histories diverge from staging, so a file-identity check was meaningless. Closing on a guess was rejected.

| PR | Base | Recommendation |
|---|---|---|
| #305 | main | staging→main promotion (supervisor's). Leave. |
| #103 | main | G10 4.3, to main. Leave for the supervisor. |
| #390 | staging | Still needed. Carry next session (see above). |
| #476, #482 | staging | Current (today). Not touched. |
| #428, #408, #391, #352, #323, #289, #286, #285, #278, #277, #276, #259, #256, #254, #215, #214, #210, #200, #192, #175, #174, #157, #156, #155, #154, #151, #130 | staging (#130 → a d1 branch) | Unverified. Triage next session, one by one against the live state. P30/P31/P32/P33 evidence and docs PRs are likely superseded by later merged units; #391 (SEC-P3E-1) and #214 (F-110 lane guard) are likely still needed. |

## Decisions made without the Owner

- Each unit went on its own branch `s8/*` off origin/staging, as one PR per unit. This report is on `claude/s8-live-debt-szspp0`.
- F-REV4-1, F-REV4-2 and F-REV4-6: no finding text exists in git. They were interpreted from the code and plan wording, as stated in each PR.
- F-REV4-2: the three historical files were wrapped in place; their bodies are unchanged. The alternative was new copies under 20261029.
- UB-5: the admin notices are capped, not the block itself, because blocking is a member safety tool.
- F-P1-6: the old app's write is skipped with no error, so old builds neither crash nor retry.

## Tokens

The estimate was 300k. Actual is about 230k in the main session plus about 165k in two reviewer sub-agents, so about 395k: over the cap. I stopped once that was clear.
