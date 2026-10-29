-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S11 M2 — default EXECUTE privileges, measured before any change
-- (staging and production). READ ONLY, ROLLBACK. COUNTS ONLY: the Actions log
-- is public, so no exposed-function names are printed (same rule as PROBE_s1).
--
-- M2 proposes ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM
-- anon, authenticated, plus an allow-list of the RPCs the client really calls.
-- Default privileges only shape FUTURE functions, so this reports:
--   1. every pg_default_acl entry for functions (global and per schema), by
--      grantor role: does anon / authenticated / PUBLIC get EXECUTE by default?
--   2. public-schema functions anon can execute, and authenticated can execute
--      (effective privilege, so a PUBLIC grant counts — F-62);
--   3. of those, how many the app calls by name (the list below is every
--      .rpc("…") name in src/, supabase/functions/ and functions/ on staging,
--      2026-10-29, grep noise such as test stubs removed — a LOWER bound: calls
--      through a variable are not all seen);
--   4. of those, how many RLS policies reference (they run as the caller and
--      need EXECUTE whatever the client calls), and how many are trigger
--      functions (they run as the table owner and need no caller EXECUTE).
-- "other" is NOT "safe to revoke": functions called inside views, invoker
-- functions or column defaults also need the caller's EXECUTE and land there.
-- Never fails on what it finds. FAILS only if the lane is not asserted.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $p$
DECLARE
  client_rpcs text[] := ARRAY[
    'acquire_judge_lock', 'admin_flag_entry_for_review', 'admin_health_daily', 'admin_purge_orphan_user_data',
    'admin_reject_wallet_transaction', 'admin_search_users', 'admin_set_photo_rejected', 'admin_wallet_credit',
    'app_has_role', 'approve_deposit', 'are_friends', 'auth_emails',
    'backfill_judging_notifications', 'change_custom_url', 'check_custom_urls_taken', 'claim_username',
    'create_pending_deposit', 'current_phase', 'delete_email', 'emit_notification',
    'enqueue_email', 'enroll_in_course', 'expire_gift_credit', 'feature_add_member',
    'feature_admin_state', 'feature_member_search', 'feature_set_mode', 'feed_mix_admin_stats',
    'feed_mix_set', 'filter_moderated_user_ids', 'fix_certificate_readiness_admin', 'fix_gift_drift_admin',
    'fix_referral_drift_admin', 'get_ad_autoscale_stats', 'get_ad_engagement', 'get_app_event_counts_admin',
    'get_app_events_admin', 'get_broadcast_feed', 'get_certificate_drift_admin', 'get_certificate_readiness_drift_admin',
    'get_competition_duplicate_clusters', 'get_competition_raw_commitments', 'get_contributor_scores', 'get_course_lessons_for_editor',
    'get_entry_status_drift_admin', 'get_entry_status_drift_summary_admin', 'get_feed_page', 'get_feed_stories_bar',
    'get_gated_entry_status', 'get_gift_drift_admin', 'get_judge_collusion_admin', 'get_judging_drift_admin',
    'get_judging_tag_assignment_counts', 'get_lesson_content', 'get_my_certificate_entries', 'get_my_notifications_grouped',
    'get_my_story_view_counts', 'get_my_unread_notifications_grouped', 'get_notification_drift_admin', 'get_notification_health_stats_admin',
    'get_personal_feed', 'get_placement_drift_admin', 'get_post_view_counts', 'get_profile_admin',
    'get_profile_visible_fields', 'get_progression_drift_admin', 'get_public_final_votes', 'get_public_role_user_ids',
    'get_public_roles_for_users', 'get_public_round_scores', 'get_referral_drift_admin', 'get_round_summary',
    'get_test_agent_health_admin', 'get_todays_birthdays', 'get_top_contributors_v1', 'has_role',
    'heartbeat_judge_lock', 'increment_managed_page_view', 'is_s3_storage_enabled', 'issue_course_completion_certificate',
    'judge_apply_single_tag', 'judging_invariants', 'judging_invariants_check', 'judging_rounds',
    'judging_write_decision_atomic', 'list_tag_decision_drift_admin', 'md5_public_shim', 'media_derivative_queue',
    'media_derivative_record', 'media_derivative_source', 'media_derivative_target', 'media_mark_ready',
    'media_mark_verified', 'media_migrate_post', 'media_migration_reconcile', 'media_quarantine',
    'move_to_dlq', 'mutual_friend_ids', 'mutual_friends_count', 'post_attach_media',
    'process_referral_reward', 'publish_post_draft', 'read_email_batch', 'record_client_telemetry',
    'record_session_end', 'register_push_token', 'release_judge_lock', 'request_withdrawal',
    'resolve_custom_url', 'search_certificates', 'search_profiles_admin', 'soft_void_wallet_transactions',
    'submit_competition_entry', 'suggest_hashtags', 'suggest_username', 'transactional_emails',
    'unregister_push_token', 'username_available', 'verify_certificate', 'verify_certificate_by_token',
    'verify_staff_id', 'video_begin_upload', 'video_delete', 'video_publish_post',
    'video_source_begin', 'video_source_cancel', 'wallet_ledger_apply_v2', 'wallet_transaction',
    'withdrawal_requests'
  ];
  r record; line text := '';
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  -- 1. default ACLs for functions
  FOR r IN
    SELECT pg_get_userbyid(d.defaclrole) AS grantor,
           coalesce(n.nspname, '(all schemas)') AS scope,
           bool_or(a.grantee = 0) AS to_public,
           bool_or(a.grantee = to_regrole('anon')) AS to_anon,
           bool_or(a.grantee = to_regrole('authenticated')) AS to_auth
      FROM pg_default_acl d
      LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
      CROSS JOIN LATERAL aclexplode(d.defaclacl) a
     WHERE d.defaclobjtype = 'f' AND a.privilege_type = 'EXECUTE'
     GROUP BY 1, 2 ORDER BY 1, 2
  LOOP
    line := line || format(E'\n  default  grantor %-16s %-14s EXECUTE to PUBLIC=%s anon=%s authenticated=%s',
      r.grantor, r.scope, r.to_public, r.to_anon, r.to_auth);
  END LOOP;
  IF line = '' THEN line := E'\n  default  (no default EXECUTE entries for functions — the built-in PUBLIC default applies)'; END IF;

  -- 2–4. counts over public-schema functions
  WITH f AS (
    SELECT p.oid, p.proname,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
           p.prorettype = 'trigger'::regtype AS is_trigger,
           p.proname = ANY (client_rpcs) AS client_called,
           EXISTS (SELECT 1 FROM pg_policies pol
                    WHERE coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '') ~ ('\m' || regexp_replace(p.proname, '(\W)', '\\\1', 'g') || '\(')) AS in_policy
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
  )
  SELECT format(E'\n  public   functions %s · anon can execute %s (client-called %s, in policies %s, triggers %s, other %s) · authenticated can execute %s (client-called %s, in policies %s, triggers %s, other %s) · client names known %s, found on lane %s',
           count(*),
           count(*) FILTER (WHERE anon_x),
           count(*) FILTER (WHERE anon_x AND client_called),
           count(*) FILTER (WHERE anon_x AND in_policy),
           count(*) FILTER (WHERE anon_x AND is_trigger),
           count(*) FILTER (WHERE anon_x AND NOT client_called AND NOT in_policy AND NOT is_trigger),
           count(*) FILTER (WHERE auth_x),
           count(*) FILTER (WHERE auth_x AND client_called),
           count(*) FILTER (WHERE auth_x AND in_policy),
           count(*) FILTER (WHERE auth_x AND is_trigger),
           count(*) FILTER (WHERE auth_x AND NOT client_called AND NOT in_policy AND NOT is_trigger),
           cardinality(client_rpcs),
           (SELECT count(DISTINCT x) FROM unnest(client_rpcs) x WHERE EXISTS (SELECT 1 FROM f WHERE f.proname = x)))
    INTO r FROM f;
  line := line || r.format;

  RAISE NOTICE 'M2 DEFAULT PRIVILEGES (lane %):%', current_setting('p32.lane'), line;
END
$p$;

ROLLBACK;
