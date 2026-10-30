-- ═══════════════════════════════════════════════════════════════════════════
-- 20261030_0700 — S7-a · the video FILE deleter: public.video_r2_purge_queue is
-- drained, and every way a video stops being used ends in that queue.
-- Lanes: staging and production (refuses any other lane). Needs 20261005_0005,
-- 20261012_0002 (video_sources, video_is_converter) and 20261013_0006.
-- Master plan S7 "purge-queue file deleter". Builder session S7, 2026-10-30.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY. 20261005_0005 queues 'video/<owner>/<video>/' when it purges a deleted or
-- failed video, and 20261013_0006 does the same for an unposted converted one —
-- but NOTHING ever deleted the files ("Nothing drains video_r2_purge_queue yet",
-- docs/evidence/d1/VID/converter-finished-retention/README.md). Two more holes:
--   • a video whose POST (or ad) is deleted stays 'ready' for ever: the link row
--     cascades away, the video does not, so the 30-day purge never sees it;
--   • an ACCOUNT deletion cascades the member's videos away without queuing
--     their files (0006 covers only videos made by the server converter).
--
-- WHAT
--   1. video_r2_purge_queue gets the worker's columns: not_before (a row is not
--      due before it — S7-b's takedown holds a version 30 days), claimed_until
--      (a 10-minute lease), attempts, last_error, outcome, objects_deleted.
--      New rows must name a well-formed prefix (CHECK … NOT VALID: old rows are
--      judged by the claim instead).
--   2. public.video_purge_referenced(video, owner, prefix) — the ONE rule for
--      "may these files go?" (internal, never granted):
--        'video/<o>/<v>/'      referenced while ANY public.videos row has id <v>.
--        'video/<o>/<v>/vN/'   referenced while the video exists and version N
--                              may still be served or be the source of what is:
--                              i.e. NOT (state taken_down / deleted / failed, or
--                              state ready on a later version than N).
--   3. public.video_purge_claim(_limit) — admin or the converter account only.
--      Due rows (not_before passed, unleased, < 10 attempts), oldest first,
--      FOR UPDATE SKIP LOCKED:
--        • a malformed prefix, or one that does not name the row's own owner and
--          video → closed 'bad_prefix', never handed out;
--        • a referenced whole-video prefix → closed 'kept_referenced';
--        • a referenced version prefix → put back 1 day (not_before + 1 day);
--        • anything else → leased 10 minutes and returned.
--   4. public.video_purge_done(_id, _objects, _error) — admin or the converter.
--      Only a leased, open row. _error → lease released, error kept, retried
--      after 15 min × attempts (10 attempts at most; then it stays open and
--      shows in the backlog for an admin). Otherwise closed 'deleted' with the object count. A second call on
--      a closed row answers 'already' (idempotent).
--   5. trigger tg_videos_queue_purge — AFTER DELETE on public.videos: queues
--      the whole prefix unless an open row for it is already there (the purge
--      and 0006 queue before they delete, so they are not doubled).
--   6. public.video_orphan_sweep(_keep, _batch, _as_of) — hourly, cron
--      'video-orphan-sweep' (minute 53). A video in 'ready', 'taken_down' or
--      'music_blocked' that is on no post and no ad, was not made by the
--      server converter (0006 owns those), and has not changed for 30 days →
--      'deleted' (a legal move). video_housekeeping then purges it 30 days
--      later, as every deleted video. 'checking' is never swept: that wait is on
--      our side. _keep below 30 days is refused. Not callable by any API role.
--
-- The Pages route POST /api/video/purge (functions/api/video/purge.ts) is the
-- worker: claim → list + delete the prefix through the lane's MEDIA binding
-- (and the matching upload/video/<o>/<v>/ leftovers for a whole video) → done.
-- tools/video-purge/run.mjs drives it on a schedule. SQL never calls storage.
--
-- ROLLBACK: supabase/rollback/20261030_0700_s7a_video_purge_worker_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_20261030_0700_s7a_video_purge_worker.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Dispatch apply-migration.yml (it sets p32.lane from target).',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  _bad text := '';
BEGIN
  IF to_regprocedure('public.video_purge_claim(integer)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'video_r2_purge_queue' AND column_name = 'not_before') THEN
    RAISE EXCEPTION 'S7A-0700-PRE-001: 20261030_0700 is applied already (video_purge_claim or not_before exists)'
      USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regclass('public.video_r2_purge_queue') IS NULL THEN _bad := _bad || E'\n  table video_r2_purge_queue missing (20261005_0005)'; END IF;
  IF to_regclass('public.videos') IS NULL THEN _bad := _bad || E'\n  table videos missing (20261005_0005)'; END IF;
  IF to_regclass('public.video_sources') IS NULL THEN _bad := _bad || E'\n  table video_sources missing (20261012_0002)'; END IF;
  IF to_regprocedure('public.video_is_converter()') IS NULL THEN _bad := _bad || E'\n  video_is_converter() missing'; END IF;
  IF to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL THEN _bad := _bad || E'\n  has_role(uuid, app_role) missing'; END IF;
  IF to_regprocedure('public.video_source_unposted_cleanup(interval,integer)') IS NULL THEN _bad := _bad || E'\n  video_source_unposted_cleanup missing (20261013_0006)'; END IF;
  IF to_regnamespace('cron') IS NULL OR to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN _bad := _bad || E'\n  pg_cron missing'; END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'video-orphan-sweep') THEN _bad := _bad || E'\n  cron job video-orphan-sweep exists already'; END IF;
  IF _bad <> '' THEN
    RAISE EXCEPTION 'S7A-0700-PRE-002: preconditions failed:%', _bad USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. the worker's columns ───────────────────────────────────────────────
ALTER TABLE public.video_r2_purge_queue
  ADD COLUMN not_before      timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN claimed_until   timestamptz,
  ADD COLUMN attempts        integer NOT NULL DEFAULT 0,
  ADD COLUMN last_error      text,
  ADD COLUMN outcome         text,
  ADD COLUMN objects_deleted integer;
-- A row someone closed by hand before this file gets an outcome, so the CHECK below holds.
UPDATE public.video_r2_purge_queue SET outcome = 'deleted' WHERE done_at IS NOT NULL;
ALTER TABLE public.video_r2_purge_queue
  ADD CONSTRAINT video_r2_purge_queue_outcome CHECK (outcome IN ('deleted', 'kept_referenced', 'bad_prefix')),
  ADD CONSTRAINT video_r2_purge_queue_closed CHECK ((done_at IS NULL) = (outcome IS NULL)),
  ADD CONSTRAINT video_r2_purge_queue_error_len CHECK (last_error IS NULL OR length(last_error) <= 300);
-- An OPEN row must name a well-formed folder. NOT VALID: rows already queued are
-- judged by the claim, which CLOSES a malformed one ('bad_prefix') — a closed row
-- passes this CHECK, so that UPDATE is never refused (review #539).
ALTER TABLE public.video_r2_purge_queue
  ADD CONSTRAINT video_r2_purge_queue_prefix_shape
  CHECK (done_at IS NOT NULL OR prefix ~ '^video/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(v[1-9][0-9]{0,5}/)?$')
  NOT VALID;
-- P28: the claim reads open rows by due time; replaces nothing (the 0005 index stays).
CREATE INDEX idx_video_r2_purge_queue_due ON public.video_r2_purge_queue (not_before, id) WHERE done_at IS NULL;

-- ── 2. the one rule: may these files go? ─────────────────────────────────
CREATE FUNCTION public.video_purge_referenced(_video_id uuid, _owner_id uuid, _prefix text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE
  _whole text := 'video/' || _owner_id::text || '/' || _video_id::text || '/';
  _n     integer;
  _v     record;
BEGIN
  -- 'bad'  : not a prefix this row may name; 'yes' : referenced; 'no' : may go.
  IF _prefix IS NULL OR _video_id IS NULL OR _owner_id IS NULL THEN RETURN 'bad'; END IF;
  IF _prefix = _whole THEN
    RETURN CASE WHEN EXISTS (SELECT 1 FROM public.videos WHERE id = _video_id) THEN 'yes' ELSE 'no' END;
  END IF;
  IF left(_prefix, length(_whole)) <> _whole OR substr(_prefix, length(_whole) + 1) !~ '^v[1-9][0-9]{0,5}/$' THEN
    RETURN 'bad';
  END IF;
  _n := substr(_prefix, length(_whole) + 2, length(_prefix) - length(_whole) - 2)::integer;
  SELECT state, current_version, owner_id INTO _v FROM public.videos WHERE id = _video_id;
  IF NOT FOUND THEN RETURN 'no'; END IF;
  IF _v.owner_id <> _owner_id THEN RETURN 'bad'; END IF;
  IF _v.state IN ('taken_down', 'deleted', 'failed') OR (_v.state = 'ready' AND _v.current_version > _n) THEN
    RETURN 'no';
  END IF;
  RETURN 'yes';
END;
$fn$;

CREATE FUNCTION public.video_purge_worker_ok()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $fn$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND (public.has_role((SELECT auth.uid()), 'admin'::public.app_role) OR public.video_is_converter());
$fn$;

-- ── 3. claim ─────────────────────────────────────────────────────────────
CREATE FUNCTION public.video_purge_claim(_limit integer DEFAULT 10)
RETURNS TABLE(id bigint, video_id uuid, owner_id uuid, prefix text, whole boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
#variable_conflict use_column
DECLARE
  _r   record;
  _ref text;
  _n   integer := 0;
  _max integer := least(greatest(coalesce(_limit, 10), 1), 50);
BEGIN
  IF NOT public.video_purge_worker_ok() THEN
    RAISE EXCEPTION 'VID-PURGE-001: only an admin or the converter may drain the video purge queue' USING ERRCODE = '42501';
  END IF;
  FOR _r IN
    SELECT q.id, q.video_id, q.owner_id, q.prefix FROM public.video_r2_purge_queue q
     WHERE q.done_at IS NULL AND q.not_before <= now()
       AND (q.claimed_until IS NULL OR q.claimed_until < now()) AND q.attempts < 10
     ORDER BY q.not_before, q.id
     LIMIT 200
     FOR UPDATE SKIP LOCKED
  LOOP
    EXIT WHEN _n >= _max;
    _ref := public.video_purge_referenced(_r.video_id, _r.owner_id, _r.prefix);
    IF _ref = 'bad' THEN
      UPDATE public.video_r2_purge_queue SET done_at = now(), outcome = 'bad_prefix' WHERE video_r2_purge_queue.id = _r.id;
    ELSIF _ref = 'yes' AND _r.prefix ~ '/v[0-9]+/$' THEN
      UPDATE public.video_r2_purge_queue SET not_before = now() + interval '1 day' WHERE video_r2_purge_queue.id = _r.id;
    ELSIF _ref = 'yes' THEN
      UPDATE public.video_r2_purge_queue SET done_at = now(), outcome = 'kept_referenced' WHERE video_r2_purge_queue.id = _r.id;
    ELSE
      UPDATE public.video_r2_purge_queue
         SET claimed_until = now() + interval '10 minutes', attempts = attempts + 1
       WHERE video_r2_purge_queue.id = _r.id;
      id := _r.id; video_id := _r.video_id; owner_id := _r.owner_id; prefix := _r.prefix;
      whole := _r.prefix !~ '/v[0-9]+/$';
      _n := _n + 1;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$fn$;

-- ── 4. done ──────────────────────────────────────────────────────────────
CREATE FUNCTION public.video_purge_done(_id bigint, _objects integer, _error text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE
  _q record;
BEGIN
  IF NOT public.video_purge_worker_ok() THEN
    RAISE EXCEPTION 'VID-PURGE-001: only an admin or the converter may drain the video purge queue' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _q FROM public.video_r2_purge_queue WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VID-PURGE-002: no such purge row' USING ERRCODE = 'no_data_found';
  END IF;
  IF _q.done_at IS NOT NULL THEN
    RETURN 'already';
  END IF;
  IF _q.claimed_until IS NULL THEN
    RAISE EXCEPTION 'VID-PURGE-003: that row was not claimed' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _error IS NOT NULL THEN
    UPDATE public.video_r2_purge_queue
       SET claimed_until = NULL, not_before = now() + interval '15 minutes' * attempts,
           last_error = left(regexp_replace(_error, '[^A-Za-z0-9 ._:/-]', '', 'g'), 300)
     WHERE id = _id;
    RETURN 'retry';
  END IF;
  IF _objects IS NULL OR _objects < 0 THEN
    RAISE EXCEPTION 'VID-PURGE-004: objects must be 0 or more' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.video_r2_purge_queue
     SET done_at = now(), outcome = 'deleted', objects_deleted = _objects, claimed_until = NULL, last_error = NULL
   WHERE id = _id;
  RETURN 'deleted';
END;
$fn$;

-- ── 5. any video row that goes queues its files ──────────────────────────
CREATE FUNCTION public.tg_videos_queue_purge()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE
  _p text := 'video/' || OLD.owner_id::text || '/' || OLD.id::text || '/';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.video_r2_purge_queue q
                  WHERE q.video_id = OLD.id AND q.prefix = _p AND q.done_at IS NULL) THEN
    INSERT INTO public.video_r2_purge_queue (video_id, owner_id, prefix) VALUES (OLD.id, OLD.owner_id, _p);
  END IF;
  RETURN OLD;
END;
$fn$;
CREATE TRIGGER tg_videos_queue_purge AFTER DELETE ON public.videos
  FOR EACH ROW EXECUTE FUNCTION public.tg_videos_queue_purge();

-- ── 6. a video on no post and no ad for 30 days → deleted ────────────────
CREATE FUNCTION public.video_orphan_sweep(_keep interval DEFAULT interval '30 days', _batch integer DEFAULT 500,
                                          _as_of timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE
  _n integer;
BEGIN
  IF _keep IS NULL OR _keep < interval '30 days' THEN
    RAISE EXCEPTION 'video_orphan_sweep: _keep % is below 30 days', _keep USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _batch IS NULL OR _batch < 1 THEN
    RAISE EXCEPTION 'video_orphan_sweep: _batch must be at least 1' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _as_of IS NULL OR _as_of < now() THEN
    RAISE EXCEPTION 'video_orphan_sweep: _as_of must not be in the past' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.videos SET state = 'deleted'
   WHERE id IN (
     SELECT v.id FROM public.videos v
      WHERE v.state IN ('ready', 'taken_down', 'music_blocked')
        AND v.updated_at < _as_of - _keep
        AND NOT EXISTS (SELECT 1 FROM public.post_videos pv WHERE pv.video_id = v.id)
        AND NOT EXISTS (SELECT 1 FROM public.ad_videos av WHERE av.video_id = v.id)
        AND NOT EXISTS (SELECT 1 FROM public.video_sources s WHERE s.video_id = v.id)
      ORDER BY v.updated_at
      LIMIT _batch
      FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$fn$;

-- ── 7. privileges ────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.video_purge_referenced(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.video_purge_worker_ok() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_videos_queue_purge() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.video_orphan_sweep(interval, integer, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.video_purge_claim(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.video_purge_done(bigint, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_purge_claim(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.video_purge_done(bigint, integer, text) TO authenticated;

SELECT cron.schedule('video-orphan-sweep', '53 * * * *', $cmd$SELECT public.video_orphan_sweep();$cmd$);

COMMENT ON FUNCTION public.video_purge_claim(integer) IS
  'S7-a: up to 50 due, unreferenced video purge rows, leased 10 min. Admin or converter only. '
  'Referenced whole prefixes close as kept_referenced; referenced version prefixes wait a day.';

DO $done$ BEGIN RAISE NOTICE 'S7A-0700: purge queue worker columns, claim/done, delete trigger, orphan sweep (cron video-orphan-sweep :53)'; END $done$;

COMMIT;
