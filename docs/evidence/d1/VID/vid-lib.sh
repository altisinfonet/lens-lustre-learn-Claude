# Shared helpers for the VID harnesses (sourced). SCRATCH CLUSTER ONLY.
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p5cron
VHERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd "$VHERE/../../../.." && pwd)"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
ADMIN=00000000-0000-0000-0000-0000000000a1; NEIL=00000000-0000-0000-0000-0000000000b1; RIYA=00000000-0000-0000-0000-0000000000b2
ARUN=00000000-0000-0000-0000-0000000000b3; MIRA=00000000-0000-0000-0000-0000000000b4
fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" 5432 2>&1); rc=$?; }
# as <role> <uid|''> <sql> → last output line (command tags dropped; errors kept)
as() { local o; o=$(psql -X -d "$DB" -tA -v ON_ERROR_STOP=1 -c "SET ROLE $1" -c "SET request.jwt.claim.sub = '${2:-}'" -c "$3" 2>&1)
       if echo "$o" | grep -q 'ERROR:'; then echo "$o" | grep -m1 'ERROR:'; else echo "$o" | grep -vE '^(SET|INSERT [0-9]+ [0-9]+|UPDATE [0-9]+|DELETE [0-9]+|SELECT [0-9]+)$' | tail -1; fi; }
err() { echo "$1" | grep -o "$2" | head -1; }
fixture() {   # $1 = staging | production
  q "SELECT cron.unschedule(jobid) FROM cron.job" >/dev/null 2>&1; q "DELETE FROM cron.job_run_details" >/dev/null 2>&1
  q "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS vault CASCADE; DROP SCHEMA IF EXISTS net CASCADE; DROP SCHEMA IF EXISTS auth CASCADE;" >/dev/null 2>&1
  psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$VHERE/vid-fixture-base.sql" >/dev/null || { echo "  FAIL  base fixture"; exit 2; }
  psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$VHERE/vid-fixture-$1.sql" >/dev/null || { echo "  FAIL  $1 fixture"; exit 2; }
  echo "  lane shape: $1 · category minimum on INSERT: $(q "SELECT CASE WHEN prosrc ~ 'POST-CAT-002: a member' THEN 'on (B2)' ELSE 'off (B1)' END FROM pg_proc WHERE proname='enforce_post_categories'")"
}
probe_is() {   # $1 pass|fail · $2 label · $3 PROBE file · $4 tag · [$5 expected text]
  run staging "$3"
  if [ "$1" = pass ]; then [ $rc -eq 0 ] && { echo "  PASS  PROBE passes — $2"; echo "$out" | grep -o 'PROBE PASS.*' | sed 's/^/        /' | cut -c1-230; } || { echo "  FAIL  PROBE should pass — $2"; echo "$out" | grep -E 'ERROR|^  [A-Z][0-9]' | head -4; fail=1; }
  else [ $rc -ne 0 ] && echo "$out" | grep -q "PROBE FAIL $4" && echo "$out" | grep -q "${5:-PROBE FAIL}" && { echo "  PASS  PROBE refuses — $2:"; echo "$out" | grep -E "PROBE FAIL $4: [A-Z][0-9]|^  [A-Z][0-9]" | grep -v RAISE | sed 's/.*ERROR: */        /; s/^  /          /' | head -4; } || { echo "  FAIL  PROBE should refuse — $2"; echo "$out" | grep -E 'ERROR|NOTICE|^  [A-Z][0-9]' | tail -3; fail=1; }; fi; }
