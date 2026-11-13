-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261113_0300 story row video cover. READ ONLY, ROLLBACK. FAILS before apply.
-- PASS = get_feed_stories_bar returns cover_video_id, keeps SECURITY DEFINER +
-- search_path='', members (authenticated) may call it and signed-out (anon)
-- may not, and every live video story's owner row (seen as another member)
-- names a video. Prints counts only.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE
  f regprocedure := to_regprocedure('public.get_feed_stories_bar()');
  _vid_owners integer;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF f IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f AND prosecdef AND proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'PROBE FAIL: get_feed_stories_bar missing or not SECURITY DEFINER / search_path=""';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f AND 'cover_video_id' = ANY (proargnames)) THEN
    RAISE EXCEPTION 'PROBE FAIL: get_feed_stories_bar has no cover_video_id (0300 not applied)';
  END IF;
  IF has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL: get_feed_stories_bar grants are wrong';
  END IF;
  -- The rows themselves: called with no member (auth.uid() NULL) every visible owner is listed.
  SELECT count(*) INTO _vid_owners FROM (
    SELECT DISTINCT s.user_id FROM public.stories s
      JOIN public.post_videos pv ON pv.post_id = s.post_id
     WHERE s.expires_at > now() AND public.story_visible(s.user_id, s.post_id)) x;
  IF (SELECT count(*) FROM public.get_feed_stories_bar() b WHERE b.cover_video_id IS NOT NULL) < _vid_owners THEN
    RAISE EXCEPTION 'PROBE FAIL: % owner(s) with a live video story, fewer rows name a video', _vid_owners;
  END IF;
  RAISE NOTICE 'SB0300 PASS (lane %): rows % ; rows with a video cover % ; owners with a live video story %',
    current_setting('p32.lane'), (SELECT count(*) FROM public.get_feed_stories_bar()),
    (SELECT count(*) FROM public.get_feed_stories_bar() b WHERE b.cover_video_id IS NOT NULL), _vid_owners;
END
$p$;

ROLLBACK;
