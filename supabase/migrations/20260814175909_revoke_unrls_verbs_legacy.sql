-- ═══════════════════════════════════════════════════════════════════════════
-- CLOSE THE VERBS RLS CANNOT REFUSE, ACROSS EVERY LEGACY TABLE AT ONCE.
--
-- Found during the Competition Engine gate, quantified on production:
-- 136 public tables — posts, competition_entries, judging_rounds among them —
-- grant TRUNCATE (and REFERENCES, TRIGGER) to `anon` and `authenticated`,
-- because ALTER DEFAULT PRIVILEGES granted arwdDxtm to every table ever
-- created, and RLS governs only SELECT/INSERT/UPDATE/DELETE. TRUNCATE,
-- REFERENCES and TRIGGER are checked against the GRANT ALONE; no policy can
-- refuse them. The newTableGrants gate closes this for every post-mandate
-- table; this migration closes the 136-table legacy class in one motion.
--
-- EXPLOITABILITY, STATED HONESTLY: PostgREST exposes no TRUNCATE verb, so a
-- member cannot reach this through the public API today. It is a standing
-- landmine — one SQL construction inside any present or future SECURITY
-- DEFINER function away from being reachable — not an active hole. Which is
-- exactly when closing a class is cheap.
--
-- WHY THE BLANKET REVOKE IS SAFE:
--   - SELECT/INSERT/UPDATE/DELETE are NOT touched: member access via
--     PostgREST continues exactly as before, governed by RLS as today.
--   - TRUNCATE: nothing member-facing truncates. Server jobs run as
--     service_role or postgres, both untouched.
--   - REFERENCES: creating a foreign key is DDL; members run no DDL.
--   - TRIGGER: creating triggers is DDL; same.
--   - service_role keeps everything; owner (postgres) is unaffected.
--
-- The DEFAULT for FUTURE tables is left as-is deliberately: the mutation-
-- tested newTableGrants gate already forces every new migration to decide its
-- grants out loud, and changing cluster defaults is the M2 cycle (blocked on
-- instrumentation, per PENDING). One variable per change.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t record;
  n int := 0;
BEGIN
  FOR t IN
    SELECT c.oid::regclass AS tbl
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relkind = 'r'
      AND (
        has_table_privilege('anon', c.oid, 'TRUNCATE')
        OR has_table_privilege('authenticated', c.oid, 'TRUNCATE')
        OR has_table_privilege('anon', c.oid, 'REFERENCES')
        OR has_table_privilege('authenticated', c.oid, 'REFERENCES')
        OR has_table_privilege('anon', c.oid, 'TRIGGER')
        OR has_table_privilege('authenticated', c.oid, 'TRIGGER')
      )
  LOOP
    EXECUTE format(
      'REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE %s FROM PUBLIC, anon, authenticated',
      t.tbl
    );
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'revoked non-RLS verbs on % tables', n;
END $$;
