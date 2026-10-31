-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261031_0626 · S10 P26 audit scope + "store the change".
-- READ ONLY, ROLLBACK. FAIL before the apply, PASS after:
--   G1  public.p26_jsonb_change(jsonb, jsonb) exists; anon / authenticated
--       cannot execute it
--   G2  audit_<table> on certificates, competition_entries, competition_votes,
--       judge_comments, judge_decisions, judge_scores, judge_tag_assignments:
--       AFTER DELETE only, enabled; on admin_vote_adjustments, site_settings,
--       user_roles, wallet_transactions, withdrawal_requests: INSERT, UPDATE
--       and DELETE, enabled
--   G3  both audit trigger functions call p26_jsonb_change, keep SECURITY
--       DEFINER and search_path=public
--   G4  p26_jsonb_change gives the exact expected parts on fixed inputs:
--       nothing changed → NULL; a scalar; one of three pages edited (by id);
--       order only; an object one level down; a removed key
-- Prints names and PASS/FAIL only.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $probe$
DECLARE
  n int; chg record; pages_old jsonb; pages_new jsonb;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not staging or production';
  END IF;

  IF to_regprocedure('public.p26_jsonb_change(jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL 0626 G1: public.p26_jsonb_change(jsonb, jsonb) missing';
  END IF;
  IF has_function_privilege('anon', 'public.p26_jsonb_change(jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.p26_jsonb_change(jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL 0626 G1: an API role can execute p26_jsonb_change';
  END IF;

  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND t.tgname = 'audit_' || c.relname AND NOT t.tgisinternal AND t.tgenabled = 'O'
     AND c.relname IN ('certificates', 'competition_entries', 'competition_votes', 'judge_comments', 'judge_decisions', 'judge_scores', 'judge_tag_assignments')
     AND (t.tgtype & 28) = 8 AND (t.tgtype & 2) = 0 AND (t.tgtype & 1) = 1;   -- DELETE only, AFTER, FOR EACH ROW
  IF n <> 7 THEN RAISE EXCEPTION 'PROBE FAIL 0626 G2: % of 7 audit triggers are AFTER DELETE only', n; END IF;
  SELECT count(*) INTO n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND t.tgname = 'audit_' || c.relname AND NOT t.tgisinternal AND t.tgenabled = 'O'
     AND c.relname IN ('admin_vote_adjustments', 'site_settings', 'user_roles', 'wallet_transactions', 'withdrawal_requests')
     AND (t.tgtype & 28) = 28;
  IF n <> 5 THEN RAISE EXCEPTION 'PROBE FAIL 0626 G2: % of 5 money/permission audit triggers are INSERT OR UPDATE OR DELETE', n; END IF;

  SELECT count(*) INTO n FROM pg_proc
   WHERE oid IN ('public.audit_sensitive_table()'::regprocedure, 'public.audit_site_settings_table()'::regprocedure)
     AND prosrc ~ 'p26_jsonb_change' AND prosecdef AND proconfig = ARRAY['search_path=public'];
  IF n <> 2 THEN RAISE EXCEPTION 'PROBE FAIL 0626 G3: % of 2 audit functions store the change with their attributes', n; END IF;

  -- G4 fixed cases
  SELECT * INTO chg FROM public.p26_jsonb_change('{"a":1,"b":"x"}', '{"a":1,"b":"x"}');
  IF chg.old_part IS NOT NULL OR chg.new_part IS NOT NULL THEN RAISE EXCEPTION 'PROBE FAIL 0626 G4: unchanged row is not NULL'; END IF;

  SELECT * INTO chg FROM public.p26_jsonb_change('{"key":"video_conversion","value":"device","updated_at":"t1"}',
                                               '{"key":"video_conversion","value":"server","updated_at":"t2"}');
  IF chg.old_part <> '{"value":"device","updated_at":"t1","_p26":"change"}'::jsonb
     OR chg.new_part <> '{"value":"server","updated_at":"t2","_p26":"change"}'::jsonb THEN
    RAISE EXCEPTION 'PROBE FAIL 0626 G4: scalar case';
  END IF;

  pages_old := '[{"id":"p1","title":"A","content":"long A"},{"id":"p2","title":"B","content":"long B"},{"id":"p3","title":"C","content":"long C"}]';
  pages_new := '[{"id":"p1","title":"A","content":"long A"},{"id":"p2","title":"B2","content":"long B"},{"id":"p3","title":"C","content":"long C"}]';
  SELECT * INTO chg FROM public.p26_jsonb_change(jsonb_build_object('key', 'managed_pages', 'value', pages_old),
                                               jsonb_build_object('key', 'managed_pages', 'value', pages_new));
  IF chg.old_part <> '{"value":{"_by_id":{"p2":{"id":"p2","title":"B","content":"long B"}}},"_p26":"change"}'::jsonb
     OR chg.new_part <> '{"value":{"_by_id":{"p2":{"id":"p2","title":"B2","content":"long B"}}},"_p26":"change"}'::jsonb THEN
    RAISE EXCEPTION 'PROBE FAIL 0626 G4: page-by-id case';
  END IF;

  SELECT * INTO chg FROM public.p26_jsonb_change(jsonb_build_object('value', pages_old),
                                               jsonb_build_object('value', jsonb_build_array(pages_old -> 2, pages_old -> 0, pages_old -> 1)));
  IF chg.old_part <> '{"value":{"_by_id":{}},"_p26":"change"}'::jsonb
     OR chg.new_part <> '{"value":{"_by_id":{},"_order":["p3","p1","p2"]},"_p26":"change"}'::jsonb THEN
    RAISE EXCEPTION 'PROBE FAIL 0626 G4: order-only case';
  END IF;

  SELECT * INTO chg FROM public.p26_jsonb_change('{"value":{"zones":[1,2],"on":true,"big":"x"},"gone":1}',
                                               '{"value":{"zones":[1,2],"on":false,"big":"x"}}');
  IF chg.old_part <> '{"value":{"on":true},"gone":1,"_p26":"change"}'::jsonb
     OR chg.new_part <> '{"value":{"on":false},"_p26":"change"}'::jsonb THEN
    RAISE EXCEPTION 'PROBE FAIL 0626 G4: object / removed-key case';
  END IF;

  RAISE NOTICE 'PROBE PASS 0626 — 7 tables delete-only, 5 money/permission tables full; UPDATE rows store the change (5 fixed cases exact)';
END
$probe$;

ROLLBACK;
