#!/usr/bin/env bash
# C-34 for the 0044 static scan. Each mutant breaks ONE property; the scan must
# exit non-zero and name that check.
#
#   bash docs/evidence/d1/phase1/p33-0044-sqlscan-falsify.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260910_0044_p33_plpgsql_check_out_of_public.sql"
RB="$ROOT/supabase/rollback/20260910_0044_p33_plpgsql_check_out_of_public_ROLLBACK.sql"
PRB="$ROOT/supabase/migrations/PROBE_p33_0044_plpgsql_check_readonly.sql"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
mutate() {
  local name="$1" which="$2" expr="$3" want="$4" out rc
  cp "$MIG" "$T/m.sql"; cp "$RB" "$T/r.sql"; cp "$PRB" "$T/p.sql"
  case "$which" in mig) sed -i "$expr" "$T/m.sql";; rb) sed -i "$expr" "$T/r.sql";; probe) sed -i "$expr" "$T/p.sql";; esac
  out=$(cd "$ROOT" && python3 "$HERE/p33-0044-sqlscan.py" --mig "$T/m.sql" --rb "$T/r.sql" --probe "$T/p.sql" 2>&1); rc=$?
  if [ "$rc" -eq 0 ]; then echo "  NOT FALSIFIABLE  $name — the scan still passed"; fail=1
  elif ! printf '%s' "$out" | grep -q "FAIL.*$want"; then
    echo "  WRONG CHECK      $name — failed, but not on '$want'"
    printf '%s\n' "$out" | grep FAIL | sed 's/^/        /'; fail=1
  else echo "  RED as required  $name  →  $(printf '%s' "$out" | grep -m1 "FAIL.*$want" | sed 's/^ *//' | cut -c1-150)"; fi
}

echo "C-34 FALSIFICATION OF docs/evidence/d1/phase1/p33-0044-sqlscan.py"
(cd "$ROOT" && python3 "$HERE/p33-0044-sqlscan.py" >/dev/null 2>&1) \
  && echo "  PASS  control — the real files pass" || { echo "  FAIL  control"; fail=1; }
echo

mutate "the DROP becomes CASCADE"                      mig 's|^DROP EXTENSION plpgsql_check RESTRICT;|DROP EXTENSION plpgsql_check CASCADE;|' 'exactly one DROP EXTENSION'
mutate "RESTRICT is dropped (implicit, not spelled out)" mig 's|^DROP EXTENSION plpgsql_check RESTRICT;|DROP EXTENSION plpgsql_check;|'       'exactly one DROP EXTENSION'
mutate "the CREATE pins a guessed VERSION"             mig "s|^CREATE EXTENSION plpgsql_check WITH SCHEMA extensions;|CREATE EXTENSION plpgsql_check WITH SCHEMA extensions VERSION '2.8';|" 'no VERSION clause'
mutate "the CREATE targets the wrong schema"           mig 's|^CREATE EXTENSION plpgsql_check WITH SCHEMA extensions;|CREATE EXTENSION plpgsql_check WITH SCHEMA public;|' 'exactly one CREATE EXTENSION'
mutate "the move is attempted with SET SCHEMA"         mig 's|^DROP EXTENSION plpgsql_check RESTRICT;|ALTER EXTENSION plpgsql_check SET SCHEMA extensions;\nDROP EXTENSION plpgsql_check RESTRICT;|' 'no ALTER EXTENSION'
mutate "another extension is touched"                  mig 's|^COMMIT;|DROP EXTENSION pg_trgm RESTRICT;\nCOMMIT;|' 'exactly one DROP EXTENSION'
mutate "a GRANT is smuggled in"                        mig 's|^COMMIT;|GRANT USAGE ON SCHEMA extensions TO anon;\nCOMMIT;|' 'no GRANT and no REVOKE'
mutate "the migration becomes two-lane"                mig "s|<> 'production'|NOT IN ('staging', 'production')|" "PRODUCTION-ONLY assertion"
mutate "the caller check regresses to the string only (the first draft)" mig 's|(p.prosrc ~\* member_rx OR p.prosrc ILIKE|(p.prosrc ILIKE|' 'MEMBER NAMES'
mutate "the version postcondition is removed"          mig 's|v IS DISTINCT FROM pre.version|false|' 'compares the version'
mutate "the rollback uses CASCADE"                     rb  's|^DROP EXTENSION plpgsql_check RESTRICT;|DROP EXTENSION plpgsql_check CASCADE;|' 'exactly one DROP EXTENSION'
mutate "the rollback is re-pointed at staging (R-9 misapplied)" rb "s|<> 'production'|<> 'staging'|" "PRODUCTION-ONLY assertion"
mutate "the probe gains a write"                       probe 's|^COMMIT;|UPDATE pg_catalog.pg_extension SET extversion = extversion WHERE false;\nCOMMIT;|' 'the probe is BEGIN, one read-only query'

echo
if [ "$fail" -eq 0 ]; then echo "  ALL THIRTEEN MUTANTS CAUGHT"; else echo "  FAILURES ABOVE"; fi
exit "$fail"
