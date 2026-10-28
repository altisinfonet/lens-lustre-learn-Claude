-- PROBE (read-only) — S8 / F-REV4-2: are 20260910_0008 (F-93), 0011 (F-96)
-- and 0013 (F-94) in effect on this lane?
-- Prints check names and true/false only. No member data, no row contents.
-- FAILS (overall = FAIL) on a lane where any of the three is missing;
-- PASSES after all three are applied. Run on staging, then production.
BEGIN READ ONLY;

WITH f AS (
  SELECT p.proname, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('username_available','custom_url_ever_held','forbid_custom_url_change',
                       'change_custom_url','claim_username','clear_custom_url',
                       'auto_subscribe_newsletter','rate_limit_newsletter_subscribe')
), checks(name, ok) AS (
  VALUES
  ('0008 username_available delegates to custom_url_available',
     coalesce((SELECT bool_or(def LIKE '%custom_url_available(%') FROM f WHERE proname = 'username_available'), false)),
  ('0011 custom_url_ever_held exists',
     EXISTS (SELECT 1 FROM f WHERE proname = 'custom_url_ever_held')),
  ('0011 forbid_custom_url_change uses custom_url_ever_held',
     coalesce((SELECT bool_or(def LIKE '%custom_url_ever_held%') FROM f WHERE proname = 'forbid_custom_url_change'), false)),
  ('0011 anon cannot EXECUTE change_custom_url(text)',
     to_regprocedure('public.change_custom_url(text)') IS NOT NULL
     AND NOT has_function_privilege('anon', 'public.change_custom_url(text)', 'EXECUTE')),
  ('0011 anon cannot EXECUTE claim_username(text)',
     to_regprocedure('public.claim_username(text)') IS NOT NULL
     AND NOT has_function_privilege('anon', 'public.claim_username(text)', 'EXECUTE')),
  ('0011 anon cannot EXECUTE clear_custom_url()',
     to_regprocedure('public.clear_custom_url()') IS NOT NULL
     AND NOT has_function_privilege('anon', 'public.clear_custom_url()', 'EXECUTE')),
  ('0013 auto_subscribe_newsletter swallows errors',
     coalesce((SELECT bool_or(def LIKE '%EXCEPTION WHEN others%') FROM f WHERE proname = 'auto_subscribe_newsletter'), false)),
  ('0013 rate limiter exempts registration and keys on email, not domain',
     coalesce((SELECT bool_or(def LIKE '%NEW.source = ''registration''%' AND def NOT LIKE '%split_part(%')
                 FROM f WHERE proname = 'rate_limit_newsletter_subscribe'), false))
)
SELECT name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks
UNION ALL
SELECT 'OVERALL', CASE WHEN bool_and(ok) THEN 'PASS' ELSE 'FAIL' END FROM checks;

ROLLBACK;
