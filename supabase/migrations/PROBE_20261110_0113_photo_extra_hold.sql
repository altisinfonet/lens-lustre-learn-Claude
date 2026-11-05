-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0113 photo extra hold — READ-ONLY, ENDS IN ROLLBACK.
-- FAIL before 0113 (objects missing); PASS after, when nothing a post can show
-- is on the hold list. Prints COUNTS ONLY (the run log is public).
--
--   P1  the four functions exist; mark / claim / record are SECURITY DEFINER;
--       anon may execute none of them; the scan is not granted at all
--   P2  photo_retire accepts post_extra / hold_due / held / restored
--   P3  no queued or held key is a file a post shows (image_urls, thumbnail_urls)
--   P4  no queued or held key is a copy 0112 serves (-l4-r1080 / -l4-thumb) or a
--       -l3 rung, a -l5 / -l6 file, a competition file
--   P5  no queued or held credit copy belongs to an avatars (My Photos) photo
--   P6  every queued or held key is in a member's post-images folder
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $p$
DECLARE _n bigint; _r record; _pre text;
BEGIN
  RAISE NOTICE 'PROBE 0113 lane % at %', coalesce(current_setting('p32.lane', true), '?'), now();

  -- P1
  IF to_regprocedure('public.photo_extra_mark()') IS NULL OR to_regprocedure('public.photo_extra_referenced(text[])') IS NULL
     OR to_regprocedure('public.photo_extra_claim(text,integer,bigint)') IS NULL OR to_regprocedure('public.photo_extra_record(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P1: 0113 functions are missing (expected before 0113 is applied)';
  END IF;
  SELECT count(*) INTO _n FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('public.photo_extra_mark()'), to_regprocedure('public.photo_extra_claim(text,integer,bigint)'), to_regprocedure('public.photo_extra_record(text,jsonb)'))
     AND p.prosecdef;
  IF _n <> 3 THEN RAISE EXCEPTION 'PROBE FAIL P1: % of 3 mover functions are SECURITY DEFINER', _n; END IF;
  IF has_function_privilege('anon', 'public.photo_extra_mark()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.photo_extra_claim(text,integer,bigint)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.photo_extra_record(text,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.photo_extra_referenced(text[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.photo_extra_referenced(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL P1: a 0113 function is executable by anon (or the scan by authenticated)';
  END IF;

  -- P2
  IF pg_get_constraintdef((SELECT c.oid FROM pg_constraint c WHERE c.conrelid = 'public.photo_retire'::regclass AND c.conname = 'photo_retire_kind_check')) !~ 'post_extra'
     OR pg_get_constraintdef((SELECT c.oid FROM pg_constraint c WHERE c.conrelid = 'public.photo_retire'::regclass AND c.conname = 'photo_retire_state_check')) !~ 'hold_due' THEN
    RAISE EXCEPTION 'PROBE FAIL P2: photo_retire does not accept post_extra / hold_due';
  END IF;

  CREATE TEMP TABLE _ex ON COMMIT DROP AS
  SELECT r.object_key AS k, r.state, r.source_table, r.source_id, r.ord FROM public.photo_retire r
   WHERE r.kind = 'post_extra' AND r.state IN ('hold_due', 'held');

  -- P3
  _pre := '^https://[^/]+/';
  SELECT count(*) INTO _n FROM _ex e
   WHERE EXISTS (SELECT 1 FROM public.posts p
                  CROSS JOIN LATERAL unnest(coalesce(p.image_urls, '{}'::text[]) || coalesce(p.thumbnail_urls, '{}'::text[])) u(url)
                  WHERE regexp_replace(regexp_replace(u.url, '[?#].*$', ''), _pre, '') = e.k);
  IF _n > 0 THEN RAISE EXCEPTION 'PROBE FAIL P3: % queued/held key(s) are shown by a post', _n; END IF;

  -- P4
  SELECT count(*) INTO _n FROM _ex e
   WHERE e.k ~ '-l4-(r1080|thumb)\.webp$' OR e.k ~ '-l3(-r[0-9]+|-thumb)?\.webp$' OR e.k ~ '-l[56]f?(-[a-z0-9]+)?\.webp$'
      OR e.k LIKE 'competition-photos/%' OR e.k ~ '/d/';
  IF _n > 0 THEN RAISE EXCEPTION 'PROBE FAIL P4: % queued/held key(s) are a served copy, a rung, a new set file or a competition file', _n; END IF;
  SELECT count(*) INTO _n FROM _ex e
   WHERE e.k !~ '/posts/credit/[^/]+\.webp$' AND e.k !~ '-w[0-9]{1,4}h[0-9]{1,4}-l4(-r320)?\.webp$';
  IF _n > 0 THEN RAISE EXCEPTION 'PROBE FAIL P4: % queued/held key(s) are neither a credit copy nor an -l4 master / 320', _n; END IF;

  -- P5
  SELECT count(*) INTO _n FROM _ex e JOIN public.photo_old_credit c ON c.post_id = e.source_id AND c.ord = e.ord
   WHERE e.source_table = 'photo_old_credit' AND (c.src_url ~ '/avatars/' OR c.src_url !~ '/post-images/');
  IF _n > 0 THEN RAISE EXCEPTION 'PROBE FAIL P5: % queued/held credit copies belong to an avatars / non-post photo', _n; END IF;

  -- P6
  SELECT count(*) INTO _n FROM _ex e
   WHERE e.k !~ '^post-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_./-]+\.webp$' OR position('..' IN e.k) > 0;
  IF _n > 0 THEN RAISE EXCEPTION 'PROBE FAIL P6: % queued/held key(s) are outside a member post-images folder', _n; END IF;

  FOR _r IN
    SELECT r.state, r.source_table,
           CASE WHEN r.object_key ~ '/posts/credit/' THEN 'credit copy' WHEN r.object_key ~ '-l4-r320\.webp$' THEN '-l4 320' ELSE '-l4 2048' END AS what,
           count(*) AS n, coalesce(sum(r.bytes), 0) AS b
      FROM public.photo_retire r WHERE r.kind = 'post_extra' GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
  LOOP
    RAISE NOTICE '  post_extra % · % · % : % file(s), % bytes recorded', _r.state, _r.source_table, _r.what, _r.n, _r.b;
  END LOOP;
  RAISE NOTICE 'PROBE PASS 0113 (queued/held now: %)', (SELECT count(*) FROM _ex);
END
$p$;
ROLLBACK;
