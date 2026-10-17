-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · VID-2 (20261005_0005) — the LIVE half. READ-ONLY. Ends in ROLLBACK.
-- Raises (and so fails the dispatch) on a hit.
--   V1 · the seven tables and the three RPCs are installed.
--   V2 · the gate is armed: the state, insert, link, append-only and
--        keep-categories triggers exist and are ENABLED; CHECK ready_needs_check
--        and ad_videos_categories_1_5 are present and validated.
--   V3 · RLS on all seven tables; the API roles hold no write privilege on
--        videos / versions / checks / library / purge queue, and no TRUNCATE,
--        REFERENCES, TRIGGER or MAINTAIN anywhere (anon writes nothing); the hidden columns
--        (idempotency_key, manifest_sha256, audio_sha256, provider) are not
--        readable; anon cannot call any video RPC; housekeeping is internal.
--   V4 · live data obeys the gate: every ready video points at a check of its
--        current version with a clean / not-required verdict; every link
--        points at a ready video; every video post has 1–5 categories;
--        nothing deleted is older than 30 days + 2 h (the purge runs hourly).
--   V5 · the 'video-housekeeping' cron job is scheduled and active.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  hits text := '';
  r    record;
  _n   bigint;
BEGIN
  IF to_regclass('public.videos') IS NULL
     OR to_regprocedure('public.video_begin_upload(text,text,bigint,numeric,boolean,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL VID-2: V1 the videos unit is not installed';
  END IF;
  FOR r IN SELECT unnest(ARRAY['public.videos', 'public.video_versions', 'public.video_music_checks', 'public.music_library_tracks',
                               'public.post_videos', 'public.ad_videos', 'public.video_r2_purge_queue']) AS t LOOP
    IF to_regclass(r.t) IS NULL THEN
      hits := hits || E'\n  V1 ' || r.t || ' is missing';
      CONTINUE;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(r.t)) THEN
      hits := hits || E'\n  V3 ' || r.t || ': RLS off';
    END IF;
    IF r.t NOT IN ('public.post_videos', 'public.ad_videos')
       AND (has_table_privilege('anon', r.t, 'INSERT,UPDATE,DELETE,TRUNCATE')
            OR has_table_privilege('authenticated', r.t, 'INSERT,UPDATE,DELETE,TRUNCATE')) THEN
      hits := hits || E'\n  V3 ' || r.t || ': an API role can write it';
    END IF;
    IF has_table_privilege('anon', r.t, 'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       OR has_table_privilege('authenticated', r.t, 'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       OR (r.t <> 'public.ad_videos' AND has_table_privilege('authenticated', r.t, 'UPDATE'))
       OR has_table_privilege('anon', r.t, 'INSERT,UPDATE,DELETE') THEN
      hits := hits || E'\n  V3 ' || r.t || ': an API role holds TRUNCATE / REFERENCES / TRIGGER / MAINTAIN or a write it should not';
    END IF;
  END LOOP;
  IF to_regprocedure('public.video_delete(uuid)') IS NULL OR to_regprocedure('public.video_housekeeping(interval,integer)') IS NULL THEN
    hits := hits || E'\n  V1 video_delete or video_housekeeping is missing';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('public.videos', 'tg_videos_state_guard'), ('public.videos', 'tg_videos_insert_guard'),
                                 ('public.video_versions', 'tg_video_versions_guard'),
                                 ('public.video_music_checks', 'tg_video_music_checks_append_only'),
                                 ('public.video_music_checks', 'tg_video_music_checks_no_truncate'),
                                 ('public.post_videos', 'tg_post_videos_link_guard'), ('public.ad_videos', 'tg_ad_videos_link_guard'),
                                 ('public.posts', 'trg_videos_keep_post_categories')) v(t, g) LOOP
    IF to_regclass(r.t) IS NULL OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass(r.t) AND tgname = r.g AND tgenabled = 'O') THEN
      hits := hits || E'\n  V2 ' || r.t || ' has no enabled ' || r.g;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.videos'::regclass AND conname = 'ready_needs_check' AND convalidated)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ad_videos'::regclass AND conname = 'ad_videos_categories_1_5' AND convalidated) THEN
    hits := hits || E'\n  V2 CHECK ready_needs_check or ad_videos_categories_1_5 is missing';
  END IF;
  IF has_column_privilege('anon', 'public.videos', 'idempotency_key', 'SELECT')
     OR has_column_privilege('authenticated', 'public.videos', 'idempotency_key', 'SELECT')
     OR has_column_privilege('anon', 'public.video_versions', 'manifest_sha256', 'SELECT')
     OR has_column_privilege('authenticated', 'public.video_versions', 'manifest_sha256', 'SELECT')
     OR has_column_privilege('anon', 'public.video_versions', 'audio_sha256', 'SELECT')
     OR has_column_privilege('authenticated', 'public.video_versions', 'audio_sha256', 'SELECT')
     OR has_column_privilege('authenticated', 'public.video_music_checks', 'audio_sha256', 'SELECT')
     OR has_column_privilege('authenticated', 'public.video_music_checks', 'provider', 'SELECT')
     OR has_table_privilege('anon', 'public.video_music_checks', 'SELECT')
     OR has_table_privilege('authenticated', 'public.video_r2_purge_queue', 'SELECT') THEN
    hits := hits || E'\n  V3 a hidden column (or the purge queue) is readable by an API role';
  END IF;
  IF has_function_privilege('anon', 'public.video_begin_upload(text,text,bigint,numeric,boolean,uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.video_delete(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.video_housekeeping(interval,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.video_housekeeping(interval,integer)', 'EXECUTE') THEN
    hits := hits || E'\n  V3 a video RPC is callable by the wrong API role';
  END IF;
  SELECT count(*) INTO _n FROM public.videos v
    LEFT JOIN public.video_music_checks c ON c.id = v.music_check_id
   WHERE v.state = 'ready'
     AND (c.id IS NULL OR c.video_id <> v.id OR c.version_no <> v.current_version
          OR c.verdict NOT IN ('clean', 'clean_no_audio', 'clean_library', 'not_required'));
  IF _n > 0 THEN hits := hits || E'\n  V4 ' || _n || ' ready video(s) without a clean check of their current version'; END IF;
  SELECT count(*) INTO _n FROM (
    SELECT video_id FROM public.post_videos UNION ALL SELECT video_id FROM public.ad_videos) l
    JOIN public.videos v ON v.id = l.video_id WHERE v.state NOT IN ('ready', 'taken_down', 'deleted');
  IF _n > 0 THEN hits := hits || E'\n  V4 ' || _n || ' link(s) to a video that never became ready'; END IF;
  SELECT count(*) INTO _n FROM public.post_videos pv JOIN public.posts p ON p.id = pv.post_id
   WHERE cardinality(coalesce(p.categories, '{}')) NOT BETWEEN 1 AND 5;
  IF _n > 0 THEN hits := hits || E'\n  V4 ' || _n || ' video post(s) without 1–5 categories'; END IF;
  SELECT count(*) INTO _n FROM public.videos WHERE state = 'deleted' AND deleted_at < now() - interval '30 days 2 hours';
  IF _n > 0 THEN hits := hits || E'\n  V4 ' || _n || ' deleted video(s) kept past 30 days — the purge is not running'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'video-housekeeping' AND active) THEN
    hits := hits || E'\n  V5 the video-housekeeping job is not scheduled and active';
  END IF;
  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL VID-2:%', hits;
  END IF;
  RAISE NOTICE 'PROBE PASS VID-2: videos by state: %; post links %, ad links %, purge queue undone %',
    coalesce((SELECT string_agg(state || '=' || n, ', ' ORDER BY state) FROM (SELECT state, count(*) n FROM public.videos GROUP BY state) s), 'none'),
    (SELECT count(*) FROM public.post_videos), (SELECT count(*) FROM public.ad_videos),
    (SELECT count(*) FROM public.video_r2_purge_queue WHERE done_at IS NULL);
END
$probe$;
ROLLBACK;
