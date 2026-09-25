#!/usr/bin/env bash
# ===========================================================================
# D1 · P32 UNITS 0034 / 0035 · C-34 HARNESS — SCRATCH PostgreSQL 17 ONLY.
# No staging connection. No production connection. No dispatch.
# Both files run UNMODIFIED; p32.lane comes from OUTSIDE via PGOPTIONS.
# ===========================================================================
set -uo pipefail
UNIT=${1:?unit}
ROOT=${2:-/home/claude/repo}
PGBIN=${PGBIN:-/usr/lib/postgresql/17/bin}
H=127.0.0.1; P=5432; DB=p32
case "$UNIT" in
  0034) STEM=20260910_0034_p32_service_role_only; N=27; AUTH_AFTER=f; RB_ROLES="anon, authenticated";;
  0035) STEM=20260910_0035_p32_authenticated_only; N=25; AUTH_AFTER=t; RB_ROLES="anon";;
esac
APPLY="$ROOT/supabase/migrations/$STEM.sql"; RB="$ROOT/supabase/rollback/${STEM}_ROLLBACK.sql"
FAILED=0
ok(){ if [ "$2" = "$3" ]; then printf '  PASS  %-56s %s\n' "$1" "$2"; else printf '  FAIL  %-56s got=%s want=%s\n' "$1" "$2" "$3"; FAILED=1; fi; }
q(){ "$PGBIN/psql" -X -q -A -t -h $H -p $P -U postgres -d $DB -c "$1" 2>&1; }
run(){ PGOPTIONS="$1" "$PGBIN/psql" -X -q -h $H -p $P -U postgres -d $DB -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f "$2" 2>&1; }
runn(){ "$PGBIN/psql" -X -q -h $H -p $P -U postgres -d $DB -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f "$2" 2>&1; }
build(){ "$PGBIN/dropdb" -h $H -p $P -U postgres --if-exists $DB >/dev/null 2>&1
         "$PGBIN/createdb" -h $H -p $P -U postgres $DB >/dev/null 2>&1
         "$PGBIN/psql" -X -q -h $H -p $P -U postgres -d $DB -v ON_ERROR_STOP=1 -f $ROOT/docs/evidence/d1/phase1/P32-0035-fixture.sql >/dev/null 2>&1; }

# The unit's signatures, straight from the verified TSV.
SIGS=$(awk -F'\t' -v u="$UNIT" '$1==u {printf "%s(%s)\n", $2, $3}' $ROOT/docs/evidence/d1/phase1/P32-0035-signatures-20260925.tsv)
SIGARR=$(printf '%s\n' "$SIGS" | sed "s/'/''/g; s/^/'/; s/\$/'/" | paste -sd, -)
RESOLVE="SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' = s"
CNT(){ q "SELECT count(*) FROM unnest(ARRAY[$SIGARR]) s WHERE has_function_privilege('$1', ($RESOLVE), 'EXECUTE')"; }
PUBN(){ q "SELECT count(*) FROM unnest(ARRAY[$SIGARR]) s, LATERAL (SELECT p.proacl FROM pg_proc p WHERE p.oid=($RESOLVE)) pp, LATERAL aclexplode(pp.proacl) a WHERE a.grantee=0"; }
ACLQ="SELECT s||' :: '||coalesce((SELECT string_agg(x::text,',' ORDER BY x::text) FROM pg_proc p, unnest(p.proacl) x WHERE p.oid=($RESOLVE)),'(null)') FROM unnest(ARRAY[$SIGARR]) s ORDER BY 1"

anon_calls(){ python3 $ROOT/docs/evidence/d1/phase1/P32-0035-callall.py "$UNIT" "$PGBIN" "$H" "$P" "$DB" "$1"; }

echo "==========================================================================="
echo " D1 · P32 UNIT $UNIT · C-34 — scratch PostgreSQL 17 only."
echo "==========================================================================="
echo; build
echo "-- SERVER"; echo "   $(q 'SELECT version()')"
MAJ=$(q "SELECT current_setting('server_version_num')::int/10000"); ok "server major >= 17" "$([ "${MAJ:-0}" -ge 17 ] && echo yes||echo no)" yes
echo
echo "-- FIXTURE SHAPE"
ok "all $N signatures resolve" "$(q "SELECT count(*) FROM unnest(ARRAY[$SIGARR]) s WHERE ($RESOLVE) IS NOT NULL")" "$N"
ok "all SECURITY DEFINER" "$(q "SELECT count(*) FROM unnest(ARRAY[$SIGARR]) s JOIN pg_proc p ON p.oid=($RESOLVE) WHERE p.prosecdef")" "$N"
ok "all VOLATILE" "$(q "SELECT count(*) FROM unnest(ARRAY[$SIGARR]) s JOIN pg_proc p ON p.oid=($RESOLVE) WHERE p.provolatile='v'")" "$N"
ok "PUBLIC entries before" "$(PUBN)" "$N"
echo
echo "-- ROW 4  C-34 BEFORE"
B=$(anon_calls anon); set -- $B
ok "anon executes N/N" "$1" "$N"; ok "  denied 42501" "$2" 0; ok "  other errors" "$3" 0
ok "rows written FOR anon" "$(q "SELECT count(*) FROM public.p32_probe WHERE who='anon'")" "$N"
ok "  all of them RAN AS postgres" "$(q "SELECT count(*) FROM public.p32_probe WHERE who='anon' AND ran_as='postgres'")" "$N"
echo
echo "-- ROW 4  APPLY (lane=staging), then the same calls"
OUT=$(run "-c p32.lane=staging" "$APPLY"); RC=$?
ok "apply exit status" "$RC" 0
A=$(anon_calls anon); set -- $A
ok "anon executes 0/N" "$1" 0; ok "  denied 42501" "$2" "$N"; ok "  other errors" "$3" 0
ok "anon EXECUTE count" "$(CNT anon)" 0
ok "PUBLIC entries" "$(PUBN)" 0
ok "authenticated EXECUTE count" "$(CNT authenticated)" "$([ $AUTH_AFTER = t ] && echo $N || echo 0)"
ok "service_role EXECUTE count" "$(CNT service_role)" "$N"
ok "the $N COMMENTs landed" "$(q "SELECT count(*) FROM unnest(ARRAY[$SIGARR]) s WHERE obj_description(($RESOLVE),'pg_proc') LIKE 'P32 $UNIT:%'")" "$N"
A2=$(anon_calls authenticated); set -- $A2
ok "authenticated executes" "$1" "$([ $AUTH_AFTER = t ] && echo $N || echo 0)"
S2=$(anon_calls service_role); set -- $S2
ok "service_role executes N/N" "$1" "$N"
POST_ACL=$(q "$ACLQ")
echo
echo "-- ROW 7  DEFINER-WRAPPER SMOKE TEST (after the revoke)"
W=$(q "SET ROLE authenticated; SELECT public.definer_wrapper_smoke()")
ok "a postgres-owned DEFINER wrapper still succeeds as authenticated" "$W" "t"
IV=$("$PGBIN/psql" -X -q -A -t -h $H -p $P -U postgres -d $DB -v VERBOSITY=verbose -c "SET ROLE authenticated; SELECT public.invoker_wrapper_smoke()" 2>&1 | sed -nE 's/.*ERROR:[[:space:]]+([0-9A-Z]{5}):.*/\1/p' | head -1)
if [ "$UNIT" = 0034 ]; then
  ok "  and the INVOKER wrapper is refused (42501) — the contrast that makes it mean something" "${IV:-none}" "42501"
else
  ok "  (0035 keeps authenticated, so the INVOKER wrapper also succeeds)" "$(q "SET ROLE authenticated; SELECT public.invoker_wrapper_smoke()")" "t"
fi
echo
echo "-- ROW 5  LANE"
build; BASE_ACL=$(q "$ACLQ")
OUT=$(runn "" "$APPLY"); RC=$?
ok "unset: refuses" "$([ $RC -ne 0 ] && echo refused||echo proceeded)" refused
ok "unset: ACL unchanged" "$([ "$(q "$ACLQ")" = "$BASE_ACL" ] && echo yes||echo no)" yes
for bad in "Staging" " staging"; do
  build; OUT=$(run "-c p32.lane=$(printf '%q' "$bad")" "$APPLY"); RC=$?
  ok "'$bad': refuses, ACL unchanged" "$([ $RC -ne 0 ] && [ "$(q "$ACLQ")" = "$BASE_ACL" ] && echo yes||echo no)" yes
done
build; run "-c p32.lane=staging" "$APPLY" >/dev/null; ok "'staging': proceeds (anon 0)" "$(CNT anon)" 0
build; run "-c p32.lane=production" "$APPLY" >/dev/null; ok "'production': proceeds (anon 0)" "$(CNT anon)" 0
OUT=$(run "-c p32.lane=production" "$RB"); RC=$?
ok "rollback on 'production': REFUSES (staging-only)" "$([ $RC -ne 0 ] && echo refused||echo proceeded)" refused
OUT=$(runn "" "$RB"); RC=$?
ok "rollback unset: refuses" "$([ $RC -ne 0 ] && echo refused||echo proceeded)" refused
echo
echo "-- ROW 6  IDEMPOTENCE AND ROUND TRIP"
build; run "-c p32.lane=staging" "$APPLY" >/dev/null; A1=$(q "$ACLQ")
OUT=$(run "-c p32.lane=staging" "$APPLY"); ok "second apply succeeds" "$?" 0
ok "  ACL identical" "$([ "$(q "$ACLQ")" = "$A1" ] && echo yes||echo no)" yes
PRE=$(build; q "$ACLQ")
build; PREACL=$(q "$ACLQ"); run "-c p32.lane=staging" "$APPLY" >/dev/null
OUT=$(run "-c p32.lane=staging" "$RB"); ok "rollback succeeds" "$?" 0
ok "  anon regains EXECUTE N/N" "$(CNT anon)" "$N"
ok "  authenticated N/N" "$(CNT authenticated)" "$N"
ok "  PUBLIC still 0 (deliberately not restored)" "$(PUBN)" 0
ok "  so the restored ACL is NOT the pre-state" "$([ "$(q "$ACLQ")" = "$PREACL" ] && echo same||echo different)" different
OUT=$(run "-c p32.lane=staging" "$APPLY"); ok "apply again succeeds" "$?" 0
ok "  identical to the first post-state" "$([ "$(q "$ACLQ")" = "$A1" ] && echo yes||echo no)" yes
OUT=$(run "-c p32.lane=staging" "$RB"); run "-c p32.lane=staging" "$RB" >/dev/null 2>&1
OUT=$(run "-c p32.lane=staging" "$RB"); RC=$?
ok "a second consecutive rollback refuses" "$([ $RC -ne 0 ] && echo refused||echo proceeded)" refused
ok "  with the rollback precondition code" "$(printf '%s' "$OUT" | grep -qi "P32-$UNIT-RB-PRE-002" && echo yes||echo no)" yes
build; OUT=$(run "-c p32.lane=staging" "$RB"); RC=$?
ok "rollback against the PRE-apply state refuses" "$([ $RC -ne 0 ] && echo refused||echo proceeded)" refused
ok "  and changed nothing" "$([ "$(q "$ACLQ")" = "$BASE_ACL" ] && echo yes||echo no)" yes
echo
echo "==========================================================================="
echo " OVERALL: $([ $FAILED -eq 0 ] && echo 'ALL CHECKS PASS' || echo '*** ONE OR MORE CHECKS FAILED')"
echo "==========================================================================="
exit $FAILED
