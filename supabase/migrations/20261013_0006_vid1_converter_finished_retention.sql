-- ═══════════════════════════════════════════════════════════════════════════
-- VID-1 · 20261013_0006 — server conversion: a FINISHED job is kept until its
-- video is posted or deleted; a converted video nobody posts is removed after
-- 30 days, and its files are queued for deletion.
-- Lanes: staging and production. Needs 20261005_0005 and 20261012_0002.
-- Owner requirement, 2026-10-13 (task 10). Must be on a lane BEFORE that
-- lane's Admin → Video Conversion is switched to "server". D1.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY. In server mode the member uploads the original and may close the app.
-- The app learns that the converter is finished by reading the member's own
-- public.video_sources row (status 'done' + video_id) — it holds no other
-- pointer to the made video (client: jobDeps.sourceRow, PR #423). Until this
-- file, video_source_housekeeping() deleted EVERY ended row 2 days after it
-- ended. A member who came back on day 3 was told "We can't find this video on
-- our server any more", while the converted video sat in storage, ready, owned
-- by them, reachable by nobody — and nothing ever removed it: video_housekeeping
-- purges only 'deleted' and 'failed' videos, never an unposted 'ready' one.
--
-- THE WORDS, AS THE SCHEMA HAS THEM
--   finished  video_sources.status = 'done'. The converter's package went
--             through `complete`; video_sources_done_has_video guarantees
--             video_id; the video is 'checking', 'ready' or 'music_blocked'.
--             ('failed' and 'cancelled' rows are ENDED, not finished: they made
--             no video and keep today's rule — purged 2 days after they end.)
--   posted    the video is linked: a public.post_videos row (written by
--             video_publish_post) or a public.ad_videos row (the admin's ad
--             link) names it. Read here, never written; video_publish_post is
--             not touched (it is unit 20261013_0004's).
--   deleted   the video is past use: state 'deleted' (video_delete — the owner
--             or an admin), 'failed' or 'taken_down'. The existing hourly
--             video_housekeeping purges 'deleted' / 'failed' videos and queues
--             their files 30 days later; this file does not go near them.
--   released  a finished row whose video is posted or deleted. Only a released
--             row is purged, by the same 2-day rule as before.
--
-- WHAT
--   1. public.video_source_housekeeping(integer) — 0002's body with ONE change:
--      the 2-day purge takes a 'done' row only when it is released. Everything
--      else (leases, the 24 h upload and 48 h queue timeouts, 'failed' and
--      'cancelled' rows, the 90-day audit purge, the returned keys) is 0002's.
--   2. public.video_source_unposted_cleanup(_keep interval DEFAULT '30 days',
--      _batch integer DEFAULT 200) — new, hourly ('47 * * * *', cron job
--      'video-source-unposted-cleanup'). For a finished row that is NOT posted,
--      whose video is 'checking' / 'ready' / 'music_blocked', and where BOTH the
--      job ended and the video last changed more than 30 days ago:
--        • the files are queued: public.video_r2_purge_queue gets
--          'video/<owner>/<video>/' — the existing queue and the same prefix
--          video_housekeeping writes; SQL never calls storage;
--        • the audit trail says so ('abandoned', "not posted in 30 days");
--        • the video row is deleted the way video_housekeeping deletes one
--          (through 'deleted', a legal move); its versions and checks cascade,
--          and so does the source row (video_sources.video_id ON DELETE CASCADE).
--      The 30 days run from the LATER of the two times, so a video whose music
--      check ended late, or that the member is still fixing, gets its full 30
--      days. _keep below 30 days is refused, as video_housekeeping refuses it.
--   3. trigger tg_video_sources_owner_gone (AFTER DELETE on video_sources) —
--      a DELETED ACCOUNT. Account deletion removes auth.users → profiles, and
--      the cascade removes the member's source rows and videos; until now
--      nothing queued the converted files. When a source row goes AND its
--      owner's profile is gone, the row's video prefix is queued. It does
--      nothing in every other delete (the release purge, the 30-day cleanup,
--      video_housekeeping): the owner is still there — so a posted video's
--      files are never queued by it.
--
-- THE RACE WITH PUBLISHING. tg_post_videos_link_guard / tg_ad_videos_link_guard
-- take the video row FOR UPDATE. The cleanup takes the same lock (SKIP LOCKED),
-- then looks for a link AGAIN in a new statement, i.e. a new snapshot, before
-- it touches anything. A publish that got there first is seen; one that comes
-- second waits on the lock, finds no video and is refused whole (VID-LINK-001),
-- so there is never a post without its video.
--
-- WHO CAN SEE / STOP WHAT (unchanged by this file)
--   • the owner reads their own rows (RLS video_sources_owner_read, the
--     granted columns only) for as long as the row is kept; nobody else does;
--   • video_source_cancel() on a finished job answers 'done' and changes
--     nothing; the owner (or an admin) removes a made video with
--     video_delete() — the row is then released;
--   • the two housekeeping functions and the trigger function are not
--     executable by PUBLIC, anon or authenticated. They take no caller
--     identity: they run from cron. No API role can reach them, so there is no
--     caller to restrict to (the cross-member cases are in the evidence).
--
-- STORAGE (not SQL — nothing to change for this file). The converted package
-- is served from 'video/<owner>/<video>/v<n>/…' (functions/api/video/complete.ts,
-- servedKey). The bucket's lifecycle rules cover 'upload/video/' (2 days) and
-- 'upload/source/' (8 days) only, and a rule prefix matches the START of a
-- key, so no rule deletes a converted video before its member posts it.
-- The original under 'upload/source/' is not needed once the job is done.
--
-- NOT COVERED HERE, said plainly
--   • nothing drains video_r2_purge_queue yet (the VID-6 file worker): queued
--     prefixes wait there;
--   • a deleted account's videos that have NO source row (every device-path
--     video, and converted videos whose row was already released) are still
--     not queued — that gap is in 20261005_0005's account path, not here.
--
-- RE-RUNNABLE: yes. A second apply replaces the same bodies, re-creates the
-- trigger and leaves one cron job.
-- ROLLBACK: supabase/rollback/20261013_0006_vid1_converter_finished_retention_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261013_0006_vid1_converter_finished_retention.sql
-- EVIDENCE: docs/evidence/d1/VID/converter-finished-retention/
-- OBJECTS (reservation): public.video_source_housekeeping(integer) (body only);
--   public.video_source_unposted_cleanup(interval, integer) (new);
--   public.tg_video_sources_owner_gone() + trigger tg_video_sources_owner_gone
--   on public.video_sources (new); cron job 'video-source-unposted-cleanup' (new).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE
  _hk    text;
  _guard text;
  _fn    text;
BEGIN
  -- PRE-001 · what this file builds on. Video is staging-only today: on a lane
  -- without the converter queue this refuses and changes nothing.
  IF to_regclass('public.video_sources') IS NULL OR to_regclass('public.video_source_events') IS NULL
     OR to_regclass('public.videos') IS NULL OR to_regclass('public.video_versions') IS NULL
     OR to_regclass('public.post_videos') IS NULL OR to_regclass('public.ad_videos') IS NULL
     OR to_regclass('public.video_r2_purge_queue') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regnamespace('cron') IS NULL
     OR to_regprocedure('public.video_source_housekeeping(integer)') IS NULL
     OR to_regprocedure('public.video_source_log(uuid,uuid,text,text)') IS NULL
     OR to_regprocedure('public.video_source_expire(uuid,uuid,integer,uuid)') IS NULL
     OR to_regprocedure('public.tg_videos_state_guard()') IS NULL THEN
    RAISE EXCEPTION 'VID-RET-PRE-001: the video tables (20261005_0005) or the converter queue (20261012_0002) are not on this lane — apply them first';
  END IF;

  -- PRE-002 · replace only the housekeeping body that was read: 0002's, or this file's own (a re-apply).
  SELECT prosrc INTO _hk FROM pg_proc WHERE oid = 'public.video_source_housekeeping(integer)'::regprocedure;
  IF position('VID-RET-0006' IN _hk) = 0
     AND (position('WHERE id IN (SELECT id FROM public.video_sources WHERE status IN (''done'', ''failed'', ''cancelled'')' IN _hk) = 0
          OR position('AND updated_at < now() - interval ''2 days'' ORDER BY updated_at LIMIT _batch);' IN _hk) = 0
          OR position('PERFORM public.video_source_expire(_x.id, _x.owner_id, _x.attempts, _x.video_id);' IN _hk) = 0
          OR position('''queue_timed_out'', _waited, ''purged'', _purged, ''events_purged'', _events' IN _hk) = 0) THEN
    RAISE EXCEPTION 'VID-RET-PRE-002: video_source_housekeeping() is neither the 20261012_0002 body nor this file''s — read it before replacing';
  END IF;

  -- PRE-003 · the facts the cleanup stands on.
  --   a · deleting a video removes its source row, its versions and (through them) its checks;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_sources'::regclass AND contype = 'f'
                   AND confrelid = 'public.videos'::regclass AND confdeltype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_versions'::regclass AND contype = 'f'
                      AND confrelid = 'public.videos'::regclass AND confdeltype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_music_checks'::regclass AND contype = 'f'
                      AND confrelid = 'public.video_versions'::regclass AND confdeltype = 'c') THEN
    RAISE EXCEPTION 'VID-RET-PRE-003: a video''s source row, versions or checks would not go with it (an ON DELETE CASCADE is missing)';
  END IF;
  --   b · account deletion reaches the source rows by cascade from the profile;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_sources'::regclass AND contype = 'f'
                   AND confrelid = 'public.profiles'::regclass AND confdeltype = 'c') THEN
    RAISE EXCEPTION 'VID-RET-PRE-003: video_sources.owner_id is not ON DELETE CASCADE from profiles';
  END IF;
  --   c · an unposted video may be moved to 'deleted' from each state the cleanup acts on;
  SELECT prosrc INTO _guard FROM pg_proc WHERE oid = 'public.tg_videos_state_guard()'::regprocedure;
  IF position('(''checking'', ''deleted'')' IN _guard) = 0 OR position('(''ready'', ''deleted'')' IN _guard) = 0
     OR position('(''music_blocked'', ''deleted'')' IN _guard) = 0 THEN
    RAISE EXCEPTION 'VID-RET-PRE-003: the video state guard no longer lets checking / ready / music_blocked move to deleted';
  END IF;
  --   d · the audit trail accepts the event the cleanup writes.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_source_events'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%abandoned%') THEN
    RAISE EXCEPTION 'VID-RET-PRE-003: video_source_events no longer accepts the event ''abandoned''';
  END IF;

  -- PRE-004 · the new names are free, or already this file's.
  SELECT prosrc INTO _fn FROM pg_proc WHERE oid = to_regprocedure('public.video_source_unposted_cleanup(interval,integer)');
  IF _fn IS NOT NULL AND position('VID-RET-0006' IN _fn) = 0 THEN
    RAISE EXCEPTION 'VID-RET-PRE-004: public.video_source_unposted_cleanup() exists and is not this file''s';
  END IF;
  SELECT prosrc INTO _fn FROM pg_proc WHERE oid = to_regprocedure('public.tg_video_sources_owner_gone()');
  IF _fn IS NOT NULL AND position('VID-RET-0006' IN _fn) = 0 THEN
    RAISE EXCEPTION 'VID-RET-PRE-004: public.tg_video_sources_owner_gone() exists and is not this file''s';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'video-source-unposted-cleanup'
               AND command <> 'SELECT public.video_source_unposted_cleanup();') THEN
    RAISE EXCEPTION 'VID-RET-PRE-004: a cron job named video-source-unposted-cleanup exists with another command';
  END IF;
END
$pre$;

-- ── 1. housekeeping: a finished row is purged only once it is released ──────
-- 20261012_0002's body, unchanged except the first DELETE (marked VID-RET-0006).
CREATE OR REPLACE FUNCTION public.video_source_housekeeping(_batch integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _x        record;
  _expired  bigint := 0;
  _stale    bigint := 0;
  _waited   bigint := 0;
  _purged   bigint;
  _events   bigint;
BEGIN
  IF _batch IS NULL OR _batch < 1 THEN
    RAISE EXCEPTION 'video_source_housekeeping: _batch must be at least 1' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR _x IN SELECT id, owner_id, attempts, video_id FROM public.video_sources
             WHERE status = 'converting' AND lease_until <= now() ORDER BY lease_until LIMIT _batch FOR UPDATE SKIP LOCKED LOOP
    PERFORM public.video_source_expire(_x.id, _x.owner_id, _x.attempts, _x.video_id);
    _expired := _expired + 1;
  END LOOP;
  FOR _x IN SELECT id, owner_id FROM public.video_sources
             WHERE status = 'awaiting_upload' AND created_at < now() - interval '24 hours'
             ORDER BY created_at LIMIT _batch FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.video_sources SET status = 'failed', error = public.video_source_reason_text('source_missing') WHERE id = _x.id;
    PERFORM public.video_source_log(_x.id, _x.owner_id, 'failed', 'upload never finished');
    _stale := _stale + 1;
  END LOOP;
  FOR _x IN SELECT id, owner_id, purpose FROM public.video_sources
             WHERE status = 'queued' AND queued_at < now() - interval '48 hours'
             ORDER BY queued_at LIMIT _batch FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.video_sources SET status = 'failed',
           error = public.video_source_reason_text(CASE WHEN public.video_owner_may(_x.owner_id, _x.purpose) THEN 'converter_away' ELSE 'not_allowed' END)
     WHERE id = _x.id;
    PERFORM public.video_source_log(_x.id, _x.owner_id, 'failed', 'queued 48 h, never claimed');
    _waited := _waited + 1;
  END LOOP;
  -- VID-RET-0006: ended rows go 2 days after they end — but a FINISHED row
  -- ('done') only once it is released: its video is posted (a post_videos or
  -- ad_videos link) or past use (deleted / failed / taken_down, or gone).
  -- Until then the member's app still needs the row to find the video; an
  -- unposted one is ended by video_source_unposted_cleanup after 30 days.
  DELETE FROM public.video_sources
   WHERE id IN (SELECT s.id FROM public.video_sources s
                 WHERE s.status IN ('done', 'failed', 'cancelled') AND s.updated_at < now() - interval '2 days'
                   AND (s.status <> 'done'
                        OR EXISTS (SELECT 1 FROM public.post_videos pv WHERE pv.video_id = s.video_id)
                        OR EXISTS (SELECT 1 FROM public.ad_videos av WHERE av.video_id = s.video_id)
                        OR NOT EXISTS (SELECT 1 FROM public.videos v
                                        WHERE v.id = s.video_id AND v.state NOT IN ('deleted', 'failed', 'taken_down')))
                 ORDER BY s.updated_at LIMIT _batch);
  GET DIAGNOSTICS _purged = ROW_COUNT;
  PERFORM set_config('vid.source_purge', 'on', true);
  DELETE FROM public.video_source_events
   WHERE id IN (SELECT id FROM public.video_source_events WHERE at < now() - interval '90 days' ORDER BY at LIMIT _batch);
  GET DIAGNOSTICS _events = ROW_COUNT;
  PERFORM set_config('vid.source_purge', 'off', true);
  RETURN jsonb_build_object('lease_expired', _expired, 'upload_abandoned', _stale, 'queue_timed_out', _waited, 'purged', _purged, 'events_purged', _events);
END;
$fn$;

-- ── 2. the 30-day cleanup of converted videos nobody posted ─────────────────
CREATE OR REPLACE FUNCTION public.video_source_unposted_cleanup(_keep interval DEFAULT interval '30 days', _batch integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _x    record;
  _ids  uuid[] := '{}';
BEGIN
  -- VID-RET-0006. Internal: cron only (no API role may execute it).
  IF _keep IS NULL OR _keep < interval '30 days' THEN
    RAISE EXCEPTION 'video_source_unposted_cleanup: _keep % is below the 30 days the Owner set', _keep USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _batch IS NULL OR _batch < 1 OR _batch > 1000 THEN
    RAISE EXCEPTION 'video_source_unposted_cleanup: _batch must be between 1 and 1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Finished, not posted, still usable, and quiet for _keep: the job ended AND
  -- the video last changed that long ago. Source first, then video — the lock
  -- order every converter function uses.
  FOR _x IN
    SELECT s.id AS source_id, s.owner_id, v.id AS video_id
      FROM public.video_sources s
      JOIN public.videos v ON v.id = s.video_id
     WHERE s.status = 'done' AND s.updated_at < now() - _keep
       AND v.state IN ('checking', 'ready', 'music_blocked') AND v.updated_at < now() - _keep
       AND NOT EXISTS (SELECT 1 FROM public.post_videos pv WHERE pv.video_id = v.id)
       AND NOT EXISTS (SELECT 1 FROM public.ad_videos av WHERE av.video_id = v.id)
     ORDER BY s.updated_at
     LIMIT _batch
     FOR UPDATE OF s, v SKIP LOCKED
  LOOP
    -- Looked at again under the lock, in a new statement (a new snapshot): a
    -- publish that finished after the query above began is seen here, and one
    -- that starts now waits on the video row and then finds no video.
    IF EXISTS (SELECT 1 FROM public.post_videos WHERE video_id = _x.video_id)
       OR EXISTS (SELECT 1 FROM public.ad_videos WHERE video_id = _x.video_id)
       OR NOT EXISTS (SELECT 1 FROM public.videos
                       WHERE id = _x.video_id AND state IN ('checking', 'ready', 'music_blocked') AND updated_at < now() - _keep) THEN
      CONTINUE;
    END IF;
    PERFORM public.video_source_log(_x.source_id, _x.owner_id, 'abandoned',
                                    'not posted in 30 days: video ' || _x.video_id || ' removed, its files queued for deletion');
    _ids := _ids || _x.video_id;
  END LOOP;
  IF cardinality(_ids) > 0 THEN
    -- The files: queued, never deleted from SQL (the existing queue and prefix of video_housekeeping).
    INSERT INTO public.video_r2_purge_queue (video_id, owner_id, prefix)
    SELECT id, owner_id, 'video/' || owner_id || '/' || id || '/' FROM public.videos WHERE id = ANY (_ids);
    -- 'deleted' is a legal move from each of the three states; it also lets the check link be cleared.
    UPDATE public.videos SET state = 'deleted', music_check_id = NULL WHERE id = ANY (_ids);
    PERFORM set_config('vid.purge', 'on', true);          -- lets the append-only checks cascade away, this txn only
    DELETE FROM public.videos WHERE id = ANY (_ids);       -- versions, checks and the source row go with it
    PERFORM set_config('vid.purge', 'off', true);
  END IF;
  RETURN jsonb_build_object('removed', cardinality(_ids));
END;
$fn$;

-- ── 3. a deleted account: queue the converted files its rows pointed at ─────
CREATE OR REPLACE FUNCTION public.tg_video_sources_owner_gone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
BEGIN
  -- VID-RET-0006. Only when the OWNER is gone (account deletion: auth.users →
  -- profiles → this row, by cascade). In every other delete of a source row
  -- the profile is still there and nothing is queued.
  IF OLD.video_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.owner_id) THEN
    INSERT INTO public.video_r2_purge_queue (video_id, owner_id, prefix)
    VALUES (OLD.video_id, OLD.owner_id, 'video/' || OLD.owner_id || '/' || OLD.video_id || '/');
  END IF;
  RETURN OLD;
END;
$fn$;
DROP TRIGGER IF EXISTS tg_video_sources_owner_gone ON public.video_sources;
CREATE TRIGGER tg_video_sources_owner_gone AFTER DELETE ON public.video_sources
  FOR EACH ROW EXECUTE FUNCTION public.tg_video_sources_owner_gone();

-- ── 4. grants + the hourly job ──────────────────────────────────────────────
-- New functions get the lane's default privileges (staging: authenticated;
-- production may add PUBLIC and anon): take them all away, on either lane.
REVOKE ALL ON FUNCTION public.video_source_unposted_cleanup(interval, integer), public.tg_video_sources_owner_gone(),
  public.video_source_housekeeping(integer)
  FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('video-source-unposted-cleanup', '47 * * * *', $cmd$SELECT public.video_source_unposted_cleanup();$cmd$);

DO $post$
DECLARE
  _f text;
BEGIN
  FOREACH _f IN ARRAY ARRAY['public.video_source_unposted_cleanup(interval,integer)', 'public.tg_video_sources_owner_gone()',
                            'public.video_source_housekeeping(integer)'] LOOP
    IF has_function_privilege('anon', _f, 'EXECUTE') OR has_function_privilege('authenticated', _f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   WHERE p.oid = _f::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'VID-RET-POST-001: % is executable by PUBLIC, anon or authenticated', _f;
    END IF;
  END LOOP;
  IF position('VID-RET-0006' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_source_housekeeping(integer)'::regprocedure)) = 0
     OR position('s.status <> ''done''' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_source_housekeeping(integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'VID-RET-POST-002: the housekeeping body did not land';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.video_sources'::regclass AND tgname = 'tg_video_sources_owner_gone'
         AND NOT tgisinternal AND tgenabled <> 'D') <> 1 THEN
    RAISE EXCEPTION 'VID-RET-POST-003: the owner-gone trigger is not in place';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'video-source-unposted-cleanup' AND schedule = '47 * * * *'
         AND command = 'SELECT public.video_source_unposted_cleanup();') <> 1
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'video-source-unposted-cleanup') <> 1
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'video-source-housekeeping' AND schedule = '*/5 * * * *') <> 1 THEN
    RAISE EXCEPTION 'VID-RET-POST-004: the cleanup job is not in place exactly once, or the 5-minute housekeeping job changed';
  END IF;
  RAISE NOTICE 'VID-RET-0006: finished converter rows are kept until posted or deleted; unposted converted videos are removed after 30 days with their files queued; a deleted account''s converted files are queued';
END
$post$;

COMMIT;
