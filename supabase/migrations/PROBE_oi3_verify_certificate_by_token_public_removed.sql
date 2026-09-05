-- OI-3 GATE PROBE — the F-62 trap is disarmed and public verification STILL WORKS.
--
-- Run with: psql "$DB_URL" -f supabase/migrations/PROBE_oi3_verify_certificate_by_token_public_removed.sql
-- Exits non-zero on the first failed assertion. Writes nothing.
--
-- ⚠ THIS PROBE IS UNUSUAL: MOST OF IT ASSERTS THAT NOTHING CHANGED.
-- OI-3 removes one redundant ACL entry. The risk is not that it fails to do
-- that — it is that it takes public certificate verification down with it. So
-- E2 and E4 assert the FEATURE still works, and they are the assertions that
-- matter most. A migration that closed verification would fail its own probe.
--
-- ⚠ PER-OID (C2 form). Every assertion is against the oid captured in E1.

DO $probe$
DECLARE
  _oid      oid;
  _n        int;
  _acl      text;
  _anon     boolean;
  _public_n int;
  _rows     int;
  _tok      text;
BEGIN
  RAISE NOTICE '--- OI-3 gate probe: verify_certificate_by_token(text) @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

  -- E1 · EXACTLY ONE verify_certificate_by_token(text), oid captured.
  SELECT count(*) INTO _n
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'verify_certificate_by_token';
  IF _n = 0 THEN
    RAISE EXCEPTION
      'E1 FAILED — public.verify_certificate_by_token does not exist. OI-3 removes one grant; it does not drop the function. Something other than this unit removed it, and public certificate verification is DOWN.';
  ELSIF _n > 1 THEN
    RAISE EXCEPTION
      'E1 FAILED — % functions named public.verify_certificate_by_token exist. The gate is per-function; a green reading on one oid says nothing about the other.', _n;
  END IF;

  SELECT p.oid, array_to_string(p.proacl, ' | ')
    INTO _oid, _acl
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'verify_certificate_by_token';

  SELECT count(*) INTO _public_n
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = _oid AND a.grantee = 0;

  -- E3 · THE UNIT. No PUBLIC entry — the F-62 trap is disarmed.
  IF _public_n > 0 THEN
    RAISE EXCEPTION
      'E3 FAILED — PUBLIC still holds EXECUTE on oid % (% entry). The F-62 trap is armed: the day anyone writes REVOKE ... FROM anon on this function it will succeed, the catalogue will look changed, and anon will still execute through PUBLIC. If this appeared after the migration, the function was recreated with DROP+CREATE (F-66). acl = %',
      _oid, _public_n, _acl;
  END IF;

  -- E2 · THE FEATURE. anon MUST still execute — through its OWN grant now.
  --      Checked AFTER E3 deliberately: while PUBLIC holds the grant this
  --      reading is true for the wrong reason (F-62), so it only means what it
  --      says once E3 has passed.
  SELECT has_function_privilege('anon', _oid, 'EXECUTE') INTO _anon;
  IF NOT _anon THEN
    RAISE EXCEPTION
      'E2 FAILED — anon CANNOT execute public.verify_certificate_by_token (oid %). PUBLIC CERTIFICATE VERIFICATION IS DOWN. OI-3 was supposed to remove the redundant PUBLIC entry and leave anon''s explicit grant untouched; either anon had no explicit grant on this lane (in which case this migration must not be applied here) or something revoked it. Restore with GRANT EXECUTE ... TO anon and re-prove. acl = %',
      _oid, _acl;
  END IF;

  -- E4 · IT STILL RETURNS A ROW FOR A REAL TOKEN.
  --      A grant is not a feature. E2 says anon is allowed to call it; E4 says
  --      calling it still answers. Skipped, loudly, when the lane holds no
  --      certificate with a token — a probe that silently passes on an empty
  --      table is a probe that stopped testing.
  SELECT verification_token INTO _tok
    FROM public.certificates
   WHERE verification_token IS NOT NULL
   LIMIT 1;

  IF _tok IS NULL THEN
    RAISE NOTICE 'E4 SKIPPED — no certificate on this lane carries a verification_token, so the round trip cannot be exercised here. THIS IS NOT A PASS. Re-run E4 on a lane that has one before trusting OI-3 end to end.';
  ELSE
    SELECT count(*) INTO _rows
      FROM public.verify_certificate_by_token(_tok);
    IF _rows < 1 THEN
      RAISE EXCEPTION
        'E4 FAILED — verify_certificate_by_token returned % rows for a token taken from public.certificates. The grant is present but the function no longer answers, so verification is broken in a way E2 cannot see.', _rows;
    END IF;
    RAISE NOTICE 'E4 ok — a real token still returns % row(s)', _rows;
  END IF;

  RAISE NOTICE 'E1 ok — exactly one public.verify_certificate_by_token, oid %', _oid;
  RAISE NOTICE 'E3 ok — PUBLIC entries = 0 (F-62 trap disarmed)';
  RAISE NOTICE 'E2 ok — anon CAN still execute, through its own explicit grant (the feature)';
  RAISE NOTICE 'acl = %', _acl;
  RAISE NOTICE '--- OI-3 PROBE PASSED (catalogue + round trip; the anon HTTP call is the other half) ---';
END
$probe$;
