-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0111 the server draws a new photo's credit (credit U3).
-- READ-ONLY, ENDS IN ROLLBACK.
-- PASS when
--   C1 photo_set_credit exists with RLS on and no grant to anon / authenticated,
--      and its key check takes a v3 photo and refuses anything else;
--   C2 the four worker functions exist, SECURITY DEFINER with search_path '',
--      executable by authenticated, NOT by anon / PUBLIC, each body refusing with
--      media_derivative_worker_ok() first;
--   C3 the helper is not executable by anon / authenticated, and every key it
--      names is a v3 photo of this lane's shape;
--   C4 photo_l4_rectify.credit_version defaults to 5, and the 4-argument
--      photo_old_credit_record refuses a version below 5.
-- FAIL before the apply (C1: the table does not exist).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $p$
DECLARE _f text; _def text; _n bigint; _bad bigint; _ok boolean;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  -- C1
  IF to_regclass('public.photo_set_credit') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL C1: 20261110_0111 is not applied on this lane (table missing)';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.photo_set_credit'::regclass) THEN
    RAISE EXCEPTION 'PROBE FAIL C1: RLS is off on photo_set_credit';
  END IF;
  IF has_table_privilege('anon', 'public.photo_set_credit', 'SELECT') OR has_table_privilege('authenticated', 'public.photo_set_credit', 'SELECT')
     OR has_table_privilege('authenticated', 'public.photo_set_credit', 'INSERT') OR has_table_privilege('authenticated', 'public.photo_set_credit', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.photo_set_credit', 'DELETE') THEN
    RAISE EXCEPTION 'PROBE FAIL C1: photo_set_credit is granted to anon or authenticated';
  END IF;
  INSERT INTO public.photo_set_credit (photo_key, credit_version, drawn, origin)
  VALUES ('post-images/11111111-2222-4333-8444-555555555555/posts/probe-0-w1080h810-l5.webp', 5, true, 'server');
  _ok := false;
  BEGIN
    INSERT INTO public.photo_set_credit (photo_key, credit_version, drawn, origin)
    VALUES ('post-images/11111111-2222-4333-8444-555555555555/posts/probe-0-w1080h810-l5-r2048c.webp', 5, true, 'server');
  EXCEPTION WHEN check_violation THEN _ok := true;
  END;
  IF NOT _ok THEN RAISE EXCEPTION 'PROBE FAIL C1: the key check took a credited sibling'; END IF;
  -- C2
  FOREACH _f IN ARRAY ARRAY['public.photo_set_credit_queue(integer,text)', 'public.photo_set_credit_target(text)',
                            'public.photo_set_credit_record(text,integer,boolean,text)', 'public.photo_old_credit_record(uuid,integer,text,integer)'] LOOP
    IF to_regprocedure(_f) IS NULL THEN RAISE EXCEPTION 'PROBE FAIL C2: % is missing', _f; END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(_f)) THEN RAISE EXCEPTION 'PROBE FAIL C2: % is not SECURITY DEFINER', _f; END IF;
    IF NOT coalesce((SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_proc p WHERE p.oid = to_regprocedure(_f)), false) THEN
      RAISE EXCEPTION 'PROBE FAIL C2: % has no empty search_path', _f;
    END IF;
    IF NOT has_function_privilege('authenticated', _f, 'EXECUTE') THEN RAISE EXCEPTION 'PROBE FAIL C2: authenticated cannot execute %', _f; END IF;
    IF has_function_privilege('anon', _f, 'EXECUTE') THEN RAISE EXCEPTION 'PROBE FAIL C2: anon can execute %', _f; END IF;
    _def := pg_get_functiondef(to_regprocedure(_f));
    IF position('IF NOT public.media_derivative_worker_ok()' IN _def) = 0 THEN RAISE EXCEPTION 'PROBE FAIL C2: % does not refuse non-workers', _f; END IF;
  END LOOP;
  -- C3
  IF has_function_privilege('anon', 'public.photo_set_credit_named()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.photo_set_credit_named()', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL C3: photo_set_credit_named is executable by anon or authenticated';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE n.photo_key !~ '-l5f?\.webp$' OR n.photo_key ~ '^https?:') INTO _n, _bad FROM public.photo_set_credit_named() n;
  IF _bad > 0 THEN RAISE EXCEPTION 'PROBE FAIL C3: % named key(s) are not v3 photos', _bad; END IF;
  -- C4
  IF (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       WHERE d.adrelid = 'public.photo_l4_rectify'::regclass AND a.attname = 'credit_version') IS DISTINCT FROM '5' THEN
    RAISE EXCEPTION 'PROBE FAIL C4: photo_l4_rectify.credit_version does not default to 5';
  END IF;
  IF position('_version < 5' IN pg_get_functiondef('public.photo_old_credit_record(uuid,integer,text,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'PROBE FAIL C4: the old-credit record takes a version below 5';
  END IF;
  RAISE NOTICE 'PROBE PASS 20261110_0111 on %: % v3 photo(s) named, % recorded', current_setting('p32.lane'), _n,
    (SELECT count(*) FROM public.photo_set_credit WHERE recorded_at < now() - interval '1 second');
END
$p$;
ROLLBACK;
