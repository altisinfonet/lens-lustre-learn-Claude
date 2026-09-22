# D1 · PHASE 1 OBJECT RESERVATION — 2026-09-22

**Author:** D1 (Database & Runtime), Session A, 2026-09-22.
**Skill §3:** *"Before writing any SQL, post an object reservation."*
**Posted before any file in this unit was written.** This is the first commit of the session.

**Why it exists as a discipline, stated plainly:** no object reservation was posted for P32. Two
ordinals in the Phase 1 block have collided with no parallel workers running (`0019` duplicated,
`0024` divergent across lanes). Independent selection is the cause; this file is the control.

---

## 0 · Scope of this reservation

This session performs **analysis, body reading and file preparation only**. Under the work order
§5 it writes **no `REVOKE`/`GRANT` migration for any object named below**, dispatches nothing on
either lane, and closes no gate.

The reservation is posted anyway, and at full width, because the *next* session's SQL will draw
from exactly this set and the Auditor needs the names recorded before that happens.

| Reservation class | Meaning |
|---|---|
| **READ-ONLY** | catalogue read + body read + caller trace. No DDL, no DML, no grant change. |
| **PREPARED** | a file is authored in this session and **not dispatched, not pushed, not merged**. |

---

## 1 · SET A — open on PRODUCTION, closed on STAGING (3 objects) · READ-ONLY

| object | identity args |
|---|---|
| `public.claim_username` | `candidate text` |
| `public.change_custom_url` | `_new_url text` |
| `public.clear_custom_url` | *(none)* |

## 2 · SET B — open on BOTH lanes (28 names / 30 rows) · READ-ONLY

`public._gen_competition_order_no` · `public.admin_flag_entry_for_review` ·
`public.admin_rewind_stage` · `public.admin_search_users` · `public.admin_set_photo_rejected` ·
`public.apply_decision_to_remaining` · `public.backfill_judging_notifications` ·
`public.backfill_tag_decision_drift_admin` · `public.fix_certificate_readiness_admin` ·
`public.fix_gift_drift_admin` · `public.fix_referral_drift_admin` ·
**`public.get_broadcast_feed` (all three signatures — see §2.1)** ·
`public.get_certificate_drift_admin` · `public.get_derived_status_drift_admin` ·
`public.get_judge_collusion_admin` · `public.get_judging_tag_assignment_counts` ·
`public.increment_managed_page_view` · `public.judging_write_decision_atomic` ·
`public.log_app_event` · `public.log_client_error` ·
`public.recompute_entry_from_tag_assignments` · `public.recompute_entry_public_status` ·
`public.record_test_agent_run` · `public.register_push_token` · `public.request_withdrawal` ·
`public.set_write_path` · `public.submit_competition_entry` · `public.unregister_push_token`

### 2.1 · `get_broadcast_feed` is reserved at signature level, not name level

A name-level reservation would be a lie here. Three signatures, read from the staging catalogue
2026-09-22T05:31Z:

| signature | reserved |
|---|---|
| `(_exclude_ids uuid[], _limit integer)` | yes |
| `(_exclude_ids uuid[], _limit integer, _newest_first integer)` | yes |
| `(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[])` | yes |

The first two are **thin wrappers that call the third** (§4.6 of the matrix). Reserving one and
not the others would leave a live path open behind a closed door.

## 3 · SET C — open on STAGING only (45 objects) · READ-ONLY

`_ensure_stats_row` · `acquire_judge_lock` · `admin_delete_auth_user` · `admin_list_certificates` ·
`admin_purge_orphan_user_data` · `admin_reject_wallet_transaction` ·
`admin_search_certificate_recipients` · `admin_search_users_v2` · `admin_wallet_credit` ·
`approve_deposit` · `create_pending_deposit` · `create_system_post` · `delete_email` ·
`emit_birthday_notifications` · `emit_notification` · `enqueue_post_job` · `enroll_in_course` ·
`expire_gift_credit` · `expiring_post_drafts` · `generate_custom_url` · `heartbeat_judge_lock` ·
`issue_course_completion_certificate` · `judge_apply_single_tag` · `log_push_outcome` ·
`mark_expiring_post_drafts` · `move_to_dlq` · `password_verification_hook` ·
`pj_handle_comment_notification` · `pj_handle_reaction_notification` ·
`pj_handle_recount_engagement` · `pj_handle_tag_notification` · `process_post_jobs` ·
`prune_activity_minutes` · `prune_client_errors` · `prune_old_notifications` · `reap_post_drafts` ·
`record_activity_minute` · `recount_hashtags` · `refresh_viewer_buckets` · `release_judge_lock` ·
`rollup_engagement_daily` · `soft_void_wallet_transactions` · `wallet_ledger_apply_v2` ·
`wallet_ledger_v2_diff_snapshot` · `wallet_transaction`

All 45 in schema `public`. Verified present, `prosecdef = true`, `anon EXECUTE = true`, `PUBLIC`
held — staging, 2026-09-22T05:31Z, one `SELECT`.

---

## 4 · PREPARED objects — files authored this session, nothing dispatched

| object | lane | file prepared | ordinal |
|---|---|---|---|
| `EXTENSION plpgsql_check` | **production only** | `prepared/P33-production-plpgsql-check-set-schema.sql.prepared` + `.ROLLBACK.prepared` | **NOT ALLOCATED — see BLOCKER-2** |
| `public.password_verification_hook(event jsonb)` | staging | `prepared/0029-split-a-password-verification-hook.sql.prepared` | re-cut of existing `0029` on PR #274 |
| `public.get_public_role_user_ids(text)` | staging | **deliberately NOT prepared** — Owner Decision 6 | — |

`plpgsql_check`'s production move additionally touches the `extensions` schema and, transitively,
every one of its 24 functions' schema qualification. Recorded here because a schema move is an
object change even though no function body alters.

---

## 5 · Objects explicitly NOT reserved

- Anything under `src/**`, `functions/**` (Pages), `tools/uishot/**`, `scripts/web-*.mjs` — D2's lane.
- `docs/gates/**`, `docs/PROMOTION_LEDGER.md` — Auditor's.
- `scripts/lane-config.mjs` / `.d.mts` — frozen.
- `package.json` / `package-lock.json` — dependency window **CLOSED** for Phase 1
  (`phase-1-kickoff.md` §3). Nothing in this unit needs it.
- The four functions already inside PRs #274/#275/#276 as *migrations* are reserved above for
  **reading only**; their migrations belong to those PRs and are not re-authored here.

---

## 6 · Conflict check

Open D1 branches as at 2026-09-22T05:27Z (`git branch -r`, `git log`):

| branch | PR | objects it holds |
|---|---|---|
| `d1/P32-session-a-clean-20260921` | #274 | 18 objects via `0027`/`0028`/`0029` |
| `d1/P1-session-b-p30-p31-p33-20260921` | #275 | `get_primary_admin_user_id`, 2 leftover RLS tables via `0040`/`0041` |
| `d1/P32-session-a-judging-lock-20260921` | #276 | 4 judging-lock objects via `0030` |

**No reservation in §1–§4 writes to an object held by an open PR.** The overlap with #274
(`password_verification_hook`) is a **re-cut of that PR's own file**, prepared and not pushed, and
so does not create a second in-flight writer.

---

*Posted 2026-09-22T05:32Z. Basis `origin/staging` @ `f0377afa29d61ea44cbed38b7ed6d38e296df225`.*
