-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261103_0101 admin users platform filter.
-- Drops the two functions 0101 created. Nothing else was changed by 0101
-- (admin_search_users_v2 untouched, no data written, no index).
-- The UI falls back to admin_search_users_v2 and hides the platform row when
-- admin_search_users_v3 is missing, so the Users list keeps working.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane reads %. Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF to_regprocedure('public.admin_search_users_v3(text, text, text, text, text, integer, integer)') IS NULL
     OR to_regprocedure('public.admin_user_platform_counts(text, text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'AU-0101-RB-PRE-001: 0101 is not (fully) applied — nothing to roll back';
  END IF;
END
$pre$;

DROP FUNCTION public.admin_search_users_v3(text, text, text, text, text, integer, integer);
DROP FUNCTION public.admin_user_platform_counts(text, text, text, text);

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
              AND proname IN ('admin_search_users_v3', 'admin_user_platform_counts')) THEN
    RAISE EXCEPTION 'AU-0101-RB-POST-001: a 0101 function is still present';
  END IF;
  IF to_regprocedure('public.admin_search_users_v2(text, text, text, text, integer, integer)') IS NULL THEN
    RAISE EXCEPTION 'AU-0101-RB-POST-002: admin_search_users_v2 is missing — the Users list would break';
  END IF;
END
$post$;

COMMIT;
