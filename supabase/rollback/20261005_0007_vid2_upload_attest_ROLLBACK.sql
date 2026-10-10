-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261005_0007 (F-D1-4 attest + SEC-VID-4 ad_videos split).
-- D1, T1. ⚠ THIS REOPENS F-D1-4: after it, a member can again complete an
-- upload without `complete` (a made-up audio hash publishes). Run it only to
-- undo a broken 0007, then re-apply a fixed 0007 before any switch is on.
-- Restores, verbatim: 0006's video_mark_uploaded(uuid,integer,text) and its
-- grants, and 0005's ad_videos_admin_write (FOR ALL). Vault secrets untouched.
-- Order: roll back 0007 BEFORE 0006 (0006's rollback looks for the 3-arg form).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
BEGIN
  IF to_regprocedure('public.video_mark_uploaded(uuid,integer,text,bigint,text)') IS NULL
     OR to_regprocedure('public.video_attest_verify(uuid,integer,text,bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'VID2-0007-RB-001: 20261005_0007 is not applied' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

DROP POLICY ad_videos_admin_insert ON public.ad_videos;
DROP POLICY ad_videos_admin_update ON public.ad_videos;
DROP POLICY ad_videos_admin_delete ON public.ad_videos;

CREATE POLICY ad_videos_admin_write ON public.ad_videos FOR ALL TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
              AND (SELECT public.feature_allowed_me('video_ads')));

DROP FUNCTION public.video_mark_uploaded(uuid, integer, text, bigint, text);
DROP FUNCTION public.video_attest_verify(uuid, integer, text, bigint, text);
DROP FUNCTION public.video_attest_lane();

-- 0006 §3, verbatim:
CREATE FUNCTION public.video_mark_uploaded(_video_id uuid, _version_no integer, _audio_sha256 text DEFAULT NULL)
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

REVOKE ALL ON FUNCTION public.video_mark_uploaded(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_mark_uploaded(uuid, integer, text) TO authenticated;

DO $postconditions$
BEGIN
  IF to_regprocedure('public.video_mark_uploaded(uuid,integer,text)') IS NULL
     OR to_regprocedure('public.video_mark_uploaded(uuid,integer,text,bigint,text)') IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.ad_videos'::regclass AND polname = 'ad_videos_admin_write' AND polcmd = '*')
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.ad_videos'::regclass AND polname LIKE 'ad_videos_admin_%' AND polname <> 'ad_videos_admin_write') THEN
    RAISE EXCEPTION 'VID2-0007-RB-POST-001: the 0006 / 0005 state was not restored' USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'VID2-0007 rolled back: F-D1-4 is OPEN again (unattested video_mark_uploaded restored)';
END
$postconditions$;

COMMIT;
