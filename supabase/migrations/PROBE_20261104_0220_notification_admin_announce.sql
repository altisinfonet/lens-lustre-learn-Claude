-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261104_0220 admin announcements. READ ONLY, ROLLBACK.
-- PASS = the admin_announcement type is registered (announcements group, bell
-- + push, push_announcements), the function exists (SECURITY DEFINER,
-- search_path=""), anon cannot call it, and a non-admin caller is refused.
-- FAILS before apply. Prints counts only.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE refused boolean := false;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_types WHERE type = 'admin_announcement' AND group_key = 'announcements'
                  AND audience = 'member' AND channels = ARRAY['in_app', 'push'] AND pref_push = 'push_announcements') THEN
    RAISE EXCEPTION 'PROBE FAIL: admin_announcement is not registered as expected (0220 not applied)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.admin_notif_announce(text, text, text, uuid[])')
                  AND prosecdef AND proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'PROBE FAIL: admin_notif_announce missing or not SECURITY DEFINER / search_path=""';
  END IF;
  IF has_function_privilege('anon', 'public.admin_notif_announce(text, text, text, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL: anon can call admin_notif_announce';
  END IF;
  BEGIN
    PERFORM public.admin_notif_announce('t', 'm', 'me', NULL);   -- no signed-in admin here
  EXCEPTION WHEN insufficient_privilege THEN refused := true;
  END;
  IF NOT refused THEN
    RAISE EXCEPTION 'PROBE FAIL: admin_notif_announce ran for a non-admin caller';
  END IF;
  RAISE NOTICE 'NC0220 PASS (lane %): announcements in place; % announcement(s) sent so far',
    current_setting('p32.lane'),
    (SELECT count(*) FROM public.notification_centre_changes WHERE subject = 'admin_announcement' AND field = 'sent');
END
$p$;

ROLLBACK;
