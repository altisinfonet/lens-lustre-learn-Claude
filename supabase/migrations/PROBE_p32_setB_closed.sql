-- ═══════════════════════════════════════════════════════════════════════════
-- P32 · SET B GATE PROBE — the 23 both-lanes-open SECURITY DEFINER functions
-- whose proposed retention closes anon, asserted closed to PUBLIC and anon.
-- READS ONLY. Ends in ROLLBACK. Calls nothing.
--
-- ⚠ AUTHORED TO FAIL TODAY, AND THAT IS THE POINT. Work order §4.5: each
-- probe "must be shown failing against the current open state before it is
-- accepted" (C-34 — a test that could not have failed is not evidence). All
-- 23 read `anon=X/postgres` with a PUBLIC entry on staging, verified
-- read-only 2026-09-22T05:31Z. The fail-first transcript is
-- docs/evidence/d1/phase1/probe-fail-first-20260922.txt.
--
-- ⚠ SET B HAS 30 ROWS AND THIS PROBE ASSERTS 23 OF THEM. The other SEVEN are
-- excluded BY NAME, because asserting `anon = false` on them would encode a
-- disposition nobody has ruled:
--
--   public.get_broadcast_feed(uuid[], integer)                          ┐ Owner
--   public.get_broadcast_feed(uuid[], integer, integer)                 │ decision
--   public.get_broadcast_feed(uuid[], integer, integer, text[])         ┘ pending
--       — is a signed-out feed a planned surface? No current caller needs
--         anon (the only caller, useFeedQuery.ts:91, is behind Feed.tsx:89's
--         /login redirect), but the 4-arg body carries an explicit
--         coalesce(auth.uid()::text,'anon') branch, i.e. an anonymous viewer
--         is a designed-for case. Unresolved, so unasserted.
--   public.increment_managed_page_view(text)
--       — Owner decision: should a public page count signed-out visitors?
--         Its only caller IS anon-reachable (/page/:slug, App.tsx:418).
--   public.log_app_event(...)   public.log_client_error(...)
--       — intentional public telemetry; closing anon blinds the signed-out
--         and sign-in-failure paths SILENTLY (both call sites are
--         fire-and-forget). To be ruled on TOGETHER, per D2 §10 item 3.
--   public.record_test_agent_run(...)
--       — CI posts with the anon key by design, token-checked against Vault.
--
-- Excluding them is not an omission; it is the probe declining to assert a
-- state that has not been decided. 23 + 7 = 30 and the guard below counts 23.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THE GATE'S OWN RULE — docs/gates/P1-revocation-list.md §1, frozen:
--   "A closure is proved per function, by
--    has_function_privilege('anon', <oid>, 'EXECUTE') = false, on the lane it
--    is claimed for. No gate on this list may be written against a *class*."
--
-- ⚠ `authenticated` IS ASSERTED PER FUNCTION, IN BOTH DIRECTIONS. Seventeen of
-- the 23 have a real authenticated caller and must KEEP it — revoking it
-- would break an admin screen or a member flow, which is the failure mode the
-- Auditor named: "revoking a grant the app still calls turns a security fix
-- into an outage." Six have no client-role caller at all (reached only from a
-- trigger function, an outer SECURITY DEFINER function, or nothing) and must
-- NOT keep it. A single class-wide assertion would be wrong for one group or
-- the other. want_auth carries the per-function answer and C5 tests it both
-- ways.
--
-- ⚠ WHAT THIS PROBE DOES NOT PROVE.
--   · It does not prove the SIX body-level defects are fixed. A grant closure
--     is not a fix for judging_write_decision_atomic (no identity check at
--     all; anon-appendable db_audit_logs with changed_by = NULL) or for
--     increment_managed_page_view. Those need their own probes against their
--     own migrations. This file would pass with both defects intact.
--   · It does not call any function (all 23 are VOLATILE; several write).
--   · It does not exercise /rest/v1/rpc over HTTP (F-53).
--   · It does not re-derive caller safety — that is
--     docs/evidence/d1/phase1/d2-caller-evidence-verification.md, which found
--     SEVEN objects where the 2026-09-21 D2 inventory reported "no caller"
--     and a real caller exists. Three of those seven are asserted here.
--
-- ⚠ THIS FILE AUTHORISES NOTHING. P1-revocation-list.md Revision 2 clears
-- exactly one object, `email_exists(text)`, and none of the 23 is it. No
-- REVOKE for any Set B object exists in this unit, by instruction (§5).
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
  RAISE NOTICE '--- P32 Set B gate probe: 23 of 30 both-lanes-open definer functions @ % UTC ---',
    to_char(clock_timestamp() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  RAISE NOTICE '    lane database: %', current_database();

  FOR rec IN
    -- sig · exact type-only signature (to_regprocedure cannot then resolve an
    --       unintended overload).
    -- want_auth · true where a real authenticated caller exists and the grant
    --       must survive the closure; false where none does.
    SELECT * FROM (VALUES
      -- ── authenticated RETAINED · real session-gated caller, file:line in
      --    docs/evidence/d1/phase1/p32-remediation-matrix.md
      ('public.admin_flag_entry_for_review(uuid)',                            true ),
      ('public.admin_search_users(text, text)',                               true ),
      ('public.admin_set_photo_rejected(uuid, integer, boolean, text)',        true ),
      ('public.apply_decision_to_remaining(uuid, integer, text)',              true ),
      ('public.backfill_judging_notifications(integer, boolean)',              true ),
      ('public.backfill_tag_decision_drift_admin()',                           true ),
      ('public.fix_certificate_readiness_admin(uuid)',                         true ),
      ('public.fix_gift_drift_admin(uuid)',                                    true ),
      ('public.fix_referral_drift_admin(uuid)',                                true ),
      ('public.get_certificate_drift_admin(uuid)',                             true ),
      ('public.get_derived_status_drift_admin()',                              true ),
      ('public.get_judge_collusion_admin(uuid, integer, numeric)',             true ),
      ('public.get_judging_tag_assignment_counts()',                           true ),
      ('public.register_push_token(text, text)',                               true ),
      ('public.request_withdrawal(numeric, jsonb)',                            true ),
      ('public.submit_competition_entry(uuid, text, text, text[], text[], jsonb, boolean, jsonb)', true ),
      ('public.unregister_push_token(text)',                                   true ),
      -- ── authenticated NOT retained · no client-role caller anywhere. Each
      --    is reached only as a definer (trigger function or outer function),
      --    which does not consult the caller's grant, or by nothing at all.
      ('public._gen_competition_order_no()',                                   false),  -- inner: submit_competition_entry; nextval side effect
      ('public.admin_rewind_stage(uuid, text, text)',                          false),  -- inner: guard_stage_key_immutability (trigger fn)
      ('public.judging_write_decision_atomic(uuid, text, text)',               false),  -- edge/service_role only. BODY DEFECT UNFIXED — see header
      ('public.recompute_entry_from_tag_assignments(uuid)',                    false),  -- body is `BEGIN RETURN; END;` — disposition owed
      ('public.recompute_entry_public_status(uuid)',                           false),  -- inner: 4 trigger functions
      ('public.set_write_path(text)',                                          false)   -- no caller at all; transaction-local set_config
    ) AS t(sig, want_auth)
  LOOP
    -- C1 · the signature still resolves to exactly one function.
    fn_oid := to_regprocedure(rec.sig)::oid;
    IF fn_oid IS NULL THEN
      RAISE EXCEPTION 'C1 FAILED — % does not resolve to exactly one function. This gate closes a grant; it drops and renames nothing, so a missing signature means the object moved underneath the closure.', rec.sig;
    END IF;

    SELECT p.proacl::text, p.prosecdef, p.provolatile, n.nspname
      INTO fn_acl, fn_secdef, fn_volatile, fn_schema
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.oid = fn_oid;

    checked := checked + 1;

    -- C2 · schema.
    IF fn_schema <> 'public' THEN
      RAISE EXCEPTION 'C2 FAILED — % (oid %) lives in schema %, expected public.', rec.sig, fn_oid, fn_schema;
    END IF;

    SELECT has_function_privilege('anon',          fn_oid, 'EXECUTE'),
           has_function_privilege('authenticated', fn_oid, 'EXECUTE'),
           has_function_privilege('service_role',  fn_oid, 'EXECUTE')
      INTO fn_anon, fn_auth, fn_svc;

    -- C3 · THE GATE.
    IF fn_anon THEN
      RAISE EXCEPTION
        'C3 FAILED — anon can still EXECUTE % (oid %). acl = %',
        rec.sig, fn_oid, COALESCE(fn_acl, 'NULL (built-in default = EXECUTE TO PUBLIC)');
    END IF;

    -- C4 · THE F-62 TRAP. Every one of the 23 carries the leading
    -- `=X/postgres` PUBLIC entry today, so `REVOKE … FROM anon` alone closes
    -- NOTHING. PUBLIC must be revoked first and this assertion is what proves
    -- it was.
    IF fn_acl IS NULL THEN
      RAISE EXCEPTION
        'C4 FAILED — proacl is NULL on % (oid %). NULL is the BUILT-IN DEFAULT, which IS EXECUTE TO PUBLIC — not "no grants". The function has been recreated (DROP+CREATE re-applies the default, F-66) and this closure has silently reopened.',
        rec.sig, fn_oid;
    END IF;
    SELECT count(*) INTO fn_public
      FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
    IF fn_public > 0 THEN
      RAISE EXCEPTION
        'C4 FAILED — PUBLIC holds EXECUTE on % (oid %, % entry). anon inherits through PUBLIC (F-62). acl = %',
        rec.sig, fn_oid, fn_public, fn_acl;
    END IF;

    -- C5 · `authenticated`, per function, in the direction that function
    -- wants. Overshoot and undershoot are different failures and get
    -- different messages, because they need different fixes.
    IF rec.want_auth AND NOT fn_auth THEN
      RAISE EXCEPTION
        'C5 FAILED (OVERSHOOT) — authenticated has LOST EXECUTE on % (oid %). This function has a real authenticated caller; a member or admin screen is now broken. This is the outage mode, not the security mode. acl = %',
        rec.sig, fn_oid, fn_acl;
    END IF;
    IF (NOT rec.want_auth) AND fn_auth THEN
      RAISE EXCEPTION
        'C5 FAILED (UNDERSHOOT) — authenticated still holds EXECUTE on % (oid %), and no authenticated caller exists for it. acl = %',
        rec.sig, fn_oid, fn_acl;
    END IF;

    -- C6 · service_role retained on all 23. Several are reached only from
    -- edge functions or cron; closing the backend would be the real outage.
    IF NOT fn_svc THEN
      RAISE EXCEPTION 'C6 FAILED — service_role has lost EXECUTE on % (oid %). acl = %', rec.sig, fn_oid, fn_acl;
    END IF;

    -- C7 · the object is still the object the closure was reasoned about.
    IF NOT fn_secdef THEN
      RAISE EXCEPTION 'C7 FAILED — % (oid %) is no longer SECURITY DEFINER. The premise of this closure has changed — RLS no longer being bypassed means the WHERE clause is no longer the only control.', rec.sig, fn_oid;
    END IF;
    IF fn_volatile <> 'v' THEN
      RAISE EXCEPTION 'C7 FAILED — % (oid %) is no longer VOLATILE (provolatile=%). It has left P32''s population and this assertion no longer describes it.', rec.sig, fn_oid, fn_volatile;
    END IF;

    RAISE NOTICE '% ........ PASS (oid %, anon=false, public_entries=0, authenticated=%, service_role=true)',
      rpad(rec.sig, 76), fn_oid, fn_auth;
  END LOOP;

  IF checked <> 23 THEN
    RAISE EXCEPTION 'GUARD FAILED — expected to check exactly 23 functions, checked %. The VALUES list was edited without updating this guard, or a signature failed to resolve silently. Set B is 30 rows; 7 are deliberately excluded and named in the header.', checked;
  END IF;

  RAISE NOTICE '--- ALL ASSERTIONS PASSED for 23 of Set B''s 30 rows on lane %. Nothing was written. ---', current_database();
  RAISE NOTICE '    STILL OPEN BY DESIGN, NOT BY OVERSIGHT: get_broadcast_feed x3, increment_managed_page_view, log_app_event, log_client_error, record_test_agent_run — all awaiting an Owner ruling.';
  RAISE NOTICE '    STILL UNFIXED: the six body-level defects. This probe passing does NOT mean judging_write_decision_atomic or the judging-lock group are safe.';
END
$probe$;

-- Belt and braces: this file must never be able to change anything, even if a
-- future edit to the block above introduces a write by accident.
ROLLBACK;
