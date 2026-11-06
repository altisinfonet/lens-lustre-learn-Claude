-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0115 photo blur — READ-ONLY, ENDS IN ROLLBACK.
-- FAIL before 0115 (objects missing); PASS after. Prints COUNTS ONLY (the run
-- log is public).
--
--   P1  photo_blur exists, RLS on, NO table privilege for anon / authenticated
--   P2  the three functions exist and are SECURITY DEFINER; anon may execute
--       the card's read only — never the job's list or record
--   P3  every stored code is well formed (the table check, re-read)
--   P4  coverage: photos posts show · with a code · failed 3 times · still to do
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $p$
DECLARE _n bigint; _shown bigint; _coded bigint; _failed bigint;
BEGIN
  RAISE NOTICE 'PROBE 0115 lane % at %', coalesce(current_setting('p32.lane', true), '?'), now();

  -- P1
  IF to_regclass('public.photo_blur') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P1: public.photo_blur is missing (expected before 0115 is applied)';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.photo_blur'::regclass) THEN
    RAISE EXCEPTION 'PROBE FAIL P1: RLS is off on photo_blur';
  END IF;
  IF has_table_privilege('anon', 'public.photo_blur', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.photo_blur', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'PROBE FAIL P1: anon or authenticated holds a privilege on photo_blur';
  END IF;

  -- P2
  IF to_regprocedure('public.post_photo_blurs(uuid[])') IS NULL OR to_regprocedure('public.photo_blur_todo(integer)') IS NULL
     OR to_regprocedure('public.photo_blur_record(jsonb)') IS NULL OR to_regprocedure('public.photo_blur_pending()') IS NULL
     OR to_regprocedure('public.photo_blur_wanted()') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P2: a 0115 function is missing';
  END IF;
  SELECT count(*) INTO _n FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('public.post_photo_blurs(uuid[])'), to_regprocedure('public.photo_blur_todo(integer)'),
                   to_regprocedure('public.photo_blur_record(jsonb)'), to_regprocedure('public.photo_blur_pending()'))
     AND p.prosecdef;
  IF _n <> 4 THEN RAISE EXCEPTION 'PROBE FAIL P2: % of 4 functions are SECURITY DEFINER', _n; END IF;
  IF NOT has_function_privilege('anon', 'public.post_photo_blurs(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.photo_blur_pending()', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL P2: anon cannot run the card read or the schedule gate';
  END IF;
  IF has_function_privilege('anon', 'public.photo_blur_todo(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.photo_blur_record(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.photo_blur_wanted()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.photo_blur_wanted()', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL P2: anon may run the job list / record, or the internal list is granted';
  END IF;

  -- P3
  SELECT count(*) INTO _n FROM public.photo_blur b
   WHERE b.url !~ '^https://' OR (b.hash IS NOT NULL AND b.hash !~ '^[A-Za-z0-9+/]{6,48}={0,2}$');
  IF _n > 0 THEN RAISE EXCEPTION 'PROBE FAIL P3: % malformed row(s)', _n; END IF;

  -- P4 (counts only)
  CREATE TEMP TABLE _shown ON COMMIT DROP AS
    SELECT DISTINCT s.src FROM public.posts p
     CROSS JOIN LATERAL unnest(coalesce(p.image_urls, '{}'::text[]) || coalesce(ARRAY[p.image_url], '{}'::text[])) AS s(src)
     WHERE s.src ~ '^https://' AND s.src !~* '\.(mp4|m3u8|mov|webm|m4v)(\?|#|$)';
  SELECT count(*) INTO _shown FROM _shown;
  SELECT count(*) INTO _coded FROM _shown s JOIN public.photo_blur b ON b.url = s.src AND b.hash IS NOT NULL;
  SELECT count(*) INTO _failed FROM _shown s JOIN public.photo_blur b ON b.url = s.src AND b.hash IS NULL AND b.tries >= 3;
  RAISE NOTICE '  photos shown by posts: % · with a blur code: % · failed 3 times: % · still to do: %',
    _shown, _coded, _failed, _shown - _coded - _failed;
  RAISE NOTICE 'PROBE PASS 0115 (codes: %, to do: %)', _coded, _shown - _coded - _failed;
END
$p$;
ROLLBACK;
