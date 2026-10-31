-- ROLLBACK · 20261104_0190 mutual follows. Drops the read-only function.
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted';
  END IF;
END
$lane_guard$;

DO $pre$
BEGIN
  IF to_regprocedure('public.notif_mutual_follow_counts(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'NC-0190-RB-PRE-001: 20261104_0190 is not applied on this lane — nothing to roll back';
  END IF;
END
$pre$;

DROP FUNCTION public.notif_mutual_follow_counts(uuid[]);

COMMIT;
