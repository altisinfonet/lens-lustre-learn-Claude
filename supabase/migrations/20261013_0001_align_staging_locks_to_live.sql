-- ═══════════════════════════════════════════════════════════════════════════
-- 20261013_0001 — align staging privileges and three functions with production
-- Lane: STAGING ONLY (fpszggreishhuvdpkmdr). Refuses any other lane.
-- Owner-approved for staging, 2026-10-13. D1 (Database & Runtime).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY. A green test on staging should prove the same thing on production.
-- It cannot while staging grants more than production on the same objects:
-- a check can pass on staging only because staging is wider. Production is the
-- reference. This file only ever REMOVES privileges staging holds and
-- production does not; it adds none. Objects that exist only on staging
-- (video_*, videos, ad_videos, post_videos, music_library_*, feature_access*,
-- and the staging-only functions) are not touched.
--
-- EVIDENCE. Production catalog read 2026-10-13 06:51Z by the read-only
-- collector (_control/forensic/supabase-20261013-121953, not in this repo).
-- Staging re-read 2026-10-13 with read-only SELECTs; its state for every object
-- below matched that dump exactly and is pinned by PRE-001's fingerprint
-- (4752 grant/option/body lines, md5 2cb0116d0ea8909342522333d9868924).
-- Every touched object is owned by postgres and every ACL entry on them was
-- granted by postgres, so each REVOKE here acts as the owner (F-62).
--
-- WHAT THIS FILE DOES (objects present on both lanes, schema public):
--   1. Table privileges — 138 tables, 276 (table, role) revokes:
--     127 table(s)  anon + authenticated  lose TRUNCATE, REFERENCES, TRIGGER
--       6 table(s)  anon + authenticated  lose SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--       2 table(s)  anon + authenticated  lose INSERT, UPDATE, DELETE
--       2 table(s)  anon                  lose SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--       1 table(s)  anon + authenticated  lose INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--       1 table(s)  authenticated         lose TRUNCATE, REFERENCES, TRIGGER
--       1 table(s)  authenticated         lose INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
--   2. Function EXECUTE — 68 functions; 111 revokes
--      (PUBLIC 61, anon 25, authenticated 25):
--      36 function(s)  EXECUTE revoked from PUBLIC
--      18 function(s)  EXECUTE revoked from PUBLIC, anon, authenticated
--       7 function(s)  EXECUTE revoked from authenticated
--       7 function(s)  EXECUTE revoked from PUBLIC, anon
--      Where production grants anon/authenticated explicitly, only the extra
--      PUBLIC entry goes; the API roles keep exactly what production gives them.
--   3. Views — security_invoker set exactly as production stores it:
--     public.entry_final_votes                security_invoker=true
--     public.entry_final_votes_legacy         security_invoker=true
--     public.entry_public_status              security_invoker=false
--     public.judge_tag_assignments_public_r4  security_invoker=on
--     public.judging_progression_audit        security_invoker=true
--     public.profiles_public                  security_invoker=true
--     public.v_judging_drift                  security_invoker=on
--   4. public.custom_url_transliterate(text), public.custom_url_slug(text),
--      public.generate_custom_url(text, uuid) are replaced by production's
--      definitions (= 20260910_0021_f93_signup_handle_closure.sql). The only
--      difference was comment text inside the bodies; behaviour, attributes and
--      ACL were already identical and stay so (CREATE OR REPLACE keeps the ACL).
--
-- DELIBERATELY LEFT OUT — staging stays wider than production here, because
-- removing the privilege would break a real caller (caller evidence below):
--     competition_entries    anon           SELECT
--     competition_entries    authenticated  SELECT
--     profiles_public_data   anon           SELECT
--     lessons                anon           SELECT
--     lessons                authenticated  SELECT
--     post_media             authenticated  SELECT
--   * competition_entries / profiles_public_data: production gives these
--     roles COLUMN-level SELECT instead of table SELECT (20260605072243,
--     20260703104256, 20260728210000). Staging has no column grants on them, so
--     revoking table SELECT would remove every read (src/** reads both tables
--     ~45 times; RLS policies on competition_votes, judge_* subquery
--     competition_entries as authenticated). Recreating the column grants is
--     an ADD and is out of scope; production's exact column list was not
--     readable by the collector.
--   * lessons: src/hooks/content/useCourses.ts:67,141 select lessons directly
--     and the lesson_progress INSERT/UPDATE policies subquery it as the caller.
--     No migration in this repo removes table SELECT on lessons, so how
--     production serves those reads is unverified here.
--   * post_media (authenticated SELECT): video_publish_post() — staging-only,
--     SECURITY INVOKER, executable by authenticated, called from
--     src/lib/video/uploadJobs.ts:313 — reads public.post_media as the caller
--     in its replay (same idempotency key) check. Its other privileges on
--     post_media are removed. ⚠ On production that read has no table privilege
--     and will fail when VID-1 is promoted. Follow-up (VID-1 unit): route the
--     check through a SECURITY DEFINER helper / post_media_for(), then drop
--     this keep.
-- Also untouched: objects where staging is already TIGHTER than production
-- (forbid_custom_url_change(), prevent_direct_custom_url_update(),
-- verify_certificate_by_token(text); supabase_auth_admin on
-- auth_login_attempts; service_role on categories_migration_dropped); the
-- schema-level grants on public; default privileges; platform schemas.
--
-- CALLERS CHECKED before every revoke (origin/staging 5942dca2, staging DB):
--   src/** and functions/** (.rpc/.from incl. writes) · supabase/functions/**
--   (every call to a revoked function or closed table uses the service-role
--   client) · RLS policy quals/with_check · view definitions · SECURITY
--   INVOKER functions and trigger functions · column defaults, CHECKs,
--   generated columns, index expressions · cron jobs (all run as postgres) ·
--   realtime publication (no public table on staging) · auth hooks (SECURITY
--   DEFINER, call none of these). get_photo_r4_awards: its only client hook
--   (src/hooks/judging/usePhotoR4Award.ts) is imported nowhere.
--   Views: every function reading the seven views is SECURITY DEFINER. Three
--   direct client readers are affected by security_invoker, which makes them
--   run with the caller's own privileges and RLS on the base tables:
--     src/pages/PublicProfile.tsx:392        judge_tag_assignments_public_r4
--     src/hooks/judging/usePhotoVoteCount.ts:54  entry_final_votes
--       (used by src/components/judge/CinemaFullView.tsx:274)
--     src/pages/Referrals.tsx:88             profiles_public
--   EXPECTED BEHAVIOUR CHANGE ON STAGING, kept on purpose so staging shows
--   production's behaviour: award stamps on public profiles are no longer
--   shown to visitors and ordinary members; a non-admin judge's vote badge
--   counts without admin adjustments / locked votes. This is how production
--   behaves today and is tracked as a separate production defect unit; it is
--   not fixed here.
--
-- REMAINING DIFFERENCES after this file (staging vs production): the six keeps
-- above; production's column-level grants are unknown (not readable by the
-- collector); staging's default privileges re-grant on new tables/functions in
-- public, so every new object must revoke explicitly (F-66); schema public is
-- owned by pg_database_owner on staging and grants USAGE to PUBLIC.
--
-- RE-RUN: refused by PRE-001 (the fingerprint changes once applied). After the
-- rollback the fingerprint is the pre-state again, so this file can be re-applied.
-- ROLLBACK: supabase/rollback/20261013_0001_align_staging_locks_to_live_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261013_0001_align_staging_locks_to_live.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION
      'APPLY REFUSED — this file is for STAGING only and p32.lane reads %. '
      'Dispatch apply-migration.yml with target=staging (it sets p32.lane = ''staging'').',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  _n  int;
  _fp text;
BEGIN
  -- PRE-001 · staging holds exactly the grants, view options and bodies this file was written against.
  WITH _tabs(n) AS (SELECT unnest(ARRAY[
        '_v3_quarantine_decisions',
        '_v3_quarantine_tag_assignments',
        'activity_logs',
        'ad_conversions',
        'ad_creative_comments',
        'ad_creative_reactions',
        'ad_creative_shares',
        'ad_creatives',
        'ad_impressions',
        'admin_notifications',
        'admin_vote_adjustments',
        'ai_chat_usage',
        'album_photos',
        'auth_login_attempts',
        'badge_definitions',
        'bank_details',
        'blocked_keywords',
        'categories',
        'certificate_testimonials',
        'certificates',
        'chat_questions',
        'client_errors',
        'comment_reactions',
        'comment_reports',
        'comments',
        'competition_entries',
        'competition_entry_counts',
        'competition_judges',
        'competition_judging_tags',
        'competition_orders',
        'competition_payment_details',
        'competition_round_publish',
        'competition_votes',
        'competitions',
        'contributor_engagement_daily',
        'course_enrollments',
        'course_modules',
        'courses',
        'custom_url_history',
        'db_audit_logs',
        'email_send_log',
        'email_send_state',
        'email_templates',
        'email_unsubscribe_tokens',
        'entry_score_cache',
        'faq_entries',
        'featured_artists',
        'featured_photos',
        'feed_events',
        'follows',
        'friendships',
        'gift_announcements',
        'gift_credits',
        'hashtags',
        'held_result_notifications',
        'hero_banners',
        'highlight_items',
        'highlights',
        'image_comments',
        'image_reactions',
        'journal_articles',
        'judge_activity_logs',
        'judge_award_tags',
        'judge_comments',
        'judge_decisions',
        'judge_entry_assignments',
        'judge_entry_locks',
        'judge_scores',
        'judge_sessions',
        'judge_tag_assignments',
        'judging_config',
        'judging_preflight_log',
        'judging_rounds',
        'judging_tags',
        'lesson_progress',
        'lessons',
        'media_objects',
        'media_repair_audit',
        'member_activity_minutes',
        'newsletter_subscribers',
        'notification_emit_log',
        'notification_preferences',
        'office_staff',
        'photo_albums',
        'photo_of_the_day',
        'portfolio_images',
        'post_comment_reactions',
        'post_drafts',
        'post_hashtags',
        'post_media',
        'post_reactions',
        'post_reports',
        'post_shares',
        'post_tags',
        'posts',
        'profile_stats',
        'profile_views',
        'profiles',
        'profiles_public_data',
        'push_config',
        'push_delivery_log',
        'push_tokens',
        'raw_commitments',
        'referral_codes',
        'referrals',
        'role_applications',
        'role_display_config',
        'round_snapshots',
        'scheduled_boosts',
        'scheduled_posts',
        'search_recents',
        'site_settings',
        'stories',
        'story_views',
        'support_tickets',
        'suppressed_emails',
        'system_flags',
        'system_tag_decision_map',
        'test_agent_config',
        'test_agent_runs',
        'ticket_replies',
        'user_badges',
        'user_devices',
        'user_notifications',
        'user_roles',
        'v3_mirror_log',
        'v3_stage_catalog',
        'v3_tag_label_alias',
        'vote_adjustment_cleanup_log',
        'wallet_ledger_audit_log',
        'wallet_ledger_idempotency',
        'wallet_ledger_shadow_log',
        'wallet_ledger_v2_diff_log',
        'wallet_ledger_v2_rows',
        'wallet_reconciliation_log',
        'wallet_transactions',
        'wallets',
        'withdrawal_requests'
      ]::text[])),
    _vws(n) AS (SELECT unnest(ARRAY[
        'entry_final_votes',
        'entry_final_votes_legacy',
        'entry_public_status',
        'judge_tag_assignments_public_r4',
        'judging_progression_audit',
        'profiles_public',
        'v_judging_drift'
      ]::text[])),
    _fns(s) AS (SELECT unnest(ARRAY[
        'admin_delete_auth_user(_uid uuid)',
        'admin_emails_for_user_ids(_ids uuid[])',
        'admin_lookup_user_id_by_email(_email text)',
        'admin_purge_orphan_user_data(_uid uuid)',
        'app_has_role(_user_id uuid, _role text)',
        'cleanup_certificate_references()',
        'contributor_points_since(_since date)',
        'create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text)',
        'derive_status_from_stage_key(_stage_key text)',
        'engagement_collector_health()',
        'engagement_probe_report(_days integer)',
        'expire_gift_credit(_gift_id uuid)',
        'feed_candidates(_seed text, _categories text[], _recent integer, _sample integer, _own integer, _friends integer)',
        'feed_rank_score(_id uuid, _bucket integer, _seed text)',
        'filter_moderated_user_ids(_ids uuid[])',
        'get_ad_engagement(_creative_ids uuid[])',
        'get_app_event_counts_admin(_hours integer)',
        'get_app_events_admin(_hours integer, _code text, _severity text, _limit integer)',
        'get_client_error_stats_admin(_hours integer)',
        'get_course_lessons_for_editor(_course_id uuid)',
        'get_entries_private_meta(_entry_ids uuid[])',
        'get_entry_status_drift_admin()',
        'get_entry_status_drift_summary_admin()',
        'get_gated_status_runtime_drift_admin(p_entry_ids uuid[])',
        'get_judge_entries_page_filtered(_competition_id uuid, _round_number integer, _bucket text, _cursor_created_at timestamp with time zone, _cursor_id uuid, _limit integer)',
        'get_judging_drift_admin()',
        'get_judging_live_tag_progression_invariant_admin()',
        'get_lesson_content(_lesson_id uuid)',
        'get_my_certificate_entries()',
        'get_per_photo_placement(p_entry_ids uuid[])',
        'get_photo_r4_awards(p_entry_ids uuid[])',
        'get_profile_admin(_id uuid)',
        'get_profile_visible_fields(_target uuid)',
        'get_progression_drift_admin()',
        'get_public_final_votes(_entry_ids uuid[])',
        'get_public_role_user_ids(_role text)',
        'get_public_roles_for_users(_user_ids uuid[])',
        'get_result_visibility_invariant_admin()',
        'get_round_judging_gate_admin(_competition_id uuid, _round_number integer)',
        'get_round_judging_gate_self(_competition_id uuid, _round_number integer)',
        'get_round_pending_entries(p_competition_id uuid, p_round integer)',
        'get_round_summary(p_competition_id uuid, p_round_number integer)',
        'get_status_stage_key_drift_admin()',
        'get_system_tag_catalog_drift()',
        'get_test_agent_health_admin()',
        'get_top_contributors_v3()',
        'get_unjudged_parity_admin(p_judge_id uuid, p_competition_id uuid, p_round_number integer)',
        'global_search(term text, section text, username_only boolean)',
        'global_search_hashtags(term text)',
        'increment_managed_page_view(_page_id text)',
        'mark_expiring_post_drafts(_days integer)',
        'media_migration_fence_digest(_fence timestamp with time zone)',
        'media_migration_fence_digest_wide(_fence timestamp with time zone)',
        'media_migration_reconcile()',
        'media_write_path_delta(_since timestamp with time zone)',
        'mirror_system_tag_to_decision()',
        'post_media_for(_post_ids uuid[])',
        'record_test_agent_run(p_token text, p_run_id text, p_trigger text, p_commit_sha text, p_branch text, p_status text, p_rpc_parity_pass boolean, p_nr_drift_5min integer, p_dual_emit_status text, p_tsc_pass boolean, p_vitest_pass boolean, p_eslint_pass boolean, p_failures jsonb, p_duration_ms integer, p_github_run_url text)',
        'search_profiles_admin(q text)',
        'send_notification_email()',
        'soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid)',
        'suggest_hashtags(prefix text, max_results integer)',
        'tg_media_state_transition()',
        'tg_post_media_requires_ready()',
        'verify_staff_id(_id_number text)',
        'wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean)',
        'wallet_ledger_v2_diff_report(p_window interval)',
        'wallet_ledger_v2_drift_report(p_window interval)'
      ]::text[])),
    _defs(s) AS (SELECT unnest(ARRAY[
        'custom_url_transliterate(_s text)',
        'custom_url_slug(_full_name text)',
        'generate_custom_url(_full_name text, _user_id uuid)'
      ]::text[])),
  _lines AS (
      SELECT concat_ws('|', 'T', c.relname::text,
                       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                       a.privilege_type, pg_get_userbyid(a.grantor)::text, a.is_grantable::text) AS x
        FROM pg_class c JOIN _tabs ON _tabs.n = c.relname::text, LATERAL aclexplode(c.relacl) a
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
      UNION ALL
      SELECT concat_ws('|', 'F', p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')',
                       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                       a.privilege_type, pg_get_userbyid(a.grantor)::text, a.is_grantable::text)
        FROM pg_proc p JOIN _fns ON _fns.s = p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')',
             LATERAL aclexplode(p.proacl) a
       WHERE p.pronamespace = 'public'::regnamespace
      UNION ALL
      SELECT concat_ws('|', 'V', c.relname::text, coalesce(c.reloptions::text, ''))
        FROM pg_class c JOIN _vws ON _vws.n = c.relname::text
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
      UNION ALL
      SELECT concat_ws('|', 'S', p.proname::text, md5(p.prosrc))
        FROM pg_proc p JOIN _defs ON _defs.s = p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')'
       WHERE p.pronamespace = 'public'::regnamespace
    )
  SELECT count(*)::int, md5(string_agg(x, E'\n' ORDER BY x COLLATE "C")) FROM _lines INTO _n, _fp;
  IF _n <> 4752 OR _fp IS DISTINCT FROM '2cb0116d0ea8909342522333d9868924' THEN
    RAISE EXCEPTION 'ALIGN-0001-PRE-001: the touched objects no longer match the state this file was generated from — re-read staging and regenerate; refusing (read % lines, md5 %; expected 4752, 2cb0116d0ea8909342522333d9868924)', _n, _fp
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Every touched object is owned by the role running this file, so each
  -- REVOKE / GRANT acts as the owner and is recorded with grantor = owner.
  WITH _tabs(n) AS (SELECT unnest(ARRAY[
        '_v3_quarantine_decisions',
        '_v3_quarantine_tag_assignments',
        'activity_logs',
        'ad_conversions',
        'ad_creative_comments',
        'ad_creative_reactions',
        'ad_creative_shares',
        'ad_creatives',
        'ad_impressions',
        'admin_notifications',
        'admin_vote_adjustments',
        'ai_chat_usage',
        'album_photos',
        'auth_login_attempts',
        'badge_definitions',
        'bank_details',
        'blocked_keywords',
        'categories',
        'certificate_testimonials',
        'certificates',
        'chat_questions',
        'client_errors',
        'comment_reactions',
        'comment_reports',
        'comments',
        'competition_entries',
        'competition_entry_counts',
        'competition_judges',
        'competition_judging_tags',
        'competition_orders',
        'competition_payment_details',
        'competition_round_publish',
        'competition_votes',
        'competitions',
        'contributor_engagement_daily',
        'course_enrollments',
        'course_modules',
        'courses',
        'custom_url_history',
        'db_audit_logs',
        'email_send_log',
        'email_send_state',
        'email_templates',
        'email_unsubscribe_tokens',
        'entry_score_cache',
        'faq_entries',
        'featured_artists',
        'featured_photos',
        'feed_events',
        'follows',
        'friendships',
        'gift_announcements',
        'gift_credits',
        'hashtags',
        'held_result_notifications',
        'hero_banners',
        'highlight_items',
        'highlights',
        'image_comments',
        'image_reactions',
        'journal_articles',
        'judge_activity_logs',
        'judge_award_tags',
        'judge_comments',
        'judge_decisions',
        'judge_entry_assignments',
        'judge_entry_locks',
        'judge_scores',
        'judge_sessions',
        'judge_tag_assignments',
        'judging_config',
        'judging_preflight_log',
        'judging_rounds',
        'judging_tags',
        'lesson_progress',
        'lessons',
        'media_objects',
        'media_repair_audit',
        'member_activity_minutes',
        'newsletter_subscribers',
        'notification_emit_log',
        'notification_preferences',
        'office_staff',
        'photo_albums',
        'photo_of_the_day',
        'portfolio_images',
        'post_comment_reactions',
        'post_drafts',
        'post_hashtags',
        'post_media',
        'post_reactions',
        'post_reports',
        'post_shares',
        'post_tags',
        'posts',
        'profile_stats',
        'profile_views',
        'profiles',
        'profiles_public_data',
        'push_config',
        'push_delivery_log',
        'push_tokens',
        'raw_commitments',
        'referral_codes',
        'referrals',
        'role_applications',
        'role_display_config',
        'round_snapshots',
        'scheduled_boosts',
        'scheduled_posts',
        'search_recents',
        'site_settings',
        'stories',
        'story_views',
        'support_tickets',
        'suppressed_emails',
        'system_flags',
        'system_tag_decision_map',
        'test_agent_config',
        'test_agent_runs',
        'ticket_replies',
        'user_badges',
        'user_devices',
        'user_notifications',
        'user_roles',
        'v3_mirror_log',
        'v3_stage_catalog',
        'v3_tag_label_alias',
        'vote_adjustment_cleanup_log',
        'wallet_ledger_audit_log',
        'wallet_ledger_idempotency',
        'wallet_ledger_shadow_log',
        'wallet_ledger_v2_diff_log',
        'wallet_ledger_v2_rows',
        'wallet_reconciliation_log',
        'wallet_transactions',
        'wallets',
        'withdrawal_requests'
      ]::text[])),
    _vws(n) AS (SELECT unnest(ARRAY[
        'entry_final_votes',
        'entry_final_votes_legacy',
        'entry_public_status',
        'judge_tag_assignments_public_r4',
        'judging_progression_audit',
        'profiles_public',
        'v_judging_drift'
      ]::text[])),
    _fns(s) AS (SELECT unnest(ARRAY[
        'admin_delete_auth_user(_uid uuid)',
        'admin_emails_for_user_ids(_ids uuid[])',
        'admin_lookup_user_id_by_email(_email text)',
        'admin_purge_orphan_user_data(_uid uuid)',
        'app_has_role(_user_id uuid, _role text)',
        'cleanup_certificate_references()',
        'contributor_points_since(_since date)',
        'create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text)',
        'derive_status_from_stage_key(_stage_key text)',
        'engagement_collector_health()',
        'engagement_probe_report(_days integer)',
        'expire_gift_credit(_gift_id uuid)',
        'feed_candidates(_seed text, _categories text[], _recent integer, _sample integer, _own integer, _friends integer)',
        'feed_rank_score(_id uuid, _bucket integer, _seed text)',
        'filter_moderated_user_ids(_ids uuid[])',
        'get_ad_engagement(_creative_ids uuid[])',
        'get_app_event_counts_admin(_hours integer)',
        'get_app_events_admin(_hours integer, _code text, _severity text, _limit integer)',
        'get_client_error_stats_admin(_hours integer)',
        'get_course_lessons_for_editor(_course_id uuid)',
        'get_entries_private_meta(_entry_ids uuid[])',
        'get_entry_status_drift_admin()',
        'get_entry_status_drift_summary_admin()',
        'get_gated_status_runtime_drift_admin(p_entry_ids uuid[])',
        'get_judge_entries_page_filtered(_competition_id uuid, _round_number integer, _bucket text, _cursor_created_at timestamp with time zone, _cursor_id uuid, _limit integer)',
        'get_judging_drift_admin()',
        'get_judging_live_tag_progression_invariant_admin()',
        'get_lesson_content(_lesson_id uuid)',
        'get_my_certificate_entries()',
        'get_per_photo_placement(p_entry_ids uuid[])',
        'get_photo_r4_awards(p_entry_ids uuid[])',
        'get_profile_admin(_id uuid)',
        'get_profile_visible_fields(_target uuid)',
        'get_progression_drift_admin()',
        'get_public_final_votes(_entry_ids uuid[])',
        'get_public_role_user_ids(_role text)',
        'get_public_roles_for_users(_user_ids uuid[])',
        'get_result_visibility_invariant_admin()',
        'get_round_judging_gate_admin(_competition_id uuid, _round_number integer)',
        'get_round_judging_gate_self(_competition_id uuid, _round_number integer)',
        'get_round_pending_entries(p_competition_id uuid, p_round integer)',
        'get_round_summary(p_competition_id uuid, p_round_number integer)',
        'get_status_stage_key_drift_admin()',
        'get_system_tag_catalog_drift()',
        'get_test_agent_health_admin()',
        'get_top_contributors_v3()',
        'get_unjudged_parity_admin(p_judge_id uuid, p_competition_id uuid, p_round_number integer)',
        'global_search(term text, section text, username_only boolean)',
        'global_search_hashtags(term text)',
        'increment_managed_page_view(_page_id text)',
        'mark_expiring_post_drafts(_days integer)',
        'media_migration_fence_digest(_fence timestamp with time zone)',
        'media_migration_fence_digest_wide(_fence timestamp with time zone)',
        'media_migration_reconcile()',
        'media_write_path_delta(_since timestamp with time zone)',
        'mirror_system_tag_to_decision()',
        'post_media_for(_post_ids uuid[])',
        'record_test_agent_run(p_token text, p_run_id text, p_trigger text, p_commit_sha text, p_branch text, p_status text, p_rpc_parity_pass boolean, p_nr_drift_5min integer, p_dual_emit_status text, p_tsc_pass boolean, p_vitest_pass boolean, p_eslint_pass boolean, p_failures jsonb, p_duration_ms integer, p_github_run_url text)',
        'search_profiles_admin(q text)',
        'send_notification_email()',
        'soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid)',
        'suggest_hashtags(prefix text, max_results integer)',
        'tg_media_state_transition()',
        'tg_post_media_requires_ready()',
        'verify_staff_id(_id_number text)',
        'wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean)',
        'wallet_ledger_v2_diff_report(p_window interval)',
        'wallet_ledger_v2_drift_report(p_window interval)'
      ]::text[])),
    _defs(s) AS (SELECT unnest(ARRAY[
        'custom_url_transliterate(_s text)',
        'custom_url_slug(_full_name text)',
        'generate_custom_url(_full_name text, _user_id uuid)'
      ]::text[]))
  SELECT count(*) INTO _n FROM (
    SELECT c.relowner AS o FROM pg_class c JOIN _tabs ON _tabs.n = c.relname::text WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
    UNION ALL SELECT c.relowner FROM pg_class c JOIN _vws ON _vws.n = c.relname::text WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
    UNION ALL SELECT p.proowner FROM pg_proc p JOIN _fns ON _fns.s = p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' WHERE p.pronamespace = 'public'::regnamespace
    UNION ALL SELECT p.proowner FROM pg_proc p JOIN _defs ON _defs.s = p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' WHERE p.pronamespace = 'public'::regnamespace
  ) o WHERE o.o <> current_user::regrole;
  IF _n <> 0 THEN
    RAISE EXCEPTION 'ALIGN-0001-PRE-002: % touched object(s) are not owned by % — a REVOKE would not act as the owner', _n, current_user
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. table privileges ────────────────────────────────────────────────────
-- 127 table(s)
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public._v3_quarantine_decisions,
  public._v3_quarantine_tag_assignments,
  public.activity_logs,
  public.ad_conversions,
  public.ad_creative_comments,
  public.ad_creative_reactions,
  public.ad_creative_shares,
  public.ad_creatives,
  public.ad_impressions,
  public.admin_notifications,
  public.admin_vote_adjustments,
  public.ai_chat_usage,
  public.album_photos,
  public.badge_definitions,
  public.bank_details,
  public.blocked_keywords,
  public.certificate_testimonials,
  public.certificates,
  public.chat_questions,
  public.comment_reactions,
  public.comment_reports,
  public.comments,
  public.competition_entries,
  public.competition_entry_counts,
  public.competition_judges,
  public.competition_judging_tags,
  public.competition_orders,
  public.competition_payment_details,
  public.competition_round_publish,
  public.competition_votes,
  public.competitions,
  public.course_enrollments,
  public.course_modules,
  public.courses,
  public.custom_url_history,
  public.db_audit_logs,
  public.email_send_log,
  public.email_send_state,
  public.email_templates,
  public.email_unsubscribe_tokens,
  public.entry_score_cache,
  public.faq_entries,
  public.featured_artists,
  public.featured_photos,
  public.feed_events,
  public.follows,
  public.friendships,
  public.gift_announcements,
  public.gift_credits,
  public.held_result_notifications,
  public.hero_banners,
  public.highlight_items,
  public.highlights,
  public.image_comments,
  public.image_reactions,
  public.journal_articles,
  public.judge_activity_logs,
  public.judge_award_tags,
  public.judge_comments,
  public.judge_decisions,
  public.judge_entry_assignments,
  public.judge_entry_locks,
  public.judge_scores,
  public.judge_sessions,
  public.judge_tag_assignments,
  public.judging_config,
  public.judging_preflight_log,
  public.judging_rounds,
  public.judging_tags,
  public.lesson_progress,
  public.lessons,
  public.newsletter_subscribers,
  public.notification_emit_log,
  public.notification_preferences,
  public.office_staff,
  public.photo_albums,
  public.photo_of_the_day,
  public.portfolio_images,
  public.post_comment_reactions,
  public.post_reactions,
  public.post_reports,
  public.post_shares,
  public.post_tags,
  public.posts,
  public.profile_stats,
  public.profile_views,
  public.profiles,
  public.profiles_public_data,
  public.push_config,
  public.push_delivery_log,
  public.push_tokens,
  public.raw_commitments,
  public.referral_codes,
  public.referrals,
  public.role_applications,
  public.role_display_config,
  public.round_snapshots,
  public.scheduled_boosts,
  public.scheduled_posts,
  public.search_recents,
  public.site_settings,
  public.stories,
  public.story_views,
  public.support_tickets,
  public.suppressed_emails,
  public.system_flags,
  public.system_tag_decision_map,
  public.test_agent_config,
  public.test_agent_runs,
  public.ticket_replies,
  public.user_badges,
  public.user_devices,
  public.user_notifications,
  public.user_roles,
  public.v3_mirror_log,
  public.v3_stage_catalog,
  public.v3_tag_label_alias,
  public.vote_adjustment_cleanup_log,
  public.wallet_ledger_audit_log,
  public.wallet_ledger_idempotency,
  public.wallet_ledger_shadow_log,
  public.wallet_ledger_v2_diff_log,
  public.wallet_ledger_v2_rows,
  public.wallet_reconciliation_log,
  public.wallet_transactions,
  public.wallets,
  public.withdrawal_requests
FROM anon, authenticated;

-- 6 table(s)
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.auth_login_attempts,
  public.client_errors,
  public.contributor_engagement_daily,
  public.media_objects,
  public.media_repair_audit,
  public.member_activity_minutes
FROM anon, authenticated;

-- 2 table(s)
REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.hashtags,
  public.post_hashtags
FROM anon, authenticated;

-- 2 table(s)
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.post_drafts,
  public.post_media
FROM anon;

-- 1 table(s)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.categories
FROM anon, authenticated;

-- 1 table(s)
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.post_drafts
FROM authenticated;

-- 1 table(s)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.post_media
FROM authenticated;

-- ── 2. function EXECUTE ────────────────────────────────────────────────────
-- 36 function(s)
REVOKE EXECUTE ON FUNCTION
  public.app_has_role(_user_id uuid, _role text),
  public.derive_status_from_stage_key(_stage_key text),
  public.filter_moderated_user_ids(_ids uuid[]),
  public.get_entries_private_meta(_entry_ids uuid[]),
  public.get_entry_status_drift_admin(),
  public.get_entry_status_drift_summary_admin(),
  public.get_gated_status_runtime_drift_admin(p_entry_ids uuid[]),
  public.get_judge_entries_page_filtered(_competition_id uuid, _round_number integer, _bucket text, _cursor_created_at timestamp with time zone, _cursor_id uuid, _limit integer),
  public.get_judging_drift_admin(),
  public.get_lesson_content(_lesson_id uuid),
  public.get_per_photo_placement(p_entry_ids uuid[]),
  public.get_profile_admin(_id uuid),
  public.get_profile_visible_fields(_target uuid),
  public.get_progression_drift_admin(),
  public.get_public_final_votes(_entry_ids uuid[]),
  public.get_public_role_user_ids(_role text),
  public.get_public_roles_for_users(_user_ids uuid[]),
  public.get_round_judging_gate_admin(_competition_id uuid, _round_number integer),
  public.get_round_judging_gate_self(_competition_id uuid, _round_number integer),
  public.get_round_pending_entries(p_competition_id uuid, p_round integer),
  public.get_round_summary(p_competition_id uuid, p_round_number integer),
  public.get_system_tag_catalog_drift(),
  public.get_test_agent_health_admin(),
  public.get_top_contributors_v3(),
  public.get_unjudged_parity_admin(p_judge_id uuid, p_competition_id uuid, p_round_number integer),
  public.global_search(term text, section text, username_only boolean),
  public.global_search_hashtags(term text),
  public.increment_managed_page_view(_page_id text),
  public.mirror_system_tag_to_decision(),
  public.post_media_for(_post_ids uuid[]),
  public.record_test_agent_run(p_token text, p_run_id text, p_trigger text, p_commit_sha text, p_branch text, p_status text, p_rpc_parity_pass boolean, p_nr_drift_5min integer, p_dual_emit_status text, p_tsc_pass boolean, p_vitest_pass boolean, p_eslint_pass boolean, p_failures jsonb, p_duration_ms integer, p_github_run_url text),
  public.search_profiles_admin(q text),
  public.send_notification_email(),
  public.verify_staff_id(_id_number text),
  public.wallet_ledger_v2_diff_report(p_window interval),
  public.wallet_ledger_v2_drift_report(p_window interval)
FROM PUBLIC;

-- 18 function(s)
REVOKE EXECUTE ON FUNCTION
  public.admin_emails_for_user_ids(_ids uuid[]),
  public.admin_lookup_user_id_by_email(_email text),
  public.cleanup_certificate_references(),
  public.contributor_points_since(_since date),
  public.engagement_collector_health(),
  public.engagement_probe_report(_days integer),
  public.feed_candidates(_seed text, _categories text[], _recent integer, _sample integer, _own integer, _friends integer),
  public.feed_rank_score(_id uuid, _bucket integer, _seed text),
  public.get_judging_live_tag_progression_invariant_admin(),
  public.get_photo_r4_awards(p_entry_ids uuid[]),
  public.get_result_visibility_invariant_admin(),
  public.get_status_stage_key_drift_admin(),
  public.media_migration_fence_digest(_fence timestamp with time zone),
  public.media_migration_fence_digest_wide(_fence timestamp with time zone),
  public.media_migration_reconcile(),
  public.media_write_path_delta(_since timestamp with time zone),
  public.tg_media_state_transition(),
  public.tg_post_media_requires_ready()
FROM PUBLIC, anon, authenticated;

-- 7 function(s)
REVOKE EXECUTE ON FUNCTION
  public.admin_delete_auth_user(_uid uuid),
  public.admin_purge_orphan_user_data(_uid uuid),
  public.create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text),
  public.expire_gift_credit(_gift_id uuid),
  public.mark_expiring_post_drafts(_days integer),
  public.soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid),
  public.wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean)
FROM authenticated;

-- 7 function(s)
REVOKE EXECUTE ON FUNCTION
  public.get_ad_engagement(_creative_ids uuid[]),
  public.get_app_event_counts_admin(_hours integer),
  public.get_app_events_admin(_hours integer, _code text, _severity text, _limit integer),
  public.get_client_error_stats_admin(_hours integer),
  public.get_course_lessons_for_editor(_course_id uuid),
  public.get_my_certificate_entries(),
  public.suggest_hashtags(prefix text, max_results integer)
FROM PUBLIC, anon;

-- ── 3. views: security_invoker as production ───────────────────────────────
ALTER VIEW public.entry_final_votes SET (security_invoker = 'true');
ALTER VIEW public.entry_final_votes_legacy SET (security_invoker = 'true');
ALTER VIEW public.entry_public_status SET (security_invoker = 'false');
ALTER VIEW public.judge_tag_assignments_public_r4 SET (security_invoker = 'on');
ALTER VIEW public.judging_progression_audit SET (security_invoker = 'true');
ALTER VIEW public.profiles_public SET (security_invoker = 'true');
ALTER VIEW public.v_judging_drift SET (security_invoker = 'on');

-- ── 4. the three handle functions: production's definitions ────────────────
CREATE OR REPLACE FUNCTION public.custom_url_transliterate(_s text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _out     text := '';
  _i       int;
  _ch      text;
  _m       record;
  _pending boolean := false;   -- a consonant's inherent 'a' not yet emitted
  _schwa   boolean := false;   -- does this string use a schwa-deleting script?
  _prev_virama boolean := false;  -- the previous character was a virama
  _in_conjunct boolean := false;  -- the current consonant closes a conjunct cluster
BEGIN
  IF _s IS NULL OR _s = '' THEN RETURN ''; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.transliteration_map m
     WHERE m.script IN ('bengali','devanagari','gujarati')
       AND position(m.ch in _s) > 0
  ) INTO _schwa;

  FOR _i IN 1..length(_s) LOOP
    _ch := substr(_s, _i, 1);
    SELECT latin, kind INTO _m FROM public.transliteration_map WHERE ch = _ch;

    IF _m.kind IS NULL THEN
      -- Not a mapped character: ASCII, punctuation, or an unmapped script.
      --
      -- ⚠ SCHWA DELETION IS A WORD-BOUNDARY RULE, NOT AN END-OF-STRING RULE.
      -- Getting this wrong failed the Owner's own example: with the drop
      -- applied only after the loop, "নীল বসু" came out "nila basu" — the ল
      -- ending the first word flushed its inherent 'a' on reaching the space.
      -- A separator ends a word, so the pending vowel is DROPPED there for the
      -- schwa-deleting scripts. It is still flushed before an alphanumeric, so
      -- a mixed name like "নীলX" does not lose the vowel mid-word.
      -- ⚠ AND THE DELETION IS SUPPRESSED AFTER A CONJUNCT. Bengali drops the
      -- final inherent vowel after a simple coda (নীল -> nil) but KEEPS it
      -- after a consonant cluster (দত্ত -> datta, not "datt"). Without this the
      -- Owner's second example lost its final syllable entirely.
      IF _pending THEN
        IF _schwa AND _ch ~ '[^[:alnum:]]' AND NOT _in_conjunct THEN
          _pending := false;
        ELSE
          _out := _out || 'a'; _pending := false;
        END IF;
      END IF;
      _out := _out || _ch;
      _prev_virama := false; _in_conjunct := false;

    ELSIF _m.kind = 'consonant' THEN
      IF _pending THEN _out := _out || 'a'; END IF;
      _out := _out || _m.latin;
      _pending := true;
      _in_conjunct := _prev_virama;   -- a virama immediately before means this closes a cluster
      _prev_virama := false;

    ELSIF _m.kind = 'matra' THEN
      _pending := false;                      -- the sign REPLACES the inherent vowel
      _out := _out || _m.latin;
      _prev_virama := false; _in_conjunct := false;

    ELSIF _m.kind = 'virama' THEN
      _pending := false;                      -- the inherent vowel is cancelled outright
      _prev_virama := true;

    ELSE                                      -- 'letter' (Cyrillic), 'vowel', 'sign'
      IF _pending THEN _out := _out || 'a'; _pending := false; END IF;
      _out := _out || _m.latin;
      _prev_virama := false; _in_conjunct := false;
    END IF;
  END LOOP;

  -- Word-final inherent vowel. Kept for Tamil and Telugu, dropped for the
  -- schwa-deleting scripts — this is what makes নীল "nil" and not "nila".
  IF _pending AND (NOT _schwa OR _in_conjunct) THEN _out := _out || 'a'; END IF;

  RETURN _out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.custom_url_slug(_full_name text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _parts text[];
  _clean text[] := '{}';
  _p     text;
  _key   text;
  _conv  text;
  _stem  text;
BEGIN
  IF _full_name IS NULL OR btrim(_full_name) = '' THEN
    RETURN NULL;
  END IF;

  _parts := regexp_split_to_array(btrim(_full_name), '\s+');

  FOREACH _p IN ARRAY coalesce(_parts, '{}') LOOP
    -- Strip only SURROUNDING punctuation to form the lookup key. The part
    -- itself is not otherwise altered, so the match stays an exact whole-part
    -- comparison and can never fire on a substring.
    _key := btrim(lower(_p), ' .,;:!?"''()[]{}<>');

    SELECT latin INTO _conv FROM public.name_part_spellings WHERE part = _key;

    IF _conv IS NOT NULL THEN
      -- Convention beats phonetics. দত্ত is written "Dutta" by the people who
      -- carry it, though the walk below would correctly produce "datta".
      _p := _conv;
    ELSE
      -- Not a recorded spelling: sound it out.
      --   lower()        so uppercase Cyrillic matches the map
      --   transliterate  non-Latin script -> Latin letters
      --   fold accents   Latin diacritics -> plain ASCII
      -- Then strip whatever is left INSIDE the part — hyphens, apostrophes,
      -- and any unmapped script — so a compound surname stays one name and
      -- the value keeps its two-part first.last shape.
      _p := public.custom_url_fold_accents(
              public.custom_url_transliterate(lower(_p)));
      _p := regexp_replace(_p, '[^a-z0-9]', '', 'g');
    END IF;

    IF _p <> '' THEN _clean := _clean || _p; END IF;
  END LOOP;

  IF array_length(_clean, 1) IS NULL THEN
    -- Nothing survived: the name was only punctuation or emoji, or was written
    -- in a script deliberately not mapped (Han, Japanese, Korean — see
    -- 20260910_00065). NULL is the honest answer; generate_custom_url()
    -- supplies member.<8 hex of id>, which the member can change once a year
    -- and an admin can change immediately.
    RETURN NULL;
  ELSIF array_length(_clean, 1) = 1 THEN
    _stem := _clean[1];                             -- a single-word name: no dot to add
  ELSE
    -- First part and LAST part. Middle names are dropped rather than joined:
    -- first.middle.last is a three-part shape that exists nowhere on the site.
    _stem := _clean[1] || '.' || _clean[array_length(_clean, 1)];
  END IF;

  _stem := left(_stem, 30);
  _stem := regexp_replace(_stem, '[._]+$', '');
  _stem := regexp_replace(_stem, '^[.]+', '');

  IF length(_stem) < 3 THEN
    RETURN NULL;                                    -- "Li Wu" is fine at 5; "A" is not, and padding it would invent a name
  END IF;

  RETURN _stem;
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_custom_url(_full_name text, _user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _stem      text;
  _candidate text;
  _suffix    text;
  _n         int := 2;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'generate_custom_url requires a user id: it is needed both for the fallback value and to let a member keep a URL they already hold';
  END IF;

  _stem := public.custom_url_slug(_full_name);

  -- THE EMPTY CASE, answered explicitly. A name that is only punctuation, only
  -- emoji, or a script this folds away yields NULL above. '' must never become
  -- a URL, and neither must a bare '.' or '-'. Such a member gets an
  -- id-derived value instead: deterministic, stable across re-runs, legal under
  -- the column CHECK, and still subject to every check below.
  IF _stem IS NULL THEN
    _stem := 'member.' || substr(replace(_user_id::text, '-', ''), 1, 8);
  END IF;

  IF public.custom_url_available(_stem, _user_id) THEN
    RETURN _stem;
  END IF;

  -- Collision: append digits, per the Owner's instruction. The stem is trimmed
  -- so stem+digits still fits 30 characters, and any trailing dot exposed by
  -- that trim is removed — 'ana.b' truncated to 'ana.' + '2' would otherwise
  -- produce 'ana.2', which is legal, whereas a trim landing on '..' is not.
  WHILE _n < 1000 LOOP
    _suffix    := _n::text;
    _candidate := regexp_replace(left(_stem, 30 - length(_suffix)), '[._]+$', '') || _suffix;
    IF public.custom_url_available(_candidate, _user_id) THEN
      RETURN _candidate;
    END IF;
    _n := _n + 1;
  END LOOP;

  -- 998 collisions on one stem means something is wrong with the input, not
  -- with this member. Fall back to the id rather than looping forever.
  _candidate := 'member.' || substr(replace(_user_id::text, '-', ''), 1, 8);
  IF public.custom_url_available(_candidate, _user_id) THEN
    RETURN _candidate;
  END IF;

  RAISE EXCEPTION 'generate_custom_url could not find a free URL for % (stem %)', _user_id, _stem;
END;
$function$;

-- ── postconditions ─────────────────────────────────────────────────────────
DO $postconditions$
DECLARE
  r          record;
  _p         text;
  _bad       text := '';
  _n         int;
  _fp        text;
  _tables    int := 0;
  _functions int := 0;
  _views     int := 0;
BEGIN
  -- POST-001 · the touched objects hold exactly the intended ACL set (no more, no less).
  WITH _tabs(n) AS (SELECT unnest(ARRAY[
        '_v3_quarantine_decisions',
        '_v3_quarantine_tag_assignments',
        'activity_logs',
        'ad_conversions',
        'ad_creative_comments',
        'ad_creative_reactions',
        'ad_creative_shares',
        'ad_creatives',
        'ad_impressions',
        'admin_notifications',
        'admin_vote_adjustments',
        'ai_chat_usage',
        'album_photos',
        'auth_login_attempts',
        'badge_definitions',
        'bank_details',
        'blocked_keywords',
        'categories',
        'certificate_testimonials',
        'certificates',
        'chat_questions',
        'client_errors',
        'comment_reactions',
        'comment_reports',
        'comments',
        'competition_entries',
        'competition_entry_counts',
        'competition_judges',
        'competition_judging_tags',
        'competition_orders',
        'competition_payment_details',
        'competition_round_publish',
        'competition_votes',
        'competitions',
        'contributor_engagement_daily',
        'course_enrollments',
        'course_modules',
        'courses',
        'custom_url_history',
        'db_audit_logs',
        'email_send_log',
        'email_send_state',
        'email_templates',
        'email_unsubscribe_tokens',
        'entry_score_cache',
        'faq_entries',
        'featured_artists',
        'featured_photos',
        'feed_events',
        'follows',
        'friendships',
        'gift_announcements',
        'gift_credits',
        'hashtags',
        'held_result_notifications',
        'hero_banners',
        'highlight_items',
        'highlights',
        'image_comments',
        'image_reactions',
        'journal_articles',
        'judge_activity_logs',
        'judge_award_tags',
        'judge_comments',
        'judge_decisions',
        'judge_entry_assignments',
        'judge_entry_locks',
        'judge_scores',
        'judge_sessions',
        'judge_tag_assignments',
        'judging_config',
        'judging_preflight_log',
        'judging_rounds',
        'judging_tags',
        'lesson_progress',
        'lessons',
        'media_objects',
        'media_repair_audit',
        'member_activity_minutes',
        'newsletter_subscribers',
        'notification_emit_log',
        'notification_preferences',
        'office_staff',
        'photo_albums',
        'photo_of_the_day',
        'portfolio_images',
        'post_comment_reactions',
        'post_drafts',
        'post_hashtags',
        'post_media',
        'post_reactions',
        'post_reports',
        'post_shares',
        'post_tags',
        'posts',
        'profile_stats',
        'profile_views',
        'profiles',
        'profiles_public_data',
        'push_config',
        'push_delivery_log',
        'push_tokens',
        'raw_commitments',
        'referral_codes',
        'referrals',
        'role_applications',
        'role_display_config',
        'round_snapshots',
        'scheduled_boosts',
        'scheduled_posts',
        'search_recents',
        'site_settings',
        'stories',
        'story_views',
        'support_tickets',
        'suppressed_emails',
        'system_flags',
        'system_tag_decision_map',
        'test_agent_config',
        'test_agent_runs',
        'ticket_replies',
        'user_badges',
        'user_devices',
        'user_notifications',
        'user_roles',
        'v3_mirror_log',
        'v3_stage_catalog',
        'v3_tag_label_alias',
        'vote_adjustment_cleanup_log',
        'wallet_ledger_audit_log',
        'wallet_ledger_idempotency',
        'wallet_ledger_shadow_log',
        'wallet_ledger_v2_diff_log',
        'wallet_ledger_v2_rows',
        'wallet_reconciliation_log',
        'wallet_transactions',
        'wallets',
        'withdrawal_requests'
      ]::text[])),
    _vws(n) AS (SELECT unnest(ARRAY[
        'entry_final_votes',
        'entry_final_votes_legacy',
        'entry_public_status',
        'judge_tag_assignments_public_r4',
        'judging_progression_audit',
        'profiles_public',
        'v_judging_drift'
      ]::text[])),
    _fns(s) AS (SELECT unnest(ARRAY[
        'admin_delete_auth_user(_uid uuid)',
        'admin_emails_for_user_ids(_ids uuid[])',
        'admin_lookup_user_id_by_email(_email text)',
        'admin_purge_orphan_user_data(_uid uuid)',
        'app_has_role(_user_id uuid, _role text)',
        'cleanup_certificate_references()',
        'contributor_points_since(_since date)',
        'create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text)',
        'derive_status_from_stage_key(_stage_key text)',
        'engagement_collector_health()',
        'engagement_probe_report(_days integer)',
        'expire_gift_credit(_gift_id uuid)',
        'feed_candidates(_seed text, _categories text[], _recent integer, _sample integer, _own integer, _friends integer)',
        'feed_rank_score(_id uuid, _bucket integer, _seed text)',
        'filter_moderated_user_ids(_ids uuid[])',
        'get_ad_engagement(_creative_ids uuid[])',
        'get_app_event_counts_admin(_hours integer)',
        'get_app_events_admin(_hours integer, _code text, _severity text, _limit integer)',
        'get_client_error_stats_admin(_hours integer)',
        'get_course_lessons_for_editor(_course_id uuid)',
        'get_entries_private_meta(_entry_ids uuid[])',
        'get_entry_status_drift_admin()',
        'get_entry_status_drift_summary_admin()',
        'get_gated_status_runtime_drift_admin(p_entry_ids uuid[])',
        'get_judge_entries_page_filtered(_competition_id uuid, _round_number integer, _bucket text, _cursor_created_at timestamp with time zone, _cursor_id uuid, _limit integer)',
        'get_judging_drift_admin()',
        'get_judging_live_tag_progression_invariant_admin()',
        'get_lesson_content(_lesson_id uuid)',
        'get_my_certificate_entries()',
        'get_per_photo_placement(p_entry_ids uuid[])',
        'get_photo_r4_awards(p_entry_ids uuid[])',
        'get_profile_admin(_id uuid)',
        'get_profile_visible_fields(_target uuid)',
        'get_progression_drift_admin()',
        'get_public_final_votes(_entry_ids uuid[])',
        'get_public_role_user_ids(_role text)',
        'get_public_roles_for_users(_user_ids uuid[])',
        'get_result_visibility_invariant_admin()',
        'get_round_judging_gate_admin(_competition_id uuid, _round_number integer)',
        'get_round_judging_gate_self(_competition_id uuid, _round_number integer)',
        'get_round_pending_entries(p_competition_id uuid, p_round integer)',
        'get_round_summary(p_competition_id uuid, p_round_number integer)',
        'get_status_stage_key_drift_admin()',
        'get_system_tag_catalog_drift()',
        'get_test_agent_health_admin()',
        'get_top_contributors_v3()',
        'get_unjudged_parity_admin(p_judge_id uuid, p_competition_id uuid, p_round_number integer)',
        'global_search(term text, section text, username_only boolean)',
        'global_search_hashtags(term text)',
        'increment_managed_page_view(_page_id text)',
        'mark_expiring_post_drafts(_days integer)',
        'media_migration_fence_digest(_fence timestamp with time zone)',
        'media_migration_fence_digest_wide(_fence timestamp with time zone)',
        'media_migration_reconcile()',
        'media_write_path_delta(_since timestamp with time zone)',
        'mirror_system_tag_to_decision()',
        'post_media_for(_post_ids uuid[])',
        'record_test_agent_run(p_token text, p_run_id text, p_trigger text, p_commit_sha text, p_branch text, p_status text, p_rpc_parity_pass boolean, p_nr_drift_5min integer, p_dual_emit_status text, p_tsc_pass boolean, p_vitest_pass boolean, p_eslint_pass boolean, p_failures jsonb, p_duration_ms integer, p_github_run_url text)',
        'search_profiles_admin(q text)',
        'send_notification_email()',
        'soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid)',
        'suggest_hashtags(prefix text, max_results integer)',
        'tg_media_state_transition()',
        'tg_post_media_requires_ready()',
        'verify_staff_id(_id_number text)',
        'wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean)',
        'wallet_ledger_v2_diff_report(p_window interval)',
        'wallet_ledger_v2_drift_report(p_window interval)'
      ]::text[])),
    _defs(s) AS (SELECT unnest(ARRAY[
        'custom_url_transliterate(_s text)',
        'custom_url_slug(_full_name text)',
        'generate_custom_url(_full_name text, _user_id uuid)'
      ]::text[])),
  _lines AS (
      SELECT concat_ws('|', 'T', c.relname::text,
                       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                       a.privilege_type, pg_get_userbyid(a.grantor)::text, a.is_grantable::text) AS x
        FROM pg_class c JOIN _tabs ON _tabs.n = c.relname::text, LATERAL aclexplode(c.relacl) a
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
      UNION ALL
      SELECT concat_ws('|', 'F', p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')',
                       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END,
                       a.privilege_type, pg_get_userbyid(a.grantor)::text, a.is_grantable::text)
        FROM pg_proc p JOIN _fns ON _fns.s = p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')',
             LATERAL aclexplode(p.proacl) a
       WHERE p.pronamespace = 'public'::regnamespace
      UNION ALL
      SELECT concat_ws('|', 'V', c.relname::text, coalesce(c.reloptions::text, ''))
        FROM pg_class c JOIN _vws ON _vws.n = c.relname::text
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
      UNION ALL
      SELECT concat_ws('|', 'S', p.proname::text, md5(p.prosrc))
        FROM pg_proc p JOIN _defs ON _defs.s = p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')'
       WHERE p.pronamespace = 'public'::regnamespace
    )
  SELECT count(*)::int, md5(string_agg(x, E'\n' ORDER BY x COLLATE "C")) FROM _lines INTO _n, _fp;
  IF _n <> 3733 OR _fp IS DISTINCT FROM '9d0aa7be29390cec83399062bb593d61' THEN
    RAISE EXCEPTION 'ALIGN-0001-POST-001: the resulting ACL set is not the intended one (read % lines, md5 %; expected 3733, 9d0aa7be29390cec83399062bb593d61)', _n, _fp
      USING ERRCODE = 'raise_exception';
  END IF;

  -- Tables: every privilege of every touched table, for anon and authenticated,
  -- read through has_table_privilege (which also sees PUBLIC and role membership).
  -- want = the privileges the role must hold afterwards; keep = the subset that
  -- is a deliberate keep (staging wider than production, see the header).
  -- For SELECT/INSERT/UPDATE/REFERENCES, has_any_column_privilege must agree
  -- too, so a column-level grant cannot leave access behind a table revoke.
  FOR r IN
    SELECT * FROM (VALUES
      ('_v3_quarantine_decisions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('_v3_quarantine_decisions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('_v3_quarantine_tag_assignments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('_v3_quarantine_tag_assignments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('activity_logs', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('activity_logs', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ad_conversions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ad_conversions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ad_creative_comments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ad_creative_comments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ad_creative_reactions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ad_creative_reactions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ad_creative_shares', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ad_creative_shares', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ad_creatives', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ad_creatives', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ad_impressions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ad_impressions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('admin_notifications', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('admin_notifications', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('admin_vote_adjustments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('admin_vote_adjustments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ai_chat_usage', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ai_chat_usage', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('album_photos', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('album_photos', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('auth_login_attempts', 'anon', ARRAY[]::text[], ARRAY[]::text[]),
      ('auth_login_attempts', 'authenticated', ARRAY[]::text[], ARRAY[]::text[]),
      ('badge_definitions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('badge_definitions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('bank_details', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('bank_details', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('blocked_keywords', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('blocked_keywords', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('categories', 'anon', ARRAY['SELECT', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('categories', 'authenticated', ARRAY['SELECT', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('certificate_testimonials', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('certificate_testimonials', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('certificates', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('certificates', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('chat_questions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('chat_questions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('client_errors', 'anon', ARRAY[]::text[], ARRAY[]::text[]),
      ('client_errors', 'authenticated', ARRAY[]::text[], ARRAY[]::text[]),
      ('comment_reactions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('comment_reactions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('comment_reports', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('comment_reports', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('comments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('comments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competition_entries', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY['SELECT']::text[]),
      ('competition_entries', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY['SELECT']::text[]),
      ('competition_entry_counts', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competition_entry_counts', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competition_judges', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competition_judges', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competition_judging_tags', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competition_judging_tags', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competition_orders', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competition_orders', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competition_payment_details', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competition_payment_details', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competition_round_publish', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competition_round_publish', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competition_votes', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competition_votes', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competitions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('competitions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('contributor_engagement_daily', 'anon', ARRAY[]::text[], ARRAY[]::text[]),
      ('contributor_engagement_daily', 'authenticated', ARRAY[]::text[], ARRAY[]::text[]),
      ('course_enrollments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('course_enrollments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('course_modules', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('course_modules', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('courses', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('courses', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('custom_url_history', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('custom_url_history', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('db_audit_logs', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('db_audit_logs', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('email_send_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('email_send_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('email_send_state', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('email_send_state', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('email_templates', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('email_templates', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('email_unsubscribe_tokens', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('email_unsubscribe_tokens', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('entry_score_cache', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('entry_score_cache', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('faq_entries', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('faq_entries', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('featured_artists', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('featured_artists', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('featured_photos', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('featured_photos', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('feed_events', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('feed_events', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('follows', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('follows', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('friendships', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('friendships', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('gift_announcements', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('gift_announcements', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('gift_credits', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('gift_credits', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('hashtags', 'anon', ARRAY['SELECT', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('hashtags', 'authenticated', ARRAY['SELECT', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('held_result_notifications', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('held_result_notifications', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('hero_banners', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('hero_banners', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('highlight_items', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('highlight_items', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('highlights', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('highlights', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('image_comments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('image_comments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('image_reactions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('image_reactions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('journal_articles', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('journal_articles', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_activity_logs', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_activity_logs', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_award_tags', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_award_tags', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_comments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_comments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_decisions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_decisions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_entry_assignments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_entry_assignments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_entry_locks', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_entry_locks', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_scores', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_scores', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_sessions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_sessions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_tag_assignments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judge_tag_assignments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judging_config', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judging_config', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judging_preflight_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judging_preflight_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judging_rounds', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judging_rounds', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judging_tags', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('judging_tags', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('lesson_progress', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('lesson_progress', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('lessons', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY['SELECT']::text[]),
      ('lessons', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY['SELECT']::text[]),
      ('media_objects', 'anon', ARRAY[]::text[], ARRAY[]::text[]),
      ('media_objects', 'authenticated', ARRAY[]::text[], ARRAY[]::text[]),
      ('media_repair_audit', 'anon', ARRAY[]::text[], ARRAY[]::text[]),
      ('media_repair_audit', 'authenticated', ARRAY[]::text[], ARRAY[]::text[]),
      ('member_activity_minutes', 'anon', ARRAY[]::text[], ARRAY[]::text[]),
      ('member_activity_minutes', 'authenticated', ARRAY[]::text[], ARRAY[]::text[]),
      ('newsletter_subscribers', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('newsletter_subscribers', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('notification_emit_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('notification_emit_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('notification_preferences', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('notification_preferences', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('office_staff', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('office_staff', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('photo_albums', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('photo_albums', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('photo_of_the_day', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('photo_of_the_day', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('portfolio_images', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('portfolio_images', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('post_comment_reactions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('post_comment_reactions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('post_drafts', 'anon', ARRAY[]::text[], ARRAY[]::text[]),
      ('post_drafts', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('post_hashtags', 'anon', ARRAY['SELECT', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('post_hashtags', 'authenticated', ARRAY['SELECT', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('post_media', 'anon', ARRAY[]::text[], ARRAY[]::text[]),
      ('post_media', 'authenticated', ARRAY['SELECT']::text[], ARRAY['SELECT']::text[]),
      ('post_reactions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('post_reactions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('post_reports', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('post_reports', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('post_shares', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('post_shares', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('post_tags', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('post_tags', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('posts', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('posts', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('profile_stats', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('profile_stats', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('profile_views', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('profile_views', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('profiles', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('profiles', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('profiles_public_data', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY['SELECT']::text[]),
      ('profiles_public_data', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('push_config', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('push_config', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('push_delivery_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('push_delivery_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('push_tokens', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('push_tokens', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('raw_commitments', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('raw_commitments', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('referral_codes', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('referral_codes', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('referrals', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('referrals', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('role_applications', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('role_applications', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('role_display_config', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('role_display_config', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('round_snapshots', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('round_snapshots', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('scheduled_boosts', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('scheduled_boosts', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('scheduled_posts', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('scheduled_posts', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('search_recents', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('search_recents', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('site_settings', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('site_settings', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('stories', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('stories', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('story_views', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('story_views', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('support_tickets', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('support_tickets', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('suppressed_emails', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('suppressed_emails', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('system_flags', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('system_flags', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('system_tag_decision_map', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('system_tag_decision_map', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('test_agent_config', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('test_agent_config', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('test_agent_runs', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('test_agent_runs', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ticket_replies', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('ticket_replies', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('user_badges', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('user_badges', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('user_devices', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('user_devices', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('user_notifications', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('user_notifications', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('user_roles', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('user_roles', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('v3_mirror_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('v3_mirror_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('v3_stage_catalog', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('v3_stage_catalog', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('v3_tag_label_alias', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('v3_tag_label_alias', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('vote_adjustment_cleanup_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('vote_adjustment_cleanup_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallet_ledger_audit_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallet_ledger_audit_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallet_ledger_idempotency', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallet_ledger_idempotency', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallet_ledger_shadow_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallet_ledger_shadow_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallet_ledger_v2_diff_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallet_ledger_v2_diff_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallet_ledger_v2_rows', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallet_ledger_v2_rows', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallet_reconciliation_log', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallet_reconciliation_log', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallet_transactions', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallet_transactions', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallets', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('wallets', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('withdrawal_requests', 'anon', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[]),
      ('withdrawal_requests', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN']::text[], ARRAY[]::text[])
    ) AS v(tbl, role, want, keep)
  LOOP
    FOREACH _p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
      IF has_table_privilege(r.role, ('public.' || quote_ident(r.tbl))::regclass, _p) IS DISTINCT FROM (_p = ANY (r.want)) THEN
        _bad := _bad || E'\n  POST-002 T ' || r.tbl || ' ' || r.role || ' ' || _p || ' expected ' || (_p = ANY (r.want))::text;
      END IF;
      IF has_table_privilege('public', ('public.' || quote_ident(r.tbl))::regclass, _p) THEN
        _bad := _bad || E'\n  POST-002 T ' || r.tbl || ' PUBLIC ' || _p || ' expected false';
      END IF;
      IF _p IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') AND NOT (_p = ANY (r.keep))
         AND has_any_column_privilege(r.role, ('public.' || quote_ident(r.tbl))::regclass, _p) IS DISTINCT FROM (_p = ANY (r.want)) THEN
        _bad := _bad || E'\n  POST-002 C ' || r.tbl || ' ' || r.role || ' ' || _p || ' (any column) expected ' || (_p = ANY (r.want))::text;
      END IF;
    END LOOP;
    _tables := _tables + 1;
  END LOOP;

  -- Functions: EXECUTE for PUBLIC, anon, authenticated and service_role.
  FOR r IN
    SELECT v.*, p.oid AS fn_oid
      FROM (VALUES
      ('admin_delete_auth_user(_uid uuid)', false, false, false, true),
      ('admin_emails_for_user_ids(_ids uuid[])', false, false, false, true),
      ('admin_lookup_user_id_by_email(_email text)', false, false, false, true),
      ('admin_purge_orphan_user_data(_uid uuid)', false, false, false, true),
      ('app_has_role(_user_id uuid, _role text)', false, true, true, true),
      ('cleanup_certificate_references()', false, false, false, true),
      ('contributor_points_since(_since date)', false, false, false, true),
      ('create_pending_deposit(_user_id uuid, _amount numeric, _gateway text, _reference text, _metadata jsonb, _idempotency_key text)', false, false, false, true),
      ('derive_status_from_stage_key(_stage_key text)', false, true, true, true),
      ('engagement_collector_health()', false, false, false, true),
      ('engagement_probe_report(_days integer)', false, false, false, true),
      ('expire_gift_credit(_gift_id uuid)', false, false, false, true),
      ('feed_candidates(_seed text, _categories text[], _recent integer, _sample integer, _own integer, _friends integer)', false, false, false, true),
      ('feed_rank_score(_id uuid, _bucket integer, _seed text)', false, false, false, true),
      ('filter_moderated_user_ids(_ids uuid[])', false, true, true, true),
      ('get_ad_engagement(_creative_ids uuid[])', false, false, true, true),
      ('get_app_event_counts_admin(_hours integer)', false, false, true, true),
      ('get_app_events_admin(_hours integer, _code text, _severity text, _limit integer)', false, false, true, true),
      ('get_client_error_stats_admin(_hours integer)', false, false, true, true),
      ('get_course_lessons_for_editor(_course_id uuid)', false, false, true, true),
      ('get_entries_private_meta(_entry_ids uuid[])', false, true, true, true),
      ('get_entry_status_drift_admin()', false, true, true, true),
      ('get_entry_status_drift_summary_admin()', false, true, true, true),
      ('get_gated_status_runtime_drift_admin(p_entry_ids uuid[])', false, true, true, true),
      ('get_judge_entries_page_filtered(_competition_id uuid, _round_number integer, _bucket text, _cursor_created_at timestamp with time zone, _cursor_id uuid, _limit integer)', false, true, true, true),
      ('get_judging_drift_admin()', false, true, true, true),
      ('get_judging_live_tag_progression_invariant_admin()', false, false, false, true),
      ('get_lesson_content(_lesson_id uuid)', false, true, true, true),
      ('get_my_certificate_entries()', false, false, true, true),
      ('get_per_photo_placement(p_entry_ids uuid[])', false, true, true, true),
      ('get_photo_r4_awards(p_entry_ids uuid[])', false, false, false, true),
      ('get_profile_admin(_id uuid)', false, true, true, true),
      ('get_profile_visible_fields(_target uuid)', false, true, true, true),
      ('get_progression_drift_admin()', false, true, true, true),
      ('get_public_final_votes(_entry_ids uuid[])', false, true, true, true),
      ('get_public_role_user_ids(_role text)', false, true, true, true),
      ('get_public_roles_for_users(_user_ids uuid[])', false, true, true, true),
      ('get_result_visibility_invariant_admin()', false, false, false, true),
      ('get_round_judging_gate_admin(_competition_id uuid, _round_number integer)', false, true, true, true),
      ('get_round_judging_gate_self(_competition_id uuid, _round_number integer)', false, true, true, true),
      ('get_round_pending_entries(p_competition_id uuid, p_round integer)', false, true, true, true),
      ('get_round_summary(p_competition_id uuid, p_round_number integer)', false, true, true, true),
      ('get_status_stage_key_drift_admin()', false, false, false, true),
      ('get_system_tag_catalog_drift()', false, true, true, true),
      ('get_test_agent_health_admin()', false, true, true, true),
      ('get_top_contributors_v3()', false, true, true, true),
      ('get_unjudged_parity_admin(p_judge_id uuid, p_competition_id uuid, p_round_number integer)', false, true, true, true),
      ('global_search(term text, section text, username_only boolean)', false, true, true, true),
      ('global_search_hashtags(term text)', false, true, true, true),
      ('increment_managed_page_view(_page_id text)', false, true, true, true),
      ('mark_expiring_post_drafts(_days integer)', false, false, false, true),
      ('media_migration_fence_digest(_fence timestamp with time zone)', false, false, false, true),
      ('media_migration_fence_digest_wide(_fence timestamp with time zone)', false, false, false, true),
      ('media_migration_reconcile()', false, false, false, true),
      ('media_write_path_delta(_since timestamp with time zone)', false, false, false, true),
      ('mirror_system_tag_to_decision()', false, true, true, true),
      ('post_media_for(_post_ids uuid[])', false, true, true, true),
      ('record_test_agent_run(p_token text, p_run_id text, p_trigger text, p_commit_sha text, p_branch text, p_status text, p_rpc_parity_pass boolean, p_nr_drift_5min integer, p_dual_emit_status text, p_tsc_pass boolean, p_vitest_pass boolean, p_eslint_pass boolean, p_failures jsonb, p_duration_ms integer, p_github_run_url text)', false, true, true, true),
      ('search_profiles_admin(q text)', false, true, true, true),
      ('send_notification_email()', false, true, true, true),
      ('soft_void_wallet_transactions(p_txn_ids uuid[], p_reason text, p_batch_id uuid)', false, false, false, true),
      ('suggest_hashtags(prefix text, max_results integer)', false, false, true, true),
      ('tg_media_state_transition()', false, false, false, true),
      ('tg_post_media_requires_ready()', false, false, false, true),
      ('verify_staff_id(_id_number text)', false, true, true, true),
      ('wallet_ledger_apply_v2(p_op text, p_user_id uuid, p_amount numeric, p_idempotency_key text, p_description text, p_reference_id text, p_source_path text, p_dry_run boolean)', false, false, false, true),
      ('wallet_ledger_v2_diff_report(p_window interval)', false, true, true, true),
      ('wallet_ledger_v2_drift_report(p_window interval)', false, true, true, true)
      ) AS v(sig, x_public, x_anon, x_auth, x_service)
      LEFT JOIN pg_proc p
        ON p.pronamespace = 'public'::regnamespace
       AND p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' = v.sig
  LOOP
    IF r.fn_oid IS NULL THEN
      _bad := _bad || E'\n  POST-002 F missing: ' || r.sig;
      CONTINUE;
    END IF;
    IF has_function_privilege('public', r.fn_oid, 'EXECUTE') IS DISTINCT FROM r.x_public
       OR has_function_privilege('anon', r.fn_oid, 'EXECUTE') IS DISTINCT FROM r.x_anon
       OR has_function_privilege('authenticated', r.fn_oid, 'EXECUTE') IS DISTINCT FROM r.x_auth
       OR has_function_privilege('service_role', r.fn_oid, 'EXECUTE') IS DISTINCT FROM r.x_service THEN
      _bad := _bad || E'\n  POST-002 F ' || r.sig || ' expected public/anon/authenticated/service_role = '
                   || r.x_public || '/' || r.x_anon || '/' || r.x_auth || '/' || r.x_service;
    END IF;
    _functions := _functions + 1;
  END LOOP;

  -- Views: security_invoker exactly as production stores it.
  FOR r IN
    SELECT v.*, c.reloptions::text AS got
      FROM (VALUES
      ('entry_final_votes', '{security_invoker=true}'),
      ('entry_final_votes_legacy', '{security_invoker=true}'),
      ('entry_public_status', '{security_invoker=false}'),
      ('judge_tag_assignments_public_r4', '{security_invoker=on}'),
      ('judging_progression_audit', '{security_invoker=true}'),
      ('profiles_public', '{security_invoker=true}'),
      ('v_judging_drift', '{security_invoker=on}')
      ) AS v(vw, want)
      LEFT JOIN pg_class c ON c.relnamespace = 'public'::regnamespace AND c.relname::text = v.vw AND c.relkind = 'v'
  LOOP
    IF r.got IS DISTINCT FROM r.want THEN
      _bad := _bad || E'\n  POST-002 V ' || r.vw || ' options ' || coalesce(r.got, 'NULL') || ' expected ' || r.want;
    END IF;
    _views := _views + 1;
  END LOOP;

  -- The three handle functions: body hash, ACL and attributes (production's).
  FOR r IN
    SELECT v.*, p.oid AS fn_oid, md5(p.prosrc) AS got_md5, p.proacl::text AS got_acl, p.prosecdef AS got_secdef,
           p.provolatile::text AS got_vol, p.proconfig::text AS got_config
      FROM (VALUES
      ('custom_url_transliterate(_s text)', '62944d4450f685051aa1fed8d466263a', '{postgres=X/postgres,service_role=X/postgres}', true, 's', '{search_path=public}'),
      ('custom_url_slug(_full_name text)', 'd04540ab675e3f229008259d456d9d65', '{postgres=X/postgres,service_role=X/postgres}', true, 's', '{search_path=public}'),
      ('generate_custom_url(_full_name text, _user_id uuid)', '8577b8c55897b064776538d6e638a756', '{postgres=X/postgres,service_role=X/postgres}', true, 'v', '{search_path=public}')
      ) AS v(sig, want_md5, want_acl, want_secdef, want_vol, want_config)
      LEFT JOIN pg_proc p
        ON p.pronamespace = 'public'::regnamespace
       AND p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' = v.sig
  LOOP
    IF r.fn_oid IS NULL OR r.got_md5 IS DISTINCT FROM r.want_md5 OR r.got_acl IS DISTINCT FROM r.want_acl
       OR r.got_secdef IS DISTINCT FROM r.want_secdef OR r.got_vol IS DISTINCT FROM r.want_vol
       OR r.got_config IS DISTINCT FROM r.want_config THEN
      _bad := _bad || E'\n  POST-003 S ' || r.sig || ' body/ACL/attributes differ (md5 ' || coalesce(r.got_md5, 'missing') || ')';
    END IF;
  END LOOP;

  IF _bad <> '' THEN
    RAISE EXCEPTION 'ALIGN-0001-POST: post-state differs from the intended one:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'ALIGN-0001: % tables, % functions, % views checked by effective privilege; 3 handle functions = production; 6 deliberate SELECT keeps unchanged',
    _tables / 2, _functions, _views;
END
$postconditions$;

COMMIT;
