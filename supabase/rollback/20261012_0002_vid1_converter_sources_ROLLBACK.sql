-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · VID-1 20261012_0002 — converter job queue.
-- Puts back video_begin_upload (20261005_0005 body) and video_mark_uploaded
-- (20261005_0007 body) exactly, then drops everything 0002 created: the
-- source-housekeeping cron job, the converter/member/internal functions, the
-- tables video_sources, video_source_events, video_converter_accounts, and
-- the 'video_conversion' site setting.
--
-- FIRST: switch the site back to device conversion and stop the VM worker.
-- Videos the converter already made stay: they are ordinary videos owned by
-- their members (a half-made one is cleaned up by video-housekeeping after
-- 48 h). Jobs still queued or converting are LOST — the NOTICE counts them.
-- The audit trail (video_source_events) goes with the queue: this rollback
-- is for the staging rollout; export it first if it must be kept.
-- The R2 lifecycle rule removes their uploaded originals within 2 days.
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
  IF to_regclass('public.video_sources') IS NULL THEN
    RAISE EXCEPTION 'VID-CONV-RB-PRE-001: video_sources does not exist — 20261012_0002 is not applied, nothing to roll back';
  END IF;
  -- Never overwrite a LATER migration's version of the two replaced functions (review #416 finding 9).
  IF position('public.video_day_count(_uid)' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_begin_upload(text,text,bigint,numeric,boolean,uuid,jsonb)'::regprocedure)) = 0
     OR position('public.video_converter_acting(_video_id)' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_mark_uploaded(uuid,integer,text,bigint,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'VID-CONV-RB-PRE-002: video_begin_upload / video_mark_uploaded are not the 20261012_0002 bodies — a later migration changed them; roll that back first';
  END IF;
  RAISE NOTICE 'VID-CONV-RB: % job(s) still queued or converting will be lost',
    (SELECT count(*) FROM public.video_sources WHERE status IN ('awaiting_upload', 'queued', 'converting'));
END
$pre$;

-- ── 1. the two replaced functions, back to their prior bodies ──────────────
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
  PERFORM pg_advisory_xact_lock(hashtextextended('video_begin_upload:' || _uid::text, 0));
  IF _purpose = 'post' THEN
    SELECT count(*) INTO _n FROM public.videos WHERE owner_id = _uid AND purpose = 'post' AND created_at > now() - interval '24 hours';
    IF _n >= 10 THEN
      RAISE EXCEPTION 'VID-LIM-003: 10 video uploads in 24 hours is the limit' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT count(*) INTO _n FROM public.videos WHERE owner_id = _uid AND purpose = _purpose AND state IN ('uploading', 'checking');
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
  IF _uid IS NULL OR NOT FOUND OR _v.owner_id <> _uid THEN
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
  -- The switch that let the upload start must still be on (an Off switch stops every path).
  IF (_v.purpose = 'post' AND NOT public.feature_allowed('video_posts', _uid))
     OR (_v.purpose = 'ad' AND NOT public.feature_allowed('video_ads', _uid)) THEN
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

-- ── 2. what 0002 created ────────────────────────────────────────────────────
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'video-source-housekeeping';

DROP FUNCTION public.video_source_begin(text, bigint, uuid);
DROP FUNCTION public.video_source_uploaded(uuid, text);
DROP FUNCTION public.video_source_cancel(uuid);
DROP FUNCTION public.video_source_claim();
DROP FUNCTION public.video_source_heartbeat(uuid, uuid);
DROP FUNCTION public.video_converter_begin_version(uuid, uuid, text, bigint, numeric, boolean, jsonb);
DROP FUNCTION public.video_converter_version(uuid, integer, uuid);
DROP FUNCTION public.video_source_fail(uuid, uuid, text, text);
DROP FUNCTION public.video_source_reason_text(text);
DROP FUNCTION public.video_source_done(uuid, uuid);
DROP FUNCTION public.video_source_housekeeping(integer);
DROP FUNCTION public.video_converter_health();
DROP FUNCTION public.video_source_expire(uuid, uuid, integer, uuid);
DROP FUNCTION public.video_source_drop_video(uuid);
DROP FUNCTION public.video_source_held(uuid, uuid);
DROP FUNCTION public.video_source_log(uuid, uuid, text, text);
DROP FUNCTION public.video_converter_acting(uuid);
DROP FUNCTION public.video_open_count(uuid, text);
DROP FUNCTION public.video_day_count(uuid);
DROP FUNCTION public.video_owner_may(uuid, text);
DROP FUNCTION public.video_is_converter();

DROP TABLE public.video_sources;
DROP TABLE public.video_source_events;
DROP TABLE public.video_converter_accounts;
DROP FUNCTION public.tg_video_sources_touch();
DROP FUNCTION public.tg_video_source_events_append_only();
-- Converter-made videos stay (ordinary member videos); only the marker goes.
ALTER TABLE public.videos DROP COLUMN converted_from;

DELETE FROM public.site_settings WHERE key = 'video_conversion';

DO $post$
BEGIN
  IF to_regclass('public.video_sources') IS NOT NULL OR to_regclass('public.video_source_events') IS NOT NULL
     OR to_regclass('public.video_converter_accounts') IS NOT NULL
     OR to_regprocedure('public.video_converter_acting(uuid)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.videos'::regclass AND attname = 'converted_from' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'VID-CONV-RB-POST-001: a 0002 object is still there';
  END IF;
  IF position('video_day_count' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_begin_upload(text,text,bigint,numeric,boolean,uuid,jsonb)'::regprocedure)) > 0
     OR position('VID-LIM-003: 10 video uploads in 24 hours is the limit' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_begin_upload(text,text,bigint,numeric,boolean,uuid,jsonb)'::regprocedure)) = 0
     OR position('video_converter_acting' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_mark_uploaded(uuid,integer,text,bigint,text)'::regprocedure)) > 0
     OR position('F-D1-4' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_mark_uploaded(uuid,integer,text,bigint,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'VID-CONV-RB-POST-002: video_begin_upload / video_mark_uploaded are not back to their prior bodies';
  END IF;
  IF has_function_privilege('anon', 'public.video_begin_upload(text,text,bigint,numeric,boolean,uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.video_mark_uploaded(uuid,integer,text,bigint,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VID-CONV-RB-POST-003: the restored functions'' grants changed';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'video-source-housekeeping') <> 0 THEN
    RAISE EXCEPTION 'VID-CONV-RB-POST-004: the source housekeeping job is still scheduled';
  END IF;
  RAISE NOTICE 'VID-CONV-RB: 20261012_0002 rolled back — device conversion only, prior function bodies restored';
END
$post$;

COMMIT;
