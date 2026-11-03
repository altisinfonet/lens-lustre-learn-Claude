-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0108 credit redraw (photo plan v3). READ-ONLY, ENDS IN ROLLBACK.
-- PASS when
--   D1 the column and the three worker functions exist: SECURITY DEFINER,
--      search_path '', authenticated may run them, anon may not, and each body
--      refuses non-workers (PHOTO-RX-001);
--   D2 every rectified photo a post still shows carries the v3 credit
--      (credit_version >= 3) — i.e. the redraw has run on this lane.
-- FAIL before the apply (D1) and after the apply until the redraw ran (D2).
-- Counts only, no member data.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $p$
DECLARE _f text; _old bigint; _all bigint;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'photo_l4_rectify' AND column_name = 'credit_version') THEN
    RAISE EXCEPTION 'PROBE FAIL D1: 20261110_0108 is not applied on this lane (credit_version missing)';
  END IF;
  FOREACH _f IN ARRAY ARRAY['public.photo_credit_redraw_queue(integer)', 'public.photo_credit_redraw_target(uuid,integer)', 'public.photo_credit_redraw_record(uuid,integer,integer)'] LOOP
    IF to_regprocedure(_f) IS NULL THEN RAISE EXCEPTION 'PROBE FAIL D1: % is missing', _f; END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(_f)) THEN RAISE EXCEPTION 'PROBE FAIL D1: % is not SECURITY DEFINER', _f; END IF;
    IF NOT coalesce((SELECT 'search_path=""' = ANY (p.proconfig) FROM pg_proc p WHERE p.oid = to_regprocedure(_f)), false) THEN RAISE EXCEPTION 'PROBE FAIL D1: % has no empty search_path', _f; END IF;
    IF NOT has_function_privilege('authenticated', _f, 'EXECUTE') THEN RAISE EXCEPTION 'PROBE FAIL D1: authenticated cannot run %', _f; END IF;
    IF has_function_privilege('anon', _f, 'EXECUTE') THEN RAISE EXCEPTION 'PROBE FAIL D1: anon can run %', _f; END IF;
    IF position('media_derivative_worker_ok()' IN (SELECT pg_get_functiondef(to_regprocedure(_f)))) = 0
       OR position('PHOTO-RX-001' IN (SELECT pg_get_functiondef(to_regprocedure(_f)))) = 0 THEN
      RAISE EXCEPTION 'PROBE FAIL D1: % does not refuse non-workers (PHOTO-RX-001)', _f;
    END IF;
  END LOOP;
  SELECT count(*) FILTER (WHERE x.credit_version < 3), count(*) INTO _old, _all
    FROM public.photo_l4_rectify x JOIN public.posts p ON p.id = x.post_id AND p.image_urls[x.ord + 1] = x.new_url;
  RAISE NOTICE 'credit redraw (lane %): rectified photos shown=% · with an older credit than v3=%', current_setting('p32.lane'), _all, _old;
  IF _old > 0 THEN RAISE EXCEPTION 'PROBE FAIL D2: % shown rectified photo(s) still carry an older credit than v3', _old; END IF;
  RAISE NOTICE 'PROBE PASS: 20261110_0108 — functions gated; all % shown rectified photo(s) carry the v3 credit (lane %)', _all, current_setting('p32.lane');
END
$p$;

ROLLBACK;
