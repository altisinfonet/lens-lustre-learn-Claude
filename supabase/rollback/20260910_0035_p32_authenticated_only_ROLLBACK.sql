-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260910_0035_p32_authenticated_only.sql
-- Identical stem, as required. 25 objects.
--
-- ⚠ EXECUTING THIS FILE REOPENS anon EXECUTE ON 25 SECURITY DEFINER,
-- VOLATILE FUNCTIONS. Every one runs with its owner's rights, and `postgres`
-- on Supabase is BYPASSRLS, so the grant is the only control there is.
--
-- ── WHY THE APPLY IS TWO-LANE AND THIS FILE IS NOT ────────────────────────
--
-- 20260910_0035 closes a door, so its assertion accepts staging or production.
-- This file OPENS that door, so its guard accepts staging only and nothing
-- else. The two assertions are deliberately different and neither form should
-- be copied into the other.
--
-- ── WHAT IT RESTORES ──────────────────────────────────────────────────────
--
-- EXECUTE to anon, BY NAME, on the 25. NEVER `TO PUBLIC`: the
-- postcondition asserts zero PUBLIC ACL entries after the grant, which is what
-- catches a TO PUBLIC slip that "anon can execute" alone would not.
--
-- Does not touch service_role, postgres, any body, or any COMMENT.
--
-- ── IT REFUSES WHEN THERE IS NOTHING TO UNDO ──────────────────────────────
--
-- The precondition requires the post-0035 state. Run against the pre-apply
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
      'This rollback reopens anon EXECUTE on 25 SECURITY DEFINER functions. '
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
    'acquire_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer)',
    'admin_flag_entry_for_review(_entry_id uuid)',
    'admin_rewind_stage(_entry_id uuid, _to_stage_key text, _reason text)',
    'admin_set_photo_rejected(_entry_id uuid, _photo_index integer, _rejected boolean, _reason text)',
    'backfill_judging_notifications(_window_days integer, _dry_run boolean)',
    'backfill_tag_decision_drift_admin()',
    'create_system_post(_content text, _image_url text, _image_urls text[], _thumbnail_urls text[], _media_ids uuid[])',
    'enroll_in_course(_user_id uuid, _course_id uuid)',
    'fix_certificate_readiness_admin(_entry_id uuid)',
    'fix_gift_drift_admin(_announcement_id uuid)',
    'fix_referral_drift_admin(_referral_id uuid)',
    'get_broadcast_feed(_exclude_ids uuid[], _limit integer)',
    'get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer)',
    'get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[])',
    'get_certificate_drift_admin(p_competition_id uuid)',
    'get_judge_collusion_admin(p_competition_id uuid, p_min_overlap integer, p_min_correlation numeric)',
    'get_judging_tag_assignment_counts()',
    'heartbeat_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer)',
    'issue_course_completion_certificate(_course_id uuid)',
    'mark_expiring_post_drafts(_days integer)',
    'record_activity_minute(_segment text, _interacted boolean)',
    'register_push_token(_token text, _platform text)',
    'release_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid)',
    'submit_competition_entry(_competition_id uuid, _title text, _description text, _photos text[], _photo_thumbnails text[], _photo_meta jsonb, _is_ai_generated boolean, _exif_data jsonb)',
    'unregister_push_token(_token text)']
  LOOP
    n := n + 1;
    SELECT p.oid INTO o
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = s;
    IF o IS NULL THEN
      RAISE EXCEPTION 'P32-0035-RB-PRE-001: public.% does not exist with that exact signature', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF has_function_privilege('anon', o, 'EXECUTE') THEN
      RAISE EXCEPTION
        'P32-0035-RB-PRE-002: anon already holds EXECUTE on %, so 20260910_0035 is not in '
        'effect and there is nothing for this file to roll back', s
        USING ERRCODE = 'raise_exception';
    END IF;
    SELECT count(*) INTO pub_n FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid = o AND a.grantee = 0;
    IF pub_n <> 0 THEN
      RAISE EXCEPTION 'P32-0035-RB-PRE-003: % still has a PUBLIC ACL entry', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_function_privilege('service_role', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0035-RB-PRE-004: service_role is missing EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 25 THEN
    RAISE EXCEPTION 'P32-0035-RB-PRE-005: expected 25 functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── THE RESTORATION — by grantee name. Never TO PUBLIC. ───────────────────
GRANT EXECUTE ON FUNCTION public.acquire_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_flag_entry_for_review(_entry_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_rewind_stage(_entry_id uuid, _to_stage_key text, _reason text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_set_photo_rejected(_entry_id uuid, _photo_index integer, _rejected boolean, _reason text) TO anon;
GRANT EXECUTE ON FUNCTION public.backfill_judging_notifications(_window_days integer, _dry_run boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.backfill_tag_decision_drift_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.create_system_post(_content text, _image_url text, _image_urls text[], _thumbnail_urls text[], _media_ids uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.enroll_in_course(_user_id uuid, _course_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.fix_certificate_readiness_admin(_entry_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.fix_gift_drift_admin(_announcement_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.fix_referral_drift_admin(_referral_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[]) TO anon;
GRANT EXECUTE ON FUNCTION public.get_certificate_drift_admin(p_competition_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_judge_collusion_admin(p_competition_id uuid, p_min_overlap integer, p_min_correlation numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.get_judging_tag_assignment_counts() TO anon;
GRANT EXECUTE ON FUNCTION public.heartbeat_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer) TO anon;
GRANT EXECUTE ON FUNCTION public.issue_course_completion_certificate(_course_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.mark_expiring_post_drafts(_days integer) TO anon;
GRANT EXECUTE ON FUNCTION public.record_activity_minute(_segment text, _interacted boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(_token text, _platform text) TO anon;
GRANT EXECUTE ON FUNCTION public.release_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_competition_entry(_competition_id uuid, _title text, _description text, _photos text[], _photo_thumbnails text[], _photo_meta jsonb, _is_ai_generated boolean, _exif_data jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(_token text) TO anon;

-- ── POSTCONDITION — anon has EXECUTE, and PUBLIC still has none. ──────────
DO $postconditions$
DECLARE
  s     text;
  o     oid;
  pub_n int;
  n     int := 0;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    'acquire_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer)',
    'admin_flag_entry_for_review(_entry_id uuid)',
    'admin_rewind_stage(_entry_id uuid, _to_stage_key text, _reason text)',
    'admin_set_photo_rejected(_entry_id uuid, _photo_index integer, _rejected boolean, _reason text)',
    'backfill_judging_notifications(_window_days integer, _dry_run boolean)',
    'backfill_tag_decision_drift_admin()',
    'create_system_post(_content text, _image_url text, _image_urls text[], _thumbnail_urls text[], _media_ids uuid[])',
    'enroll_in_course(_user_id uuid, _course_id uuid)',
    'fix_certificate_readiness_admin(_entry_id uuid)',
    'fix_gift_drift_admin(_announcement_id uuid)',
    'fix_referral_drift_admin(_referral_id uuid)',
    'get_broadcast_feed(_exclude_ids uuid[], _limit integer)',
    'get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer)',
    'get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[])',
    'get_certificate_drift_admin(p_competition_id uuid)',
    'get_judge_collusion_admin(p_competition_id uuid, p_min_overlap integer, p_min_correlation numeric)',
    'get_judging_tag_assignment_counts()',
    'heartbeat_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer)',
    'issue_course_completion_certificate(_course_id uuid)',
    'mark_expiring_post_drafts(_days integer)',
    'record_activity_minute(_segment text, _interacted boolean)',
    'register_push_token(_token text, _platform text)',
    'release_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid)',
    'submit_competition_entry(_competition_id uuid, _title text, _description text, _photos text[], _photo_thumbnails text[], _photo_meta jsonb, _is_ai_generated boolean, _exif_data jsonb)',
    'unregister_push_token(_token text)']
  LOOP
    n := n + 1;
    SELECT p.oid INTO o
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = s;

    IF NOT has_function_privilege('anon', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0035-RB-POST-001: anon did not regain EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_function_privilege('authenticated', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0035-RB-POST-002: authenticated did not regain EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;

    SELECT count(*) INTO pub_n FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid = o AND a.grantee = 0;
    IF pub_n <> 0 THEN
      RAISE EXCEPTION
        'P32-0035-RB-POST-003: % acquired a PUBLIC ACL entry. This file grants by '
        'name and must never grant to PUBLIC', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_function_privilege('service_role', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0035-RB-POST-004: service_role lost EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 25 THEN
    RAISE EXCEPTION 'P32-0035-RB-POST-005: expected 25 functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
