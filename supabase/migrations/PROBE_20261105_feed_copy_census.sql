-- ═══════════════════════════════════════════════════════════════════════════
-- CENSUS · feed photo copies (Owner, 5 Nov 2026) — how many STORED COPIES do
-- the old feed post photos have, per filename marker? READ-ONLY, ENDS IN
-- ROLLBACK. Run through apply-migration.yml on any lane; it changes nothing.
--
-- New rule (PR #910, `-l6`): a feed photo keeps ONE main file (largest clean
-- copy) + 1080 + 600. This file only COUNTS what the older markers stored, so
-- the Owner can later approve a batch-by-batch clean-up. Nothing is deleted.
--
-- Reads public.posts (image_urls / thumbnail_urls) and, when present, the
-- photo plan's record tables (photo_old_credit, photo_set_backfill,
-- photo_set_swap, photo_l4_rectify, photo_set_credit). Prints COUNTS ONLY —
-- never a URL, key, post id or member id (the run log is public).
-- Competitions are out of scope (not read).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $c$
DECLARE r record; _n bigint; _a bigint; _b bigint; _d bigint;
BEGIN
  RAISE NOTICE 'FEED COPY CENSUS lane % at %', coalesce(current_setting('p32.lane', true), '?'), now();

  CREATE TEMP TABLE _ph ON COMMIT DROP AS
  SELECT q.*,
         CASE WHEN q.m IS NOT NULL THEN q.m
              WHEN q.u ~* '/posts/credit/' THEN 'credit-url'
              WHEN q.u ~* '^https://[^/]+/post-images/' THEN 'unmarked-photos'
              WHEN q.u ~* '^https://[^/]+/avatars/' THEN 'unmarked-avatars'
              WHEN q.u ~* 'supabase\.co/storage/' THEN 'unmarked-supabase'
              ELSE 'other' END AS cls,
         greatest(q.w, q.h) AS lng
    FROM (
      SELECT p.id AS pid, s.u, s.t,
             substring(s.u from '-(l[3-6]f?)\.[A-Za-z0-9]+$') AS m,
             nullif(substring(s.u from '-w([0-9]{1,5})h[0-9]{1,5}-l[3-6]f?.[A-Za-z0-9]+$'), '')::int AS w,
             nullif(substring(s.u from '-w[0-9]{1,5}h([0-9]{1,5})-l[3-6]f?.[A-Za-z0-9]+$'), '')::int AS h
        FROM public.posts p
        CROSS JOIN LATERAL (
          SELECT regexp_replace(x.url, '[?#].*$', '') AS u,
                 CASE WHEN p.thumbnail_urls IS NOT NULL AND array_length(p.thumbnail_urls, 1) >= x.i
                      THEN p.thumbnail_urls[x.i] END AS t
            FROM unnest(p.image_urls) WITH ORDINALITY x(url, i)
           WHERE x.url IS NOT NULL AND x.url <> ''
        ) s
    ) q;

  SELECT count(*), count(DISTINCT pid) INTO _n, _a FROM _ph;
  RAISE NOTICE '  post photos named by posts.image_urls: % (in % posts)', _n, _a;

  FOR r IN
    SELECT cls, count(*) AS n,
           count(*) FILTER (WHERE lng IS NOT NULL) AS dims,
           count(*) FILTER (WHERE lng > 1440) AS gt1440,
           count(*) FILTER (WHERE lng > 1080) AS gt1080,
           count(*) FILTER (WHERE lng >= 1080) AS ge1080,
           count(*) FILTER (WHERE lng > 320) AS gt320,
           count(*) FILTER (WHERE t IS NOT NULL AND t <> '' AND regexp_replace(t, '[?#].*$', '') <> u) AS thumb,
           count(DISTINCT u) AS distinct_u
      FROM _ph GROUP BY cls ORDER BY cls
  LOOP
    RAISE NOTICE '  class % : photos % (distinct files %) · with WxH in name % · long>1440 % · long>1080 % · long>=1080 % · long>320 % · own thumb named %',
      r.cls, r.n, r.distinct_u, r.dims, r.gt1440, r.gt1080, r.ge1080, r.gt320, r.thumb;
  END LOOP;

  IF to_regclass('public.photo_old_credit') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*), count(*) FILTER (WHERE p.image_urls[c.ord + 1] = c.src_url),
                      count(DISTINCT c.credited_url)
                 FROM public.photo_old_credit c LEFT JOIN public.posts p ON p.id = c.post_id$q$
      INTO _n, _a, _b;
    RAISE NOTICE '  photo_old_credit (posts/credit/ copies): rows % · still named by their post % · distinct credited files %', _n, _a, _b;
  ELSE RAISE NOTICE '  photo_old_credit: table absent'; END IF;

  IF to_regclass('public.photo_set_backfill') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*),
                      count(*) FILTER (WHERE greatest(substring(new_url from '-w([0-9]+)h[0-9]+-l4.webp$')::int, substring(new_url from 'h([0-9]+)-l4.webp$')::int) > 1080),
                      count(*) FILTER (WHERE greatest(substring(new_url from '-w([0-9]+)h[0-9]+-l4.webp$')::int, substring(new_url from 'h([0-9]+)-l4.webp$')::int) > 320),
                      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.posts p WHERE p.id = b.post_id AND regexp_replace(p.image_urls[b.ord + 1], '[?#].*$', '') = b.new_url))
                 FROM public.photo_set_backfill b$q$
      INTO _n, _a, _b, _d;
    RAISE NOTICE '  photo_set_backfill (-l4 set beside an old photo): rows % · 2048-copy long>1080 % · long>320 % · now shown by its post %', _n, _a, _b, _d;
  ELSE RAISE NOTICE '  photo_set_backfill: table absent'; END IF;

  IF to_regclass('public.photo_set_swap') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.photo_set_swap' INTO _n;
    RAISE NOTICE '  photo_set_swap (posts swapped to their -l4 set): %', _n;
  END IF;

  IF to_regclass('public.photo_l4_rectify') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*),
                      count(*) FILTER (WHERE greatest(substring(old_url from '-w([0-9]+)h[0-9]+-l4.webp')::int, substring(old_url from 'h([0-9]+)-l4.webp')::int) > 1080),
                      count(*) FILTER (WHERE greatest(substring(old_url from '-w([0-9]+)h[0-9]+-l4.webp')::int, substring(old_url from 'h([0-9]+)-l4.webp')::int) > 320)
                 FROM public.photo_l4_rectify$q$
      INTO _n, _a, _b;
    RAISE NOTICE '  photo_l4_rectify (old -l4 set left behind after repoint to -l5): rows % · long>1080 % · long>320 %', _n, _a, _b;
  END IF;

  IF to_regclass('public.photo_set_credit') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FILTER (WHERE photo_key LIKE 'post-images/%'),
                      count(*) FILTER (WHERE photo_key LIKE 'post-images/%' AND drawn),
                      count(*) FILTER (WHERE photo_key LIKE 'competition-photos/%')
                 FROM public.photo_set_credit$q$
      INTO _n, _a, _b;
    RAISE NOTICE '  photo_set_credit (-r2048c records): posts % (drawn by server %) · competition % (not in scope)', _n, _a, _b;
  END IF;

  RAISE NOTICE 'CENSUS PASS (measurement only, nothing changed)';
END
$c$;
ROLLBACK;
