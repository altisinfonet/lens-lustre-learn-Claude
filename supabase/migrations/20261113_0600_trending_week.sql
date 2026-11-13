-- ═══════════════════════════════════════════════════════════════════════════
-- 20261113_0600 · TRENDING THIS WEEK — one answer from the database
--
-- Owner 13 Nov 2026: "Trending This Week … Admin [can mark] from Admin Post
-- only one video as Mark As Trending this week … it will play there auto loop
-- … no video marked then at least 4 images will show, no three or two images
-- anymore … strong backend plan, not patch work".
--
-- Before: the dashboard-init edge function pulled EVERY like of the week to
-- the server, counted them in JavaScript (a 1,000-row read limit could cut the
-- count short), took up to 4 per source and showed whatever came out — 0 to 12
-- tiles, 3 on the Owner's screen.
--
-- Now:
--   trending_week_video      — the admin's ONE marked video (history kept:
--                              a new mark ends the old one; a mark ends by itself
--                              after 7 days; clearing is recorded with who/when)
--   trending_video_set(post) — admins only; the post must be public with a ready
--                              video; returns 'ok' or the reason it was refused
--   trending_video_clear()   — admins only
--   get_trending_week()      — {video: {post_id, video_id, ends_at} | null,
--                               photos: EXACTLY 4 or none}
--       photos = public photo posts, most liked this week first, then most
--       liked of the last 30 days, then most liked ever, newest first on ties;
--       never a post of a banned / suspended member or of someone the viewer
--       blocked or is blocked by. Fewer than 4 in the whole site → none (the
--       card never shows 2 or 3).
--
-- Rollback: supabase/rollback/20261113_0600_trending_week_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261113_0600_trending_week.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE public.trending_week_video (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  set_by      uuid NOT NULL,
  set_at      timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz NOT NULL DEFAULT now() + interval '7 days',
  cleared_at  timestamptz,
  cleared_by  uuid,
  CHECK (ends_at > set_at)
);
-- P28: at most ONE mark not cleared — the database, not the screen, keeps "only one video".
CREATE UNIQUE INDEX trending_week_video_one_open ON public.trending_week_video ((true)) WHERE cleared_at IS NULL;
-- P28: FK post_id → posts (ON DELETE CASCADE needs it); reviewed 2026-11-13.
CREATE INDEX trending_week_video_post ON public.trending_week_video (post_id);
ALTER TABLE public.trending_week_video ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trending_week_video FROM PUBLIC, anon, authenticated;

-- ── the admin's mark ───────────────────────────────────────────────────────
CREATE FUNCTION public.trending_video_set(_post_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path = ''
AS $fn$
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL OR NOT public.has_role(_me, 'admin'::text) THEN RETURN 'not_admin'; END IF;
  IF _post_id IS NULL THEN RETURN 'bad_request'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.posts p WHERE p.id = _post_id AND p.privacy = 'public') THEN
    RETURN 'post_not_public';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.post_videos pv JOIN public.videos v ON v.id = pv.video_id
                  WHERE pv.post_id = _post_id AND v.state = 'ready' AND v.deleted_at IS NULL) THEN
    RETURN 'no_ready_video';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('trending_week_video'));
  UPDATE public.trending_week_video SET cleared_at = now(), cleared_by = _me WHERE cleared_at IS NULL;
  INSERT INTO public.trending_week_video (post_id, set_by) VALUES (_post_id, _me);
  RETURN 'ok';
END;
$fn$;
REVOKE ALL ON FUNCTION public.trending_video_set(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trending_video_set(uuid) TO authenticated, service_role;

CREATE FUNCTION public.trending_video_clear()
 RETURNS text
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path = ''
AS $fn$
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL OR NOT public.has_role(_me, 'admin'::text) THEN RETURN 'not_admin'; END IF;
  UPDATE public.trending_week_video SET cleared_at = now(), cleared_by = _me WHERE cleared_at IS NULL;
  RETURN 'ok';
END;
$fn$;
REVOKE ALL ON FUNCTION public.trending_video_clear() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trending_video_clear() TO authenticated, service_role;

-- ── the card ───────────────────────────────────────────────────────────────
CREATE FUNCTION public.get_trending_week()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $fn$
  WITH me AS (SELECT auth.uid() AS uid),
  ok_post AS (
    SELECT po.id, po.content, po.created_at, po.likes_count,
           coalesce(po.image_urls[1], po.image_url) AS image_url,
           po.thumbnail_urls[1] AS thumb_url
      FROM public.posts po
      JOIN public.profiles pr ON pr.id = po.user_id
     WHERE po.privacy = 'public'
       AND coalesce(po.image_urls[1], po.image_url) IS NOT NULL
       AND coalesce(pr.is_banned, false) = false AND coalesce(pr.is_suspended, false) = false
       AND NOT EXISTS (SELECT 1 FROM public.user_blocks b, me
                        WHERE (b.blocker_id = me.uid AND b.blocked_id = po.user_id)
                           OR (b.blocker_id = po.user_id AND b.blocked_id = me.uid))
  ),
  week AS (
    SELECT x.post_id, count(*) AS n FROM public.post_reactions x
     WHERE x.created_at > now() - interval '7 days' GROUP BY x.post_id
  ),
  ranked AS (
    SELECT o.id, o.content, o.image_url, o.thumb_url, coalesce(w.n, 0) AS week_likes,
           row_number() OVER (ORDER BY
             (w.n IS NOT NULL) DESC, coalesce(w.n, 0) DESC,
             (o.created_at > now() - interval '30 days') DESC, o.likes_count DESC, o.created_at DESC) AS rk
      FROM ok_post o LEFT JOIN week w ON w.post_id = o.id
  ),
  four AS (SELECT * FROM ranked WHERE rk <= 4),
  pick AS (
    SELECT t.post_id, pv.video_id, t.ends_at
      FROM public.trending_week_video t
      JOIN public.posts po ON po.id = t.post_id AND po.privacy = 'public'
      JOIN public.post_videos pv ON pv.post_id = t.post_id
      JOIN public.videos v ON v.id = pv.video_id AND v.state = 'ready' AND v.deleted_at IS NULL
     WHERE t.cleared_at IS NULL AND t.ends_at > now()
     LIMIT 1
  )
  SELECT jsonb_build_object(
    'video', (SELECT jsonb_build_object('post_id', post_id, 'video_id', video_id, 'ends_at', ends_at) FROM pick),
    'photos', CASE WHEN (SELECT count(*) FROM four) = 4
                   THEN (SELECT jsonb_agg(jsonb_build_object(
                           'id', id, 'image_url', image_url, 'thumb_url', thumb_url,
                           'title', left(coalesce(nullif(btrim(content), ''), ''), 40),
                           'reaction_count', week_likes, 'source', 'post') ORDER BY rk) FROM four)
                   ELSE '[]'::jsonb END);
$fn$;
REVOKE ALL ON FUNCTION public.get_trending_week() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trending_week() TO authenticated, service_role;

COMMIT;
