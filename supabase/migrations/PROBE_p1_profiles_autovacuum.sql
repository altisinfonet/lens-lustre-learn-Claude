-- PROBE · P1-H · public.profiles autovacuum — LIVE half. READ-ONLY. Raises on a hit.
-- (a) profiles must carry autovacuum_vacuum_scale_factor ≤ 0.05 and
--     autovacuum_vacuum_threshold ≤ 0.05 × max(reltuples, 1) — i.e. the trigger
--     fires before the dead-row ratio can reach 5 % + one naptime of writes;
-- (b) per-table autovacuum must not be disabled (autovacuum_enabled=false).
-- Also reports the current ratio (monitor only — R-82: it never blocks).
BEGIN READ ONLY;
DO $probe$
DECLARE
  opts text[]; sf numeric; th numeric; n numeric; ratio numeric;
BEGIN
  SELECT reloptions, greatest(reltuples, 1) INTO opts, n FROM pg_class WHERE oid = 'public.profiles'::regclass;
  sf := coalesce((SELECT split_part(o, '=', 2)::numeric FROM unnest(opts) o WHERE o LIKE 'autovacuum_vacuum_scale_factor=%'),
                 current_setting('autovacuum_vacuum_scale_factor')::numeric);
  th := coalesce((SELECT split_part(o, '=', 2)::numeric FROM unnest(opts) o WHERE o LIKE 'autovacuum_vacuum_threshold=%'),
                 current_setting('autovacuum_vacuum_threshold')::numeric);
  IF 'autovacuum_enabled=false' = ANY (coalesce(opts, '{}')) THEN
    RAISE EXCEPTION 'PROBE FAIL P1-H: autovacuum is disabled on public.profiles';
  END IF;
  IF sf > 0.05 OR th > 0.05 * n THEN
    RAISE EXCEPTION 'PROBE FAIL P1-H: profiles autovacuum trigger is % + % × % rows — the dead-row ratio can reach % %% before a vacuum (limit 5 %%)',
      th, sf, n, round(100 * (th + sf * n) / (n + th + sf * n), 1);
  END IF;
  SELECT round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) INTO ratio
    FROM pg_stat_user_tables WHERE relid = 'public.profiles'::regclass;
  RAISE NOTICE 'PROBE PASS P1-H: trigger % + % × % rows (max ≈ % %% before a vacuum); dead now % %% (monitor)',
    th, sf, n, round(100 * (th + sf * n) / (n + th + sf * n), 1), coalesce(ratio, 0);
END
$probe$;
ROLLBACK;
