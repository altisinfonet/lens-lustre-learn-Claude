#!/usr/bin/env python3
"""D1 · P32 units 0034 and 0035 — generate the apply and rollback SQL.

The signatures are NOT typed into the SQL. They come from
P32-signatures-20260925.tsv, which was transcribed from
pg_get_function_identity_arguments on staging and then VERIFIED against the
live catalogue by md5 of the sorted signature list:

    staging  md5(string_agg(sig, E'\\n' ORDER BY sig COLLATE "C") || E'\\n')
    local    awk '{printf "%s(%s)\\n",$2,$3}' … | sort | md5sum
    both     fb5307b3f330bda424d86d333fd5cab3        (52 signatures)

Run:  python3 P32-generate.py <0034|0035> <signatures.tsv> <callers.tsv> <outdir>
"""
import sys, io, os

UNIT, SIGS, CALLERS, OUTDIR = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
SIG_MD5 = "fb5307b3f330bda424d86d333fd5cab3"

rows = []
for line in io.open(SIGS, encoding='utf-8'):
    if not line.strip('\n'): continue
    u, name, args = (line.rstrip('\n').split('\t') + ['', '', ''])[:3]
    if u == UNIT: rows.append((name, args))
rows.sort(key=lambda r: (r[0], r[1]))
callers = {}
for line in io.open(CALLERS, encoding='utf-8'):
    if not line.strip(): continue
    n, c = line.rstrip('\n').split('\t', 1)
    callers[n] = c

N = len(rows)
assert N == (27 if UNIT == '0034' else 25), f"{UNIT}: expected 27/25, got {N}"

def sig(name, args): return f"public.{name}({args})"
def idsig(name, args): return f"{name}({args})"

SIG_ARRAY = ",\n".join(f"    '{idsig(n,a)}'" for n, a in rows)

if UNIT == '0034':
    STEM  = "20260910_0034_p32_service_role_only"
    TITLE = "TWENTY-SEVEN FUNCTIONS THAT NO CLIENT CALLS"
    REVOKE_FROM = "PUBLIC, anon, authenticated"
    GRANT_TO    = "service_role"
    RB_GRANT_TO = "anon, authenticated"
    AUTH_AFTER, AUTH_WORD = "false", "must NOT"
    WHY = """-- None of these twenty-seven has a client caller. Their callers are cron jobs
-- (which run as postgres), SECURITY DEFINER functions (which run as the owner,
-- so the caller's own privileges are irrelevant), or edge functions holding a
-- SUPABASE_SERVICE_ROLE_KEY. `authenticated` is therefore revoked as well as
-- anon: a signed-in member has no more business calling these than a
-- logged-out visitor does.
--
-- THE `authenticated` REVOKE IS THE PART THAT NEEDS PROVING, and it is proved
-- on the fixture: a SECURITY DEFINER wrapper owned by postgres calls one of
-- these while the session is SET ROLE authenticated, and it succeeds. That is
-- why every DEFINER and trigger caller above keeps working."""
else:
    STEM  = "20260910_0035_p32_authenticated_only"
    TITLE = "TWENTY-FIVE FUNCTIONS THAT A SIGNED-IN SESSION CALLS"
    REVOKE_FROM = "PUBLIC, anon"
    GRANT_TO    = "authenticated, service_role"
    RB_GRANT_TO = "anon"
    AUTH_AFTER, AUTH_WORD = "true", "MUST"
    WHY = """-- Each of these twenty-five is called by a signed-in screen, or by a SECURITY
-- INVOKER function or trigger that fires inside a signed-in session. `anon`
-- and PUBLIC go; `authenticated` stays, and is granted EXPLICITLY rather than
-- left in place by omission.
--
-- TWO OF THEM HAVE NO CLIENT CALLER AT ALL and are here for the invoker
-- reason alone: admin_rewind_stage (guard_stage_key_immutability) and
-- mark_expiring_post_drafts (enforce_post_draft_rules). A SECURITY INVOKER
-- trigger runs with the privileges of whoever caused the write, so revoking
-- `authenticated` from these two would break an ordinary signed-in UPDATE.
-- They are the only two SECURITY INVOKER edges in the whole catalogue for
-- these 52 functions; every other database caller is SECURITY DEFINER."""

HDR = f"""-- ═══════════════════════════════════════════════════════════════════════════
-- P32 · {TITLE}.
--
-- Ordinal {STEM.split('_p32')[0]}. One of the two units that close the P32 gate on
-- staging: 56 SECURITY DEFINER, VOLATILE, RPC-callable functions were
-- anon-executable on 2026-09-25; 0034 takes 27, 0035 takes 25, and the
-- remaining 4 are justified in writing in
-- docs/evidence/d1/phase1/p32-dispositions.md.
--
-- Every one of the 56 carried the identical ACL, measured SELECT-only:
--
--   {{=X/postgres,postgres=X/postgres,anon=X/postgres,
--    authenticated=X/postgres,service_role=X/postgres}}
--
-- The leading `=X/postgres` is the PUBLIC grant. F-62: revoking anon alone
-- would be a no-op, because anon reaches EXECUTE through PUBLIC. Every REVOKE
-- below names PUBLIC first.
--
-- A SECURITY DEFINER function runs with its owner's rights, and `postgres` on
-- Supabase is BYPASSRLS, so a grant on one of these is not moderated by RLS.
-- The grant is the control.
--
{WHY}
--
-- ── SIGNATURES ────────────────────────────────────────────────────────────
--
-- Not typed. Taken from pg_get_function_identity_arguments on staging,
-- transcribed into docs/evidence/d1/phase1/P32-{UNIT}-signatures-20260925.tsv, and
-- verified against the live catalogue by md5 of the sorted 52-signature list:
-- {SIG_MD5}, identical on both sides. This file is
-- generated from that TSV by P32-{UNIT}-generate.py; it is not hand-written.
--
-- ── NOT TOUCHED ───────────────────────────────────────────────────────────
--
-- No function body. No policy. No pg_default_acl. `postgres` and
-- `service_role` keep what they had. The rollback ships in the same PR.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── LANE ASSERTION — TWO-LANE FORM, as in 0032 (proven on staging run #79).
-- This apply closes a door, so it is meant for both lanes. It is NOT the
-- staging-only R-9 guard. It still fails closed outside the dispatch
-- workflow, which since #293 is the only thing that sets p32.lane.
DO $lane_assert$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging', 'production') THEN
    RAISE EXCEPTION
      'APPLY REFUSED — p32.lane is not asserted as staging or production (read: %). '
      'This file is meant for both lanes, but it will not run outside the dispatch '
      'workflow, which is the only thing that sets the lane and sets it from the '
      'target you chose. '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_assert$;

-- ── PRECONDITION — every signature exists and is SECURITY DEFINER. ────────
-- Resolved by matching proname || '(' || identity_arguments || ')', NOT by
-- to_regprocedure: the identity form carries parameter names and
-- to_regprocedure rejects it ("invalid type name"). Matching the rendered
-- identity string also distinguishes the three get_broadcast_feed overloads
-- exactly.
-- The ACL is deliberately NOT asserted: production is unmeasured, and this
-- file must be correct on both lanes.
DO $preconditions$
DECLARE
  s   text;
  o   oid;
  n   int := 0;
BEGIN
  FOREACH s IN ARRAY ARRAY[
{SIG_ARRAY}]
  LOOP
    n := n + 1;
    SELECT p.oid INTO o
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = s;
    IF o IS NULL THEN
      RAISE EXCEPTION 'P32-{UNIT}-PRE-001: public.% does not exist with that exact signature', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = o) THEN
      RAISE EXCEPTION 'P32-{UNIT}-PRE-002: public.% is not SECURITY DEFINER', s
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> {N} THEN
    RAISE EXCEPTION 'P32-{UNIT}-PRE-003: expected {N} functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── THE REVOCATION AND THE EXPLICIT RETENTION ─────────────────────────────
-- Two statements per function: REVOKE names PUBLIC first (F-62), then GRANT
-- states the end position rather than leaving it to omission.
"""

body = []
for n, a in rows:
    body.append(f"REVOKE ALL ON FUNCTION {sig(n,a)} FROM {REVOKE_FROM};")
    body.append(f"GRANT EXECUTE ON FUNCTION {sig(n,a)} TO {GRANT_TO};")
    body.append("")

COMMENTS = ["-- ── ONE COMMENT PER FUNCTION: its disposition and its caller class. ──────", ""]
for n, a in rows:
    c = callers[n].replace("'", "''")
    disp = ("no client caller; service_role only"
            if UNIT == '0034' else "signed-in callers keep EXECUTE; anon and PUBLIC do not")
    COMMENTS.append(f"COMMENT ON FUNCTION {sig(n,a)} IS")
    COMMENTS.append(f"  'P32 {UNIT}: {disp}. Caller class: {c}. NOT executable by anon or public. "
                    f"PUBLIC held EXECUTE, so REVOKE FROM anon alone would have been a no-op (F-62). "
                    f"DROP+CREATE reopens it to PUBLIC (F-66).';")
    COMMENTS.append("")

POST = f"""-- ── POSTCONDITION ─────────────────────────────────────────────────────────
DO $postconditions$
DECLARE
  s     text;
  o     oid;
  pub_n int;
  n     int := 0;
BEGIN
  FOREACH s IN ARRAY ARRAY[
{SIG_ARRAY}]
  LOOP
    n := n + 1;
    SELECT p.oid INTO o
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = s;

    IF has_function_privilege('anon', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-{UNIT}-POST-001: anon still holds EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;

    -- grantee 0 is the PUBLIC pseudo-role, read through aclexplode rather than
    -- by looking for a leading '=' in the rendered text.
    SELECT count(*) INTO pub_n FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid = o AND a.grantee = 0;
    IF pub_n <> 0 THEN
      RAISE EXCEPTION 'P32-{UNIT}-POST-002: % still has % PUBLIC ACL entr(y/ies)', s, pub_n
        USING ERRCODE = 'raise_exception';
    END IF;

    IF has_function_privilege('authenticated', o, 'EXECUTE') <> {AUTH_AFTER} THEN
      RAISE EXCEPTION 'P32-{UNIT}-POST-003: authenticated {AUTH_WORD} hold EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_function_privilege('service_role', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-{UNIT}-POST-004: service_role lost EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> {N} THEN
    RAISE EXCEPTION 'P32-{UNIT}-POST-005: expected {N} functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
"""

apply_sql = HDR + "\n" + "\n".join(body) + "\n" + "\n".join(COMMENTS) + "\n" + POST

RB = f"""-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for {STEM}.sql
-- Identical stem, as required. {N} objects.
--
-- ⚠ EXECUTING THIS FILE REOPENS {RB_GRANT_TO} EXECUTE ON {N} SECURITY DEFINER,
-- VOLATILE FUNCTIONS. Every one runs with its owner's rights, and `postgres`
-- on Supabase is BYPASSRLS, so the grant is the only control there is.
--
-- ── WHY THE APPLY IS TWO-LANE AND THIS FILE IS NOT ────────────────────────
--
-- {STEM.split('_p32')[0]} closes a door, so its assertion accepts staging or production.
-- This file OPENS that door, so its guard accepts staging only and nothing
-- else. The two assertions are deliberately different and neither form should
-- be copied into the other.
--
-- ── WHAT IT RESTORES ──────────────────────────────────────────────────────
--
-- EXECUTE to {RB_GRANT_TO}, BY NAME, on the {N}. NEVER `TO PUBLIC`: the
-- postcondition asserts zero PUBLIC ACL entries after the grant, which is what
-- catches a TO PUBLIC slip that "{RB_GRANT_TO.split(',')[0]} can execute" alone would not.
--
-- Does not touch service_role, postgres, any body, or any COMMENT.
--
-- ── IT REFUSES WHEN THERE IS NOTHING TO UNDO ──────────────────────────────
--
-- The precondition requires the post-{STEM.split('_p32')[0].split('_')[-1]} state. Run against the pre-apply
-- state it refuses, so "it did nothing" and "it did its job" are never the
-- same outcome.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── R-9 LANE GUARD — executable, fatal, first. STAGING ONLY. ──────────────
DO $lane_guard$
BEGIN
  IF coalesce(current_setting('p32.lane', true), '') <> 'staging' THEN
    RAISE EXCEPTION
      'ROLLBACK REFUSED — p32.lane is not asserted as staging (read: %). '
      'This rollback reopens {RB_GRANT_TO} EXECUTE on {N} SECURITY DEFINER functions. '
      'The file cannot detect its own lane, so it refuses unless the lane is asserted. '
      'Set it in THIS session before running: SET p32.lane = ''staging'';',
      coalesce(current_setting('p32.lane', true), '(unset)')
    USING ERRCODE = 'raise_exception';
  END IF;
END
$lane_guard$;

-- ── PRECONDITION — the post-apply state must be in place. ─────────────────
DO $preconditions$
DECLARE
  s     text;
  o     oid;
  pub_n int;
  n     int := 0;
BEGIN
  FOREACH s IN ARRAY ARRAY[
{SIG_ARRAY}]
  LOOP
    n := n + 1;
    SELECT p.oid INTO o
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = s;
    IF o IS NULL THEN
      RAISE EXCEPTION 'P32-{UNIT}-RB-PRE-001: public.% does not exist with that exact signature', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF has_function_privilege('anon', o, 'EXECUTE') THEN
      RAISE EXCEPTION
        'P32-{UNIT}-RB-PRE-002: anon already holds EXECUTE on %, so {STEM.split('_p32')[0]} is not in '
        'effect and there is nothing for this file to roll back', s
        USING ERRCODE = 'raise_exception';
    END IF;
    SELECT count(*) INTO pub_n FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid = o AND a.grantee = 0;
    IF pub_n <> 0 THEN
      RAISE EXCEPTION 'P32-{UNIT}-RB-PRE-003: % still has a PUBLIC ACL entry', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_function_privilege('service_role', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-{UNIT}-RB-PRE-004: service_role is missing EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> {N} THEN
    RAISE EXCEPTION 'P32-{UNIT}-RB-PRE-005: expected {N} functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$preconditions$;

-- ── THE RESTORATION — by grantee name. Never TO PUBLIC. ───────────────────
"""
rb_body = [f"GRANT EXECUTE ON FUNCTION {sig(n,a)} TO {RB_GRANT_TO};" for n, a in rows]

RB_POST = f"""
-- ── POSTCONDITION — anon has EXECUTE, and PUBLIC still has none. ──────────
DO $postconditions$
DECLARE
  s     text;
  o     oid;
  pub_n int;
  n     int := 0;
BEGIN
  FOREACH s IN ARRAY ARRAY[
{SIG_ARRAY}]
  LOOP
    n := n + 1;
    SELECT p.oid INTO o
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = s;

    IF NOT has_function_privilege('anon', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-{UNIT}-RB-POST-001: anon did not regain EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_function_privilege('authenticated', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-{UNIT}-RB-POST-002: authenticated did not regain EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;

    SELECT count(*) INTO pub_n FROM pg_proc p, LATERAL aclexplode(p.proacl) a
     WHERE p.oid = o AND a.grantee = 0;
    IF pub_n <> 0 THEN
      RAISE EXCEPTION
        'P32-{UNIT}-RB-POST-003: % acquired a PUBLIC ACL entry. This file grants by '
        'name and must never grant to PUBLIC', s
        USING ERRCODE = 'raise_exception';
    END IF;
    IF NOT has_function_privilege('service_role', o, 'EXECUTE') THEN
      RAISE EXCEPTION 'P32-{UNIT}-RB-POST-004: service_role lost EXECUTE on %', s
        USING ERRCODE = 'raise_exception';
    END IF;
  END LOOP;

  IF n <> {N} THEN
    RAISE EXCEPTION 'P32-{UNIT}-RB-POST-005: expected {N} functions, checked %', n
      USING ERRCODE = 'raise_exception';
  END IF;
END
$postconditions$;

COMMIT;
"""
rb_sql = RB + "\n".join(rb_body) + "\n" + RB_POST

os.makedirs(os.path.join(OUTDIR, 'supabase/migrations'), exist_ok=True)
os.makedirs(os.path.join(OUTDIR, 'supabase/rollback'), exist_ok=True)
ap = os.path.join(OUTDIR, f'supabase/migrations/{STEM}.sql')
rp = os.path.join(OUTDIR, f'supabase/rollback/{STEM}_ROLLBACK.sql')
io.open(ap, 'w', encoding='utf-8', newline='').write(apply_sql)
io.open(rp, 'w', encoding='utf-8', newline='').write(rb_sql)
print(f"{UNIT}: {N} functions")
print(f"  {ap}   {len(apply_sql.splitlines())} lines")
print(f"  {rp}   {len(rb_sql.splitlines())} lines")
