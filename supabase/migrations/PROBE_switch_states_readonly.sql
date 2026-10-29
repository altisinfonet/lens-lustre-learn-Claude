-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · feature switch states (staging and production). READ ONLY, ROLLBACK.
-- Prints, per switch in public.feature_access: its mode (off / selected /
-- everyone) and HOW MANY members are selected — never who. Plus the on/off
-- site_settings switches the client reads (photo_upload_resume, app_image_sw).
-- It changes nothing and never fails on a switch being on: switching on is the
-- Owner's call; this only reports it. FAILS only if the table is missing.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $p$
DECLARE r record; line text := '';
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF to_regclass('public.feature_access') IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: public.feature_access missing';
  END IF;
  FOR r IN
    SELECT fa.feature, fa.mode,
           (SELECT count(*) FROM public.feature_access_members m WHERE m.feature = fa.feature) AS selected
      FROM public.feature_access fa ORDER BY fa.feature
  LOOP
    line := line || format(E'\n  %-24s %-9s selected members: %s', r.feature, r.mode, r.selected);
  END LOOP;
  FOR r IN
    SELECT k, (SELECT s.value::text FROM public.site_settings s WHERE s.key = k) AS v
      FROM unnest(ARRAY['photo_upload_resume', 'app_image_sw']) k
  LOOP
    line := line || format(E'\n  site_settings %-24s %s', r.k, coalesce(r.v, '(no row = off)'));
  END LOOP;
  RAISE NOTICE 'SWITCH STATES (lane %):%', current_setting('p32.lane'), line;
END
$p$;

ROLLBACK;
