-- ═══════════════════════════════════════════════════════════════════════════
-- VID-1 · 20261012_0002 — server-side conversion: the job queue the FREE
-- Oracle VM works from (docs/evidence/d2/phase5/VID-1/CONVERTER-DESIGN.md v2).
-- Lanes: staging and production. Needs 20261005_0004/0005/0007, 20261012_0001.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHY (Owner, 2026-10-12): the browser converts in real time and pauses in a
-- hidden tab — a 7:28 video kept the Owner waiting with the tab in front, and
-- formats a browser cannot decode cannot be posted at all. The member now
-- uploads the ORIGINAL once; the VM converts it and pushes the result through
-- the SAME gates a device does (upload-urls → complete → attested
-- video_mark_uploaded). The member previews and publishes it, as today.
--
-- THE VM'S POWER, AND WHERE IT ENDS (independent design review, R1–R9):
--   • ONE converter identity: a Supabase user listed in
--     public.video_converter_accounts (written only by migration — not an
--     app_role value: an enum value cannot be rolled back and would appear in
--     role pickers) [R9]. Empty after this migration: until a later migration
--     lists the user, every converter function refuses everything.
--   • it acts on a video only while it holds THAT video's source claim:
--     video_sources.video_id = the video, the claim token matches, status is
--     'converting', the lease is live (video_converter_version) [R2]. A
--     member's device-path video can never be reached (it has no source row).
--   • it never chooses the owner or purpose: both come from the source row
--     (video_converter_begin_version) [R5], which re-checks the owner's
--     switch, ban and account; one video per source (UNIQUE video_id) [R5].
--   • video_mark_uploaded checks the switch against the VIDEO'S OWNER, not the
--     caller [R3]; the converter may mark only a video it is converting.
--   • it cannot publish: publishing stays the member's own, client-side
--     (video_publish_post, SECURITY INVOKER) [Q2].
--   • caps count device videos AND sources together, each upload once; at most
--     2 open sources per member; server mode is enforced HERE, not only in the
--     app (site_settings 'video_conversion' = "server") [R5][R7].
--   • fair: the claim takes the member whose last claim is oldest first [R7].
--   • append-only audit trail (video_source_events) [R8]; member cancel [R8];
--     account deletion removes source rows (FK cascade) [R8]; the VM's
--     last-seen time and the queue age are readable by the health check
--     (video_converter_health) [R8].
--
-- WHAT
--   tables    video_converter_accounts, video_sources, video_source_events
--   member    video_source_begin, video_source_uploaded, video_source_cancel
--             (the member's video_source_uploaded is not trusted for the ETag:
--             /api/video/convert/claim re-HEADs the original before presigning
--             the GET, and a missing/changed original fails as source_missing)
--   converter video_source_claim, video_source_heartbeat,
--             video_converter_begin_version, video_converter_version,
--             video_source_fail, video_source_done
--   internal  video_is_converter, video_converter_acting, video_source_held, video_source_drop_video,
--             video_source_expire, video_owner_may, video_open_count, video_day_count, video_source_log,
--             video_source_housekeeping (cron, every 5 min), video_converter_health
--   changed   video_begin_upload (caps also count sources — body otherwise 0005's),
--             video_mark_uploaded (converter branch + owner's switch — body otherwise 0007's)
--   column    videos.converted_from (the source a converter-made video came from)
--   setting   site_settings 'video_conversion' = "device" (inserted if absent)
--
-- INDEPENDENT REVIEW of #416 (CHANGES-REQUIRED → all fixed here):
--   1 cancelling no longer frees the daily cap (every source counts, whatever
--     happens to it) · 2 one upload counts ONCE however many attempts it
--     takes (converter-made videos are marked converted_from and left out of
--     the videos half) · 3 an open source counts once even if its half-made
--     video was deleted · 4 the converter account cannot use the device path
--     either · 5 one live claim per converter; a queued job whose owner was
--     switched off or banned is failed, never handed out · 6 a failure after
--     `complete` ends the job as done; the member sees fixed text for a
--     reason CODE, the VM's own words go only to the audit trail · 8 the
--     PROBE checks more (constraints, grants on the replaced functions, the
--     cron command) · 9 the rollback refuses to overwrite later bodies ·
--     10 queued jobs time out after 48 h; one claim lives at most 6 h.
--   Re-review (APPROVE-WITH-NITS, fixed): a claim that reaches its 6 h ceiling
--   ends the job (final, not retried — one upload never holds the only VM for
--   3 × 6 h); a switched-off owner's queued job WAITS (a temporary Off does not
--   fail the queue; at 48 h it fails with the right text); a requeued job's
--   wait starts again; fail reads the video state under lock; claimed_at is
--   part of the converting CHECK.
--
-- ROLLBACK: supabase/rollback/20261012_0002_vid1_converter_sources_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_vid1_converter_sources.sql
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
BEGIN
  IF to_regclass('public.video_sources') IS NOT NULL OR to_regclass('public.video_converter_accounts') IS NOT NULL THEN
    RAISE EXCEPTION 'VID-CONV-PRE-001: video_sources already exists — 20261012_0002 is applied';
  END IF;
  IF to_regprocedure('public.feature_allowed(text,uuid)') IS NULL OR to_regprocedure('public.is_banned(uuid)') IS NULL
     OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'VID-CONV-PRE-002: feature_allowed / is_banned / has_role missing';
  END IF;
  IF position('_max_s    constant numeric := 86400;' IN coalesce((SELECT prosrc FROM pg_proc
       WHERE oid = to_regprocedure('public.video_validate_version(text,text,bigint,numeric,boolean,jsonb)')), '')) = 0 THEN
    RAISE EXCEPTION 'VID-CONV-PRE-003: video_validate_version() is not the 20261012_0001 body';
  END IF;
  IF position('VID-LIM-003: 10 video uploads in 24 hours is the limit' IN coalesce((SELECT prosrc FROM pg_proc
       WHERE oid = to_regprocedure('public.video_begin_upload(text,text,bigint,numeric,boolean,uuid,jsonb)')), '')) = 0
     OR position('video_sources' IN coalesce((SELECT prosrc FROM pg_proc
       WHERE oid = to_regprocedure('public.video_begin_upload(text,text,bigint,numeric,boolean,uuid,jsonb)')), '')) > 0 THEN
    RAISE EXCEPTION 'VID-CONV-PRE-004: video_begin_upload() is not the 20261005_0005 body — read it before replacing';
  END IF;
  IF position('F-D1-4' IN coalesce((SELECT prosrc FROM pg_proc
       WHERE oid = to_regprocedure('public.video_mark_uploaded(uuid,integer,text,bigint,text)')), '')) = 0
     OR position('video_converter_acting' IN coalesce((SELECT prosrc FROM pg_proc
       WHERE oid = to_regprocedure('public.video_mark_uploaded(uuid,integer,text,bigint,text)')), '')) > 0 THEN
    RAISE EXCEPTION 'VID-CONV-PRE-005: video_mark_uploaded() is not the 20261005_0007 body — read it before replacing';
  END IF;
END
$pre$;

-- ── 1. tables ──────────────────────────────────────────────────────────────
-- The converter identity [R9]. Rows are written only by migration. last_seen_at
-- is the VM's heartbeat for the health check [R8].
CREATE TABLE public.video_converter_accounts (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note          text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 200),
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.video_sources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  purpose          text NOT NULL CHECK (purpose IN ('post', 'ad')),
  idempotency_key  uuid NOT NULL,
  source_bytes     bigint NOT NULL CHECK (source_bytes BETWEEN 1 AND 524288000),
  source_etag      text CHECK (source_etag IS NULL OR source_etag ~ '^[0-9A-Za-z-]{1,80}$'),
  status           text NOT NULL DEFAULT 'awaiting_upload'
                   CHECK (status IN ('awaiting_upload', 'queued', 'converting', 'done', 'failed', 'cancelled')),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  claim_token      uuid,
  claimed_at       timestamptz,
  lease_until      timestamptz,
  video_id         uuid UNIQUE REFERENCES public.videos(id) ON DELETE CASCADE,
  error            text CHECK (error IS NULL OR char_length(error) <= 300),
  queued_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_sources_owner_idempotency_key UNIQUE (owner_id, idempotency_key),
  CONSTRAINT video_sources_converting_has_claim CHECK (status <> 'converting' OR (claim_token IS NOT NULL AND claimed_at IS NOT NULL AND lease_until IS NOT NULL)),
  CONSTRAINT video_sources_queued_has_etag CHECK (status NOT IN ('queued', 'converting') OR source_etag IS NOT NULL),
  CONSTRAINT video_sources_done_has_video CHECK (status <> 'done' OR video_id IS NOT NULL)
);
-- P28: the caps read one owner's open/recent rows; the claim reads the queue in order; housekeeping reads by status + age. Reviewed by D1 2026-10-12.
CREATE INDEX idx_video_sources_owner_created ON public.video_sources (owner_id, created_at DESC);
CREATE INDEX idx_video_sources_queue ON public.video_sources (queued_at) WHERE status = 'queued';
CREATE INDEX idx_video_sources_status_updated ON public.video_sources (status, updated_at);

-- Append-only audit [R8]. No foreign key on purpose: the trail outlives the
-- source row (purged 2 days after it ends) and holds ids and machine text only.
CREATE TABLE public.video_source_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id  uuid NOT NULL,
  owner_id   uuid NOT NULL,
  actor      uuid,
  event      text NOT NULL CHECK (event IN ('begin', 'uploaded', 'claimed', 'version', 'failed', 'requeued',
                                           'lease_expired', 'cancelled', 'done', 'abandoned')),
  detail     text CHECK (detail IS NULL OR char_length(detail) <= 300),
  at         timestamptz NOT NULL DEFAULT now()
);
-- P28: the fair claim reads each owner's latest 'claimed' event; retention reads by age. Reviewed by D1 2026-10-12.
CREATE INDEX idx_video_source_events_owner_claimed ON public.video_source_events (owner_id, at DESC) WHERE event = 'claimed';
CREATE INDEX idx_video_source_events_at ON public.video_source_events (at);

CREATE FUNCTION public.tg_video_source_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $fn$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('vid.source_purge', true) = 'on' THEN
    RETURN OLD;                                  -- retention (90 days), this transaction only
  END IF;
  RAISE EXCEPTION 'VID-SRC-EVT-001: the source audit trail is append-only' USING ERRCODE = 'check_violation';
END;
$fn$;
CREATE TRIGGER tg_video_source_events_append_only BEFORE UPDATE OR DELETE ON public.video_source_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_video_source_events_append_only();
CREATE TRIGGER tg_video_source_events_no_truncate BEFORE TRUNCATE ON public.video_source_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_video_source_events_append_only();

CREATE FUNCTION public.tg_video_sources_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $fn$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.source_bytes IS DISTINCT FROM OLD.source_bytes
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'VID-SRC-STATE-001: owner, purpose, key, size and created_at never change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.source_etag IS NOT NULL AND NEW.source_etag IS DISTINCT FROM OLD.source_etag THEN
    RAISE EXCEPTION 'VID-SRC-STATE-002: the recorded source ETag never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status, NEW.status) IN (
       ('awaiting_upload', 'queued'), ('awaiting_upload', 'failed'), ('awaiting_upload', 'cancelled'),
       ('queued', 'converting'), ('queued', 'cancelled'), ('queued', 'failed'),
       ('converting', 'queued'), ('converting', 'done'), ('converting', 'failed'), ('converting', 'cancelled'))) THEN
    RAISE EXCEPTION 'VID-SRC-STATE-003: % → % is not a legal move', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER tg_video_sources_touch BEFORE UPDATE ON public.video_sources FOR EACH ROW EXECUTE FUNCTION public.tg_video_sources_touch();

-- A converter-made video remembers its source, so the caps count the upload
-- once (the source), not once per attempt (review #416 finding 2). Written
-- only by video_converter_begin_version; not readable by API roles (videos
-- has column grants, and this column is not among them).
ALTER TABLE public.videos ADD COLUMN converted_from uuid;

-- ── 2. access ──────────────────────────────────────────────────────────────
ALTER TABLE public.video_converter_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_source_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_converter_accounts, public.video_sources, public.video_source_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.video_source_events_id_seq FROM PUBLIC, anon, authenticated;

-- The owner reads their own jobs (status, error, video) — never the claim token, lease or ETag.
CREATE POLICY video_sources_owner_read ON public.video_sources FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
GRANT SELECT (id, owner_id, purpose, idempotency_key, source_bytes, status, attempts, video_id, error, queued_at, created_at, updated_at)
  ON public.video_sources TO authenticated;

-- ── 3. internal helpers ─────────────────────────────────────────────────────
CREATE FUNCTION public.video_is_converter()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  RETURN (SELECT auth.uid()) IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.video_converter_accounts WHERE user_id = (SELECT auth.uid()));
END;
$fn$;

-- The converter is acting for this video right now: its source is being
-- converted under a live lease. (The claim token is checked by the functions
-- the VM calls with it; video_mark_uploaded is reached only through
-- `complete`'s attestation, which `complete` mints only after
-- video_converter_version accepted the token.)
CREATE FUNCTION public.video_converter_acting(_video_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  RETURN public.video_is_converter() AND EXISTS (
    SELECT 1 FROM public.video_sources
     WHERE video_id = _video_id AND status = 'converting' AND lease_until > now());
END;
$fn$;

CREATE FUNCTION public.video_source_log(_source_id uuid, _owner_id uuid, _event text, _detail text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  INSERT INTO public.video_source_events (source_id, owner_id, actor, event, detail)
  VALUES (_source_id, _owner_id, (SELECT auth.uid()), _event, left(_detail, 300));
$fn$;

-- The owner may still make this kind of video: switch on, not banned, account live.
CREATE FUNCTION public.video_owner_may(_owner_id uuid, _purpose text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF _owner_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _owner_id) OR public.is_banned(_owner_id) THEN
    RETURN false;
  END IF;
  RETURN CASE _purpose
    WHEN 'post' THEN public.feature_allowed('video_posts', _owner_id)
    WHEN 'ad'   THEN public.has_role(_owner_id, 'admin'::public.app_role) AND public.feature_allowed('video_ads', _owner_id)
    ELSE false END;
END;
$fn$;

-- Uploads under way for an owner, each counted ONCE: an open source counts
-- as one (whatever became of its half-made video); a device video counts as
-- one; a converter-made video counts only once its source has ended (it is
-- then the member's video, checking like any other).
CREATE FUNCTION public.video_open_count(_owner_id uuid, _purpose text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT (SELECT count(*) FROM public.videos v
           WHERE v.owner_id = _owner_id AND v.purpose = _purpose AND v.state IN ('uploading', 'checking')
             AND (v.converted_from IS NULL OR NOT EXISTS (
                   SELECT 1 FROM public.video_sources s
                    WHERE s.id = v.converted_from AND s.status IN ('awaiting_upload', 'queued', 'converting'))))
       + (SELECT count(*) FROM public.video_sources WHERE owner_id = _owner_id AND purpose = _purpose
            AND status IN ('awaiting_upload', 'queued', 'converting'));
$fn$;

-- Post uploads started in the last 24 h, each counted ONCE: every source
-- (cancelled, failed or done alike — cancelling never frees the day, review
-- #416 finding 1) plus every device video; converter-made videos are the
-- sources' own and are not counted again (finding 2).
CREATE FUNCTION public.video_day_count(_owner_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT (SELECT count(*) FROM public.videos WHERE owner_id = _owner_id AND purpose = 'post' AND converted_from IS NULL
            AND created_at > now() - interval '24 hours')
       + (SELECT count(*) FROM public.video_sources WHERE owner_id = _owner_id AND purpose = 'post'
            AND created_at > now() - interval '24 hours');
$fn$;

-- ── 4. caps shared with the device path [R5]: video_begin_upload ────────────
-- 0005's body, unchanged except the two counts, which now include sources.
CREATE OR REPLACE FUNCTION public.video_begin_upload(_purpose text, _manifest_sha256 text, _total_bytes bigint,
                                          _declared_duration_s numeric, _has_audio boolean,
                                          _idempotency_key uuid, _rendition_bytes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _uid      uuid := (SELECT auth.uid());
  _v        record;
  _id       uuid;
  _n        bigint;
  _rends    text[];
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'VID-UP-001: sign in first' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- 20261012_0002 (review #416 finding 4): the converter account uploads nothing of its own.
  IF public.video_is_converter() THEN
    RAISE EXCEPTION 'VID-SRC-002: the converter account cannot upload videos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _purpose IS NULL OR _purpose NOT IN ('post', 'ad') THEN
    RAISE EXCEPTION 'VID-UP-002: purpose must be post or ad' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- The switch is the enforcement point (VID-7): a crafted request changes nothing.
  IF _purpose = 'post' AND NOT public.feature_allowed('video_posts', _uid) THEN
    RAISE EXCEPTION 'VID-UP-003: video posts are not enabled for this member' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _purpose = 'ad' AND NOT (public.has_role(_uid, 'admin'::public.app_role) AND public.feature_allowed('video_ads', _uid)) THEN
    RAISE EXCEPTION 'VID-UP-003: video ads are admin-only and must be enabled' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _idempotency_key IS NULL THEN
    RAISE EXCEPTION 'VID-UP-004: an idempotency key is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Same key → the same row (OFF-2), checked before the limits so a retry never counts twice.
  SELECT id, purpose, state, current_version INTO _v FROM public.videos WHERE owner_id = _uid AND idempotency_key = _idempotency_key;
  IF FOUND THEN
    IF _v.purpose <> _purpose THEN
      RAISE EXCEPTION 'VID-UP-004: this idempotency key was used for a %', _v.purpose USING ERRCODE = 'invalid_parameter_value';
    END IF;
    RETURN jsonb_build_object('video_id', _v.id, 'version_no', _v.current_version, 'state', _v.state, 'replayed', true);
  END IF;
  -- Size rules (R-97, SEC F-D3-15 condition 4).
  _rends := public.video_validate_version(_purpose, _manifest_sha256, _total_bytes, _declared_duration_s, _has_audio, _rendition_bytes);
  -- Count rules (R-97). Serialised per member so two parallel calls cannot both slip under a cap.
  -- 20261012_0002: the same lock and the same counts as video_source_begin —
  -- device videos and server-converted sources share one budget [R5].
  PERFORM pg_advisory_xact_lock(hashtextextended('video_begin_upload:' || _uid::text, 0));
  IF _purpose = 'post' THEN
    _n := public.video_day_count(_uid);
    IF _n >= 10 THEN
      RAISE EXCEPTION 'VID-LIM-003: 10 video uploads in 24 hours is the limit' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  _n := public.video_open_count(_uid, _purpose);
  IF _n >= (CASE _purpose WHEN 'post' THEN 3 ELSE 10 END) THEN
    RAISE EXCEPTION 'VID-LIM-004: too many videos in progress at once (%)', _n USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.videos (owner_id, purpose, idempotency_key) VALUES (_uid, _purpose, _idempotency_key)
  ON CONFLICT ON CONSTRAINT videos_owner_idempotency_key DO NOTHING
  RETURNING id INTO _id;
  IF _id IS NULL THEN                               -- lost a race with the same key: return the winner
    SELECT id, current_version, state INTO _v FROM public.videos WHERE owner_id = _uid AND idempotency_key = _idempotency_key;
    RETURN jsonb_build_object('video_id', _v.id, 'version_no', _v.current_version, 'state', _v.state, 'replayed', true);
  END IF;
  INSERT INTO public.video_versions (video_id, version_no, manifest_sha256, total_bytes, declared_duration_s, has_audio,
                                     rendition_bytes, renditions)
  VALUES (_id, 1, _manifest_sha256, _total_bytes, _declared_duration_s, _has_audio, _rendition_bytes, _rends);
  RETURN jsonb_build_object('video_id', _id, 'version_no', 1, 'state', 'uploading', 'replayed', false);
END;
$fn$;

-- ── 5. member functions ─────────────────────────────────────────────────────
-- Start a server conversion: the member is about to upload the original.
CREATE FUNCTION public.video_source_begin(_purpose text, _source_bytes bigint, _idempotency_key uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _uid  uuid := (SELECT auth.uid());
  _s    record;
  _n    bigint;
  _id   uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'VID-UP-001: sign in first' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _purpose IS NULL OR _purpose NOT IN ('post', 'ad') THEN
    RAISE EXCEPTION 'VID-UP-002: purpose must be post or ad' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _idempotency_key IS NULL THEN
    RAISE EXCEPTION 'VID-UP-004: an idempotency key is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Server mode is decided here, not in the app [R7].
  IF coalesce((SELECT value #>> '{}' FROM public.site_settings WHERE key = 'video_conversion'), 'device') <> 'server' THEN
    RAISE EXCEPTION 'VID-SRC-001: server conversion is switched off on this site' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF public.video_is_converter() THEN
    RAISE EXCEPTION 'VID-SRC-002: the converter account cannot upload videos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.video_owner_may(_uid, _purpose) THEN
    RAISE EXCEPTION 'VID-UP-003: video % is not enabled for this member', _purpose USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Same key → the same job, checked before the limits so a retry never counts twice.
  SELECT id, purpose, status, video_id INTO _s FROM public.video_sources WHERE owner_id = _uid AND idempotency_key = _idempotency_key;
  IF FOUND THEN
    IF _s.purpose <> _purpose THEN
      RAISE EXCEPTION 'VID-UP-004: this idempotency key was used for a %', _s.purpose USING ERRCODE = 'invalid_parameter_value';
    END IF;
    RETURN jsonb_build_object('source_id', _s.id, 'status', _s.status, 'video_id', _s.video_id, 'replayed', true);
  END IF;
  IF _source_bytes IS NULL OR _source_bytes < 1 OR _source_bytes > 524288000 THEN
    RAISE EXCEPTION 'VID-LIM-002: a video is at most 500 MB (declared % bytes)', _source_bytes USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('video_begin_upload:' || _uid::text, 0));
  IF _purpose = 'post' AND public.video_day_count(_uid) >= 10 THEN
    RAISE EXCEPTION 'VID-LIM-003: 10 video uploads in 24 hours is the limit' USING ERRCODE = 'check_violation';
  END IF;
  _n := public.video_open_count(_uid, _purpose);
  IF _n >= (CASE _purpose WHEN 'post' THEN 3 ELSE 10 END) THEN
    RAISE EXCEPTION 'VID-LIM-004: too many videos in progress at once (%)', _n USING ERRCODE = 'check_violation';
  END IF;
  -- One VM, many members: nobody fills the queue [R7].
  SELECT count(*) INTO _n FROM public.video_sources
   WHERE owner_id = _uid AND status IN ('awaiting_upload', 'queued', 'converting');
  IF _n >= 2 THEN
    RAISE EXCEPTION 'VID-SRC-003: two videos are already waiting to be converted — wait for one to finish' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.video_sources (owner_id, purpose, idempotency_key, source_bytes)
  VALUES (_uid, _purpose, _idempotency_key, _source_bytes)
  ON CONFLICT ON CONSTRAINT video_sources_owner_idempotency_key DO NOTHING
  RETURNING id INTO _id;
  IF _id IS NULL THEN
    SELECT id, status, video_id INTO _s FROM public.video_sources WHERE owner_id = _uid AND idempotency_key = _idempotency_key;
    RETURN jsonb_build_object('source_id', _s.id, 'status', _s.status, 'video_id', _s.video_id, 'replayed', true);
  END IF;
  PERFORM public.video_source_log(_id, _uid, 'begin', _purpose || ' ' || _source_bytes || ' bytes');
  RETURN jsonb_build_object('source_id', _id, 'status', 'awaiting_upload', 'video_id', NULL, 'replayed', false);
END;
$fn$;

-- The original is in the bucket (called by /api/video/source-complete, as the
-- member, with the ETag it just read): queue it.
CREATE FUNCTION public.video_source_uploaded(_source_id uuid, _etag text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _uid  uuid := (SELECT auth.uid());
  _s    record;
BEGIN
  SELECT id, owner_id, purpose, status INTO _s FROM public.video_sources WHERE id = _source_id FOR UPDATE;
  IF _uid IS NULL OR NOT FOUND OR _s.owner_id <> _uid THEN
    RAISE EXCEPTION 'VID-SRC-004: no such video of yours' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _s.status <> 'awaiting_upload' THEN                     -- a retry: answer, change nothing
    RETURN jsonb_build_object('source_id', _s.id, 'status', _s.status, 'replayed', true);
  END IF;
  IF _etag IS NULL OR _etag !~ '^[0-9A-Za-z-]{1,80}$' THEN
    RAISE EXCEPTION 'VID-SRC-005: the source ETag is missing or malformed' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT public.video_owner_may(_uid, _s.purpose) THEN
    RAISE EXCEPTION 'VID-UP-003: video % is switched off for this member', _s.purpose USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.video_sources SET status = 'queued', source_etag = _etag, queued_at = now() WHERE id = _source_id;
  PERFORM public.video_source_log(_source_id, _uid, 'uploaded', NULL);
  RETURN jsonb_build_object('source_id', _source_id, 'status', 'queued', 'replayed', false);
END;
$fn$;

-- The member stops a job that has not finished [R8].
CREATE FUNCTION public.video_source_cancel(_source_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _uid  uuid := (SELECT auth.uid());
  _s    record;
BEGIN
  SELECT id, owner_id, status, video_id INTO _s FROM public.video_sources WHERE id = _source_id FOR UPDATE;
  IF _uid IS NULL OR NOT FOUND OR _s.owner_id <> _uid THEN
    RAISE EXCEPTION 'VID-SRC-004: no such video of yours' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _s.status IN ('done', 'failed', 'cancelled') THEN
    RETURN _s.status;
  END IF;
  UPDATE public.video_sources SET status = 'cancelled', claim_token = NULL, lease_until = NULL WHERE id = _source_id;
  -- A half-made video goes too (only while it is still uploading).
  PERFORM public.video_source_drop_video(_source_id);
  PERFORM public.video_source_log(_source_id, _uid, 'cancelled', NULL);
  RETURN 'cancelled';
END;
$fn$;

-- ── 6. converter functions ──────────────────────────────────────────────────
-- Take the next job: leases that ran out go back to the queue first; then the
-- member whose last claim is oldest goes first [R7].
CREATE FUNCTION public.video_source_claim()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _s     record;
  _x     record;
  _token uuid := gen_random_uuid();
BEGIN
  IF NOT public.video_is_converter() THEN
    RAISE EXCEPTION 'VID-CONV-001: converter only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.video_converter_accounts SET last_seen_at = now()
   WHERE user_id = (SELECT auth.uid()) AND (last_seen_at IS NULL OR last_seen_at < now() - interval '1 minute');
  FOR _x IN SELECT id, owner_id, attempts, video_id FROM public.video_sources
             WHERE status = 'converting' AND lease_until <= now() FOR UPDATE SKIP LOCKED LOOP
    PERFORM public.video_source_expire(_x.id, _x.owner_id, _x.attempts, _x.video_id);
  END LOOP;
  -- One job at a time (design §6, review #416 finding 5): a stolen token cannot
  -- take the whole queue — it holds at most the one live claim.
  PERFORM pg_advisory_xact_lock(hashtextextended('video_source_claim', 0));
  IF EXISTS (SELECT 1 FROM public.video_sources WHERE status = 'converting' AND lease_until > now()) THEN
    RAISE EXCEPTION 'VID-CONV-007: a job is already being converted — finish it (done or fail) first' USING ERRCODE = 'check_violation';
  END IF;
  -- A job whose owner is switched off or banned right now is never handed out
  -- (its original is not read) — it WAITS: a temporary Off must not fail the
  -- whole queue (re-review NIT 2). Housekeeping fails it after 48 h.
  SELECT s.id, s.owner_id, s.purpose, s.source_bytes, s.source_etag, s.attempts INTO _s
    FROM public.video_sources s
   WHERE s.status = 'queued' AND public.video_owner_may(s.owner_id, s.purpose)
   ORDER BY (SELECT max(e.at) FROM public.video_source_events e WHERE e.owner_id = s.owner_id AND e.event = 'claimed') NULLS FIRST,
            s.queued_at
   LIMIT 1
   FOR UPDATE OF s SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE public.video_sources
     SET status = 'converting', claim_token = _token, claimed_at = now(), lease_until = now() + interval '30 minutes',
         attempts = _s.attempts + 1, error = NULL
   WHERE id = _s.id;
  PERFORM public.video_source_log(_s.id, _s.owner_id, 'claimed', 'attempt ' || (_s.attempts + 1));
  RETURN jsonb_build_object('source_id', _s.id, 'owner_id', _s.owner_id, 'purpose', _s.purpose, 'source_bytes', _s.source_bytes,
                            'source_etag', _s.source_etag, 'claim_token', _token, 'lease_until', now() + interval '30 minutes',
                            'attempt', _s.attempts + 1);
END;
$fn$;

-- What a member reads when a job ends badly: fixed text for a reason CODE.
-- The converter's own words never reach a member (review #416 finding 6) —
-- they are kept in the audit trail only. Internal.
CREATE FUNCTION public.video_source_reason_text(_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $fn$
  SELECT CASE _code
    WHEN 'unsupported_format' THEN 'This file''s format can''t be converted. Try exporting it as MP4 and upload again.'
    WHEN 'no_video'           THEN 'This file has no video in it.'
    WHEN 'too_long'           THEN 'This video is too long to convert here. Please upload a shorter video.'
    WHEN 'too_big'            THEN 'This video is too large to convert.'
    WHEN 'damaged'            THEN 'This file looks damaged and could not be read.'
    WHEN 'source_missing'     THEN 'The upload did not arrive completely. Please upload the video again.'
    WHEN 'not_allowed'        THEN 'Video uploads are switched off for your account, so this video was not converted.'
    WHEN 'gave_up'            THEN 'Converting this video kept failing. Please try again, or try a different file.'
    WHEN 'converter_away'     THEN 'The video converter was not available. Please upload the video again later.'
    ELSE 'Converting this video failed. Please try again.' END;
$fn$;

-- A source lets go of a half-made video: one still uploading is deleted, and
-- the link is cleared for any video that will never finish (deleted, failed),
-- so the next attempt starts clean. A video already through `complete` is kept.
-- Internal.
CREATE FUNCTION public.video_source_drop_video(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _vid uuid;
BEGIN
  SELECT video_id INTO _vid FROM public.video_sources WHERE id = _id;
  IF _vid IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.videos SET state = 'deleted' WHERE id = _vid AND state = 'uploading';
  IF (SELECT state FROM public.videos WHERE id = _vid) IN ('deleted', 'failed') THEN
    UPDATE public.video_sources SET video_id = NULL WHERE id = _id;
  END IF;
END;
$fn$;

-- A lease that ran out. If `complete` already went through (the VM stopped
-- just before saying so), the job is done; otherwise back to the queue, or
-- failed after the third attempt. Internal (claim and housekeeping call it).
CREATE FUNCTION public.video_source_expire(_id uuid, _owner_id uuid, _attempts integer, _video_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF (SELECT state FROM public.videos WHERE id = _video_id) IN ('checking', 'ready', 'music_blocked') THEN
    UPDATE public.video_sources SET status = 'done', claim_token = NULL, lease_until = NULL WHERE id = _id;
    PERFORM public.video_source_log(_id, _owner_id, 'done', 'lease ran out after upload; video ' || _video_id);
    RETURN;
  END IF;
  PERFORM public.video_source_drop_video(_id);
  IF (SELECT claimed_at FROM public.video_sources WHERE id = _id) <= now() - interval '6 hours' THEN
    -- The claim used its whole 6 h: retrying would hold the only VM for another
    -- 6 h, and a video that long will not fit next time either (re-review LOW 1).
    UPDATE public.video_sources SET status = 'failed', claim_token = NULL, lease_until = NULL,
           error = public.video_source_reason_text('too_long') WHERE id = _id;
  ELSIF _attempts >= 3 THEN
    UPDATE public.video_sources SET status = 'failed', claim_token = NULL, lease_until = NULL,
           error = public.video_source_reason_text('gave_up') WHERE id = _id;
  ELSE
    UPDATE public.video_sources SET status = 'queued', claim_token = NULL, lease_until = NULL, queued_at = now() WHERE id = _id;
  END IF;
  PERFORM public.video_source_log(_id, _owner_id, 'lease_expired', 'attempts ' || _attempts);
END;
$fn$;

-- The claim, checked: the converter, this source, this token, converting, lease live.
CREATE FUNCTION public.video_source_held(_source_id uuid, _claim_token uuid)
RETURNS public.video_sources
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _s public.video_sources;
BEGIN
  IF NOT public.video_is_converter() THEN
    RAISE EXCEPTION 'VID-CONV-001: converter only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO _s FROM public.video_sources WHERE id = _source_id FOR UPDATE;
  IF NOT FOUND OR _claim_token IS NULL OR _s.claim_token IS DISTINCT FROM _claim_token
     OR _s.status <> 'converting' OR _s.lease_until <= now() THEN
    RAISE EXCEPTION 'VID-CONV-002: this claim is not held (wrong token, expired lease, or not converting)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN _s;
END;
$fn$;

-- Still working: extend the lease (only while the claim is held) [R2].
CREATE FUNCTION public.video_source_heartbeat(_source_id uuid, _claim_token uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _s public.video_sources;
BEGIN
  _s := public.video_source_held(_source_id, _claim_token);
  -- A claim lives at most 6 h (review #416 finding 10): the lease never goes
  -- past claimed_at + 6 h, so held() refuses after that and housekeeping ends
  -- the job as too_long (it is not retried).
  UPDATE public.video_sources SET lease_until = least(now() + interval '30 minutes', _s.claimed_at + interval '6 hours') WHERE id = _s.id;
  UPDATE public.video_converter_accounts SET last_seen_at = now() WHERE user_id = (SELECT auth.uid());
  RETURN least(now() + interval '30 minutes', _s.claimed_at + interval '6 hours');
END;
$fn$;

-- The converted package's version: owner and purpose from the SOURCE, the
-- owner re-checked, one video per source [R5].
CREATE FUNCTION public.video_converter_begin_version(_source_id uuid, _claim_token uuid, _manifest_sha256 text, _total_bytes bigint,
                                                     _declared_duration_s numeric, _has_audio boolean, _rendition_bytes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _s      public.video_sources;
  _v      record;
  _ver    record;
  _id     uuid;
  _rends  text[];
BEGIN
  _s := public.video_source_held(_source_id, _claim_token);
  IF NOT public.video_owner_may(_s.owner_id, _s.purpose) THEN
    RAISE EXCEPTION 'VID-UP-003: video % is switched off for the owner (or the owner cannot post)', _s.purpose USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _s.video_id IS NOT NULL THEN
    SELECT id, state, idempotency_key, current_version INTO _v FROM public.videos WHERE id = _s.video_id FOR UPDATE;
    IF _v.idempotency_key = _claim_token THEN
      -- This attempt already made it: a retry gets the same video, if it asks for the same package.
      SELECT manifest_sha256 INTO _ver FROM public.video_versions WHERE video_id = _v.id AND version_no = 1;
      IF _ver.manifest_sha256 IS DISTINCT FROM _manifest_sha256 THEN
        RAISE EXCEPTION 'VID-CONV-003: this attempt already declared a different package' USING ERRCODE = 'check_violation';
      END IF;
      RETURN jsonb_build_object('video_id', _v.id, 'version_no', _v.current_version, 'state', _v.state, 'replayed', true);
    END IF;
    IF _v.state NOT IN ('uploading', 'deleted', 'failed') THEN
      RAISE EXCEPTION 'VID-CONV-004: this source already has a video that is %', _v.state USING ERRCODE = 'check_violation';
    END IF;
    -- An earlier attempt's half-made video: it goes, this attempt starts clean.
    PERFORM public.video_source_drop_video(_s.id);
    UPDATE public.video_sources SET video_id = NULL WHERE id = _s.id;
    PERFORM public.video_source_log(_s.id, _s.owner_id, 'abandoned', 'video ' || _v.id);
  END IF;
  _rends := public.video_validate_version(_s.purpose, _manifest_sha256, _total_bytes, _declared_duration_s, _has_audio, _rendition_bytes);
  -- The claim token is this attempt's idempotency key: unique per attempt, never chosen by the VM.
  INSERT INTO public.videos (owner_id, purpose, idempotency_key, converted_from) VALUES (_s.owner_id, _s.purpose, _claim_token, _s.id)
  RETURNING id INTO _id;
  INSERT INTO public.video_versions (video_id, version_no, manifest_sha256, total_bytes, declared_duration_s, has_audio,
                                     rendition_bytes, renditions)
  VALUES (_id, 1, _manifest_sha256, _total_bytes, _declared_duration_s, _has_audio, _rendition_bytes, _rends);
  UPDATE public.video_sources SET video_id = _id WHERE id = _s.id;
  PERFORM public.video_source_log(_s.id, _s.owner_id, 'version', 'video ' || _id);
  RETURN jsonb_build_object('video_id', _id, 'version_no', 1, 'state', 'uploading', 'replayed', false);
END;
$fn$;

-- For /api/video/upload-urls and /complete on the converter path: the same
-- facts video_upload_info gives an owner, for the claimed video only [R2].
-- Videos RLS and video_upload_info are NOT widened.
CREATE FUNCTION public.video_converter_version(_video_id uuid, _version_no integer, _claim_token uuid)
RETURNS TABLE (video_id uuid, owner_id uuid, state text, current_version integer, purpose text,
               manifest_sha256 text, total_bytes bigint, declared_duration_s numeric, has_audio boolean,
               lease_until timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF NOT public.video_is_converter() THEN
    RETURN;                                       -- nothing, as for a stranger
  END IF;
  RETURN QUERY
    SELECT v.id, v.owner_id, v.state, v.current_version, v.purpose,
           ver.manifest_sha256, ver.total_bytes, ver.declared_duration_s, ver.has_audio,
           s.lease_until    -- presigned URLs never outlive the claim [R2]
      FROM public.video_sources s
      JOIN public.videos v ON v.id = s.video_id
      JOIN public.video_versions ver ON ver.video_id = v.id AND ver.version_no = v.current_version
     WHERE s.video_id = _video_id AND s.claim_token = _claim_token AND _claim_token IS NOT NULL
       AND s.status = 'converting' AND s.lease_until > now()
       AND v.current_version = _version_no AND v.deleted_at IS NULL;
END;
$fn$;

-- The job failed. _code is one of a fixed list; the member reads the fixed
-- text for it (video_source_reason_text), never the converter's words, which
-- go to the audit trail only. 'internal' is retried while attempts remain;
-- every other code is final. If `complete` already went through, the job is
-- simply done (review #416 finding 6).
CREATE FUNCTION public.video_source_fail(_source_id uuid, _claim_token uuid, _code text, _detail text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _s     public.video_sources;
  _state text;
BEGIN
  _s := public.video_source_held(_source_id, _claim_token);
  IF _code IS NULL OR _code NOT IN ('internal', 'unsupported_format', 'no_video', 'too_long', 'too_big', 'damaged', 'source_missing') THEN
    RAISE EXCEPTION 'VID-CONV-005: unknown failure code %', _code USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Under lock (source → video, the order every function uses): a mark in flight finishes first (re-review NIT 4).
  SELECT state INTO _state FROM public.videos WHERE id = _s.video_id FOR UPDATE;
  IF _state IN ('checking', 'ready', 'music_blocked') THEN
    UPDATE public.video_sources SET status = 'done', claim_token = NULL, lease_until = NULL WHERE id = _s.id;
    PERFORM public.video_source_log(_s.id, _s.owner_id, 'done', 'fail(' || _code || ') after upload; video ' || _s.video_id);
    RETURN 'done';
  END IF;
  PERFORM public.video_source_drop_video(_s.id);
  IF _code = 'internal' AND _s.attempts < 3 THEN
    UPDATE public.video_sources SET status = 'queued', claim_token = NULL, lease_until = NULL, queued_at = now() WHERE id = _s.id;
    PERFORM public.video_source_log(_s.id, _s.owner_id, 'requeued', _code || ': ' || coalesce(_detail, ''));
    RETURN 'queued';
  END IF;
  UPDATE public.video_sources SET status = 'failed', claim_token = NULL, lease_until = NULL,
         error = public.video_source_reason_text(CASE WHEN _code = 'internal' THEN 'gave_up' ELSE _code END)
   WHERE id = _s.id;
  PERFORM public.video_source_log(_s.id, _s.owner_id, 'failed', _code || ': ' || coalesce(_detail, ''));
  RETURN 'failed';
END;
$fn$;

-- The package is through `complete` (the video is checking or ready): the job is done.
CREATE FUNCTION public.video_source_done(_source_id uuid, _claim_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _s     public.video_sources;
  _state text;
BEGIN
  _s := public.video_source_held(_source_id, _claim_token);
  SELECT state INTO _state FROM public.videos WHERE id = _s.video_id;
  IF _state IS NULL OR _state NOT IN ('checking', 'ready', 'music_blocked') THEN
    RAISE EXCEPTION 'VID-CONV-006: the video is not uploaded yet (%)', coalesce(_state, 'no video') USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.video_sources SET status = 'done', claim_token = NULL, lease_until = NULL WHERE id = _s.id;
  PERFORM public.video_source_log(_s.id, _s.owner_id, 'done', 'video ' || _s.video_id || ' ' || _state);
  RETURN jsonb_build_object('source_id', _s.id, 'video_id', _s.video_id, 'state', _state);
END;
$fn$;

-- ── 7. video_mark_uploaded: the converter branch [R3] ───────────────────────
-- 0007's body, unchanged except: (a) the converter may mark a video it is
-- converting right now (video_converter_acting), (b) the switch is checked
-- against the VIDEO'S OWNER — for a member marking their own video that is
-- the same person, so the device path is unchanged.
CREATE OR REPLACE FUNCTION public.video_mark_uploaded(_video_id uuid, _version_no integer, _audio_sha256 text,
                                           _issued_at bigint, _attest text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _uid   uuid := (SELECT auth.uid());
  _v     record;
  _ver   record;
  _mode  text;
  _cid   uuid;
BEGIN
  SELECT id, owner_id, purpose, state, current_version INTO _v FROM public.videos WHERE id = _video_id FOR UPDATE;
  IF _uid IS NULL OR NOT FOUND OR (_v.owner_id <> _uid AND NOT public.video_converter_acting(_video_id)) THEN
    RAISE EXCEPTION 'VID-MU-001: no such video of yours' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _version_no IS DISTINCT FROM _v.current_version THEN
    RAISE EXCEPTION 'VID-MU-002: version % is not the current version (%)', _version_no, _v.current_version USING ERRCODE = 'check_violation';
  END IF;
  -- F-D1-4: only a completion signed by `complete` goes further — replay answer included.
  PERFORM public.video_attest_verify(_video_id, _version_no, _audio_sha256, _issued_at, _attest);
  -- A retry from the outbox (OFF-2) after the first call went through: answer, change nothing.
  IF _v.state <> 'uploading' THEN
    RETURN jsonb_build_object('video_id', _v.id, 'version_no', _v.current_version, 'state', _v.state, 'replayed', true);
  END IF;
  -- The switch that let the upload start must still be on (an Off switch stops every path) — the OWNER's switch [R3].
  IF (_v.purpose = 'post' AND NOT public.feature_allowed('video_posts', _v.owner_id))
     OR (_v.purpose = 'ad' AND NOT public.feature_allowed('video_ads', _v.owner_id)) THEN
    RAISE EXCEPTION 'VID-UP-003: video % is switched off for this member', _v.purpose USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _audio_sha256 IS NOT NULL AND _audio_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'VID-MU-003: audio_sha256 must be 64 lowercase hex' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT has_audio INTO _ver FROM public.video_versions WHERE video_id = _video_id AND version_no = _version_no;
  IF NOT _ver.has_audio AND _audio_sha256 IS NOT NULL THEN
    RAISE EXCEPTION 'VID-MU-003: a version without audio has no audio hash' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  _mode := CASE WHEN public.feature_allowed('copyright_music_check', _v.owner_id) THEN 'on' ELSE 'off' END;

  UPDATE public.video_versions SET uploaded_at = now() WHERE video_id = _video_id AND version_no = _version_no;
  UPDATE public.videos SET state = 'checking', failed_reason = NULL WHERE id = _video_id;

  IF _mode = 'off' AND (NOT _ver.has_audio OR _audio_sha256 IS NOT NULL) THEN
    -- R-102: Off → publish with any audio; the hash is stored anyway and binds the check.
    IF _ver.has_audio THEN
      UPDATE public.video_versions SET audio_sha256 = _audio_sha256 WHERE video_id = _video_id AND version_no = _version_no;
    END IF;
    INSERT INTO public.video_music_checks (video_id, version_no, provider, attempt, verdict, audio_sha256, mode_at_check)
    VALUES (_video_id, _version_no, 'switch_off', 1, 'not_required', _audio_sha256, 'off')
    RETURNING id INTO _cid;
    UPDATE public.videos SET state = 'ready', music_check_id = _cid WHERE id = _video_id;   -- the 0005 gate validates
    RETURN jsonb_build_object('video_id', _video_id, 'version_no', _version_no, 'state', 'ready', 'music_check', 'off', 'replayed', false);
  END IF;
  -- On (or Off without a hash): a pending check for the worker. A hash handed in
  -- by the client is NOT stored when the check is on — only the worker's own
  -- hash of the served bytes binds an 'on' check.
  INSERT INTO public.video_music_checks (video_id, version_no, provider, attempt, verdict, mode_at_check)
  VALUES (_video_id, _version_no, 'queue', 1, 'pending', _mode);
  RETURN jsonb_build_object('video_id', _video_id, 'version_no', _version_no, 'state', 'checking', 'music_check', _mode, 'replayed', false);
END;
$fn$;

-- ── 8. housekeeping + health [R8] ───────────────────────────────────────────
-- Every 5 minutes: run-out leases back to the queue (or failed after 3);
-- uploads never finished in 24 h → failed; ended jobs purged after 2 days
-- (the R2 lifecycle rule removes their objects); audit rows after 90 days.
CREATE FUNCTION public.video_source_housekeeping(_batch integer DEFAULT 500)
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
  DELETE FROM public.video_sources
   WHERE id IN (SELECT id FROM public.video_sources WHERE status IN ('done', 'failed', 'cancelled')
                   AND updated_at < now() - interval '2 days' ORDER BY updated_at LIMIT _batch);
  GET DIAGNOSTICS _purged = ROW_COUNT;
  PERFORM set_config('vid.source_purge', 'on', true);
  DELETE FROM public.video_source_events
   WHERE id IN (SELECT id FROM public.video_source_events WHERE at < now() - interval '90 days' ORDER BY at LIMIT _batch);
  GET DIAGNOSTICS _events = ROW_COUNT;
  PERFORM set_config('vid.source_purge', 'off', true);
  RETURN jsonb_build_object('lease_expired', _expired, 'upload_abandoned', _stale, 'queue_timed_out', _waited, 'purged', _purged, 'events_purged', _events);
END;
$fn$;

-- For the health check (service role): how long the oldest job has waited and
-- when the VM last reported. Alert when jobs wait and the VM is silent.
CREATE FUNCTION public.video_converter_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT jsonb_build_object(
    'queued', (SELECT count(*) FROM public.video_sources WHERE status = 'queued'),
    'converting', (SELECT count(*) FROM public.video_sources WHERE status = 'converting'),
    'oldest_queued_s', (SELECT floor(extract(epoch FROM now() - min(queued_at)))::bigint FROM public.video_sources WHERE status = 'queued'),
    'vm_last_seen_s', (SELECT floor(extract(epoch FROM now() - max(last_seen_at)))::bigint FROM public.video_converter_accounts),
    'alert', EXISTS (SELECT 1 FROM public.video_sources WHERE status = 'queued' AND queued_at < now() - interval '30 minutes')
             OR (EXISTS (SELECT 1 FROM public.video_sources WHERE status IN ('queued', 'converting'))
                 AND coalesce((SELECT max(last_seen_at) FROM public.video_converter_accounts), '-infinity'::timestamptz) < now() - interval '10 minutes'));
$fn$;

SELECT cron.schedule('video-source-housekeeping', '*/5 * * * *', $cmd$SELECT public.video_source_housekeeping();$cmd$);

-- Default: the device converts (today's behaviour). An admin switches to "server".
INSERT INTO public.site_settings (key, value) VALUES ('video_conversion', '"device"'::jsonb) ON CONFLICT (key) DO NOTHING;

-- ── 9. grants ───────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.video_source_begin(text, bigint, uuid), public.video_source_uploaded(uuid, text), public.video_source_cancel(uuid),
  public.video_source_claim(), public.video_source_heartbeat(uuid, uuid),
  public.video_converter_begin_version(uuid, uuid, text, bigint, numeric, boolean, jsonb),
  public.video_converter_version(uuid, integer, uuid), public.video_source_fail(uuid, uuid, text, text),
  public.video_source_done(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.video_source_begin(text, bigint, uuid), public.video_source_uploaded(uuid, text), public.video_source_cancel(uuid),
  public.video_source_claim(), public.video_source_heartbeat(uuid, uuid),
  public.video_converter_begin_version(uuid, uuid, text, bigint, numeric, boolean, jsonb),
  public.video_converter_version(uuid, integer, uuid), public.video_source_fail(uuid, uuid, text, text),
  public.video_source_done(uuid, uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION
  public.video_is_converter(), public.video_converter_acting(uuid), public.video_source_log(uuid, uuid, text, text),
  public.video_owner_may(uuid, text), public.video_open_count(uuid, text), public.video_day_count(uuid),
  public.video_source_expire(uuid, uuid, integer, uuid), public.video_source_drop_video(uuid), public.video_source_held(uuid, uuid),
  public.video_source_housekeeping(integer), public.video_converter_health(), public.video_source_reason_text(text),
  public.tg_video_source_events_append_only(), public.tg_video_sources_touch()
  FROM PUBLIC, anon, authenticated;
-- The health check reads the queue as the service role (review #416 finding 8).
GRANT EXECUTE ON FUNCTION public.video_converter_health() TO service_role;

DO $post$
BEGIN
  IF has_table_privilege('authenticated', 'public.video_sources', 'INSERT,UPDATE,DELETE')
     OR has_column_privilege('authenticated', 'public.video_sources', 'claim_token', 'SELECT')
     OR has_column_privilege('authenticated', 'public.video_sources', 'source_etag', 'SELECT')
     OR has_column_privilege('authenticated', 'public.video_sources', 'lease_until', 'SELECT')
     OR has_table_privilege('anon', 'public.video_sources', 'SELECT')
     OR has_table_privilege('authenticated', 'public.video_source_events', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.video_converter_accounts', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_function_privilege('anon', 'public.video_source_claim()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.video_converter_acting(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.video_source_held(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.video_owner_may(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.video_source_housekeeping(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.video_converter_health()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.video_converter_health()', 'EXECUTE')
     OR has_column_privilege('authenticated', 'public.videos', 'converted_from', 'SELECT')
     OR has_column_privilege('anon', 'public.videos', 'converted_from', 'SELECT')
     OR has_column_privilege('authenticated', 'public.video_sources', 'claimed_at', 'SELECT') THEN
    RAISE EXCEPTION 'VID-CONV-POST-001: a write path, a hidden column or an internal function is reachable by an API role';
  END IF;
  IF (SELECT count(*) FROM public.video_converter_accounts) <> 0 THEN
    RAISE EXCEPTION 'VID-CONV-POST-002: no converter account may exist yet (a later migration lists it)';
  END IF;
  IF position('video_day_count' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_begin_upload(text,text,bigint,numeric,boolean,uuid,jsonb)'::regprocedure)) = 0
     OR position('video_is_converter()' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_begin_upload(text,text,bigint,numeric,boolean,uuid,jsonb)'::regprocedure)) = 0
     OR position('_v.owner_id))' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_mark_uploaded(uuid,integer,text,bigint,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'VID-CONV-POST-003: the shared caps or the owner''s switch did not land';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'video-source-housekeeping' AND schedule = '*/5 * * * *') <> 1 THEN
    RAISE EXCEPTION 'VID-CONV-POST-004: the source housekeeping job is not in place';
  END IF;
  RAISE NOTICE 'VID-CONV-0002: converter job queue — sources, audit, claim/lease/heartbeat, begin_version from the source, shared caps, owner switch on mark, housekeeping; no converter account yet';
END
$post$;

COMMIT;
