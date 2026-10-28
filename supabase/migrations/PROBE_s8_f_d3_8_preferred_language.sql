-- PROBE · S8 / F-D3-8 · profiles.preferred_language is a code or NULL.
-- Read-only. Names and counts only. FAIL before 20261029_0201, PASS after.
BEGIN READ ONLY;

WITH col AS (
  SELECT is_nullable, column_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'preferred_language'
),
bad_profiles AS (
  SELECT count(*) AS n FROM public.profiles
   WHERE preferred_language IS NOT NULL
     AND preferred_language NOT IN ('en', 'hi', 'bn', 'mr', 'gu', 'ta', 'te')
),
checks(name, ok, detail) AS (
  VALUES
  ('profiles.preferred_language default is NULL',
     coalesce((SELECT column_default IS NULL OR column_default ILIKE 'NULL%' FROM col), false),
     coalesce((SELECT coalesce(column_default, 'NULL') FROM col), '(no column)')),
  ('profiles.preferred_language is nullable',
     coalesce((SELECT is_nullable = 'YES' FROM col), false),
     coalesce((SELECT is_nullable FROM col), '(no column)')),
  ('CHECK profiles_preferred_language_code_chk present and validated',
     EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.profiles'::regclass
                AND conname = 'profiles_preferred_language_code_chk'
                AND contype = 'c' AND convalidated),
     ''),
  ('profiles rows holding a non-code value',
     (SELECT n = 0 FROM bad_profiles),
     (SELECT n::text FROM bad_profiles)),
  ('profiles_public_data rows holding a non-code value (copy has no CHECK)',
     NOT EXISTS (SELECT 1 FROM public.profiles_public_data
                  WHERE preferred_language IS NOT NULL
                    AND preferred_language NOT IN ('en', 'hi', 'bn', 'mr', 'gu', 'ta', 'te')),
     '')
)
SELECT name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, detail FROM checks
UNION ALL
SELECT 'OVERALL', CASE WHEN bool_and(ok) THEN 'PASS' ELSE 'FAIL' END, '' FROM checks;

ROLLBACK;
