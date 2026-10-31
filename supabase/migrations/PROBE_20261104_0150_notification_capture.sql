-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261104_0150 notification capture (N1). READ ONLY, ROLLBACK.
-- The equality check: each of the 12 captured functions exists, its LIVE
-- source md5 equals the md5 of the text now in git (20261104_0150), and it
-- carries the capture tag (so before the apply this FAILS — expected — and
-- after it PASSES). Prints names and md5s only.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE r record; ok int := 0;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  FOR r IN SELECT v.sig, v.md5, to_regprocedure(v.sig) AS oid FROM (VALUES
    ('public.emit_birthday_notifications()', 'e461c2744c0a6fd0ddd9d1fc6d9c7cc1'),
    ('public.emit_notification(text, uuid, integer, uuid, text, text, text, uuid, text, jsonb, text)', '560500fe41927f2270f19dcafafa2c75'),
    ('public.get_my_notifications_grouped(integer, timestamp with time zone)', '17e4a1a0f4424c69a3bfb3795b10e54f'),
    ('public.notify_entry_status_change()', '65021751cdfee21aa4edcf3fce670c5c'),
    ('public.notify_post_comment()', '26c9714d41a7027000364adffde5056e'),
    ('public.notify_post_reaction()', '4b865596e3973a814d0195fb7df2bc6b'),
    ('public.notify_post_tag()', '98231c0af09df073da2f245624226d22'),
    ('public.notify_round_published()', 'e41ae90dde7f38ff48315a9034aaa962'),
    ('public.notify_round_published_insert()', '414dea23042b830f59c7d05c785dd369'),
    ('public.pj_handle_tag_notification(jsonb)', 'f9f9869c7690b79d414003d6d2d2658d'),
    ('public.prune_old_notifications(integer, integer)', '345ac2e51915b7bd6aeeaa55dee986a6'),
    ('public.send_notification_email()', '2e40fd53c30694881937bd0eb0e4e2fa')) AS v(sig, md5) LOOP
    IF r.oid IS NULL THEN RAISE EXCEPTION 'PROBE FAIL: % missing', r.sig; END IF;
    IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = r.oid) <> r.md5 THEN
      RAISE EXCEPTION 'PROBE FAIL: live source of % differs from the text in git (expected md5 %)', r.sig, r.md5;
    END IF;
    IF coalesce(obj_description(r.oid, 'pg_proc'), '') NOT LIKE '%captured in git by 20261104_0150%' THEN
      RAISE EXCEPTION 'PROBE FAIL: % is not tagged as captured (20261104_0150 not applied on this lane)', r.sig;
    END IF;
    RAISE NOTICE 'N1|equal|%|%', r.sig, r.md5;
    ok := ok + 1;
  END LOOP;
  RAISE NOTICE 'NC0150 PASS (lane %): % of 12 live functions equal the text in git', current_setting('p32.lane'), ok;
END
$p$;

ROLLBACK;
