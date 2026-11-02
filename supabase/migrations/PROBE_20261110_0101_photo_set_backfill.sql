-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261110_0101 photo-set backfill (photo plan U5). ENDS IN ROLLBACK.
-- Reports FIRST: the lane's CDN host, how many photos are pending / recorded.
-- A · catalog: both tables exist, RLS on, NOTHING granted to anon /
--     authenticated; the three worker functions are SECURITY DEFINER
--     search_path="", executable by authenticated only; the three helpers are
--     executable by nobody but the owner; the CDN host is this lane's.
-- B · the scope rule and the name rule on fixed examples (this lane's host).
-- C · behaviour as simulated callers (request.jwt.claims + SET LOCAL ROLE):
--     anon cannot execute; a plain member is refused PHOTO-BF-001; the worker
--     (an admin of this lane) reads the queue, records one pending photo
--     (refused first with a foreign key), sees it done and gone from the queue.
--     Every row it writes is removed by the ROLLBACK.
-- Before the apply it FAILS at the first missing object (expected).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $p$
DECLARE
  _host text; _u constant text := '11111111-1111-4111-8111-111111111111';
  _x uuid := gen_random_uuid(); _admin uuid; _err text; _n int; _k text; _post uuid; _ord int; _done boolean;
  _pending bigint; _recorded bigint;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;

  -- ── A · catalog ───────────────────────────────────────────────────────────
  IF to_regclass('public.photo_set_backfill') IS NULL OR to_regclass('public.photo_set_swap') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL A1: photo_set_backfill / photo_set_swap missing (0101 not applied)';
  END IF;
  _host := public.photo_set_backfill_cdn();
  SELECT count(*) FILTER (WHERE public.photo_set_backfill_source_key(u.url) IS NOT NULL
                           AND NOT EXISTS (SELECT 1 FROM public.photo_set_backfill b WHERE b.post_id = p.id AND b.ord = u.i - 1 AND b.old_url = u.url))
    INTO _pending FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) WITH ORDINALITY u(url, i);
  SELECT count(*) INTO _recorded FROM public.photo_set_backfill;
  RAISE NOTICE 'photo-set backfill (lane %, CDN %): pending photos=% · recorded=% · swapped posts=%',
    current_setting('p32.lane'), _host, _pending, _recorded, (SELECT count(*) FROM public.photo_set_swap);

  IF _host IS DISTINCT FROM CASE current_setting('p32.lane') WHEN 'production' THEN 'cdn.50mmretina.com' ELSE 'cdn-staging.50mmretina.com' END THEN
    RAISE EXCEPTION 'PROBE FAIL A2: the CDN host % is not this lane''s', _host;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.photo_set_backfill'::regclass, 'public.photo_set_swap'::regclass) AND NOT relrowsecurity) THEN
    RAISE EXCEPTION 'PROBE FAIL A3: RLS is not on for a photo-set table';
  END IF;
  IF has_table_privilege('anon', 'public.photo_set_backfill', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'public.photo_set_backfill', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('anon', 'public.photo_set_swap', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'public.photo_set_swap', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'PROBE FAIL A4: anon/authenticated hold a privilege on a photo-set table';
  END IF;
  IF (SELECT count(*) FROM pg_proc p
       WHERE p.oid IN (to_regprocedure('public.photo_set_backfill_queue(integer,uuid)'),
                       to_regprocedure('public.photo_set_backfill_target(uuid,integer)'),
                       to_regprocedure('public.photo_set_backfill_record(uuid,integer,text)'))
         AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']) <> 3 THEN
    RAISE EXCEPTION 'PROBE FAIL A5: a worker function is missing or not SECURITY DEFINER search_path=""';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid IN ('public.photo_set_backfill_queue(integer,uuid)'::regprocedure,
                              'public.photo_set_backfill_target(uuid,integer)'::regprocedure,
                              'public.photo_set_backfill_record(uuid,integer,text)'::regprocedure,
                              'public.photo_set_backfill_cdn()'::regprocedure,
                              'public.photo_set_backfill_source_key(text)'::regprocedure,
                              'public.photo_set_backfill_new_url(text,text)'::regprocedure)
                AND a.grantee = 0) THEN
    RAISE EXCEPTION 'PROBE FAIL A6: PUBLIC can execute a photo-set function';
  END IF;
  IF has_function_privilege('anon', 'public.photo_set_backfill_queue(integer,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.photo_set_backfill_target(uuid,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.photo_set_backfill_record(uuid,integer,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.photo_set_backfill_cdn()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.photo_set_backfill_source_key(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.photo_set_backfill_new_url(text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.photo_set_backfill_source_key(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL A7: anon can execute a worker function, or a helper is executable by a client role';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.photo_set_backfill_queue(integer,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.photo_set_backfill_target(uuid,integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.photo_set_backfill_record(uuid,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL A8: authenticated cannot execute a worker function (the worker signs in as a member)';
  END IF;

  -- ── B · the scope rule and the name rule ──────────────────────────────────
  IF public.photo_set_backfill_source_key('https://' || _host || '/post-images/' || _u || '/posts/a-w10h10-l3.webp?v=1')
       IS DISTINCT FROM 'post-images/' || _u || '/posts/a-w10h10-l3.webp'
     OR public.photo_set_backfill_source_key('https://' || _host || '/post-images/' || _u || '/1775_0.webp')
       IS DISTINCT FROM 'post-images/' || _u || '/1775_0.webp' THEN
    RAISE EXCEPTION 'PROBE FAIL B1: an old photo of this lane is not in scope';
  END IF;
  SELECT count(*) INTO _n FROM unnest(ARRAY[
      'https://' || _host || '/post-images/' || _u || '/posts/a-w2048h1365-l4.webp',
      'https://' || _host || '/post-images/' || _u || '/posts/a-w4000h3000-l4f.webp',
      'https://' || _host || '/post-images/' || _u || '/posts/a-w2048h1365-l4-thumb.webp',
      'https://' || _host || '/post-images/' || _u || '/posts/a-thumb.webp',
      'https://' || _host || '/post-images/' || _u || '/posts/a-l3-r1080.webp',
      'https://' || _host || '/post-images/' || _u || '/d/' || _u || '/w600.webp',
      'https://' || _host || '/avatars/' || _u || '/avatar.webp',
      'https://' || _host || '/post-images/' || _u || '/../x.webp',
      'https://' || _host || '/post-images/' || _u || '/posts/a.jpg',
      'https://' || _host || '/post-images/not-a-uuid/posts/a.webp',
      'https://' || CASE WHEN _host = 'cdn.50mmretina.com' THEN 'cdn-staging.50mmretina.com' ELSE 'cdn.50mmretina.com' END || '/post-images/' || _u || '/posts/a.webp',
      'https://jtdtehuqtinjxropkkcn.supabase.co/storage/v1/object/public/post-images/' || _u || '/1_0.webp',
      'https://picsum.photos/seed/x/1200/800']) t(url)
   WHERE public.photo_set_backfill_source_key(t.url) IS NOT NULL;
  IF _n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL B2: % out-of-scope URL(s) were taken as backfill work', _n; END IF;
  IF public.photo_set_backfill_new_url('post-images/' || _u || '/posts/a.webp', 'post-images/' || _u || '/posts/a-w2048h1365-l4.webp')
       IS DISTINCT FROM 'https://' || _host || '/post-images/' || _u || '/posts/a-w2048h1365-l4.webp' THEN
    RAISE EXCEPTION 'PROBE FAIL B3: the v2 name of an old photo is refused';
  END IF;
  -- each wrong 2048 name must RAISE 22023
  FOR _k IN SELECT unnest(ARRAY[
      'post-images/' || _u || '/posts/b-w2048h1365-l4.webp',       -- another photo's stem
      'post-images/' || _u || '/posts/a-w2049h1365-l4.webp',       -- larger than 2048
      'post-images/' || _u || '/posts/a-w2048h1365-l4-thumb.webp', -- a sibling, not the 2048
      'post-images/' || _u || '/posts/a-w2048h1365-l4f.webp',      -- the competition marker
      'post-images/' || _u || '/posts/a.webp']) LOOP
    BEGIN
      PERFORM public.photo_set_backfill_new_url('post-images/' || _u || '/posts/a.webp', _k);
      _err := 'no error';
    EXCEPTION WHEN invalid_parameter_value THEN _err := 'refused';
    END;
    IF _err <> 'refused' THEN RAISE EXCEPTION 'PROBE FAIL B4: a wrong 2048 name was accepted: %', _k; END IF;
  END LOOP;

  -- ── C · behaviour ─────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM * FROM public.photo_set_backfill_queue(1, NULL);
    _err := 'no error';
  EXCEPTION WHEN insufficient_privilege THEN _err := 'refused';
  END;
  RESET ROLE;
  IF _err <> 'refused' THEN RAISE EXCEPTION 'PROBE FAIL C1: anon could read the photo-set queue'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _x, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', _x::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM * FROM public.photo_set_backfill_queue(1, NULL);
    _err := 'no error';
  EXCEPTION WHEN OTHERS THEN _err := SQLERRM;
  END;
  RESET ROLE;
  IF _err NOT LIKE 'PHOTO-BF-001%' THEN RAISE EXCEPTION 'PROBE FAIL C2: a plain member was not refused with PHOTO-BF-001 (%)', _err; END IF;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.photo_set_backfill_record(_x, 0, 'post-images/' || _u || '/posts/a-w1h1-l4.webp');
    _err := 'no error';
  EXCEPTION WHEN OTHERS THEN _err := SQLERRM;
  END;
  RESET ROLE;
  IF _err NOT LIKE 'PHOTO-BF-001%' THEN RAISE EXCEPTION 'PROBE FAIL C3: a plain member could record (%)', _err; END IF;

  SELECT ur.user_id INTO _admin FROM public.user_roles ur WHERE ur.role::text = 'admin' ORDER BY ur.created_at LIMIT 1;
  IF _admin IS NULL THEN
    RAISE NOTICE 'C4–C6 skipped: this lane has no admin to act as the worker';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', _admin::text, true);
    SET LOCAL ROLE authenticated;
    SELECT q.post_id, q.ord, q.source_key INTO _post, _ord, _k FROM public.photo_set_backfill_queue(50, NULL) q LIMIT 1;
    RESET ROLE;
    IF _pending > 0 AND _post IS NULL THEN RAISE EXCEPTION 'PROBE FAIL C4: % photo(s) pending but the worker''s queue is empty', _pending; END IF;
    IF _post IS NULL THEN
      RAISE NOTICE 'C5–C6 skipped: nothing pending on this lane';
    ELSE
      SET LOCAL ROLE authenticated;
      SELECT t.done INTO _done FROM public.photo_set_backfill_target(_post, _ord) t;
      RESET ROLE;
      IF _done IS DISTINCT FROM false THEN RAISE EXCEPTION 'PROBE FAIL C5a: a pending photo''s target is not "not done" (%)', _done; END IF;
      BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM public.photo_set_backfill_record(_post, _ord, 'post-images/' || _u || '/posts/zz-w100h100-l4.webp');
        _err := 'no error';
      EXCEPTION WHEN OTHERS THEN _err := SQLERRM;
      END;
      RESET ROLE;
      IF _err NOT LIKE 'PHOTO-BF-002%' THEN RAISE EXCEPTION 'PROBE FAIL C5b: a foreign 2048 key was recorded (%)', _err; END IF;
      SET LOCAL ROLE authenticated;
      PERFORM public.photo_set_backfill_record(_post, _ord, left(_k, -5) || '-w100h100-l4.webp');
      SELECT t.done INTO _done FROM public.photo_set_backfill_target(_post, _ord) t;
      SELECT count(*) INTO _n FROM public.photo_set_backfill_queue(50, NULL) q WHERE q.post_id = _post AND q.ord = _ord;
      RESET ROLE;
      IF NOT _done OR _n <> 0 THEN RAISE EXCEPTION 'PROBE FAIL C6: a recorded photo is not done (%) or still queued (%)', _done, _n; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.photo_set_backfill b WHERE b.post_id = _post AND b.ord = _ord
                      AND b.new_url = 'https://' || _host || '/' || left(_k, -5) || '-w100h100-l4.webp'
                      AND b.new_thumb = 'https://' || _host || '/' || left(_k, -5) || '-w100h100-l4-thumb.webp'
                      AND b.recorded_by = _admin) THEN
        RAISE EXCEPTION 'PROBE FAIL C6b: the record row does not name the new URL / thumb / worker';
      END IF;
    END IF;
  END IF;

  RAISE NOTICE 'PROBE PASS: 20261110_0101 photo-set backfill — catalog, scope, names and worker-only behaviour hold on %', current_setting('p32.lane');
END
$p$;

ROLLBACK;
