-- PROBE (read-only) · S8 / F-P1-6 — is the old-build timer write ignored?
-- Prints check names and PASS/FAIL only. No member data.
-- FAILS before 20261029_0002, PASSES after.
BEGIN READ ONLY;

WITH checks(name, ok) AS (
  VALUES
  ('trigger trg_profiles_aa_ignore_client_presence_write enabled on profiles',
     EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass
              AND tgname = 'trg_profiles_aa_ignore_client_presence_write' AND tgenabled = 'O')),
  ('trigger function is SECURITY INVOKER (current_user = caller)',
     EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.tg_profiles_ignore_client_presence_write()')
              AND NOT prosecdef)),
  ('record_session_end and backfill_last_seen are SECURITY DEFINER (not blocked)',
     (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN ('record_session_end', 'backfill_last_seen') AND p.prosecdef) = 2)
)
SELECT name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks
UNION ALL
SELECT 'OVERALL', CASE WHEN bool_and(ok) THEN 'PASS' ELSE 'FAIL' END FROM checks;

ROLLBACK;
