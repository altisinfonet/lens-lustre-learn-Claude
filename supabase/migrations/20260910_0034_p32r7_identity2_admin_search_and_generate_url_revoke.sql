-- ═══════════════════════════════════════════════════════════════════════════
-- P32 · UNIT 0034 — identity group 2. Four Set C objects closed to PUBLIC and
-- anon.
--
-- Set C. Not authorized for dispatch pending Owner Decision 1 (Appendix D ACL
-- posture). Prepared under Auditor allocation R-7.
--
-- ⚠ ORDINAL. `0034` is allocated by the Auditor under R-7. Not self-selected.
-- Replaces PR #274's `0028`, minus the Set B object it wrongly bundled
-- (`admin_search_users`, now `0035` with its own two-lane rollback).
--
-- ─────────────────────────────────────────────────────────────────────────
-- MEASURED STARTING ACL — staging fpszggreishhuvdpkmdr, SELECT only,
-- 2026-09-22T06:45Z. Re-derived this session; NOT inherited from #274.
-- All four, identical:
--   =X/postgres | postgres=X/postgres | anon=X/postgres |
--   authenticated=X/postgres | service_role=X/postgres
--   prosecdef = true · provolatile = 'v' · PUBLIC EXECUTE entries = 1
--
-- PRODUCTION: all four already closed (RELAYED — production is not attached
-- to this session's connector; BLOCKER-B). This file is a no-op there.
--
-- F-62 — PUBLIC first, every time; anon inherits through it.
-- F-66 — no DROP, no CREATE, no body change.
-- IDEMPOTENCE — REVOKE and GRANT are idempotent; re-running is a no-op.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHY THIS GROUP. Three of the four answer a question about a named person —
-- certificate recipients, member search by e-mail, certificate holders — and
-- the platform rule is explicit: never grant EXECUTE to anon on anything that
-- does. The fourth mints a member's public URL.
--
-- ⚠ THREE OF THESE FOUR WERE RECORDED AS "NO CALLER" AND THAT WAS WRONG.
-- D2's 2026-09-21 inventory §3a lists `admin_list_certificates`,
-- `admin_search_certificate_recipients` and `admin_search_users_v2` as having
-- no caller anywhere. All three have real authenticated callers, measured
-- 2026-09-22T05:35Z and confirmed by reading the files:
--   admin_list_certificates              src/components/admin/AdminCertificates.tsx:148
--   admin_search_certificate_recipients  src/components/admin/AdminCertificates.tsx:260
--   admin_search_users_v2                src/components/admin/AdminUsers.tsx:277
-- All three use the cast-inside-the-parens call shape
-- `(supabase.rpc as unknown as (…))("name", …)`, which defeats a
-- backward-scanning classifier. Full account:
-- docs/evidence/d1/phase1/d2-caller-evidence-verification.md §3.
--
-- **The consequence for this file is concrete.** A closure written on the
-- "no caller" premise would have revoked `authenticated` from all three and
-- broken three admin screens with a 42501 and no warning. `authenticated` is
-- retained and restored explicitly below.
--
-- generate_custom_url has no application caller — confirmed by grep across
-- src/, functions/, supabase/functions/ and scripts/ at 2026-09-22T05:33:08Z
-- (a zero is only true at the moment it is taken). It has one live inner
-- caller, the trigger function `tg_profiles_assign_custom_url`. An inner call
-- from a trigger function runs AS THE DEFINER and never consults the caller's
-- grant, so this revoke cannot break it. `authenticated` is retained anyway,
-- for the reason given in `0032`'s header: within a unit whose gate is the
-- anonymous door, an unnecessary named grant breaks nothing and a wrongly
-- removed one is an outage. Recorded for the Auditor as a candidate for a
-- later, separately-gated tightening.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1 · admin_list_certificates — authenticated admin caller AdminCertificates.tsx:148
REVOKE ALL ON FUNCTION public.admin_list_certificates(_query text, _type text, _limit integer, _offset integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_certificates(_query text, _type text, _limit integer, _offset integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_certificates(_query text, _type text, _limit integer, _offset integer) TO authenticated, service_role;

-- 2 · admin_search_certificate_recipients — authenticated admin caller AdminCertificates.tsx:260
REVOKE ALL ON FUNCTION public.admin_search_certificate_recipients(_query text, _limit integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_certificate_recipients(_query text, _limit integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_search_certificate_recipients(_query text, _limit integer) TO authenticated, service_role;

-- 3 · admin_search_users_v2 — authenticated admin caller AdminUsers.tsx:277
REVOKE ALL ON FUNCTION public.admin_search_users_v2(_query text, _by text, _role text, _badge text, _limit integer, _offset integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_users_v2(_query text, _by text, _role text, _badge text, _limit integer, _offset integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_search_users_v2(_query text, _by text, _role text, _badge text, _limit integer, _offset integer) TO authenticated, service_role;

-- 4 · generate_custom_url — no application caller; reached as definer from the
--     trigger function tg_profiles_assign_custom_url, which needs no grant.
REVOKE ALL ON FUNCTION public.generate_custom_url(_full_name text, _user_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_custom_url(_full_name text, _user_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.generate_custom_url(_full_name text, _user_id uuid) TO authenticated, service_role;

COMMIT;
