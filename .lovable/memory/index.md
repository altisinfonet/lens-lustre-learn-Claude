# Memory: index.md

## Core
- **Theme**: High-density minimal dark editorial. 3-column layout (590px center). `bg-secondary-foreground` for inputs.
- **Brand**: 50mm Retina World. Exclusive photographers community with 'Earn while you create' model.
- **Images**: WebP-only conversion at 100% original resolution. JPEG files generated via Canvas API on demand.
- **Time**: UTC as System Truth. All deadlines strictly end-of-day UTC. Browser time is for UI display only.
- **Security**: Strict RLS on all tables. No public write access. The `profiles` table is the absolute truth for identity.
- **Competition**: One Image, One Card, One Vote, One URL. Flattened data model per photo.
- **Privacy**: During voting/judging phases, all social engagement and public vote counts are globally hidden.
- **Data Integrity**: Soft-Delete policy strictly enforced (use `status` or `is_active`, never hard DELETE).
- **Revenue**: Financial Model Option B - Admin wallet credited atomically on deposit.
- **Localization**: Exclusively use Google Translate widget. No custom translation logic.
- **Dev Standards**: Zero-Risk Mandate - strict forensic audits for all changes, no guesswork.
- **Verify-as-User Mandate**: After EVERY task (code/migration/edge-fn/UI), act as a real user via `browser--*` tools, screenshot the fixed state, then summarize. Skip only for pure docs/memory/CI work or when user says "skip QA".
- **QA Host Rule**: NEVER use `navigate_to_sandbox` (id-preview host is platform-gated → 302 auth-bridge). Always `browser--navigate_to_url` to `https://fiftymmretinaworld.lovable.app` (or `https://50mmretina.com`) for verification.
- **QA Test Accounts**: Admin `mr.neilbasu@gmail.com` + Participant `sendipannita2@gmail.com`, both `Passw0rd@123`. Always do 2-account walk after changes. See [mem://qa/test-accounts](mem://qa/test-accounts).
- **Ruleset v4 (TOP PRIORITY, 2026-04-29)**: Certificates are issued ONLY in Round 4, ONLY for the 7 award tags (Winner, 1st/2nd Runner-Up, Honorary Mention, Special Jury, Top 50, Top 100). R1/R2/R3 issue NO certificates. R2/R3 are strictly binary by 10-criteria avg (≥7 advances). The 'Stay' bucket is REMOVED. See [mem://judging/ruleset-v4-r4-only-certs].
- **Single mirror trigger on `judge_tag_assignments`** — `trg_mirror_system_tag_to_decision` only. Adding a second is forbidden (B2 lockdown 2026-05-04). See [mem://judging/single-mirror-trigger-lockdown].

## Memories
- Initial project setup and branding guidelines established.
- Authentication flow implemented using Supabase Auth.
- Test credentials saved for future QA:
  - Admin: mr.neilbasu@gmail.com / Passw0rd@123
  - Participant: sendipannita2@gmail.com / Passw0rd@123
- [Ruleset v4 — R4-Only Certificates](mem://judging/ruleset-v4-r4-only-certs) — TOP PRIORITY. Certs only in R4 + only for 7 award tags. R2/R3 binary. Stay bucket removed. All R1/R2/R3 certs revoked.
- [Certificate Eligibility v4](mem://judging/certificate-eligibility-v4) — The 7 cert-eligible R4 tags + code contract for `certificate_ready` + `is_revoked`.
- [R2/R3 Binary Vocabulary](mem://judging/r2-r3-no-needs-review) — Strictly two outcomes per round, derived from 10-criteria avg ≥7. No Stay, no Needs Review, no tag UI.
- [Tags Only in R4](mem://judging/tags-only-in-r4) — All tag chips R4-only. Phase 1–3 Stay tag exception revoked.
- [Email Templates v4](mem://judging/email-templates-v4) — `entry-stayed-at-round` deleted; `certificate-revoked` added.
- [R2/R3 Three-Bucket Policy — ARCHIVED](mem://judging/r2-r3-three-bucket-policy) — Superseded by Ruleset v4. Historical reference only, do NOT apply.
- [Participant Wording Master Plan](mem://judging/participant-wording-master-plan) — 16-key v3 catalog is the SINGLE source for participant labels; UI must call `getStageByKey().tag_label_canonical`. Retired-strings list enforced by CI.
- [Phase 8 CI Lock](.github/workflows/audit-forbidden.yml) — Forbidden retired labels grep + `v3_catalog_parity.mjs` strict 16-row + label assertion. Canary-proven: bad label → red CI; clean → green.
- [PerPhotoStatus Single Source](mem://judging/per-photo-status-single-source) — Phase 2: union lives in `src/lib/judging/perPhotoStatusTypes.ts`; reader hook `usePhotoDecisions` does `r.status ?? r.status_legacy`; canonical R1 keys parity-locked to legacy via `per-photo-status-canonical-parity.spec.ts` + CI workflow `per-photo-status-types.yml`.
- [Test Agent CI](mem://ci/test-agent) — Continuous CI: every push + cron `*/5 * * * *`; logs to `.lovable/test-reports/`, `test_agent_runs` table, `/admin/test-agent`, GH Actions; failure → dedup'd issue + Brevo email; health via `get_test_agent_health_admin()` (parity + NR drift)
- [Per-Photo Placement Phase 3](mem://judging/per-photo-placement-phase3) — Sibling RPC `get_per_photo_placement` reads judge_tag_assignments (round=4) joined with judging_tags; emits 8 R4 canonical keys (r4_winner/runner_up_1/runner_up_2/top_50/top_100/finalist/honorary_mention/special_jury); usePhotoPlacements hook + mergeConsensusAndPlacement utility (placement always wins). Privacy: declared (published_at IS NOT NULL) gate. Live: 14/14 R4 photos surface correctly.
- [Per-Photo Placement UI Wiring (Phase 4)](mem://judging/per-photo-placement-phase4-wiring) — fetchPhotoStatusMaps merges consensus+placement at the chokepoint; SubmissionDetail auto-renders r4_* labels per photo
- [RPC Vocabulary Contract](mem://judging/rpc-vocabulary-contract) — Phase 6 / F7: get_per_photo_consensus + get_per_photo_placement may only emit 16 PARTICIPANT_LABELS keys + 2 sentinels (pending_consensus, r1_needs_review) + 2 R4 legacy aliases (winner, finalist). Static spec `src/test/rpc-consensus-vocabulary.spec.ts` + live audit `scripts/audits/rpc_contract_parity.mjs` + CI `.github/workflows/rpc-contract-parity.yml`.
- [Per-Photo Chokepoint ESLint](mem://judging/per-photo-chokepoint-eslint) — Phase 4 closure: `audit-v6/no-direct-photo-decisions-import` blocks value imports of usePhotoDecisions/usePhotoPlacements/fetchPhotoConsensus/fetchPhotoPlacements/buildPhotoStatusMaps outside `src/lib/perPhotoStatus.ts`; type-only imports allowed; tested via `src/test/eslint-no-direct-photo-decisions.spec.ts`
- [Per-Photo Status Alias Retirement](mem://judging/per-photo-status-alias-retirement) — Phase 5 closure: dead `r2_not_selected`/`r3_not_selected` rewriter arms deleted; remaining 2 arms (r2_qualified_r3→round2_qualified, r3_qualified_final→finalist) blocked by 7 string-comparing consumers + `PHOTO_STATUS_WHITELIST` typing in SubmissionDetail; locked by `src/test/build-photo-status-maps-invariant.spec.ts` (10 cases)
- [RPC Vocabulary Contract Strict 16+2](mem://judging/rpc-vocabulary-contract) — Phase 6 CLOSURE (2026-05-02): consensus RPC R4 CASE branches `winner`/`finalist` DROPPED; consensus emits 9 keys (R1/R2/R3 + pending_consensus), placement emits 8 R4 keys. Total 18-key contract enforced by spec + live audit + DB COMMENT. Replaces earlier 16+2+2.
- [Email Re-Keying Phase 7](mem://judging/email-rekeying-phase7) — Every emit_notification call from notify_entry_status_change / notify_round_published(_insert) / backfill_judging_notifications now embeds canonical v3 `stageKey` via IMMUTABLE `_resolve_stage_key_from_entry(status,current_round,progression_decision)`. Templates already prefer stageKey + labelForStageKey(). Locked by `src/test/notifications-stage-key-payload.spec.ts` (6 cases).
- [Upload Gateway JWT Pinning](mem://security/upload-gateway-jwt) — `s3-presign-upload` MUST keep `[functions.s3-presign-upload] verify_jwt = false` in `supabase/config.toml` + client `invokePresignWithRetry` auto-refreshes session on 401/403 then signs out cleanly. Removing either re-introduces silent total upload outage ("Edge Function returned a non-2xx status code").
- [Single Mirror Trigger Lockdown](mem://judging/single-mirror-trigger-lockdown) — B2 MUST-DO #1 (2026-05-04): dropped duplicate `tr_mirror_system_tag_to_decision` on `judge_tag_assignments`; canonical `trg_*` retained. Function idempotent via `ON CONFLICT DO UPDATE`. Inventory: `/mnt/documents/B2-writer-inventory-v1.md`. Supersedes B1.8 chat draft.
- [Stage-key Immutability (B1.5)](mem://judging/stage-key-immutability-b1.5) — competition_entries.stage_key column + FK to v3_stage_catalog; trg_guard_stage_key_immutability blocks backwards moves; admin_rewind_stage(uuid,text,text) is the only legal rewind path, audited to db_audit_logs
- [Derived Status Cache (B1.7)](mem://judging/derived-status-cache-b1.7) — competition_entries.public_status_derived cache + entry/publish-side recompute triggers + get_derived_status_drift_admin() RPC for nightly zero-drift soak before B1.8 UI consumer migration
- [Accepted Risk — wallet_transaction & backfill_judging_notifications authenticated EXECUTE](mem://constraints/accepted-risk-wallet-backfill-authenticated-execute) — Phase 3 (2026-05-25): bare REVOKE forbidden; in-body auth (`auth.uid()`/`has_role`) is the defense layer; see `docs/fix-sprints/PHASE-3-ACCEPTED-DEFENSE-IN-DEPTH.md`
- [complete-round service-role bypass](mem://security/complete-round-service-role-bypass) — JP-C-3/AP-C-3: Stage 1 instrumentation live; Stage 2 removal blocked until 5-gate checklist (0 invocations + admin-JWT success + no auth errors + no external refs + team confirm) is green
