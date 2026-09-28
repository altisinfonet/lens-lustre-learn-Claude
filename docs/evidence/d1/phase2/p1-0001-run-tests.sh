#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P1 · 20260920_0001 — the C-34 harness (Phase 2 unit 2-D1-02, server half).
#
# Every apply and rollback goes through docs/evidence/d1/phase1/p1-0037-runit2.sh,
# the extracted "Run it" step of apply-migration.yml (R-13): one psql session,
# -c "SET p32.lane = '<lane>';" then -f.
#
# The fixture list the Auditor named, and where each is proved:
#   two tabs within 60 s -> 1 row update, not 2 ........ step 3 (sequential AND concurrent)
#   'desktop' -> 22023 ................................. step 4
#   signed out is a no-op .............................. step 4
#   backfill moves a stale value only past 10 min ...... step 6
#   anon EXECUTE false on both functions ............... step 2 (catalogue) and step 5 (a real call)
# plus: cross-member (a definer function's WHERE is its only control), the
# default-privilege catalogue unchanged (Phase 1 sign-off row 9), the cron job,
# refusals, the rollback and its R-9 guard, and step 8: MUTANTS — the same file
# with one control removed, each of which must turn a step RED (C-34).
#
# SCRATCH CLUSTER ONLY. Never point PGHOST at staging or production.
# The cluster needs shared_preload_libraries = 'pg_cron' and
# cron.database_name = 'p1cron' (the fixture database's name).
#
#   bash docs/evidence/d1/phase2/p1-0001-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p1cron
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260920_0001_p1_session_end_and_backfill.sql"
RB="$ROOT/supabase/rollback/20260920_0001_p1_session_end_and_backfill_ROLLBACK.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
A=aaaaaaaa-0000-0000-0000-000000000001
B=bbbbbbbb-0000-0000-0000-000000000002
step() { printf '\n══ %s\n' "$*"; }
q()  { psql -q -X -d "$DB" -tAc "$1"; }
# One member's call, in its own session, as the authenticated role with that
# member's JWT subject — the way PostgREST runs it.
as_member() { psql -q -X -d "$DB" -tA -v ON_ERROR_STOP=1 \
  -c "SET ROLE authenticated; SET request.jwt.claim.sub = '$1';" -c "$2" 2>&1; }
build() { dropdb --force --if-exists "$DB" >/dev/null 2>&1; createdb "$DB" || return 1
          psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p1-0001-fixture.sql" >/dev/null 2>&1; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" "${3:-5432}" 2>&1); rc=$?; }
expect_fail() { local what="$1" needle="$2"; run "$3" "$4" "${5:-5432}"
  if [ "$rc" -eq 0 ]; then echo "  FAIL  $what — ACCEPTED (exit 0). It must refuse."; fail=1
  elif ! printf '%s' "$out" | grep -q "$needle"; then
    echo "  FAIL  $what — refused, but not with '$needle':"; printf '%s\n' "$out" | sed 's/^/        /' | head -6; fail=1
  else echo "  PASS  $what — refused (exit $rc), '$needle'"; fi; }
expect_ok() { local what="$1"; run "$2" "$3" "${4:-5432}"
  if [ "$rc" -ne 0 ]; then echo "  FAIL  $what — exit $rc:"; printf '%s\n' "$out" | sed 's/^/        /' | tail -12; fail=1
  else echo "  PASS  $what"; fi; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }
nfuncs() { q "SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('record_session_end','backfill_last_seen')"; }
njob()   { q "SELECT count(*) FROM cron.job WHERE jobname='p1-backfill-last-seen'"; }
updates(){ q "SELECT count(*) FROM public.fx_updates"; }

step "0 · scratch cluster and fixture"
q "SELECT 1" >/dev/null 2>&1 || true
psql -q -X -d postgres -tAc "SELECT '  server_version '||current_setting('server_version')||' · shared_preload_libraries='||current_setting('shared_preload_libraries')"
if build; then echo "  PASS  fixture built"; else echo "  FAIL  fixture did not build"; exit 2; fi
q "SELECT '  pg_cron '||extversion FROM pg_extension WHERE extname='pg_cron'"
DEFACL0=$(q "SELECT public.fx_defacl()")

step "1 · 0001 REFUSES outside the dispatch workflow, and leaves nothing behind"
expect_fail "no lane asserted"          "Unknown target"  ""        "$MIG"
expect_fail "a lane of 'local'"         "Unknown target"  "local"   "$MIG"
expect_fail "transaction pooler, 6543"  "6543"            staging   "$MIG" 6543
want "$(nfuncs)/$(njob)" "0/0" "three refusals created no function and no job"

step "2 · 0001 applies on the staging lane; the grant matrix is the interface's"
expect_ok "apply, TARGET_LANE=staging" staging "$MIG"
q "SELECT '  '||p.oid::regprocedure||'  secdef='||p.prosecdef||'  config='||array_to_string(p.proconfig,',')||'  acl='||p.proacl::text FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('record_session_end','backfill_last_seen') ORDER BY 1"
want "$(q "SELECT string_agg(r||'='||has_function_privilege(r, 'public.record_session_end(text)', 'EXECUTE'), ' ' ORDER BY r) FROM unnest(ARRAY['anon','authenticated','service_role']) r")" \
     "anon=false authenticated=true service_role=true" "record_session_end: anon NO, authenticated YES, service_role YES"
want "$(q "SELECT string_agg(r||'='||has_function_privilege(r, 'public.backfill_last_seen()', 'EXECUTE'), ' ' ORDER BY r) FROM unnest(ARRAY['anon','authenticated','service_role']) r")" \
     "anon=false authenticated=false service_role=true" "backfill_last_seen: service_role only"
want "$(q "SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) x WHERE p.proname IN ('record_session_end','backfill_last_seen') AND x.grantee=0")" \
     "0" "no PUBLIC entry on either function (F-62)"
want "$(q "SELECT jobname||' | '||schedule||' | '||command||' | active='||active||' | as '||username FROM cron.job WHERE jobname='p1-backfill-last-seen'")" \
     "p1-backfill-last-seen | */30 * * * * | SELECT public.backfill_last_seen(); | active=true | as postgres" \
     "cron job p1-backfill-last-seen, */30, runs as postgres (the owner)"
want "$(q "SELECT public.fx_defacl()")" "$DEFACL0" "default-privilege catalogue byte-identical (Phase 1 sign-off row 9 stays PASS)"

step "2b · a second apply is refused (PRE-004), and changes nothing"
ACL_BEFORE=$(q "SELECT md5(string_agg(p.oid::regprocedure::text||p.proacl::text||p.prosrc, '|' ORDER BY p.oid::regprocedure::text)) FROM pg_proc p WHERE p.proname IN ('record_session_end','backfill_last_seen')")
expect_fail "second apply" "P1-0001-PRE-004" staging "$MIG"
want "$(q "SELECT md5(string_agg(p.oid::regprocedure::text||p.proacl::text||p.prosrc, '|' ORDER BY p.oid::regprocedure::text)) FROM pg_proc p WHERE p.proname IN ('record_session_end','backfill_last_seen')")/$(njob)" \
     "$ACL_BEFORE/1" "functions, ACLs and the single job unchanged"

step "3 · TWO TABS within 60 s -> ONE row update, not two"
q "UPDATE public.profiles SET last_active_at = now() - interval '2 hours' WHERE id IN ('$A','$B'); TRUNCATE public.fx_updates;"
BROW=$(q "SELECT public.fx_row('$B')")
as_member "$A" "SELECT public.record_session_end('web')" >/dev/null
as_member "$A" "SELECT public.record_session_end('app')" >/dev/null
want "$(updates)" "1" "sequential: tab 1 then tab 2, 0 s apart — 1 UPDATE reached the row"
want "$(q "SELECT last_platform FROM public.profiles WHERE id='$A'")" "web" "the first tab's platform stands; the second wrote nothing"
want "$(q "SELECT (now() - last_active_at) < interval '10 seconds' FROM public.profiles WHERE id='$A'")" "t" "last_active_at moved to now"
want "$(q "SELECT public.fx_row('$B')")" "$BROW" "CROSS-MEMBER: member B's row and public mirror byte-identical after A's calls"
# 61 s later is a new session end and must write again.
q "UPDATE public.profiles SET last_active_at = now() - interval '61 seconds' WHERE id='$A'; TRUNCATE public.fx_updates;"
as_member "$A" "SELECT public.record_session_end('app')" >/dev/null
want "$(updates)/$(q "SELECT last_platform FROM public.profiles WHERE id='$A'")" "1/app" "61 s after the last write: writes again (the rule is 60 s, not 'once')"
# Concurrent: two sessions race. Tab 1 holds its transaction open for 2 s after
# its UPDATE; tab 2 starts 0.5 s later, blocks on the row lock, and when tab 1
# commits re-evaluates its WHERE against the new row — which now fails it.
q "UPDATE public.profiles SET last_active_at = now() - interval '2 hours' WHERE id='$A'; TRUNCATE public.fx_updates;"
( psql -q -X -d "$DB" -tA -c "BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '$A'; SELECT public.record_session_end('web'); SELECT pg_sleep(2); COMMIT;" >"$T/tab1" 2>&1 ) &
sleep 0.5
T0=$(date +%s.%N)
as_member "$A" "SELECT public.record_session_end('web')" >"$T/tab2"
T1=$(date +%s.%N); wait
WAITED=$(python3 -c "print(f'{$T1-$T0:.1f}')")
want "$(updates)" "1" "concurrent: two tabs racing in real sessions — 1 UPDATE (tab 2 waited ${WAITED}s on tab 1's row lock, then matched nothing)"

step "4 · the argument, and signed out"
for bad in "'desktop'" "NULL" "'APP'" "''"; do
  o=$(as_member "$A" "SELECT public.record_session_end($bad)")
  if printf '%s' "$o" | grep -q "must be 'app' or 'web'"; then
    code=$(psql -q -X -d "$DB" -tA -c "SET ROLE authenticated; SET request.jwt.claim.sub = '$A';" \
      -c "DO \$\$ BEGIN PERFORM public.record_session_end($bad); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'SQLSTATE=%', SQLSTATE; END \$\$;" 2>&1 | grep -o 'SQLSTATE=[0-9A-Z]*')
    want "$code" "SQLSTATE=22023" "record_session_end($bad) raises 22023"
  else echo "  FAIL  record_session_end($bad) did not refuse: $o"; fail=1; fi
done
q "UPDATE public.profiles SET last_active_at = now() - interval '2 hours' WHERE id='$A'; TRUNCATE public.fx_updates;"
o=$(psql -q -X -d "$DB" -tA -v ON_ERROR_STOP=1 -c "SET ROLE authenticated;" -c "SELECT public.record_session_end('web')" 2>&1); r=$?
want "$r/$(updates)" "0/0" "signed out (no JWT subject): returns without error, writes nothing"
o=$(as_member "$A" "SELECT public.record_session_end('desktop')")
want "$(updates)" "0" "a refused call wrote nothing"

step "5 · anon cannot call either function — a real call, not only the catalogue"
for f in "public.record_session_end('web')" "public.backfill_last_seen()"; do
  o=$(psql -q -X -d "$DB" -tA -c "SET ROLE anon;" -c "SELECT $f" 2>&1)
  if printf '%s' "$o" | grep -q "permission denied for function"; then echo "  PASS  anon: SELECT $f -> permission denied"
  else echo "  FAIL  anon: SELECT $f -> $o"; fail=1; fi
done
o=$(as_member "$A" "SELECT public.backfill_last_seen()")
if printf '%s' "$o" | grep -q "permission denied for function"; then echo "  PASS  authenticated: SELECT public.backfill_last_seen() -> permission denied"
else echo "  FAIL  authenticated could call backfill_last_seen(): $o"; fail=1; fi
o=$(psql -q -X -d "$DB" -tA -c "SET ROLE service_role;" -c "SELECT public.backfill_last_seen()" 2>&1)
if printf '%s' "$o" | grep -qE '^[0-9]+$'; then echo "  PASS  service_role: SELECT public.backfill_last_seen() -> $o row(s)"
else echo "  FAIL  service_role could not call backfill_last_seen(): $o"; fail=1; fi

step "6 · backfill moves a stale value forward ONLY past 10 minutes"
# One anchor time S; each member's stored value and newest heartbeat minute:
#   X  stored S,        newest S+5 min   -> untouched (5 < 10)
#   E  stored S,        newest S+10 min  -> untouched (10 is not MORE than 10)
#   Y  stored S,        newest S+11 min  -> moved to S+11
#   Z  stored NULL,     newest S+1 min   -> set to S+1 (NULL counts as older)
#   W  stored S+30 min, newest S+11 min  -> untouched (never moves backwards)
#   V  stored S,        no minutes       -> untouched
q "DELETE FROM public.member_activity_minutes; DELETE FROM public.profiles WHERE full_name IN ('X','E','Y','Z','W','V');
   INSERT INTO public.profiles (id, full_name, last_active_at) VALUES
     ('11111111-0000-0000-0000-00000000000a','X', timestamptz '2026-09-27 10:00+00'),
     ('11111111-0000-0000-0000-00000000000e','E', timestamptz '2026-09-27 10:00+00'),
     ('11111111-0000-0000-0000-00000000000b','Y', timestamptz '2026-09-27 10:00+00'),
     ('11111111-0000-0000-0000-00000000000c','Z', NULL),
     ('11111111-0000-0000-0000-00000000000d','W', timestamptz '2026-09-27 10:30+00'),
     ('11111111-0000-0000-0000-00000000000f','V', timestamptz '2026-09-27 10:00+00');
   INSERT INTO public.member_activity_minutes (user_id, minute_bucket) VALUES
     ('11111111-0000-0000-0000-00000000000a', '2026-09-27 10:01+00'), ('11111111-0000-0000-0000-00000000000a', '2026-09-27 10:05+00'),
     ('11111111-0000-0000-0000-00000000000e', '2026-09-27 10:10+00'),
     ('11111111-0000-0000-0000-00000000000b', '2026-09-27 10:02+00'), ('11111111-0000-0000-0000-00000000000b', '2026-09-27 10:11+00'),
     ('11111111-0000-0000-0000-00000000000c', '2026-09-27 10:01+00'),
     ('11111111-0000-0000-0000-00000000000d', '2026-09-27 10:11+00');
   UPDATE public.profiles SET last_active_at = now() WHERE id IN ('$A','$B');
   TRUNCATE public.fx_updates;"
N=$(psql -q -X -d "$DB" -tA -c "SET ROLE service_role;" -c "SELECT public.backfill_last_seen()")
want "$N" "2" "backfill_last_seen() returns 2 (rows touched: Y and Z)"
want "$(q "SELECT string_agg(full_name||'='||coalesce(to_char(last_active_at AT TIME ZONE 'UTC','HH24:MI'),'NULL'), ' ' ORDER BY full_name) FROM public.profiles WHERE full_name IN ('X','E','Y','Z','W','V')")" \
     "E=10:00 V=10:00 W=10:30 X=10:00 Y=10:11 Z=10:01" "X +5 no, E +10 no, Y +11 yes, Z NULL yes, W never backwards, V no minutes"
want "$(updates)" "2" "exactly 2 UPDATEs reached profiles rows"
want "$(q "SELECT count(*) FROM public.profiles WHERE full_name IN ('Y','Z') AND last_platform IS NOT NULL")" "0" "backfill never writes last_platform"
N2=$(psql -q -X -d "$DB" -tA -c "SET ROLE service_role;" -c "SELECT public.backfill_last_seen()")
want "$N2" "0" "a second run touches 0 rows"
# The cron job's own command string, executed as it would be (as postgres).
N3=$(q "$(q "SELECT command FROM cron.job WHERE jobname='p1-backfill-last-seen'")")
want "$N3" "0" "the cron job's command, run verbatim as postgres, works (0 rows now)"

step "7 · the ROLLBACK — R-9: refuses unless the lane is staging; then removes all three"
FN0=$(nfuncs)/$(njob)
expect_fail "rollback, lane = production" "ROLLBACK REFUSED" production "$RB"
# The Run-it step itself refuses an empty lane before psql; this reaches the
# FILE's guard with p32.lane unset, which is what R-9's C-34 probe requires.
o=$(psql -q -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); r=$?
if [ "$r" -ne 0 ] && printf '%s' "$o" | grep -q "ROLLBACK REFUSED"; then echo "  PASS  rollback, p32.lane unset (file run directly) — refused (exit $r), 'ROLLBACK REFUSED'"
else echo "  FAIL  rollback with p32.lane unset was not refused (exit $r)"; fail=1; fi
want "$(nfuncs)/$(njob)" "$FN0" "both refusals left both functions and the job in place"
expect_ok "rollback, lane = staging" staging "$RB"
want "$(nfuncs)/$(njob)" "0/0" "both functions and the job are gone"
want "$(q "SELECT public.fx_defacl()")" "$DEFACL0" "default-privilege catalogue still byte-identical"
expect_fail "rollback run a second time" "P1-0001-RB-PRE-002" staging "$RB"
expect_ok "re-apply after rollback (the cycle closes)" staging "$MIG"
want "$(nfuncs)/$(njob)" "2/1" "both functions and one job again"

step "7b · 0001 applies on the PRODUCTION lane too (a two-lane file), fresh fixture"
build >/dev/null && expect_ok "apply, TARGET_LANE=production" production "$MIG"
expect_fail "rollback, lane = production (R-9)" "ROLLBACK REFUSED" production "$RB"

step "8 · C-34 MUTANTS — the same file with one control removed; each must go RED"
mutant() { # name, python replace (old, new), then a check command that must FAIL
  local name="$1" old="$2" new="$3"
  python3 - "$MIG" "$T/m.sql" "$old" "$new" <<'PY' || { echo "  FAIL  mutant '$name' — anchor not found"; fail=1; return 1; }
import sys
src, dst, old, new = sys.argv[1:5]
s = open(src).read()
assert s.count(old) == 1, f"anchor count {s.count(old)}"
open(dst, "w").write(s.replace(old, new))
PY
  build >/dev/null
}
# M1 — no 60-second condition: two tabs write twice.
if mutant "no two-tab rule" \
   "     AND (last_active_at IS NULL OR last_active_at < now() - interval '60 seconds');" "     ;"; then
  run staging "$T/m.sql"
  q "UPDATE public.profiles SET last_active_at = now() - interval '2 hours' WHERE id='$A'; TRUNCATE public.fx_updates;"
  as_member "$A" "SELECT public.record_session_end('web')" >/dev/null; as_member "$A" "SELECT public.record_session_end('web')" >/dev/null
  u=$(updates); [ "$rc" -eq 0 ] && [ "$u" = "2" ] && echo "  PASS  RED as required — without the 60 s condition two tabs make $u UPDATEs" \
    || { echo "  FAIL  mutant M1 not caught (apply rc=$rc, updates=$u)"; fail=1; }
fi
# M2 — no owner predicate: A's call rewrites B's row.
if mutant "no owner predicate" "   WHERE id = _user
     AND (last_active_at" "   WHERE (last_active_at"; then
  run staging "$T/m.sql"
  q "UPDATE public.profiles SET last_active_at = now() - interval '2 hours'"
  BROW=$(q "SELECT public.fx_row('$B')")
  as_member "$A" "SELECT public.record_session_end('web')" >/dev/null
  [ "$rc" -eq 0 ] && [ "$(q "SELECT public.fx_row('$B')")" != "$BROW" ] && echo "  PASS  RED as required — without WHERE id = auth.uid() member A's call rewrote member B's row" \
    || { echo "  FAIL  mutant M2 not caught (rc=$rc)"; fail=1; }
fi
# M3 — the 10-minute margin removed: X (+5 min) and E (+10 min) move too.
if mutant "no 10-minute margin" "m.newest_minute > p.last_active_at + interval '10 minutes'" "m.newest_minute > p.last_active_at"; then
  run staging "$T/m.sql"
  q "INSERT INTO public.profiles (id, full_name, last_active_at) VALUES ('11111111-0000-0000-0000-00000000000a','X','2026-09-27 10:00+00');
     INSERT INTO public.member_activity_minutes (user_id, minute_bucket) VALUES ('11111111-0000-0000-0000-00000000000a','2026-09-27 10:05+00');"
  psql -q -X -d "$DB" -tA -c "SET ROLE service_role;" -c "SELECT public.backfill_last_seen()" >/dev/null
  x=$(q "SELECT to_char(last_active_at AT TIME ZONE 'UTC','HH24:MI') FROM public.profiles WHERE full_name='X'")
  [ "$rc" -eq 0 ] && [ "$x" = "10:05" ] && echo "  PASS  RED as required — without the margin a +5 min heartbeat moved X to $x" \
    || { echo "  FAIL  mutant M3 not caught (rc=$rc, X=$x)"; fail=1; }
fi
# M4 — authenticated left on the backfill: the file's own POST-004 refuses.
if mutant "authenticated keeps backfill" \
   "REVOKE ALL ON FUNCTION public.backfill_last_seen() FROM PUBLIC, anon, authenticated;" \
   "REVOKE ALL ON FUNCTION public.backfill_last_seen() FROM PUBLIC, anon;"; then
  run staging "$T/m.sql"
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "P1-0001-POST-004: backfill_last_seen"; then
    echo "  PASS  RED as required — the default ACL's authenticated grant survives; POST-004 refuses the apply"
    want "$(nfuncs)/$(njob)" "0/0" "  … and the refused apply left nothing behind"
  else echo "  FAIL  mutant M4 not caught (rc=$rc)"; printf '%s\n' "$out" | tail -3 | sed 's/^/        /'; fail=1; fi
fi
# M5 — PUBLIC granted: F-62, anon inherits it; POST-003 refuses.
if mutant "PUBLIC granted" \
   "GRANT EXECUTE ON FUNCTION public.record_session_end(text) TO authenticated, service_role;" \
   "GRANT EXECUTE ON FUNCTION public.record_session_end(text) TO PUBLIC, authenticated, service_role;"; then
  run staging "$T/m.sql"
  [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "P1-0001-POST-003" && echo "  PASS  RED as required — a PUBLIC grant is refused by POST-003" \
    || { echo "  FAIL  mutant M5 not caught (rc=$rc)"; fail=1; }
fi
# M6 — the platform check removed: 'desktop' reaches the table's CHECK (23514), not 22023; POST-006 refuses.
if mutant "no platform check" "  IF _platform IS NULL OR _platform NOT IN ('app', 'web') THEN" "  IF false THEN"; then
  run staging "$T/m.sql"
  [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "P1-0001-POST-006" && echo "  PASS  RED as required — without the argument check POST-006 refuses the apply" \
    || { echo "  FAIL  mutant M6 not caught (rc=$rc)"; fail=1; }
fi

step "VERDICT"
if [ "$fail" -eq 0 ]; then echo "  ALL GREEN"; else echo "  FAILURES ABOVE"; fi
exit "$fail"
