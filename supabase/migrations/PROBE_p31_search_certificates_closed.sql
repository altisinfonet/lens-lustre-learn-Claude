-- ═══════════════════════════════════════════════════════════════════════════
-- P31 GATE PROBE — search_certificates is closed to anon, AND verify-by-token
-- still works. READS ONLY. Ends in ROLLBACK.
--
-- ⚠ THIS PROBE HAS TWO HALVES AND THE SECOND IS NOT OPTIONAL.
-- The gate says "verification by token retained and tested". A probe that only
-- proved the revoke would prove the dangerous half of the change and leave the
-- half that protects real certificate holders untested. C6 and C7 are that
-- half: they assert verify_certificate_by_token is still reachable by anon and
-- still returns a row for a token that exists. "Retained" is a thing to be
-- shown still working, not a thing to be left alone and assumed.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THE GATE'S OWN RULE — docs/gates/P1-revocation-list.md §1, frozen:
--
--   "A closure is proved per function, by
--    has_function_privilege('anon', <oid>, 'EXECUTE') = false, on the lane it
--    is claimed for. No gate on this list may be written against a *class*."
--
-- ⚠ AND HERE, UNLIKE P30, F-62 GENUINELY BITES. PUBLIC held EXECUTE on
-- search_certificates on BOTH lanes (measured 2026-09-04: the leading
-- `=X/postgres` in proacl, aclexplode grantee=0 count = 1). So `REVOKE … FROM
-- anon` alone would have left anon executing through PUBLIC, the catalogue
-- would have looked changed, and the gate would have closed nothing. C2 and C3
-- are therefore BOTH required: C2 is the gate, C3 is the trap. They fail
-- differently and the difference names the defect.
--
-- ⚠ A TEST THAT COULD NOT HAVE FAILED IS NOT EVIDENCE (C-34). Every assertion
-- here was shown FAILING before the revoke and passing after, on a scratch
-- PostgreSQL 16 fixture reproducing the MEASURED acl string — the one WITH the
-- leading `=X/postgres` — not a clean one. The transcript is
-- docs/evidence/d1/P31/P31-fixture-transcript.txt and it includes the anon-only
-- revoke being shown to change nothing on that exact ACL.
--
-- ⚠ WHAT THIS PROBE DOES NOT PROVE. It reads the catalogue and calls the
-- functions in-database. It does NOT exercise /rest/v1/rpc over HTTP as a real
-- anonymous browser would, so it does not test PostgREST's own exposure rules;
-- and it does NOT prove the four verification PAGES render correctly after the
-- revoke — that is D2's half, it is a browser question, and curl is not a
-- browser (F-53). That client behaviour is the PRECONDITION of applying this
-- unit at all, not something this file can certify.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  sc_oid          oid;
  sc_count        integer;
  tok_oid         oid;
  tok_count       integer;
  sc_acl          text;
  sc_anon         boolean;
  sc_auth         boolean;
  sc_svc          boolean;
  sc_public       integer;
  tok_anon        boolean;
  tok_public      integer;
  sc_secdef       boolean;
  sc_volatile     "char";
  sample_token    text;
  tok_rows        integer;
  certs_total     integer;
BEGIN
  RAISE NOTICE '--- P31 gate probe: search_certificates + verify_certificate_by_token @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  RAISE NOTICE '    lane database: %', current_database();

  ---------------------------------------------------------------------------
  -- C1 · EXACTLY ONE search_certificates, and its oid is captured. Every
  -- assertion below is per-oid; "per function" is meaningless if an overload
  -- exists and only one was revoked.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO sc_count FROM pg_proc p
   WHERE p.pronamespace='public'::regnamespace AND p.proname='search_certificates';

  IF sc_count = 0 THEN
    RAISE EXCEPTION 'C1 FAILED — public.search_certificates does not exist. P31 closes a grant; it does not drop the function, and the rollback needs it.';
  END IF;
  IF sc_count > 1 THEN
    RAISE EXCEPTION 'C1 FAILED — % overloads of public.search_certificates exist. A green reading on one oid says nothing about the other. Revoke every overload.', sc_count;
  END IF;

  SELECT p.oid, p.proacl::text, p.prosecdef, p.provolatile
    INTO sc_oid, sc_acl, sc_secdef, sc_volatile
    FROM pg_proc p
   WHERE p.pronamespace='public'::regnamespace AND p.proname='search_certificates';
  RAISE NOTICE 'C1 exactly one search_certificates ....... PASS (oid %, acl %)', sc_oid, COALESCE(sc_acl,'NULL');

  ---------------------------------------------------------------------------
  -- C2 · THE GATE. Clause 1 of P31, in the frozen list's own words.
  ---------------------------------------------------------------------------
  SELECT has_function_privilege('anon',          sc_oid, 'EXECUTE'),
         has_function_privilege('authenticated', sc_oid, 'EXECUTE'),
         has_function_privilege('service_role',  sc_oid, 'EXECUTE')
    INTO sc_anon, sc_auth, sc_svc;

  IF sc_anon THEN
    RAISE EXCEPTION
      'C2 FAILED — anon can still EXECUTE public.search_certificates (oid %). The certificate directory is open: a substring match on a person''s full name returns up to 50 rows of recipient names, titles, dates and certificate ids to any holder of the public API key. acl = %',
      sc_oid, COALESCE(sc_acl, 'NULL (built-in default = EXECUTE TO PUBLIC)');
  END IF;
  RAISE NOTICE 'C2 anon cannot execute (THE GATE) ........ PASS (has_function_privilege anon = false)';

  ---------------------------------------------------------------------------
  -- C3 · THE F-62 TRAP, AND ON THIS FUNCTION IT IS REAL, NOT THEORETICAL.
  -- PUBLIC held EXECUTE here before the revoke (measured, both lanes). If this
  -- ever reads > 0 again, anon is executing through PUBLIC and C2 above would
  -- ALSO be true — but the two failures mean different things, and a reader who
  -- sees C3 fire knows immediately that somebody revoked from anon only, or
  -- recreated the function.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO sc_public
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = sc_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';

  IF sc_acl IS NULL THEN
    RAISE EXCEPTION
      'C3 FAILED — proacl is NULL on oid %. NULL is the BUILT-IN DEFAULT, which IS EXECUTE TO PUBLIC, not "no grants". The function has been recreated (DROP+CREATE re-applies the default — F-66) and P31 has silently reopened.',
      sc_oid;
  END IF;
  IF sc_public > 0 THEN
    RAISE EXCEPTION
      'C3 FAILED — PUBLIC holds EXECUTE on oid % (% entry). anon inherits through PUBLIC, so revoking from anon alone closes NOTHING here (F-62) — and unlike email_exists, this function really did carry a PUBLIC grant. The migration revokes FROM public FIRST for exactly this reason. acl = %',
      sc_oid, sc_public, sc_acl;
  END IF;
  RAISE NOTICE 'C3 PUBLIC holds no EXECUTE (F-62) ........ PASS (0 PUBLIC entries, proacl not NULL)';

  ---------------------------------------------------------------------------
  -- C4 · NO OVER-REVOKE. The gate says "removed from the anon role". Stripping
  -- authenticated or service_role exceeds it and would make the rollback file,
  -- which restores PUBLIC and anon only, no longer a faithful restore.
  ---------------------------------------------------------------------------
  IF NOT sc_auth THEN
    RAISE EXCEPTION 'C4 FAILED — authenticated can no longer EXECUTE oid %. The gate authorised removing anon, not authenticated. This is an over-revoke, and the rollback does not restore it. acl = %', sc_oid, sc_acl;
  END IF;
  IF NOT sc_svc THEN
    RAISE EXCEPTION 'C4 FAILED — service_role can no longer EXECUTE oid %. Server-side callers are not the attack class P31 addresses. acl = %', sc_oid, sc_acl;
  END IF;
  RAISE NOTICE 'C4 no over-revoke ........................ PASS (authenticated=true, service_role=true)';

  ---------------------------------------------------------------------------
  -- C5 · THE FUNCTION IS UNCHANGED IN KIND. P31 is a grant change.
  ---------------------------------------------------------------------------
  IF NOT sc_secdef THEN
    RAISE EXCEPTION 'C5 FAILED — oid % is no longer SECURITY DEFINER. P31 changes grants only; something else edited the function.', sc_oid;
  END IF;
  IF sc_volatile <> 's' THEN
    RAISE EXCEPTION 'C5 FAILED — oid % is no longer STABLE (provolatile=%). P31 changes grants only.', sc_oid, sc_volatile;
  END IF;
  RAISE NOTICE 'C5 function unchanged in kind ............ PASS (SECURITY DEFINER, STABLE)';

  ---------------------------------------------------------------------------
  -- C6 · VERIFY-BY-TOKEN IS RETAINED. Gate clause 2, the half that protects
  -- real certificate holders. verify_certificate_by_token must remain reachable
  -- by anon — closing it would break public verification, which is the product
  -- behaviour this whole unit is built to preserve.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO tok_count FROM pg_proc p
   WHERE p.pronamespace='public'::regnamespace AND p.proname='verify_certificate_by_token';
  IF tok_count <> 1 THEN
    RAISE EXCEPTION 'C6 FAILED — expected exactly one public.verify_certificate_by_token, found %.', tok_count;
  END IF;

  SELECT p.oid INTO tok_oid FROM pg_proc p
   WHERE p.pronamespace='public'::regnamespace AND p.proname='verify_certificate_by_token';
  SELECT has_function_privilege('anon', tok_oid, 'EXECUTE') INTO tok_anon;
  SELECT count(*) INTO tok_public
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = tok_oid AND a.grantee = 0 AND a.privilege_type='EXECUTE';

  IF NOT tok_anon THEN
    RAISE EXCEPTION
      'C6 FAILED — anon can no longer EXECUTE verify_certificate_by_token (oid %). PUBLIC VERIFICATION IS BROKEN. The gate requires verification by token to be RETAINED; a revoke that caught this function has gone too far and every certificate holder now looks unverifiable.',
      tok_oid;
  END IF;
  RAISE NOTICE 'C6 verify-by-token retained .............. PASS (anon=true, PUBLIC entries=%)', tok_public;

  ---------------------------------------------------------------------------
  -- C7 · AND IT STILL RETURNS A ROW. A grant that survives while the function
  -- answers nothing is not "retained". Uses a token read from the table inside
  -- this read-only transaction; the token VALUE is never printed.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO certs_total FROM public.certificates;
  IF certs_total = 0 THEN
    RAISE NOTICE 'C7 verify-by-token returns a row ......... SKIPPED (0 certificates on this lane — nothing to verify against)';
  ELSE
    SELECT c.verification_token INTO sample_token
      FROM public.certificates c
     WHERE c.verification_token IS NOT NULL
     ORDER BY c.issued_at
     LIMIT 1;

    IF sample_token IS NULL THEN
      RAISE NOTICE 'C7 verify-by-token returns a row ......... SKIPPED (% certificate(s), none with a token)', certs_total;
    ELSE
      SELECT count(*) INTO tok_rows FROM public.verify_certificate_by_token(sample_token);
      IF tok_rows <> 1 THEN
        RAISE EXCEPTION
          'C7 FAILED — verify_certificate_by_token returned % row(s) for a token taken directly from the certificates table. Verification is broken for a real, existing certificate.',
          tok_rows;
      END IF;
      RAISE NOTICE 'C7 verify-by-token returns a row ......... PASS (1 row for a real token; value not printed)';
    END IF;
  END IF;

  RAISE NOTICE '--- ALL ASSERTIONS PASSED. Clause 1 closed and clause 2 shown retained, on this lane. Nothing was written. ---';
  RAISE NOTICE '    Clause 3 (verify_staff_id behind a session or rate limit) is NOT tested here — separate unit, and it is not a revocation (C-60).';
  RAISE NOTICE '    Not tested here: the four verification PAGES after the revoke. D2''s half, a browser question, F-53.';
END
$probe$;

-- Belt and braces: this file must never be able to change anything, even if a
-- future edit to the block above introduces a write by accident.
ROLLBACK;
