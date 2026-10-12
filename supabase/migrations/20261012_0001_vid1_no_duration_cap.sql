-- ═══════════════════════════════════════════════════════════════════════════
-- VID-1 · 20261012_0001 — no time limit on videos (500 MB stays).
-- Lanes: staging and production.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner ruling 2026-10-11 (DECISION A3.2): "restrict on MB not on timing. Less
-- than 500 MB is okay but minutes will be FREE — no boundary on timing." Owner,
-- staging 2026-10-12, after a 7:28 video was refused: "why time showing as now
-- up to 500MB is limit no timing??"
--
-- The cap lives in exactly two places (read live on staging 2026-10-12):
--   • video_validate_version(): post 180 s / ad 300 s (VID-LIM-001);
--   • video_versions_declared_duration_s_check: declared_duration_s <= 300.
-- Both become a 24 h TECHNICAL guard on the declared number (the column is
-- numeric(7,2)); it is not a product limit and nothing else reads it.
-- Unchanged: 500 MB total (VID-LIM-002), the per-rendition bytes-per-second
-- ceilings (VID-LIM-006 — maximums, so longer videos pass them more easily),
-- poster + playlists <= 2 MB, 10 a day, every other check.
--
-- ROLLBACK: supabase/rollback/20261012_0001_vid1_no_duration_cap_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_vid1_no_duration_cap.sql
-- OBJECTS (reservation): public.video_validate_version(...) (body only);
--                        video_versions_declared_duration_s_check (replaced).
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
  IF position('WHEN ''post'' THEN 180 WHEN ''ad'' THEN 300' IN coalesce((SELECT prosrc FROM pg_proc
       WHERE oid = to_regprocedure('public.video_validate_version(text,text,bigint,numeric,boolean,jsonb)')), '')) = 0 THEN
    RAISE EXCEPTION 'VID-NOCAP-PRE-001: video_validate_version() is not the 20261005_0005 body — read it before replacing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_versions'::regclass
                   AND conname = 'video_versions_declared_duration_s_check'
                   AND pg_get_constraintdef(oid) ILIKE '%declared_duration_s <= (300)%') THEN
    RAISE EXCEPTION 'VID-NOCAP-PRE-002: video_versions_declared_duration_s_check is not the 300 s check — read it first';
  END IF;
END
$pre$;

-- ── 1. the version rules without a duration cap ────────────────────────────
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
  -- Owner ruling 2026-10-11 (DECISION A3.2): no time limit — 500 MB is the
  -- limit. 24 h is a technical guard on the declared number only (the column
  -- is numeric(7,2)); no product rule depends on it.
  _max_s    constant numeric := 86400;
BEGIN
  IF _purpose IS NULL OR _purpose NOT IN ('post', 'ad') THEN
    RAISE EXCEPTION 'VID-UP-002: purpose must be post or ad' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _declared_duration_s IS NULL OR _declared_duration_s <= 0 OR _declared_duration_s > _max_s THEN
    RAISE EXCEPTION 'VID-LIM-001: a video''s declared length must be more than 0 and at most % s (declared %)', _max_s, _declared_duration_s USING ERRCODE = 'check_violation';
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

-- ── 2. the table check: 24 h technical guard ───────────────────────────────
ALTER TABLE public.video_versions DROP CONSTRAINT video_versions_declared_duration_s_check;
ALTER TABLE public.video_versions ADD CONSTRAINT video_versions_declared_duration_s_check
  CHECK (declared_duration_s > 0 AND declared_duration_s <= 86400);

DO $post$
BEGIN
  IF position('THEN 180' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.video_validate_version(text,text,bigint,numeric,boolean,jsonb)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'VID-NOCAP-POST-001: the 180 s cap is still in video_validate_version()';
  END IF;
  IF has_function_privilege('authenticated', 'public.video_validate_version(text,text,bigint,numeric,boolean,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.video_validate_version(text,text,bigint,numeric,boolean,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VID-NOCAP-POST-002: video_validate_version() must stay internal (no client EXECUTE)';
  END IF;
  RAISE NOTICE 'VID-NOCAP-0001: no time limit on videos (24 h technical guard); 500 MB and every other rule unchanged';
END
$post$;

COMMIT;
