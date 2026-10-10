-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261010_0002 — F-AUD-8 finalize. REFUSES, BY DESIGN.
-- 0002 deletes revoked credentials (the undo copies and run-history rows that
-- held them). Bringing them back is the exposure this unit removes, and the
-- values are gone from the database, so there is nothing to restore.
-- To change the credentials again: put new values in faud8_new:* and run
-- 20261010_0001 (then 0002). Before 0002, use 20261010_0001's rollback instead.
-- Changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════
DO $refuse$
BEGIN
  RAISE EXCEPTION 'F-AUD-8-0002-RB: finalize has no rollback by design — run 20261010_0001 with new temporaries to rotate again'
    USING ERRCODE = 'raise_exception';
END
$refuse$;
