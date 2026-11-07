-- ═══════════════════════════════════════════════════════════════════════════
-- Stories v2.2 · 20261111_0101 — who saw my story; every comment on a story.
-- Lanes: staging and production. Expand only: two new functions, nothing
-- dropped or changed.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY (Owner, 7 Nov 2026, "go"): on his own story the eye showed "1" but
-- tapping it showed nobody — the owner wants to see WHO saw it. And with many
-- comments (his example: 700) only the newest ones floated on the story; he
-- wants to scroll through all of them.
--
-- OBJECTS
--   story_viewers(story, limit, before) — the story's OWNER only: everyone who
--     saw it (newest first), with name, face, handle, when, and whether they
--     liked it. Anyone else gets ST-0101-001. The owner's own views are never
--     recorded (the client does not mark them) and are excluded here anyway.
--     Paged: up to 200 a call, `before` = the oldest viewed_at already shown.
--   story_comments_page(story, limit, before) — the same comments and the same
--     visibility rule as story_comments_list (0100), a page of up to 100 OLDER
--     than `before` (NULL = the newest). Returned oldest → newest, so a page
--     is drawn top to bottom like the floating list.
--   story_comments_list (0100) stays as it is: old clients keep working.
--
-- RE-RUNNABLE: PRE-002 refuses once story_viewers exists.
-- ROLLBACK: supabase/rollback/20261111_0101_story_viewers_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261111_0101_story_viewers.sql (FAIL before, PASS after)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  -- PRE-001 · what this file builds on (0100 applied).
  IF to_regclass('public.stories') IS NULL OR to_regclass('public.story_views') IS NULL
     OR to_regclass('public.story_likes') IS NULL OR to_regclass('public.story_comments') IS NULL
     OR to_regclass('public.post_comments') IS NULL OR to_regclass('public.profiles_public_data') IS NULL
     OR to_regclass('public.highlight_items') IS NULL
     OR to_regprocedure('public.story_visible(uuid,uuid)') IS NULL
     OR to_regprocedure('public.story_comments_list(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'ST-0101-PRE-001: 20261111_0100 (stories v2) is not applied on this lane';
  END IF;
  -- PRE-002 · not twice.
  IF to_regprocedure('public.story_viewers(uuid,integer,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('public.story_comments_page(uuid,integer,timestamp with time zone)') IS NOT NULL THEN
    RAISE EXCEPTION 'ST-0101-PRE-002: already applied';
  END IF;
END
$pre$;

CREATE FUNCTION public.story_viewers(_story_id uuid, _limit integer DEFAULT 200, _before timestamptz DEFAULT NULL)
 RETURNS TABLE(viewer_id uuid, full_name text, avatar_url text, custom_url text, viewed_at timestamptz, liked boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $fn$
DECLARE
  _uid   uuid := auth.uid();
  _owner uuid;
BEGIN
  SELECT s.user_id INTO _owner FROM public.stories s WHERE s.id = _story_id;
  IF _uid IS NULL OR _owner IS NULL OR _owner <> _uid THEN
    RAISE EXCEPTION 'ST-0101-001: only the story''s owner can see who saw it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT v.viewer_id, pp.full_name, pp.avatar_url, pp.custom_url, v.viewed_at,
           EXISTS (SELECT 1 FROM public.story_likes l WHERE l.story_id = _story_id AND l.user_id = v.viewer_id)
      FROM public.story_views v
      LEFT JOIN public.profiles_public_data pp ON pp.id = v.viewer_id
     WHERE v.story_id = _story_id
       AND v.viewer_id <> _owner
       AND (_before IS NULL OR v.viewed_at < _before)
     ORDER BY v.viewed_at DESC
     LIMIT least(greatest(coalesce(_limit, 200), 1), 200);
END;
$fn$;
REVOKE ALL ON FUNCTION public.story_viewers(uuid, integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.story_viewers(uuid, integer, timestamptz) TO authenticated, service_role;

CREATE FUNCTION public.story_comments_page(_story_id uuid, _limit integer DEFAULT 50, _before timestamptz DEFAULT NULL)
 RETURNS TABLE(id uuid, user_id uuid, full_name text, avatar_url text, content text, created_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $fn$
  WITH s AS (
    SELECT st.id, st.post_id
      FROM public.stories st
     WHERE st.id = _story_id
       AND public.story_visible(st.user_id, st.post_id)
       AND (st.expires_at > now()
            OR EXISTS (SELECT 1 FROM public.highlight_items hi WHERE hi.story_id = st.id))
  ),
  c AS (
    SELECT pc.id, pc.user_id, pc.content, pc.created_at
      FROM s JOIN public.post_comments pc ON pc.post_id = s.post_id
     WHERE s.post_id IS NOT NULL
    UNION ALL
    SELECT sc.id, sc.user_id, sc.content, sc.created_at
      FROM s JOIN public.story_comments sc ON sc.story_id = s.id
     WHERE s.post_id IS NULL
  ),
  page AS (
    SELECT * FROM c
     WHERE _before IS NULL OR c.created_at < _before
     ORDER BY c.created_at DESC
     LIMIT least(greatest(coalesce(_limit, 50), 1), 100)
  )
  SELECT pg.id, pg.user_id, pp.full_name, pp.avatar_url, pg.content, pg.created_at
    FROM page pg
    LEFT JOIN public.profiles_public_data pp ON pp.id = pg.user_id
   ORDER BY pg.created_at ASC;
$fn$;
REVOKE ALL ON FUNCTION public.story_comments_page(uuid, integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.story_comments_page(uuid, integer, timestamptz) TO authenticated, service_role;

DO $post$
BEGIN
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.story_viewers(uuid,integer,timestamp with time zone)'::regprocedure)
     OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.story_comments_page(uuid,integer,timestamp with time zone)'::regprocedure) THEN
    RAISE EXCEPTION 'ST-0101-POST-001: a new function is not SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.story_viewers(uuid,integer,timestamp with time zone)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.story_comments_page(uuid,integer,timestamp with time zone)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.story_viewers(uuid,integer,timestamp with time zone)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.story_comments_page(uuid,integer,timestamp with time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ST-0101-POST-002: grants are not as intended';
  END IF;
  RAISE NOTICE 'ST-0101 applied on %: story_viewers + story_comments_page', current_setting('p32.lane', true);
END
$post$;

COMMIT;
