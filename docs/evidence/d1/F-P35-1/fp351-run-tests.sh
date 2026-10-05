#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# F-P35-1 (20261005_0001) · C-34 harness on a scratch PG17. Every apply /
# rollback / probe runs through apply-migration.yml's extracted "Run it" step.
# The behaviour tests act AS the API roles (SET ROLE anon / authenticated with a
# JWT sub), the way PostgREST does, plus direct-SQL TRUNCATE (not under RLS).
# SCRATCH ONLY.   PGPORT=5433 bash docs/evidence/d1/F-P35-1/fp351-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=fp351
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20261005_0001_f_p35_1_grant_revoke.sql"
RB="$ROOT/supabase/rollback/20261005_0001_f_p35_1_grant_revoke_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_f_p35_1_grants.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
U=00000000-0000-0000-0000-0000000000b1
fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" 5432 2>&1); rc=$?; }
as() { psql -X -d "$DB" -tA -v ON_ERROR_STOP=1 -c "SET ROLE $1" -c "SET request.jwt.claim.sub = '${3:-}'" -c "$2" 2>&1 | grep -vE '^(SET|INSERT [0-9]+ [0-9]+|UPDATE [0-9]+|DELETE [0-9]+)$' | tail -1; }
# the (table, grantee, privilege) SET of the six tables — order-free, as the rollback's own postcondition compares
acl() { q "SELECT md5(string_agg(x, ';' ORDER BY x)) FROM (SELECT c.relname||':'||a.grantee::regrole::text||':'||a.privilege_type AS x FROM pg_class c, aclexplode(c.relacl) a WHERE c.relnamespace='public'::regnamespace AND (c.relname IN ('post_comments','reports') OR c.relname LIKE '\_v3\_preflight%')) s"; }
probe_is() { run staging "$PROBE"; if [ "$1" = pass ]; then [ $rc -eq 0 ] && { echo "  PASS  PROBE passes — $2"; echo "$out" | grep -o 'PROBE PASS.*' | sed 's/^/        /' | cut -c1-200; } || { echo "  FAIL  PROBE should pass — $2"; echo "$out" | grep -E 'ERROR|^  G' | head -4; fail=1; }
  else [ $rc -ne 0 ] && echo "$out" | grep -q "${3:-PROBE FAIL F-P35-1}" && { echo "  PASS  PROBE refuses — $2: $(echo "$out" | grep -c '^  G') hit line(s), e.g."; echo "$out" | grep -m3 '^  G' | sed 's/^/      /'; } || { echo "  FAIL  PROBE should refuse — $2"; echo "$out" | tail -3; fail=1; }; fi; }

step "0 · fixture: staging's ACL (API roles = ALL) and RLS"
psql -q -X -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1
psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/fp351-fixture.sql" >/dev/null || { echo "  FAIL  fixture"; exit 2; }
ACL0=$(acl); echo "  ACL md5 before: $ACL0"

step "1 · fail first: the PROBE, and what the API roles can do today"
probe_is fail "staging's ACL"
want "$(as anon "INSERT INTO public.reports (reporter_id, target_type, target_id, reason) VALUES ('$U','post','x','spam')" | grep -o 'row-level security\|permission denied' )" "row-level security" "anon INSERT into reports is stopped by RLS only (it HOLDS the privilege)"
want "$(as anon 'TRUNCATE public.reports' | tr -d '\n')" "TRUNCATE TABLE" "anon TRUNCATE reports SUCCEEDS — TRUNCATE is not under RLS (direct SQL; PostgREST never sends it)"
want "$(q 'SELECT count(*) FROM public.reports')" "0" "…and the table is empty"
want "$(as authenticated 'TRUNCATE public._v3_preflight_snapshot_judge_decisions' "$U" | tr -d '\n')" "TRUNCATE TABLE" "authenticated TRUNCATE of a judging snapshot SUCCEEDS"
psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA auth CASCADE;" >/dev/null && psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/fp351-fixture.sql" >/dev/null
want "$(acl)" "$ACL0" "fixture rebuilt, same ACL"

step "2 · apply 20261005_0001 (lane staging) and probe"
run staging "$MIG"; [ $rc -eq 0 ] && echo "  PASS  apply — $(echo "$out" | grep -o 'FP351-0001: .*' | head -1)" || { echo "  FAIL  apply"; echo "$out" | grep -E 'ERROR|CONTEXT' | head -4; fail=1; }
probe_is pass "after 0001"
run staging "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'FP351-0001-PRE-002' && echo "  PASS  a second apply is refused (PRE-002)" || { echo "  FAIL  second apply"; fail=1; }

step "3 · the app's own paths still work"
want "$(as anon 'SELECT count(*) FROM public.post_comments')" "5" "anon reads comments (public post pages)"
want "$(as authenticated "INSERT INTO public.post_comments (post_id, user_id, content) VALUES (gen_random_uuid(), '$U', 'new') RETURNING 'ok'" "$U")" "ok" "a member comments"
want "$(as authenticated "UPDATE public.post_comments SET content = 'edited' WHERE content = 'new' RETURNING 'ok'" "$U")" "ok" "…edits own comment"
want "$(as authenticated "DELETE FROM public.post_comments WHERE content = 'edited' RETURNING 'ok'" "$U")" "ok" "…deletes own comment"
want "$(as authenticated "INSERT INTO public.reports (reporter_id, target_type, target_id, reason) VALUES ('$U','post','y','spam') RETURNING 'ok'" "$U")" "ok" "a member reports"
want "$(as authenticated 'SELECT count(*) FROM public.reports' "$U")" "2" "…and reads own reports"
want "$(as service_role 'SELECT count(*) FROM public._v3_preflight_snapshot_judge_decisions')" "1" "service_role (the two edge functions) still reads the snapshots"

step "4 · what is closed now"
want "$(as anon 'TRUNCATE public.reports' | grep -o 'permission denied')" "permission denied" "anon TRUNCATE reports → permission denied"
want "$(as anon "INSERT INTO public.post_comments (post_id, user_id, content) VALUES (gen_random_uuid(), '$U', 'x')" | grep -o 'permission denied')" "permission denied" "anon INSERT post_comments → permission denied (was: RLS)"
want "$(as anon 'SELECT count(*) FROM public.reports' | grep -o 'permission denied')" "permission denied" "anon SELECT reports → permission denied"
want "$(as authenticated 'TRUNCATE public.post_comments' "$U" | grep -o 'permission denied')" "permission denied" "authenticated TRUNCATE post_comments → permission denied"
want "$(as authenticated 'SELECT count(*) FROM public._v3_preflight_snapshot_judge_decisions' "$U" | grep -o 'permission denied')" "permission denied" "authenticated SELECT on a snapshot → permission denied"
want "$(as anon 'TRUNCATE public._v3_preflight_snapshot_judging_tags' | grep -o 'permission denied')" "permission denied" "anon TRUNCATE a snapshot → permission denied"

step "5 · the PROBE catches each regression (mutants, each undone)"
mut() { q "$1" >/dev/null; probe_is fail "$3" "$2"; q "$4" >/dev/null; }
mut "GRANT INSERT ON public.post_comments TO anon" "G2 post_comments: anon INSERT" "anon INSERT re-granted on post_comments" "REVOKE INSERT ON public.post_comments FROM anon"
mut "GRANT SELECT ON public.reports TO anon" "G3 reports: anon SELECT" "anon SELECT re-granted on reports" "REVOKE SELECT ON public.reports FROM anon"
mut "GRANT TRUNCATE ON public.reports TO authenticated" "G3 reports: authenticated TRUNCATE" "authenticated TRUNCATE re-granted" "REVOKE TRUNCATE ON public.reports FROM authenticated"
mut "GRANT SELECT ON public._v3_preflight_snapshot_judging_tags TO authenticated" "G1 _v3_preflight_snapshot_judging_tags: authenticated SELECT" "a snapshot re-opened" "REVOKE SELECT ON public._v3_preflight_snapshot_judging_tags FROM authenticated"
mut "GRANT ALL ON public.post_comments TO PUBLIC" "G2 post_comments: anon INSERT" "a grant to PUBLIC (anon inherits it)" "REVOKE ALL ON public.post_comments FROM PUBLIC"
mut "REVOKE SELECT ON public.post_comments FROM anon" "G4" "the app's anon read taken away (over-revoke)" "GRANT SELECT ON public.post_comments TO anon"
mut "ALTER TABLE public.reports DISABLE ROW LEVEL SECURITY" "G3 reports: RLS off" "RLS switched off" "ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY"
probe_is pass "every mutant undone"

step "6 · a lane where a snapshot does not exist (production unread): skip, never error"
run production "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback (lane production)" || { echo "  FAIL  rollback"; echo "$out" | grep -E 'ERROR' | head -3; fail=1; }
want "$(acl)" "$ACL0" "ACL restored exactly (md5 of all six ACLs = before)"
probe_is fail "after the rollback"
q "DROP TABLE public._v3_preflight_snapshot_judge_tag_assignments" >/dev/null; ACL1=$(acl)
run staging "$MIG"; [ $rc -eq 0 ] && echo "$out" | grep -q '_v3_preflight_snapshot_judge_tag_assignments does not exist on this lane' && echo "  PASS  apply with one snapshot absent — skipped by NOTICE" || { echo "  FAIL  apply with a snapshot absent"; echo "$out" | grep -E 'ERROR' | head -2; fail=1; }
probe_is pass "lane with 3 snapshots"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'ROLLBACK REFUSED' && echo "  PASS  rollback with no lane — refused" || { echo "  FAIL  rollback lane guard"; fail=1; }
run staging "$RB"; [ $rc -eq 0 ] && want "$(acl)" "$ACL1" "rollback on that lane restores its ACL exactly" || { echo "  FAIL  rollback 2"; fail=1; }
run staging "$MIG"; [ $rc -eq 0 ] && echo "  PASS  re-apply after rollback" || { echo "  FAIL  re-apply"; fail=1; }

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
