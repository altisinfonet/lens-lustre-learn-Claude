-- ═══════════════════════════════════════════════════════════════════════════
-- P32 · UNIT 0035 — admin_search_users(text, text) closed to PUBLIC and anon.
-- ONE object. Set B — open on BOTH lanes.
--
-- ⚠ ORDINAL. `0035` is allocated by the Auditor under R-7. Not self-selected.
--
-- ⚠ WHY THIS IS ITS OWN FILE. #274's `0028` bundled this Set B object with
-- four Set C ones whose production state is different. Same reasoning as
-- `0033`: the lane difference lands on the rollback, so the units split.
--
-- ─────────────────────────────────────────────────────────────────────────
-- MEASURED STARTING ACL — the two lanes DIFFER.
--
-- STAGING fpszggreishhuvdpkmdr — SELECT only, 2026-09-22T06:45Z:
--   =X/postgres | postgres=X/postgres | anon=X/postgres |
--   authenticated=X/postgres | service_role=X/postgres
--   PUBLIC EXECUTE entries = 1 · prosecdef = true · provolatile = 'v'
--
-- PRODUCTION jtdtehuqtinjxropkkcn — RELAYED, not measured here (BLOCKER-B):
--   postgres | anon | authenticated | service_role      PUBLIC = **NO**
--
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠ WHY THIS ONE IS WORTH CLOSING EVEN THOUGH THE BODY IS GUARDED.
-- The body does gate on role:
--   IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized';
-- so an anon caller is refused. But the function RETURNS MEMBER E-MAIL
-- ADDRESSES — its result set is `(id, email, full_name, avatar_url, bio,
-- is_suspended, suspended_until, suspension_reason, created_at)`. This is
-- precisely the class the platform rule names: never grant EXECUTE to anon on
-- "anything that answers a question about a named person". The grant is the
-- missing second control, and a single future edit to that one IF statement is
-- all that stands between the current state and an enumeration surface.
--
-- F-62 — PUBLIC first. F-66 — no DROP/CREATE. IDEMPOTENCE — REVOKE/GRANT are
-- idempotent.
--
-- CALLER EVIDENCE — `authenticated` is REQUIRED and restored explicitly.
-- One production caller, measured 2026-09-22T05:35Z:
--   src/components/AdminGiftCredit.tsx:59 — an authenticated admin surface.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE ALL ON FUNCTION public.admin_search_users(search_query text, search_by text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_users(search_query text, search_by text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_search_users(search_query text, search_by text) TO authenticated, service_role;

COMMIT;
