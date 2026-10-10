-- ═══════════════════════════════════════════════════════════════════════════
-- P32 · SET A GATE PROBE — the three custom-URL identity functions closed to
-- PUBLIC and anon on the lane the claim is made for.
--   public.claim_username(text)
--   public.change_custom_url(text)
--   public.clear_custom_url()
-- READS ONLY. Ends in ROLLBACK. Calls nothing.
--
-- ⚠ THIS PROBE IS AUTHORED, NOT DISPATCHED, AND IT IS AUTHORED TO FAIL TODAY.
-- Work order §4.5: "each must be shown failing against the current open state
-- before it is accepted" (C-34 — a test that could not have failed is not
-- evidence). The fail-first transcript is
-- docs/evidence/d1/phase1/probe-fail-first-20260922.txt, taken 2026-09-22.
--
-- ⚠ SET A IS THE ONE PLACE PRODUCTION IS BEHIND STAGING, AND THAT DECIDES HOW
-- THIS FILE READS. Auditor baseline, 2026-09-21/22:
--     production jtdtehuqtinjxropkkcn — all three OPEN, all three hold PUBLIC
--     staging    fpszggreishhuvdpkmdr  — all three CLOSED
-- So on STAGING this probe is expected to PASS today (verified read-only
-- 2026-09-22T05:31Z: claim_username and change_custom_url =
-- `postgres=X | service_role=X | authenticated=X`, clear_custom_url =
-- `postgres=X | service_role=X`, no PUBLIC entry on any of the three), and on
-- PRODUCTION it is expected to FAIL at C3/C4 on all three. That asymmetry is
-- the finding, not a defect in the probe: a probe that passed on both lanes
-- would be describing a state that does not exist.
--
-- ⚠ PRODUCTION WAS NOT READ BY THE SESSION THAT WROTE THIS FILE. The project
-- jtdtehuqtinjxropkkcn is not attached to this session's Supabase connector
-- (recorded as BLOCKER-1). Every production statement above is RELAYED from
-- the Auditor's published two-lane diff, not re-derived here. This file must
-- be run on production by a session that can read production before any gate
-- moves.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THE GATE'S OWN RULE — docs/gates/P1-revocation-list.md §1, frozen:
--   "A closure is proved per function, by
--    has_function_privilege('anon', <oid>, 'EXECUTE') = false, on the lane it
--    is claimed for. No gate on this list may be written against a *class*."
-- Every assertion below is therefore per function, per signature.
--
-- ⚠ THE THREE DO NOT SHARE ONE INTENDED FINAL SHAPE, AND THE PROBE MUST NOT
-- PRETEND THEY DO. claim_username and change_custom_url keep `authenticated`
-- — they have real authenticated callers (OnboardingModal.tsx:338 under
-- `{user && …}`; EditProfile.tsx:513 behind the /login redirect at :311).
-- clear_custom_url does NOT keep it: the Owner removed its only caller by
-- written decision (src/pages/EditProfile.tsx:563-578), and
-- src/lib/__tests__/customUrlCannotBeRemoved.test.ts:58 pins that removal.
-- Asserting one shape across all three would close a door the Owner
-- deliberately left shut, or open one they shut on purpose.
--
-- ⚠ WHAT THIS PROBE DOES NOT PROVE. It reads the catalogue. It does not call
-- the functions (all three are VOLATILE and all three write profiles /
-- custom_url_history). It does not exercise /rest/v1/rpc over HTTP (F-53). It
-- does not re-derive caller safety — that is
-- docs/evidence/d1/phase1/d2-caller-evidence-verification.md §2.1.
--
-- ⚠ THIS FILE AUTHORISES NOTHING. P1-revocation-list.md Revision 2 clears
-- exactly one object and it is `email_exists(text)`. No REVOKE for any Set A
-- object exists in this unit, by instruction (work order §5).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $probe$
DECLARE
  rec         record;
  fn_oid      oid;
  fn_acl      text;
  fn_secdef   boolean;
  fn_volatile "char";
  fn_schema   text;
  fn_anon     boolean;
  fn_auth     boolean;
  fn_svc      boolean;
  fn_public   integer;
  checked     integer := 0;
BEGIN
  RAISE NOTICE '--- P32 Set A gate probe: custom-URL identity functions @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  RAISE NOTICE '    lane database: %', current_database();

  FOR rec IN
    -- sig · exact type-only signature so to_regprocedure cannot resolve an
    -- unintended overload.  want_auth · whether `authenticated` is RETAINED.
    SELECT * FROM (VALUES
      ('public.claim_username(text)',     true ),
      ('public.change_custom_url(text)',  true ),
      ('public.clear_custom_url()',       false)
    ) AS t(sig, want_auth)
  LOOP
    -- C1 · the signature still resolves to exactly one function. NULL covers
    -- both no-match and ambiguous-match, which a bare cast would hide.
    fn_oid := to_regprocedure(rec.sig)::oid;
    IF fn_oid IS NULL THEN
      RAISE EXCEPTION 'C1 FAILED — % does not resolve to exactly one function. This gate closes a grant; it does not drop or rename anything, so a missing signature means the object moved underneath the closure.', rec.sig;
    END IF;

    SELECT p.proacl::text, p.prosecdef, p.provolatile, n.nspname
      INTO fn_acl, fn_secdef, fn_volatile, fn_schema
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.oid = fn_oid;

    checked := checked + 1;

    -- C2 · schema. Drift here means the signature matched a same-named
    -- function elsewhere and the probe is checking the wrong object.
    IF fn_schema <> 'public' THEN
      RAISE EXCEPTION 'C2 FAILED — % (oid %) lives in schema %, expected public.', rec.sig, fn_oid, fn_schema;
    END IF;

    SELECT has_function_privilege('anon',          fn_oid, 'EXECUTE'),
           has_function_privilege('authenticated', fn_oid, 'EXECUTE'),
           has_function_privilege('service_role',  fn_oid, 'EXECUTE')
      INTO fn_anon, fn_auth, fn_svc;

    -- C3 · THE GATE. All three bodies refuse an unauthenticated caller
    -- already (claim_username returns {ok:false,reason:'not_authenticated'};
    -- the other two RAISE) — so this assertion is the SECOND line of defence,
    -- not the first, and it is the one that is currently missing on
    -- production.
    IF fn_anon THEN
      RAISE EXCEPTION
        'C3 FAILED — anon can still EXECUTE % (oid %). acl = %',
        rec.sig, fn_oid, COALESCE(fn_acl, 'NULL (built-in default = EXECUTE TO PUBLIC)');
    END IF;

    -- C4 · THE F-62 TRAP. A `REVOKE … FROM anon` alone closes nothing while
    -- PUBLIC holds EXECUTE, because anon inherits through PUBLIC. On
    -- production all three carry PUBLIC today (Auditor baseline).
    IF fn_acl IS NULL THEN
      RAISE EXCEPTION
        'C4 FAILED — proacl is NULL on % (oid %). NULL is the BUILT-IN DEFAULT, which IS EXECUTE TO PUBLIC — not "no grants". The function has been recreated (DROP+CREATE re-applies the default, F-66) and any closure has silently reopened.',
        rec.sig, fn_oid;
    END IF;
    SELECT count(*) INTO fn_public
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
    IF fn_public > 0 THEN
      RAISE EXCEPTION
        'C4 FAILED — PUBLIC holds EXECUTE on % (oid %, % entry). Revoking from anon alone would close NOTHING here (F-62). acl = %',
        rec.sig, fn_oid, fn_public, fn_acl;
    END IF;

    -- C5 · `authenticated`, per function, in the direction that function
    -- actually wants. Not a class assertion — see the header.
    IF rec.want_auth AND NOT fn_auth THEN
      RAISE EXCEPTION
        'C5 FAILED — authenticated has LOST EXECUTE on % (oid %). This function has a real authenticated caller; the closure has overshot and a member-facing flow is broken. acl = %',
        rec.sig, fn_oid, fn_acl;
    END IF;
    IF (NOT rec.want_auth) AND fn_auth THEN
      RAISE EXCEPTION
        'C5 FAILED — authenticated holds EXECUTE on % (oid %), and it should not. The Owner removed this function''s only caller by written decision (src/pages/EditProfile.tsx:563-578). acl = %',
        rec.sig, fn_oid, fn_acl;
    END IF;

    -- C6 · service_role retained. Nothing in this group is closed to the
    -- backend.
    IF NOT fn_svc THEN
      RAISE EXCEPTION 'C6 FAILED — service_role has lost EXECUTE on % (oid %). acl = %', rec.sig, fn_oid, fn_acl;
    END IF;

    -- C7 · the object is still the object the closure was reasoned about.
    -- SECURITY DEFINER is why the grant is the whole control (RLS is bypassed
    -- entirely), and VOLATILE is why it is in P32's population at all.
    IF NOT fn_secdef THEN
      RAISE EXCEPTION 'C7 FAILED — % (oid %) is no longer SECURITY DEFINER. The premise of this closure has changed.', rec.sig, fn_oid;
    END IF;
    IF fn_volatile <> 'v' THEN
      RAISE EXCEPTION 'C7 FAILED — % (oid %) is no longer VOLATILE (provolatile=%).', rec.sig, fn_oid, fn_volatile;
    END IF;

    RAISE NOTICE '% ........ PASS (oid %, anon=false, public_entries=0, authenticated=%, service_role=true, SECURITY DEFINER, VOLATILE, schema=public)',
      rpad(rec.sig, 44), fn_oid, fn_auth;
  END LOOP;

  IF checked <> 3 THEN
    RAISE EXCEPTION 'GUARD FAILED — expected to check exactly 3 functions, checked %. The VALUES list was edited without updating this guard, or a signature failed to resolve silently.', checked;
  END IF;

  RAISE NOTICE '--- ALL ASSERTIONS PASSED for all 3 Set A functions on lane %. Nothing was written. ---', current_database();
  RAISE NOTICE '    Not tested here: PostgREST HTTP exposure (F-53), and calling any of the three (all VOLATILE, all write profiles/custom_url_history).';
END
$probe$;

-- Belt and braces: this file must never be able to change anything, even if a
-- future edit to the block above introduces a write by accident.
ROLLBACK;
