-- F-105a GATE PROBE — get_todays_birthdays(uuid) is server-side only. READS ONLY.
--
-- Run with: psql "$DB_URL" -f supabase/migrations/PROBE_f105a_get_todays_birthdays_closed.sql
-- Exits non-zero on the first failed assertion. Writes nothing.
--
-- ⚠ RUN THIS BEFORE 0016 AS WELL AS AFTER. Before, G2 must FAIL — that is the
-- C-34 fail-first evidence, and a probe that has never been seen red is not
-- evidence that anything was closed. After 0016 every assertion must pass.
--
-- ⚠ PER-OID (C2 form). Every assertion is against the oid captured in G1.
-- ⚠ proacl IS THE INSTRUMENT. has_function_privilege cannot distinguish a
--   direct grant from one inherited through PUBLIC and told both the developer
--   and the Auditor that F-98's revoke had worked when it had not (C-89).

DO $probe$
DECLARE
  _oid      oid;
  _n        int;
  _acl      text;
  _public_n int;
  _anon_n   int;
  _auth_n   int;
  _svc_n    int;
  _cols     int;
BEGIN
  RAISE NOTICE '--- F-105a gate probe: get_todays_birthdays(uuid) @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  -- G1 · EXACTLY ONE get_todays_birthdays, oid captured.
  SELECT count(*) INTO _n
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'get_todays_birthdays';
  IF _n = 0 THEN
    RAISE EXCEPTION
      'G1 FAILED — public.get_todays_birthdays does not exist. 0016 revokes a grant; it does not drop the function, and 0015 must have created it. Either 0015 has not run or something dropped it, and the birthday sidebar is DOWN.';
  ELSIF _n > 1 THEN
    RAISE EXCEPTION
      'G1 FAILED — % functions named public.get_todays_birthdays exist. The gate is per-function; a green reading on one oid says nothing about the other. 0015''s DROP is signature-specific and will have missed an overload.', _n;
  END IF;

  SELECT p.oid, array_to_string(p.proacl, ' | ')
    INTO _oid, _acl
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'get_todays_birthdays';

  SELECT count(*) FILTER (WHERE a.grantee = 0),
         count(*) FILTER (WHERE a.grantee = 'anon'::regrole),
         count(*) FILTER (WHERE a.grantee = 'authenticated'::regrole),
         count(*) FILTER (WHERE a.grantee = 'service_role'::regrole)
    INTO _public_n, _anon_n, _auth_n, _svc_n
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = _oid;

  -- G3 · NO PUBLIC ENTRY — CHECKED FIRST, AND THE ORDER IS THE POINT.
  -- A function has one privilege, EXECUTE. If PUBLIC holds it, every per-role
  -- reading below is true by inheritance and would report the wrong cause.
  IF _public_n > 0 THEN
    RAISE EXCEPTION
      'G3 FAILED — PUBLIC holds EXECUTE on oid % (% entry). Every reading below is meaningless (F-62). The function was recreated and re-acquired the built-in EXECUTE-to-PUBLIC default (F-66) — most likely 0015 was re-applied AFTER 0016. Re-apply 0016. acl = %',
      _oid, _public_n, _acl;
  END IF;

  -- G2 · THE UNIT. authenticated must NOT hold EXECUTE.
  IF _auth_n > 0 THEN
    RAISE EXCEPTION
      'G2 FAILED — authenticated holds EXECUTE on oid %. This function is SECURITY DEFINER and takes _viewer as an argument without comparing it to auth.uid(), so any signed-in member can read any other member''s friend-filtered birthday list by passing that member''s id. If this is the FIRST run of this probe, this failure is the expected C-34 fail-first reading and 0016 has not been applied yet. If it appears AFTER 0016, check whether 0015 was re-applied on top of it — a DROP+CREATE re-acquires this grant from ALTER DEFAULT PRIVILEGES silently. acl = %',
      _oid, _acl;
  END IF;

  -- G4 · anon likewise closed.
  IF _anon_n > 0 THEN
    RAISE EXCEPTION
      'G4 FAILED — anon holds EXECUTE on oid %. Birthday day/month is PII and dashboard-init returns an empty array to anonymous callers; this would answer them at the database edge. acl = %',
      _oid, _acl;
  END IF;

  -- G5 · NOT AN OVER-REVOKE. service_role MUST keep EXECUTE.
  IF _svc_n = 0 THEN
    RAISE EXCEPTION
      'G5 FAILED — service_role lost EXECUTE on oid %. dashboard-init builds its client with SUPABASE_SERVICE_ROLE_KEY (index.ts:45-46) and calls this RPC at line 203; without this grant the birthday sidebar is DOWN on every page that renders it. An over-revoke is as much a defect as an under-revoke. acl = %',
      _oid, _acl;
  END IF;

  -- G6 · THE F-98c COLUMN SURVIVED THE REVOKE FILE.
  -- 0016 must not be mistaken for a place to redefine the function. If the
  -- handle column is gone, someone recreated it from the pre-F-98c source.
  SELECT count(*) INTO _cols
    FROM unnest(string_to_array(pg_get_function_result(_oid), ',')) c
   WHERE btrim(c) LIKE 'custom_url %';
  IF _cols <> 1 THEN
    RAISE EXCEPTION
      'G6 FAILED — the result type of oid % does not carry exactly one custom_url column (found %). F-98c source 3 has regressed: birthday names will render as dead text. result = %',
      _oid, _cols, pg_get_function_result(_oid);
  END IF;

  RAISE NOTICE 'G1 ok — exactly one public.get_todays_birthdays, oid %', _oid;
  RAISE NOTICE 'G3 ok — PUBLIC entries = 0, so the per-role readings mean something';
  RAISE NOTICE 'G2 ok — authenticated CANNOT execute (the unit)';
  RAISE NOTICE 'G4 ok — anon CANNOT execute';
  RAISE NOTICE 'G5 ok — service_role retains EXECUTE (dashboard-init still works)';
  RAISE NOTICE 'G6 ok — the F-98c custom_url column is present in the result type';
  RAISE NOTICE 'acl = %', _acl;
  RAISE NOTICE '--- F-105a PROBE PASSED ---';
END
$probe$;
