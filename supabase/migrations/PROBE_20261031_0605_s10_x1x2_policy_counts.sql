-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S10 X1 / X2 · RLS policy counts, every counting rule, one sitting.
-- READ ONLY, ROLLBACK. Never fails on findings; it measures. Prints counts
-- and table/policy NAMES only (schema metadata — no row data; public log).
--
-- Hold H-2: "384 duplicate permissive policies across 82 tables; 29 policies
-- re-evaluating auth.uid() per row" — P34 cannot close until X1/X2 land, and
-- the counting rule behind those numbers was never written down. This PROBE
-- takes every plausible rule on the lane so the consolidation unit can name
-- one, the way C-2 did for indexes.
--
-- X1 · multiple permissive policies (Supabase linter rule
--      `multiple_permissive_policies`): for each (table, role, action) where
--      more than one PERMISSIVE policy applies. A policy for PUBLIC applies to
--      every login role; a policy FOR ALL applies to every action. Roles that
--      bypass RLS, pg_* and supabase_*admin roles are left out, as the linter
--      does. Counted four ways:
--        X1a  (table, role, action) tuples        — the linter's warning count
--        X1b  distinct tables
--        X1c  distinct policies involved
--        X1d  excess policies = Σ (policies per tuple − 1)
-- X2 · per-row re-evaluation (linter `auth_rls_initplan`): a policy whose
--      USING or WITH CHECK calls auth.uid() / auth.jwt() / auth.role() /
--      auth.email() or current_setting() NOT wrapped in a sub-SELECT.
--        X2a  policies    X2b  distinct tables
-- Scope: schema public only (the app's tables; Supabase's schemas are theirs).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $probe$
DECLARE
  x1a int; x1b int; x1c int; x1d int; x2a int; x2b int;
  pol_total int; tbl_rls int;
  x1_top text; x2_list text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;

  SELECT count(*) INTO pol_total
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relnamespace = 'public'::regnamespace;
  SELECT count(*) INTO tbl_rls
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relrowsecurity;

  -- X1
  WITH roles AS (
    SELECT r.oid, r.rolname FROM pg_roles r
     WHERE r.rolname NOT LIKE 'pg\_%' AND r.rolname NOT LIKE 'supabase%admin' AND NOT r.rolbypassrls
  ),
  acts(cmd, code) AS (VALUES ('SELECT', 'r'), ('INSERT', 'a'), ('UPDATE', 'w'), ('DELETE', 'd')),
  hits AS (
    SELECT c.relname AS tbl, ro.rolname AS role, a.cmd, p.polname
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid AND c.relnamespace = 'public'::regnamespace
      JOIN acts a ON p.polcmd = '*' OR p.polcmd = a.code
      JOIN roles ro ON ro.oid = ANY (p.polroles) OR p.polroles = '{0}'::oid[]
     WHERE p.polpermissive
  ),
  tuples AS (
    SELECT tbl, role, cmd, count(*) AS n, array_agg(polname) AS pols
      FROM hits GROUP BY tbl, role, cmd HAVING count(*) > 1
  ),
  per_tbl AS (SELECT tbl, count(*) AS t FROM tuples GROUP BY tbl)
  SELECT (SELECT count(*) FROM tuples),
         (SELECT count(DISTINCT tbl) FROM tuples),
         (SELECT count(DISTINCT (tbl, pol)) FROM tuples, unnest(pols) AS pol),
         (SELECT coalesce(sum(n - 1), 0) FROM tuples),
         (SELECT string_agg(format('%s(%s)', tbl, t), ', ' ORDER BY t DESC, tbl)
            FROM (SELECT * FROM per_tbl ORDER BY t DESC, tbl LIMIT 15) z)
    INTO x1a, x1b, x1c, x1d, x1_top;

  -- X2
  WITH txt AS (
    SELECT tablename AS tbl, policyname AS pol,
           coalesce(qual, '') || ' ' || coalesce(with_check, '') AS t
      FROM pg_policies WHERE schemaname = 'public'
  ),
  bare AS (
    SELECT tbl, pol FROM txt
     WHERE regexp_replace(t,
             '\(\s*SELECT\s+(auth\.(uid|jwt|role|email)\(\)|current_setting\([^()]*\))\s+AS\s+\w+\s*\)',
             '', 'gi')
           ~* '(auth\.(uid|jwt|role|email)\(\)|current_setting\()'
  )
  SELECT count(*), count(DISTINCT tbl),
         string_agg(format('%s.%s', tbl, pol), ', ' ORDER BY tbl, pol)
    INTO x2a, x2b, x2_list FROM bare;

  RAISE NOTICE E'X1/X2 POLICY COUNTS (lane %): % policies on % RLS tables in public\n  X1a (table,role,action) tuples=%  X1b tables=%  X1c policies involved=%  X1d excess policies=%\n  X1 top tables by tuples: %\n  X2a per-row auth/current_setting policies=%  X2b tables=%\n  X2 policies: %',
    current_setting('p32.lane'), pol_total, tbl_rls, x1a, x1b, x1c, x1d, coalesce(x1_top, 'none'),
    x2a, x2b, coalesce(x2_list, 'none');
END
$probe$;

ROLLBACK;
