-- Hashtag suggestions (owner report 2026-07-29 ~9:50 PM: "#50mmratina"
-- showed only the literal typed tag, no discovery of real existing tags).
-- global_search_hashtags(): distinct hashtags actually used in PUBLIC posts,
-- prefix-matched OR trigram-fuzzy (so the typo "#50mmratina" still surfaces
-- a real "#50mmretina" if it exists), with usage counts, most-used first.
CREATE OR REPLACE FUNCTION public.global_search_hashtags(term text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
    SELECT tag, count(*)::int AS uses
    FROM (
      SELECT lower(m[1]) AS tag
      FROM public.posts p,
           LATERAL regexp_matches(coalesce(p.content, ''), '#([A-Za-z0-9_]{2,40})', 'g') m
      WHERE p.privacy = 'public'
    ) tags
    WHERE lower(trim(term)) <> ''
      AND (
        tag LIKE lower(trim(term)) || '%'
        OR similarity(tag, lower(trim(term))) > 0.3
      )
    GROUP BY tag
    ORDER BY (tag LIKE lower(trim(term)) || '%') DESC, count(*) DESC, tag
    LIMIT 6
  ) t;
$$;

REVOKE ALL ON FUNCTION public.global_search_hashtags(text) FROM public;
GRANT EXECUTE ON FUNCTION public.global_search_hashtags(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
