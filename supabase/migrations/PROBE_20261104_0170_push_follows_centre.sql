-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261104_0170 push follows the centre. READ ONLY, ROLLBACK.
-- PASS = push_on_notification() is exactly the 0170 body (md5 2ee2553f…),
-- still SECURITY DEFINER with search_path=public, still the AFTER INSERT
-- trigger on user_notifications; its owner can run notification_centre_live;
-- the registry names the same push setting as the old rules for all 15
-- mapped types; and the lookup index exists.
-- FAILS before apply. Prints md5 + length only, never source.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE src text; h text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  SELECT prosrc INTO src FROM pg_proc WHERE oid = to_regprocedure('public.push_on_notification()');
  IF src IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: push_on_notification() missing';
  END IF;
  h := md5(src);
  IF h <> '2ee2553f2a53805249622d3c87ac2ad8' THEN
    RAISE EXCEPTION 'PROBE FAIL: push_on_notification() is not the 0170 body (md5 %, length %)', h, length(src);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.push_on_notification()') AND prosecdef
                  AND proconfig = ARRAY['search_path=public']) THEN
    RAISE EXCEPTION 'PROBE FAIL: push_on_notification() lost SECURITY DEFINER / search_path=public';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.user_notifications'::regclass AND NOT t.tgisinternal
                  AND t.tgfoid = to_regprocedure('public.push_on_notification()') AND t.tgenabled <> 'D') THEN
    RAISE EXCEPTION 'PROBE FAIL: push_on_notification() is not an enabled trigger on user_notifications';
  END IF;
  IF has_function_privilege('authenticated', 'public.push_on_notification()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.push_on_notification()', 'EXECUTE') THEN
    RAISE NOTICE 'NOTE: members hold EXECUTE on the trigger function (unchanged by 0170; a trigger function cannot be called directly)';
  END IF;
  -- the function's owner must be able to run the centre's switch check, or
  -- every live-group push would quietly fall back to the old rules
  IF NOT has_function_privilege((SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.push_on_notification()')),
                                'public.notification_centre_live(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL: the owner of push_on_notification() cannot execute notification_centre_live()';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES ('post_reaction','push_reactions'), ('image_reaction','push_reactions'),
                 ('post_comment','push_comments'), ('image_comment','push_comments'), ('comment_reply','push_comments'),
                 ('friend_request','push_friend_requests'), ('new_follower','push_new_followers'),
                 ('new_post_from_following','push_new_posts'),
                 ('competition_vote','push_competition_updates'), ('entry_approved','push_competition_updates'),
                 ('entry_rejected','push_competition_updates'), ('competition_winner','push_competition_updates'),
                 ('new_competition','push_competition_updates'),
                 ('journal_published','push_announcements'), ('course_published','push_announcements')) m(t, want)
              LEFT JOIN public.notification_types nt ON nt.type = m.t
             WHERE nt.pref_push IS DISTINCT FROM m.want) THEN
    RAISE EXCEPTION 'PROBE FAIL: a registry push setting differs from the old push rules (opt-out would be dropped)';
  END IF;
  IF to_regclass('public.notification_centre_log_notification_idx') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: lookup index notification_centre_log_notification_idx missing';
  END IF;
  RAISE NOTICE 'NC0170 PASS (lane %): push follows the centre for live groups; body md5 %, length %',
    current_setting('p32.lane'), h, length(src);
END
$p$;

ROLLBACK;
