-- ═══════════════════════════════════════════════════════════════════════════
-- 20261103_0101 · Admin → Users — "Filter by platform": All · App users ·
-- Web users · Unknown, each with its count.
--
-- OWNER (2026-10-30): "give small tabs: All, App users, Web users, Unknown."
--
-- WHY SQL AND NOT THE BROWSER. The member list is paged (100 per page, via
-- admin_search_users_v2). Filtering the rows already loaded would hide every
-- App/Web member on pages 2..N and make the counts describe one page — the
-- exact defect admin_search_users_v2 was written to end for role and badge
-- (see UNAPPLIED_20260824000000's header). So the platform filter is applied
-- IN SQL, before LIMIT/OFFSET, like role and badge.
--
-- TWO NEW FUNCTIONS, NOTHING CHANGED:
--   * admin_search_users_v3(_query, _by, _role, _badge, _platform, _limit, _offset)
--       v2 plus `_platform`: NULL/'' = all, 'app', 'web', 'unknown'
--       (= last_platform IS NULL). Same columns as v2, same order, same
--       clamps, same search/role/badge predicates (role compared as text so
--       it is correct whether user_roles.role is text or app_role).
--   * admin_user_platform_counts(_query, _by, _role, _badge)
--       one row: all_count, app_count, web_count, unknown_count — for the
--       CURRENT search + role + badge combination (platform itself excluded,
--       so every tab shows what it would list).
--   admin_search_users_v2 is not touched; the UI falls back to it while this
--   file is not yet applied (the platform row is then hidden).
--
-- ACCESS: identical to v2 — `IF NOT public.has_role(auth.uid(), 'admin') THEN
-- RAISE EXCEPTION 'Not authorized'`, EXECUTE to authenticated only (PUBLIC and
-- anon revoked). A signed-in non-admin gets 'Not authorized', not data. The
-- functions return nothing v2 does not already return to an admin, plus
-- aggregate counts.
--
-- NO INDEX. profiles.last_platform has three values (app/web/NULL); a btree on
-- it would not be chosen over the scan v2 already does. Not added.
--
-- NOTHING IS BACKFILLED. A member with no recorded platform stays NULL and is
-- counted under "Unknown" until their next sign-in records it (20261102_0102).
--
-- Rollback: supabase/rollback/20261103_0101_admin_users_platform_filter_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261103_0101_admin_users_platform_filter.sql
-- Fixture:  supabase/tests/admin-platform-filter/ (scripts/db-admin-platform-filter-fixture.mjs)
-- ═══════════════════════════════════════════════════════════════════════════
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
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles'
         AND column_name IN ('id', 'last_platform', 'full_name', 'created_at')) <> 4 THEN
    RAISE EXCEPTION 'AU-0101-PRE-001: public.profiles is missing id/last_platform/full_name/created_at — refusing';
  END IF;
  IF to_regclass('public.user_roles') IS NULL OR to_regclass('public.user_badges') IS NULL THEN
    RAISE EXCEPTION 'AU-0101-PRE-002: public.user_roles / public.user_badges missing — refusing';
  END IF;
  IF to_regprocedure('public.admin_search_users_v2(text, text, text, text, integer, integer)') IS NULL THEN
    RAISE EXCEPTION 'AU-0101-PRE-003: admin_search_users_v2 missing — this file mirrors it; refusing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
              AND proname IN ('admin_search_users_v3', 'admin_user_platform_counts')) THEN
    RAISE EXCEPTION 'AU-0101-PRE-004: admin_search_users_v3 / admin_user_platform_counts already exist — roll back first';
  END IF;
END
$pre$;

-- ── admin_search_users_v3 ───────────────────────────────────────────────────
CREATE FUNCTION public.admin_search_users_v3(
  _query    text    DEFAULT '',
  _by       text    DEFAULT 'name',
  _role     text    DEFAULT NULL,
  _badge    text    DEFAULT NULL,
  _platform text    DEFAULT NULL,
  _limit    integer DEFAULT 100,
  _offset   integer DEFAULT 0
)
RETURNS TABLE (
  id                uuid,
  email             text,
  full_name         text,
  avatar_url        text,
  bio               text,
  is_suspended      boolean,
  suspended_until   timestamp with time zone,
  suspension_reason text,
  created_at        timestamp with time zone,
  total_count       bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_limit    integer := least(greatest(coalesce(_limit, 100), 1), 200);
  v_offset   integer := greatest(coalesce(_offset, 0), 0);
  v_query    text    := coalesce(_query, '');
  v_platform text    := nullif(coalesce(_platform, ''), '');
BEGIN
  -- Same gate as admin_search_users_v2, word for word.
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_platform IS NOT NULL AND v_platform NOT IN ('app', 'web', 'unknown') THEN
    RAISE EXCEPTION 'admin_search_users_v3: _platform must be NULL, '''', ''app'', ''web'' or ''unknown'''
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH matched AS (
    SELECT p.id, au.email::text AS email, p.full_name, p.avatar_url, p.bio,
           p.is_suspended, p.suspended_until, p.suspension_reason, p.created_at
      FROM public.profiles p
      LEFT JOIN auth.users au ON au.id = p.id
     WHERE (
             v_query = ''
             OR (_by = 'email' AND au.email ILIKE '%' || v_query || '%')
             OR (_by <> 'email' AND p.full_name ILIKE '%' || v_query || '%')
           )
       AND (_role IS NULL OR _role = ''
            OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text = _role))
       AND (_badge IS NULL OR _badge = ''
            OR EXISTS (SELECT 1 FROM public.user_badges ub WHERE ub.user_id = p.id AND ub.badge_type = _badge))
       -- Platform, IN SQL, before the limit. 'unknown' = nothing recorded.
       AND (v_platform IS NULL
            OR (v_platform = 'unknown' AND p.last_platform IS NULL)
            OR p.last_platform = v_platform)
  )
  SELECT m.id, m.email, m.full_name, m.avatar_url, m.bio, m.is_suspended,
         m.suspended_until, m.suspension_reason, m.created_at,
         count(*) OVER () AS total_count
    FROM matched m
   ORDER BY m.created_at DESC, m.id DESC
   LIMIT v_limit OFFSET v_offset;
END
$fn$;

-- ── admin_user_platform_counts ──────────────────────────────────────────────
CREATE FUNCTION public.admin_user_platform_counts(
  _query text DEFAULT '',
  _by    text DEFAULT 'name',
  _role  text DEFAULT NULL,
  _badge text DEFAULT NULL
)
RETURNS TABLE (
  all_count     bigint,
  app_count     bigint,
  web_count     bigint,
  unknown_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_query text := coalesce(_query, '');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT count(*)                                            AS all_count,
         count(*) FILTER (WHERE p.last_platform = 'app')     AS app_count,
         count(*) FILTER (WHERE p.last_platform = 'web')     AS web_count,
         count(*) FILTER (WHERE p.last_platform IS NULL)     AS unknown_count
    FROM public.profiles p
    LEFT JOIN auth.users au ON au.id = p.id
   WHERE (
           v_query = ''
           OR (_by = 'email' AND au.email ILIKE '%' || v_query || '%')
           OR (_by <> 'email' AND p.full_name ILIKE '%' || v_query || '%')
         )
     AND (_role IS NULL OR _role = ''
          OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text = _role))
     AND (_badge IS NULL OR _badge = ''
          OR EXISTS (SELECT 1 FROM public.user_badges ub WHERE ub.user_id = p.id AND ub.badge_type = _badge));
END
$fn$;

COMMENT ON FUNCTION public.admin_search_users_v3(text, text, text, text, text, integer, integer) IS
  '20261103_0101: admin_search_users_v2 + _platform (NULL/''''=all, app, web, unknown=NULL last_platform), filtered in SQL before LIMIT/OFFSET. Admin only.';
COMMENT ON FUNCTION public.admin_user_platform_counts(text, text, text, text) IS
  '20261103_0101: all/app/web/unknown member counts for the current search + role + badge. Admin only. Aggregates only.';

REVOKE ALL ON FUNCTION public.admin_search_users_v3(text, text, text, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_user_platform_counts(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_users_v3(text, text, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_platform_counts(text, text, text, text) TO authenticated;

DO $post$
DECLARE f oid; n text;
BEGIN
  FOREACH n IN ARRAY ARRAY[
    'public.admin_search_users_v3(text, text, text, text, text, integer, integer)',
    'public.admin_user_platform_counts(text, text, text, text)'] LOOP
    f := to_regprocedure(n);
    IF f IS NULL OR NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid = f) THEN
      RAISE EXCEPTION 'AU-0101-POST-001: % missing or not SECURITY DEFINER with search_path=""', n;
    END IF;
    IF has_function_privilege('anon', f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) x WHERE p.oid = f AND x.grantee = 0) THEN
      RAISE EXCEPTION 'AU-0101-POST-002: % EXECUTE must be authenticated (not anon, not PUBLIC)', n;
    END IF;
    IF position('has_role(auth.uid(), ''admin'')' IN pg_get_functiondef(f)) = 0 THEN
      RAISE EXCEPTION 'AU-0101-POST-003: % lost the admin gate', n;
    END IF;
  END LOOP;
END
$post$;

COMMIT;
