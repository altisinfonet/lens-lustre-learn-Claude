-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261104_0110 notification centre N2. READ ONLY, ROLLBACK.
-- PASS = every object 0110 creates is present with the intended shape and
-- privileges, every group switch is OFF, the decision answers, and emit
-- writes nothing while OFF. Before the apply it FAILS at the first missing
-- object (expected). Prints counts and names only — no row data.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE
  r record; n int; d jsonb; e uuid;
  nil constant uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.notification_types') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: public.notification_types missing (0110 not applied)';
  END IF;
  IF to_regclass('public.notification_quiet_hours') IS NULL OR to_regclass('public.notification_centre_log') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: notification_quiet_hours or notification_centre_log missing';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosecdef
        AND proconfig = ARRAY['search_path=""']
        AND proname IN ('notification_centre_live', 'notification_centre_decide',
                        'notification_centre_emit', 'notification_centre_replay')) <> 4 THEN
    RAISE EXCEPTION 'PROBE FAIL: the four centre functions are not all present as SECURITY DEFINER, search_path=""';
  END IF;
  -- server-only: no anon/authenticated access to any of it
  IF has_table_privilege('anon', 'public.notification_types', 'SELECT')
     OR has_table_privilege('authenticated', 'public.notification_types', 'SELECT')
     OR has_table_privilege('authenticated', 'public.notification_centre_log', 'SELECT')
     OR has_table_privilege('authenticated', 'public.notification_quiet_hours', 'SELECT')
     OR has_function_privilege('anon', 'public.notification_centre_emit(text, uuid, uuid, uuid, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.notification_centre_emit(text, uuid, uuid, uuid, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.notification_centre_decide(text, uuid, uuid, uuid, timestamptz, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.notification_centre_replay(timestamptz, timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.notification_centre_live(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL: anon/authenticated can reach a centre table or function';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_types'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_centre_log'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notification_quiet_hours'::regclass) THEN
    RAISE EXCEPTION 'PROBE FAIL: RLS is not on for a centre table';
  END IF;

  -- every switch OFF
  SELECT count(*) INTO n FROM public.site_settings s
   WHERE s.key LIKE 'notif\_centre\_%' AND (s.value = to_jsonb('live'::text) OR jsonb_typeof(s.value) = 'object');
  IF n <> 0 THEN
    RAISE EXCEPTION 'PROBE FAIL: % notif_centre_* switch(es) are on (live or a members list) — N2 ships with every group OFF', n;
  END IF;
  -- every "always on" type names no settings column (the CHECK, re-read)
  IF EXISTS (SELECT 1 FROM public.notification_types WHERE NOT member_can_disable
               AND (pref_in_app IS NOT NULL OR pref_push IS NOT NULL OR pref_email IS NOT NULL)) THEN
    RAISE EXCEPTION 'PROBE FAIL: an always-on type names a settings column';
  END IF;

  -- the registry is seeded, and every preference column it names exists
  SELECT count(*) INTO n FROM public.notification_types;
  IF n < 40 THEN RAISE EXCEPTION 'PROBE FAIL: registry holds % types (seed missing)', n; END IF;
  FOR r IN SELECT nt.type, c.col FROM public.notification_types nt,
             LATERAL unnest(ARRAY[nt.pref_in_app, nt.pref_push, nt.pref_email]) AS c(col)
            WHERE c.col IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM information_schema.columns ic
                               WHERE ic.table_schema = 'public' AND ic.table_name = 'notification_preferences'
                                 AND ic.column_name = c.col)
  LOOP
    RAISE EXCEPTION 'PROBE FAIL: type % names preference column % which does not exist on this lane', r.type, r.col;
  END LOOP;

  -- the decision answers (nil ids; reads only)
  d := public.notification_centre_decide('post_reaction', nil, nil, nil);
  IF d ->> 'send' IS NULL THEN RAISE EXCEPTION 'PROBE FAIL: decide returned %', d; END IF;
  IF (public.notification_centre_decide('post_reaction', nil, nil, nil) -> 'reasons') ? 'self' IS NOT TRUE THEN
    RAISE EXCEPTION 'PROBE FAIL: decide does not skip a member''s own action';
  END IF;
  IF (public.notification_centre_decide('no_such_type_x', nil, '11111111-1111-1111-1111-111111111111', nil) -> 'reasons') ? 'type_unregistered' IS NOT TRUE THEN
    RAISE EXCEPTION 'PROBE FAIL: decide does not refuse an unregistered type';
  END IF;

  -- emit is inert while OFF (this transaction is READ ONLY: any write would raise)
  e := public.notification_centre_emit('post_reaction', nil, '11111111-1111-1111-1111-111111111111', nil, 'probe', 'probe');
  IF e IS NOT NULL THEN RAISE EXCEPTION 'PROBE FAIL: emit returned an id while every switch is off'; END IF;

  SELECT count(*) INTO n FROM public.notification_centre_log;
  RAISE NOTICE 'NC0110 PASS (lane %): registry=% types, groups=%, centre_log rows=% (expected 0 while OFF)',
    current_setting('p32.lane'), (SELECT count(*) FROM public.notification_types),
    (SELECT string_agg(DISTINCT group_key, ',') FROM public.notification_types), n;
END
$p$;

ROLLBACK;
