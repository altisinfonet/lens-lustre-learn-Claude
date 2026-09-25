-- ── P32 · 0043 fixture · scratch PostgreSQL 17 only. ────────────────────
-- The starting shape both lanes are in, as measured 2026-09-25 (R-51):
--
--   * NO global FUNCTION default-privilege entry for postgres, so the built-in
--     default applies in full and PUBLIC holds EXECUTE on every new function.
--   * a postgres/public entry of {postgres, authenticated, service_role}
--     (staging). Production additionally has anon there; 0043's first statement
--     removes it and is a no-op on staging, so the staging shape is the one
--     that makes the GLOBAL statement's necessity visible — with anon present,
--     removing it could be mistaken for the fix.
--   * a schema `extensions`, where Supabase keeps extension functions.
--
-- Nothing here is production-specific: 0043 is a two-lane file and its subject
-- is the default-privilege catalogue, not any object's ACL.

CREATE SCHEMA IF NOT EXISTS extensions;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- The instrument every step uses: create a real SECURITY DEFINER function in
-- `public`, read what it was BORN with, drop it, report. The catalogue row is
-- not the answer — F-65 is the whole reason this unit exists — so the merged
-- result is what gets measured.
CREATE OR REPLACE FUNCTION public.p32_0043_probe() RETURNS text LANGUAGE plpgsql AS
$p$
DECLARE o oid; acl text; a bool; au bool; sr bool;
BEGIN
  EXECUTE 'CREATE FUNCTION public._p32_probe_t() RETURNS void LANGUAGE sql '
          'SECURITY DEFINER SET search_path = '''' AS $x$ SELECT $x$';
  -- dynamic lookup: a `'public._p32_probe_t()'::regprocedure` literal is folded
  -- into plpgsql's cached plan and points at the dropped oid on the next call.
  SELECT p.oid INTO o FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = '_p32_probe_t';
  acl := coalesce((SELECT proacl::text FROM pg_proc WHERE oid = o), '(null: built-in default)');
  a   := has_function_privilege('anon', o, 'EXECUTE');
  au  := has_function_privilege('authenticated', o, 'EXECUTE');
  sr  := has_function_privilege('service_role', o, 'EXECUTE');
  EXECUTE 'DROP FUNCTION public._p32_probe_t()';
  RETURN format('anon=%s authenticated=%s service_role=%s acl=%s', a, au, sr, acl);
END
$p$;

-- A stable digest of every default-privilege row this unit can touch.
CREATE OR REPLACE FUNCTION public.p32_0043_defacl_digest() RETURNS text LANGUAGE sql AS
$d$
  SELECT coalesce(md5(string_agg(x, E'\n' ORDER BY x)), '(no rows)')
    FROM (SELECT coalesce(n.nspname, '(GLOBAL)') || ' ' || d.defaclobjtype::text || ' ' ||
                 coalesce(d.defaclacl::text, 'NULL') AS x
            FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
           WHERE d.defaclrole = 'postgres'::regrole) t
$d$;

\echo 'FIXTURE BUILT (0043)'
