-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261104_0150 notification capture (N1). The function bodies
-- were never changed (the apply proved it), so there is nothing to restore
-- in them; this removes the capture tag from each comment, leaving any
-- earlier comment text exactly as it was. Refuses when no tag is present.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED — p32.lane is not asserted';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $rb$
DECLARE r record; n int := 0; c text; kept text;
BEGIN
  FOR r IN SELECT to_regprocedure(v.sig) AS oid FROM (VALUES
    ('public.emit_birthday_notifications()', 'e461c2744c0a6fd0ddd9d1fc6d9c7cc1'),
    ('public.emit_notification(text, uuid, integer, uuid, text, text, text, uuid, text, jsonb, text)', '560500fe41927f2270f19dcafafa2c75'),
    ('public.get_my_notifications_grouped(integer, timestamp with time zone)', '17e4a1a0f4424c69a3bfb3795b10e54f'),
    ('public.notify_entry_status_change()', '65021751cdfee21aa4edcf3fce670c5c'),
    ('public.notify_post_comment()', '26c9714d41a7027000364adffde5056e'),
    ('public.notify_post_reaction()', '4b865596e3973a814d0195fb7df2bc6b'),
    ('public.notify_post_tag()', '98231c0af09df073da2f245624226d22'),
    ('public.pj_handle_tag_notification(jsonb)', 'f9f9869c7690b79d414003d6d2d2658d'),
    ('public.prune_old_notifications(integer, integer)', '345ac2e51915b7bd6aeeaa55dee986a6'),
    ('public.send_notification_email()', '2e40fd53c30694881937bd0eb0e4e2fa')) AS v(sig, md5) LOOP
    CONTINUE WHEN r.oid IS NULL;
    c := obj_description(r.oid, 'pg_proc');
    CONTINUE WHEN c IS NULL OR c NOT LIKE '%captured in git by 20261104_0150%';
    kept := regexp_replace(c, E'\\n?Notification function captured in git by 20261104_0150 \\(N1\\): source = live, md5 [0-9a-f]{32}$', '');
    EXECUTE format('COMMENT ON FUNCTION %s IS %L', r.oid::regprocedure, nullif(kept, ''));
    n := n + 1;
  END LOOP;
  IF n = 0 THEN
    RAISE EXCEPTION 'NC-0150-RB-PRE-001: no capture tag found — 20261104_0150 is not applied on this lane';
  END IF;
END
$rb$;

COMMIT;
