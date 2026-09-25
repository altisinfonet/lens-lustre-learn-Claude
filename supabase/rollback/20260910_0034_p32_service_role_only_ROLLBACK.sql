-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0034_p32_service_role_only.sql
-- Identical stem, as required. 27 objects.
--
-- ⚠ EXECUTING THIS FILE REOPENS anon, authenticated EXECUTE ON 27 SECURITY DEFINER,
-- VOLATILE FUNCTIONS. Every one runs with its owner's rights, and `postgres`
-- on Supabase is BYPASSRLS, so the grant is the only control there is.
--
-- ── WHY THE APPLY IS TWO-LANE AND THIS FILE IS NOT ────────────────────────
--
-- 20260910_0034 closes a door, so its assertion accepts staging or production.
-- This file OPENS that door, so its guard accepts staging only and nothing
-- else. The two assertions are deliberately different and neither form should
-- be copied into the other.
--
-- ── WHAT IT RESTORES ──────────────────────────────────────────────────────
--
-- EXECUTE to anon, authenticated, BY NAME, on the 27. NEVER `TO PUBLIC`: the
-- postcondition asserts zero PUBLIC ACL entries after the grant, which is what
-- catches a TO PUBLIC slip that "anon can execute" alone would not.
--
-- Does not touch service_role, postgres, any body, or any COMMENT.
--
-- ── IT REFUSES WHEN THERE IS NOTHING TO UNDO ──────────────────────────────
--
-- The precondition requires the post-0034 state. Run against the pre-apply
-- state it refuses, so "it did nothing" and "it did its job" are never the
-- same outcome.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── R-9 LANE GUARD — executable, fatal, first. STAGING ONLY. ──────────────
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging (read: %). '
      'This rollback reopens anon, authenticated EXECUTE on 27 SECURITY DEFINER functions. '
      'The file cannot detect its own lane, so it refuses unless the lane is asserted. '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

-- ── PRECONDITION — the post-apply state must be in place. ─────────────────
DO $preconditions$
DECLARE
  s     text;
  o     oid;
  pub_n int;
  n     int := 0;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    '_ensure_stats_row(uid uuid)',
    '_gen_competition_order_no()',
    'apply_decision_to_remaining(_competition_id uuid, _round_number integer, _decision text)',
    'delete_email(queue_name text, message_id bigint)',
    'emit_birthday_notifications()',
    'enqueue_post_job(_payload jsonb)',
    'expiring_post_drafts()',
    'get_derived_status_drift_admin()',
    'judge_apply_single_tag(_entry_id uuid, _photo_index integer, _round_number integer, _tag_id uuid, _judge_id uuid)',
    'judging_write_decision_atomic(p_entry_id uuid, p_stage_key text, p_current_round text)',
    'log_push_outcome(_user_id uuid, _notification_id uuid, _type text, _outcome text, _detail text)',
    'pj_handle_comment_notification(_msg jsonb)',
    'pj_handle_reaction_notification(_msg jsonb)',
    'pj_handle_recount_engagement(_msg jsonb)',
    'pj_handle_tag_notification(_msg jsonb)',
    'process_post_jobs(_batch integer)',
    'prune_activity_minutes(_dry_run boolean)',
    'prune_client_errors(_days integer)',
    'prune_old_notifications(_days integer, _max_rows integer)',
    'reap_post_drafts(_ids uuid[])',
    'recompute_entry_from_tag_assignments(p_entry_id uuid)',
    'recompute_entry_public_status(p_entry_id uuid)',
    'recount_hashtags(tag_ids uuid[])',
    'refresh_viewer_buckets()',
    'rollup_engagement_daily(_utc_date date)',
    'set_write_path(p text)',
    'wallet_ledger_v2_diff_snapshot(p_window interval)']
  LOOP
    n := n + 1;
    SELECT p.oid INTO o
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = s;
    IF o IS NULL THEN
      RAISE EXCEPTION 'P32-0034-RB-PRE-001: public.% does not exist with that exact signature', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF has_function_privilege('anon', o, 'EXECUTE') THEN
      RAISE EXCEPTION
        'P32-0034-RB-PRE-002: anon already holds EXECUTE on %, so 20260910_0034 is not in '
        'effect and there is nothing for this file to roll back', s
        USING ERRCODE = 'raise_exception';
    END IF;
    SELECT count(*) INTO pub_n FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid = o AND a.grantee = 0;
    IF pub_n <> 0 THEN
      RAISE EXCEPTION 'P32-0034-RB-PRE-003: % still has a PUBLIC ACL entry', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_function_privilege('service_role', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0034-RB-PRE-004: service_role is missing EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 27 THEN
    RAISE EXCEPTION 'P32-0034-RB-PRE-005: expected 27 functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── THE RESTORATION — by grantee name. Never TO PUBLIC. ───────────────────
GRANT EXECUTE ON FUNCTION public._ensure_stats_row(uid uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._gen_competition_order_no() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_decision_to_remaining(_competition_id uuid, _round_number integer, _decision text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_email(queue_name text, message_id bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_birthday_notifications() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_post_job(_payload jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expiring_post_drafts() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_derived_status_drift_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.judge_apply_single_tag(_entry_id uuid, _photo_index integer, _round_number integer, _tag_id uuid, _judge_id uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.judging_write_decision_atomic(p_entry_id uuid, p_stage_key text, p_current_round text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_push_outcome(_user_id uuid, _notification_id uuid, _type text, _outcome text, _detail text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pj_handle_comment_notification(_msg jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pj_handle_reaction_notification(_msg jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pj_handle_recount_engagement(_msg jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pj_handle_tag_notification(_msg jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_post_jobs(_batch integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_activity_minutes(_dry_run boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_client_errors(_days integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_old_notifications(_days integer, _max_rows integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_post_drafts(_ids uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_entry_from_tag_assignments(p_entry_id uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_entry_public_status(p_entry_id uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recount_hashtags(tag_ids uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_viewer_buckets() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollup_engagement_daily(_utc_date date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_write_path(p text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_v2_diff_snapshot(p_window interval) TO anon, authenticated;

-- ── POSTCONDITION — anon has EXECUTE, and PUBLIC still has none. ──────────
DO $postconditions$
DECLARE
  s     text;
  o     oid;
  pub_n int;
  n     int := 0;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    '_ensure_stats_row(uid uuid)',
    '_gen_competition_order_no()',
    'apply_decision_to_remaining(_competition_id uuid, _round_number integer, _decision text)',
    'delete_email(queue_name text, message_id bigint)',
    'emit_birthday_notifications()',
    'enqueue_post_job(_payload jsonb)',
    'expiring_post_drafts()',
    'get_derived_status_drift_admin()',
    'judge_apply_single_tag(_entry_id uuid, _photo_index integer, _round_number integer, _tag_id uuid, _judge_id uuid)',
    'judging_write_decision_atomic(p_entry_id uuid, p_stage_key text, p_current_round text)',
    'log_push_outcome(_user_id uuid, _notification_id uuid, _type text, _outcome text, _detail text)',
    'pj_handle_comment_notification(_msg jsonb)',
    'pj_handle_reaction_notification(_msg jsonb)',
    'pj_handle_recount_engagement(_msg jsonb)',
    'pj_handle_tag_notification(_msg jsonb)',
    'process_post_jobs(_batch integer)',
    'prune_activity_minutes(_dry_run boolean)',
    'prune_client_errors(_days integer)',
    'prune_old_notifications(_days integer, _max_rows integer)',
    'reap_post_drafts(_ids uuid[])',
    'recompute_entry_from_tag_assignments(p_entry_id uuid)',
    'recompute_entry_public_status(p_entry_id uuid)',
    'recount_hashtags(tag_ids uuid[])',
    'refresh_viewer_buckets()',
    'rollup_engagement_daily(_utc_date date)',
    'set_write_path(p text)',
    'wallet_ledger_v2_diff_snapshot(p_window interval)']
  LOOP
    n := n + 1;
    SELECT p.oid INTO o
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = s;

    IF NOT has_function_privilege('anon', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0034-RB-POST-001: anon did not regain EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_function_privilege('authenticated', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0034-RB-POST-002: authenticated did not regain EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;

    SELECT count(*) INTO pub_n FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid = o AND a.grantee = 0;
    IF pub_n <> 0 THEN
      RAISE EXCEPTION
        'P32-0034-RB-POST-003: % acquired a PUBLIC ACL entry. This file grants by '
        'name and must never grant to PUBLIC', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_function_privilege('service_role', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0034-RB-POST-004: service_role lost EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 27 THEN
    RAISE EXCEPTION 'P32-0034-RB-POST-005: expected 27 functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
