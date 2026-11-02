-- ═══════════════════════════════════════════════════════════════════════════
-- CENSUS · photo plan U5 — does every old post photo of this lane have its
-- v2 set? READ-ONLY, ENDS IN ROLLBACK. Run through apply-migration.yml (any
-- time after 20261110_0101; it changes nothing).
--
-- Every posts.image_urls entry is put in ONE class:
--   v2 already      a `-l4` / `-l4f` URL (new upload, or swapped by 0102)
--   in scope        an old photo in this lane's photo bucket (the backfill's work):
--                     recorded  — its whole set is in the store (checked by the
--                                 `done` route, one HEAD per copy, at record time)
--                     MISSING   — not recorded yet (or recorded for an older URL)
--   avatars bucket  this lane's CDN, avatars/… (profile pictures, My Photos files)
--   supabase        a Supabase-storage URL (pre-R2 uploads)
--   other           anything else (another host, a test image service)
-- Out-of-scope classes are reported, not converted: they keep showing exactly
-- as today, and U7 never deletes anything that is not a recorded old photo.
-- Also reported: posts whose photos live only in the media graph (post_media,
-- empty image_urls) — the S3 ladder covers those, not this backfill.
--
-- PASS = no in-scope photo is MISSING. FAIL names the count (never a member).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $c$
DECLARE
  _host text; _posts bigint; _photos bigint; _v2 bigint; _scope bigint; _rec bigint; _missing bigint;
  _avatars bigint; _supa bigint; _other bigint; _swapped bigint; _graph bigint; _ready_posts bigint; _partial_posts bigint;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'CENSUS REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.photo_set_backfill') IS NULL THEN
    RAISE EXCEPTION 'CENSUS FAIL: 20261110_0101 is not applied on this lane';
  END IF;
  _host := public.photo_set_backfill_cdn();

  CREATE TEMP TABLE _ph ON COMMIT DROP AS
  SELECT p.id AS pid, (u.i - 1)::int AS o, u.url,
         public.photo_set_backfill_source_key(u.url) AS k,
         EXISTS (SELECT 1 FROM public.photo_set_backfill b WHERE b.post_id = p.id AND b.ord = u.i - 1 AND b.old_url = u.url) AS rec
    FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) WITH ORDINALITY u(url, i);

  SELECT count(DISTINCT pid), count(*),
         count(*) FILTER (WHERE url ~* '-l4f?(-thumb|-r[0-9]{3,4})?\.webp([?#].*)?$'),
         count(*) FILTER (WHERE k IS NOT NULL),
         count(*) FILTER (WHERE k IS NOT NULL AND rec),
         count(*) FILTER (WHERE k IS NOT NULL AND NOT rec),
         count(*) FILTER (WHERE k IS NULL AND url NOT LIKE '%-l4%' AND url LIKE 'https://' || _host || '/avatars/%'),
         count(*) FILTER (WHERE k IS NULL AND url NOT LIKE '%-l4%' AND url ~ '^https://[a-z0-9]+\.supabase\.co/storage/'),
         count(*) FILTER (WHERE k IS NULL AND url !~* '-l4f?(-thumb|-r[0-9]{3,4})?\.webp([?#].*)?$'
                            AND url NOT LIKE 'https://' || _host || '/avatars/%'
                            AND url !~ '^https://[a-z0-9]+\.supabase\.co/storage/')
    INTO _posts, _photos, _v2, _scope, _rec, _missing, _avatars, _supa, _other
    FROM _ph;
  SELECT count(*) INTO _ready_posts FROM (SELECT pid FROM _ph WHERE k IS NOT NULL GROUP BY pid HAVING bool_and(rec)) s
   WHERE NOT EXISTS (SELECT 1 FROM public.photo_set_swap w WHERE w.post_id = s.pid);
  SELECT count(*) INTO _partial_posts FROM (SELECT pid FROM _ph WHERE k IS NOT NULL GROUP BY pid HAVING bool_or(rec) AND NOT bool_and(rec)) s;
  SELECT count(*) INTO _swapped FROM public.photo_set_swap;
  IF to_regclass('public.post_media') IS NOT NULL THEN
    EXECUTE 'SELECT count(DISTINCT pm.post_id) FROM public.post_media pm JOIN public.posts p ON p.id = pm.post_id
              WHERE coalesce(cardinality(p.image_urls), 0) = 0' INTO _graph;
  END IF;

  RAISE NOTICE 'CENSUS lane % (CDN %) at %', current_setting('p32.lane'), _host, now();
  RAISE NOTICE '  posts with image_urls: % · photos: %', _posts, _photos;
  RAISE NOTICE '  v2 already (-l4/-l4f): %', _v2;
  RAISE NOTICE '  in scope (old photos in this lane''s photo bucket): % → recorded % · MISSING %', _scope, _rec, _missing;
  RAISE NOTICE '  not converted, shown as today: avatars bucket % · supabase storage % · other %', _avatars, _supa, _other;
  RAISE NOTICE '  posts ready to swap (every in-scope photo recorded, not swapped): % · partly recorded: % · swapped: %',
    _ready_posts, _partial_posts, _swapped;
  RAISE NOTICE '  media-graph-only posts (post_media, empty image_urls; S3 ladder, not this backfill): %', coalesce(_graph::text, 'n/a');

  IF _missing > 0 THEN
    RAISE EXCEPTION 'CENSUS FAIL: % in-scope photo(s) still without a recorded v2 set on % (run s3-media-backfill.yml job=photo-set)',
      _missing, current_setting('p32.lane');
  END IF;
  RAISE NOTICE 'CENSUS PASS: every in-scope photo on % has its v2 set recorded (% of %)', current_setting('p32.lane'), _rec, _scope;
END
$c$;

ROLLBACK;
