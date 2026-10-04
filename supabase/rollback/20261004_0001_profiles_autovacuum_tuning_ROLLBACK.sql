-- ROLLBACK · P1-H · 20261004_0001 — back to the cluster defaults on public.profiles.
-- RESET of the two storage parameters the apply set; no other option is touched.
-- Lane guard: staging | production.
BEGIN;
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %).',
      coalesce(current_setting('p32.lane', true), '(unset)') USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.profiles RESET (autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold);
COMMIT;
