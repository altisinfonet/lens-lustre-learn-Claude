-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · S10 P34 · how role checks read public.user_roles today (measure first).
-- READ ONLY, ROLLBACK. Never fails on findings. Prints schema metadata,
-- counters and plan shapes only; no row data (plans use the nil uuid).
--
-- P34 gate (docs/gates/GATE_REGISTER.md): user_roles sequential scans ~0 after
-- the change; every role check in a policy or helper function demonstrably uses
-- the (user_id, role) index; repeated at 1 M seeded rows (that clause waits for
-- the seeder ruling). This PROBE is the "before" for clauses 1 and 2:
--   A  user_roles: column types, rows/pages/all-visible pages, scan counters
--      (seq vs index, since the last stats reset), every index with its scans.
--   B  every function (any non-system schema) whose body names user_roles,
--      flagged when it compares role through a ::text cast.
--   C  every policy whose USING / WITH CHECK names user_roles directly.
--   D  the plan of each query shape found in B/C, with the planner's default
--      settings and with enable_seqscan off (can an index serve it at all?),
--      scan lines only; plus one EXPLAIN ANALYZE of the exact (user_id, role)
--      check for index-only "Heap Fetches".
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $probe$
DECLARE
  rec record; ln text; plan text; out text := '';
  nil constant text := '00000000-0000-0000-0000-000000000000';
  shapes text[][] := ARRAY[
    ['S1 exact', format('SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = %L::uuid AND role = %L)', nil, 'admin')],
    ['S2 exact, role::text', format('SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = %L::uuid AND role::text = %L)', nil, 'admin')],
    ['S3 role only', format('SELECT user_id FROM public.user_roles WHERE role = %L', 'admin')],
    ['S4 role only, role::text', format('SELECT user_id FROM public.user_roles WHERE role::text = %L', 'admin')],
    ['S5 user_id only', format('SELECT role FROM public.user_roles WHERE user_id = %L::uuid', nil)],
    ['S6 user_id list, role::text IN', format('SELECT user_id FROM public.user_roles WHERE user_id = ANY (ARRAY[%L]::uuid[]) AND role::text IN (%L, %L)', nil, 'admin', 'moderator')]
  ];
  i int; n_text int;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;
  IF to_regclass('public.user_roles') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL 20261031_0621: public.user_roles missing';
  END IF;

  -- A ---------------------------------------------------------------------
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
    INTO ln FROM pg_attribute a
   WHERE a.attrelid = 'public.user_roles'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  out := out || E'\n  A columns: ' || ln;

  SELECT format('rows~%s pages=%s all_visible=%s | seq_scan=%s seq_tup_read=%s idx_scan=%s | n_live=%s n_dead=%s | stats since %s',
                c.reltuples::bigint, c.relpages, c.relallvisible,
                s.seq_scan, s.seq_tup_read, s.idx_scan, s.n_live_tup, s.n_dead_tup,
                coalesce(date_trunc('minute', d.stats_reset)::text, 'cluster start'))
    INTO ln
    FROM pg_class c
    JOIN pg_stat_user_tables s ON s.relid = c.oid
    LEFT JOIN pg_stat_database d ON d.datname = current_database()
   WHERE c.oid = 'public.user_roles'::regclass;
  out := out || E'\n  A counters: ' || ln;

  FOR rec IN
    SELECT i.indexrelid::regclass::text AS name, pg_get_indexdef(i.indexrelid) AS def, s.idx_scan
      FROM pg_index i LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.indexrelid
     WHERE i.indrelid = 'public.user_roles'::regclass ORDER BY 1
  LOOP
    out := out || format(E'\n  A index %s scans=%s: %s', rec.name, rec.idx_scan, rec.def);
  END LOOP;

  -- B ---------------------------------------------------------------------
  SELECT count(*),
         count(*) FILTER (WHERE p.prosrc ~* 'role\s*::\s*text'),
         string_agg(n.nspname || '.' || p.proname || CASE WHEN p.prosrc ~* 'role\s*::\s*text' THEN '[::text]' ELSE '' END
                    || CASE WHEN p.prosecdef THEN '[definer]' ELSE '' END, ', ' ORDER BY n.nspname, p.proname)
    INTO i, n_text, ln
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prosrc ~* 'user_roles'
     AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\_%';
  out := out || format(E'\n  B functions naming user_roles: %s (role compared through ::text: %s)\n    %s', i, n_text, coalesce(ln, 'none'));

  -- C ---------------------------------------------------------------------
  SELECT count(*), string_agg(c.relname || '.' || p.polname, ', ' ORDER BY c.relname, p.polname)
    INTO i, ln
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
         ~* 'user_roles';
  out := out || format(E'\n  C policies naming user_roles directly: %s\n    %s', i, coalesce(ln, 'none'));

  -- D ---------------------------------------------------------------------
  FOR i IN 1 .. array_length(shapes, 1) LOOP
    FOREACH ln IN ARRAY ARRAY['on', 'off'] LOOP
      PERFORM set_config('enable_seqscan', ln, true);
      plan := '';
      FOR rec IN EXECUTE 'EXPLAIN (COSTS OFF) ' || shapes[i][2] LOOP
        IF rec."QUERY PLAN" ~ '(Scan|Index Cond|Filter)' THEN
          plan := plan || CASE WHEN plan = '' THEN '' ELSE ' / ' END || btrim(regexp_replace(rec."QUERY PLAN", '^\s*->\s*', ''));
        END IF;
      END LOOP;
      out := out || format(E'\n  D %s (seqscan %s): %s', shapes[i][1], ln, plan);
    END LOOP;
  END LOOP;
  PERFORM set_config('enable_seqscan', 'off', true);
  plan := '';
  FOR rec IN EXECUTE 'EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF) ' || shapes[1][2] LOOP
    IF rec."QUERY PLAN" ~ '(Scan|Heap Fetches)' THEN
      plan := plan || ' / ' || btrim(regexp_replace(rec."QUERY PLAN", '^\s*->\s*', ''));
    END IF;
  END LOOP;
  PERFORM set_config('enable_seqscan', 'on', true);
  out := out || E'\n  D S1 executed (seqscan off):' || plan;

  RAISE NOTICE 'P34 ROLE CHECKS (lane %):%', current_setting('p32.lane'), out;
END
$probe$;

ROLLBACK;
