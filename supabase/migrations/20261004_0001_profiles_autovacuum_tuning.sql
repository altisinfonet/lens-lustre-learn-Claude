-- ═══════════════════════════════════════════════════════════════════════════
-- P1-H · 20261004_0001 — per-table autovacuum on public.profiles
-- Phase 2 unit P1 (D1, T1), R-82 design proof. Lanes: staging and production.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- GATE (GATE_REGISTER P1, amended by the Owner in R-82): "profiles dead-row
-- ratio below 10 %" is proved by DESIGN — (a) no client-timer write (CI
-- d1-p1-client-timer, green on main), (b) THIS FILE, (c) a synthetic churn test
-- at launch scale, failing first with the default settings:
-- docs/evidence/d1/phase2/p1-synthetic-churn.md.
--
-- WHY THE DEFAULT CANNOT HOLD 10 %. Autovacuum starts on a table when
--   n_dead_tup > autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor × reltuples
-- Defaults (staging 17.6, read 2026-10-04 10:33 UTC; production is the same
-- Supabase default): threshold 50, scale factor 0.2. The highest dead-row ratio
-- the table reaches before a vacuum is therefore about (50 + 0.2·N) / (1.2·N + 50):
--   N = 50 (staging today) → 54.5 % · N = 131 (production) → 36.8 % · N = 100,000 → 16.7 %.
-- No default setting keeps any of these below 10 %. Every last-seen write is a
-- non-HOT UPDATE (idx_profiles_reengagement_scan indexes last_active_at), so
-- every write leaves one dead tuple.
--
-- WHAT THIS FILE SETS (profiles only; no other table, no cluster setting):
--   autovacuum_vacuum_scale_factor = 0.05
--   autovacuum_vacuum_threshold    = 0
-- The trigger becomes n_dead_tup > 0.05 × N, so the ratio before a vacuum is at
-- most 0.05·N / 1.05·N ≈ 4.8 % at ANY size — 50, 131 or 100,000 rows — plus
-- what arrives during one autovacuum naptime (60 s). At launch (10,000 session
-- ends a day on 100,000 profiles) that is ~7 rows a minute, 0.007 %.
-- Cost: at 100k rows a vacuum every ~5,000 dead rows (≈ twice a day at launch
-- rate); at 50 rows a vacuum every 3 dead rows, at most once per naptime — a
-- tiny table, a tiny vacuum.
--
-- LOCK. ALTER TABLE … SET (storage parameters) takes SHARE UPDATE EXCLUSIVE:
-- reads and writes continue; only another VACUUM/ALTER waits. lock_timeout 5 s.
-- RE-RUNNABLE (sets the same two values). ROLLBACK: …_ROLLBACK.sql = RESET.
-- PROBE: supabase/migrations/PROBE_p1_profiles_autovacuum.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

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

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.profiles SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 0);

DO $postconditions$
DECLARE
  opts text[];
BEGIN
  SELECT reloptions INTO opts FROM pg_class WHERE oid = 'public.profiles'::regclass;
  IF NOT ('autovacuum_vacuum_scale_factor=0.05' = ANY (opts) AND 'autovacuum_vacuum_threshold=0' = ANY (opts)) THEN
    RAISE EXCEPTION 'P1H-0001-POST-001: profiles reloptions are %, not the P1-H pair', opts USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'P1H-0001: profiles autovacuum at 5 %% dead rows (threshold 0); max ratio before a vacuum ≈ 4.8 %%';
END
$postconditions$;

COMMIT;
