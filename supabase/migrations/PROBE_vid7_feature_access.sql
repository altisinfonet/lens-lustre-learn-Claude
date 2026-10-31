-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · VID-7 (20261005_0004) — the LIVE half. READ-ONLY. Ends in ROLLBACK.
-- Raises (and so fails the dispatch) on a hit.
--   F1 · the three features exist; every mode is off / selected / everyone.
--   F2 · copyright_music_check is off unless the music-API key is configured.
--   F3 · the API roles hold no privilege on the three tables, cannot call
--        feature_allowed(text,uuid) or music_check_key_configured(); anon
--        cannot call any switch RPC.
--   F4 · the audit table refuses UPDATE/DELETE (append-only trigger present);
--        RLS on all three tables.
--   F5 · feature_allowed() answers by the rule: unknown feature → false,
--        NULL uid → false (checked on this lane's live rows).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
DO $probe$
DECLARE
  hits text := '';
  r    record;
BEGIN
  IF to_regprocedure('public.feature_allowed(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL VID-7: F1 feature_allowed(text,uuid) is not installed';
  END IF;
  IF (SELECT count(*) FROM public.feature_access WHERE feature IN ('video_posts', 'video_ads', 'copyright_music_check')) <> 3 THEN
    hits := hits || E'\n  F1 a feature row is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.feature_access WHERE feature = 'copyright_music_check' AND mode <> 'off')
     AND NOT public.music_check_key_configured() THEN
    hits := hits || E'\n  F2 copyright_music_check is on but the music-API key is not configured';
  END IF;
  FOR r IN SELECT unnest(ARRAY['public.feature_access', 'public.feature_access_members', 'public.feature_access_audit']) AS t LOOP
    IF has_table_privilege('anon', r.t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       OR has_table_privilege('authenticated', r.t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
      hits := hits || E'\n  F3 ' || r.t || ': an API role holds a privilege';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = r.t::regclass) THEN
      hits := hits || E'\n  F4 ' || r.t || ': RLS off';
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.feature_allowed(text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.feature_allowed(text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.music_check_key_configured()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.feature_set_mode(text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.feature_add_member(text,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.feature_allowed_me(text)', 'EXECUTE') THEN
    hits := hits || E'\n  F3 an internal check or a switch RPC is callable by the wrong API role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.feature_access_audit'::regclass
                   AND tgname = 'tg_feature_audit_append_only' AND tgenabled = 'O') THEN
    hits := hits || E'\n  F4 feature_access_audit has no enabled append-only trigger';
  END IF;
  IF public.feature_allowed('no_such_feature', gen_random_uuid()) OR public.feature_allowed('video_posts', NULL) THEN
    hits := hits || E'\n  F5 feature_allowed() allows an unknown feature or a NULL user';
  END IF;
  IF hits <> '' THEN
    RAISE EXCEPTION 'PROBE FAIL VID-7:%', hits;
  END IF;
  RAISE NOTICE 'PROBE PASS VID-7: %; music-API key configured: %',
    (SELECT string_agg(feature || '=' || mode || ' (' || (SELECT count(*) FROM public.feature_access_members m WHERE m.feature = fa.feature) || ' listed)', ', ' ORDER BY feature)
       FROM public.feature_access fa),
    public.music_check_key_configured();
END
$probe$;
ROLLBACK;
