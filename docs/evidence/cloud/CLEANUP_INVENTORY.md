# CLEANUP INVENTORY — obsolete-cleanup runner (2026-10-30)

Base measured: `origin/staging` (b51e036 → e33358b during the run). "Grep" = `git grep` across
`src supabase functions .github scripts tools converter cloudflare package.json vite/vitest/tsconfig index.html *harness.html`.
"Open PR" = file list of every open PR (25 branches) checked; none of the A-rows below is touched by one.
Classes: **A** repo/PR/branch (reversible) · **B** DB object · **C** uncertain / money / auth / judging / member data / storage.

## A — repo files

| ID | What · where | Why it looks obsolete | Proof of no use | Class | Decision |
|---|---|---|---|---|---|
| A-DOC-01 | 16 dated root reports: `IMAGE_PIPELINE_FORENSIC_AUDIT.md`, `Phase6…11_*_Report.md`, `pentest-judge.md`, `rls-audit-judging.md`, `step20-audit.md`, `step20-watermark-mount.md`, `PHASE_B_AUDIT_2026-08-12.md`, `STAGE_C_PLAN_2026-08-12.md`, `STAGE_C_PLAN_FINAL_2026-08-12.md`, `POST_REMEDIATION_FORENSIC_AUDIT_2026-08-13.md`, `ENGINEERING_PLAN_TO_PRODUCTION_GRADE.md` | dated Jul–Aug 2026; CLAUDE.md: "dated reports at the repo root … historical" | grep: 0 refs; not cited by Addendum/Gate Register/ledgers/DECISIONS | A | DELETE — PR #647 |
| A-DOC-02 | `AI_CONTROL.md`, `AI_EVIDENCE.md`, `docs/MASTER_EXECUTION_PLAN.md` | CLAUDE.md names them historical | grep: comments only (deletionProtocol.test, purge-s3-orphans, 2 SQL comments) | A | DELETE — #647 |
| A-DOC-03 | `docs/claude/**` (85 files) | CLAUDE.md names it historical | grep: comments only; reviewer confirmed no fs read | A | DELETE — #647 |
| A-DOC-04 | `scripts/ai-control.mjs` | only reads AI_CONTROL.md | no npm script, workflow or test calls it | A | DELETE — #647 |
| A-DOC-05 | `harness/` (b4, b5, cg2 — 17 files, Aug-2026 local-PG evidence) | one-off evidence harness | only referenced from AI_EVIDENCE.md and code comments | A | DELETE — #647 |
| A-DOC-06 | `.prewarm`, `.tmp_html.html` (empty), `tmp/image-5.png` | stray | 0 refs | A | DELETE — #647 |
| A-DOC-07 | `ENGINEERING_PLAN_V2_APPROVED_ARCHITECTURE.md`, `PHASE_0_DESIGN_REVIEW.md` | dated Aug | cited by `tools/uishot/photo-kill-harness.mjs` and a migration comment as design rationale | C | ASK OWNER (Q3) |
| A-DOC-08 | `ANDROID_RELEASE_RUNBOOK.md`, `NEXT_RELEASE_RUNBOOK.md`, `CAPACITOR_SETUP.md`, `STORE_LISTING.md`, `PROJECT_MASTER_RECORD.md`, `CHANGELOG.md` | dated Jul–Sep | operational/runbook; PROMOTION_LEDGER cites two | C | ASK OWNER (Q3) |
| A-DOC-09 | Rest of `docs/` not in the CLAUDE.md hierarchy (fix-sprints, qa, phase2-evidence, rebuild-blueprint, audit, security-hotfixes, …) | CLAUDE.md: "historical unless promoted" | not measured file-by-file; several are read by tests (`docs/CANDIDATE_PATTERN_AUDIT.md`, `docs/evidence/**`) and gov-health | C | ASK OWNER (Q4) |
| A-DOC-10 | Governance docs: `docs/ADDENDUM_A_EXECUTION_MASTER.md`, `docs/gates/GATE_REGISTER.md`, `docs/PROMOTION_LEDGER.md`, `docs/gates/PRODUCTION_LEDGER.md`, `docs/DECISIONS.md` | ledgers stale since Sep | CLAUDE.md names them current — out of scope | C | ASK OWNER (Q2) |
| A-SRC-01 | `src/components/admin/primitives/` (4) | no imports | knip "unused file" + grep 0 imports | A | DELETE — #648 |
| A-SRC-02 | `LanguagePicker.tsx`, `post/Badge.tsx`, `profile/ProfileActivityFeed.tsx` | no imports | knip + grep; ProfileActivityFeed only in a guard list (row removed) | A | DELETE — #648 |
| A-SRC-03 | 17 unused shadcn `ui/*`: aspect-ratio, breadcrumb, carousel, chart, command, context-menu, form, hover-card, input-otp, menubar, navigation-menu, pagination, resizable, sidebar, toggle-group, toggle, use-toast.ts | generator scaffolding | knip + grep (app uses `@/hooks/use-toast`); chart.tsx only in security-audit allowlist (entry removed) | A | DELETE — #648 |
| A-SRC-04 | `hooks/content/useCourseStats`, `hooks/feed/useReportContent`, `hooks/search/useSearch`, `lib/badgeConfig`, `lib/roleConfig` | no imports | knip + grep; useSearch only in a guard list (row removed) | A | DELETE — #648 |
| A-SRC-05 | `judge/RippleButton`, `JuryImageViewer`, `hooks/judging/usePhotoR4Award`, `useTagCounts`, `lib/judging/normalizeDecisionRow`, `pages/judging/PlacementBoard` (+ `ui/alert`, used only by it) | no imports | knip + grep | C (judging) | ASK OWNER (Q5) |
| A-SRC-06 | `hooks/wallet/useWalletGifts`, `useWalletTransactions` | no imports | knip + grep | C (money) | ASK OWNER (Q5) |
| A-SRC-07 | `src/integrations/lovable/index.ts` + dep `@lovable.dev/cloud-auth-js` | no imports | knip + grep | C (auth) | ASK OWNER (Q5) |
| A-SRC-08 | `src/lib/video/aacCore.d.ts` | knip flags it | false positive: ambient module declaration for `@mediabunny-aac-core` | — | KEEP |
| A-DEP-01 | 13 deps used only by A-SRC-03 (react-hook-form, @hookform/resolvers, cmdk, embla-carousel-react, input-otp, react-resizable-panels, 7× @radix-ui) + `@types/dompurify` (dompurify 3.4 ships types) + `@tailwindcss/typography` (not in tailwind plugins) | unused | knip after #648 + grep; `tsc -b` clean; `bun install --frozen-lockfile` OK | A | DELETE — branch `cleanup/unused-deps` (PR after #648) |
| A-DEP-02 | `vite-plugin-pwa` | not imported | but `buildOnlyDeps.test.ts` (S11, #634, 2026-10-30) requires it in devDependencies | C | KEEP for now (Q6) |
| A-DEP-03 | `html2canvas`, `axe-core`, `@mediabunny/aac-encoder` | knip flags | html2canvas is jspdf's lazy peer (in bundle budget); axe-core injected by `tools/uishot/capture.mjs`; aac-encoder aliased in worker | — | KEEP |
| A-DEP-04 | `bun.lockb` beside `bun.lock` | old binary bun lockfile | `cleanInstallResolves.test` allows it; which file Cloudflare's bun reads when both exist not proven | C | ASK OWNER (Q7) |
| A-MIG-01 | `UNAPPLIED_*` ×9 | withdrawn/neutralised | each is read by a test (`m2-sql-baseline.json` — owned by just-merged #637, `referralReward0023Withdrawn`, `test-utils/migrations`) or cited by Addendum/DECISIONS; 0023/0027 money, 0029 auth; 0201 is the Owner's first-post switch; the 21k-line bootstrap holds the only git copy of several live-only functions | C | KEEP (Q8) |
| A-WF-01 | 58 workflows on staging | some rarely run | all ran ≤ 2026-10-30 except: `s3-media-backfill` (never run; manual, tested by `backfillWorkflow.test`), `verify-schema-dependencies` (never run; Addendum names it), `d1-baseline`/`d1-seed-staging` (last 09-04; manual tools with guard tests) | — | KEEP |
| A-CF-01 | `cloudflare/media-authz`, `cloudflare/seo-edge-injector` | — | media-authz built by `d2-media-authz.yml`; seo-edge-injector cited by D003 handover + ledger | — | KEEP |
| A-EF-01 | 6 edge functions with no caller in git: `backfill-image-hashes`, `brevo-webhook`, `evaluate-round2`, `handle-email-suppression`, `rank-feed`, `verify-image-hash` | no client/server caller | brevo-webhook / handle-email-suppression are called by external services (Brevo, email hook); evaluate-round2 = judging; PROBE 0501 §8 found no `/functions/v1/` URL in any cron command or function body on either lane — inconclusive, because crons reach edge functions through vault-held URLs (P9c); live delete blocked (no SUPABASE_ACCESS_TOKEN) | C | ASK OWNER (Q9) |

## A — GitHub

| ID | What | Proof | Decision |
|---|---|---|---|
| A-PR-01 | #391, #276, #214, #156 | each re-cut by a newer open PR whose body says so (#641, #639, #642, #640) | CLOSED with one-line reason |
| A-PR-02 | #305 (staging→main release PR) | active | KEEP |
| A-PR-03 | #174, #175 (P30/P31 evidence, Sep 5), #254 (Project Knowledge archive, 2 136 files), #285, #289 (held D2 units), #352 (P3 exporter draft) | not superseded by anything provable; content absent from staging | ASK OWNER (Q10) |
| A-BR-01 | 89 remote branches whose tip is an ancestor of `staging` or `main` (dated 2026-07-12 → 09-06; none status/*, s7b/*, carry/*, none with an open PR, none referenced by a workflow) | `git merge-base --is-ancestor` | DELETE — **blocked**: this session's git proxy refuses ref deletion (HTTP 403 on git push and REST). List + SHAs below (Q1) |

## B — database (PROBE 0501: staging run 41018483103, production run 41023653669)

Active app builds (production `client_telemetry`, last 30 days, counts only): android v1129 (133), v1131 (242), v1132 (186), v1133 (281); web 2026-08-20-2 (603). Telemetry starts 2026-10-28, so older Android builds that do not send it cannot be ruled out → no object an app build could call is dropped. `track_functions = none` on both lanes, so function call counts are unavailable.

| ID | Object | Evidence | Class | Decision |
|---|---|---|---|---|
| B-IDX-01 | `idx_unsubscribe_tokens_token`, `idx_suppressed_emails_email`, `idx_post_reactions_post_user`, `idx_feed_events_post` | identical twin on both lanes (DUPIDX); no caller by name in git; none backs a constraint | B | DROP — #664 staging, #665 main (runs below) |
| B-IDX-02 | `judge_decisions` two identical UNIQUE indexes | DUPIDX both lanes | C (judging) | ASK OWNER (Q12) |
| B-IDX-03 | `referral_codes` `idx_referral_codes_code` duplicates UNIQUE key | DUPIDX both lanes, 0 scans | C (referral rewards) | ASK OWNER (Q12) |
| B-TBL-01 | `posts_dead_host_backup_20260812` (prod 16 rows) | read by edge fn `detect-orphan-files` + `orphanReferenceSet.test` as a reference set | — | **KEEP** (in use) — capture into git (separate job) |
| B-TBL-02 | `p5_cron_previous`, `p6_cron_previous`, `f_p35_1_acl_before` | read by their rollback files | — | KEEP while those rollbacks stand |
| B-TBL-03 | `categories_migration_dropped` (0 rows both lanes) | only its creating migration; holds member ids by design | C (member data) | ASK OWNER (Q13) |
| B-TBL-04 | `_v3_preflight_snapshot_*`, `_v3_quarantine_*`, `round_snapshots`, `judging_preflight_log`, `vote_adjustment_cleanup_log` | read by `hard-delete-competition` / `complete-round` / types | C (judging) | KEEP |
| B-TBL-05 | `media_repair_audit` | audit trail of media repairs | C | KEEP |
| B-LIVE-01 | 37 functions / 5 tables / 5 policies / ~15 triggers / 6 cron jobs live but not in git (foundation audit) — incl. `password_verification_hook`, `trg_enforce_comment_blocklist`, `trg_flag_post_review`, email/re-engagement crons | in use | — | KEEP — capture into git (separate job) |
| B-SET-01 | `site_settings.ad_slots_backup_20260723` (both lanes) | no code reads it (only a migration comment) | C (ads/revenue config) | ASK OWNER (Q14) |
| B-SET-02 | all other `site_settings` keys (32) | each read by ≥ 2 code files | — | KEEP |

## D — storage (production, counts only)
avatars 14 objects / 43.1 MB · email-assets 14 / 57.7 MB · post-images 116 / 8.5 MB · site-assets 7 / 0.2 MB (all older than 30 days). Staging: post-images 4 / 0.18 MB. Orphan matching (object → referencing row) was not measured in this job; `detect-orphan-files` exists for that. Nothing deleted (class C).

## Merged branches (A-BR-01) — name · SHA · last commit
- ads-fixed-slot-positions ebe8ee3c1a1a47f57524ad1150d80365e2ff802c 2026-08-01
- ads-story-card-library 3fdf966c670639c8e0eff59428a595b5013de9e4 2026-08-01
- altisinfonet-patch-1 2c818db85a7a755e509eae0f1a02f442402d2c1e 2026-08-01
- altisinfonet-patch-10 7e367266ab266d6c9bdadab55bb8c5c2448bd77f 2026-08-02
- altisinfonet-patch-11 5ba2f97e21a22d539bbb3ed1e425f5b2a50036c1 2026-08-02
- altisinfonet-patch-12 8d4f87ea5b953b2e3e1076e0c444c26e0cd1b7d0 2026-08-02
- altisinfonet-patch-13 6e50c5595fb469422f6c0d9951f905a7996a0b9c 2026-08-02
- altisinfonet-patch-14 e0d4fefbf7a084f85297dc2197f1618b73e261e9 2026-08-02
- altisinfonet-patch-15 ce1e5f0e38f04ee907158a91cb1fdd90bda0a54a 2026-08-02
- altisinfonet-patch-16 84229d55400d3b52abf0a48f84b2bbf3430c7405 2026-08-03
- altisinfonet-patch-17 23ba4519fdb8e0ec2fc3807952f69f46f9cbff2d 2026-08-03
- altisinfonet-patch-18 35e448490064f23fd502557d4ec394b324ff2a76 2026-08-03
- altisinfonet-patch-19 42e2d1ed3ca9886e5d9726a598dbc43336f6093d 2026-08-03
- altisinfonet-patch-2 f74d10ec74ed132577088e85ac1e154f3c597ee5 2026-08-01
- altisinfonet-patch-20 499c94aba22b38c4fef5e6582defa930fa5573ab 2026-08-03
- altisinfonet-patch-21 109a0b134705bd3a180bfe6faa63071469301910 2026-08-03
- altisinfonet-patch-22 f9b93e12eb78ec2b522b353b0908520ecdade912 2026-08-03
- altisinfonet-patch-23 f3f69c41efc616cc7400a70eaf0a0be8f62155d3 2026-08-04
- altisinfonet-patch-24 a4b62b589c983d1db03c0cc364dd85d0adc25519 2026-08-04
- altisinfonet-patch-25 d779b32c322fc7ec9b5d908f84b86e4f0ad2f86a 2026-08-04
- altisinfonet-patch-26 773e63abd408d61e6c7e69ddeffd415cafe9885c 2026-08-04
- altisinfonet-patch-27 12eff5cab97a44415bf56d721dfbf5d1e2586a08 2026-08-04
- altisinfonet-patch-28 ec8a06995cab743af66d749714d132551f34ff65 2026-08-04
- altisinfonet-patch-29 5de152baba5511faa0f827f07170adba5a670e6b 2026-08-04
- altisinfonet-patch-3 4946a18514665406fbce1a058c4b64f54c69cec8 2026-08-02
- altisinfonet-patch-30 9b40755642883f52fefb51c97d250eb3b45345fe 2026-08-12
- altisinfonet-patch-4 6db297fd88e010a3af007144bb15e095f7a48066 2026-08-02
- altisinfonet-patch-5 eec6fe607e7c42bc259fcb5ad083527e36ce0e54 2026-08-02
- altisinfonet-patch-6 7c0e4029778bce71cb94cf78f2ed564d58f8595d 2026-08-02
- altisinfonet-patch-7 a9b920a24997971262870a51234c0268f82ca8ed 2026-08-02
- altisinfonet-patch-8 19d098ead0e7ca9e7913539f8b7affea7f5a9605 2026-08-02
- altisinfonet-patch-9 76b9d8785e3fe5645b73079f7a8f927d79970297 2026-08-02
- build-1052 89faae057b19fd70cdfe4f1be279ed19dc7367c2 2026-08-05
- cf-image-transformations b849d16473f4d5ae6cd3e894efd636217f6b4c05 2026-08-01
- claude/bug007-008-paywall-cert-rpc 191b7e20560f46541b7fac7912dd6a17fda1d75f 2026-07-12
- claude/bug020-award-uniqueness-scope 6844572eccc5a366888cbc40d7040106a3d47bc4 2026-07-14
- claude/bug021-null-aggregate-never-promotes e6e9bde7f395884ede0fd2c1e440dd4802ea668c 2026-07-14
- claude/bug024-scheduled-post-privacy 1ac2b10b88cd7db8846fd69566c5767c39c4c62c 2026-07-13
- claude/bug025-blocked-keywords-posts 6c70bad0ee148ccb81a5c1d8d1d24192f78db5e3 2026-07-13
- claude/bug027-106-026-backup-redaction b5252e58c65c79beedc9e01eebdd26e29e7cc8c5 2026-07-12
- claude/bug028-backfill-hash-pagination 4122a6b09f913212a11263fc08257cca07a01891 2026-07-14
- claude/bug029-thumbnails-real-resize 5a4792b5a4c7150e6c21d42cc15785ff75cd4c6f 2026-07-15
- claude/bug037-brevo-webhook 159e20da9ff19fc7d65babe3d895b96f23347907 2026-07-13
- claude/bug039-notification-preferences fc9916afa11f5c421ba60b9d989605cf8799b6bf 2026-07-15
- claude/bug043-turnstile-captcha 87084730e850cddc2efd6384e6b5435c55ec2930 2026-07-15
- claude/bug045-048-money-idempotency a54d8d5ae2cb023f4ff694e50d38e96180fbcf79 2026-07-15
- claude/bug054-atomic-tag-swap 21c03d850917cf8418e4ea21b84f9dc7dcf7a18b 2026-07-16
- claude/bug064-065-courses-editor 495873dd02284020c68bffe40479001d82d66fb4 2026-07-16
- claude/bug066-managed-page-views de94267875c66e69d1cdb6ef561f53c04ff8d5e5 2026-07-16
- claude/bug072-scheduled-boosts-accounting f89b2635ebd6a1484bcda5dd6bca83bbe6e455ce 2026-07-16
- claude/bug078-verify-cert-id 2ed73395744a62a8619a99b231d5fbf520b456f2 2026-07-16
- claude/bug080-081-082-results-display 4d8f7bdfb65d6a406aab02bd5973587485a1182a 2026-07-16
- claude/csp-allow-turnstile f698afa84b5698d182ddcb4dcc5c74415d7aaab0 2026-07-15
- claude/employee-id-verification-404 770675d50188313ef2bdb44ec615337202cd4950 2026-07-14
- claude/final-high-042b-043-044 07bb3069f274e582e24535d5adc8504dc694800e 2026-07-15
- claude/fix-login-import 5c04fd318f8daca4460a233d6ef60e1123a5de17 2026-07-15
- claude/fix-translate-footer-gap 4bd8a2a4d7f7826b5e74ce9b1565abe9e7878500 2026-07-13
- claude/frontend-security-fixes-6urlr2 9056df4d2f451646fbc47dccb797f5e2c240c714 2026-07-12
- claude/idverification-card-redesign 66490f1f48d744de2bb5cf41b1c348f07f0b0d9c 2026-07-15
- claude/judging15-fifteen-elements 7ef79ae8680772d45db09bf7d827d815323c0aa9 2026-07-17
- claude/phase2-complete-round-terminal d99303151877c3284d4ef0933187d491bcf47b34 2026-07-17
- claude/rank-feed-drop-ai ee1ead96a3e0eeeb31bd461f28499284e76380dc 2026-07-12
- claude/results-batch-030-034-040 753a6ca4e477aef7129479f9681bffe0e0d91248 2026-07-15
- contributor-score-feed-wall b8eb43c5c6196e4b009a8d4e24792bf70c58cc58 2026-08-11
- correct-score-badge-comment accd8e8cd857686f11161b1aad5fbfe65f56ae25 2026-08-11
- d1/f105-production-revokes-20260906 25e2f03a3f8d0361454e62e277026fb99b5f0592 2026-09-06
- d1/f105a-birthdays-revoke-20260906 1a6f7663cfd93a5f44dc42752b939613df813307 2026-09-06
- d1/f105c-friend-count-anon-revoke-20260906 ec7943ff95dba9777ddcd4cd4bc4789bc3e9feb4 2026-09-06
- d1/f105c-friend-graph-anon-revoke-20260906 a5c1785f5f836f715781a0193be35dd9281a55e6 2026-09-06
- d1/f93-production-handle-backfill-20260906 a2cb2592079c3722e62c41fe1f5de906ea63d98b 2026-09-06
- d1/f98c-birthdays-carry-handle-and-close-20260906 66bd141b3e2e11e5496ca01ed128a605ee23fb01 2026-09-06
- d2/F-108-F-109-hit-region-direction-20260906 cf9e5fd24d089822c31ea96c48e60b69354bbf1a 2026-09-06
- d2/F-98b-sidebar-dead-names-20260905 b350afe69deceba38ba620d2866b17984dd6ba62 2026-09-06
- display-engagement-reach-views 963e7ac50e3f81a07c174e38831a03c39b2965f0 2026-08-01
- fix-notification-list-scroll-close d041ed5dfcd09c50f38ebdb920bf22919e78fdd0 2026-08-01
- fix-score-badge-hidden-tab 17744aa4a696030407da37a3ec53eb2795316c57 2026-08-11
- notifications-history-grouping 4355b812447c40080ddea44092ee2649b11cc657 2026-08-01
- notifications-new-post-fanout 34b3a92cef2de66524af8b25644528000039b2b9 2026-08-01
- notifications-page 95ed4c99b6539ddcd26f5ec9ab2a51546d580a5a 2026-08-01
- perf-request-storm a0a47d8b2d59c3b26c1fdb2490e1edb2bca4c538 2026-08-01
- phase2a-engagement-collector c4446357c8e75f214b29af236ff6520dba997dae 2026-08-11
- photo-frame-any-ratio 69edfe936a8beccfa44c660b1dd6a01074657521 2026-08-01
- push-delivery-observability 84ee5e601bcbe1a996d053c9e93dcca9be74e3c6 2026-08-01
- reach-views-same-line 0b20d1d74626dc2ab6cb7bbeae1e8ee8964cb73b 2026-08-01
- real-engagement-and-follow-only bcc5320a6eabae2dceb9dd25e52ea6b1a84ca1b8 2026-07-31
- stage-c-plan a62d7f247e6226a0f3fe3848c2b428fa0db5d10e 2026-08-12
- tool/pushcheck-1787718423 c92d5345c69908caeff5ed08aabab559c5872b47 2026-08-25
- top-contributors-v2-frontend 43fa09ff58bb890245556f451b39499ddad2e47a 2026-08-11
- uniform-card-spacing 2ac3b85738f0b04d582c10fd1c6735e2e3da4415 2026-08-01
