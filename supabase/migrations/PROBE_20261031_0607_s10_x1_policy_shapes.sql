-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S10 X1 · which duplicate-policy tables can be merged EXACTLY.
-- READ ONLY, ROLLBACK. Never fails on findings. Prints counts and table names
-- only (schema metadata; public log).
--
-- Postgres combines PERMISSIVE policies with OR, per action, among the
-- policies that apply to the current role. So on a table whose permissive
-- policies all name the SAME roles, the policies for one action can be
-- replaced by one policy whose expression is the OR of theirs, and access is
-- identical by definition (FOR ALL counts for every action; for INSERT /
-- UPDATE a policy with no WITH CHECK uses its USING). Where the role sets
-- differ, an OR-merge would widen access for some role, so those tables need
-- per-role handling and are listed apart.
--
-- For every public table that has more than one permissive policy for some
-- (role, action) — the X1 set from PROBE 0605 — this reports:
--   U  uniform:  every permissive policy on the table names the same roles
--   M  mixed:    two or more different role sets
-- and, for U tables, the permissive policy count before -> after an exact
-- merge (one policy per action granted; a FOR ALL policy is folded into each
-- action, so the count can go up while every duplicate disappears).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $probe$
DECLARE
  n_u int; n_m int; pol_before int; pol_after int; u_list text; m_list text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;

  WITH roles AS (
    SELECT r.oid FROM pg_roles r
     WHERE r.rolname NOT LIKE 'pg\_%' AND r.rolname NOT LIKE 'supabase%admin' AND NOT r.rolbypassrls
  ),
  acts(code) AS (VALUES ('r'), ('a'), ('w'), ('d')),
  hits AS (
    SELECT p.polrelid, ro.oid AS role, a.code, p.oid AS pol
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid AND c.relnamespace = 'public'::regnamespace
      JOIN acts a ON p.polcmd = '*' OR p.polcmd = a.code
      JOIN roles ro ON ro.oid = ANY (p.polroles) OR p.polroles = '{0}'::oid[]
     WHERE p.polpermissive
  ),
  x1 AS (SELECT DISTINCT polrelid FROM hits GROUP BY polrelid, role, code HAVING count(*) > 1),
  shape AS (
    SELECT x1.polrelid,
           count(DISTINCT p.polroles) AS rolesets,
           count(*) AS permissive
      FROM x1 JOIN pg_policy p ON p.polrelid = x1.polrelid AND p.polpermissive
     GROUP BY x1.polrelid
  ),
  -- after an exact merge a uniform table keeps one permissive policy per action it grants
  after AS (
    SELECT s.polrelid,
           (SELECT count(DISTINCT a.code) FROM pg_policy p JOIN acts a ON p.polcmd = '*' OR p.polcmd = a.code
             WHERE p.polrelid = s.polrelid AND p.polpermissive) AS keep
      FROM shape s WHERE s.rolesets = 1
  )
  SELECT count(*) FILTER (WHERE s.rolesets = 1),
         count(*) FILTER (WHERE s.rolesets > 1),
         coalesce(sum(s.permissive) FILTER (WHERE s.rolesets = 1), 0),
         coalesce(sum(a.keep) FILTER (WHERE s.rolesets = 1), 0),
         string_agg(c.relname, ', ' ORDER BY c.relname) FILTER (WHERE s.rolesets = 1),
         string_agg(c.relname || '(' || s.rolesets || ')', ', ' ORDER BY c.relname) FILTER (WHERE s.rolesets > 1)
    INTO n_u, n_m, pol_before, pol_after, u_list, m_list
    FROM shape s JOIN pg_class c ON c.oid = s.polrelid LEFT JOIN after a ON a.polrelid = s.polrelid;

  RAISE NOTICE E'X1 POLICY SHAPES (lane %): % X1 tables = % uniform-role (exact OR-merge: % permissive policies -> %, 0 duplicates) + % mixed-role\n  U: %\n  M (role sets): %',
    current_setting('p32.lane'), n_u + n_m, n_u, pol_before, pol_after, n_m, coalesce(u_list, 'none'), coalesce(m_list, 'none');
END
$probe$;

ROLLBACK;
