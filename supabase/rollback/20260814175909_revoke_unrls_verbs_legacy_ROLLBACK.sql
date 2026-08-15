-- ROLLBACK for 20260814175909_revoke_unrls_verbs_legacy.sql
--
-- ⚠ THIS RE-OPENS THE HOLE. It re-grants TRUNCATE, REFERENCES and TRIGGER —
-- the verbs RLS cannot refuse — to anon and authenticated on every public
-- table, restoring the exact pre-migration state. There is no scenario where
-- running this makes the platform better; it exists because every migration
-- ships with a tested inverse, and the honest inverse of a revoke is a grant.
-- If you are running this to "fix" something, stop: the forward migration
-- touches no verb PostgREST uses, so it cannot have broken member traffic.
-- Whatever broke, this is not the fix.

DO $$
DECLARE
  t record;
  n int := 0;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS tbl
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format(
      'GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE %s TO anon, authenticated',
      t.tbl
    );
    n := n + 1;
  END LOOP;
  RAISE NOTICE 're-granted non-RLS verbs on % tables (the pre-migration state)', n;
END $$;
