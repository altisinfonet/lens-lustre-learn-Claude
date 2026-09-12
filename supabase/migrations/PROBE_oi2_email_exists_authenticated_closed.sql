-- OI-2 GATE PROBE — email_exists(text) is closed to authenticated. READS ONLY.
--
-- Run with: psql "$DB_URL" -f supabase/migrations/PROBE_oi2_email_exists_authenticated_closed.sql
-- Exits non-zero on the first failed assertion. Writes nothing.
--
-- ⚠ WHAT THIS PROBE CANNOT DO, SAID FIRST SO NOBODY MISTAKES IT FOR THE WHOLE
-- PROOF. It runs as the migration role and asks the CATALOGUE. It does not call
-- /rest/v1/rpc/email_exists over HTTP as a signed-in browser would. A green
-- probe plus a green HTTP call is the proof; the probe alone is half of it.
-- OI-2's evidence therefore carries BOTH an authenticated HTTP call and an anon
-- one — anon because P30 must not have regressed, authenticated because that is
-- the grant this unit withdraws.
--
-- ⚠ PER-OID, NOT PER-NAME (C2 form). Every assertion is made against the oid
-- captured in D5. If an overload ever appears, a green reading on one oid says
-- nothing about the other, so D5 refuses to continue rather than average them.

DO $probe$
DECLARE
  _oid       oid;
  _n         int;
  _acl       text;
  _anon      boolean;
  _auth      boolean;
  _svc       boolean;
  _public_n  int;
BEGIN
  RAISE NOTICE '--- OI-2 gate probe: email_exists(text) @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  -- D5 · EXACTLY ONE email_exists IN public, and its oid is captured.
  SELECT count(*) INTO _n
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'email_exists';

  IF _n = 0 THEN
    RAISE EXCEPTION
      'D5 FAILED — public.email_exists does not exist. OI-2 closes a grant; it does not drop the function, and the rollback needs it. Something other than this unit removed it.';
  ELSIF _n > 1 THEN
    RAISE EXCEPTION
      'D5 FAILED — % functions named public.email_exists exist. The gate is per-function; with an overload present a green reading on one oid says nothing about the other. Revoke every overload or drop the extra one.', _n;
  END IF;

  SELECT p.oid, array_to_string(p.proacl, ' | ')
    INTO _oid, _acl
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'email_exists';

  SELECT has_function_privilege('anon',          _oid, 'EXECUTE'),
         has_function_privilege('authenticated', _oid, 'EXECUTE'),
         has_function_privilege('service_role',  _oid, 'EXECUTE')
    INTO _anon, _auth, _svc;

  SELECT count(*) INTO _public_n
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = _oid AND a.grantee = 0;

  -- D3 · NO PUBLIC ENTRY — CHECKED FIRST, AND THE ORDER IS THE POINT.
  --
  -- ⚠ THIS ASSERTION USED TO SIT AFTER D2 AND WAS THEREFORE UNREACHABLE. A
  -- function has only one privilege, EXECUTE, so if PUBLIC holds it then
  -- has_function_privilege('authenticated', …) is TRUE BY INHERITANCE and D2
  -- fires first — every time. The negative control caught it: planting a PUBLIC
  -- grant produced a D2 failure, not a D3 one.
  --
  -- That is not merely a dead branch, it is a WRONG DIAGNOSIS. D2's message
  -- sends the reader to look for a stray GRANT to authenticated, when the real
  -- cause is that the function was recreated with DROP+CREATE and reopened to
  -- PUBLIC (F-66). The cause must be reported before the symptom, so PUBLIC is
  -- now tested first.
  IF _public_n > 0 THEN
    RAISE EXCEPTION
      'D3 FAILED — PUBLIC holds EXECUTE on oid % (% entry). EVERY role inherits through PUBLIC, so any per-role reading below this line is meaningless (F-62): anon and authenticated will both report true whatever their own grants say. The function was almost certainly recreated with DROP+CREATE, which re-applies the built-in EXECUTE-to-PUBLIC default (F-66). Re-apply P30 and OI-2, then re-prove. acl = %',
      _oid, _public_n, _acl;
  END IF;

  -- D2 · THE UNIT. authenticated must NOT hold EXECUTE.
  IF _auth THEN
    RAISE EXCEPTION
      'D2 FAILED — authenticated can still EXECUTE public.email_exists (oid %). Anyone may create an account, so this is the enumeration oracle open behind a signup: one call per address, attributable but unbounded. acl = %',
      _oid, _acl;
  END IF;

  -- D1 · P30 MUST NOT HAVE REGRESSED. anon still closed.
  IF _anon THEN
    RAISE EXCEPTION
      'D1 FAILED — anon can EXECUTE public.email_exists (oid %). P30 has regressed. If this function was recreated with DROP+CREATE it reopened to PUBLIC (F-66) and BOTH revokes must be re-applied. acl = %',
      _oid, _acl;
  END IF;

  -- D4 · NOT AN OVER-REVOKE. service_role must KEEP EXECUTE.
  IF NOT _svc THEN
    RAISE EXCEPTION
      'D4 FAILED — service_role lost EXECUTE on oid %. An over-revoke is as much a defect as an under-revoke: server-side callers are not the attack class, and the rollback''s fidelity depends on this being untouched. acl = %',
      _oid, _acl;
  END IF;

  RAISE NOTICE 'D5 ok — exactly one public.email_exists, oid %', _oid;
  RAISE NOTICE 'D3 ok — PUBLIC entries = 0, so the per-role readings below mean something';
  RAISE NOTICE 'D2 ok — authenticated CANNOT execute (the unit)';
  RAISE NOTICE 'D1 ok — anon still cannot execute (P30 has not regressed)';
  RAISE NOTICE 'D4 ok — service_role retains EXECUTE (not an over-revoke)';
  RAISE NOTICE 'acl = %', _acl;
  RAISE NOTICE '--- OI-2 PROBE PASSED (catalogue only — the HTTP calls are the other half) ---';
END
$probe$;
