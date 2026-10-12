-- ROLLBACK for 20261012_0001_vid1_no_duration_cap.sql
-- Restores the 20261005_0005 body (post 180 s / ad 300 s) and the 300 s table
-- check. Rows already longer than 300 s are left as they are: the check is
-- re-added NOT VALID (it binds new rows; existing long videos stay readable).
-- Revert the client's limits (shared/rules.ts VIDEO_LIMITS) first.
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

DO $pre$
BEGIN
  IF position('_max_s    constant numeric := 86400;' IN coalesce((SELECT prosrc FROM pg_proc
       WHERE oid = to_regprocedure('public.video_validate_version(text,text,bigint,numeric,boolean,jsonb)')), '')) = 0 THEN
    RAISE EXCEPTION 'VID-NOCAP-RB-001: video_validate_version() is not the 20261012_0001 body — read it before rolling back';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.video_validate_version(_purpose text, _manifest_sha256 text, _total_bytes bigint,
                                              _declared_duration_s numeric, _has_audio boolean, _rendition_bytes jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $fn$
DECLARE
  _key      text;
  _sum      bigint := 0;
  _ceiling  constant jsonb := '{"240p": 61440, "480p": 163840, "720p": 358400, "audio": 16384}';
  _max_s    numeric := CASE _purpose WHEN 'post' THEN 180 WHEN 'ad' THEN 300 END;
BEGIN
  IF _max_s IS NULL THEN
    RAISE EXCEPTION 'VID-UP-002: purpose must be post or ad' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _declared_duration_s IS NULL OR _declared_duration_s <= 0 OR _declared_duration_s > _max_s THEN
    RAISE EXCEPTION 'VID-LIM-001: a % video is at most % s (declared %)', _purpose, _max_s, _declared_duration_s USING ERRCODE = 'check_violation';
  END IF;
  IF _total_bytes IS NULL OR _total_bytes < 1 OR _total_bytes > 524288000 THEN
    RAISE EXCEPTION 'VID-LIM-002: a video is at most 500 MB (declared % bytes)', _total_bytes USING ERRCODE = 'check_violation';
  END IF;
  IF _manifest_sha256 IS NULL OR _manifest_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'VID-UP-005: manifest_sha256 must be 64 lowercase hex' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _rendition_bytes IS NULL OR jsonb_typeof(_rendition_bytes) <> 'object' OR NOT (_rendition_bytes ? '240p') THEN
    RAISE EXCEPTION 'VID-UP-006: rendition_bytes must be an object with at least 240p' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _has_audio IS NULL OR _has_audio IS DISTINCT FROM (_rendition_bytes ? 'audio') THEN
    RAISE EXCEPTION 'VID-UP-006: an audio rendition is present exactly when has_audio is true' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR _key IN SELECT jsonb_object_keys(_rendition_bytes) LOOP
    IF _key NOT IN ('240p', '480p', '720p', 'audio', 'other') OR jsonb_typeof(_rendition_bytes->_key) <> 'number'
       OR (_rendition_bytes->>_key)::numeric < 1 OR (_rendition_bytes->>_key)::numeric <> trunc((_rendition_bytes->>_key)::numeric) THEN
      RAISE EXCEPTION 'VID-UP-006: rendition_bytes key % is not allowed or not a positive whole number', _key USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF _key = 'other' AND (_rendition_bytes->>_key)::bigint > 2097152 THEN
      RAISE EXCEPTION 'VID-LIM-005: poster + playlists are at most 2 MB' USING ERRCODE = 'check_violation';
    END IF;
    IF _key <> 'other' AND (_rendition_bytes->>_key)::numeric / _declared_duration_s > (_ceiling->>_key)::numeric THEN
      RAISE EXCEPTION 'VID-LIM-006: % is % bytes/s, above its ceiling of %', _key,
        round((_rendition_bytes->>_key)::numeric / _declared_duration_s), _ceiling->>_key USING ERRCODE = 'check_violation';
    END IF;
    _sum := _sum + (_rendition_bytes->>_key)::bigint;
  END LOOP;
  IF _sum <> _total_bytes THEN
    RAISE EXCEPTION 'VID-UP-006: rendition_bytes add up to %, not total_bytes %', _sum, _total_bytes USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN ARRAY(SELECT k FROM jsonb_object_keys(_rendition_bytes) k WHERE k <> 'other' ORDER BY k);
END;
$fn$;

ALTER TABLE public.video_versions DROP CONSTRAINT video_versions_declared_duration_s_check;
ALTER TABLE public.video_versions ADD CONSTRAINT video_versions_declared_duration_s_check
  CHECK (declared_duration_s > 0 AND declared_duration_s <= 300) NOT VALID;

DO $post$
BEGIN
  IF position('WHEN ''post'' THEN 180 WHEN ''ad'' THEN 300' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_validate_version(text,text,bigint,numeric,boolean,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'VID-NOCAP-RB-002: rollback did not restore the 0005 body';
  END IF;
  RAISE NOTICE 'VID-NOCAP-0001 ROLLBACK: 180 s / 300 s caps restored (table check NOT VALID for existing rows)';
END
$post$;
COMMIT;
