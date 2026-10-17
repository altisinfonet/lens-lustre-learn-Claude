-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · F-D1-4 + SEC-VID-4 (20261005_0007) — the LIVE half. READ-ONLY.
-- Ends in ROLLBACK. Raises (and so fails the dispatch) on a hit.
--   A1 · no unattested path: the 3-argument video_mark_uploaded is gone, exactly
--        one form exists, and it checks the attestation BEFORE its replay answer.
--   A2 · the check is internal: video_attest_verify / video_attest_lane are not
--        callable by anon, authenticated or service_role; verify is not
--        SECURITY DEFINER; the lane fixed into the function is this dispatch's lane.
--   A3 · if any video switch is not Off, the lane's attest key exists (≥ 32).
--   A4 · the attest key is not the value of any other vault secret (SEC: it
--        must differ from MEDIA_TOKEN_KEY and every other key).
--   A5 · ad_videos: exactly one permissive SELECT path for authenticated, and
--        the admin INSERT / UPDATE / DELETE policies exist (SEC-VID-4).
-- Reported, not failed: lane, current key configured, previous key configured /
-- ignored (short or equal to current), the three switch modes.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  hits  text := '';
  _src  text;
  _n    bigint;
  _cur  text;
  _prev text;
BEGIN
  IF to_regprocedure('public.video_mark_uploaded(uuid,integer,text,bigint,text)') IS NULL
     OR to_regprocedure('public.video_attest_verify(uuid,integer,text,bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL VID-2A: A1 the upload attestation (20261005_0007) is not installed';
  END IF;
  -- A1
  SELECT count(*) INTO _n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'video_mark_uploaded';
  IF to_regprocedure('public.video_mark_uploaded(uuid,integer,text)') IS NOT NULL OR _n <> 1 THEN
    hits := hits || E'\n  A1 an unattested video_mark_uploaded form exists (' || _n || ' forms)';
  END IF;
  SELECT prosrc INTO _src FROM pg_proc WHERE oid = 'public.video_mark_uploaded(uuid,integer,text,bigint,text)'::regprocedure;
  IF strpos(_src, 'PERFORM public.video_attest_verify(_video_id, _version_no, _audio_sha256, _issued_at, _attest)') = 0
     OR strpos(_src, 'PERFORM public.video_attest_verify(') > strpos(_src, 'IF _v.state <> ''uploading'' THEN')
     OR strpos(_src, 'PERFORM public.video_attest_verify(') > strpos(_src, 'UPDATE public.') THEN
    hits := hits || E'\n  A1 video_mark_uploaded does not check the attestation before the replay answer and every write';
  END IF;
  -- A2
  IF has_function_privilege('anon', 'public.video_attest_verify(uuid,integer,text,bigint,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.video_attest_verify(uuid,integer,text,bigint,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.video_attest_verify(uuid,integer,text,bigint,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.video_attest_lane()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.video_attest_lane()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.video_attest_lane()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.video_mark_uploaded(uuid,integer,text,bigint,text)', 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public.video_attest_verify(uuid,integer,text,bigint,text)'::regprocedure) THEN
    hits := hits || E'\n  A2 the attestation check is reachable by an API role (or mark_uploaded by anon, or verify is DEFINER)';
  END IF;
  IF coalesce(current_setting('p32.lane', true), '') IN ('staging', 'production')
     AND public.video_attest_lane() IS DISTINCT FROM current_setting('p32.lane', true) THEN
    hits := hits || E'\n  A2 the lane fixed into the attestation (' || public.video_attest_lane()
                 || ') is not this lane (' || current_setting('p32.lane', true) || ')';
  END IF;
  -- A3
  SELECT decrypted_secret INTO _cur FROM vault.decrypted_secrets WHERE name = 'video_complete_attest_key';
  SELECT decrypted_secret INTO _prev FROM vault.decrypted_secrets WHERE name = 'video_complete_attest_key_previous';
  IF EXISTS (SELECT 1 FROM public.feature_access WHERE mode <> 'off')
     AND (_cur IS NULL OR char_length(_cur) < 32) THEN
    hits := hits || E'\n  A3 a video switch is not Off but this lane has no attest key (≥ 32 chars): '
                 || (SELECT string_agg(feature || '=' || mode, ', ' ORDER BY feature) FROM public.feature_access WHERE mode <> 'off');
  END IF;
  -- A4
  IF _cur IS NOT NULL THEN
    SELECT count(*) INTO _n FROM vault.decrypted_secrets
     WHERE name IS DISTINCT FROM 'video_complete_attest_key' AND name IS DISTINCT FROM 'video_complete_attest_key_previous'
       AND decrypted_secret = _cur;
    IF _n > 0 THEN
      hits := hits || E'\n  A4 the attest key has the same value as ' || _n || ' other vault secret(s)';
    END IF;
  END IF;
  -- A5
  SELECT count(*) INTO _n FROM pg_policy p
   WHERE p.polrelid = 'public.ad_videos'::regclass AND p.polpermissive AND p.polcmd IN ('r', '*')
     AND (p.polroles @> ARRAY['authenticated'::regrole::oid] OR p.polroles = '{0}');
  IF _n <> 1 THEN
    hits := hits || E'\n  A5 ad_videos has ' || _n || ' permissive SELECT paths for authenticated (want 1)';
  END IF;
  SELECT count(*) INTO _n FROM pg_policy WHERE polrelid = 'public.ad_videos'::regclass AND polpermissive
     AND ((polname = 'ad_videos_admin_insert' AND polcmd = 'a') OR (polname = 'ad_videos_admin_update' AND polcmd = 'w')
          OR (polname = 'ad_videos_admin_delete' AND polcmd = 'd'));
  IF _n <> 3 THEN
    hits := hits || E'\n  A5 the admin INSERT / UPDATE / DELETE policies on ad_videos are not all present';
  END IF;
  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL VID-2A:%', hits;
  END IF;
  RAISE NOTICE 'PROBE PASS VID-2A: lane %; attest key configured %; previous key %; switches %',
    public.video_attest_lane(), (_cur IS NOT NULL AND char_length(_cur) >= 32),
    CASE WHEN _prev IS NULL THEN 'none' WHEN char_length(_prev) < 32 OR _prev = _cur THEN 'IGNORED (short or equal to current)' ELSE 'accepted' END,
    (SELECT string_agg(feature || '=' || mode, ', ' ORDER BY feature) FROM public.feature_access);
END
$probe$;
ROLLBACK;
