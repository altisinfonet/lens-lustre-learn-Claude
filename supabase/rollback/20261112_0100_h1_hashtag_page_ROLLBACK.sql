-- ROLLBACK · 20261112_0100 H1 hashtag page.
-- Puts the hashtag store back to 20260817051750: ASCII-only tags, no 30-tag cap,
-- no post time on the junction, no follows. Members' follows ARE LOST (the table
-- is dropped). Tags that only exist in other scripts are removed with their
-- junction rows (cascade), then every count is recomputed from truth.
-- Clients with the H1 page show "No posts yet" until the old page is restored.
BEGIN;
DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted (read: %)', coalesce(current_setting('p32.lane', true), '(unset)');
  END IF;
END
$lane_assert$;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.hashtag_page_posts(text, text, text, integer);
DROP FUNCTION IF EXISTS public.hashtag_page_info(text);
DROP FUNCTION IF EXISTS public.follow_hashtag(text);
DROP FUNCTION IF EXISTS public.unfollow_hashtag(text);
DROP TABLE IF EXISTS public.hashtag_follows;

DROP TRIGGER IF EXISTS trg_post_hashtags_fill_post_time ON public.post_hashtags;
DROP FUNCTION IF EXISTS public.post_hashtags_fill_post_time();
DROP INDEX IF EXISTS public.idx_post_hashtags_tag_time;
ALTER TABLE public.post_hashtags DROP COLUMN IF EXISTS post_created_at;

CREATE OR REPLACE FUNCTION public.normalize_hashtag(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  select nullif(lower(regexp_replace(coalesce(raw, ''), '^#', '')), '');
$fn$;

CREATE OR REPLACE FUNCTION public.extract_hashtags(body text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  select coalesce(array_agg(distinct t), '{}')
  from (
    select public.normalize_hashtag(m[1]) as t
    from regexp_matches(coalesce(body, ''), '#([A-Za-z0-9_]{1,60})', 'g') as m
  ) s
  where t is not null;
$fn$;

GRANT EXECUTE ON FUNCTION public.normalize_hashtag(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.extract_hashtags(text) TO anon, authenticated, service_role;

ALTER TABLE public.hashtags DROP CONSTRAINT IF EXISTS hashtags_tag_shape;
DELETE FROM public.hashtags WHERE tag !~ '^[a-z0-9_]{1,60}$';
ALTER TABLE public.hashtags ADD CONSTRAINT hashtags_tag_shape CHECK (tag ~ '^[a-z0-9_]{1,60}$');

-- Posts that had more than 30 tags get the rest back.
INSERT INTO public.hashtags (tag, display_tag)
SELECT DISTINCT t.tag, t.tag
  FROM public.posts p CROSS JOIN LATERAL unnest(public.extract_hashtags(p.content)) AS t(tag)
 WHERE p.content LIKE '%#%'
ON CONFLICT (tag) DO NOTHING;
INSERT INTO public.post_hashtags (post_id, hashtag_id, author_id)
SELECT p.id, h.id, p.user_id
  FROM public.posts p CROSS JOIN LATERAL unnest(public.extract_hashtags(p.content)) AS t(tag)
  JOIN public.hashtags h ON h.tag = t.tag
 WHERE p.content LIKE '%#%'
ON CONFLICT (post_id, hashtag_id) DO NOTHING;

SELECT public.recount_hashtags(array(SELECT id FROM public.hashtags));
COMMIT;
