-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S10 P26 · how much would "store the change" save? (measure first)
-- READ ONLY, ROLLBACK. Never fails on findings. Prints sizes, counts and
-- site_settings key names only — never row values, ids or e-mails.
--
-- Gate (docs/gates/GATE_REGISTER.md P26): audit triggers limited to money,
-- permissions and deletions; the change stored rather than two full row
-- copies; rows older than a stated window moved out of the live database.
-- PROBE 0622 (production 41187337459) showed 443 site_settings UPDATE rows
-- holding 10 MB of 13 MB. This measures, per (table, operation) and per
-- site_settings key, the bytes stored today against two ways of storing the
-- change:
--   top   only the top-level columns whose value changed (old and new side)
--   deep  as top, but where both sides of a changed column are JSON objects,
--         only their changed keys (one level down)
-- and how many UPDATE rows changed nothing at all (skipped by either rule).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $probe$
DECLARE
  r record; k text; o jsonb; n jsonb;
  top_b bigint; deep_b bigint; full_b bigint;
  agg jsonb := '{}'::jsonb; key text; cur jsonb;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;
  RAISE NOTICE 'P0625|lane=%|at=%', current_setting('p32.lane'), date_trunc('second', now());
  IF to_regclass('public.db_audit_logs') IS NULL THEN
    RAISE NOTICE 'P0625|db_audit_logs missing'; RETURN;
  END IF;

  FOR r IN SELECT table_name, operation, row_id, old_data, new_data FROM public.db_audit_logs
            WHERE operation = 'UPDATE' AND jsonb_typeof(old_data) = 'object' AND jsonb_typeof(new_data) = 'object' LOOP
    full_b := octet_length(r.old_data::text) + octet_length(r.new_data::text);
    top_b := 0; deep_b := 0;
    FOR k IN SELECT x FROM (SELECT jsonb_object_keys(r.old_data) x UNION SELECT jsonb_object_keys(r.new_data)) s LOOP
      o := r.old_data -> k; n := r.new_data -> k;
      CONTINUE WHEN o IS NOT DISTINCT FROM n;
      top_b := top_b + coalesce(octet_length(o::text), 0) + coalesce(octet_length(n::text), 0) + 2 * octet_length(k);
      IF jsonb_typeof(o) = 'object' AND jsonb_typeof(n) = 'object' THEN
        deep_b := deep_b + 2 * octet_length(k) + coalesce((
          SELECT sum(coalesce(octet_length((o -> j)::text), 0) + coalesce(octet_length((n -> j)::text), 0) + 2 * octet_length(j))
            FROM (SELECT jsonb_object_keys(o) j UNION SELECT jsonb_object_keys(n)) s2
           WHERE (o -> j) IS DISTINCT FROM (n -> j)), 0);
      ELSE
        deep_b := deep_b + coalesce(octet_length(o::text), 0) + coalesce(octet_length(n::text), 0) + 2 * octet_length(k);
      END IF;
    END LOOP;
    key := r.table_name || CASE WHEN r.table_name = 'site_settings' THEN ':' || coalesce(r.row_id, '?') ELSE '' END;
    cur := coalesce(agg -> key, '{"n":0,"same":0,"full":0,"top":0,"deep":0}'::jsonb);
    agg := agg || jsonb_build_object(key, jsonb_build_object(
      'n', (cur->>'n')::bigint + 1,
      'same', (cur->>'same')::bigint + CASE WHEN top_b = 0 THEN 1 ELSE 0 END,
      'full', (cur->>'full')::bigint + full_b,
      'top', (cur->>'top')::bigint + top_b,
      'deep', (cur->>'deep')::bigint + deep_b));
  END LOOP;

  FOR r IN SELECT e.key, (e.value->>'n')::bigint n, (e.value->>'same')::bigint same, (e.value->>'full')::bigint f,
                  (e.value->>'top')::bigint t, (e.value->>'deep')::bigint d
             FROM jsonb_each(agg) e ORDER BY (e.value->>'full')::bigint DESC LOOP
    RAISE NOTICE 'P0625|update|%|rows=%|changed_nothing=%|full=%|top=%|deep=%',
      r.key, r.n, r.same, pg_size_pretty(r.f), pg_size_pretty(r.t), pg_size_pretty(r.d);
  END LOOP;

  FOR r IN SELECT sum((e.value->>'n')::bigint) n, sum((e.value->>'full')::bigint) f,
                  sum((e.value->>'top')::bigint) t, sum((e.value->>'deep')::bigint) d FROM jsonb_each(agg) e LOOP
    RAISE NOTICE 'P0625|update|ALL|rows=%|full=%|top=%|deep=%', r.n, pg_size_pretty(r.f), pg_size_pretty(r.t), pg_size_pretty(r.d);
  END LOOP;

  FOR r IN SELECT table_name, operation, count(*) c,
                  sum(coalesce(octet_length(old_data::text), 0) + coalesce(octet_length(new_data::text), 0)) b
             FROM public.db_audit_logs WHERE operation IN ('INSERT', 'DELETE') GROUP BY 1, 2 ORDER BY 4 DESC LIMIT 20 LOOP
    RAISE NOTICE 'P0625|%|%|rows=%|stored=%', lower(r.operation), r.table_name, r.c, pg_size_pretty(r.b);
  END LOOP;

  FOR r IN SELECT width_bucket(extract(epoch FROM now() - created_at) / 86400, ARRAY[30, 60, 90, 120, 180, 365]) b, count(*) c,
                  min(created_at) lo, max(created_at) hi FROM public.db_audit_logs GROUP BY 1 ORDER BY 1 LOOP
    RAISE NOTICE 'P0625|age_bucket|%|rows=%|from=%|to=%', r.b, r.c, date_trunc('day', r.lo), date_trunc('day', r.hi);
  END LOOP;
  RAISE NOTICE 'P0625|done';
END
$probe$;

ROLLBACK;
