-- ═══════════════════════════════════════════════════════════════════════════
-- P1 · 20260920_0003 — one-time VACUUM (ANALYZE) of public.profiles
-- Phase 2, R-67. Two lanes: staging and production. MAINTENANCE, NOT SCHEMA.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY. The P1 client cut-over is live on staging (e04a116; the Auditor's
-- read-only verification, 2026-09-28 07:17 UTC): the 5-minute timer UPDATE
-- makes no new calls. But profiles still carries the dead rows the OLD timer
-- left behind — 50 live / 51 dead = 50.5 %, last autovacuum 2026-09-15 — and
-- autovacuum will not clear them at this table size: its trigger is
-- autovacuum_vacuum_threshold + scale_factor x live = 50 + 0.2 x 50 = 60 dead
-- rows (both settings read on staging 2026-09-28 07:20 UTC; profiles has no
-- per-table reloptions). The seven-day window (2-D1-04) measures the NEW
-- write pattern; it cannot start while the ratio is dominated by the old one.
-- This file clears the old dead rows once, so day 1 can be a reading of P1.
--
-- WHAT. Exactly one maintenance statement, VACUUM (ANALYZE) public.profiles,
-- preceded by the lane assertion. Nothing else: no DDL, no grant, no data
-- change. VACUUM removes dead row versions no running transaction can still
-- see; it does not take an exclusive lock (it runs beside reads and writes)
-- and it does not rewrite the table (that would be VACUUM FULL, which is NOT
-- what this file does).
--
-- WHY THERE IS NO BEGIN/COMMIT. VACUUM cannot run inside a transaction block
-- ("VACUUM cannot run inside a transaction block"). apply-migration.yml's
-- "Run it" step is `psql --set ON_ERROR_STOP=1 -c "SET p32.lane = ..." -f FILE`
-- — no --single-transaction / -1 — so psql runs each statement of this file
-- in autocommit, in the order written, in ONE session (read from the workflow
-- on staging e04a116, 2026-09-28). The lane assertion is therefore its own
-- statement, BEFORE the VACUUM: if it raises, ON_ERROR_STOP ends the session
-- and the VACUUM never runs. The harness proves both halves, including that
-- the same statement wrapped in BEGIN/COMMIT, or run with psql -1, FAILS —
-- so if the workflow ever gains single-transaction mode, this file refuses
-- loudly rather than half-running.
--   docs/evidence/d1/phase2/p1-0003-run-tests.sh, transcript p1-0003-transcript.txt
--
-- PRIVILEGE. VACUUM needs ownership or MAINTAIN (PG17). On staging profiles is
-- owned by postgres, the dispatch role (read 2026-09-28).
--
-- ROLLBACK: NONE, BY DESIGN. VACUUM removes only row versions that are already
-- dead and invisible to every transaction; there is no prior state that
-- anything can read, so there is nothing to restore. ANALYZE refreshes
-- planner statistics, which the next autovacuum/autoanalyze would refresh
-- anyway. No supabase/rollback/ file ships with this unit, and that is stated
-- here rather than left for a reviewer to infer.
--
-- RE-RUNNABLE. A second run is harmless (it finds little or nothing to do).
-- It is one-time because the need is one-time, not because a repeat is unsafe.
--
-- OBJECTS: public.profiles (maintenance only), reserved in 2-D1-01.
-- ═══════════════════════════════════════════════════════════════════════════

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

VACUUM (ANALYZE) public.profiles;
