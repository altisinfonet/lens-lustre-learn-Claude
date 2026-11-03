-- ═══════════════════════════════════════════════════════════════════════════
-- CENSUS · photo plan 0109 — does every OLD post photo of this lane have its
-- credited copy (v4 small credit)? READ-ONLY, ENDS IN ROLLBACK. Run through
-- apply-migration.yml any time after 20261110_0109 (it changes nothing).
--
-- Every posts.image_urls entry (first 50 of a post) is put in ONE class:
--   new set      a -l4 / -l4f / -l5 / -l5f photo (has its own credited copy, or none by design)
--   old photo    unmarked, on this lane's photo CDN (post-images/…), its avatars
--                bucket (avatars/…) or Supabase storage — the credit's work:
--                  credited — a current record (same URL, credit v4+)
--                  MISSING  — none yet (or recorded for an older URL)
--   other        anything else (another host): reported, never fetched
-- PASS = no old photo is MISSING. FAIL names the counts (never a member).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $c$
DECLARE _photos bigint; _new bigint; _old bigint; _cred bigint; _missing bigint; _other bigint;
        _p bigint; _a bigint; _s bigint; _mp bigint; _ma bigint; _ms bigint; _orphans bigint;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'CENSUS REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.photo_old_credit') IS NULL THEN
    RAISE EXCEPTION 'CENSUS FAIL: 20261110_0109 is not applied on this lane';
  END IF;
  CREATE TEMP TABLE _ph ON COMMIT DROP AS
  SELECT p.id AS pid, (u.i - 1)::int AS o, u.url, public.photo_old_credit_class(u.url) AS cls,
         EXISTS (SELECT 1 FROM public.photo_old_credit c
                  WHERE c.post_id = p.id AND c.ord = u.i - 1 AND c.src_url = u.url AND c.credit_version >= 4) AS rec
    FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) WITH ORDINALITY u(url, i)
   WHERE u.i <= 50;
  SELECT count(*),
         count(*) FILTER (WHERE url ~* '-l[45]f?(-thumb|-r[0-9]{3,4}c?)?\.webp([?#].*)?$'),
         count(*) FILTER (WHERE cls IS NOT NULL),
         count(*) FILTER (WHERE cls IS NOT NULL AND rec),
         count(*) FILTER (WHERE cls IS NOT NULL AND NOT rec),
         count(*) FILTER (WHERE cls IS NULL AND url !~* '-l[45]f?(-thumb|-r[0-9]{3,4}c?)?\.webp([?#].*)?$'),
         count(*) FILTER (WHERE cls = 'photos'), count(*) FILTER (WHERE cls = 'avatars'), count(*) FILTER (WHERE cls = 'supabase'),
         count(*) FILTER (WHERE cls = 'photos' AND NOT rec), count(*) FILTER (WHERE cls = 'avatars' AND NOT rec),
         count(*) FILTER (WHERE cls = 'supabase' AND NOT rec)
    INTO _photos, _new, _old, _cred, _missing, _other, _p, _a, _s, _mp, _ma, _ms
    FROM _ph;
  -- records whose post no longer shows that photo there (kept; the lookup ignores them)
  SELECT count(*) INTO _orphans FROM public.photo_old_credit c JOIN public.posts p ON p.id = c.post_id
   WHERE p.image_urls[c.ord + 1] IS DISTINCT FROM c.src_url;
  RAISE NOTICE 'OLD-CREDIT CENSUS lane % (CDN %) at %', current_setting('p32.lane'), public.photo_set_backfill_cdn(), now();
  RAISE NOTICE '  post photos: % · new sets: % · other hosts (not fetched): %', _photos, _new, _other;
  RAISE NOTICE '  old photos: % → credited % · MISSING % (photo CDN % / % missing · avatars % / % missing · supabase % / % missing)',
    _old, _cred, _missing, _p, _mp, _a, _ma, _s, _ms;
  RAISE NOTICE '  records no longer named by their post (ignored by the lookup): %', _orphans;
  IF _missing > 0 THEN
    RAISE EXCEPTION 'CENSUS FAIL: % old photo(s) still without a credited copy on % (run s3-media-backfill.yml job=old-credit)',
      _missing, current_setting('p32.lane');
  END IF;
  RAISE NOTICE 'CENSUS PASS: every old photo on % has its credited copy (% of %)', current_setting('p32.lane'), _cred, _old;
END
$c$;
ROLLBACK;
