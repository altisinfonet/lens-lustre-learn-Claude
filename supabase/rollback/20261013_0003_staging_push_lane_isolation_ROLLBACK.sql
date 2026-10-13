-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK · 20261013_0003 — staging: point the push trigger at staging's own send-push
-- Lane: STAGING ONLY. Refuses any other lane.
--
-- ⚠ RUNNING THIS RE-OPENS THE CROSS-LANE PATH 20261013_0003 CLOSED. It puts
-- PRODUCTION's send-push URL back into staging's push_config, after which every
-- staging notification is posted to production's push sender again. There is
-- no staging behaviour that needs that path, and 20261013_0003 cannot break a
-- notification insert (the trigger only queues through pg_net, inside a
-- catch-all handler — see the migration header). Prefer a forward fix; use
-- this file only on an explicit, recorded Owner decision.
--
-- ⚠ ORDER: if 20261013_0002 (the two auth.users triggers, PR #425) is applied
-- on staging, roll back 0002 FIRST. Rolling back this file alone restores
-- production's URL while sign-ups create notifications → staging sign-ups
-- would reach production's push sender. This file does not check for those
-- triggers (a refusal is planned in the push_config hardening follow-up).
--
-- Restores exactly the non-secret values 20261013_0003 changed:
--   function_url = https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/send-push
--   updated_at   = 2026-07-31 10:52:12.705409+00 (the value read on staging
--                  2026-10-13 before the change)
-- internal_secret is never printed, logged or changed (20261013_0003 never
-- changed it either). It is read only inside this file's apply block: reduced
-- to an md5 fingerprint that is compared before/after the UPDATE to prove the
-- column was not touched (a missing value is refused). Neither the value nor
-- the fingerprint is ever output.
--
-- RB-PRE-001 refuses unless push_config is exactly in 20261013_0003's post-state
-- (one row, naming staging's send-push), so this cannot run before the
-- migration, twice, or over a later change to the row.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — this file is for STAGING only and p32.lane reads %. '
      'Dispatch apply-migration.yml with target=staging (it sets p32.lane = ''staging'').',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

SET LOCAL lock_timeout = '5s';

DO $preconditions$
DECLARE
  _staging_url constant text := 'https://fpszggreishhuvdpkmdr.supabase.co/functions/v1/send-push';
  _n int;
BEGIN
  -- RB-PRE-001 · push_config is in 20261013_0003's post-state.
  IF to_regclass('public.push_config') IS NULL THEN
    RAISE EXCEPTION 'PUSHLANE-0003-RB-PRE-001: public.push_config does not exist' USING ERRCODE = 'raise_exception';
  END IF;
  SELECT count(*) INTO _n FROM public.push_config;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'PUSHLANE-0003-RB-PRE-001: push_config holds % row(s); exactly 1 expected', _n USING ERRCODE = 'raise_exception';
  END IF;
  SELECT count(*) INTO _n FROM public.push_config c WHERE c.id AND c.function_url = _staging_url;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'PUSHLANE-0003-RB-PRE-001: push_config.function_url is not staging''s send-push — not 20261013_0003''s post-state; refusing'
    USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

DO $apply$
DECLARE
  _prod_url    constant text := 'https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/send-push';
  _staging_url constant text := 'https://fpszggreishhuvdpkmdr.supabase.co/functions/v1/send-push';
  _fp_before text;
  _fp_after  text;
  _rows      int;
BEGIN
  -- The other column is reduced to a fingerprint, compared, never output.
  SELECT md5(c.internal_secret) INTO _fp_before FROM public.push_config c WHERE c.id;

  UPDATE public.push_config
     SET function_url = _prod_url,
         updated_at   = '2026-07-31 10:52:12.705409+00'::timestamptz
   WHERE id
     AND function_url = _staging_url;
  GET DIAGNOSTICS _rows = ROW_COUNT;

  SELECT md5(c.internal_secret) INTO _fp_after FROM public.push_config c WHERE c.id;
  IF _rows <> 1 OR _fp_after IS NULL OR _fp_after IS DISTINCT FROM _fp_before THEN
    RAISE EXCEPTION 'PUSHLANE-0003-RB-POST-001: expected exactly 1 row restored with the other column unchanged (rows %)', _rows
    USING ERRCODE = 'raise_exception';
  END IF;
END
$apply$;

DO $postconditions$
DECLARE
  _prod_url constant text := 'https://jtdtehuqtinjxropkkcn.supabase.co/functions/v1/send-push';
  _n int;
BEGIN
  -- RB-POST-002 · the row is back to its pre-20261013_0003 non-secret values.
  SELECT count(*) INTO _n FROM public.push_config c
   WHERE c.id AND c.function_url = _prod_url
     AND c.updated_at = '2026-07-31 10:52:12.705409+00'::timestamptz;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'PUSHLANE-0003-RB-POST-002: push_config was not restored to its pre-20261013_0003 values'
    USING ERRCODE = 'raise_exception';
  END IF;
  RAISE WARNING 'PUSHLANE-0003 ROLLBACK: staging push_config names PRODUCTION''s send-push again — the cross-lane path is OPEN';
END
$postconditions$;

COMMIT;
