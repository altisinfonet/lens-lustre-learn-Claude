-- ═══════════════════════════════════════════════════════════════════════════
-- PROBE · 20261113_0500 every member has a name. WRITES NOTHING (ROLLBACK).
-- FAILS before apply. PASS = the rule and trigger are in place, no member has
-- a blank name, and — exercised on a real row, rolled back — blanking a name
-- gives the handle back instead of saving a blank. Counts only.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL client_min_messages = notice;

DO $p$
DECLARE
  _id uuid; _handle text; _after text;
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION 'PROBE REFUSED — p32.lane is not asserted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_full_name_not_blank' AND convalidated) THEN
    RAISE EXCEPTION 'PROBE FAIL: profiles_full_name_not_blank missing or not validated (0500 not applied)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_profiles_zzz_name_never_blank' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'PROBE FAIL: trg_profiles_zzz_name_never_blank missing or disabled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE full_name IS NULL OR btrim(full_name) = '') THEN
    RAISE EXCEPTION 'PROBE FAIL: a member still has no name';
  END IF;
  -- exercised, rolled back: a plain member (not an admin — their name is protected) with a handle
  SELECT p.id, p.custom_url INTO _id, _handle FROM public.profiles p
   WHERE p.custom_url IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role::text = 'admin')
   LIMIT 1;
  IF _id IS NOT NULL THEN
    UPDATE public.profiles SET full_name = '   ' WHERE id = _id;
    SELECT full_name INTO _after FROM public.profiles WHERE id = _id;
    IF _after IS NULL OR btrim(_after) = '' THEN
      RAISE EXCEPTION 'PROBE FAIL: a blanked name was saved blank';
    END IF;
  END IF;
  RAISE NOTICE 'MN0500 PASS (lane %): members % ; with no name 0 ; blanking a name gives % back',
    current_setting('p32.lane'), (SELECT count(*) FROM public.profiles),
    CASE WHEN _id IS NULL THEN 'n/a' WHEN _after IS NOT NULL THEN 'a name' END;
END
$p$;

ROLLBACK;
