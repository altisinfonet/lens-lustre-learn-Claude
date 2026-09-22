-- ═══════════════════════════════════════════════════════════════════════════
-- P32 · UNIT 0033 — request_withdrawal(numeric, jsonb) closed to PUBLIC and
-- anon. ONE object. Set B — open on BOTH lanes.
--
-- ⚠ ORDINAL. `0033` is allocated by the Auditor under R-7. Not self-selected.
--
-- ⚠ WHY THIS IS ITS OWN FILE. PR #274's `0027` bundled this Set B object with
-- ten Set C ones. Set B and Set C have DIFFERENT LANE PROFILES, and the
-- difference lands entirely on the rollback: Set C is already closed on
-- production, Set B is open on both lanes but with a different ACL shape on
-- each. One file for both classes means one rollback for two hazards. Split.
--
-- ─────────────────────────────────────────────────────────────────────────
-- MEASURED STARTING ACL — the two lanes DIFFER, and that is load-bearing.
--
-- STAGING fpszggreishhuvdpkmdr — SELECT only, 2026-09-22T06:45Z, re-derived
-- this session, NOT inherited from #274:
--   =X/postgres | postgres=X/postgres | anon=X/postgres |
--   authenticated=X/postgres | service_role=X/postgres
--   PUBLIC EXECUTE entries = 1 · prosecdef = true · provolatile = 'v'
--
-- PRODUCTION jtdtehuqtinjxropkkcn — RELAYED from the work order §3 and the
-- Auditor's two-lane diff. **Not measured by this session**: `list_projects`
-- returns staging alone, re-verified 2026-09-22T06:45Z, and a developer
-- session never handles a connection string (skill §10).
--   postgres | authenticated | service_role | anon      PUBLIC = **NO**
--
-- So: production already lacks PUBLIC and this file's first statement is a
-- no-op there; its second statement (anon) is the real change on that lane.
-- The reverse is true on staging, where anon inherits through PUBLIC.
--
-- ─────────────────────────────────────────────────────────────────────────
-- F-62 — PUBLIC FIRST. On staging `REVOKE ... FROM anon` alone would close
-- NOTHING, because the leading `=X/postgres` grants EXECUTE to every role.
-- F-66 — no DROP, no CREATE, no body change; nothing re-applies the built-in
-- default, so the closure cannot silently reopen inside this file.
-- IDEMPOTENCE — REVOKE and GRANT are idempotent; re-running is a no-op.
--
-- CALLER EVIDENCE — `authenticated` is REQUIRED and is restored explicitly.
-- One production caller, measured 2026-09-22T05:35Z across src/, functions/,
-- supabase/functions/ and scripts/:
--   src/hooks/wallet/useWalletWithdrawals.ts:46 — an authenticated member
--   hook. Revoking `authenticated` here would break member withdrawals.
-- The body self-guards as well (`v_user_id uuid := auth.uid();` then
-- `RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'`), so this
-- closure is the second line of defence, not the only one. It is still worth
-- having: a definer function reachable by anon is a door, guarded or not.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE ALL ON FUNCTION public.request_withdrawal(_amount numeric, _bank_details jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_withdrawal(_amount numeric, _bank_details jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(_amount numeric, _bank_details jsonb) TO authenticated, service_role;

COMMIT;
