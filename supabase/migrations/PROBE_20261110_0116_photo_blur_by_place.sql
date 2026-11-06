-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0116 photo blur by place — READ-ONLY, ENDS IN ROLLBACK.
-- FAIL before 0116 (the read has no `ord`); PASS after. Counts only.
--   P1  post_photo_blurs returns ord, is SECURITY DEFINER, anon may run it
--   P2  every code it can return sits at a place the post shows (ord in range)
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $p$
DECLARE _n bigint; _bad bigint;
BEGIN
  RAISE NOTICE 'PROBE 0116 lane % at %', coalesce(current_setting('p32.lane', true), '?'), now();
  IF to_regprocedure('public.post_photo_blurs(uuid[])') IS NULL
     OR NOT ('ord' = ANY ((SELECT p.proargnames FROM pg_proc p WHERE p.oid = to_regprocedure('public.post_photo_blurs(uuid[])')))) THEN
    RAISE EXCEPTION 'PROBE FAIL P1: post_photo_blurs does not return ord (expected before 0116 is applied)';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure('public.post_photo_blurs(uuid[])'))
     OR NOT has_function_privilege('anon', 'public.post_photo_blurs(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL P1: post_photo_blurs is not SECURITY DEFINER or anon cannot run it';
  END IF;
  -- P2 · the same join the read uses, without the viewer gate (counts only).
  SELECT count(*), count(*) FILTER (WHERE u.o < 1 OR u.o > greatest(cardinality(coalesce(p.image_urls, '{}'::text[])), 1))
    INTO _n, _bad
    FROM public.posts p
   CROSS JOIN LATERAL unnest(CASE WHEN cardinality(coalesce(p.image_urls, '{}'::text[])) > 0 THEN p.image_urls
                                  ELSE coalesce(ARRAY[p.image_url], '{}'::text[]) END) WITH ORDINALITY AS u(src, o)
    JOIN public.photo_blur b ON b.url = u.src AND b.hash IS NOT NULL;
  IF _bad > 0 THEN RAISE EXCEPTION 'PROBE FAIL P2: % code(s) at a place outside the post', _bad; END IF;
  RAISE NOTICE 'PROBE PASS 0116 (photo places with a code: %)', _n;
END
$p$;
ROLLBACK;
