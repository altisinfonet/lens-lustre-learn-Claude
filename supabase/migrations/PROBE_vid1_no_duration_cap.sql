-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · VID-1 no time limit (20261012_0001). READ-ONLY. Ends in ROLLBACK.
--   N1 · video_validate_version() has no 180/300 s cap; its guard is 86400 s;
--        500 MB (VID-LIM-002), poster+playlists 2 MB (VID-LIM-005) and the
--        bytes-per-second ceilings (VID-LIM-006) are still there.
--   N2 · video_versions_declared_duration_s_check is > 0 AND <= 86400.
--   N3 · video_validate_version() is still internal: no EXECUTE for anon or
--        authenticated; IMMUTABLE; search_path ''.
--   N4 · behaviour, read-only: a 7:28 (448 s) post and a 2 h ad pass the
--        rules; 0 s and 24 h + 1 s are refused; 500 MB + 1 byte is refused.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  hits text := '';
  _fn regprocedure := to_regprocedure('public.video_validate_version(text,text,bigint,numeric,boolean,jsonb)');
  _p record;
  _ok boolean;
  _sha constant text := repeat('a', 64);
BEGIN
  IF _fn IS NULL THEN RAISE EXCEPTION 'PROBE FAIL VID-NOCAP: video_validate_version is missing'; END IF;
  SELECT prosrc, provolatile, proconfig INTO _p FROM pg_proc WHERE oid = _fn;
  IF position('THEN 180' IN _p.prosrc) > 0 OR position('_max_s    constant numeric := 86400;' IN _p.prosrc) = 0 THEN
    hits := hits || E'\n  N1 the duration cap is still there, or the 24 h guard is missing';
  END IF;
  IF position('VID-LIM-002' IN _p.prosrc) = 0 OR position('VID-LIM-005' IN _p.prosrc) = 0 OR position('VID-LIM-006' IN _p.prosrc) = 0 THEN
    hits := hits || E'\n  N1 a size rule (500 MB / 2 MB / bytes per second) is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.video_versions'::regclass
                   AND conname = 'video_versions_declared_duration_s_check'
                   AND pg_get_constraintdef(oid) ILIKE '%declared_duration_s <= (86400)%') THEN
    hits := hits || E'\n  N2 the table check is not the 86400 s guard';
  END IF;
  IF has_function_privilege('anon', _fn, 'EXECUTE') OR has_function_privilege('authenticated', _fn, 'EXECUTE')
     OR _p.provolatile <> 'i' OR _p.proconfig IS NULL OR NOT ('search_path=""' = ANY (_p.proconfig)) THEN
    hits := hits || E'\n  N3 not internal / IMMUTABLE / search_path ''''';
  END IF;

  -- N4: the function is IMMUTABLE and writes nothing; calling it is read-only.
  BEGIN PERFORM public.video_validate_version('post', _sha, 86000000, 448, true, '{"240p": 20000000, "480p": 60000000, "audio": 5000000, "other": 1000000}'::jsonb); _ok := true;
  EXCEPTION WHEN OTHERS THEN _ok := false; hits := hits || E'\n  N4 a 448 s post was refused: ' || SQLERRM; END;
  BEGIN PERFORM public.video_validate_version('ad', _sha, 86000000, 7200, true, '{"240p": 80000000, "audio": 5000000, "other": 1000000}'::jsonb);
  EXCEPTION WHEN OTHERS THEN hits := hits || E'\n  N4 a 2 h ad was refused: ' || SQLERRM; END;
  BEGIN PERFORM public.video_validate_version('post', _sha, 1000, 86401, false, '{"240p": 1000}'::jsonb); hits := hits || E'\n  N4 24 h + 1 s was accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'VID-LIM-001%' THEN hits := hits || E'\n  N4 24 h + 1 s refused for the wrong reason: ' || SQLERRM; END IF; END;
  BEGIN PERFORM public.video_validate_version('post', _sha, 1000, 0, false, '{"240p": 1000}'::jsonb); hits := hits || E'\n  N4 0 s was accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'VID-LIM-001%' THEN hits := hits || E'\n  N4 0 s refused for the wrong reason: ' || SQLERRM; END IF; END;
  -- 86400 s keeps 524288001 bytes under the 240p bytes/s ceiling (6068 B/s), so only the 500 MB rule can refuse it.
  BEGIN PERFORM public.video_validate_version('post', _sha, 524288001, 86400, false, '{"240p": 524288001}'::jsonb); hits := hits || E'\n  N4 500 MB + 1 byte was accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'VID-LIM-002%' THEN hits := hits || E'\n  N4 500 MB + 1 refused for the wrong reason: ' || SQLERRM; END IF; END;

  IF hits <> '' THEN RAISE EXCEPTION 'PROBE FAIL VID-NOCAP:%', hits; END IF;
  RAISE NOTICE 'PROBE PASS VID-NOCAP: no time limit (24 h technical guard); 500 MB, 2 MB, bytes/s ceilings intact; internal only; 448 s post + 2 h ad pass';
END
$probe$;
ROLLBACK;
