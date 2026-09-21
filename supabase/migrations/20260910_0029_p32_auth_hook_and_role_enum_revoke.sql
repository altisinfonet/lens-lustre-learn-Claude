-- ═══════════════════════════════════════════════════════════════════════════
-- P32, SESSION A NEW UNIT — password_verification_hook + get_public_role_user_ids
--
-- Two functions closed by this file, both new findings from Session A's own
-- 2026-09-21 forensic re-check (not carried over from any prior PR/census):
--
--   public.password_verification_hook(jsonb)   — Supabase Auth Hook
--   public.get_public_role_user_ids(text)       — STABLE, SECURITY DEFINER
--
-- Measured live on staging (fpszggreishhuvdpkmdr), 2026-09-21, this session,
-- before this migration:
--
--   password_verification_hook: {public=true, anon=true, authenticated=true,
--                                 supabase_auth_admin=true}
--   get_public_role_user_ids:   {public=true, anon=true, authenticated=true}
--     (provolatile='s' — STABLE, not VOLATILE, which is why this function is
--      absent from the 75-function anon-executable-VOLATILE census this
--      session built and from every prior P32 count; the F-62/F-65/F-66
--      pattern is volatility-independent and applies here identically.)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- FINDING 1 (NEW, ELEVATED SEVERITY) — password_verification_hook
--
-- This is a Supabase Auth "Password Verification" hook: GoTrue invokes it
-- server-side, as `supabase_auth_admin`, on every sign-in attempt, and acts
-- on its `{"decision": "continue"|"reject", ...}` response to allow or block
-- the sign-in. Its body (confirmed via pg_get_functiondef, this session):
--
--   DECLARE _uid uuid := (event->>'user_id')::uuid;
--           _valid boolean := COALESCE((event->>'valid')::boolean, false);
--   ...
--   SELECT * INTO _row FROM public.auth_login_attempts WHERE user_id = _uid
--     FOR UPDATE;
--   IF _row.locked_until IS NOT NULL AND _row.locked_until > now() THEN
--     RETURN jsonb_build_object('decision','reject', ...);
--   END IF;
--   IF _valid THEN
--     DELETE FROM public.auth_login_attempts WHERE user_id = _uid;
--     RETURN jsonb_build_object('decision','continue');
--   END IF;
--   -- failed attempt: increment failed_count, lock at 3/5/7/10 strikes ...
--
-- `_uid` and `_valid` are read DIRECTLY off the caller-supplied `event`
-- argument with NO verification that the caller is GoTrue itself and no
-- check that `_uid` is the authenticated caller's own id. Today, anon and
-- authenticated both hold EXECUTE (measured above), so this is directly
-- callable over PostgREST as `rpc/password_verification_hook` by any holder
-- of the public API key, with an arbitrary `user_id` and an arbitrary
-- `valid`. Two distinct abuses follow directly from the body, not from
-- speculation:
--
--   (a) DoS lockout: call repeatedly with `{"user_id": "<victim>",
--       "valid": false}` to drive `failed_count` past 10 and lock the
--       victim's account for 900s, indefinitely renewable, with zero
--       knowledge of the victim's password and zero real sign-in attempts —
--       `auth_login_attempts` is written directly, not incremented by
--       GoTrue's own failed-password path.
--   (b) Lockout/counter clearing: call with `{"user_id": "<any-id>",
--       "valid": true}` to DELETE that id's `auth_login_attempts` row,
--       silently discarding another account's accumulated failed-attempt
--       history (undermines the rate-limit this function exists to
--       enforce, for any account, not just the caller's own).
--
-- Neither requires the caller to be signed in as, or ever have attempted to
-- sign in as, the target user. This is the same class of finding as F-62/
-- F-65/F-66 elsewhere in P32 (a SECURITY DEFINER function reachable well
-- beyond its intended caller), but the intended caller here is not "any
-- authenticated member" the way most of P32's other findings are — it is
-- GoTrue alone, running as `supabase_auth_admin`. `authenticated` should
-- never have held EXECUTE either; this file revokes PUBLIC, anon, AND
-- authenticated, retaining only `supabase_auth_admin` (which already holds
-- it and is untouched by this file).
--
-- This finding, its severity, and its fix are Session A's own; the finding
-- is new as of 2026-09-21 and does not appear in P1-revocation-list.md,
-- GATE_REGISTER.md, or any of the P32 census docs this session read. Flagged
-- for Auditor awareness in the accompanying evidence doc, but the fix itself
-- is a standard grant closure (no body change, no behaviour change for
-- GoTrue/supabase_auth_admin) and does not require an Owner/Auditor ruling
-- to apply, per the same reasoning already used throughout P32 for
-- grant-only closures.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- FINDING 2 — get_public_role_user_ids(text)
--
-- Body (confirmed via pg_get_functiondef, this session):
--
--   IF _role NOT IN ('admin', 'judge') THEN
--     RAISE EXCEPTION 'role % is not enumerable', _role USING ERRCODE = '42501';
--   END IF;
--   RETURN QUERY SELECT ur.user_id FROM public.user_roles ur
--     WHERE ur.role::text = _role;
--
-- This has a genuine allow-list (confirms P1-revocation-list.md §2.4's own
-- prior read of this function as "not actually a gap" — re-verified here,
-- not merely copied). It cannot be used to enumerate arbitrary roles or
-- arbitrary user attributes; only the `admin` and `judge` user-id lists are
-- obtainable, and no anon-side caller in src/ was found needing that (grep
-- this session, zero references in src/ or supabase/functions/). It is body-
-- guarded, so this is a defense-in-depth closure — same pattern as the
-- 14 admin/fix/backfill/get_*_admin functions already closed elsewhere in
-- P32 — not a live-exploit fix. `authenticated` is retained: legitimate
-- admin/judge callers are authenticated callers, and revoking authenticated
-- here would break any real admin/judge-facing caller of this RPC without
-- the allow-list itself changing.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SEQUENCE — BEHAVIOUR step, grant-only, idempotent, same F-62 order (PUBLIC
-- before anon) as every other P32 unit. No body touched, no DROP/CREATE.

REVOKE ALL ON FUNCTION public.password_verification_hook(jsonb) FROM public;
REVOKE ALL ON FUNCTION public.password_verification_hook(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.password_verification_hook(jsonb) FROM authenticated;
-- supabase_auth_admin's EXECUTE is untouched by the three revokes above and
-- is not re-granted here because it already holds it (measured above).

REVOKE ALL ON FUNCTION public.get_public_role_user_ids(text) FROM public;
REVOKE ALL ON FUNCTION public.get_public_role_user_ids(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_public_role_user_ids(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.password_verification_hook(jsonb) IS
  'Supabase Auth "Password Verification" hook. Invoked by GoTrue, as supabase_auth_admin, on every sign-in. NOT executable by public, anon, or authenticated — P32, Session A finding 2026-09-21. Prior state allowed any anon/authenticated caller to lock or unlock an arbitrary user_id''s sign-in via a direct rpc/password_verification_hook call (event->>''user_id'' is caller-controlled, unverified against the caller''s own identity). Closed at the grant layer; body unchanged. If recreated with DROP+CREATE this REOPENS to PUBLIC (F-66) and the revoke must be re-applied and re-proved.';

COMMENT ON FUNCTION public.get_public_role_user_ids(text) IS
  'Enumerates user_ids for a role, allow-listed in-body to admin/judge only (RAISE 42501 otherwise) — P1-revocation-list.md §2.4, re-verified 2026-09-21. NOT executable by anon or public — P32 defense-in-depth closure (grant-layer only; the body allow-list is unchanged and unrelied-upon for this fix). authenticated retained: real admin/judge callers are authenticated. Same F-62/F-66 caveats as elsewhere in P32.';
