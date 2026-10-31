-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · VID-1 20261013_0006 — finished converter rows kept until posted or
-- deleted; 30-day cleanup of unposted converted videos. READ-ONLY. Ends in ROLLBACK.
--   R1 · video_source_housekeeping() purges a finished ('done') row only when
--        it is released (posted through post_videos / ad_videos, or its video
--        is deleted / failed / taken_down); still DEFINER, search_path '', not
--        callable by an API role; its job still runs every 5 minutes.
--   R2 · video_source_unposted_cleanup(interval, integer) exists: DEFINER,
--        search_path '', refuses less than 30 days, queues the files in
--        video_r2_purge_queue (never a storage call), locks the video and
--        looks for a link again; not executable by PUBLIC, anon or authenticated.
--   R3 · exactly one cron job 'video-source-unposted-cleanup', '47 * * * *',
--        active, running only that function (no HTTP, no vault, no secret).
--   R4 · trigger tg_video_sources_owner_gone: AFTER DELETE, per row, enabled;
--        its function queues only when the owner's profile is gone and is not
--        callable by an API role.
--   R5 · what the cleanup stands on is still true: a video's source row,
--        versions and checks go with it (ON DELETE CASCADE); the state guard
--        still lets checking / ready / music_blocked move to deleted; no API
--        role reads the purge queue.
--   R6 · it is RUNNING: no finished, unposted, usable video is more than 31
--        days past both of its clocks (the job runs hourly, 200 per run).
-- The NOTICE also reports what is kept, what waits, and the queue's backlog
-- (nothing drains video_r2_purge_queue until the VID-6 file worker exists).
-- Before 20261013_0006 this probe FAILS (R1–R4). After it: PASS.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  hits      text := '';
  _f        text;
  _src      text;
  _p        record;
  _kept     bigint;
  _released bigint;
  _late     bigint;
  _queue    bigint;
BEGIN
  IF to_regclass('public.video_sources') IS NULL OR to_regclass('public.videos') IS NULL
     OR to_regclass('public.video_r2_purge_queue') IS NULL
     OR to_regprocedure('public.video_source_housekeeping(integer)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL VID-RET: the converter queue is not on this lane — are 20261005_0005 and 20261012_0002 applied?';
  END IF;

  -- R1
  SELECT prosrc, prosecdef, proconfig INTO _p FROM pg_proc WHERE oid = 'public.video_source_housekeeping(integer)'::regprocedure;
  IF position('VID-RET-0006' IN _p.prosrc) = 0 OR position('s.status <> ''done''' IN _p.prosrc) = 0
     OR position('FROM public.post_videos pv WHERE pv.video_id = s.video_id' IN _p.prosrc) = 0
     OR position('FROM public.ad_videos av WHERE av.video_id = s.video_id' IN _p.prosrc) = 0
     OR position('v.state NOT IN (''deleted'', ''failed'', ''taken_down'')' IN _p.prosrc) = 0
     OR position('s.updated_at < now() - interval ''2 days''' IN _p.prosrc) = 0 THEN
    hits := hits || E'\n  R1 video_source_housekeeping() still purges every finished row after 2 days (it does not wait for posted / deleted)';
  END IF;
  IF NOT _p.prosecdef OR _p.proconfig IS NULL OR NOT ('search_path=""' = ANY (_p.proconfig))
     OR has_function_privilege('anon', 'public.video_source_housekeeping(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.video_source_housekeeping(integer)', 'EXECUTE') THEN
    hits := hits || E'\n  R1 video_source_housekeeping() is not DEFINER/search_path, or an API role can execute it';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'video-source-housekeeping' AND schedule = '*/5 * * * *' AND active
         AND command = 'SELECT public.video_source_housekeeping();') <> 1 THEN
    hits := hits || E'\n  R1 the 5-minute source housekeeping job is not in place';
  END IF;

  -- R2
  IF to_regprocedure('public.video_source_unposted_cleanup(interval,integer)') IS NULL THEN
    hits := hits || E'\n  R2 public.video_source_unposted_cleanup(interval, integer) does not exist — nothing removes an unposted converted video';
  ELSE
    SELECT prosrc, prosecdef, proconfig, provolatile INTO _p FROM pg_proc WHERE oid = 'public.video_source_unposted_cleanup(interval,integer)'::regprocedure;
    IF NOT _p.prosecdef OR _p.proconfig IS NULL OR NOT ('search_path=""' = ANY (_p.proconfig)) OR _p.provolatile <> 'v' THEN
      hits := hits || E'\n  R2 the cleanup is not SECURITY DEFINER with search_path ''''';
    END IF;
    IF position('_keep < interval ''30 days''' IN _p.prosrc) = 0
       OR position('INSERT INTO public.video_r2_purge_queue (video_id, owner_id, prefix)' IN _p.prosrc) = 0
       OR position('''video/'' || owner_id || ''/'' || id || ''/''' IN _p.prosrc) = 0
       OR position('FOR UPDATE OF s, v SKIP LOCKED' IN _p.prosrc) = 0
       OR position('IF EXISTS (SELECT 1 FROM public.post_videos WHERE video_id = _x.video_id)' IN _p.prosrc) = 0
       OR position('OR EXISTS (SELECT 1 FROM public.ad_videos WHERE video_id = _x.video_id)' IN _p.prosrc) = 0
       OR position('v.state IN (''checking'', ''ready'', ''music_blocked'') AND v.updated_at < now() - _keep' IN _p.prosrc) = 0
       OR position('s.status = ''done'' AND s.updated_at < now() - _keep' IN _p.prosrc) = 0
       OR _p.prosrc ~* 'net\.http|vault\.|storage\.' THEN
      hits := hits || E'\n  R2 the cleanup body is not as designed (30-day floor, the purge queue, lock + second look, both clocks, no storage call)';
    END IF;
    IF has_function_privilege('anon', 'public.video_source_unposted_cleanup(interval,integer)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.video_source_unposted_cleanup(interval,integer)', 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE p.oid = 'public.video_source_unposted_cleanup(interval,integer)'::regprocedure
                     AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      hits := hits || E'\n  R2 the cleanup is executable by PUBLIC, anon or authenticated';
    END IF;
  END IF;

  -- R3
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'video-source-unposted-cleanup') <> 1
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'video-source-unposted-cleanup' AND schedule = '47 * * * *' AND active
            AND command = 'SELECT public.video_source_unposted_cleanup();') <> 1 THEN
    hits := hits || E'\n  R3 the hourly job video-source-unposted-cleanup is missing, doubled, inactive, or not ''47 * * * *'' with exactly the cleanup command';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE command ILIKE '%video_source_unposted_cleanup%' AND jobname <> 'video-source-unposted-cleanup') THEN
    hits := hits || E'\n  R3 another cron job also runs the cleanup';
  END IF;

  -- R4
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE t.tgrelid = 'public.video_sources'::regclass AND t.tgname = 'tg_video_sources_owner_gone' AND NOT t.tgisinternal
         AND t.tgenabled <> 'D' AND t.tgtype = 9 AND p.proname = 'tg_video_sources_owner_gone') <> 1 THEN
    hits := hits || E'\n  R4 trigger tg_video_sources_owner_gone is missing, disabled, or not AFTER DELETE FOR EACH ROW — a deleted account''s converted files are not queued';
  ELSE
    SELECT prosrc, proconfig INTO _p FROM pg_proc WHERE oid = 'public.tg_video_sources_owner_gone()'::regprocedure;
    IF position('NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.owner_id)' IN _p.prosrc) = 0
       OR position('OLD.video_id IS NOT NULL' IN _p.prosrc) = 0
       OR _p.proconfig IS NULL OR NOT ('search_path=""' = ANY (_p.proconfig))
       OR has_function_privilege('anon', 'public.tg_video_sources_owner_gone()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.tg_video_sources_owner_gone()', 'EXECUTE') THEN
      hits := hits || E'\n  R4 the owner-gone trigger function queues without checking that the owner is gone, has no search_path, or is callable by an API role';
    END IF;
  END IF;

  -- R5
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_sources'::regclass AND contype = 'f'
                   AND confrelid = 'public.videos'::regclass AND confdeltype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_sources'::regclass AND contype = 'f'
                      AND confrelid = 'public.profiles'::regclass AND confdeltype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_versions'::regclass AND contype = 'f'
                      AND confrelid = 'public.videos'::regclass AND confdeltype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_music_checks'::regclass AND contype = 'f'
                      AND confrelid = 'public.video_versions'::regclass AND confdeltype = 'c') THEN
    hits := hits || E'\n  R5 a cascade the cleanup relies on is missing (video → source row / versions / checks, profile → source row)';
  END IF;
  SELECT prosrc INTO _src FROM pg_proc WHERE oid = to_regprocedure('public.tg_videos_state_guard()');
  IF _src IS NULL OR position('(''checking'', ''deleted'')' IN _src) = 0 OR position('(''ready'', ''deleted'')' IN _src) = 0
     OR position('(''music_blocked'', ''deleted'')' IN _src) = 0 THEN
    hits := hits || E'\n  R5 the video state guard no longer lets checking / ready / music_blocked move to deleted';
  END IF;
  FOREACH _f IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(_f, 'public.video_r2_purge_queue', 'SELECT') OR has_table_privilege(_f, 'public.video_r2_purge_queue', 'INSERT')
       OR has_table_privilege(_f, 'public.video_sources', 'DELETE') OR has_table_privilege(_f, 'public.video_sources', 'UPDATE') THEN
      hits := hits || E'\n  R5 ' || _f || ' can read or write the purge queue, or change / delete source rows';
    END IF;
  END LOOP;

  -- R6 + what the NOTICE reports
  SELECT count(*) FILTER (WHERE NOT rel),
         count(*) FILTER (WHERE rel),
         count(*) FILTER (WHERE NOT rel AND usable AND ended < now() - interval '31 days' AND changed < now() - interval '31 days')
    INTO _kept, _released, _late
    FROM (SELECT s.updated_at AS ended, v.updated_at AS changed,
                 v.state IN ('checking', 'ready', 'music_blocked') AS usable,
                 (EXISTS (SELECT 1 FROM public.post_videos pv WHERE pv.video_id = s.video_id)
                  OR EXISTS (SELECT 1 FROM public.ad_videos av WHERE av.video_id = s.video_id)
                  OR v.id IS NULL OR v.state IN ('deleted', 'failed', 'taken_down')) AS rel
            FROM public.video_sources s LEFT JOIN public.videos v ON v.id = s.video_id
           WHERE s.status = 'done') x;
  IF _late > 0 THEN
    hits := hits || E'\n  R6 ' || _late || ' finished, unposted video(s) are more than 31 days old — the hourly cleanup is not keeping up, or not running';
  END IF;
  SELECT count(*) INTO _queue FROM public.video_r2_purge_queue WHERE done_at IS NULL;

  IF hits <> '' THEN RAISE EXCEPTION 'PROBE FAIL VID-RET:%', hits; END IF;
  RAISE NOTICE 'PROBE PASS VID-RET: finished rows wait for posted/deleted (2-day purge once released), 30-day cleanup hourly at :47 → purge queue, owner-gone trigger on, no API role reaches any of it. Now: % finished row(s) kept (unposted), % released and waiting for the 2-day purge, % file prefix(es) waiting in video_r2_purge_queue. pg_cron %.',
    _kept, _released, _queue, coalesce((SELECT extversion FROM pg_extension WHERE extname = 'pg_cron'), '(not an extension here)');
END
$probe$;
ROLLBACK;
