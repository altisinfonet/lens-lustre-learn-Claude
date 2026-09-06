-- ═══════════════════════════════════════════════════════════════════════════
-- F-105c — THE FRIEND GRAPH IS NOT ANONYMOUSLY READABLE. REVOKE ONLY.
--
-- THREE FUNCTIONS, ONE DOORWAY, AND THEY ARE NOT EQUALLY DANGEROUS. They were
-- read one at a time; the family resemblance is not the evidence.
--
--   mutual_friend_ids(uuid, uuid, integer)  -> the friend IDS in common
--   mutual_friends_count(uuid, uuid)        -> the SIZE of that intersection
--   are_friends(uuid, uuid)                 -> a single edge, yes or no
--
-- All three are SECURITY DEFINER over public.friendships with RLS bypassed, all
-- three take TWO identities as arguments, and none of them contains the string
-- auth.uid(). All three carry the empty-grantee entry `=X/postgres` on BOTH
-- lanes, so PUBLIC holds EXECUTE and an anonymous caller holding only the
-- publishable key can call them. Verified from pg_proc.proacl on production and
-- staging, and over real anonymous HTTP on staging (see the probe).
--
-- ⚠ are_friends IS THE ONE TO WORRY ABOUT, not mutual_friend_ids, and that is
-- the opposite of how they look. mutual_friend_ids leaks an intersection for a
-- pair you already chose. are_friends answers ONE BIT about ONE EDGE, which is
-- the cleanest possible primitive for reconstructing the WHOLE graph: given N
-- member ids, N(N-1)/2 calls returns every friendship on the lane. Member ids
-- are obtainable from the public profile data. On production that is 94
-- accepted friendships across 20 distinct requesters, readable by anyone.
--
-- WHY A REVOKE CANNOT BREAK THE APP — checked per function, not assumed
--
--   * NO RLS POLICY references any of the three. Measured: 0, 0 and 0 rows in
--     pg_policies. (Contrast has_role, which 175 policies across 116 tables
--     depend on — that one is NOT in this migration and must not be, because
--     revoking it would take the RLS layer down. Different finding, different
--     fix, deliberately not bundled here.)
--   * mutual_friend_ids and mutual_friends_count are called by NO other
--     database function (0 and 0) and from three client sites each, every one
--     of which passes the caller's own id as _user_a.
--   * are_friends IS called by two database functions, can_view_post and
--     get_profile_visible_fields. BOTH are SECURITY DEFINER, so inside them
--     current_user is the owner and the EXECUTE check on are_friends is made
--     against the owner, not against the anonymous caller. Revoking anon does
--     not affect them.
--   * are_friends has one client call site, useProfileData.ts:69, inside
--     fetchProfileExtended. Its hook is `enabled: !!userId && !!currentUserId`,
--     so it NEVER fires for a signed-out visitor. The anon-safe path is
--     useProfileCore, which does not call it.
--
-- authenticated KEEPS EXECUTE on all three. This migration closes the
-- ANONYMOUS door only. Restricting _user_a to auth.uid() is the second step:
-- it changes the signature, so it is a DROP+CREATE and it touches D2's three
-- call sites. Deliberately not done here — one change, one migration.
--
-- WHY `FROM PUBLIC, anon` AND WHY PUBLIC IS NAMED FIRST
--
-- F-62/F-98. The empty grantee IS the finding: `REVOKE ... FROM anon` alone
-- would delete anon's own entry, leave `=X/postgres` standing, and the function
-- would still be callable by anon THROUGH PUBLIC. The catalogue would look
-- changed and nothing would be. That is the exact defect F-98 was, on three
-- more functions.
--
-- VERIFICATION IS pg_proc.proacl WITH THE EMPTY-GRANTEE ENTRY ABSENT.
-- has_function_privilege cannot distinguish a direct grant from an inherited
-- one and reported F-98's revoke as done when it was not (C-89).
-- ═══════════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION public.mutual_friend_ids(uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mutual_friends_count(uuid, uuid)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.are_friends(uuid, uuid)                FROM PUBLIC, anon;

COMMENT ON FUNCTION public.mutual_friend_ids(uuid, uuid, integer) IS
  'Friends in common between two members. SIGNED-IN ONLY (F-105c): revoked from PUBLIC and anon. SECURITY DEFINER over friendships with no auth.uid() check, so an anonymous caller could read any pair''s mutual friends. _user_a is still trusted from the argument — restricting it to auth.uid() is the second step and changes the signature.';

COMMENT ON FUNCTION public.mutual_friends_count(uuid, uuid) IS
  'Size of the mutual-friend intersection between two members. SIGNED-IN ONLY (F-105c): revoked from PUBLIC and anon. Same doorway as mutual_friend_ids, leaking the count rather than the identities.';

COMMENT ON FUNCTION public.are_friends(uuid, uuid) IS
  'Whether two members are accepted friends. SIGNED-IN ONLY (F-105c): revoked from PUBLIC and anon. One bit per edge is the cleanest primitive for reconstructing the entire friend graph — N(N-1)/2 calls over ids taken from public profile data. Its two database callers, can_view_post and get_profile_visible_fields, are SECURITY DEFINER and are unaffected; its one client call site is auth-gated.';
