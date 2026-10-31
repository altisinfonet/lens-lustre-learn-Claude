-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261031_0602 — S10 P8 autovacuum (staging and production).
-- READ ONLY, ROLLBACK. Counts and ratios only.
-- FAILS before 0602 (G1: a named table runs on the defaults); PASSES after.
--   G1 · profiles, user_devices, user_notifications, activity_logs and
--        user_roles each carry scale factor 0.05 and threshold 0.
--   Info · per table: live rows, dead rows, dead-row ratio now, last
--        autovacuum/autoanalyze age — the readings the 7-day gate is judged on.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $probe$
DECLARE
  r record;
  bad text := '';
  info text := '';
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;

  FOR r IN
    SELECT t.name,
           c.reloptions,
           coalesce(s.n_live_tup, 0) AS live, coalesce(s.n_dead_tup, 0) AS dead,
           s.last_autovacuum, s.last_autoanalyze
      FROM unnest(ARRAY['profiles', 'user_devices', 'user_notifications', 'activity_logs', 'user_roles']) AS t(name)
      LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || t.name)
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
  LOOP
    IF NOT (coalesce('autovacuum_vacuum_scale_factor=0.05' = ANY (r.reloptions), false)
            AND coalesce('autovacuum_vacuum_threshold=0' = ANY (r.reloptions), false)) THEN
      bad := bad || format(' G1(%s on defaults)', r.name);
    END IF;
    info := info || format(E'\n  %-18s live=%s dead=%s ratio=%s%% last_autovacuum=%s',
      r.name, r.live, r.dead,
      CASE WHEN r.live + r.dead = 0 THEN '0' ELSE round(100.0 * r.dead / (r.live + r.dead), 1)::text END,
      coalesce(date_trunc('minute', now() - r.last_autovacuum)::text || ' ago', 'never'));
  END LOOP;

  IF bad <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0602 (lane %):% |%', current_setting('p32.lane'), bad, info;
  END IF;
  RAISE NOTICE 'PROBE PASS 20261031_0602 (lane %): 5 tables vacuum at 5 %% dead rows%', current_setting('p32.lane'), info;
END
$probe$;

ROLLBACK;
