-- ROLLBACK for 20260910_0004_oi2_email_exists_authenticated_revoke.sql — OI-2.
--
-- Restores `authenticated`'s EXECUTE on public.email_exists(text).
--
-- ⚠ WHAT THIS REOPENS, STATED SO NOBODY RUNS IT CASUALLY: every signed-in
-- account regains the ability to ask, one address at a time, whether an account
-- exists. Anyone may create an account, so in practice that is the enumeration
-- oracle open again behind a turnstile. Run it only if a real caller is found
-- to need the grant — and if one is, that is a finding, because the caller set
-- was proved empty on 2026-09-05 (supabase/functions/ 114 files and functions/
-- 8 files: zero references; one runtime caller in src/, an anonymous flow).
--
-- ⚠ IT DOES NOT REOPEN anon. P30 closed that separately, and this file does not
-- touch it. Rolling OI-2 back leaves P30 standing, which is the correct
-- relationship: OI-2 is an increment on top of P30, not a replacement for it.
--
-- ⚠ HONEST NOTE ON FIDELITY, carried from P30's rollback. This restore is
-- PRIVILEGE-EQUIVALENT, NOT BYTE-EQUAL. `REVOKE` then `GRANT` re-appends
-- `authenticated` to the end of the ACL array, so proacl may order its entries
-- differently from before the migration. has_function_privilege is identical;
-- a byte comparison of proacl may not be. Recorded rather than reworded away —
-- the P30 fixture caught exactly this and the claim was corrected then.
--
-- ⚠ PROBE_oi2_email_exists_authenticated_closed.sql WILL FAIL AFTER THIS RUNS,
-- at assertion D2, and that is the correct behaviour: the probe asserts the
-- closed state, and after a rollback the state is deliberately not closed.

REVOKE ALL ON FUNCTION public.email_exists(text) FROM public;
GRANT EXECUTE ON FUNCTION public.email_exists(text) TO authenticated;

COMMENT ON FUNCTION public.email_exists(text) IS
  'Account-existence check. NOT executable by anon (P30). ⚠ OI-2 was ROLLED BACK — authenticated can EXECUTE again, and since anyone may create an account this is the account-enumeration oracle reachable behind a signup. Re-apply supabase/migrations/20260910_0004_oi2_email_exists_authenticated_revoke.sql once the reason for the rollback is resolved.';
