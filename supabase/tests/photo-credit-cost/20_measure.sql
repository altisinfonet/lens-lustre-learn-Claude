-- FIXTURE · what one worker call costs, on the REAL functions, as the worker.
-- fx.label names the moment. Prints COST lines; keeps nothing it changes.
CREATE FUNCTION pg_temp.credit_reads(OUT full_reads bigint, OUT rows_read bigint)
LANGUAGE sql VOLATILE AS $f$
  SELECT coalesce(sum(s.seq_scan), 0)::bigint,
         coalesce(sum(s.seq_tup_read + coalesce(s.idx_tup_fetch, 0)), 0)::bigint
    FROM pg_catalog.pg_stat_xact_user_tables s
   WHERE s.schemaname = 'public' AND s.relname IN ('posts', 'competition_entries')
$f$;

DO $m$
DECLARE
  _label text := current_setting('fx.label');
  _keys text[]; _k text; _calls integer; _f0 bigint; _r0 bigint; _f1 bigint; _r1 bigint;
  _t0 timestamptz; _ms numeric; _j json;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  SELECT array_agg(n.photo_key) INTO _keys FROM (SELECT x.photo_key FROM public.photo_set_credit_named() x ORDER BY 1 LIMIT 10) n;
  _calls := cardinality(_keys);

  SELECT * INTO _f0, _r0 FROM pg_temp.credit_reads();
  _t0 := clock_timestamp();
  FOREACH _k IN ARRAY _keys LOOP PERFORM * FROM public.photo_set_credit_target(_k); END LOOP;
  _ms := extract(epoch FROM clock_timestamp() - _t0) * 1000 / _calls;
  SELECT * INTO _f1, _r1 FROM pg_temp.credit_reads();
  -- Every plan is cached by now, so the blocks are the call's own.
  EXECUTE format('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM public.photo_set_credit_target(%L)', _keys[1]) INTO _j;
  RAISE NOTICE 'COST % target: % full table reads, % rows read, % shared blocks, % ms per call',
    _label, round((_f1 - _f0)::numeric / _calls, 1), round((_r1 - _r0)::numeric / _calls, 1),
    coalesce((_j->0->'Plan'->>'Shared Hit Blocks')::bigint, 0) + coalesce((_j->0->'Plan'->>'Shared Read Blocks')::bigint, 0),
    round(_ms, 3);

  SELECT * INTO _f0, _r0 FROM pg_temp.credit_reads();
  BEGIN
    PERFORM public.photo_set_credit_record('post-images/11111111-2222-4333-8444-555555555555/posts/unnamed-w1080h810-l5.webp', 5, true, 'server');
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  SELECT * INTO _f1, _r1 FROM pg_temp.credit_reads();
  RAISE NOTICE 'COST % record: % full table reads, % rows read per call', _label, _f1 - _f0, _r1 - _r0;

  SELECT * INTO _f0, _r0 FROM pg_temp.credit_reads();
  _t0 := clock_timestamp();
  PERFORM * FROM public.photo_set_credit_queue(100, NULL);
  _ms := extract(epoch FROM clock_timestamp() - _t0) * 1000;
  SELECT * INTO _f1, _r1 FROM pg_temp.credit_reads();
  RAISE NOTICE 'COST % queue: % full table reads, % rows read, % ms per claim', _label, _f1 - _f0, _r1 - _r0, round(_ms, 3);

  -- What a write pays: 200 new posts, undone.
  _t0 := clock_timestamp();
  BEGIN
    INSERT INTO public.posts (user_id, content, image_urls)
    SELECT '00000000-0000-4000-8000-000000000001', repeat('fixture post text ', 35),
           ARRAY['https://x.test/a' || g || '.webp', 'https://x.test/b' || g || '.webp']
      FROM generate_series(1, 200) g;
    RAISE EXCEPTION 'fx_undo';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  _ms := extract(epoch FROM clock_timestamp() - _t0) * 1000 / 200;
  RAISE NOTICE 'COST % write: % ms per new post; index size posts % kB, entries % kB', _label, round(_ms, 3),
    coalesce(pg_relation_size(to_regclass('public.idx_posts_image_urls_gin')), 0) / 1024,
    coalesce(pg_relation_size(to_regclass('public.idx_competition_entries_photos_gin')), 0) / 1024;
END
$m$;
