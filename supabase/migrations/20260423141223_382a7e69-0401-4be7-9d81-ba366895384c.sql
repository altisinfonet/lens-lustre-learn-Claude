-- Loop B — SOW §5.1 Privacy Gate columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS indexing_disabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS indexing_disabled boolean NOT NULL DEFAULT false;

-- Partial indexes — most rows will be FALSE (default), so we only index the opt-outs
-- for fast filtering in seo-route-metadata + sitemap functions.
CREATE INDEX IF NOT EXISTS idx_profiles_indexing_disabled
  ON public.profiles (indexing_disabled)
  WHERE indexing_disabled = true;

CREATE INDEX IF NOT EXISTS idx_posts_indexing_disabled
  ON public.posts (indexing_disabled)
  WHERE indexing_disabled = true;

COMMENT ON COLUMN public.profiles.indexing_disabled IS
  'SOW §5: when true, seo-route-metadata returns noindex,nofollow and sitemap functions exclude this profile.';

COMMENT ON COLUMN public.posts.indexing_disabled IS
  'SOW §5: when true, seo-route-metadata returns noindex,nofollow and sitemap functions exclude this post.';