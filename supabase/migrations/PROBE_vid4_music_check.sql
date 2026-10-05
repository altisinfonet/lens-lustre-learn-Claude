-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · VID-4 (20261005_0006) — the LIVE half. READ-ONLY. Ends in ROLLBACK.
-- Raises (and so fails the dispatch) on a hit.
--   M1 · the music-check functions are installed.
--   M2 · the worker functions are service-role only; the member RPCs are not
--        callable by anon; the library audit is unreadable by the API roles and
--        append-only.
--   M3 · no check of a CHECKED member was ever closed as not_required, and no
--        check of an unchecked one carries a provider verdict.
--   M4 · every error row carries its next retry time (nothing stalls silently).
--   M5 · every active library track is fingerprinted.
-- Reported, not failed: videos checking, due now, overdue past 6 h (the VID-6
-- alert), and the copyright_music_check mode + key.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  hits text := '';
  _n   bigint;
BEGIN
  IF to_regprocedure('public.video_mark_uploaded(uuid,integer,text)') IS NULL
     OR to_regprocedure('public.music_check_record_result(uuid,text,text,numeric,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL VID-4: M1 the music check is not installed';
  END IF;
  IF to_regprocedure('public.video_new_version(uuid,text,text,bigint,numeric,boolean,jsonb,uuid,jsonb)') IS NULL
     OR to_regprocedure('public.music_check_due(integer)') IS NULL OR to_regprocedure('public.music_library_add(text,text,numeric,text,text,text,text,text,text)') IS NULL THEN
    hits := hits || E'\n  M1 a music-check function is missing';
  END IF;
  IF has_function_privilege('authenticated', 'public.music_check_record_result(uuid,text,text,numeric,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.music_check_record_result(uuid,text,text,numeric,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.music_check_due(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.music_library_set_fingerprints(uuid,text[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.video_mark_uploaded(uuid,integer,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.video_new_version(uuid,text,text,bigint,numeric,boolean,jsonb,uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.music_library_add(text,text,numeric,text,text,text,text,text,text)', 'EXECUTE') THEN
    hits := hits || E'\n  M2 a worker function is callable by an API role (or a member RPC by anon)';
  END IF;
  IF has_table_privilege('anon', 'public.music_library_audit', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR has_table_privilege('authenticated', 'public.music_library_audit', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.music_library_audit'::regclass
                      AND tgname = 'tg_music_library_audit_append_only' AND tgenabled = 'O') THEN
    hits := hits || E'\n  M2 music_library_audit is reachable by an API role or not append-only';
  END IF;
  SELECT count(*) INTO _n FROM public.video_music_checks
   WHERE (mode_at_check IS DISTINCT FROM 'off' AND verdict = 'not_required')
      OR (mode_at_check = 'off' AND verdict IN ('clean', 'clean_no_audio', 'clean_library', 'match'));
  IF _n > 0 THEN hits := hits || E'\n  M3 ' || _n || ' check(s) closed against their mode (a checked video skipped, or an unchecked one judged)'; END IF;
  SELECT count(*) INTO _n FROM public.video_music_checks WHERE verdict = 'error' AND next_retry_at IS NULL;
  IF _n > 0 THEN hits := hits || E'\n  M4 ' || _n || ' error row(s) without a retry time'; END IF;
  SELECT count(*) INTO _n FROM public.music_library_tracks WHERE active AND cardinality(provider_fingerprint_ids) = 0;
  IF _n > 0 THEN hits := hits || E'\n  M5 ' || _n || ' active library track(s) never fingerprinted'; END IF;
  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL VID-4:%', hits;
  END IF;
  RAISE NOTICE 'PROBE PASS VID-4: copyright_music_check=% (key configured: %); checking %, due now %, overdue > 6 h %; library active %',
    (SELECT mode FROM public.feature_access WHERE feature = 'copyright_music_check'), public.music_check_key_configured(),
    (SELECT count(*) FROM public.videos WHERE state = 'checking'), (SELECT count(*) FROM public.music_check_due(500)),
    (SELECT count(*) FROM public.music_check_overdue()), (SELECT count(*) FROM public.music_library_tracks WHERE active);
END
$probe$;
ROLLBACK;
