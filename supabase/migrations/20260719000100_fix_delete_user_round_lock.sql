-- Fix: account deletion blocked by enforce_round_lock on completed rounds.
-- Two SECURITY DEFINER functions each set the trigger's sanctioned bypass flag
-- (app.bypass_round_lock='on', transaction-local) so a full account deletion can
-- remove the user's judging rows. Round-lock protection is unchanged for all
-- normal judging paths (the flag is only ever set inside these two deletion RPCs).

CREATE OR REPLACE FUNCTION public.admin_delete_auth_user(_uid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'admin_delete_auth_user: _uid required';
  END IF;
  -- Account deletion is a trusted internal operation: allow the cascade to remove
  -- this user's judging rows even for rounds locked as 'completed'
  -- (enforce_round_lock). Transaction-local; does not leak beyond this delete.
  PERFORM set_config('app.bypass_round_lock', 'on', true);
  -- clear the one FK to auth.users that is NO ACTION (would block the delete)
  UPDATE public.role_applications SET reviewed_by = NULL WHERE reviewed_by = _uid;
  DELETE FROM auth.users WHERE id = _uid;
  RETURN FOUND;  -- true if a row was deleted
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_purge_orphan_user_data(_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _c jsonb := '{}'::jsonb;
  _n integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'admin_purge_orphan_user_data: _uid is required';
  END IF;

  -- Same trusted-deletion bypass as admin_delete_auth_user: the judge_* deletes
  -- below would otherwise be blocked by enforce_round_lock for completed rounds.
  PERFORM set_config('app.bypass_round_lock', 'on', true);

  DELETE FROM public.ad_conversions           WHERE user_id = _uid;            GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('ad_conversions', _n);
  DELETE FROM public.ai_chat_usage            WHERE user_id = _uid;            GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('ai_chat_usage', _n);
  DELETE FROM public.auth_login_attempts      WHERE user_id = _uid;            GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('auth_login_attempts', _n);
  DELETE FROM public.feed_events              WHERE user_id = _uid OR author_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('feed_events', _n);
  DELETE FROM public.raw_commitments          WHERE user_id = _uid;            GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('raw_commitments', _n);
  DELETE FROM public.custom_url_history       WHERE user_id = _uid;            GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('custom_url_history', _n);
  DELETE FROM public.held_result_notifications WHERE recipient_user_id = _uid; GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('held_result_notifications', _n);
  DELETE FROM public.notification_emit_log    WHERE recipient_user_id = _uid;  GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('notification_emit_log', _n);
  DELETE FROM public.post_tags                WHERE tagged_user_id = _uid;     GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('post_tags', _n);

  -- Judge working-state + audit rows (consistent with existing judge_scores/
  -- judge_comments/judge_tag_assignments deletion in delete-user).
  DELETE FROM public.judge_decisions          WHERE judge_id = _uid;           GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('judge_decisions', _n);
  DELETE FROM public.judge_award_tags         WHERE judge_id = _uid;           GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('judge_award_tags', _n);
  DELETE FROM public.judge_activity_logs      WHERE judge_id = _uid;           GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('judge_activity_logs', _n);
  DELETE FROM public.judge_entry_assignments  WHERE judge_id = _uid;           GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('judge_entry_assignments', _n);
  DELETE FROM public.judge_entry_locks        WHERE judge_id = _uid;           GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('judge_entry_locks', _n);
  DELETE FROM public.judge_sessions           WHERE judge_id = _uid;           GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('judge_sessions', _n);
  -- judge_id has no FK to the user (no cascade), and is round-lock protected:
  -- purge here with the bypass active so completed-round judges can be deleted.
  DELETE FROM public.judge_comments           WHERE judge_id = _uid;           GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('judge_comments', _n);
  DELETE FROM public.judge_tag_assignments    WHERE judge_id = _uid;           GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('judge_tag_assignments', _n);

  -- Strip the deleted user from OTHER users' scheduled-post tag arrays (keep the post).
  UPDATE public.scheduled_posts
     SET tagged_user_ids = array_remove(tagged_user_ids, _uid)
   WHERE _uid = ANY(tagged_user_ids);
  GET DIAGNOSTICS _n = ROW_COUNT; _c := _c || jsonb_build_object('scheduled_posts_tag_stripped', _n);

  RETURN _c;
END;
$function$;
