-- ROLLBACK for 20260910_0005_oi3_verify_certificate_by_token_public_only.sql — OI-3.
--
-- Restores the PUBLIC grant on public.verify_certificate_by_token(text).
--
-- ⚠ THINK BEFORE RUNNING THIS. OI-3 did not change behaviour, so a rollback
-- cannot fix a behavioural problem — there is nothing behavioural to fix. What
-- it does is RE-ARM the F-62 trap: with PUBLIC holding EXECUTE again, a future
-- `REVOKE … FROM anon` on this function becomes a silent no-op that looks like
-- it worked.
--
-- The only honest reason to run it is to restore an exact prior ACL for a
-- comparison. If public verification has broken, PUBLIC is not the cause —
-- anon's explicit grant is what serves callers, and OI-3 never touched it.
-- Check that grant first.
--
-- ⚠ PRIVILEGE-EQUIVALENT, NOT BYTE-EQUAL: GRANT TO PUBLIC appends the entry, so
-- proacl ordering may differ from before OI-3. has_function_privilege is
-- identical. Recorded rather than reworded away.
--
-- ⚠ PROBE_oi3_verify_certificate_by_token_public_removed.sql WILL FAIL AFTER
-- THIS RUNS, at assertion E3, and that is correct: the probe asserts the trap
-- is disarmed, and this re-arms it.

GRANT EXECUTE ON FUNCTION public.verify_certificate_by_token(text) TO PUBLIC;

COMMENT ON FUNCTION public.verify_certificate_by_token(text) IS
  'Public certificate verification by unguessable token. Anon-executable (the feature). ⚠ OI-3 was ROLLED BACK — PUBLIC holds EXECUTE again, so a future REVOKE ... FROM anon on this function would be a silent no-op (F-62). Re-apply supabase/migrations/20260910_0005_oi3_verify_certificate_by_token_public_only.sql once the reason for the rollback is resolved.';
