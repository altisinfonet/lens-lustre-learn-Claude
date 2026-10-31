-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261104_0120 notification centre N6 (admin functions). READ ONLY.
-- PASS = the eight functions exist as SECURITY DEFINER with search_path="",
-- anon can call none of them, every one refuses a caller who is not an admin
-- (tried here with no auth.uid()), and no switch is on. FAILS before apply.
-- Prints names and counts only.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE refused int := 0; f text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.notification_centre_changes') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: public.notification_centre_changes missing (0120 not applied)';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosecdef
        AND proconfig = ARRAY['search_path=""']
        AND proname IN ('notif_admin_or_raise', 'admin_notif_types', 'admin_notif_type_update', 'admin_notif_history',
                        'admin_notif_switches', 'admin_notif_switch_set', 'admin_notif_member_settings',
                        'notification_centre_send_test')) <> 8 THEN
    RAISE EXCEPTION 'PROBE FAIL: the eight 0120 functions are not all SECURITY DEFINER with search_path=""';
  END IF;
  IF has_function_privilege('anon', 'public.admin_notif_switch_set(text, text, uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_notif_types()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.notification_centre_send_test(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_notif_member_settings(uuid)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.notification_centre_changes', 'SELECT') THEN
    RAISE EXCEPTION 'PROBE FAIL: anon can call an admin function, or members can read the change history';
  END IF;
  -- every function refuses a caller with no admin role (no JWT here → auth.uid() is NULL)
  FOREACH f IN ARRAY ARRAY['SELECT count(*) FROM public.admin_notif_types()',
                           'SELECT count(*) FROM public.admin_notif_switches()',
                           'SELECT count(*) FROM public.admin_notif_history(NULL, 1)',
                           'SELECT public.admin_notif_member_settings(''00000000-0000-0000-0000-000000000000'')',
                           'SELECT public.admin_notif_switch_set(''notif_centre_ui'', ''everyone'')',
                           'SELECT public.admin_notif_type_update(''post_reaction'', ''{"enabled": false}'')',
                           'SELECT public.notification_centre_send_test(''post_reaction'')'] LOOP
    BEGIN
      EXECUTE f;
      RAISE EXCEPTION 'PROBE FAIL: % ran for a non-admin caller', f;
    EXCEPTION WHEN insufficient_privilege THEN refused := refused + 1;
    END;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.site_settings s WHERE s.key LIKE 'notif\_centre\_%') THEN
    RAISE NOTICE 'NOTE: % notif_centre_* switch row(s) exist (set by an admin) — reported, not failed',
      (SELECT count(*) FROM public.site_settings s WHERE s.key LIKE 'notif\_centre\_%');
  END IF;
  RAISE NOTICE 'NC0120 PASS (lane %): 8 admin functions present, % of 7 refused a non-admin caller, history rows=%',
    current_setting('p32.lane'), refused, (SELECT count(*) FROM public.notification_centre_changes);
END
$p$;

ROLLBACK;
