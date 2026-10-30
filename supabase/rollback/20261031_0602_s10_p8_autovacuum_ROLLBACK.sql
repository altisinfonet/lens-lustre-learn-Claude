-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261031_0602 — S10 P8. Returns the four tables to the cluster
-- autovacuum defaults (RESET of the two storage parameters). profiles keeps
-- 20261004_0001. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.user_devices       RESET (autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold);
ALTER TABLE public.user_notifications RESET (autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold);
ALTER TABLE public.activity_logs      RESET (autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold);
ALTER TABLE public.user_roles         RESET (autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold);

DO $post$
DECLARE t text; opts text[];
BEGIN
  FOREACH t IN ARRAY ARRAY['user_devices', 'user_notifications', 'activity_logs', 'user_roles'] LOOP
    SELECT reloptions INTO opts FROM pg_class WHERE oid = ('public.' || t)::regclass;
    IF EXISTS (SELECT 1 FROM unnest(coalesce(opts, '{}')) o WHERE o LIKE 'autovacuum_vacuum_%') THEN
      RAISE EXCEPTION 'S10-P8-RB-POST: public.% still has %', t, opts;
    END IF;
  END LOOP;
  RAISE NOTICE 'S10 P8 rolled back (lane %)', current_setting('p32.lane');
END
$post$;

COMMIT;
