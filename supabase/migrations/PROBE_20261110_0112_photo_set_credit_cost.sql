-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0112 one photo, one look-up (credit U3).
-- READ-ONLY (the transaction is set read only), ENDS IN ROLLBACK.
--
-- THE COST LIMIT, read from this transaction's own counters as the worker:
--   target call   0 full reads of posts or competition_entries, ≤ 20 rows read
--   record call   0 full reads, ≤ 20 rows read
--   queue claim   ≤ 1 full read of each table (2), for up to 100 photos
-- so a sweep costs 3 look-ups per photo and one read of each table per 100.
-- The key asked for is one no row names, the worst case: nothing stops early.
--
-- PASS when
--   C1 target stays within the limit;
--   C2 record stays within the limit and still refuses the key (PHOTO-SC-002);
--   C3 a queue claim stays within the limit;
--   C4 both indexes are valid GIN indexes on the right column, fastupdate off;
--   C5 the helper is not executable by anon / authenticated, carries
--      enable_seqscan off and named()'s exact key shape, and neither per-photo
--      function reads named() any more;
--   C6 the helper agrees with named() on every named key, and says false for
--      NULL, a wrong shape, a URL with a query and a key no row names.
-- FAIL before the apply (C1: 0111's target reads both tables in full).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
CREATE FUNCTION pg_temp.credit_reads(OUT full_reads bigint, OUT rows_read bigint)
LANGUAGE sql VOLATILE AS $f$
  SELECT coalesce(sum(s.seq_scan), 0)::bigint,
         coalesce(sum(s.seq_tup_read + coalesce(s.idx_tup_fetch, 0)), 0)::bigint
    FROM pg_catalog.pg_stat_xact_user_tables s
   WHERE s.schemaname = 'public' AND s.relname IN ('posts', 'competition_entries')
$f$;
SET TRANSACTION READ ONLY;
DO $p$
DECLARE
  _max_rows constant bigint := 20;
  _unnamed  constant text := 'post-images/11111111-2222-4333-8444-555555555555/posts/probe-unnamed-w1080h810-l5.webp';
  _shape    constant text := '[A-Za-z0-9_.-]+-w[0-9]{1,5}h[0-9]{1,5}-l5f?\.webp$';
  _uid uuid; _f0 bigint; _r0 bigint; _f1 bigint; _r1 bigint; _n bigint; _bad bigint; _ok boolean; _i text;
  _target_rows bigint; _record_rows bigint; _queue_full bigint;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regprocedure('public.photo_set_credit_target(text)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL C1: 20261110_0111 is not applied on this lane';
  END IF;
  -- Act as the worker, as the queue's own gate demands. Local to this transaction.
  SELECT ur.user_id INTO _uid FROM public.user_roles ur WHERE ur.role = 'admin'::public.app_role LIMIT 1;
  IF _uid IS NULL THEN RAISE EXCEPTION 'PROBE FAIL C1: no admin account to act as on this lane'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);

  -- C1
  SELECT * INTO _f0, _r0 FROM pg_temp.credit_reads();
  PERFORM * FROM public.photo_set_credit_target(_unnamed);
  SELECT * INTO _f1, _r1 FROM pg_temp.credit_reads();
  _target_rows := _r1 - _r0;
  IF _f1 - _f0 > 0 OR _target_rows > _max_rows THEN
    RAISE EXCEPTION 'PROBE FAIL C1: one target call made % full table read(s) and read % row(s) (limit 0 and %)',
      _f1 - _f0, _target_rows, _max_rows;
  END IF;

  -- C2
  SELECT * INTO _f0, _r0 FROM pg_temp.credit_reads();
  _ok := false;
  BEGIN
    PERFORM public.photo_set_credit_record(_unnamed, 5, true, 'server');
  EXCEPTION WHEN invalid_parameter_value THEN _ok := SQLERRM LIKE 'PHOTO-SC-002%';
  END;
  SELECT * INTO _f1, _r1 FROM pg_temp.credit_reads();
  _record_rows := _r1 - _r0;
  IF NOT _ok THEN RAISE EXCEPTION 'PROBE FAIL C2: record did not refuse a key no row names'; END IF;
  IF _f1 - _f0 > 0 OR _record_rows > _max_rows THEN
    RAISE EXCEPTION 'PROBE FAIL C2: one record call made % full table read(s) and read % row(s) (limit 0 and %)',
      _f1 - _f0, _record_rows, _max_rows;
  END IF;

  -- C3
  SELECT * INTO _f0, _r0 FROM pg_temp.credit_reads();
  PERFORM * FROM public.photo_set_credit_queue(100, NULL);
  SELECT * INTO _f1, _r1 FROM pg_temp.credit_reads();
  _queue_full := _f1 - _f0;
  IF _queue_full > 2 THEN
    RAISE EXCEPTION 'PROBE FAIL C3: one queue claim made % full table reads (limit 2: one of each table)', _queue_full;
  END IF;

  -- C4
  FOREACH _i IN ARRAY ARRAY['public.idx_posts_image_urls_gin|public.posts|image_urls',
                            'public.idx_competition_entries_photos_gin|public.competition_entries|photos'] LOOP
    IF NOT coalesce((
      SELECT x.indisvalid AND x.indisready AND am.amname = 'gin'
             AND x.indrelid = split_part(_i, '|', 2)::regclass
             AND c.reloptions @> ARRAY['fastupdate=off']
             AND pg_get_indexdef(x.indexrelid, 1, true) = split_part(_i, '|', 3)
        FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid JOIN pg_am am ON am.oid = c.relam
       WHERE x.indexrelid = to_regclass(split_part(_i, '|', 1))), false) THEN
      RAISE EXCEPTION 'PROBE FAIL C4: % is not a valid GIN index, fastupdate off, on %.%',
        split_part(_i, '|', 1), split_part(_i, '|', 2), split_part(_i, '|', 3);
    END IF;
  END LOOP;

  -- C5
  IF to_regprocedure('public.photo_set_credit_is_named(text)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL C5: photo_set_credit_is_named is missing';
  END IF;
  IF has_function_privilege('anon', 'public.photo_set_credit_is_named(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.photo_set_credit_is_named(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL C5: photo_set_credit_is_named is executable by anon or authenticated';
  END IF;
  IF NOT coalesce((SELECT p.proconfig @> ARRAY['enable_seqscan=off', 'search_path=""'] FROM pg_proc p
                    WHERE p.oid = 'public.photo_set_credit_is_named(text)'::regprocedure), false) THEN
    RAISE EXCEPTION 'PROBE FAIL C5: the helper does not carry enable_seqscan off and an empty search_path';
  END IF;
  IF position(_shape IN pg_get_functiondef('public.photo_set_credit_is_named(text)'::regprocedure)) = 0
     OR position(_shape IN pg_get_functiondef('public.photo_set_credit_named()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'PROBE FAIL C5: the helper and named() do not share one key shape';
  END IF;
  FOREACH _i IN ARRAY ARRAY['public.photo_set_credit_target(text)', 'public.photo_set_credit_record(text,integer,boolean,text)'] LOOP
    IF position('photo_set_credit_named' IN pg_get_functiondef(_i::regprocedure)) > 0
       OR position('photo_set_credit_is_named' IN pg_get_functiondef(_i::regprocedure)) = 0 THEN
      RAISE EXCEPTION 'PROBE FAIL C5: % does not ask the one look-up', _i;
    END IF;
  END LOOP;

  -- C6
  SELECT count(*), count(*) FILTER (WHERE NOT public.photo_set_credit_is_named(n.photo_key)) INTO _n, _bad
    FROM public.photo_set_credit_named() n;
  IF _bad > 0 THEN RAISE EXCEPTION 'PROBE FAIL C6: the helper denies % key(s) named() lists', _bad; END IF;
  IF public.photo_set_credit_is_named(NULL) IS DISTINCT FROM false
     OR public.photo_set_credit_is_named('not-a-photo') IS DISTINCT FROM false
     OR public.photo_set_credit_is_named(_unnamed || '?cv=1') IS DISTINCT FROM false
     OR public.photo_set_credit_is_named(_unnamed) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'PROBE FAIL C6: the helper says yes to something it must refuse';
  END IF;
  RAISE NOTICE 'PROBE PASS 20261110_0112 on %: target % row(s) read, record % row(s), 0 full reads; queue claim % full read(s); % v3 photo(s) named; about % posts, % entries',
    current_setting('p32.lane'), _target_rows, _record_rows, _queue_full, _n,
    (SELECT c.reltuples::bigint FROM pg_class c WHERE c.oid = 'public.posts'::regclass),
    (SELECT c.reltuples::bigint FROM pg_class c WHERE c.oid = 'public.competition_entries'::regclass);
END
$p$;
ROLLBACK;
