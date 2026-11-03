-- ═══════════════════════════════════════════════════════════════════════════
-- CENSUS · photo plan Unit A — which posts and entries still name a v2 `-l4`
-- file, the name whose URL IS the credited 2048 (audit B1). READ-ONLY, ENDS
-- IN ROLLBACK, changes nothing. Run through apply-migration.yml (any time).
--
-- Reports, per lane, every privacy level (public, friends, only me, drafts and
-- scheduled posts are counted separately):
--   · posts whose image_urls hold a `-l4` URL: post id, created, privacy, how
--     many such photos, and how many of them are SMALL (long edge ≤ 1080 —
--     those have no clean 1080 copy, only the 600 thumb: the Owner decides);
--   · competition entries holding a `-l4f` URL (their full size is clean);
--   · scheduled posts holding a `-l4` URL.
-- Prints post ids, dates and counts only — never a member, a name or a URL.
-- PASS always (it measures; the numbers are the result).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $c$
DECLARE
  _r record; _posts bigint := 0; _photos bigint := 0; _small bigint := 0; _entries bigint := 0; _sched bigint := 0;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'CENSUS REFUSED — p32.lane is not asserted';
  END IF;

  RAISE NOTICE 'L4 CENSUS lane % at %', current_setting('p32.lane'), now();
  FOR _r IN
    SELECT p.id, p.created_at, p.privacy::text AS privacy,
           count(*) AS n,
           count(*) FILTER (WHERE greatest((regexp_match(u.url, '-w([0-9]{1,6})h([0-9]{1,6})-l4\.webp'))[1]::int,
                                           (regexp_match(u.url, '-w([0-9]{1,6})h([0-9]{1,6})-l4\.webp'))[2]::int) <= 1080) AS small
      FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) u(url)
     WHERE u.url ~* '-w[0-9]{1,6}h[0-9]{1,6}-l4\.webp([?#].*)?$'
     GROUP BY p.id, p.created_at, p.privacy
     ORDER BY p.created_at
  LOOP
    _posts := _posts + 1; _photos := _photos + _r.n; _small := _small + _r.small;
    RAISE NOTICE '  post % · created % · privacy % · -l4 photos % · small (≤1080) %',
      _r.id, to_char(_r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'), _r.privacy, _r.n, _r.small;
  END LOOP;

  SELECT count(*) INTO _entries FROM public.competition_entries e
   WHERE EXISTS (SELECT 1 FROM unnest(e.photos) x(url) WHERE x.url ~* '-l4f\.webp([?#].*)?$');
  IF to_regclass('public.scheduled_posts') IS NOT NULL THEN
    EXECUTE $q$SELECT count(*) FROM public.scheduled_posts s
                WHERE EXISTS (SELECT 1 FROM unnest(s.image_urls) x(url) WHERE x.url ~* '-l4\.webp([?#].*)?$')$q$ INTO _sched;
  END IF;

  RAISE NOTICE 'L4 CENSUS RESULT lane %: posts % · -l4 photos % · small (no clean 1080) % · competition entries with -l4f % · scheduled posts with -l4 %',
    current_setting('p32.lane'), _posts, _photos, _small, _entries, coalesce(_sched, 0);
  RAISE NOTICE 'CENSUS PASS (measurement only)';
END
$c$;

ROLLBACK;
