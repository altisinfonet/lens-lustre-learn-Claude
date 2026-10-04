#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# 20261003_0002_user_blocks_hardening — the C-34 harness (fail first, then pass).
#
# Every apply/rollback/probe run goes through docs/evidence/d1/phase1/p1-0037-runit2.sh,
# the extracted "Run it" step of apply-migration.yml (R-13): one psql session,
# ON_ERROR_STOP=1, -c "SET p32.lane = '<lane>';" then -f — exactly as dispatched.
#
# State under test: ub-0002-fixture.sql (shapes read from staging), then
# 20261003_0001_user_blocks.sql VERBATIM (the file on main 566fe1b).
#
# SCRATCH CLUSTER ONLY. Never point PGHOST at staging or production.
#   PGPORT=5433 bash docs/evidence/d1/user-blocks/ub-0002-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=ub0002
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
# 0001 and its PROBE are taken BY BLOB HASH (main 566fe1b = staging carry #324),
# so the test runs against those exact bytes whichever branch is checked out.
M1="$T/20261003_0001_user_blocks.sql"
P1="$T/PROBE_user_blocks_closed.sql"
git -C "$ROOT" cat-file blob ecccb6ebcff7772bbb88309f14092c60a90a15cf > "$M1" || { echo "0001 blob not in this clone: git fetch origin main"; exit 2; }
git -C "$ROOT" cat-file blob e28abe844ea38acf5112bd0b0667a4538bb5627c > "$P1" || exit 2
M2="$ROOT/supabase/migrations/20261003_0002_user_blocks_hardening.sql"
RB2="$ROOT/supabase/rollback/20261003_0002_user_blocks_hardening_ROLLBACK.sql"
P2="$ROOT/supabase/migrations/PROBE_user_blocks_hardened.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
fail=0
A=aaaaaaaa-0000-4000-8000-00000000000a; B=bbbbbbbb-0000-4000-8000-00000000000b
C=cccccccc-0000-4000-8000-00000000000c; D=dddddddd-0000-4000-8000-00000000000d
M=eeeeeeee-0000-4000-8000-0000000000ee
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
build() { dropdb --force --if-exists "$DB" >/dev/null 2>&1; createdb "$DB" || return 1
          psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/ub-0002-fixture.sql" >/dev/null || return 1
          psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$M1" >/dev/null 2>&1; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" 5432 2>&1); rc=$?; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }
ok()  { local what="$1"; run "$2" "$3"
  if [ "$rc" -eq 0 ]; then echo "  PASS  $what — exit 0"; printf '%s\n' "$out" | grep -E 'NOTICE' | sed 's/^/        /'
  else echo "  FAIL  $what — exit $rc"; printf '%s\n' "$out" | grep -E 'ERROR|FAIL' | head -3 | sed 's/^/        /'; fail=1; fi; }
refused() { local what="$1" needle="$2"; run "$3" "$4"
  if [ "$rc" -eq 0 ]; then echo "  FAIL  $what — ACCEPTED (exit 0)"; fail=1
  elif ! printf '%s' "$out" | grep -E 'ERROR' | grep -q -- "$needle"; then echo "  FAIL  $what — refused, but not with '$needle'"; printf '%s\n' "$out" | grep ERROR | head -2 | sed 's/^/        /'; fail=1
  else echo "  PASS  $what — refused (exit $rc):"; printf '%s\n' "$out" | grep -m1 -E 'ERROR' | cut -c1-170 | sed 's/^/        /'; fi; }
# as <uuid|anon> <sql>: one statement as that member, the way PostgREST runs it.
as() { local who="$1" sql="$2" role=authenticated
  [ "$who" = anon ] && role=anon
  psql -q -X -d "$DB" -tA -v ON_ERROR_STOP=1 2>&1 <<SQL
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"$who","role":"$role"}', true) \\g /dev/null
SELECT set_config('request.jwt.claim.sub', '$( [ "$who" = anon ] && echo "" || echo "$who")', true) \\g /dev/null
SET LOCAL ROLE $role;
$sql;
COMMIT;
SQL
}
notices() { q "SELECT count(*) FROM public.admin_notifications WHERE type='user_blocked' AND reference_id='$1'"; }
mutate() { python3 - "$1" "$2" "$3" "$4" <<'PY'
import sys; src, dst, old, new = sys.argv[1:5]; s = open(src).read()
assert s.count(old) == 1, ('mutation anchor not unique', old[:60]); open(dst, 'w').write(s.replace(old, new))
PY
}

step "0 · fixture + 20261003_0001 verbatim"
q "SELECT '  server_version '||current_setting('server_version')" 2>/dev/null || psql -q -X -d postgres -tAc "SELECT '  server_version '||current_setting('server_version')"
build && echo "  PASS  fixture built, 0001 applied" || { echo "  FAIL  fixture/0001"; exit 2; }
F1=$(q "SELECT prosrc FROM pg_proc WHERE oid='public.notify_admin_user_blocked()'::regprocedure" | md5sum | cut -c1-12)
echo "  0001 function body md5 $F1"

step "1 · FAIL FIRST — the old PROBE passes a USING (true) table; the new PROBE does not pass 0001"
ok "old PROBE_user_blocks_closed on the 0001 state" staging "$P1"
q "DROP POLICY user_blocks_select_own ON public.user_blocks; CREATE POLICY user_blocks_select_own ON public.user_blocks FOR SELECT TO authenticated USING (true)"
ok "old PROBE on 0001 with user_blocks_select_own = USING (true)  ← the hole SEC-UB-2 names" staging "$P1"
v=$(as "$B" "SELECT count(*) FROM public.user_blocks"); q "INSERT INTO public.user_blocks VALUES ('$A','$C')" >/dev/null
v=$(as "$B" "SELECT count(*) FROM public.user_blocks WHERE blocker_id='$A'")
want "$v" "1" "…and under that policy member B really reads member A's block (the leak the old PROBE missed)"
build >/dev/null 2>&1
refused "new PROBE on the 0001 state" "PROBE FAIL S2" staging "$P2"
# flood under 0001: block, unblock, block, unblock, block = 3 notices
for s in "INSERT INTO public.user_blocks VALUES ('$A','$B')" "DELETE FROM public.user_blocks WHERE blocked_id='$B'" \
         "INSERT INTO public.user_blocks VALUES ('$A','$B')" "DELETE FROM public.user_blocks WHERE blocked_id='$B'" \
         "INSERT INTO public.user_blocks VALUES ('$A','$B')"; do as "$A" "$s" >/dev/null; done
want "$(notices "$B")" "3" "SEC-UB-1 under 0001: block/unblock ×3 writes 3 notices (the flood)"
r=$(as "$D" "INSERT INTO public.user_blocks VALUES ('$D','$A')" | grep -o 'violates foreign key constraint' | head -1)
want "$r" "violates foreign key constraint" "SEC-UB-3 under 0001: a deleted account's insert passes RLS and stops only at the FK"

step "2 · lane assertion"
build >/dev/null 2>&1
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$M2" 2>&1); rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "APPLY REFUSED"; then echo "  PASS  0002 with no lane set — refused: APPLY REFUSED"; else echo "  FAIL  0002 without lane (rc=$rc)"; fail=1; fi
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -c "SET p32.lane='dev';" -f "$M2" 2>&1); rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "APPLY REFUSED"; then echo "  PASS  0002 with p32.lane='dev' — refused"; else echo "  FAIL  0002 lane=dev (rc=$rc)"; fail=1; fi
want "$(q "SELECT count(*) FROM pg_policies WHERE tablename='user_blocks'")" "4" "after both refusals the 0001 policy set is untouched (4)"
want "$(q "SELECT to_regclass('public.user_block_notices') IS NULL")" "t" "…and no ledger table was created"
dropdb --force --if-exists "$DB" >/dev/null 2>&1; createdb "$DB"; psql -q -X -d "$DB" -f "$HERE/ub-0002-fixture.sql" >/dev/null
refused "0002 on a database where 0001 never ran" "UB-0002-PRE-001" staging "$M2"

step "3 · apply on staging lane, then the new PROBE"
build >/dev/null 2>&1
q "INSERT INTO public.user_blocks VALUES ('$C','$A')" >/dev/null   # a pre-existing block survives
ok "0002 apply (lane staging)" staging "$M2"
want "$(q "SELECT string_agg(policyname||':'||permissive||':'||cmd, ', ' ORDER BY policyname) FROM pg_policies WHERE tablename='user_blocks'")" \
  "Deleted accounts cannot delete:RESTRICTIVE:DELETE, Deleted accounts cannot insert:RESTRICTIVE:INSERT, Deleted accounts cannot update:RESTRICTIVE:UPDATE, user_blocks_delete_own:PERMISSIVE:DELETE, user_blocks_insert_own:PERMISSIVE:INSERT, user_blocks_select:PERMISSIVE:SELECT" \
  "policy set = one SELECT + INSERT + DELETE + 3 restrictive"
echo "  user_blocks_select qual: $(q "SELECT qual FROM pg_policies WHERE policyname='user_blocks_select'")"
want "$(q "SELECT count(*) FROM public.user_blocks WHERE blocker_id='$C'")" "1" "the pre-existing block row is untouched"
ok "new PROBE after 0002" staging "$P2"
want "$(q "SELECT count(*) FROM public.user_blocks")||$(q "SELECT count(*) FROM public.user_block_notices")||$(q "SELECT count(*) FROM public.admin_notifications")" \
  "1||0||1" "the PROBE left nothing behind (1 block, 0 ledger rows, 1 notice — all from before it)"
refused "old PROBE_user_blocks_closed after 0002 (superseded: counts 4 policies)" "expected 4 policies" staging "$P1"
refused "0002 a second time" "UB-0002-PRE-002" staging "$M2"

step "4 · behaviour after 0002, member by member (PostgREST-shaped sessions)"
want "$(as "$A" "SELECT count(*) FROM public.user_blocks")" "0" "A sees 0 rows (C's block of A is C's, not A's)"
want "$(as "$C" "SELECT count(*) FROM public.user_blocks")" "1" "C sees its own 1 row"
want "$(as "$M" "SELECT count(*) FROM public.user_blocks")" "1" "admin M sees all rows (1)"
want "$(as anon "SELECT count(*) FROM public.user_blocks" | grep -o 'permission denied[a-z _]*' )" "permission denied for table user_blocks" "anon: permission denied"
n0=$(notices "$B")
as "$A" "INSERT INTO public.user_blocks VALUES ('$A','$B')" >/dev/null
want "$(as "$A" "INSERT INTO public.user_blocks VALUES ('$A','$B')" | grep -o 'duplicate key value violates unique constraint' | head -1)" "duplicate key value violates unique constraint" "re-block = 23505 (the client treats it as success) — unchanged"
for i in 1 2 3; do as "$A" "DELETE FROM public.user_blocks WHERE blocked_id='$B'" >/dev/null; as "$A" "INSERT INTO public.user_blocks VALUES ('$A','$B')" >/dev/null; done
want "$(( $(notices "$B") - n0 ))" "1" "SEC-UB-1: block + 3× unblock/block within 24 h = 1 notice (was 4 under 0001)"
q "UPDATE public.user_block_notices SET notified_at = now() - interval '24 hours 1 second' WHERE blocker_id='$A' AND blocked_id='$B'"
as "$A" "DELETE FROM public.user_blocks WHERE blocked_id='$B'" >/dev/null; as "$A" "INSERT INTO public.user_blocks VALUES ('$A','$B')" >/dev/null
want "$(( $(notices "$B") - n0 ))" "2" "…and after 24 h the same pair notifies again (2)"
as "$C" "INSERT INTO public.user_blocks VALUES ('$C','$B')" >/dev/null
want "$(( $(notices "$B") - n0 ))" "3" "a different blocker of B is a different pair: notified (3)"
want "$(as "$B" "DELETE FROM public.user_blocks WHERE blocker_id='$A' RETURNING 1" | grep -c '^1$')" "0" "B cannot delete A's block (0 rows)"
want "$(as "$B" "INSERT INTO public.user_blocks VALUES ('$A','$C')" | grep -o 'row-level security' | head -1)" "row-level security" "B cannot insert a block in A's name (RLS)"
want "$(as "$D" "INSERT INTO public.user_blocks VALUES ('$D','$A')" | grep -o 'row-level security' | head -1)" "row-level security" "SEC-UB-3: deleted account D refused by RLS (was FK error under 0001)"
want "$(as "$A" "SELECT count(*) FROM public.user_block_notices" | grep -o 'permission denied[a-z _]*')" "permission denied for table user_block_notices" "a member cannot read the ledger"
want "$(as "$A" "SELECT public.notify_admin_user_blocked()" | grep -o 'permission denied[a-z _]*' )" "permission denied for function notify_admin_user_blocked" "a member cannot call the trigger function"

step "5 · the PROBE fails on every hole it is meant to catch (mutants of 0002)"
mut() { local name="$1" old="$2" new="$3" needle="$4" probe="${5:-$P2}"
  mutate "$M2" "$T/m.sql" "$old" "$new" || { echo "  FAIL  mutation $name did not apply"; fail=1; return; }
  # mutants must still pass 0002's own POST checks where the mutation is outside them; strip POST so the PROBE is what is tested
  python3 - "$T/m.sql" <<'PY'
import re,sys; p=sys.argv[1]; s=open(p).read()
s=re.sub(r'DO \$postconditions\$.*?\$postconditions\$;', '', s, flags=re.S); open(p,'w').write(s)
PY
  build >/dev/null 2>&1; run staging "$T/m.sql"
  [ "$rc" -eq 0 ] || { echo "  FAIL  mutant $name did not apply: $(printf '%s' "$out" | grep -m1 ERROR)"; fail=1; return; }
  refused "PROBE on mutant: $name" "$needle" staging "$probe"; }
mut "SELECT policy USING (true)" \
  "    blocker_id = (SELECT auth.uid())
    OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))" "true" "PROBE FAIL S2"
# the behavioural half on its own: same mutant, PROBE with the static S2 check removed
mutate "$P2" "$T/p_nos2.sql" "  IF n <> 1 OR q NOT LIKE '%blocker_id = ( SELECT auth.uid()%' OR q NOT LIKE '%has_role(( SELECT auth.uid()%' THEN" "  IF false THEN"
mut "SELECT policy USING (true) — PROBE without S2 (behaviour must catch it alone)" \
  "    blocker_id = (SELECT auth.uid())
    OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))" "true" "PROBE FAIL B3" "$T/p_nos2.sql"
mut "no 24 h cap" "   WHERE n.notified_at <= EXCLUDED.notified_at - interval '24 hours';" "   WHERE true;" "PROBE FAIL B9"
mutate "$P2" "$T/p_nos5.sql" "  IF n <> 3 THEN
    RAISE EXCEPTION 'PROBE FAIL S5" "  IF false THEN
    RAISE EXCEPTION 'PROBE FAIL S5"
mut "no restrictive INSERT guard — PROBE without S5" "CREATE POLICY \"Deleted accounts cannot insert\" ON public.user_blocks
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.account_is_live()));" "" "PROBE FAIL B7" "$T/p_nos5.sql"
mut "ledger readable by authenticated" "REVOKE ALL ON public.user_block_notices FROM authenticated;" "GRANT SELECT ON public.user_block_notices TO authenticated;" "PROBE FAIL S7"

step "6 · rollback: lane guard, exact return to 0001, data kept"
build >/dev/null 2>&1; run staging "$M2"
as "$A" "INSERT INTO public.user_blocks VALUES ('$A','$B')" >/dev/null
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB2" 2>&1); rc=$?
if [ $rc -ne 0 ] && printf '%s' "$out" | grep -q "ROLLBACK REFUSED"; then echo "  PASS  rollback with no lane — refused"; else echo "  FAIL  rollback without lane (rc=$rc)"; fail=1; fi
ok "rollback (lane production — the guard admits both lanes)" production "$RB2"
want "$(q "SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies WHERE tablename='user_blocks'")" \
  "user_blocks_delete_own,user_blocks_insert_own,user_blocks_select_admin,user_blocks_select_own" "policies = 0001's four"
want "$(q "SELECT prosrc FROM pg_proc WHERE oid='public.notify_admin_user_blocked()'::regprocedure" | md5sum | cut -c1-12)" "$F1" "function body = 0001's, byte for byte (md5)"
want "$(q "SELECT count(*) FROM public.user_blocks")||$(q "SELECT count(*) FROM public.user_block_notices")" "1||1" "member data kept: the block row and the ledger row both survive"
ok "old PROBE_user_blocks_closed passes again after the rollback" staging "$P1"
refused "rollback a second time" "UB-0002-RB-PRE-001" staging "$RB2"
ok "re-apply 0002 after the rollback (ledger reused)" staging "$M2"
want "$(q "SELECT count(*) FROM public.user_block_notices")" "1" "the kept ledger row is reused, not duplicated"
ok "new PROBE after re-apply" production "$P2"

step "7 · static: no member data is dropped anywhere in 0002 or its rollback"
want "$(grep -ciE '^[[:space:]]*(DROP (TABLE|SCHEMA)|TRUNCATE|DELETE FROM)' "$M2" "$RB2" | awk -F: '{s+=$2} END {print s}')" "0" "no DROP TABLE / TRUNCATE / DELETE statement in either file"

echo
[ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"
exit $fail
