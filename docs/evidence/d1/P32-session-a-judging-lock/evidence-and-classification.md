# P32 Session A — Judging-Lock Unit — Evidence & Current-State Classification

**Date:** 2026-09-21 · **Base:** `staging` @ `f0377afa29d61ea44cbed38b7ed6d38e296df225` (re-verified live, unchanged since PR #274)
**Branch:** `d1/P32-session-a-judging-lock-20260921` · **Ordinal:** `_0030` (first free of both the merged tree and PR #274's reservation of `_0027`–`_0029`)

## Re-measured from current state (not carried over from any prior count)

- Live staging anon-executable, non-trigger, VOLATILE function count: **75** — unchanged from the count taken before PR #274 was authored. `list_migrations` still shows the same 8 pre-P32 entries. Confirms: **nothing has been dispatched to staging from any P32 unit yet**, including nothing from PR #274 (still unmerged).
- PR #274: head `a2a1d393cd517fdff5cc4beacdcd33cb88858e74`, base `staging`, merge-base with current `staging` HEAD confirmed exactly equal (`f0377af...`). Untouched by this unit — not modified, rebased, or force-pushed.

## This unit's forensic finding

**`acquire_judge_lock` / `heartbeat_judge_lock` / `release_judge_lock`** (SECURITY DEFINER, VOLATILE) take `_judge_id` as a bare caller-supplied parameter with no verification it matches the caller. Confirmed live: all three are PUBLIC/anon/authenticated-executable. Any authenticated caller can force-release, indefinitely heartbeat, or fraudulently acquire a lock under **any other judge's id** — the most severe of the three, `release_judge_lock`, is a direct one-call DoS against a judge actively scoring an entry.

**Blast radius, measured, not assumed:** the only caller of all three is `src/hooks/judging/useJudgingLock.ts`, invoked exactly once at `src/pages/JudgePanel.tsx:385` as `useJudgingLock(user?.id, ...)` — always the current session's own id, never the admin "seat mode" id (`effectiveJudgeId`/`seatJudgeId`) used elsewhere in this same feature for actual writes. Grepped this session: zero references to seat mode inside `useJudgingLock.ts` or its call site. So `_judge_id = auth.uid()` is not new behavior — it's the invariant every real caller already satisfies.

**`judge_apply_single_tag`** (SECURITY DEFINER, VOLATILE) has the same caller-supplied `_judge_id` gap, but writes the actual scoring data. Its only caller, `supabase/functions/submit-judge-tag/index.ts` (read in full this session), already validates JWT, role, entry assignment, round-lock state, tag visibility, and the R4 unique-award rule — via a genuine `service_role` client (`createClient(url, serviceKey)`, confirmed in `_shared/judgingAuth.ts`). Grant-only closure (PUBLIC/anon/authenticated revoked, service_role retained) removes the direct-RPC bypass with zero effect on the sanctioned path.

## Fix

Body-level identity check added to the three lock functions (reject when `auth.uid()` is null, when `_judge_id ≠ auth.uid()`, or when the caller holds neither `judge` nor `admin` role — the same `has_role` pattern and judge-or-admin gate already used by this feature's own edge function, not an invented rule) + grant-only closure of `judge_apply_single_tag`. Full rationale in the migration file's own header.

## Not decided here — flagged for Owner/Auditor

Whether lock **acquisition** should also require the judge be specifically assigned to that entry (the deeper check `validateJudgeAssignment` performs before the actual scoring write). Today any judge/admin can preview-lock any entry; only the write is assignment-gated. May be intentional. Not touched.

## Fixture validation (C-34)

Full transcript at `fixture-transcript.txt` in this directory. Unlike the prior grant-only P32 units, this probe had to prove **body** behaviour, not just grants — it simulates PostgREST's JWT context via `set_config('request.jwt.claim.sub', ...)` (confirmed this session as exactly what `auth.uid()` reads) and actually attempts the impersonation, inside a transaction that always ends in `ROLLBACK`:

1. PROBE before any fix — **FAILED** (grant check, as expected — original grants are wide open).
2. Migration applied — clean, zero errors.
3. PROBE after — **ALL PASSED**: grant checks; C1 unauthenticated caller rejected (`28000`); **C2 — the actual impersonation attempt (auth.uid()=judge_a calling `release_judge_lock` claiming `_judge_id=judge_b`) rejected (`42501`)**; C3 non-judge/non-admin caller rejected (`42501`); D1/D2 — a legitimate judge acting as themselves can still acquire and release their own lock (proves this is not an over-fix).
4. Migration re-applied — idempotent, zero errors.
5. `_ROLLBACK.sql` applied (restores original bodies + original wide-open grants) — PROBE **failed again**, on the same grant assertion, confirming the probe is not vacuous and the rollback is faithful.

## Remaining P32 functions — current-state classification (75 total anon-exec VOLATILE, minus 18 in PR #274, minus 4 in this unit = 53 remaining)

Re-derived this session from live `pg_get_functiondef` reads (where read) and prior-session reads (where not re-read this turn — marked). Not a re-count of "~57" — this is the actual current name list, classified:

**Safe grant-only closure (body already checks identity/role correctly; PUBLIC/anon exposure is the only gap) — 14, all previously read:** `admin_flag_entry_for_review`, `admin_rewind_stage`, `admin_set_photo_rejected`, `apply_decision_to_remaining`, `backfill_tag_decision_drift_admin`, `fix_certificate_readiness_admin`, `fix_gift_drift_admin`, `fix_referral_drift_admin`, `get_certificate_drift_admin`, `get_derived_status_drift_admin`, `get_judge_collusion_admin`, `backfill_judging_notifications`, `admin_purge_orphan_user_data` (already in PR #274 — excluded from this count), `recompute_entry_from_tag_assignments` (confirmed no-op stub).

**Intentional public endpoint, RETAIN with written justification:** `get_broadcast_feed` (×3 overloads — deliberately serves anon via `coalesce(auth.uid()::text,'anon')`), `log_app_event`, `log_client_error` (rate-limited by design), `record_test_agent_run` (confirmed this session: its only caller, `scripts/test-agent/run-checks.mjs`, uses the anon key by design for CI reporting — not re-audited for write-abuse-safety beyond that).

**Internal/service-role only, needs closure (no auth check, not meant for any human caller) — previously read, not re-verified this session:** `expire_gift_credit` (in PR #274), `recompute_entry_public_status`, `enqueue_post_job`, `process_post_jobs`, `reap_post_drafts`, `mark_expiring_post_drafts`, `expiring_post_drafts`, `recount_hashtags`, `log_push_outcome`, `prune_activity_minutes`, `prune_client_errors`, `prune_old_notifications`, `refresh_viewer_buckets`, `rollup_engagement_daily`, `emit_birthday_notifications`, `pj_handle_comment_notification`, `pj_handle_reaction_notification`, `pj_handle_recount_engagement`, `pj_handle_tag_notification`, `move_to_dlq` / `delete_email` / `emit_notification` (P32 mail-group — merged, still not dispatched, tracked separately).

**Not yet read this session or last — genuinely unclassified, need a body read before any disposition:** `_ensure_stats_row`, `_gen_competition_order_no`, `get_judging_tag_assignment_counts`, `judging_write_decision_atomic`, `register_push_token`, `unregister_push_token`, `record_activity_minute`, `set_write_path`, `wallet_ledger_v2_diff_snapshot`, `create_system_post`, `submit_competition_entry`, `enroll_in_course`, `issue_course_completion_certificate`. (`register_push_token`/`unregister_push_token`/`record_activity_minute`/`create_system_post`/`submit_competition_entry`/`enroll_in_course`/`issue_course_completion_certificate` were read in a prior session per the earlier summary and noted as properly `auth.uid()`-guarded — carried forward as likely-safe-grant-only, but flagged here as not re-verified live this turn, so not claimed as confirmed.)

**Owner/Auditor decision required (unchanged from before, re-confirmed not touched):** `increment_managed_page_view` (product call: public counter vs. closure — client-side blocker already fixed), and, outside the VOLATILE/anon-exec list itself, `verify_staff_id` and `entry_vote_counts` (rate-limit design / public vote-count exposure).

This is a current-state re-derivation, not a copy of the earlier "~57" figure — the true remaining count is **53** after this unit, of which roughly 14 are ready for a same-shaped grant-only migration next, ~20 are internal/service-role candidates needing the same treatment, ~13 are still genuinely unread this session, and a handful are intentional-retain or Owner-decision items.

## Confirmations

- No migration dispatched to staging or production from this unit or any other P32 work this session.
- PR #274 left untouched (not merged, not modified).
- No Gate Register, Promotion Ledger, or other governance/session file touched.
