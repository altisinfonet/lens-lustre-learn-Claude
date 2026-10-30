-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S1 PHASE 0 SECURITY RE-MEASURE · 2026-10-28
-- READ ONLY (BEGIN READ ONLY … ROLLBACK). Prints one verdict line per check;
-- changes nothing. Prints COUNTS and BOOLEANS only, plus the one function name
-- (enqueue_email) the unit is about — the Actions log is public, so no list of
-- exposed function names, no row data, no member ids, no emails.
--
-- Definitions are REUSED, not invented:
--   S1P0-1  supabase/migrations/20260814042609_email_queue_authority.sql:171
--           (REVOKE ALL … enqueue_email FROM PUBLIC, anon, authenticated).
--           Effective privilege (has_function_privilege), so a PUBLIC grant
--           counts against anon/authenticated exactly as F-62 says it must.
--   S1P0-2  scripts/audits/rls-authority-scan.mjs detectSecurityDefiner() (retired
--           2026-10-29, S11; `git show 49cfb97f:scripts/audits/rls-authority-scan.mjs`),
--           the SECDEF_NO_AUTH_GUARD rule (baseline 258, static, in
--           docs/fix-sprints/sprint-0-phase-0b-6-rls-authority-guardrail.md):
--           SECURITY DEFINER whose body matches the SAME guard regex. Here
--           measured LIVE: in the exposed schemas (public, graphql_public),
--           callable by anon. The static 258 counts migration text; this counts
--           what is deployed — compare the trend, not the digit.
--   S1P0-3  the P32 revoke set: every function the 20260910_*p32* migrations
--           REVOKE from anon / authenticated, which the 2026-09-11 full-schema
--           bootstrap reopened (F-66). Intended state: anon holds none of the
--           69; authenticated holds none of the 30 that were also revoked from
--           it. (password_verification_hook is excluded from the authenticated
--           set — Owner Decision 1, Appendix D ACL posture, is not mine to
--           pre-judge; it is still in the anon set.) A listed function absent
--           on a lane is counted as "absent", not as a pass or a failure.
--   S1P0-4  RLS on every ordinary / partitioned table in public.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $s1p0$
DECLARE
  _n_enq int; _enq_anon boolean; _enq_auth boolean;
  _guard constant text := '(auth\.uid\s*\(\s*\)|has_role\s*\(|current_setting\s*\(\s*''request\.jwt|current_user\y|session_user\y|app\.current_admin)';
  _ungated int; _secdef_anon int;
  _anon_set constant text[] := ARRAY[
    '_ensure_stats_row',
    '_gen_competition_order_no',
    'acquire_judge_lock',
    'admin_delete_auth_user',
    'admin_flag_entry_for_review',
    'admin_list_certificates',
    'admin_purge_orphan_user_data',
    'admin_reject_wallet_transaction',
    'admin_rewind_stage',
    'admin_search_certificate_recipients',
    'admin_search_users',
    'admin_search_users_v2',
    'admin_set_photo_rejected',
    'admin_wallet_credit',
    'apply_decision_to_remaining',
    'approve_deposit',
    'backfill_judging_notifications',
    'backfill_tag_decision_drift_admin',
    'create_pending_deposit',
    'create_system_post',
    'delete_email',
    'emit_birthday_notifications',
    'emit_notification',
    'enqueue_post_job',
    'enroll_in_course',
    'expire_gift_credit',
    'expiring_post_drafts',
    'fix_certificate_readiness_admin',
    'fix_gift_drift_admin',
    'fix_referral_drift_admin',
    'generate_custom_url',
    'get_broadcast_feed',
    'get_certificate_drift_admin',
    'get_derived_status_drift_admin',
    'get_judge_collusion_admin',
    'get_judging_tag_assignment_counts',
    'heartbeat_judge_lock',
    'issue_course_completion_certificate',
    'judge_apply_single_tag',
    'judging_write_decision_atomic',
    'log_push_outcome',
    'mark_expiring_post_drafts',
    'move_to_dlq',
    'password_verification_hook',
    'pj_handle_comment_notification',
    'pj_handle_reaction_notification',
    'pj_handle_recount_engagement',
    'pj_handle_tag_notification',
    'process_post_jobs',
    'prune_activity_minutes',
    'prune_client_errors',
    'prune_old_notifications',
    'reap_post_drafts',
    'recompute_entry_from_tag_assignments',
    'recompute_entry_public_status',
    'record_activity_minute',
    'recount_hashtags',
    'refresh_viewer_buckets',
    'register_push_token',
    'release_judge_lock',
    'request_withdrawal',
    'rollup_engagement_daily',
    'set_write_path',
    'soft_void_wallet_transactions',
    'submit_competition_entry',
    'unregister_push_token',
    'wallet_ledger_apply_v2',
    'wallet_ledger_v2_diff_snapshot',
    'wallet_transaction'];
  _auth_set constant text[] := ARRAY[
    '_ensure_stats_row',
    '_gen_competition_order_no',
    'apply_decision_to_remaining',
    'delete_email',
    'emit_birthday_notifications',
    'emit_notification',
    'enqueue_post_job',
    'expiring_post_drafts',
    'generate_custom_url',
    'get_derived_status_drift_admin',
    'judge_apply_single_tag',
    'judging_write_decision_atomic',
    'log_push_outcome',
    'move_to_dlq',
    'pj_handle_comment_notification',
    'pj_handle_reaction_notification',
    'pj_handle_recount_engagement',
    'pj_handle_tag_notification',
    'process_post_jobs',
    'prune_activity_minutes',
    'prune_client_errors',
    'prune_old_notifications',
    'reap_post_drafts',
    'recompute_entry_from_tag_assignments',
    'recompute_entry_public_status',
    'recount_hashtags',
    'refresh_viewer_buckets',
    'rollup_engagement_daily',
    'set_write_path',
    'wallet_ledger_v2_diff_snapshot'];
  _present_anon int; _absent_anon int; _open_anon int;
  _present_auth int; _open_auth int;
  _no_rls int; _tables int;
BEGIN
  RAISE NOTICE 'S1P0 now=%  db=%', now(), current_database();

  -- 1 · enqueue_email: no EXECUTE for anon / authenticated on ANY overload.
  SELECT count(*),
         coalesce(bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')), false),
         coalesce(bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')), false)
    INTO _n_enq, _enq_anon, _enq_auth
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'enqueue_email';
  RAISE NOTICE 'S1P0-1 % enqueue_email overloads=% anon_execute=% authenticated_execute=%',
    CASE WHEN _n_enq > 0 AND NOT _enq_anon AND NOT _enq_auth THEN 'PASS'
         WHEN _n_enq = 0 THEN 'FAIL(function absent — nothing to prove)' ELSE 'FAIL' END,
    _n_enq, _enq_anon, _enq_auth;

  -- 2 · ungated SECURITY DEFINER callable by anon, exposed schemas.
  SELECT count(*) FILTER (WHERE p.prosrc !~* _guard), count(*)
    INTO _ungated, _secdef_anon
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'graphql_public')
     AND p.prosecdef
     AND p.prokind = 'f'
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  RAISE NOTICE 'S1P0-2 MEASURED ungated_secdef_callable_by_anon=% (of % secdef functions anon can execute; guard regex = rls-authority-scan.mjs)',
    _ungated, _secdef_anon;

  -- 3 · the P32 revoke set is still closed.
  SELECT count(DISTINCT p.proname),
         count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))
    INTO _present_anon, _open_anon
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = ANY (_anon_set);
  _absent_anon := cardinality(_anon_set) - _present_anon;
  SELECT count(DISTINCT p.proname),
         count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    INTO _present_auth, _open_auth
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = ANY (_auth_set);
  RAISE NOTICE 'S1P0-3 % anon: set=% present=% absent=% overloads_still_executable=% | authenticated: set=% present=% overloads_still_executable=%',
    CASE WHEN _open_anon = 0 AND _open_auth = 0 THEN 'PASS' ELSE 'FAIL' END,
    cardinality(_anon_set), _present_anon, _absent_anon, _open_anon,
    cardinality(_auth_set), _present_auth, _open_auth;

  -- 4 · RLS on every table in public.
  SELECT count(*) FILTER (WHERE NOT c.relrowsecurity), count(*)
    INTO _no_rls, _tables
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition;
  RAISE NOTICE 'S1P0-4 % tables_without_rls=% of % tables in public',
    CASE WHEN _no_rls = 0 THEN 'PASS' ELSE 'FAIL' END, _no_rls, _tables;
END
$s1p0$;
ROLLBACK;
