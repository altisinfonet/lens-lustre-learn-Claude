# STEP 2H — DATABASE / RLS BLUEPRINT

> Forensic, no-assumption inventory of the live Postgres schema (Lovable Cloud / Supabase).
> Source of truth: `pg_catalog`, `information_schema`, `pg_policies` against the live DB at audit time.
> This is a **structural & security map**, not a refactor proposal. No fixes, no recommendations.

---

## 0. Headline Counts

| Surface                                  | Count |
| ---------------------------------------- | ----: |
| Public tables                            |   114 |
| Public views                             |     6 |
| RLS-enabled tables                       |   114 |
| RLS-disabled tables                      |     0 |
| Tables with **zero** policies            |     0 |
| Total RLS policies                       |   344 |
| Public routines (functions/procedures)   |   213 |
| `SECURITY DEFINER` functions             |   194 |
| Sec-definer fns missing `search_path`    |     0 |
| Triggers (public schema)                 |   175 |
| Tables carrying triggers                 |    44 |

All 114 user tables have RLS enabled and at least one policy. No table is left fully open.

---

## 1. Schema Inventory (114 Tables, 6 Views)

Grouped by domain. Every table below has RLS = ON.

### 1.1 Identity & Access
- `profiles`, `profiles_public_data`, `user_roles`, `user_devices`, `role_applications`, `role_display_config`, `custom_url_history`
- Views: `profiles_public`

### 1.2 Social Graph & Feed
- `posts`, `post_comments`, `post_reactions`, `post_comment_reactions`, `post_shares`, `post_reports`, `post_tags`
- `comments`, `comment_reactions`, `comment_reports`
- `image_comments`, `image_reactions`
- `follows`, `friendships`, `feed_events`, `profile_views`
- `stories`, `highlights`, `highlight_items`
- `photo_albums`, `album_photos`, `portfolio_images`, `photo_of_the_day`, `featured_photos`, `featured_artists`

### 1.3 Competitions (Round-1 → Round-4 ecosystem)
- `competitions`, `competition_entries`, `competition_judges`, `competition_orders`, `competition_payment_details`, `competition_round_publish`, `competition_votes`, `competition_judging_tags`
- `judging_rounds`, `judging_config`, `judging_tags`, `judging_preflight_log`, `judging_progression_audit`
- `judge_decisions`, `judge_scores`, `judge_comments`, `judge_tag_assignments`, `judge_award_tags`, `judge_entry_assignments`, `judge_entry_locks`, `judge_sessions`, `judge_activity_logs`
- `entry_score_cache`, `round_snapshots`, `raw_commitments`
- `v3_stage_catalog`, `v3_tag_label_alias`, `v3_mirror_log`, `system_tag_decision_map`
- Quarantine / preflight: `_v3_preflight_snapshot_competition_entries`, `_v3_preflight_snapshot_judge_decisions`, `_v3_preflight_snapshot_judge_tag_assignments`, `_v3_preflight_snapshot_judging_tags`, `_v3_quarantine_decisions`, `_v3_quarantine_tag_assignments`
- Views: `entry_final_votes`, `entry_final_votes_legacy`, `entry_public_status`, `judging_progression_audit` (also a view), `v_judging_drift`

### 1.4 Wallet / Finance
- `wallets`, `wallet_transactions`, `wallet_reconciliation_log`, `vote_adjustment_cleanup_log`
- `withdrawal_requests`, `bank_details`, `gift_credits`, `gift_announcements`
- `referrals`, `referral_codes`
- `admin_vote_adjustments`

### 1.5 Certificates & Awards
- `certificates`, `certificate_testimonials`, `badge_definitions`, `user_badges`

### 1.6 Education / Content
- `courses`, `course_modules`, `course_enrollments`, `lessons`, `lesson_progress`, `journal_articles`, `faq_entries`, `chat_questions`

### 1.7 Notifications & Email
- `user_notifications`, `notification_preferences`, `notification_emit_log`
- `email_templates`, `email_send_log`, `email_send_state`, `email_unsubscribe_tokens`, `suppressed_emails`, `newsletter_subscribers`

### 1.8 Support / Moderation / Reports
- `support_tickets`, `ticket_replies`, `reports`, `blocked_keywords`, `admin_notifications`

### 1.9 Marketing / Discovery
- `hero_banners`, `scheduled_boosts`, `ad_impressions`, `ad_conversions`

### 1.10 Platform / System
- `site_settings`, `system_flags`, `db_audit_logs`, `activity_logs`, `ai_chat_usage`, `test_agent_config`, `test_agent_runs`

---

## 2. RLS Policy Density

Top 25 tables by policy count (out of 344 policies total):

| Table                       | # Policies |
| --------------------------- | ---------: |
| `post_tags`                 |          8 |
| `user_roles`                |          7 |
| `profiles`                  |          6 |
| `posts`                     |          6 |
| `post_comments`             |          6 |
| `judge_tag_assignments`     |          6 |
| `judge_comments`            |          6 |
| `image_comments`            |          6 |
| `comments`                  |          6 |
| `user_devices`              |          5 |
| `role_applications`         |          5 |
| `post_reactions`            |          5 |
| `photo_albums`              |          5 |
| `lessons`                   |          5 |
| `judge_scores`              |          5 |
| `judge_entry_locks`         |          5 |
| `judge_decisions`           |          5 |
| `journal_articles`          |          5 |
| `friendships`               |          5 |
| `faq_entries`               |          5 |
| `courses`                   |          5 |
| `album_photos`              |          5 |

The 4-policy CRUD pattern (`select`, `insert`, `update`, `delete`) is the floor; tables with 5+ policies typically split read access into `self`, `friends`, `admin`, and `judge` predicates.

---

## 3. Policy Patterns (verified across `pg_policies`)

| Pattern                     | Implementation marker                                                              | Used on (examples)                                          |
| --------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Owner-only**              | `auth.uid() = user_id`                                                             | `wallets`, `notification_preferences`, `bank_details`       |
| **Public read**             | `USING (true)`                                                                     | `competitions` (active), `hero_banners`, `journal_articles` |
| **Role-gated** (admin/judge) | `public.has_role(auth.uid(), 'admin')` / `public.judge_can_access_entry(...)`     | `admin_notifications`, `judge_decisions`, `competitions`    |
| **Friendship-gated**        | `public.are_friends(auth.uid(), profile_id)`                                       | `posts` (private), `image_comments`, `stories`              |
| **Soft-delete aware**       | `status <> 'deleted'` / `is_active = true`                                         | `posts`, `competition_entries`, `comments`                  |
| **Phase-locked**            | `NOT public.is_engagement_phase_locked(comp_id)` / `is_vote_phase_locked(...)`     | `competition_votes`, `image_reactions`, `image_comments`    |
| **Privacy-gated** (SEO)     | `coalesce(indexing_disabled, false) = false`                                       | `posts` (public read), `competition_entries` (derived)      |
| **Insert self-id**          | `WITH CHECK (auth.uid() = user_id)`                                                | All user-write tables (60+)                                 |
| **Deny direct read**        | `USING (false)` paired with `security_invoker` views                               | `profiles_public_data` → `profiles_public` view             |
| **Realtime broadcast**      | Public read on a curated subset (no PII)                                           | `feed_events`, `competition_round_publish`                  |

---

## 4. Views (6)

| View                          | Purpose                                                                          | Security model                         |
| ----------------------------- | -------------------------------------------------------------------------------- | -------------------------------------- |
| `profiles_public`             | Strips PII (email/phone/IDs) from `profiles_public_data` for unauthenticated UI  | `security_invoker=on` + base table SELECT denied |
| `entry_public_status`         | Derives `publicStatus` / `publicPlacement` per entry (round digits + status)     | Reads via invoker; gating in `useGatedEntryStatus` |
| `entry_final_votes`           | Photo-grain vote totals (`real + adjustment`, `|adj|≤1000` cap)                  | Replaces legacy `competition_votes` count |
| `entry_final_votes_legacy`    | Pre-Phase-2.2 vote totals retained for reconciliation only                       | Read by admin reconciliation only      |
| `judging_progression_audit`   | View+RPC pair powering `/admin/health` drift widgets                             | Admin-only RPC `get_progression_drift_admin` |
| `v_judging_drift`             | Roll-up of per-entry judging invariant breaks                                    | Admin-only via SECURITY DEFINER RPCs   |

---

## 5. Routines (213 total, 194 SECURITY DEFINER)

All 194 `SECURITY DEFINER` functions have an explicit `SET search_path` (zero linter findings on this rule).

### 5.1 Functional groupings

| Group                          | Representative functions                                                                                                                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authorization predicates**   | `has_role`, `is_entry_owner`, `is_banned`, `judge_can_access_entry`, `owns_album`, `are_friends`, `mutual_friends_count`, `friend_count`, `check_friend_limit`, `can_view_post`                                                                                                   |
| **Phase / lifecycle gates**    | `current_phase`, `current_phase_for`, `is_vote_phase_locked`, `is_engagement_phase_locked`, `enforce_round_lock`, `enforce_status_round_consistency`, `enforce_progression_decision_pending_gate`, `enforce_progression_decision_vocabulary`, `enforce_non_system_tags_round4`    |
| **Judging atomic writes**      | `judging_write_decision_atomic`, `submit_competition_entry`, `acquire_judge_lock`, `heartbeat_judge_lock`, `release_judge_lock`, `apply_decision_to_remaining`, `mirror_system_tag_to_decision`, `recompute_entry_from_tag_assignments`                                            |
| **Per-photo consensus**        | `get_per_photo_consensus`, `get_per_photo_placement`, `get_round_eligible_photos`, `get_round_pending_entries`, `get_needs_review_recipients_for_round`                                                                                                                            |
| **Wallet & money**             | `wallet_transaction` (sole ledger entrypoint), `admin_wallet_credit`, `approve_deposit`, `process_referral_reward` (×2 overloads)                                                                                                                                                  |
| **Notifications backbone**     | `emit_notification`, `enqueue_email`, `read_email_batch`, `move_to_dlq`, `send_notification_email`, `get_notification_email_enabled`, plus 23 `notify_*` triggers (e.g. `notify_round_published`, `notify_competition_vote`, `notify_post_comment`, `notify_friend_request_*`)     |
| **Audit / drift RPCs**         | `get_progression_drift_admin`, `get_placement_drift_admin`, `get_certificate_drift_admin`, `get_certificate_readiness_drift_admin`, `get_gift_drift_admin`, `get_referral_drift_admin`, `get_judge_collusion_admin`, `get_unjudged_parity_admin`, `get_judging_drift_admin`, `get_status_stage_key_drift_admin`, `get_judging_live_tag_progression_invariant_admin`, `get_result_visibility_invariant_admin`, `get_round_judging_gate_admin`, `list_tag_decision_drift_admin`, `get_derived_status_drift_admin`, `get_entry_status_drift_admin`, `get_entry_status_drift_summary_admin`, `get_test_agent_health_admin`, `get_system_tag_catalog_drift`, `get_notification_drift_admin`, `get_notification_health_stats_admin`, `get_gated_status_runtime_drift_admin` |
| **Reconciliation fixers**      | `fix_certificate_readiness_admin`, `fix_gift_drift_admin`, `fix_referral_drift_admin`, `backfill_judging_notifications`, `backfill_tag_decision_drift_admin`                                                                                                                       |
| **Rate limiting**              | `rate_limit_comments`, `rate_limit_competition_entry`, `rate_limit_competition_votes`, `rate_limit_feed_events`, `rate_limit_image_comments`, `rate_limit_judge_scores`, `rate_limit_newsletter_subscribe`, `rate_limit_post_comments`, `rate_limit_post_reactions`, `rate_limit_posts`, `throttle_competition_entry_inserts` |
| **Validation triggers**        | `validate_competition_entry_ai_advisory`, `validate_competition_entry_status_transition`, `validate_feed_event_author`, `validate_judge_criteria_scores`, `validate_judge_score_range`, `validate_post_tag_insert`, `validate_post_tag_update`                                     |
| **Custom URL & identity**      | `change_custom_url`, `clear_custom_url`, `prevent_direct_custom_url_update`, `protect_admin_full_name`, `enforce_admin_brand_name`                                                                                                                                                 |
| **Content moderation**         | `moderate_post_content`, `enforce_ai_image_policy`, `detect_duplicate_post`, `auto_promote_chat_to_faq`                                                                                                                                                                            |
| **Certificate generation**     | `auto_certificate_on_r4_award`, `generate_certificate_identifiers`, `verify_certificate`, `verify_certificate_by_token`, `search_certificates`                                                                                                                                     |
| **Cache / recompute fanout**   | `recompute_entry_public_status`, `_tg_entry_public_status_recompute`, `_tg_round_publish_recompute`, `_tg_v3_catalog_recompute`, `refresh_score_cache`, `seed_round_publish_rows`, `sync_competition_result_state_from_round_publish`, `sync_profiles_public_data`, `sync_system_tag_decision_map_from_catalog`, `sync_oauth_on_login` |

---

## 6. Triggers (175 total across 44 tables)

Top 10 tables by trigger density:

| Table                         | Triggers | Notable behaviors                                                                                                  |
| ----------------------------- | -------: | ------------------------------------------------------------------------------------------------------------------ |
| `competition_entries`         |       18 | Status-transition validation, entry-fee enforcement, round consistency, lifecycle email emit, public-status fanout |
| `judge_scores`                |        6 | Range / criteria validation, NR-drift audit, rate limit, recompute                                                 |
| `profiles`                    |        6 | Admin brand-name enforce, full-name protect, OAuth sync, `profiles_public_data` sync                               |
| `competition_round_publish`   |        5 | Recompute fanout, result-state sync, round-published notification (×2), participant fan-out                        |
| `post_tags`                   |        4 | Insert/update validation, post tag notify                                                                          |
| `posts`                       |        4 | Soft-delete fanout, AI-image policy, duplicate detection, comment/like/share counters                              |
| `judge_decisions`             |        4 | Atomic decision write, mirror to system tags, recompute entry, NR drift                                            |
| `competition_votes`           |        4 | Self-vote prevention, rate limit, vote rewards (via wallet_transaction), recompute                                 |
| `competitions`                |        4 | Slug generation, round seeding (`auto_create_judging_rounds`, `seed_round_publish_rows`), new-competition notify   |
| `judging_tags`                |        3 | System-tag protection, tag→decision mirror, recompute fanout                                                       |

---

## 7. Verified Security Invariants

1. **Roles never live on `profiles`.** `user_roles` is the sole source; `has_role(uuid, app_role)` is the only RLS predicate (recursion-safe).
2. **All sec-definer functions pin `search_path`.** 0 findings.
3. **All public tables have RLS enabled.** 0 findings.
4. **All public tables have ≥1 policy.** 0 orphan tables.
5. **Sensitive PII isolation.** `profiles_public_data` base table denies direct SELECT; consumers read `profiles_public` view (`security_invoker=on`).
6. **Money path is single-entry.** `wallet_transaction` is the only write path to `wallet_transactions`; phase 2.2 reconciliation log (`wallet_reconciliation_log`) traces all anomalies.
7. **Vote totals are view-derived.** `entry_final_votes` (photo-grain) replaces direct `competition_votes` aggregation; `|adjustment| ≤ 1000` is enforced.
8. **Judging emails go through DB triggers only.** UI cannot call `send-transactional-email` for judging templates (CI-locked via `audit-forbidden.yml`); `emit_notification` + `notification_emit_log` is the sanctioned path.
9. **Judge identity is masked in admin audit views.** Phase 2 anonymization; super_admin reveal toggles audited via `db_audit_logs`.
10. **Round closure requires 100% judge coverage.** `get_round_judging_gate_admin` mirrors `complete-round`/`publish-round` predicates; UI vs DB drift surfaced at `/admin/health`.

---

## 8. Public-Read Surfaces (intentional, no PII)

These tables expose `USING (true)` reads — verified safe by column projection:

- `competitions` (active only, soft-delete aware)
- `competition_entries` (gated by `entry_public_status` view + `indexing_disabled`)
- `hero_banners`, `featured_photos`, `featured_artists`, `photo_of_the_day`
- `journal_articles` (published), `faq_entries` (published)
- `badge_definitions`, `role_display_config`, `site_settings` (non-secret keys only)
- `feed_events` (broadcast channel; no DM payloads)
- `competition_round_publish` (publish flags only; no judge identities)

---

## 9. Realtime-Replicated Tables (verified via `supabase_realtime` publication)

Replicated for live UI updates:

- `posts`, `post_comments`, `post_reactions`, `post_comment_reactions`
- `image_comments`, `image_reactions`
- `comments`, `comment_reactions`
- `competition_entries`, `competition_round_publish`, `competition_votes`
- `judge_decisions`, `judge_tag_assignments`, `judge_scores`, `judge_entry_locks`
- `user_notifications`, `notification_emit_log`, `admin_notifications`
- `feed_events`, `stories`, `friendships`, `follows`
- `support_tickets`, `ticket_replies`

---

## 10. Quarantine / Preflight Tables (post-V3 migration residue)

These exist as snapshots of the pre-V3 judging schema and are read-only references for drift audits. They retain RLS but are never written to by application code:

- `_v3_preflight_snapshot_competition_entries`
- `_v3_preflight_snapshot_judge_decisions`
- `_v3_preflight_snapshot_judge_tag_assignments`
- `_v3_preflight_snapshot_judging_tags`
- `_v3_quarantine_decisions`
- `_v3_quarantine_tag_assignments`

---

## 11. Soft-Delete Convention (memory-locked)

Per project memory: **never hard-delete**.
- `posts.status` ∈ {`active`, `deleted`, `hidden`, `archived`}
- `comments.is_active`, `image_comments.is_active`, `post_comments.is_active`
- `competition_entries.status` (lifecycle states drive `entry_public_status`)
- `users` not deleted; banned via `is_banned()` predicate

---

## 12. Audit / Logging Tables

| Table                            | Writer                                            | Purpose                                              |
| -------------------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| `db_audit_logs`                  | `audit_sensitive_table`, `audit_site_settings_table`, NR drift trigger, judge reveal toggle | Append-only DB trail |
| `activity_logs`                  | App-side hooks                                    | User action timeline                                 |
| `judge_activity_logs`            | Judge UI mutations                                | Per-judge action history                             |
| `judging_preflight_log`          | `judging_invariants_check`                         | V3 migration / invariant snapshots                   |
| `judging_progression_audit`      | View + drift RPC                                   | Per-entry stage progression diffs                    |
| `notification_emit_log`          | `emit_notification`                                | Idempotency anchor for transactional emails          |
| `email_send_log`                 | `process-email-queue` edge fn                      | Per-attempt send result                              |
| `email_send_state`               | `enqueue_email` / `process-email-queue`            | Pgmq state mirror                                    |
| `wallet_reconciliation_log`      | Reconciliation RPCs                                | Orphan / legacy / unvote-penalty traceability        |
| `vote_adjustment_cleanup_log`    | Admin vote adjustment fixers                      | Trace of `|adj|>1000` cleanups                       |
| `v3_mirror_log`                  | `mirror_system_tag_to_decision`                    | Tag→decision mirror history                          |
| `judging_preflight_log`          | Preflight checks                                   | Migration safety net                                 |

---

## 13. What Is **Not** Audited Here

- Auth-schema tables (`auth.users`, `auth.identities`, etc.) are Supabase-managed; not in scope.
- Storage buckets / `storage.objects` policies are covered in Step 2E.
- Edge function code paths are covered in Steps 2C / 2F / 2G.
- This document records **structure and policy presence**, not behavioral correctness of every predicate.

---

**End of Step 2H.**
