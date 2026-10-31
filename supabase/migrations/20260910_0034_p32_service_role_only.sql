-- ═══════════════════════════════════════════════════════════════════════════
-- P32 · TWENTY-SEVEN FUNCTIONS THAT NO CLIENT CALLS.
--
-- Ordinal 20260910_0034. One of the two units that close the P32 gate on
-- staging: 56 SECURITY DEFINER, VOLATILE, RPC-callable functions were
-- anon-executable on 2026-09-25; 0034 takes 27, 0035 takes 25, and the
-- remaining 4 are justified in writing in
-- docs/evidence/d1/phase1/p32-dispositions.md.
--
-- Every one of the 56 carried the identical ACL, measured SELECT-only:
--
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,
--    authenticated=X/postgres,service_role=X/postgres}
--
-- The leading `=X/postgres` is the PUBLIC grant. F-62: revoking anon alone
-- would be a no-op, because anon reaches EXECUTE through PUBLIC. Every REVOKE
-- below names PUBLIC first.
--
-- A SECURITY DEFINER function runs with its owner's rights, and `postgres` on
-- Supabase is BYPASSRLS, so a grant on one of these is not moderated by RLS.
-- The grant is the control.
--
-- None of these twenty-seven has a client caller. Their callers are cron jobs
-- (which run as postgres), SECURITY DEFINER functions (which run as the owner,
-- so the caller's own privileges are irrelevant), or edge functions holding a
-- SUPABASE_SERVICE_ROLE_KEY. `authenticated` is therefore revoked as well as
-- anon: a signed-in member has no more business calling these than a
-- logged-out visitor does.
--
-- THE `authenticated` REVOKE IS THE PART THAT NEEDS PROVING, and it is proved
-- on the fixture: a SECURITY DEFINER wrapper owned by postgres calls one of
-- these while the session is SET ROLE authenticated, and it succeeds. That is
-- why every DEFINER and trigger caller above keeps working.
--
-- ── SIGNATURES ────────────────────────────────────────────────────────────
--
-- Not typed. Taken from pg_get_function_identity_arguments on staging,
-- transcribed into docs/evidence/d1/phase1/P32-0034-signatures-20260925.tsv, and
-- verified against the live catalogue by md5 of the sorted 52-signature list:
-- fb5307b3f330bda424d86d333fd5cab3, identical on both sides. This file is
-- generated from that TSV by P32-0034-generate.py; it is not hand-written.
--
-- ── NOT TOUCHED ───────────────────────────────────────────────────────────
--
-- No function body. No policy. No pg_default_acl. `postgres` and
-- `service_role` keep what they had. The rollback ships in the same PR.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── LANE ASSERTION — TWO-LANE FORM, as in 0032 (proven on staging run #79).
-- This apply closes a door, so it is meant for both lanes. It is NOT the
-- staging-only R-9 guard. It still fails closed outside the dispatch
-- workflow, which since #293 is the only thing that sets p32.lane.
DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'This file is meant for both lanes, but it will not run outside the dispatch '
      'workflow, which is the only thing that sets the lane and sets it from the '
      'target you chose. '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

-- ── PRECONDITION — every signature exists and is SECURITY DEFINER. ────────
-- Resolved by matching proname || '(' || identity_arguments || ')', NOT by
-- to_regprocedure: the identity form carries parameter names and
-- to_regprocedure rejects it ("invalid type name"). Matching the rendered
-- identity string also distinguishes the three get_broadcast_feed overloads
-- exactly.
-- The ACL is deliberately NOT asserted: production is unmeasured, and this
-- file must be correct on both lanes.
DO $preconditions$
DECLARE
  s   text;
  o   oid;
  n   int := 0;
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
      RAISE EXCEPTION 'P32-0034-PRE-001: public.% does not exist with that exact signature', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = o) THEN
      RAISE EXCEPTION 'P32-0034-PRE-002: public.% is not SECURITY DEFINER', s
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 27 THEN
    RAISE EXCEPTION 'P32-0034-PRE-003: expected 27 functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── THE REVOCATION AND THE EXPLICIT RETENTION ─────────────────────────────
-- Two statements per function: REVOKE names PUBLIC first (F-62), then GRANT
-- states the end position rather than leaving it to omission.

REVOKE ALL ON FUNCTION public._ensure_stats_row(uid uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ensure_stats_row(uid uuid) TO service_role;

REVOKE ALL ON FUNCTION public._gen_competition_order_no() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._gen_competition_order_no() TO service_role;

REVOKE ALL ON FUNCTION public.apply_decision_to_remaining(_competition_id uuid, _round_number integer, _decision text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_decision_to_remaining(_competition_id uuid, _round_number integer, _decision text) TO service_role;

REVOKE ALL ON FUNCTION public.delete_email(queue_name text, message_id bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_email(queue_name text, message_id bigint) TO service_role;

REVOKE ALL ON FUNCTION public.emit_birthday_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emit_birthday_notifications() TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_post_job(_payload jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_post_job(_payload jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.expiring_post_drafts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expiring_post_drafts() TO service_role;

REVOKE ALL ON FUNCTION public.get_derived_status_drift_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_derived_status_drift_admin() TO service_role;

REVOKE ALL ON FUNCTION public.judge_apply_single_tag(_entry_id uuid, _photo_index integer, _round_number integer, _tag_id uuid, _judge_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.judge_apply_single_tag(_entry_id uuid, _photo_index integer, _round_number integer, _tag_id uuid, _judge_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.judging_write_decision_atomic(p_entry_id uuid, p_stage_key text, p_current_round text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.judging_write_decision_atomic(p_entry_id uuid, p_stage_key text, p_current_round text) TO service_role;

REVOKE ALL ON FUNCTION public.log_push_outcome(_user_id uuid, _notification_id uuid, _type text, _outcome text, _detail text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_push_outcome(_user_id uuid, _notification_id uuid, _type text, _outcome text, _detail text) TO service_role;

REVOKE ALL ON FUNCTION public.pj_handle_comment_notification(_msg jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pj_handle_comment_notification(_msg jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.pj_handle_reaction_notification(_msg jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pj_handle_reaction_notification(_msg jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.pj_handle_recount_engagement(_msg jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pj_handle_recount_engagement(_msg jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.pj_handle_tag_notification(_msg jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pj_handle_tag_notification(_msg jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.process_post_jobs(_batch integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_post_jobs(_batch integer) TO service_role;

REVOKE ALL ON FUNCTION public.prune_activity_minutes(_dry_run boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_activity_minutes(_dry_run boolean) TO service_role;

REVOKE ALL ON FUNCTION public.prune_client_errors(_days integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_client_errors(_days integer) TO service_role;

REVOKE ALL ON FUNCTION public.prune_old_notifications(_days integer, _max_rows integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_old_notifications(_days integer, _max_rows integer) TO service_role;

REVOKE ALL ON FUNCTION public.reap_post_drafts(_ids uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_post_drafts(_ids uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.recompute_entry_from_tag_assignments(p_entry_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_entry_from_tag_assignments(p_entry_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.recompute_entry_public_status(p_entry_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_entry_public_status(p_entry_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.recount_hashtags(tag_ids uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recount_hashtags(tag_ids uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.refresh_viewer_buckets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_viewer_buckets() TO service_role;

REVOKE ALL ON FUNCTION public.rollup_engagement_daily(_utc_date date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollup_engagement_daily(_utc_date date) TO service_role;

REVOKE ALL ON FUNCTION public.set_write_path(p text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_write_path(p text) TO service_role;

REVOKE ALL ON FUNCTION public.wallet_ledger_v2_diff_snapshot(p_window interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_ledger_v2_diff_snapshot(p_window interval) TO service_role;

-- ── ONE COMMENT PER FUNCTION: its disposition and its caller class. ──────

COMMENT ON FUNCTION public._ensure_stats_row(uid uuid) IS
  'P32 0034: no client caller; service_role only. Caller class: called only by the SECURITY DEFINER trigger functions trg_follows_counts and trg_friendships_counts. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public._gen_competition_order_no() IS
  'P32 0034: no client caller; service_role only. Caller class: called only by submit_competition_entry, which is SECURITY DEFINER. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.apply_decision_to_remaining(_competition_id uuid, _round_number integer, _decision text) IS
  'P32 0034: no client caller; service_role only. Caller class: no caller anywhere: not in the tree, not in pg_proc, not in cron. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.delete_email(queue_name text, message_id bigint) IS
  'P32 0034: no client caller; service_role only. Caller class: edge function process-email-queue, through a SUPABASE_SERVICE_ROLE_KEY client (index.ts:116). NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.emit_birthday_notifications() IS
  'P32 0034: no client caller; service_role only. Caller class: cron job emit-birthday-notifications, which runs as postgres. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.enqueue_post_job(_payload jsonb) IS
  'P32 0034: no client caller; service_role only. Caller class: called only by the SECURITY DEFINER trigger functions enqueue_post_created_job, notify_post_comment, notify_post_reaction, notify_post_tag. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.expiring_post_drafts() IS
  'P32 0034: no client caller; service_role only. Caller class: no caller anywhere: not in the tree, not in pg_proc, not in cron. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.get_derived_status_drift_admin() IS
  'P32 0034: no client caller; service_role only. Caller class: no caller anywhere: not in the tree, not in pg_proc, not in cron. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.judge_apply_single_tag(_entry_id uuid, _photo_index integer, _round_number integer, _tag_id uuid, _judge_id uuid) IS
  'P32 0034: no client caller; service_role only. Caller class: edge function submit-judge-tag, through the service-role client built in _shared/judgingAuth.ts:35. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.judging_write_decision_atomic(p_entry_id uuid, p_stage_key text, p_current_round text) IS
  'P32 0034: no client caller; service_role only. Caller class: edge function submit-judge-decision, through the service-role client built in _shared/judgingAuth.ts:35. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.log_push_outcome(_user_id uuid, _notification_id uuid, _type text, _outcome text, _detail text) IS
  'P32 0034: no client caller; service_role only. Caller class: no caller anywhere: not in the tree, not in pg_proc, not in cron. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.pj_handle_comment_notification(_msg jsonb) IS
  'P32 0034: no client caller; service_role only. Caller class: called only by process_post_jobs, which is SECURITY DEFINER. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.pj_handle_reaction_notification(_msg jsonb) IS
  'P32 0034: no client caller; service_role only. Caller class: called only by process_post_jobs, which is SECURITY DEFINER. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.pj_handle_recount_engagement(_msg jsonb) IS
  'P32 0034: no client caller; service_role only. Caller class: called only by process_post_jobs, which is SECURITY DEFINER. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.pj_handle_tag_notification(_msg jsonb) IS
  'P32 0034: no client caller; service_role only. Caller class: called only by process_post_jobs, which is SECURITY DEFINER. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.process_post_jobs(_batch integer) IS
  'P32 0034: no client caller; service_role only. Caller class: cron job process-post-jobs, which runs as postgres. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.prune_activity_minutes(_dry_run boolean) IS
  'P32 0034: no client caller; service_role only. Caller class: no caller anywhere: not in the tree, not in pg_proc, not in cron. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.prune_client_errors(_days integer) IS
  'P32 0034: no client caller; service_role only. Caller class: cron job prune-client-errors, which runs as postgres. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.prune_old_notifications(_days integer, _max_rows integer) IS
  'P32 0034: no client caller; service_role only. Caller class: cron job prune-old-notifications, which runs as postgres. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.reap_post_drafts(_ids uuid[]) IS
  'P32 0034: no client caller; service_role only. Caller class: no caller anywhere: not in the tree, not in pg_proc, not in cron. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.recompute_entry_from_tag_assignments(p_entry_id uuid) IS
  'P32 0034: no client caller; service_role only. Caller class: called only by the SECURITY DEFINER trigger function trg_recompute_entry_after_tag_change. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.recompute_entry_public_status(p_entry_id uuid) IS
  'P32 0034: no client caller; service_role only. Caller class: called only by the SECURITY DEFINER trigger functions _tg_entry_public_status_recompute, _tg_round_publish_recompute, _tg_v3_catalog_recompute, trg_recompute_entry_public_status. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.recount_hashtags(tag_ids uuid[]) IS
  'P32 0034: no client caller; service_role only. Caller class: called only by the SECURITY DEFINER trigger functions sync_post_hashtags and unsync_post_hashtags. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.refresh_viewer_buckets() IS
  'P32 0034: no client caller; service_role only. Caller class: no caller anywhere: not in the tree, not in pg_proc, not in cron. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.rollup_engagement_daily(_utc_date date) IS
  'P32 0034: no client caller; service_role only. Caller class: cron job rollup-engagement-daily, which runs as postgres. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.set_write_path(p text) IS
  'P32 0034: no client caller; service_role only. Caller class: no caller anywhere: not in the tree, not in pg_proc, not in cron. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.wallet_ledger_v2_diff_snapshot(p_window interval) IS
  'P32 0034: no client caller; service_role only. Caller class: cron job wallet_ledger_v2_diff_hourly, which runs as postgres. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

-- ── POSTCONDITION ─────────────────────────────────────────────────────────
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

    IF has_function_privilege('anon', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0034-POST-001: anon still holds EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;

    -- grantee 0 is the PUBLIC pseudo-role, read through aclexplode rather than
    -- by looking for a leading '=' in the rendered text.
    SELECT count(*) INTO pub_n FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid = o AND a.grantee = 0;
    IF pub_n <> 0 THEN
      RAISE EXCEPTION 'P32-0034-POST-002: % still has % PUBLIC ACL entr(y/ies)', s, pub_n
        USING ERRCODE = 'raise_exception';
    END IF;

    IF has_function_privilege('authenticated', o, 'EXECUTE') <> false THEN
      RAISE EXCEPTION 'P32-0034-POST-003: authenticated must NOT hold EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_function_privilege('service_role', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0034-POST-004: service_role lost EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 27 THEN
    RAISE EXCEPTION 'P32-0034-POST-005: expected 27 functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
