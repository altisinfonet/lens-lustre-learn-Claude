-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0112 old photos' feed copies (photo speed). READ-ONLY, ENDS IN ROLLBACK.
-- PASS when
--   C1 post_photo_feed_copies(uuid[]) exists, SECURITY DEFINER with search_path '',
--      executable by anon + authenticated (not PUBLIC);
--   C2 its body is gated by can_view_post and by the post still naming the photo,
--      and never names the -l4 master (only -l4-r1080 / new_thumb);
--   C3 more than 50 ids is refused with PHOTO-FC-001;
--   C4 every feed_url it can return is a clean `-l4-r1080` sibling.
-- FAIL before the apply (C1: the function does not exist).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $p$
DECLARE _f text := 'public.post_photo_feed_copies(uuid[])'; _def text; _n bigint; _r bigint; _ok boolean := false;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  -- C1
  IF to_regprocedure(_f) IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL C1: 20261110_0112 is not applied on this lane (post_photo_feed_copies missing)';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(_f))
     OR NOT coalesce((SELECT 'search_path=""' = ANY (p.proconfig) FROM pg_proc p WHERE p.oid = to_regprocedure(_f)), false) THEN
    RAISE EXCEPTION 'PROBE FAIL C1: the lookup is not SECURITY DEFINER with an empty search_path';
  END IF;
  IF NOT has_function_privilege('anon', _f, 'EXECUTE') OR NOT has_function_privilege('authenticated', _f, 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL C1: anon / authenticated cannot run the lookup';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = to_regprocedure(_f) AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL C1: PUBLIC can execute the lookup';
  END IF;
  -- C2
  _def := pg_get_functiondef(to_regprocedure(_f));
  IF position('can_view_post(_uid, p.user_id, p.privacy)' IN _def) = 0 OR position('p.image_urls[b.ord + 1] = b.old_url' IN _def) = 0 THEN
    RAISE EXCEPTION 'PROBE FAIL C2: the lookup is not gated by can_view_post and the current photo URL';
  END IF;
  IF position('-l4-r1080.webp' IN _def) = 0 OR _def ~ 'SELECT b\.post_id, b\.ord, b\.old_url,\s*b\.new_url' THEN
    RAISE EXCEPTION 'PROBE FAIL C2: the lookup may return the -l4 master as a feed copy';
  END IF;
  -- C3
  BEGIN
    PERFORM * FROM public.post_photo_feed_copies(array_fill(gen_random_uuid(), ARRAY[51]));
  EXCEPTION WHEN invalid_parameter_value THEN
    _ok := SQLERRM LIKE 'PHOTO-FC-001%';
  END;
  IF NOT _ok THEN RAISE EXCEPTION 'PROBE FAIL C3: 51 ids were not refused with PHOTO-FC-001'; END IF;
  -- C4 (counts only — no member data)
  SELECT count(*) INTO _n FROM public.photo_set_backfill b JOIN public.posts p ON p.id = b.post_id WHERE p.image_urls[b.ord + 1] = b.old_url;
  SELECT count(*) INTO _r FROM public.photo_set_backfill b, LATERAL public.post_photo_feed_copies(ARRAY[b.post_id]) f
   WHERE f.feed_url IS NOT NULL AND f.feed_url !~ '-w[0-9]{1,4}h[0-9]{1,4}-l4-r1080\.webp$';
  IF _r > 0 THEN RAISE EXCEPTION 'PROBE FAIL C4: % feed_url value(s) are not a -l4-r1080 sibling', _r; END IF;
  RAISE NOTICE 'feed copies (lane %): old photos with a recorded set still shown = %', current_setting('p32.lane'), _n;
  RAISE NOTICE 'PROBE PASS: 20261110_0112 — lookup gated by can_view_post, clean copies only, 50-id cap (lane %)', current_setting('p32.lane');
END
$p$;
ROLLBACK;
