-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261103_0601 Admin → Uploads → Upload Resume. READ ONLY, ROLLBACK.
-- Reports FIRST (always): site_settings photo_upload_resume and, once 0601 is
-- applied, the switch's mode and how many members are selected (never who).
-- PASS = the key is allowed, the row exists, the trigger is enabled, its
-- function is SECURITY DEFINER search_path="" and not executable by the API
-- roles, and site_settings holds what the mode maps to. Before the apply it
-- FAILS at the first missing object (expected).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

DO $p$
DECLARE _mode text; _stored text; _members int;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  SELECT s.value #>> '{}' INTO _stored FROM public.site_settings s WHERE s.key = 'photo_upload_resume';
  SELECT fa.mode, (SELECT count(*) FROM public.feature_access_members m WHERE m.feature = fa.feature)
    INTO _mode, _members FROM public.feature_access fa WHERE fa.feature = 'photo_upload_resume';
  RAISE NOTICE 'photo_upload_resume (lane %): site_settings=% · switch mode=% · selected members=%',
    current_setting('p32.lane'), coalesce(_stored, '(no row = off)'), coalesce(_mode, '(not a switch yet)'), coalesce(_members, 0);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.feature_access'::regclass
                  AND conname = 'feature_access_feature_check'
                  AND pg_get_constraintdef(oid) ~ 'photo_upload_resume') THEN
    RAISE EXCEPTION 'PROBE FAIL: feature_access_feature_check does not allow photo_upload_resume (0601 not applied)';
  END IF;
  IF _mode IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL: no feature_access row for photo_upload_resume';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.tg_photo_resume_to_site_setting()')
                  AND prosecdef AND proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'PROBE FAIL: tg_photo_resume_to_site_setting() missing or not SECURITY DEFINER, search_path=""';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D'
                  AND tgname = 'trg_photo_resume_to_site_setting' AND tgrelid = 'public.feature_access'::regclass) THEN
    RAISE EXCEPTION 'PROBE FAIL: trigger trg_photo_resume_to_site_setting missing or disabled';
  END IF;
  IF has_function_privilege('authenticated', 'public.tg_photo_resume_to_site_setting()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tg_photo_resume_to_site_setting()', 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL: the trigger function is executable by an API role';
  END IF;
  IF _stored IS DISTINCT FROM (CASE _mode WHEN 'everyone' THEN 'on' WHEN 'selected' THEN 'selected' ELSE 'off' END) THEN
    RAISE EXCEPTION 'PROBE FAIL: site_settings (%) does not match the switch mode (%)', coalesce(_stored, '<none>'), _mode;
  END IF;
  RAISE NOTICE 'PROBE PASS: 20261103_0601 present; switch and site_settings agree';
END
$p$;

ROLLBACK;
