-- ═══════════════════════════════════════════════════════════════════════════
-- Photo plan U7 · 20261110_0104 — queue the OLD big post files for deletion
-- (Owner decision 7, "delete originals yes", 2026-11-02). Lanes: staging and
-- production. RE-RUNNABLE (each run queues what has become eligible).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This file deletes NOTHING. It puts rows in photo_retire (kind 'post_old',
-- 20261110_0103); photo-retire.yml (by hand, kind post_old — never the
-- schedule) then shows count + bytes (dry run) and deletes.
--
-- REFUSES (decision 7, all three):
--   PRE-003 on PRODUCTION while photo_set_v2 is not 'everyone' — the Owner must
--           have switched the new photos on for everybody himself;
--   PRE-004 while ANY post still shows an old in-scope photo (census class
--           "in scope" > 0) — the live site must read only new copies, so
--           every photo must have its set (census PASS) AND be swapped (0102);
--   PRE-001 when 0101 / 0102's tables or 0103's list are missing.
--
-- WHAT IS QUEUED, per swapped post (photo_set_swap) and swapped photo
-- (photo_set_backfill row whose old_url is the post's old image and whose
-- new_url is what the post shows now):
--   · the old photo itself                     <old key>.webp
--   · its old thumbnail, when it is in the same member folder of this lane's
--     bucket and is not a v2 copy               <…>-thumb.webp (or any old name)
--   · for an old `-l3` photo, its two rungs     <old>-l3-r1080.webp, -l3-r1440.webp
--     (derived names: if one was never stored the deleter records it as absent)
-- then the reference scan (photo_retire_referenced) turns every key still named
-- anywhere in the public schema (a notification, another post, a featured
-- photo …) into 'kept' with the place named. The photo-set logs are not counted
-- as references (they record the old URL on purpose).
--
-- REVERSIBLE UNTIL THE DELETER RUNS: 20261110_0104_photo_retire_old_posts_ROLLBACK.sql
-- removes every post_old row not yet deleted. The 0102 swap rollback refuses a
-- post with post_old rows (roll this back first), so no post can be pointed
-- back at a file that is queued or gone.
--
-- PROBE: supabase/migrations/PROBE_20261110_0104_photo_retire_old_posts.sql
--        (reports the candidate count either way; FAIL while a swapped post's
--         old files are not queued)
-- FIXTURE: .github/workflows/d1-photo-retire-old-posts-fixture.yml
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $mark$
DECLARE
  _mode text; _old bigint; _host text; _re text; _p record; _k text; _n_new int := 0; _kept int := 0; _keys text[]; _ref record;
BEGIN
  -- PRE-001 · what this builds on.
  IF to_regclass('public.photo_set_backfill') IS NULL OR to_regclass('public.photo_set_swap') IS NULL
     OR to_regclass('public.photo_retire') IS NULL OR to_regprocedure('public.photo_retire_referenced(text[])') IS NULL THEN
    RAISE EXCEPTION 'U7-0104-PRE-001: 20261110_0101 / 0103 are not applied on this lane';
  END IF;
  -- PRE-003 · production: the Owner has switched the new photos on for everybody.
  SELECT fa.mode INTO _mode FROM public.feature_access fa WHERE fa.feature = 'photo_set_v2';
  IF current_setting('p32.lane') = 'production' AND coalesce(_mode, 'off') <> 'everyone' THEN
    RAISE EXCEPTION 'U7-0104-PRE-003: photo_set_v2 is % on production — old files are queued only after the Owner has switched the new photos on for All members', coalesce(_mode, 'off');
  END IF;
  -- PRE-004 · the live site reads only new copies: no post shows an old in-scope photo.
  SELECT count(*) INTO _old FROM public.posts p CROSS JOIN LATERAL unnest(p.image_urls) u(url)
   WHERE public.photo_set_backfill_source_key(u.url) IS NOT NULL;
  IF _old > 0 THEN
    RAISE EXCEPTION 'U7-0104-PRE-004: % post photo(s) still show an old file (census MISSING or not swapped) — finish the backfill and the swap first', _old;
  END IF;

  _host := public.photo_set_backfill_cdn();
  -- PRE-005 · the lane asserted by the workflow is the lane this database was built for.
  IF _host <> (CASE current_setting('p32.lane') WHEN 'production' THEN 'cdn.50mmretina.com' ELSE 'cdn-staging.50mmretina.com' END) THEN
    RAISE EXCEPTION 'U7-0104-PRE-005: p32.lane is % but this database''s photo host is % — refusing', current_setting('p32.lane'), _host;
  END IF;
  _re := '^https://' || replace(_host, '.', '\.')
      || '/(post-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\.webp)(?:\?[^#]*)?$';

  FOR _p IN
    SELECT w.post_id, b.ord, b.old_url, w.old_thumbnail_urls[b.ord + 1] AS old_thumb,
           public.photo_set_backfill_source_key(b.old_url) AS old_key
      FROM public.photo_set_swap w
      JOIN public.posts p ON p.id = w.post_id
      JOIN public.photo_set_backfill b ON b.post_id = w.post_id
     WHERE w.old_image_urls[b.ord + 1] = b.old_url
       AND p.image_urls[b.ord + 1] = b.new_url
     ORDER BY w.post_id, b.ord
  LOOP
    CONTINUE WHEN _p.old_key IS NULL;
    FOR _k IN
      SELECT DISTINCT k FROM (
        SELECT _p.old_key AS k
        UNION ALL
        SELECT (regexp_match(_p.old_thumb, _re))[1]
         WHERE split_part((regexp_match(_p.old_thumb, _re))[1], '/', 2) = split_part(_p.old_key, '/', 2)
           AND (regexp_match(_p.old_thumb, _re))[1] !~* '-l4f?(-thumb|-r[0-9]{3,4})?\.webp$'
           AND position('..' IN (regexp_match(_p.old_thumb, _re))[1]) = 0
           AND split_part((regexp_match(_p.old_thumb, _re))[1], '/', 3) <> 'd'
        UNION ALL
        SELECT regexp_replace(_p.old_key, '-l3\.webp$', '-l3-r' || r || '.webp')
          FROM unnest(ARRAY['1080', '1440']) r WHERE _p.old_key ~ '-l3\.webp$'
      ) s WHERE k IS NOT NULL
    LOOP
      INSERT INTO public.photo_retire (kind, object_key, object_url, source_table, source_id, ord, replacement_url, note)
      VALUES ('post_old', _k, 'https://' || _host || '/' || _k, 'posts', _p.post_id, _p.ord, NULL,
              'old post file, replaced by its v2 set (photo plan U7)')
      ON CONFLICT (object_key) DO NOTHING;
      IF FOUND THEN _n_new := _n_new + 1; END IF;
    END LOOP;
  END LOOP;

  SELECT array_agg(r.object_key) INTO _keys FROM public.photo_retire r
   WHERE r.kind = 'post_old' AND r.state = 'due';
  FOR _ref IN SELECT f.object_key, string_agg(DISTINCT f.found_in, ', ') AS w FROM public.photo_retire_referenced(_keys) f GROUP BY f.object_key LOOP
    UPDATE public.photo_retire r SET state = 'kept', note = r.note || ' · kept: still named in ' || _ref.w
     WHERE r.object_key = _ref.object_key AND r.state = 'due';
    _kept := _kept + 1;
  END LOOP;
  -- an old -l3 photo that is kept keeps its rungs too: no column names a rung,
  -- the renderer derives them from the photo's name.
  UPDATE public.photo_retire r SET state = 'kept', note = r.note || ' · kept: its -l3 photo is kept'
   WHERE r.kind = 'post_old' AND r.state = 'due' AND r.object_key ~ '-l3-r(1080|1440)\.webp$'
     AND EXISTS (SELECT 1 FROM public.photo_retire b
                  WHERE b.object_key = regexp_replace(r.object_key, '-l3-r(1080|1440)\.webp$', '-l3.webp') AND b.state = 'kept');
  -- the deleter claims rows marked in the last 24 h: this run is the fresh check
  UPDATE public.photo_retire r SET marked_at = now() WHERE r.kind = 'post_old' AND r.state = 'due';

  RAISE NOTICE 'U7-0104 on % (photo_set_v2 = %): queued % new file(s); kept (still named) %; post_old now due % · kept % · deleted %',
    current_setting('p32.lane'), coalesce(_mode, '<none>'), _n_new, _kept,
    (SELECT count(*) FROM public.photo_retire WHERE kind = 'post_old' AND state = 'due'),
    (SELECT count(*) FROM public.photo_retire WHERE kind = 'post_old' AND state = 'kept'),
    (SELECT count(*) FROM public.photo_retire WHERE kind = 'post_old' AND state = 'deleted');
END
$mark$;

COMMIT;
