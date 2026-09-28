#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P1 · 20260920_0003 — the C-34 harness for the one-time VACUUM (R-67).
#
# Every run goes through docs/evidence/d1/phase1/p1-0037-runit2.sh, the
# extracted "Run it" step of apply-migration.yml (R-13): one psql session,
# ON_ERROR_STOP=1, -c "SET p32.lane = '<lane>';" then -f — no -1.
#
# What it proves: the file refuses outside the two lanes and then vacuums
# nothing; on either lane it removes the dead tuples; it runs WITHOUT a
# transaction block, and the same statement inside BEGIN/COMMIT or under
# psql -1 fails (so single-transaction mode could never half-run it); the
# lane assertion is what refuses (mutant); the file holds exactly two
# statements; a second run is harmless.
#
# SCRATCH CLUSTER ONLY. Never point PGHOST at staging or production.
#   bash docs/evidence/d1/phase2/p1-0003-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p3vac
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260920_0003_p1_profiles_vacuum_once.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
build() { dropdb --force --if-exists "$DB" >/dev/null 2>&1; createdb "$DB" || return 1
          psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p1-0003-fixture.sql" >/dev/null 2>&1; }
state() { q "SELECT pg_stat_clear_snapshot()" >/dev/null
          q "SELECT n_live_tup||' live / '||n_dead_tup||' dead, vacuumed='||(last_vacuum IS NOT NULL)||', analyzed='||(last_analyze IS NOT NULL) FROM pg_stat_user_tables WHERE relid='public.profiles'::regclass"; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" "${3:-5432}" 2>&1); rc=$?; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }
expect_fail() { local what="$1" needle="$2"; run "$3" "$4" "${5:-5432}"
  if [ "$rc" -eq 0 ]; then echo "  FAIL  $what — ACCEPTED (exit 0)"; fail=1
  elif ! printf '%s' "$out" | grep -q "$needle"; then echo "  FAIL  $what — refused, not with '$needle'"; printf '%s\n' "$out" | head -4 | sed 's/^/        /'; fail=1
  else echo "  PASS  $what — refused (exit $rc), '$needle'"; fi; }

step "0 · fixture: the old timer's dead rows, no vacuum yet"
psql -q -X -d postgres -tAc "SELECT '  server_version '||current_setting('server_version')"
build && echo "  PASS  fixture built" || { echo "  FAIL  fixture"; exit 2; }
S0=$(state); echo "  profiles: $S0"
want "$S0" "50 live / 50 dead, vacuumed=false, analyzed=false" "starting point: 50 live / 50 dead = 50 %, never vacuumed"

step "1 · static: the file is the lane assertion and ONE VACUUM, nothing else"
python3 - "$MIG" > "$T/stmts" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
s = re.sub(r'--[^\n]*', '', s)                                  # line comments
s = re.sub(r'\$lane_assert\$.*?\$lane_assert\$', '$$', s, flags=re.S)  # DO body
for st in [x.strip() for x in s.split(';') if x.strip()]:
    print(re.sub(r'\s+', ' ', st))
PY
want "$(wc -l < "$T/stmts" | tr -d ' ')" "2" "exactly two top-level statements"
want "$(sed -n 1p "$T/stmts")" 'DO $$' "statement 1 is the lane assertion (DO block)"
want "$(sed -n 2p "$T/stmts")" "VACUUM (ANALYZE) public.profiles" "statement 2 is VACUUM (ANALYZE) public.profiles"
want "$(grep -ciE '^(BEGIN|COMMIT|START TRANSACTION)\b' "$T/stmts")" "0" "no top-level BEGIN / COMMIT (the DO body's plpgsql BEGIN is not a transaction)"

step "2 · refuses outside the two lanes, and then vacuums NOTHING"
expect_fail "no lane asserted"         "Unknown target" ""      "$MIG"
expect_fail "a lane of 'local'"        "Unknown target" "local" "$MIG"
expect_fail "transaction pooler, 6543" "6543"           staging "$MIG" 6543
o=$(psql -X -d "$DB" --set ON_ERROR_STOP=1 -f "$MIG" 2>&1); r=$?
if [ "$r" -ne 0 ] && printf '%s' "$o" | grep -q "APPLY REFUSED"; then echo "  PASS  file run with p32.lane unset (no Run-it step) — the file's own assertion refuses (exit $r)"
else echo "  FAIL  file with p32.lane unset was not refused by its assertion (exit $r)"; fail=1; fi
want "$(state)" "$S0" "after four refusals: still 50 dead, never vacuumed — ON_ERROR_STOP stopped before the VACUUM"

step "3 · staging lane: the dead rows go"
run staging "$MIG"; [ "$rc" -eq 0 ] && echo "  PASS  apply, TARGET_LANE=staging (exit 0)" || { echo "  FAIL  staging apply exit $rc"; printf '%s\n' "$out" | tail -5; fail=1; }
S1=$(state); echo "  profiles: $S1"
want "$S1" "50 live / 0 dead, vacuumed=true, analyzed=true" "50 live / 0 dead = 0 %; last_vacuum and last_analyze set"

step "3b · a second run is harmless"
run staging "$MIG"; want "$rc/$(state)" "0/50 live / 0 dead, vacuumed=true, analyzed=true" "re-run: exit 0, nothing changes"

step "3c · production lane: the same, on a fresh fixture"
build >/dev/null; run production "$MIG"
want "$rc/$(state)" "0/50 live / 0 dead, vacuumed=true, analyzed=true" "apply, TARGET_LANE=production: exit 0, 0 dead"

step "4 · why there is no BEGIN/COMMIT — each wrapped form FAILS, and vacuums nothing"
build >/dev/null
{ echo "BEGIN;"; cat "$MIG"; echo "COMMIT;"; } > "$T/wrapped.sql"
run staging "$T/wrapped.sql"
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "cannot run inside a transaction block"; then
  echo "  PASS  the file wrapped in BEGIN/COMMIT fails: VACUUM cannot run inside a transaction block"
else echo "  FAIL  wrapped form did not fail as expected (rc=$rc)"; fail=1; fi
o=$(psql -X -d "$DB" --set ON_ERROR_STOP=1 --single-transaction -c "SET p32.lane = 'staging';" -f "$MIG" 2>&1); r=$?
if [ "$r" -ne 0 ] && printf '%s' "$o" | grep -q "cannot run inside a transaction block"; then
  echo "  PASS  psql --single-transaction (-1) fails the same way — if the workflow ever gains -1, this file refuses loudly"
else echo "  FAIL  -1 form did not fail as expected (rc=$r)"; fail=1; fi
want "$(state)" "$S0" "both failures vacuumed nothing"

step "5 · C-34 MUTANT — the lane assertion removed: an unasserted run is ACCEPTED"
build >/dev/null
python3 - "$MIG" "$T/m.sql" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
m = re.sub(r'DO \$lane_assert\$.*?\$lane_assert\$;\n', '', s, flags=re.S)
assert m != s
open(sys.argv[2], 'w').write(m)
PY
o=$(psql -X -d "$DB" --set ON_ERROR_STOP=1 -f "$T/m.sql" 2>&1); r=$?
if [ "$r" -eq 0 ] && [ "$(state)" = "50 live / 0 dead, vacuumed=true, analyzed=true" ]; then
  echo "  PASS  RED as required — without the assertion a run with p32.lane unset vacuums (exit 0); the assertion is what refuses"
else echo "  FAIL  mutant not caught (rc=$r, $(state))"; fail=1; fi

step "VERDICT"
if [ "$fail" -eq 0 ]; then echo "  ALL GREEN"; else echo "  FAILURES ABOVE"; fi
exit "$fail"
