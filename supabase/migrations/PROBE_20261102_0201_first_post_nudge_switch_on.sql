-- PROBE · 20261102_0201 · READ ONLY. PASS = first_post_nudge reads "on" on this
-- lane; FAIL = off (expected before the switch-on, and after the switch-off).
BEGIN READ ONLY;
DO $p$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.site_settings') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.site_settings WHERE key = 'first_post_nudge' AND value = to_jsonb('on'::text)) THEN
    RAISE EXCEPTION 'PROBE FAIL: first_post_nudge is OFF on lane %', current_setting('p32.lane');
  END IF;
  RAISE NOTICE 'PROBE PASS: first_post_nudge is ON on lane %', current_setting('p32.lane');
END
$p$;
ROLLBACK;
