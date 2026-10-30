# C-2 — unused-index reconciliation (hold H-1)

Status: **PROPOSED, for the Auditor.** This document releases nothing on its own.
H-1 ("no index is dropped by anyone") stays in force until the Auditor accepts it.
Even after that, no index is dropped before A-4c.

Author: STAGES runner, 2026-10-30. Every number below comes from a read-only PROBE
run through `apply-migration.yml` (BEGIN READ ONLY … ROLLBACK), on the lane
and at the time stated.

## 1. The method (one method, scope in the same sentence)

> **An index is an unused-index candidate when it is in schema `public`, has
> `idx_scan = 0` over a statistics window of at least 14 days, is neither a
> primary key nor unique, is not on an extension-owned table, and does not
> back the referencing columns of a foreign key.**

This is method **P** in `PROBE_20261031_0603_s10_c2_unused_index_methods.sql`.

Why each limit is there:

| Limit | Reason |
|---|---|
| schema `public` only | It is the only schema whose indexes this app creates and owns. Supabase's schemas (auth, storage, realtime, …) and **`pgmq`** are managed by the platform or by `pgmq.create()`. Their indexes serve the platform's own functions, e.g. a queue's `vt` index is used by `pgmq.read`. |
| no PK / unique | Those indexes enforce constraints. "Unused by queries" says nothing about them. |
| not on an extension-owned table | The extension owns it, so we cannot drop it. |
| not FK-backing | Deletes and updates on the parent table rely on it, even when no SELECT ever scans it. |
| window ≥ 14 days | Counters since the last statistics reset. A short window counts indexes used weekly, or only during judging, as "unused". |

## 2. All methods on both lanes (2026-10-30)

| Method | Scope | Staging (run 41057759135, window 65.7 d) | Production (run 41066132984, window 99.9 d) |
|---|---|---|---|
| M1 | public, every zero-scan index | 251 | 201 |
| M2 | public, zero-scan, not PK/unique | 138 | 82 |
| M3 | all non-system schemas, every zero-scan index | 375 | 329 |
| M4 | all non-system schemas, zero-scan, not PK/unique | 196 | 139 |
| M5 | denominator: every index, all non-system schemas | 692 | 708 |
| L | Supabase linter `unused_index` rule | 140 | 90 |
| **P** | **the method in §1** | **85** | **48** |

The September numbers (79 / 78 / 298-of-which-125 / 188, register H-1) are the
same populations read on a different day. Every one of them is a cumulative
counter, so its value depends on when it is read and how long the window is.

## 3. Accounting for the 79

L and M2 differ only by scope. PROBE `PROBE_20261031_0604_s10_c2_scope_diff.sql`
names both differences:

| Lane | L − M2 | In L, not in M2 | In M2, not in L |
|---|---|---|---|
| staging (run 41064517323) | 140 − 138 = **2** | 2, **all in `pgmq`**: `a_transactional_emails.archived_at_idx_…`, `q_transactional_emails.…_vt_idx` | 0 |
| production (run 41066255095) | 90 − 82 = **8** | 8, **all in `pgmq`**: the archive and `vt` indexes of the `auth_emails`, `auth_emails_dlq`, `post_jobs`, `transactional_emails` and `transactional_emails_dlq` queues | 0 |

So the linter rule is always **M2 plus the zero-scan indexes of pgmq queues**.
Nothing separates the two counts except queue tables. A queue table's indexes
move in and out of "zero scans" as the queue is read. New queues add
indexes.

**The 79 accounted for:** the plan's 79 and the linter/M2 78 were the same
populations, and they differed by one zero-scan pgmq queue index at the moment
the plan was read. That one index is outside `public`, is owned by the queue
machinery, and is outside method P by design. It was never a droppable app
index.

**Not verified, and why:** the exact pgmq index behind September's "+1" cannot
be re-measured now. Usage counters are cumulative, and the queues have been
read since then. What is shown is that, on both lanes today, the **only**
population that makes L differ from M2 is pgmq. The other explanation, a
`public` index used between the two September readings, needs the same
mechanism: a cumulative count read on two days. Either way method P, with its
scope and window pinned, removes the ambiguity.

## 4. Candidates for A-4c (not a drop list)

- 43 indexes are candidates on **both** lanes. They are the only ones worth
  reviewing, because a staging-only candidate may simply be unused on smaller
  data:
  `ad_conversions.{idx_ad_conversions_ad_id, _created, _type}`,
  `ad_impressions.{idx_ad_impressions_ad_source_created, _creative, _slot}`,
  `certificates.{idx_certificates_is_revoked, idx_certificates_issued_at_id_desc}`,
  `client_telemetry.client_telemetry_created_brin`,
  `comment_reports.idx_comment_reports_status`,
  `competition_entries.{idx_competition_entries_current_round_int, _photo_meta, _photo_meta_gin}`,
  `competition_orders.{idx_competition_orders_status, _user_created}`,
  `entry_score_cache.idx_esc_avg`,
  `feed_post_signals.feed_post_signals_first_brin`,
  `feed_signal_events.feed_signal_events_created_brin`,
  `held_result_notifications.held_result_notifications_release_idx`,
  `image_comments.idx_image_comments_lookup`,
  `judging_preflight_log.idx_judging_preflight_log_drift`,
  `photo_albums.idx_photo_albums_user`,
  `post_tags.idx_post_tags_tagger`,
  `posts.{idx_posts_categories, idx_posts_indexing_disabled}`,
  `profiles.idx_profiles_reengagement_scan`,
  `push_delivery_log.idx_push_delivery_log_outcome`,
  `referral_codes.idx_referral_codes_code`,
  `reports.idx_reports_status`,
  `test_agent_runs.idx_test_agent_runs_status`,
  `v3_mirror_log.v3_mirror_log_occurred_idx`,
  `v3_stage_catalog.{v3_stage_catalog_label_lower_idx, _round_active_idx}`,
  `v3_tag_label_alias.v3_tag_label_alias_lookup_idx`,
  `wallet_ledger_audit_log.idx_wlal_target_user`,
  `wallet_ledger_shadow_log.idx_wlsl_op_key`,
  `wallet_ledger_v2_rows.{…_op_created_at_idx, …_user_id_created_at_idx}`,
  `wallet_reconciliation_log.{idx_wallet_recon_finding_type, _transaction_id, _user_id}`,
  `wallet_transactions.idx_wt_status_voided`,
  `withdrawal_requests.idx_withdrawal_status`.
- 5 are production-only candidates: `image_reactions.idx_image_reactions_lookup`,
  `post_shares.post_shares_created_at_idx`, `profiles.idx_profiles_indexing_disabled`,
  `scheduled_posts.idx_scheduled_posts_publishing_stale`,
  `wallet_ledger_audit_log.idx_wlal_op_result`.
- Each candidate still needs a code search for its query shape before any drop.
  Some exist for rare paths: judging rounds, payouts, a results release, the
  admin report queue. A 99-day window may not include such a run.
- Overlaps with open decisions:
  - `wallet_ledger_v2_rows` and `v3_mirror_log` are P27 tables (Owner item 16). Their indexes go with that decision, not here.
  - `referral_codes` has the duplicate already waiting for A-4c.
- The largest candidate is 328 kB (production). All 48 together are about
  1.3 MB, so dropping them is about write cost and clarity, not space.

## 5. What this asks the Auditor

1. Accept method P (§1) as the C-2 method, with its scope as written.
2. Accept §3 as accounting for the 79.
3. Release H-1 **only** into A-4c's own gate: a drop needs P on both lanes, a code
   search, a rollback that re-creates the index, and its PROBE.

Evidence runs: 41057759135, 41066132984 (methods), 41064517323, 41066255095
(scope diff). The PROBE files are on `main` (#687, #692).
