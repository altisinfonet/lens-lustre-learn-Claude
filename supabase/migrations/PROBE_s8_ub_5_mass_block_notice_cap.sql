-- PROBE (read-only) · S8 / UB-5 — is the per-blocker notice cap live?
-- Prints check names and PASS/FAIL only. No member data.
-- FAILS before 20261029_0003, PASSES after.
BEGIN READ ONLY;

WITH f AS (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.notify_admin_user_blocked()')),
checks(name, ok) AS (
  VALUES
  ('notify_admin_user_blocked carries the per-blocker cap (UB-5)',
     coalesce((SELECT prosrc LIKE '%UB-5%' AND prosrc LIKE '%blocker_id = NEW.blocker_id%' FROM f), false)),
  ('notify_admin_user_blocked still carries the pair cap (SEC-UB-1)',
     coalesce((SELECT prosrc LIKE '%ON CONFLICT (blocker_id, blocked_id)%' FROM f), false)),
  ('no API role can EXECUTE it',
     to_regprocedure('public.notify_admin_user_blocked()') IS NOT NULL
     AND NOT has_function_privilege('anon', 'public.notify_admin_user_blocked()', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'public.notify_admin_user_blocked()', 'EXECUTE')),
  ('trigger user_blocks_notify_admin enabled',
     EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.user_blocks')
              AND tgname = 'user_blocks_notify_admin' AND tgenabled = 'O'))
)
SELECT name, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result FROM checks
UNION ALL
SELECT 'OVERALL', CASE WHEN bool_and(ok) THEN 'PASS' ELSE 'FAIL' END FROM checks;

ROLLBACK;
