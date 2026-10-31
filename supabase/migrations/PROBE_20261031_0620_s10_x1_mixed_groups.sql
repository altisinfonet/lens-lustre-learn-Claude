-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S10 X1 · mixed-role tables: what design #718 rev 2 would merge.
-- Changes nothing: temp tables only, ROLLBACK. Never fails on findings. Prints counts, table and
-- policy names only (schema metadata; public log).
--
-- Design rev 2 (docs/evidence/cloud/S10/X1-mixed-role-design.md §3) merges
-- permissive policies only within one GROUP = same table, same command
-- (FOR ALL is its own key), exactly the same role list (compared as a sorted
-- set of names). Before writing any merge file, this measures on each lane:
--
--   MIXED   the X1 tables (some role has 2+ permissive policies for one
--           action) whose permissive policies use 2+ different role lists —
--           the same set PROBE 0607 calls "mixed".
--   MERGE   per mixed table, the groups holding 2+ policies (what rev 2
--           would merge), with their policy names, and the permissive policy
--           count before -> after.
--   RESID   per mixed table, the (action, role) pairs that would still have
--           2+ applicable permissive policies after the merge (the X1
--           residual, design §3 "What it does NOT do"). A policy applies to a
--           role when its list holds PUBLIC or a role the role has the
--           privileges of (pg_has_role USAGE = has_privs_of_role).
--           Roles: as PROBE 0607 (no pg_*, no supabase*admin, no BYPASSRLS).
--
-- If MERGE is empty on both lanes, rev 2 has nothing to do and X1 is closed
-- with the residual recorded.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;  -- temp work tables only; always ROLLBACK (a READ ONLY transaction cannot CREATE TEMP)

DO $probe$
DECLARE
  rec record;
  n_mixed int := 0; n_merge_tables int := 0; n_groups int := 0;
  pol_before int := 0; pol_after int := 0; n_resid_tables int := 0;
  merge_txt text := ''; resid_txt text := ''; mixed_txt text; one_txt text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;

  CREATE TEMP TABLE _roles ON COMMIT DROP AS
    SELECT r.oid, r.rolname FROM pg_roles r
     WHERE r.rolname NOT LIKE 'pg\_%' AND r.rolname NOT LIKE 'supabase%admin' AND NOT r.rolbypassrls;

  -- every permissive policy on a public table, with its group key
  CREATE TEMP TABLE _pol ON COMMIT DROP AS
    SELECT p.oid, p.polrelid, c.relname, p.polname, p.polcmd, p.polroles,
           (SELECT string_agg(CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END, ',' ORDER BY
                              CASE WHEN x = 0 THEN 'public' ELSE x::regrole::text END COLLATE "C")
              FROM unnest(p.polroles) x) AS rolekey
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid AND c.relnamespace = 'public'::regnamespace
     WHERE p.polpermissive;

  -- (policy, role, action) where the policy applies
  CREATE TEMP TABLE _hits ON COMMIT DROP AS
    SELECT p.oid AS pol, p.polrelid, ro.oid AS role, a.code, p.polcmd, p.rolekey
      FROM _pol p
      JOIN (VALUES ('r'), ('a'), ('w'), ('d')) a(code) ON p.polcmd = '*' OR p.polcmd = a.code
      JOIN _roles ro ON p.polroles = '{0}'::oid[] OR 0 = ANY (p.polroles)
                     OR EXISTS (SELECT 1 FROM unnest(p.polroles) x WHERE x <> 0 AND pg_has_role(ro.oid, x, 'USAGE'));

  CREATE TEMP TABLE _x1 ON COMMIT DROP AS
    SELECT DISTINCT polrelid FROM _hits GROUP BY polrelid, role, code HAVING count(*) > 1;

  CREATE TEMP TABLE _mixed ON COMMIT DROP AS
    SELECT x.polrelid FROM _x1 x
     WHERE (SELECT count(DISTINCT rolekey) FROM _pol p WHERE p.polrelid = x.polrelid) > 1;

  -- X1 tables with ONE role list as a set: not mixed here. PROBE 0607 compares
  -- raw role arrays, so a table whose lists differ only in order is "mixed"
  -- there and lands here; so does a uniform table whose duplicates the
  -- uniform batches left (e.g. FOR ALL next to FOR SELECT). Expected: none.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO one_txt
    FROM _x1 x JOIN pg_class c ON c.oid = x.polrelid
   WHERE x.polrelid NOT IN (SELECT polrelid FROM _mixed);

  SELECT count(*), string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO n_mixed, mixed_txt
    FROM _mixed m JOIN pg_class c ON c.oid = m.polrelid;

  -- MERGE: groups with 2+ policies
  FOR rec IN
    SELECT p.relname,
           count(*) AS before,
           count(DISTINCT (p.polcmd, p.rolekey)) AS after,
           string_agg(g.txt, '; ' ORDER BY g.txt) FILTER (WHERE g.txt IS NOT NULL) AS groups,
           count(DISTINCT g.txt) AS n_groups
      FROM _pol p
      JOIN _mixed m ON m.polrelid = p.polrelid
      LEFT JOIN LATERAL (
        SELECT CASE p.polcmd WHEN '*' THEN 'ALL' WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                             WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' END
               || '{' || p.rolekey || '}=['
               || (SELECT string_agg(q.polname, ',' ORDER BY q.polname COLLATE "C" DESC)
                     FROM _pol q WHERE q.polrelid = p.polrelid AND q.polcmd = p.polcmd AND q.rolekey = p.rolekey)
               || ']' AS txt
         WHERE (SELECT count(*) FROM _pol q
                 WHERE q.polrelid = p.polrelid AND q.polcmd = p.polcmd AND q.rolekey = p.rolekey) > 1
           AND p.polname = (SELECT min(q.polname) FROM _pol q
                             WHERE q.polrelid = p.polrelid AND q.polcmd = p.polcmd AND q.rolekey = p.rolekey)
      ) g ON true
     GROUP BY p.relname
     ORDER BY p.relname
  LOOP
    pol_before := pol_before + rec.before;
    pol_after  := pol_after + rec.after;
    IF rec.n_groups > 0 THEN
      n_merge_tables := n_merge_tables + 1;
      n_groups := n_groups + rec.n_groups;
      merge_txt := merge_txt || E'\n    ' || rec.relname || ' (' || rec.before || ' -> ' || rec.after || '): ' || rec.groups;
    END IF;
  END LOOP;

  -- RESID: (action, role) still seeing 2+ groups after the merge
  FOR rec IN
    SELECT c.relname,
           string_agg(t.code_name || ':' || t.roles, ' ' ORDER BY t.code_name) AS pairs
      FROM (
        SELECT h.polrelid,
               CASE h.code WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' ELSE 'DELETE' END AS code_name,
               string_agg(DISTINCT ro.rolname, ',' ORDER BY ro.rolname) AS roles
          FROM (SELECT polrelid, role, code
                  FROM _hits GROUP BY polrelid, role, code
                HAVING count(DISTINCT (polcmd, rolekey)) > 1) h
          JOIN _roles ro ON ro.oid = h.role
          JOIN _mixed m ON m.polrelid = h.polrelid
         GROUP BY h.polrelid, h.code
      ) t
      JOIN pg_class c ON c.oid = t.polrelid
     GROUP BY c.relname
     ORDER BY c.relname
  LOOP
    n_resid_tables := n_resid_tables + 1;
    resid_txt := resid_txt || E'\n    ' || rec.relname || ': ' || rec.pairs;
  END LOOP;

  RAISE NOTICE E'X1 MIXED GROUPS (lane %): % mixed tables; MERGE: % tables, % groups, permissive % -> % (mixed tables only); RESID: % tables\n  X1 tables with one role list (not mixed; expected none): %\n  MIXED: %\n  MERGE (cmd{roles}=[parts in DESC order]):%\n  RESID (action:roles with 2+ groups after merge):%',
    current_setting('p32.lane'), n_mixed, n_merge_tables, n_groups, pol_before, pol_after, n_resid_tables,
    coalesce(one_txt, 'none'), coalesce(mixed_txt, 'none'), CASE WHEN merge_txt = '' THEN ' none' ELSE merge_txt END,
    CASE WHEN resid_txt = '' THEN ' none' ELSE resid_txt END;
END
$probe$;

ROLLBACK;
