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

-- ---------------------------------------------------------------------------
-- THE SWEEP, over the functions this work created or replaced.
--
-- Of the 16 touched tonight, 15 carried `=X/postgres`. The two below are NOT
-- closed and that is deliberate — PUBLIC is doing real work on them, not
-- sitting there by accident:
--   * resolve_custom_url   — resolves a public profile URL for a LOGGED-OUT
--                            visitor. Revoking it breaks every shared link.
--   * username_available   — called from the signup form BEFORE anyone is
--                            authenticated.
-- Both verified to have live client call sites (3 and 1); every function below
-- has zero.
--
-- The rest are closed. On a TRIGGER function the EXECUTE grant is pointless
-- because triggers do not fire through it; on a SECURITY DEFINER helper called
-- from inside another definer it is equally pointless, because the inner call
-- runs as the owner. Pointless-but-harmless is exactly how this defect
-- propagates: the next person copies the pattern, and one day copies it onto
-- something that is not harmless. That is the whole lesson of F-98.
--
-- A schema-wide sweep for `=X/...` on every function in public is FILED as a
-- follow-up, not done here.

REVOKE EXECUTE ON FUNCTION public.custom_url_available(text, uuid)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.custom_url_ever_held(uuid)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.custom_url_slug(text)                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.custom_url_transliterate(text)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.custom_url_fold_accents(text)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.forbid_custom_url_change()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_direct_custom_url_update()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_custom_url_reject_reserved()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_profiles_assign_custom_url()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_profiles_record_custom_url_history()   FROM PUBLIC, anon, authenticated;
