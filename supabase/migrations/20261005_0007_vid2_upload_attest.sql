-- ═══════════════════════════════════════════════════════════════════════════
-- F-D1-4 + SEC-VID-4 · 20261005_0007 — an upload completes only with the
-- server's attestation; ad_videos gets one permissive policy per action.
-- D1, T1. Lanes: staging and production. Needs 20261005_0004 + 0005 + 0006.
-- Ruling: SEC handoff 2026-10-05 15:19 UTC, "F-D1-4 ruling: CONFIRMED +
-- TIGHTENED" (claude/handoff/SEC.md). This file implements that ruling as
-- written; where it had to choose an encoding, the choice is stated below.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- F-D1-4 (MEDIUM, SEC reproduced it): video_mark_uploaded(video, version,
-- audio_sha256) is callable by the member directly. A member could skip the
-- `complete` endpoint, hand in a made-up audio hash, and reach `ready` with no
-- files in R2 — and, with the copyright check On, skip the only step that
-- proves the renditions carry no `soun` track (F-D3-17). So the database must
-- refuse any completion that `complete` did not sign.
--
-- THE ATTESTATION (the contract D2's `complete` signs — README-vid2-attest.md):
--   attest = lowercase hex( HMAC-SHA256( key, message ) )
--   message = 'v1|<lane>|<video_id>|<version_no>|<manifest_sha256>|<has_audio>|<audio_sha256>|<issued_at>'
--     lane            'staging' or 'production' — fixed into this database at
--                     apply time from p32.lane, which apply-migration.yml has
--                     already proved against the credential's project ref
--     video_id        the uuid, lowercase, hyphenated (uuid::text)
--     version_no      decimal integer, no padding
--     manifest_sha256 64 lowercase hex — taken FROM THE STORED ROW, never the caller
--     has_audio       'true' / 'false' — taken FROM THE STORED ROW
--     audio_sha256    64 lowercase hex, or the word 'none' when no hash is passed
--     issued_at       Unix seconds (integer) when `complete` signed
--   key = vault secret 'video_complete_attest_key' (current), and
--         'video_complete_attest_key_previous' (accepted too, for rotation).
--         Per lane; ≥ 32 characters; must differ from MEDIA_TOKEN_KEY (the
--         PROBE reports a key that equals any other vault secret).
--
-- WHEN IT IS CHECKED: in video_mark_uploaded, after "is this your video, is this
-- the current version" and BEFORE anything else — before the replay answer and
-- before any state change. Remedy versions (video_new_version → uploading →
-- here) pass the same gate: there is no other way out of 'uploading'.
-- REFUSALS: no key on this lane → VID-MU-004 (fails closed — nothing completes);
-- a missing / malformed / wrong signature (other key, lane, video, version,
-- manifest, audio flag or audio hash) → VID-MU-005; issued_at older than
-- 15 min or more than 60 s ahead → VID-MU-006. Another member replaying a
-- valid attestation → VID-MU-001 (not their video).
-- The 3-argument form is DROPPED: no unattested path remains (PROBE A1).
--
-- SEC-VID-4 (LOW, standing rule 3): ad_videos had two permissive SELECT paths
-- for authenticated (ad_videos_read + the admin FOR ALL). The admin policy is
-- split into INSERT / UPDATE / DELETE with the same predicates. Admin reads are
-- unchanged: ad_videos_read lets a row through when its ad_creatives row is
-- visible, and admins see every ad_creatives row (ad_creatives_admin_all, read
-- on staging 2026-10-10 02:5x UTC). The harness proves an admin still reads
-- the video of an INACTIVE creative.
--
-- DEPLOY ORDER: D2's `complete` must send the 5-argument call before this file
-- runs on a lane where uploads are live. On staging today every switch is Off,
-- there are 0 videos, and the upload endpoints answer 503 until
-- VIDEO_DELIVERY_PRIVATE=1, so applying first breaks nothing.
--
-- OBJECTS (reservation): public.video_mark_uploaded (3-arg dropped, 5-arg new),
-- new public.video_attest_verify(uuid,integer,text,bigint,text),
-- new public.video_attest_lane(); policies on public.ad_videos.
-- Vault secrets READ, never written: video_complete_attest_key[_previous]
-- (the Owner sets them; no value is in any file).
-- ROLLBACK: supabase/rollback/20261005_0007_vid2_upload_attest_ROLLBACK.sql
--           (restores 0006's function verbatim — and so REOPENS F-D1-4).
-- PROBE:    supabase/migrations/PROBE_vid2_upload_attest.sql
-- PROOF:    docs/evidence/d1/VID/vid2-attest-run-tests.sh → vid2-attest-transcript.txt
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
  IF to_regprocedure('public.video_mark_uploaded(uuid,integer,text)') IS NULL
     OR to_regprocedure('public.feature_allowed_me(text)') IS NULL
     OR to_regclass('public.ad_videos') IS NULL THEN
    RAISE EXCEPTION 'VID2-0007-PRE-001: 20261005_0004 / 0005 / 0006 are not all applied' USING ERRCODE = 'raise_exception';
  END IF;
  IF to_regprocedure('extensions.hmac(text,text,text)') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'VID2-0007-PRE-001: pgcrypto (schema extensions) or vault is missing' USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-002 · not applied yet.
  IF to_regprocedure('public.video_attest_verify(uuid,integer,text,bigint,text)') IS NOT NULL
     OR to_regprocedure('public.video_mark_uploaded(uuid,integer,text,bigint,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'VID2-0007-PRE-002: 20261005_0007 is already applied' USING ERRCODE = 'raise_exception';
  END IF;
  -- PRE-003 · the policy being split is the one 0005 wrote.
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.ad_videos'::regclass
                   AND polname = 'ad_videos_admin_write' AND polcmd = '*') THEN
    RAISE EXCEPTION 'VID2-0007-PRE-003: ad_videos_admin_write (FOR ALL) is not as 0005 left it' USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── 1. this database's lane, fixed at apply time ────────────────────────────
DO $lane$
BEGIN
  EXECUTE format($f$CREATE FUNCTION public.video_attest_lane() RETURNS text LANGUAGE sql IMMUTABLE
                    SET search_path TO '' AS $b$ SELECT %L::text $b$$f$, current_setting('p32.lane'));
END
$lane$;
COMMENT ON FUNCTION public.video_attest_lane() IS
  'F-D1-4: the lane word signed into every upload attestation; written by 20261005_0007 from p32.lane at apply time.';

-- ── 2. the attestation check (internal; runs inside video_mark_uploaded) ─────
-- SECURITY INVOKER on purpose: it is only ever called from the DEFINER
-- video_mark_uploaded, so it runs as the function owner and needs no grant to
-- any API role, and adds no new DEFINER surface.
CREATE FUNCTION public.video_attest_verify(_video_id uuid, _version_no integer, _audio_sha256 text,
                                           _issued_at bigint, _attest text)
RETURNS void
LANGUAGE plpgsql
SET search_path TO ''
AS $fn$
DECLARE
  _cur  text;
  _prev text;
  _ver  record;
  _now  bigint := floor(extract(epoch FROM now()))::bigint;
  _msg  text;
BEGIN
  SELECT decrypted_secret INTO _cur FROM vault.decrypted_secrets WHERE name = 'video_complete_attest_key';
  IF _cur IS NULL OR char_length(_cur) < 32 THEN
    RAISE EXCEPTION 'VID-MU-004: uploads cannot complete on this lane: the completion key is not configured'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT decrypted_secret INTO _prev FROM vault.decrypted_secrets WHERE name = 'video_complete_attest_key_previous';
  -- A short previous key, or one equal to the current key, is never trusted (the PROBE reports it).
  IF _prev IS NOT NULL AND (char_length(_prev) < 32 OR _prev = _cur) THEN
    _prev := NULL;
  END IF;
  IF _attest IS NULL OR _attest !~ '^[0-9a-f]{64}$' OR _issued_at IS NULL THEN
    RAISE EXCEPTION 'VID-MU-005: the completion attestation is missing or malformed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _issued_at < _now - 900 OR _issued_at > _now + 60 THEN
    RAISE EXCEPTION 'VID-MU-006: the completion attestation is expired (older than 15 min) or dated ahead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- The signed facts come from the stored row, never from the caller.
  SELECT manifest_sha256, has_audio INTO _ver FROM public.video_versions WHERE video_id = _video_id AND version_no = _version_no;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'VID-MU-005: the completion attestation does not match this video' USING ERRCODE = 'insufficient_privilege';
  END IF;
  _msg := 'v1|' || public.video_attest_lane() || '|' || _video_id::text || '|' || _version_no::text || '|'
          || _ver.manifest_sha256 || '|' || CASE WHEN _ver.has_audio THEN 'true' ELSE 'false' END || '|'
          || coalesce(_audio_sha256, 'none') || '|' || _issued_at::text;
  IF _attest = encode(extensions.hmac(_msg, _cur, 'sha256'), 'hex') THEN
    RETURN;
  END IF;
  IF _prev IS NOT NULL AND _attest = encode(extensions.hmac(_msg, _prev, 'sha256'), 'hex') THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'VID-MU-005: the completion attestation does not match this video' USING ERRCODE = 'insufficient_privilege';
END;
$fn$;

-- ── 3. video_mark_uploaded: the 3-argument form goes, the attested form comes ─
-- The body below is 0006's, unchanged, except the signature and the one
-- PERFORM marked "F-D1-4".
DROP FUNCTION public.video_mark_uploaded(uuid, integer, text);

CREATE FUNCTION public.video_mark_uploaded(_video_id uuid, _version_no integer, _audio_sha256 text,
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

-- ── 4. SEC-VID-4: one permissive policy per action on ad_videos ─────────────
DROP POLICY ad_videos_admin_write ON public.ad_videos;
CREATE POLICY ad_videos_admin_insert ON public.ad_videos FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
              AND (SELECT public.feature_allowed_me('video_ads')));
CREATE POLICY ad_videos_admin_update ON public.ad_videos FOR UPDATE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)))
  WITH CHECK ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
              AND (SELECT public.feature_allowed_me('video_ads')));
CREATE POLICY ad_videos_admin_delete ON public.ad_videos FOR DELETE TO authenticated
  USING ((SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));

-- ── 5. who may call what ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.video_mark_uploaded(uuid, integer, text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_mark_uploaded(uuid, integer, text, bigint, text) TO authenticated;
REVOKE ALL ON FUNCTION public.video_attest_verify(uuid, integer, text, bigint, text), public.video_attest_lane()
  FROM PUBLIC, anon, authenticated, service_role;

DO $postconditions$
DECLARE
  _n integer;
BEGIN
  IF to_regprocedure('public.video_mark_uploaded(uuid,integer,text)') IS NOT NULL
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'video_mark_uploaded') <> 1 THEN
    RAISE EXCEPTION 'VID2-0007-POST-001: an unattested video_mark_uploaded is still callable' USING ERRCODE = 'raise_exception';
  END IF;
  IF has_function_privilege('anon', 'public.video_mark_uploaded(uuid,integer,text,bigint,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.video_mark_uploaded(uuid,integer,text,bigint,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.video_attest_verify(uuid,integer,text,bigint,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.video_attest_verify(uuid,integer,text,bigint,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.video_attest_verify(uuid,integer,text,bigint,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VID2-0007-POST-002: the grants are not as written' USING ERRCODE = 'raise_exception';
  END IF;
  SELECT count(*) INTO _n FROM pg_policy p
   WHERE p.polrelid = 'public.ad_videos'::regclass AND p.polpermissive AND p.polcmd IN ('r', '*')
     AND (p.polroles @> ARRAY['authenticated'::regrole::oid] OR p.polroles = '{0}');
  IF _n <> 1 THEN
    RAISE EXCEPTION 'VID2-0007-POST-003: ad_videos has % permissive SELECT paths for authenticated (want 1)', _n USING ERRCODE = 'raise_exception';
  END IF;
  RAISE NOTICE 'VID2-0007: uploads complete only with an attestation (lane %); attest key configured: %; ad_videos: 1 read + insert/update/delete',
    public.video_attest_lane(),
    EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'video_complete_attest_key' AND char_length(decrypted_secret) >= 32);
END
$postconditions$;

COMMIT;
