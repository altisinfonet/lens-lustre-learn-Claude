-- Step Security Fix 2/3: Move pg_trgm out of the public schema.
--
-- Pre-flight inventory (just queried, locked in here for traceability):
--   • Extension: pg_trgm v1.6 in schema `public`.
--   • Dependent functions (move with extension automatically): show_trgm,
--     similarity, word_similarity (and operators).
--   • Dependent INDEXES (must be dropped + recreated because the operator
--     class `gin_trgm_ops` is schema-qualified once the extension moves):
--       - public.profiles.idx_profiles_full_name_trgm
--       - public.profiles_public_data.idx_profiles_public_full_name_trgm
--       - public.posts.idx_posts_content_trgm
--
-- Strategy:
--   1. Create dedicated `extensions` schema (Supabase-recommended location).
--   2. Drop the 3 GIN trgm indexes (briefly disables similarity-based search;
--      ILIKE/EXACT searches keep working).
--   3. ALTER EXTENSION pg_trgm SET SCHEMA extensions.
--   4. Recreate the 3 indexes using the qualified operator class
--      `extensions.gin_trgm_ops` so the planner can find them without
--      relying on search_path.
--   5. Append `extensions` to the database-wide search_path so existing
--      function calls like `similarity(a,b)` keep working unqualified.
--
-- Rollback path: ALTER EXTENSION pg_trgm SET SCHEMA public; recreate indexes
-- with `gin_trgm_ops`.

-- 1. Dedicated schema
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

-- 2. Drop dependent indexes (safe — they will be recreated below)
DROP INDEX IF EXISTS public.idx_profiles_full_name_trgm;
DROP INDEX IF EXISTS public.idx_profiles_public_full_name_trgm;
DROP INDEX IF EXISTS public.idx_posts_content_trgm;

-- 3. Move the extension
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- 4. Recreate the three indexes with fully-qualified operator class
CREATE INDEX idx_profiles_full_name_trgm
  ON public.profiles
  USING gin (full_name extensions.gin_trgm_ops);

CREATE INDEX idx_profiles_public_full_name_trgm
  ON public.profiles_public_data
  USING gin (full_name extensions.gin_trgm_ops);

CREATE INDEX idx_posts_content_trgm
  ON public.posts
  USING gin (content extensions.gin_trgm_ops);

-- 5. Make the extensions schema discoverable on the default search_path so
--    existing unqualified calls (similarity(a,b), a % b operator) keep
--    working for every role.
ALTER DATABASE postgres SET search_path TO "$user", public, extensions;