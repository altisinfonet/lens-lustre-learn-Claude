-- F-98 — the revoke read as done and was not done. F-62 again, on new
-- functions, by the author who quoted F-62 in a migration header the same day.
--
-- ═══ WHAT THE CATALOGUE ACTUALLY SAID AFTER 0011 APPLIED ═══
--   clear_custom_url   =X/postgres | postgres=X/postgres |                 | service_role=X/postgres
--   change_custom_url  =X/postgres | postgres=X/postgres | authenticated=X | service_role=X/postgres
--   claim_username     =X/postgres | postgres=X/postgres | authenticated=X | service_role=X/postgres
--
-- The FIRST entry, `=X/postgres`, is an EMPTY GRANTEE. That is PUBLIC, and
-- PUBLIC contains anon and authenticated. 0011 revoked EXECUTE from anon and
-- from authenticated; on clear_custom_url the authenticated entry genuinely
-- disappeared, which is why the change LOOKED applied. But PUBLIC still held
-- EXECUTE, so every member could still call clear_custom_url — the exact state
-- the Owner's rule forbids — and anon could still call all three.
--
-- Postgres grants EXECUTE to PUBLIC by default on every function created.
-- Revoking the named roles leaves that default untouched. This is P30
-- ("revoke email_exists FROM public AND anon") on different functions.
--
-- ⚠ has_function_privilege() CANNOT SEE THIS. It answers "can this role
-- execute?", which is TRUE whether the grant is direct or inherited through
-- PUBLIC. Both the developer and the auditor verified with it and both were
-- told the revoke had worked. THE ACL IS THE INSTRUMENT; has_function_privilege
-- IS THE SUMMARY. Verify with pg_proc.proacl and require the `=X/...` entry to
-- be GONE.
--
-- ⚠ THE CORRECT FORM WAS ALREADY IN THIS REPO, IN MY OWN FILE. Unit 2 wrote
--     REVOKE ALL ON FUNCTION public.generate_custom_url(text,uuid)
--       FROM public, anon, authenticated;
-- and generate_custom_url is the ONLY one of the sixteen functions touched
-- tonight with zero PUBLIC entries. The word `public` in that list is the
-- whole difference. Unit 6 omitted it.

REVOKE EXECUTE ON FUNCTION public.clear_custom_url()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.change_custom_url(text)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_username(text)      FROM PUBLIC, anon, authenticated;

-- Re-grant ONLY what must stay member-callable. clear_custom_url gets nothing:
-- it is privileged-only by the Auditor's ruling, because a member-callable
-- clear manufactures the have-no-handle state the Owner forbade, and after
-- F-92/F-95 there is no id address to fall back on.
GRANT EXECUTE ON FUNCTION public.change_custom_url(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_username(text)    TO authenticated;

COMMENT ON FUNCTION public.clear_custom_url() IS
  'F-96/F-98. PRIVILEGED ONLY — not member-callable. Revoked from PUBLIC, anon and authenticated. A member-callable clear manufactures the have-no-handle state the Owner forbade, and after F-92/F-95 there is no id URL to fall back on, so clearing is not privacy but unreachability. Revoking only anon/authenticated does NOT close it: PUBLIC holds EXECUTE by default and contains both.';
