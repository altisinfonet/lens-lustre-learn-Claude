-- S8 / F-D3-8 · profiles.preferred_language holds a language CODE or NULL.
--
-- Finding (docs/evidence/d2/phase5/P24/DECISION.md §5): the column is free
-- text, NOT NULL DEFAULT 'English' (20260226154352) — a label, not one of the
-- 7 codes the app knows (src/i18n/translations.ts: en hi bn mr gu ta te). The
-- client ignores any value that is not a code (LanguageAccountSync isLang),
-- so a label behaves exactly like NULL today. This makes the data say so:
--
--   1. DEFAULT NULL, DROP NOT NULL (metadata only; no row rewrite).
--   2. Every non-code value -> NULL, in profiles AND in its public copy
--      profiles_public_data. Behaviour is unchanged by construction: the
--      client already treated those rows as "no preference". Labels are NOT
--      mapped to codes ('English' -> 'en' would START overriding a member's
--      device language at login).
--      The UPDATE runs with session_replication_role = replica for that one
--      statement pair, so none of the ~13 user triggers on profiles fire
--      (newsletter auto-subscribe, name validation, custom_url guards, the
--      public-copy sync). The public copy is updated directly instead.
--   3. CHECK (NULL or one of the 7 codes), validated.
--
-- Writers today: LanguageAccountSync and OnboardingModal write a code only.
-- Fails safe: if this role may not set session_replication_role, the whole
-- transaction aborts and nothing changes.
-- Rollback: supabase/rollback/20261029_0201_f_d3_8_preferred_language_code_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_s8_f_d3_8_preferred_language.sql
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane reads %. Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'profiles'
                    AND column_name = 'preferred_language') THEN
    RAISE EXCEPTION 'F-D3-8-PRE-001: public.profiles.preferred_language does not exist on this lane'
      USING ERRCODE = 'raise_exception';
  END IF;
END
$pre$;

ALTER TABLE public.profiles
  ALTER COLUMN preferred_language DROP NOT NULL,
  ALTER COLUMN preferred_language SET DEFAULT NULL;

SET LOCAL session_replication_role = replica;

UPDATE public.profiles
   SET preferred_language = NULL
 WHERE preferred_language IS NOT NULL
   AND preferred_language NOT IN ('en', 'hi', 'bn', 'mr', 'gu', 'ta', 'te');

DO $copy$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'profiles_public_data'
                AND column_name = 'preferred_language') THEN
    UPDATE public.profiles_public_data
       SET preferred_language = NULL
     WHERE preferred_language IS NOT NULL
       AND preferred_language NOT IN ('en', 'hi', 'bn', 'mr', 'gu', 'ta', 'te');
  END IF;
END
$copy$;

SET LOCAL session_replication_role = origin;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_preferred_language_code_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_language_code_chk
  CHECK (preferred_language IS NULL
         OR preferred_language IN ('en', 'hi', 'bn', 'mr', 'gu', 'ta', 'te'));

COMMIT;
