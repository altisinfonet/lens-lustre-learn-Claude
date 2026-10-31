-- ═══════════════════════════════════════════════════════════════════════════
-- D1 · UNIT D · RECURRENCE DETECTOR (Step 10)
--
-- SELECT only. Safe to run against any lane at any time; it changes nothing.
--
-- WHAT IT ASKS: which views and materialised views in `public` let an
-- unauthenticated or merely-authenticated caller WRITE — where "write" means
-- any of the seven non-SELECT table privileges, MAINTAIN included, because
-- MAINTAIN carries REFRESH MATERIALIZED VIEW and LOCK TABLE on PostgreSQL 17.
--
-- SELECT is deliberately absent from the privilege list. A read grant on a
-- view is the point of the view; a write grant on a SECURITY DEFINER view is
-- an RLS bypass with no WHERE clause to govern it.
--
-- `public` is included as a grantee because has_table_privilege resolves the
-- PUBLIC pseudo-role under that name, and F-62 is the standing reminder that
-- a revoke naming `anon` alone is a no-op wherever PUBLIC is the real holder.
--
-- EXPECTED:
--   staging, before 20260910_0033 .... 11 relations  (measured 2026-09-24)
--   staging, after  20260910_0033 ....  0 relations
--   scratch fixture, before .......... 11
--   scratch fixture, after ...........  0
--
-- A non-zero result on a lane that has had 0033 applied is a REGRESSION, and
-- the usual cause is a later migration that did DROP VIEW + CREATE VIEW: the
-- drop takes the ACL with it and the recreate starts from pg_default_acl.
-- That is F-66's shape, one relkind over. Do NOT fix it by changing
-- pg_default_acl -- that is a proposed Owner Decision, not D1's to take.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT c.relname,
       c.relkind,
       g.grantee,
       string_agg(g.priv, ',' ORDER BY g.priv) AS write_privs_held
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL (
  SELECT grantee, priv
  FROM unnest(ARRAY['public','anon','authenticated']) AS grantee
  CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE',
                          'REFERENCES','TRIGGER','MAINTAIN']) AS priv
  WHERE has_table_privilege(grantee, c.oid, priv)
) g
WHERE n.nspname = 'public'
  AND c.relkind IN ('v','m')
GROUP BY c.relname, c.relkind, g.grantee
ORDER BY c.relname, g.grantee;
