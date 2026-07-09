-- GIN trigram indexes for fast ILIKE search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_profiles_full_name_trgm
  ON public.profiles USING gin (full_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_profiles_public_full_name_trgm
  ON public.profiles_public_data USING gin (full_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_posts_content_trgm
  ON public.posts USING gin (content gin_trgm_ops);