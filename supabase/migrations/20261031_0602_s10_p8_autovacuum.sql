-- ═══════════════════════════════════════════════════════════════════════════
-- S10 · P8 · A-4a EXPAND — per-table autovacuum on the remaining churning
-- tables. Lanes: staging and production.
--
-- GATE (P8): "each named table's dead-row ratio measured below 10 % across a
-- full week under normal traffic." Named tables: profiles (already tuned by
-- 20261004_0001, both lanes), user_devices, user_notifications, activity_logs;
-- plus user_roles, which addendum-recheck.md §P8 measured as never autovacuumed.
--
-- WHY. Autovacuum starts on a table when
--   n_dead_tup > autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor × reltuples
-- With the Supabase defaults (threshold 50, scale factor 0.2) the dead-row ratio
-- a table reaches before a vacuum is about (50 + 0.2·N) / (1.2·N + 50): ≥ 16.7 %
-- at any size and far higher on small tables — the 10 % gate cannot hold.
-- Same design as 20261004_0001 (profiles): scale factor 0.05, threshold 0 →
-- trigger at n_dead_tup > 0.05·N, i.e. at most ≈ 4.8 % before a vacuum at any
-- size, plus what arrives in one 60 s naptime.
--
-- ADDITIVE ONLY (A-4a): storage parameters on four tables; no data, no schema,
-- no cluster setting. LOCK: SHARE UPDATE EXCLUSIVE per table (reads and writes
-- continue). lock_timeout 5 s. RE-RUNNABLE (same values).
-- ROLLBACK: supabase/rollback/20261031_0602_s10_p8_autovacuum_ROLLBACK.sql (RESET).
-- PROBE:    supabase/migrations/PROBE_20261031_0602_s10_p8_autovacuum.sql
-- The gate itself closes only after 7 days of readings under normal traffic.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_devices', 'user_notifications', 'activity_logs', 'user_roles'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'S10-P8-PRE-001: public.% does not exist on this lane', t;
    END IF;
  END LOOP;
END
$pre$;

ALTER TABLE public.user_devices       SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 0);
ALTER TABLE public.user_notifications SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 0);
ALTER TABLE public.activity_logs      SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 0);
ALTER TABLE public.user_roles         SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 0);

DO $post$
DECLARE t text; opts text[];
BEGIN
  FOREACH t IN ARRAY ARRAY['user_devices', 'user_notifications', 'activity_logs', 'user_roles'] LOOP
    SELECT reloptions INTO opts FROM pg_class WHERE oid = ('public.' || t)::regclass;
    IF NOT (coalesce('autovacuum_vacuum_scale_factor=0.05' = ANY (opts), false)
            AND coalesce('autovacuum_vacuum_threshold=0' = ANY (opts), false)) THEN
      RAISE EXCEPTION 'S10-P8-POST-001: public.% reloptions are %, not the P8 pair', t, opts;
    END IF;
  END LOOP;
  RAISE NOTICE 'S10 P8 applied (lane %): 4 tables vacuum at 5 %% dead rows (threshold 0)', current_setting('p32.lane');
END
$post$;

COMMIT;
