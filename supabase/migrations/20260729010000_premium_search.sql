-- Premium search upgrade (owner request 2026-07-29):
--  1. global_search() RPC — ONE round trip instead of 6 client queries, with
--     typo tolerance (pg_trgm similarity) and relevance ranking
--     (exact > prefix > word-start > fuzzy; people also by followers).
--  2. search_recents table — recent searches follow the member's ACCOUNT
--     across devices (like preferred_language), not just one browser.
--
-- SECURITY: global_search is SECURITY DEFINER (needs cross-table joins fast),
-- so it hand-enforces the public-visibility rules: non-suspended profiles,
-- public-safe columns only, published courses/articles, public posts only.

CREATE OR REPLACE FUNCTION public.global_search(
  term text,
  section text DEFAULT 'all',
  username_only boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  q text := lower(trim(term));
  pat text;
  result jsonb := '{}'::jsonb;
BEGIN
  IF q IS NULL OR length(q) < 1 THEN
    RETURN '{}'::jsonb;
  END IF;
  q := left(q, 80);
  pat := '%' || q || '%';

  IF section IN ('all', 'person') THEN
    result := result || jsonb_build_object('people', COALESCE((
      SELECT jsonb_agg(to_jsonb(t)) FROM (
        SELECT p.id, p.full_name, p.avatar_url, p.custom_url,
               COALESCE(ps.followers_count, 0) AS followers_count,
               (CASE
                  WHEN lower(coalesce(p.custom_url, '')) = q
                    OR (NOT username_only AND lower(coalesce(p.full_name, '')) = q) THEN 3
                  WHEN lower(coalesce(p.custom_url, '')) LIKE q || '%'
                    OR (NOT username_only AND lower(coalesce(p.full_name, '')) LIKE q || '%') THEN 2
                  WHEN NOT username_only AND lower(coalesce(p.full_name, '')) LIKE '% ' || q || '%' THEN 1.5
                  ELSE greatest(
                    similarity(lower(coalesce(p.custom_url, '')), q),
                    CASE WHEN username_only THEN 0
                         ELSE similarity(lower(coalesce(p.full_name, '')), q) END)
                END)::float AS score
        FROM public.profiles_public_data p
        LEFT JOIN public.profile_stats ps ON ps.user_id = p.id
        WHERE p.is_suspended = false
          AND (
            (username_only AND (p.custom_url ILIKE pat
              OR similarity(lower(coalesce(p.custom_url, '')), q) > 0.3))
            OR
            (NOT username_only AND (p.full_name ILIKE pat OR p.custom_url ILIKE pat
              OR similarity(lower(coalesce(p.full_name, '')), q) > 0.3
              OR similarity(lower(coalesce(p.custom_url, '')), q) > 0.3))
          )
        ORDER BY score DESC, COALESCE(ps.followers_count, 0) DESC, p.full_name
        LIMIT CASE WHEN section = 'person' THEN 15 ELSE 8 END
      ) t), '[]'::jsonb));
  END IF;

  IF section IN ('all', 'competition') AND NOT username_only THEN
    result := result || jsonb_build_object('competitions', COALESCE((
      SELECT jsonb_agg(to_jsonb(t)) FROM (
        SELECT c.id, c.title, c.category, c.status, c.starts_at,
               (CASE
                  WHEN lower(c.title) = q THEN 3
                  WHEN lower(c.title) LIKE q || '%' THEN 2
                  WHEN lower(c.title) LIKE '% ' || q || '%' THEN 1.5
                  ELSE similarity(lower(c.title), q)
                END)::float AS score
        FROM public.competitions c
        WHERE c.title ILIKE pat OR similarity(lower(c.title), q) > 0.3
        ORDER BY score DESC, c.starts_at DESC NULLS LAST
        LIMIT 8
      ) t), '[]'::jsonb));
  END IF;

  IF section IN ('all', 'course') AND NOT username_only THEN
    result := result || jsonb_build_object('courses', COALESCE((
      SELECT jsonb_agg(to_jsonb(t)) FROM (
        SELECT c.id, c.title, c.slug, c.category, c.difficulty, c.published_at,
               (CASE
                  WHEN lower(c.title) = q THEN 3
                  WHEN lower(c.title) LIKE q || '%' THEN 2
                  WHEN lower(c.title) LIKE '% ' || q || '%' THEN 1.5
                  ELSE similarity(lower(c.title), q)
                END)::float AS score
        FROM public.courses c
        WHERE c.status = 'published'
          AND (c.title ILIKE pat OR similarity(lower(c.title), q) > 0.3)
        ORDER BY score DESC, c.published_at DESC NULLS LAST
        LIMIT 8
      ) t), '[]'::jsonb));
  END IF;

  IF section IN ('all', 'article') AND NOT username_only THEN
    result := result || jsonb_build_object('articles', COALESCE((
      SELECT jsonb_agg(to_jsonb(t)) FROM (
        SELECT a.id, a.title, a.slug, left(coalesce(a.excerpt, ''), 80) AS excerpt, a.published_at,
               (CASE
                  WHEN lower(a.title) = q THEN 3
                  WHEN lower(a.title) LIKE q || '%' THEN 2
                  WHEN lower(a.title) LIKE '% ' || q || '%' THEN 1.5
                  ELSE similarity(lower(a.title), q)
                END)::float AS score
        FROM public.journal_articles a
        WHERE a.status = 'published'
          AND (a.title ILIKE pat OR similarity(lower(a.title), q) > 0.3)
        ORDER BY score DESC, a.published_at DESC NULLS LAST
        LIMIT 8
      ) t), '[]'::jsonb));
  END IF;

  IF section IN ('all', 'post') AND NOT username_only THEN
    result := result || jsonb_build_object('posts', COALESCE((
      SELECT jsonb_agg(to_jsonb(t)) FROM (
        SELECT p.id, left(coalesce(p.content, ''), 80) AS content, p.user_id, p.created_at
        FROM public.posts p
        WHERE p.privacy = 'public' AND p.content ILIKE pat
        ORDER BY p.created_at DESC
        LIMIT 8
      ) t), '[]'::jsonb));
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.global_search(text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.global_search(text, text, boolean) TO anon, authenticated;

-- ---- Account-synced recent searches --------------------------------------
CREATE TABLE IF NOT EXISTS public.search_recents (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  item_id text NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  avatar_url text,
  handle text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_type, item_id)
);

ALTER TABLE public.search_recents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own recents read" ON public.search_recents;
CREATE POLICY "Own recents read" ON public.search_recents
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Own recents write" ON public.search_recents;
CREATE POLICY "Own recents write" ON public.search_recents
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Own recents update" ON public.search_recents;
CREATE POLICY "Own recents update" ON public.search_recents
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Own recents delete" ON public.search_recents;
CREATE POLICY "Own recents delete" ON public.search_recents
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_recents TO authenticated;

CREATE INDEX IF NOT EXISTS idx_search_recents_user_time
  ON public.search_recents (user_id, updated_at DESC);
