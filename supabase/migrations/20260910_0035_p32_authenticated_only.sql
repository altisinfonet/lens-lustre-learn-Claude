-- ═══════════════════════════════════════════════════════════════════════════
-- P32 · TWENTY-FIVE FUNCTIONS THAT A SIGNED-IN SESSION CALLS.
--
-- Ordinal 20260910_0035. One of the two units that close the P32 gate on
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
-- Each of these twenty-five is called by a signed-in screen, or by a SECURITY
-- INVOKER function or trigger that fires inside a signed-in session. `anon`
-- and PUBLIC go; `authenticated` stays, and is granted EXPLICITLY rather than
-- left in place by omission.
--
-- TWO OF THEM HAVE NO CLIENT CALLER AT ALL and are here for the invoker
-- reason alone: admin_rewind_stage (guard_stage_key_immutability) and
-- mark_expiring_post_drafts (enforce_post_draft_rules). A SECURITY INVOKER
-- trigger runs with the privileges of whoever caused the write, so revoking
-- `authenticated` from these two would break an ordinary signed-in UPDATE.
-- They are the only two SECURITY INVOKER edges in the whole catalogue for
-- these 52 functions; every other database caller is SECURITY DEFINER.
--
-- ── SIGNATURES ────────────────────────────────────────────────────────────
--
-- Not typed. Taken from pg_get_function_identity_arguments on staging,
-- transcribed into docs/evidence/d1/phase1/P32-0035-signatures-20260925.tsv, and
-- verified against the live catalogue by md5 of the sorted 52-signature list:
-- fb5307b3f330bda424d86d333fd5cab3, identical on both sides. This file is
-- generated from that TSV by P32-0035-generate.py; it is not hand-written.
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
      RAISE EXCEPTION 'P32-0035-PRE-001: public.% does not exist with that exact signature', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = o) THEN
      RAISE EXCEPTION 'P32-0035-PRE-002: public.% is not SECURITY DEFINER', s
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 25 THEN
    RAISE EXCEPTION 'P32-0035-PRE-003: expected 25 functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── THE REVOCATION AND THE EXPLICIT RETENTION ─────────────────────────────
-- Two statements per function: REVOKE names PUBLIC first (F-62), then GRANT
-- states the end position rather than leaving it to omission.

REVOKE ALL ON FUNCTION public.acquire_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acquire_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_flag_entry_for_review(_entry_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_flag_entry_for_review(_entry_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_rewind_stage(_entry_id uuid, _to_stage_key text, _reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rewind_stage(_entry_id uuid, _to_stage_key text, _reason text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_set_photo_rejected(_entry_id uuid, _photo_index integer, _rejected boolean, _reason text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_photo_rejected(_entry_id uuid, _photo_index integer, _rejected boolean, _reason text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.backfill_judging_notifications(_window_days integer, _dry_run boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_judging_notifications(_window_days integer, _dry_run boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.backfill_tag_decision_drift_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.backfill_tag_decision_drift_admin() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_system_post(_content text, _image_url text, _image_urls text[], _thumbnail_urls text[], _media_ids uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_system_post(_content text, _image_url text, _image_urls text[], _thumbnail_urls text[], _media_ids uuid[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.enroll_in_course(_user_id uuid, _course_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enroll_in_course(_user_id uuid, _course_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fix_certificate_readiness_admin(_entry_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fix_certificate_readiness_admin(_entry_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fix_gift_drift_admin(_announcement_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fix_gift_drift_admin(_announcement_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fix_referral_drift_admin(_referral_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fix_referral_drift_admin(_referral_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_certificate_drift_admin(p_competition_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_certificate_drift_admin(p_competition_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_judge_collusion_admin(p_competition_id uuid, p_min_overlap integer, p_min_correlation numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_judge_collusion_admin(p_competition_id uuid, p_min_overlap integer, p_min_correlation numeric) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_judging_tag_assignment_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_judging_tag_assignment_counts() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.heartbeat_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.heartbeat_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.issue_course_completion_certificate(_course_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_course_completion_certificate(_course_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_expiring_post_drafts(_days integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_expiring_post_drafts(_days integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_activity_minute(_segment text, _interacted boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_activity_minute(_segment text, _interacted boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.register_push_token(_token text, _platform text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(_token text, _platform text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.release_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_competition_entry(_competition_id uuid, _title text, _description text, _photos text[], _photo_thumbnails text[], _photo_meta jsonb, _is_ai_generated boolean, _exif_data jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_competition_entry(_competition_id uuid, _title text, _description text, _photos text[], _photo_thumbnails text[], _photo_meta jsonb, _is_ai_generated boolean, _exif_data jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.unregister_push_token(_token text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(_token text) TO authenticated, service_role;

-- ── ONE COMMENT PER FUNCTION: its disposition and its caller class. ──────

COMMENT ON FUNCTION public.acquire_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: signed-in judge screen, src/hooks/judging/useJudgingLock.ts:83. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.admin_flag_entry_for_review(_entry_id uuid) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: admin/judge UI, src/components/judge/CinemaFullView.tsx:1747. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.admin_rewind_stage(_entry_id uuid, _to_stage_key text, _reason text) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: called by guard_stage_key_immutability, a SECURITY INVOKER trigger that fires as the session user. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.admin_set_photo_rejected(_entry_id uuid, _photo_index integer, _rejected boolean, _reason text) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: admin UI, src/modules/admin/EntriesModule.tsx:27. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.backfill_judging_notifications(_window_days integer, _dry_run boolean) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: admin UI, src/components/admin/NotificationsHealthAudit.tsx:57. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.backfill_tag_decision_drift_admin() IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: admin UI, src/components/admin/JudgingInvariantsAudit.tsx:152. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.create_system_post(_content text, _image_url text, _image_urls text[], _thumbnail_urls text[], _media_ids uuid[]) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: signed-in member screens, src/lib/profilePostHelper.ts:41 and src/pages/MyPhotos.tsx:409. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.enroll_in_course(_user_id uuid, _course_id uuid) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: signed-in member screen, src/pages/CourseDetail.tsx:61. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.fix_certificate_readiness_admin(_entry_id uuid) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: admin UI, src/components/admin/AwardsIntegrityAudit.tsx:72. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.fix_gift_drift_admin(_announcement_id uuid) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: admin UI, src/components/admin/WalletReconciliationAudit.tsx:72. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.fix_referral_drift_admin(_referral_id uuid) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: admin UI, src/components/admin/WalletReconciliationAudit.tsx:90. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: signed-in feed, src/hooks/feed/useFeedQuery.ts:91; /feed redirects signed-out visitors (Feed.tsx:89, pinned by #287). NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: signed-in feed, src/hooks/feed/useFeedQuery.ts:91; /feed redirects signed-out visitors (Feed.tsx:89, pinned by #287). NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.get_broadcast_feed(_exclude_ids uuid[], _limit integer, _newest_first integer, _categories text[]) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: signed-in feed, src/hooks/feed/useFeedQuery.ts:91; /feed redirects signed-out visitors (Feed.tsx:89, pinned by #287). NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.get_certificate_drift_admin(p_competition_id uuid) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: admin UI, src/components/admin/CertificateDriftAudit.tsx:58. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.get_judge_collusion_admin(p_competition_id uuid, p_min_overlap integer, p_min_correlation numeric) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: admin UI, src/components/admin/CollusionAudit.tsx:46. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.get_judging_tag_assignment_counts() IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: admin UI, src/pages/admin/AdminTagSemanticsAudit.tsx:95. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.heartbeat_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid, _ttl_minutes integer) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: signed-in judge screen, src/hooks/judging/useJudgingLock.ts:119. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.issue_course_completion_certificate(_course_id uuid) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: signed-in member screen, src/pages/CourseDetail.tsx:85. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.mark_expiring_post_drafts(_days integer) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: called by enforce_post_draft_rules, a SECURITY INVOKER trigger that fires as the session user; also the cron job mark-expiring-post-drafts. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.record_activity_minute(_segment text, _interacted boolean) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: the engagement heartbeat, src/lib/engagement/activityPing.ts:125, which returns early when there is no user. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.register_push_token(_token text, _platform text) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: signed-in native session, src/lib/native/push.ts:83 and :93. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.release_judge_lock(_entry_id uuid, _photo_index integer, _judge_id uuid) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: signed-in judge screen, src/hooks/judging/useJudgingLock.ts:69, :175, :231; the release sends the judge JWT since #284. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.submit_competition_entry(_competition_id uuid, _title text, _description text, _photos text[], _photo_thumbnails text[], _photo_meta jsonb, _is_ai_generated boolean, _exif_data jsonb) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: signed-in member screen, src/hooks/competition/useCompetitionEntryMutations.ts:35. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

COMMENT ON FUNCTION public.unregister_push_token(_token text) IS
  'P32 0035: signed-in callers keep EXECUTE; anon and PUBLIC do not. Caller class: signed-in native session, src/lib/native/push.ts:134. NOT executable by anon or public. PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). DROP+CREATE reopens it to PUBLIC (F-66).';

-- ── POSTCONDITION ─────────────────────────────────────────────────────────
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

    IF has_function_privilege('anon', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0035-POST-001: anon still holds EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;

    -- grantee 0 is the PUBLIC pseudo-role, read through aclexplode rather than
    -- by looking for a leading '=' in the rendered text.
    SELECT count(*) INTO pub_n FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid = o AND a.grantee = 0;
    IF pub_n <> 0 THEN
      RAISE EXCEPTION 'P32-0035-POST-002: % still has % PUBLIC ACL entr(y/ies)', s, pub_n
        USING ERRCODE = 'raise_exception';
    END IF;

    IF has_function_privilege('authenticated', o, 'EXECUTE') <> true THEN
      RAISE EXCEPTION 'P32-0035-POST-003: authenticated MUST hold EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_function_privilege('service_role', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-0035-POST-004: service_role lost EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> 25 THEN
    RAISE EXCEPTION 'P32-0035-POST-005: expected 25 functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
