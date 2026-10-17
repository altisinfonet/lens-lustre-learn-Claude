-- ═══════════════════════════════════════════════════════════════════════════
-- VID-4 · 20261005_0006 — copyright music check (R-102): built complete, OFF.
-- D1, T1. Lanes: staging and production. Needs 20261005_0004 + 20261005_0005.
-- Plan: docs/evidence/d2/phase5/VID-1/DECISION.md §6, §7 (signed, #376) as
-- amended by the Owner's R-102 / R-103: the check sits behind the
-- copyright_music_check switch (Off / Selected members / All members, VID-7),
-- which supersedes DECISION §8's "never for the music check".
-- ═══════════════════════════════════════════════════════════════════════════
--
-- THE MODE IS FIXED WHEN THE UPLOAD COMPLETES (video_mark_uploaded):
--   copyright_music_check OFF for the owner ─▶ a 'not_required' check carrying
--     the audio hash (R-102 "store the audio hash anyway") ─▶ ready in the same
--     transaction. No provider call, any audio publishes.
--     (with audio and no hash handed in → a pending 'off' check: the worker
--      hashes the served audio bytes and records 'not_required' — no provider.)
--   copyright_music_check ON for the owner ─▶ a pending 'on' check; the
--     music-check worker decides: clean / clean_no_audio / clean_library ─▶
--     ready · match ─▶ music_blocked (nothing published) · error ─▶ stays
--     'checking', retried 1 m → 2 m → 5 m → 15 m → 30 m, then every 30 min,
--     for ever. An 'on' check can NEVER be closed as 'not_required'
--     (VID-MC-002), and the 0005 gate re-checks every ready move, so a video of
--     a checked member is never published unchecked — the key missing, the API
--     down, the worker absent: it waits in 'checking'.
--   The switch cannot be turned on while the key is missing (VID-7 FEATURE-003).
--
-- WHO CALLS WHAT:
--   video_mark_uploaded(video, version[, audio_sha256])  authenticated (owner) —
--     from D2's /api/video/complete, after its R2 checks (DECISION §3.4).
--   video_new_version(...)                                authenticated (owner) —
--     the remedies of the blocked screen: mute / library track / trim (§7.2).
--   music_library_add / music_library_set_active          authenticated (admin) — audited (§7.3).
--   music_check_due / music_check_record_result /
--   music_check_overdue / music_library_set_fingerprints  service_role only —
--     the music-check worker (Edge Function). The WORKER ITSELF, its wake and its
--     sweep job ship with the vendor adapter (vendor not chosen, DECISION §7.1);
--     until then the queue is served by nobody: Off publishes, On waits.
--
-- OBJECTS (reservation): table music_library_audit; functions
-- music_check_retry_after, video_mark_uploaded, video_new_version,
-- music_check_due, music_check_record_result, music_check_overdue,
-- music_library_add, music_library_set_active, music_library_set_fingerprints,
-- tg_music_library_audit_append_only.
-- NOT RE-RUNNABLE: PRE-002 refuses once video_mark_uploaded exists.
-- ROLLBACK: supabase/rollback/20261005_0006_vid4_music_check_ROLLBACK.sql
-- PROBE:    supabase/migrations/PROBE_vid4_music_check.sql
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

DO $preconditions$
BEGIN
  -- PRE-001 · what this file builds on.
  IF to_regprocedure('public.feature_allowed(text,uuid)') IS NULL OR to_regprocedure('public.music_check_key_configured()') IS NULL THEN
    RAISE EXCEPTION 'VID4-0006-PRE-001: the feature switches (20261005_0004) are missing' USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regprocedure('public.video_validate_version(text,text,bigint,numeric,boolean,jsonb)') IS NULL OR to_regclass('public.video_music_checks') IS NULL THEN
    RAISE EXCEPTION 'VID4-0006-PRE-001: the videos unit (20261005_0005) is missing' USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · not applied yet.
  IF to_regprocedure('public.video_mark_uploaded(uuid,integer,text)') IS NOT NULL
     OR to_regprocedure('public.music_check_record_result(uuid,text,text,numeric,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'VID4-0006-PRE-002: 20261005_0006 is already applied' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. the library's audit trail (kept by the rollback: it is a record) ──────
CREATE TABLE IF NOT EXISTS public.music_library_audit (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  actor     uuid,
  track_id  uuid NOT NULL,
  action    text NOT NULL CHECK (action IN ('add', 'activate', 'deactivate', 'fingerprints')),
  note      text
);
ALTER TABLE public.music_library_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.music_library_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.music_library_audit_id_seq FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.tg_music_library_audit_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $fn$
BEGIN
  RAISE EXCEPTION 'music_library_audit is append-only (% refused)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$fn$;
CREATE TRIGGER tg_music_library_audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public.music_library_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_music_library_audit_append_only();

-- ── 2. retry schedule (DECISION §6.2 step 5) ────────────────────────────────
CREATE FUNCTION public.music_check_retry_after(_errors integer)
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $fn$
  SELECT CASE WHEN _errors <= 1 THEN interval '1 minute' WHEN _errors = 2 THEN interval '2 minutes'
              WHEN _errors = 3 THEN interval '5 minutes' WHEN _errors = 4 THEN interval '15 minutes'
              ELSE interval '30 minutes' END;
$fn$;

-- ── 3. upload complete → checking → (Off) ready / (On) the queue ────────────
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

-- ── 4. the worker's result (service role only) ──────────────────────────────
CREATE FUNCTION public.music_check_record_result(_check_id uuid, _verdict text, _audio_sha256 text,
                                                 _measured_audio_s numeric, _matches jsonb, _provider text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _c       record;
  _v       record;
  _ver     record;
  _latest  uuid;
  _attempt integer;
  _errors  integer;
  _next    timestamptz;
  _new     uuid;
  _bad     bigint;
BEGIN
  SELECT * INTO _c FROM public.video_music_checks WHERE id = _check_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VID-MC-001: no such check' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT id, owner_id, state, current_version INTO _v FROM public.videos WHERE id = _c.video_id FOR UPDATE;
  SELECT id INTO _latest FROM public.video_music_checks WHERE video_id = _c.video_id AND version_no = _c.version_no
   ORDER BY attempt DESC LIMIT 1;
  IF _v.state <> 'checking' OR _c.version_no <> _v.current_version OR _latest <> _check_id OR _c.verdict NOT IN ('pending', 'error') THEN
    RAISE EXCEPTION 'VID-MC-001: check % is stale (video is %, v%; latest check %)', _check_id, _v.state, _v.current_version, _latest
      USING ERRCODE = 'check_violation';
  END IF;
  -- The mode fixed at upload decides what may close the check.
  IF (_c.mode_at_check = 'off' AND _verdict NOT IN ('not_required', 'error'))
     OR (_c.mode_at_check IS DISTINCT FROM 'off' AND _verdict NOT IN ('clean', 'clean_no_audio', 'clean_library', 'match', 'error')) THEN
    RAISE EXCEPTION 'VID-MC-002: a % check cannot be closed as %', coalesce(_c.mode_at_check, 'on'), _verdict USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO _ver FROM public.video_versions WHERE video_id = _c.video_id AND version_no = _c.version_no;
  IF _verdict <> 'error' THEN
    IF _ver.has_audio AND (_audio_sha256 IS NULL OR _audio_sha256 !~ '^[0-9a-f]{64}$') THEN
      RAISE EXCEPTION 'VID-MC-003: a version with audio needs the hash of the checked audio bytes' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF NOT _ver.has_audio AND _audio_sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'VID-MC-003: a version without audio has no audio hash' USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;
  IF _verdict IN ('match', 'clean_library')
     AND (_matches IS NULL OR jsonb_typeof(_matches) <> 'array' OR jsonb_array_length(_matches) = 0) THEN
    RAISE EXCEPTION 'VID-MC-004: a % verdict lists its matches', _verdict USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _verdict = 'clean_library' THEN
    -- Every match must be a fingerprint of an ACTIVE library track (§7.3); anything else is a match.
    SELECT count(*) INTO _bad FROM jsonb_array_elements(_matches) m
     WHERE NOT EXISTS (SELECT 1 FROM public.music_library_tracks t
                        WHERE t.active AND (m->>'fingerprint_id') = ANY (t.provider_fingerprint_ids));
    IF _bad > 0 THEN
      RAISE EXCEPTION 'VID-MC-005: % match(es) are not active library tracks — the verdict is match, not clean_library', _bad
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT max(attempt) + 1, count(*) FILTER (WHERE verdict = 'error') + CASE WHEN _verdict = 'error' THEN 1 ELSE 0 END
    INTO _attempt, _errors
    FROM public.video_music_checks WHERE video_id = _c.video_id AND version_no = _c.version_no;
  IF _verdict = 'error' THEN
    _next := now() + public.music_check_retry_after(_errors);
  END IF;
  -- The measured facts of the version: written once, by the worker's own reading.
  IF _verdict <> 'error' THEN
    UPDATE public.video_versions
       SET audio_sha256 = coalesce(audio_sha256, _audio_sha256),
           measured_audio_s = coalesce(measured_audio_s, _measured_audio_s)
     WHERE video_id = _c.video_id AND version_no = _c.version_no
       AND (audio_sha256 IS NULL OR measured_audio_s IS NULL);
  END IF;
  INSERT INTO public.video_music_checks (video_id, version_no, provider, attempt, verdict, audio_sha256, matches,
                                         measured_audio_s, mode_at_check, next_retry_at)
  VALUES (_c.video_id, _c.version_no, coalesce(nullif(btrim(_provider), ''), 'unknown'), _attempt, _verdict,
          CASE WHEN _verdict = 'error' THEN NULL ELSE _audio_sha256 END, _matches, _measured_audio_s, _c.mode_at_check, _next)
  RETURNING id INTO _new;
  IF _verdict IN ('clean', 'clean_no_audio', 'clean_library', 'not_required') THEN
    UPDATE public.videos SET state = 'ready', music_check_id = _new WHERE id = _c.video_id;      -- the 0005 gate validates
  ELSIF _verdict = 'match' THEN
    UPDATE public.videos SET state = 'music_blocked' WHERE id = _c.video_id;                     -- nothing is published
  END IF;
  RETURN jsonb_build_object('check_id', _new, 'video_id', _c.video_id, 'attempt', _attempt, 'verdict', _verdict,
                            'state', (SELECT state FROM public.videos WHERE id = _c.video_id), 'next_retry_at', _next);
END;
$fn$;

-- What the worker should do now: pending checks, and errors whose retry time has come.
CREATE FUNCTION public.music_check_due(_limit integer DEFAULT 50)
RETURNS TABLE (check_id uuid, video_id uuid, version_no integer, owner_id uuid, attempt integer, mode_at_check text,
               has_audio boolean, r2_prefix text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT c.id, v.id, v.current_version, v.owner_id, c.attempt, c.mode_at_check, ver.has_audio,
         'video/' || v.owner_id || '/' || v.id || '/v' || v.current_version || '/'
    FROM public.videos v
    JOIN public.video_versions ver ON ver.video_id = v.id AND ver.version_no = v.current_version
    CROSS JOIN LATERAL (SELECT * FROM public.video_music_checks mc
                         WHERE mc.video_id = v.id AND mc.version_no = v.current_version
                         ORDER BY mc.attempt DESC LIMIT 1) c
   WHERE v.state = 'checking'
     AND (c.verdict = 'pending' OR (c.verdict = 'error' AND c.next_retry_at <= now()))
   ORDER BY c.checked_at
   LIMIT greatest(least(coalesce(_limit, 50), 500), 1);
$fn$;

-- Checking for longer than _after (6 h): the admin alert (VID-6 channel) and the
-- member's "Still checking — this is on our side".
CREATE FUNCTION public.music_check_overdue(_after interval DEFAULT interval '6 hours')
RETURNS TABLE (video_id uuid, owner_id uuid, version_no integer, since timestamptz, errors bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT v.id, v.owner_id, v.current_version, min(c.checked_at), count(*) FILTER (WHERE c.verdict = 'error')
    FROM public.videos v
    JOIN public.video_music_checks c ON c.video_id = v.id AND c.version_no = v.current_version
   WHERE v.state = 'checking'
   GROUP BY v.id, v.owner_id, v.current_version
  HAVING min(c.checked_at) < now() - _after
   ORDER BY min(c.checked_at);
$fn$;

-- ── 5. the blocked screen's remedies: a NEW version (§7.2) ───────────────────
CREATE FUNCTION public.video_new_version(_video_id uuid, _remedy text, _manifest_sha256 text, _total_bytes bigint,
                                         _declared_duration_s numeric, _has_audio boolean, _rendition_bytes jsonb,
                                         _library_track_id uuid DEFAULT NULL, _trims jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _uid   uuid := (SELECT auth.uid());
  _v     record;
  _rends text[];
  _n     integer;
BEGIN
  SELECT id, owner_id, purpose, state, current_version INTO _v FROM public.videos WHERE id = _video_id FOR UPDATE;
  IF _uid IS NULL OR NOT FOUND OR _v.owner_id <> _uid THEN
    RAISE EXCEPTION 'VID-NV-001: no such video of yours' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _v.state <> 'music_blocked' THEN
    RAISE EXCEPTION 'VID-NV-001: a remedy version is made only for a video blocked for music (video is %)', _v.state
      USING ERRCODE = 'check_violation';
  END IF;
  IF (_v.purpose = 'post' AND NOT public.feature_allowed('video_posts', _uid))
     OR (_v.purpose = 'ad' AND NOT public.feature_allowed('video_ads', _uid)) THEN
    RAISE EXCEPTION 'VID-UP-003: video % is switched off for this member', _v.purpose USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _remedy IS NULL OR _remedy NOT IN ('mute', 'library_track', 'trim') THEN
    RAISE EXCEPTION 'VID-NV-002: the remedy is mute, library_track or trim' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _remedy = 'mute' AND _has_audio IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'VID-NV-002: a muted version has no audio rendition' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _remedy = 'library_track' THEN
    IF _has_audio IS DISTINCT FROM true OR NOT EXISTS (SELECT 1 FROM public.music_library_tracks WHERE id = _library_track_id AND active) THEN
      RAISE EXCEPTION 'VID-NV-003: a library-track version needs audio and an active library track' USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSIF _library_track_id IS NOT NULL THEN
    RAISE EXCEPTION 'VID-NV-003: a library track goes only with the library_track remedy' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _remedy = 'trim' THEN
    IF _trims IS NULL OR jsonb_typeof(_trims) <> 'array' OR jsonb_array_length(_trims) NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'VID-NV-004: trims is a list of 1–20 cut ranges' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    SELECT count(*) INTO _n FROM jsonb_array_elements(_trims) t
     WHERE jsonb_typeof(t) <> 'object' OR jsonb_typeof(t->'start_ms') <> 'number' OR jsonb_typeof(t->'end_ms') <> 'number'
        OR (t->>'start_ms')::numeric < 0 OR (t->>'end_ms')::numeric <= (t->>'start_ms')::numeric;
    IF _n > 0 THEN
      RAISE EXCEPTION 'VID-NV-004: each cut range is {start_ms, end_ms} with 0 ≤ start < end' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF _declared_duration_s < 3 THEN
      RAISE EXCEPTION 'VID-NV-004: trimming is offered only when at least 3 s remain' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF _trims IS NOT NULL THEN
    RAISE EXCEPTION 'VID-NV-004: cut ranges go only with the trim remedy' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  _rends := public.video_validate_version(_v.purpose, _manifest_sha256, _total_bytes, _declared_duration_s, _has_audio, _rendition_bytes);
  -- A remedy is a new version of the same video, not a new upload (no daily count).
  UPDATE public.videos SET state = 'uploading', current_version = _v.current_version + 1, music_check_id = NULL WHERE id = _video_id;
  INSERT INTO public.video_versions (video_id, version_no, manifest_sha256, total_bytes, declared_duration_s, has_audio,
                                     rendition_bytes, renditions, remedy, library_track_id, trims)
  VALUES (_video_id, _v.current_version + 1, _manifest_sha256, _total_bytes, _declared_duration_s, _has_audio,
          _rendition_bytes, _rends, _remedy, _library_track_id, _trims);
  RETURN jsonb_build_object('video_id', _video_id, 'version_no', _v.current_version + 1, 'state', 'uploading');
END;
$fn$;

-- ── 6. the free in-app library (§7.3): admins add, audited ───────────────────
CREATE FUNCTION public.music_library_add(_title text, _artist text, _duration_s numeric, _r2_key text, _license text,
                                         _license_url text, _attribution text, _source text, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _id  uuid;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'VID-LIB-001: only an admin adds library tracks' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF nullif(btrim(_title), '') IS NULL OR nullif(btrim(_license), '') IS NULL OR nullif(btrim(_source), '') IS NULL
     OR _license_url IS NULL OR _license_url !~ '^https://[^\s/]+\.[^\s]+$' OR _duration_s IS NULL OR _duration_s <= 0 THEN
    RAISE EXCEPTION 'VID-LIB-002: a track needs a title, a positive length, a licence, an https licence URL and a source'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Added INACTIVE: it becomes pickable only after the worker has fingerprinted it
  -- (music_library_set_fingerprints) and an admin activates it (SEC N4).
  INSERT INTO public.music_library_tracks (title, artist, duration_s, r2_key, license, license_url, attribution, source, active, added_by)
  VALUES (btrim(_title), _artist, _duration_s, _r2_key, btrim(_license), _license_url, _attribution, btrim(_source), false, _uid)
  RETURNING id INTO _id;
  INSERT INTO public.music_library_audit (actor, track_id, action, note) VALUES (_uid, _id, 'add', _note);
  RETURN _id;
END;
$fn$;

CREATE FUNCTION public.music_library_set_active(_track_id uuid, _active boolean, _note text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _t   record;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'VID-LIB-001: only an admin changes library tracks' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT id, active, provider_fingerprint_ids INTO _t FROM public.music_library_tracks WHERE id = _track_id FOR UPDATE;
  IF NOT FOUND OR _active IS NULL THEN
    RAISE EXCEPTION 'VID-LIB-002: no such track' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _active AND cardinality(_t.provider_fingerprint_ids) = 0 THEN
    RAISE EXCEPTION 'VID-LIB-003: a track is activated only after it has been fingerprinted' USING ERRCODE = 'check_violation';
  END IF;
  IF _t.active = _active THEN
    RETURN _active;
  END IF;
  UPDATE public.music_library_tracks SET active = _active WHERE id = _track_id;
  INSERT INTO public.music_library_audit (actor, track_id, action, note)
  VALUES (_uid, _track_id, CASE WHEN _active THEN 'activate' ELSE 'deactivate' END, _note);
  RETURN _active;
END;
$fn$;

CREATE FUNCTION public.music_library_set_fingerprints(_track_id uuid, _fingerprint_ids text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF _fingerprint_ids IS NULL OR cardinality(_fingerprint_ids) = 0 OR array_position(_fingerprint_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'VID-LIB-002: fingerprint ids are required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.music_library_tracks SET provider_fingerprint_ids = _fingerprint_ids WHERE id = _track_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VID-LIB-002: no such track' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO public.music_library_audit (actor, track_id, action, note)
  VALUES (NULL, _track_id, 'fingerprints', array_to_string(_fingerprint_ids, ','));
  RETURN cardinality(_fingerprint_ids);
END;
$fn$;

-- ── 7. who may call what ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.video_mark_uploaded(uuid, integer, text), public.video_new_version(uuid, text, text, bigint, numeric, boolean, jsonb, uuid, jsonb),
  public.music_library_add(text, text, numeric, text, text, text, text, text, text), public.music_library_set_active(uuid, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_mark_uploaded(uuid, integer, text), public.video_new_version(uuid, text, text, bigint, numeric, boolean, jsonb, uuid, jsonb),
  public.music_library_add(text, text, numeric, text, text, text, text, text, text), public.music_library_set_active(uuid, boolean, text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.music_check_record_result(uuid, text, text, numeric, jsonb, text), public.music_check_due(integer),
  public.music_check_overdue(interval), public.music_library_set_fingerprints(uuid, text[]), public.music_check_retry_after(integer),
  public.tg_music_library_audit_append_only()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.music_check_record_result(uuid, text, text, numeric, jsonb, text), public.music_check_due(integer),
  public.music_check_overdue(interval), public.music_library_set_fingerprints(uuid, text[])
  TO service_role;

DO $postconditions$
BEGIN
  IF has_function_privilege('authenticated', 'public.music_check_record_result(uuid,text,text,numeric,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.music_check_record_result(uuid,text,text,numeric,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.music_library_set_fingerprints(uuid,text[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.music_check_due(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.video_mark_uploaded(uuid,integer,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.music_check_record_result(uuid,text,text,numeric,jsonb,text)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.music_library_audit', 'SELECT') THEN
    RAISE EXCEPTION 'VID4-0006-POST-001: a worker function is reachable by an API role, or the worker cannot reach it'
      USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'VID4-0006: copyright music check in place — %; music-API key configured: %',
    (SELECT 'copyright_music_check=' || mode FROM public.feature_access WHERE feature = 'copyright_music_check'),
    public.music_check_key_configured();
END
$postconditions$;

COMMIT;
