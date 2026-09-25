#!/usr/bin/env bash
# ===========================================================================
# D1 · R-23 · C-34 HARNESS — SCRATCH PostgreSQL 17 ONLY.
#
# No staging connection. No production connection. No dispatch.
#
# Both 0032 files run UNMODIFIED from the working tree, with p32.lane supplied
# from OUTSIDE the file via PGOPTIONS — never by an edit and never by a
# stand-in statement.
#
# The cluster:
#   apt-get install -y postgresql-17          # PGDG, Ubuntu 24.04 noble-pgdg
#   initdb -D /tmp/ud/pg17/data -U postgres
#   echo 'host all all 127.0.0.1/32 trust' >> /tmp/ud/pg17/data/pg_hba.conf
#   pg_ctl -D /tmp/ud/pg17/data \
#          -o '-p 5432 -k /tmp/ud/pg17 -c listen_addresses=127.0.0.1' start
# ===========================================================================
set -uo pipefail

REPO=${REPO:-/home/claude/repo}
PGBIN=${PGBIN:-/usr/lib/postgresql/17/bin}
HOSTP=${HOSTP:-127.0.0.1}
PORT=${PORT:-5432}
DB=${DB:-r23}
FIXTURE="$REPO/docs/evidence/d1/phase1/R23-fixture.sql"
APPLY="$REPO/supabase/migrations/20260910_0032_p32_money_account_control_revoke.sql"
RB="$REPO/supabase/rollback/20260910_0032_p32_money_account_control_revoke_ROLLBACK.sql"

C="-h $HOSTP -p $PORT -U postgres"
FAILED=0
ok(){ if [ "$2" = "$3" ]; then printf '  PASS  %-58s %s\n' "$1" "$2"; else printf '  FAIL  %-58s got=%s want=%s\n' "$1" "$2" "$3"; FAILED=1; fi; }

q(){   "$PGBIN/psql" -X -q -A -t $C -d "$DB" -c "$1" 2>&1; }
run(){ PGOPTIONS="$1" "$PGBIN/psql" -X -q $C -d "$DB" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f "$2" 2>&1; }
runn(){ "$PGBIN/psql" -X -q $C -d "$DB" -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f "$2" 2>&1; }
build(){ "$PGBIN/dropdb" $C --if-exists "$DB" >/dev/null 2>&1
         "$PGBIN/createdb" $C "$DB" >/dev/null 2>&1
         "$PGBIN/psql" -X -q $C -d "$DB" -v ON_ERROR_STOP=1 -f "$FIXTURE" >/dev/null 2>&1; }

SIGS="'public.admin_delete_auth_user(uuid)','public.admin_purge_orphan_user_data(uuid)','public.admin_reject_wallet_transaction(uuid, uuid, text)','public.admin_wallet_credit(uuid, uuid, numeric, text, text, uuid, text, jsonb)','public.approve_deposit(uuid, uuid)','public.create_pending_deposit(uuid, numeric, text, text, jsonb, text)','public.expire_gift_credit(uuid)','public.request_withdrawal(numeric, jsonb)','public.soft_void_wallet_transactions(uuid[], text, uuid)','public.wallet_ledger_apply_v2(text, uuid, numeric, text, text, text, text, boolean)','public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb)'"

# The full ACL of the eleven, as a set, one line each.
ACLQ="SELECT p.proname||' :: '||coalesce((SELECT string_agg(x::text,',' ORDER BY x::text) FROM unnest(p.proacl) x),'(null)') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.oid IN (SELECT to_regprocedure(s) FROM unnest(ARRAY[$SIGS]) s) ORDER BY 1"
CNT(){ q "SELECT count(*) FROM unnest(ARRAY[$SIGS]) s WHERE has_function_privilege('$1', to_regprocedure(s), 'EXECUTE')"; }
PUBN(){ q "SELECT count(*) FROM unnest(ARRAY[$SIGS]) s, LATERAL (SELECT p.proacl FROM pg_proc p WHERE p.oid=to_regprocedure(s)) pp, LATERAL aclexplode(pp.proacl) a WHERE a.grantee=0"; }

# Call all eleven AS anon, one statement each; count how many succeed.
anon_calls(){
python3 - "$PGBIN" "$HOSTP" "$PORT" "$DB" <<'PY'
import subprocess, sys
PGBIN, H, P, DB = sys.argv[1:5]
CALLS = [
 "SELECT public.admin_delete_auth_user('00000000-0000-0000-0000-000000000001'::uuid)",
 "SELECT public.admin_purge_orphan_user_data('00000000-0000-0000-0000-000000000001'::uuid)",
 "SELECT public.admin_reject_wallet_transaction('00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-000000000002'::uuid,'r')",
 "SELECT public.admin_wallet_credit('00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-000000000002'::uuid,1::numeric,'t','d',NULL::uuid,'rt','{}'::jsonb)",
 "SELECT public.approve_deposit('00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-000000000002'::uuid)",
 "SELECT public.create_pending_deposit('00000000-0000-0000-0000-000000000001'::uuid,1::numeric,'g','r','{}'::jsonb,'k')",
 "SELECT public.expire_gift_credit('00000000-0000-0000-0000-000000000001'::uuid)",
 "SELECT public.request_withdrawal(1::numeric,'{}'::jsonb)",
 "SELECT public.soft_void_wallet_transactions(ARRAY['00000000-0000-0000-0000-000000000001'::uuid],'r',NULL::uuid)",
 "SELECT public.wallet_ledger_apply_v2('op',NULL::uuid,1::numeric,'k','d','r','sp',true)",
 "SELECT public.wallet_transaction('00000000-0000-0000-0000-000000000001'::uuid,'t',1::numeric,'d',NULL::uuid,'rt','{}'::jsonb)",
]
succ = 0; denied = 0; other = []
for c in CALLS:
    r = subprocess.run([f"{PGBIN}/psql","-X","-q","-A","-t","-h",H,"-p",P,"-U","postgres","-d",DB,
                        "-v","VERBOSITY=verbose","-c",f"SET ROLE anon; {c};"],
                       capture_output=True, text=True)
    out = r.stdout + r.stderr
    if r.returncode == 0 and "ERROR" not in out: succ += 1
    elif "42501" in out: denied += 1
    else: other.append(out.strip().split("\n")[0][:80])
print(f"{succ} {denied} {len(other)}")
for o in other: print("      ?? " + o, file=sys.stderr)
PY
}

echo "==========================================================================="
echo " D1 · R-23 · C-34 — scratch PostgreSQL 17 only. No staging, no production."
echo "==========================================================================="
echo
build
echo "-- SERVER"
echo "   $(q 'SELECT version()')"
MAJ=$(q "SELECT current_setting('server_version_num')::int / 10000")
ok "server major version >= 17" "$([ "${MAJ:-0}" -ge 17 ] && echo yes || echo no)" "yes"
echo

# ── ROW 4a · the fixture reproduces the measured staging shape ────────────
echo "-- ROW 4  FIXTURE SHAPE (must reproduce the Step-1 staging measurement)"
ok "eleven functions resolve at the exact signatures" "$(q "SELECT count(*) FROM unnest(ARRAY[$SIGS]) s WHERE to_regprocedure(s) IS NOT NULL")" "11"
ok "all eleven SECURITY DEFINER" "$(q "SELECT count(*) FROM unnest(ARRAY[$SIGS]) s JOIN pg_proc p ON p.oid=to_regprocedure(s) WHERE p.prosecdef")" "11"
ok "all eleven VOLATILE" "$(q "SELECT count(*) FROM unnest(ARRAY[$SIGS]) s JOIN pg_proc p ON p.oid=to_regprocedure(s) WHERE p.provolatile='v'")" "11"
ok "ACL text equals the measured staging ACL on all eleven" \
   "$(q "SELECT count(*) FROM unnest(ARRAY[$SIGS]) s JOIN pg_proc p ON p.oid=to_regprocedure(s) WHERE p.proacl::text = '{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'")" "11"
ok "PUBLIC ACL entries present (grantee 0)" "$(PUBN)" "11"
echo

# ── F-62, demonstrated rather than cited ──────────────────────────────────
echo "-- F-62  'REVOKE ... FROM anon' ALONE WOULD HAVE BEEN A NO-OP"
q "REVOKE ALL ON FUNCTION public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb) FROM anon" >/dev/null
ok "after revoking anon ONLY, anon still holds EXECUTE (via PUBLIC)" \
   "$(q "SELECT has_function_privilege('anon','public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb)','EXECUTE')")" "t"
q "REVOKE ALL ON FUNCTION public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb) FROM PUBLIC" >/dev/null
ok "only after revoking PUBLIC as well does it become false" \
   "$(q "SELECT has_function_privilege('anon','public.wallet_transaction(uuid, text, numeric, text, uuid, text, jsonb)','EXECUTE')")" "f"
echo

# ── ROW 4b · BEFORE / AFTER ───────────────────────────────────────────────
echo "-- ROW 4  BEFORE 0032 — anon can execute all eleven, and the effect lands"
build
BEFORE=$(anon_calls 2>/dev/null); set -- $BEFORE
ok "anon calls that SUCCEEDED" "$1" "11"
ok "anon calls denied with 42501" "$2" "0"
ok "anon calls failing for some other reason" "$3" "0"
ok "rows the definer wrote FOR anon into a table anon cannot touch" "$(q "SELECT count(*) FROM public.money_probe WHERE who='anon'")" "11"
ok "  every one of them RAN AS postgres, not as anon" "$(q "SELECT count(*) FROM public.money_probe WHERE who='anon' AND ran_as='postgres'")" "11"
ok "  (control) anon can neither read nor write that table directly" \
   "$(q "SELECT NOT has_table_privilege('anon','public.money_probe','SELECT') AND NOT has_table_privilege('anon','public.money_probe','INSERT')")" "t"
echo

echo "-- ROW 4  APPLY 0032 (lane=staging), then the same eleven calls"
OUT=$(run "-c p32.lane=staging" "$APPLY"); RC=$?
ok "apply exit status" "$RC" "0"
AFTER=$(anon_calls 2>/dev/null); set -- $AFTER
ok "anon calls that SUCCEEDED" "$1" "0"
ok "anon calls denied with 42501" "$2" "11"
ok "anon calls failing for some other reason" "$3" "0"
ok "anon holds EXECUTE on how many of the eleven" "$(CNT anon)" "0"
ok "authenticated holds EXECUTE on" "$(CNT authenticated)" "11"
ok "service_role holds EXECUTE on" "$(CNT service_role)" "11"
ok "PUBLIC ACL entries remaining" "$(PUBN)" "0"
ok "no NEW rows written for anon (still the 11 from before)" "$(q "SELECT count(*) FROM public.money_probe WHERE who='anon'")" "11"
ok "the eleven COMMENTs landed" \
   "$(q "SELECT count(*) FROM unnest(ARRAY[$SIGS]) s WHERE obj_description(to_regprocedure(s),'pg_proc') LIKE '%NOT executable by anon or public%'")" "11"
POST_ACL=$(q "$ACLQ")
echo

# ── ROW 5 · lane ──────────────────────────────────────────────────────────
echo "-- ROW 5  LANE — the apply is TWO-LANE; unset must still refuse"
build
BASE_ACL=$(q "$ACLQ")
OUT=$(runn "" "$APPLY"); RC=$?
ok "unset: exit status is non-zero" "$([ $RC -ne 0 ] && echo nonzero || echo zero)" "nonzero"
ok "unset: refuses with APPLY REFUSED" "$(printf '%s' "$OUT" | grep -qi 'APPLY REFUSED' && echo yes || echo no)" "yes"
ok "unset: ACL unchanged" "$([ "$(q "$ACLQ")" = "$BASE_ACL" ] && echo yes || echo no)" "yes"
for bad in "somethingelse" "Staging" "STAGING" " staging"; do
  build
  OUT=$(run "-c p32.lane=$(printf '%q' "$bad")" "$APPLY"); RC=$?
  ok "'$bad': refuses, ACL unchanged" \
     "$([ $RC -ne 0 ] && [ "$(q "$ACLQ")" = "$BASE_ACL" ] && echo yes || echo no)" "yes"
done
build
OUT=$(run "-c p32.lane=staging" "$APPLY"); RC1=$?
ok "'staging': proceeds" "$RC1" "0"
ok "  anon closed on all eleven" "$(CNT anon)" "0"
build
OUT=$(run "-c p32.lane=production" "$APPLY"); RC2=$?
ok "'production': proceeds (the fixture stands in for prod)" "$RC2" "0"
ok "  anon closed on all eleven" "$(CNT anon)" "0"
ok "  authenticated and service_role intact" "$(CNT authenticated)/$(CNT service_role)" "11/11"
echo

# ── ROW 6 · idempotence ───────────────────────────────────────────────────
echo "-- ROW 6  IDEMPOTENCE"
build
run "-c p32.lane=staging" "$APPLY" >/dev/null; A1=$(q "$ACLQ")
OUT=$(run "-c p32.lane=staging" "$APPLY"); RC=$?
ok "a SECOND apply succeeds" "$RC" "0"
ok "  and leaves an identical ACL" "$([ "$(q "$ACLQ")" = "$A1" ] && echo yes || echo no)" "yes"
OUT=$(run "-c p32.lane=staging" "$APPLY"); RC=$?
ok "a THIRD apply succeeds too" "$RC" "0"
ok "  ACL still identical" "$([ "$(q "$ACLQ")" = "$A1" ] && echo yes || echo no)" "yes"
echo

# ── ROW 7 · rollback round trip ───────────────────────────────────────────
echo "-- ROW 7  ROLLBACK ROUND TRIP"
build
PRE_ACL=$(q "$ACLQ")
run "-c p32.lane=staging" "$APPLY" >/dev/null
POST=$(q "$ACLQ")
OUT=$(run "-c p32.lane=staging" "$RB"); RC=$?
ok "rollback exit status" "$RC" "0"
ok "anon regains EXECUTE on all eleven" "$(CNT anon)" "11"
ok "and PUBLIC still has NO entry" "$(PUBN)" "0"
ok "authenticated and service_role untouched" "$(CNT authenticated)/$(CNT service_role)" "11/11"
ok "the restored ACL is NOT the pre-state (PUBLIC deliberately not restored)" \
   "$([ "$(q "$ACLQ")" = "$PRE_ACL" ] && echo same || echo different)" "different"
AFTER=$(anon_calls 2>/dev/null); set -- $AFTER
ok "  and anon can execute all eleven again" "$1" "11"
echo "   the rollback's own ACL, one line as proof PUBLIC is absent:"
q "$ACLQ" | head -1 | sed 's/^/     /'
OUT=$(run "-c p32.lane=staging" "$RB"); RC=$?
ok "a SECOND rollback refuses (nothing to undo)" "$([ $RC -ne 0 ] && echo refused || echo proceeded)" "refused"
ok "  with the rollback precondition code" "$(printf '%s' "$OUT" | grep -qi 'P32-0032-RB-PRE-002' && echo yes || echo no)" "yes"
build
OUT=$(run "-c p32.lane=staging" "$RB"); RC=$?
ok "rollback on the PRE-0032 state refuses on its precondition" "$([ $RC -ne 0 ] && echo refused || echo proceeded)" "refused"
ok "  and left the ACL alone" "$([ "$(q "$ACLQ")" = "$PRE_ACL" ] && echo yes || echo no)" "yes"
build
run "-c p32.lane=staging" "$APPLY" >/dev/null
OUT=$(runn "" "$RB"); RC=$?
ok "rollback with p32.lane UNSET refuses" "$([ $RC -ne 0 ] && echo refused || echo proceeded)" "refused"
OUT=$(run "-c p32.lane=production" "$RB"); RC=$?
ok "rollback with p32.lane=production REFUSES (staging-only, R-9)" "$([ $RC -ne 0 ] && echo refused || echo proceeded)" "refused"
ok "  and anon is still closed" "$(CNT anon)" "0"
echo

echo "-- THE TWO WITHDRAWN 0027 FILES, executed"
build
for W in "$REPO/supabase/migrations/UNAPPLIED_20260910_0027_p32_money_account_control_revoke.sql" \
         "$REPO/supabase/rollback/UNAPPLIED_20260910_0027_p32_money_account_control_revoke_ROLLBACK.sql"; do
  B=$(q "$ACLQ")
  OUT=$(run "-c p32.lane=staging" "$W"); RC=$?
  ok "$(basename "$W" | cut -c1-46): raises" "$([ $RC -ne 0 ] && echo raises || echo RAN)" "raises"
  ok "  with the WITHDRAWN message" "$(printf '%s' "$OUT" | grep -qi 'WITHDRAWN under Auditor rulings' && echo yes || echo no)" "yes"
  ok "  ACL unchanged" "$([ "$(q "$ACLQ")" = "$B" ] && echo yes || echo no)" "yes"
done
echo

echo "==========================================================================="
echo " OVERALL: $([ $FAILED -eq 0 ] && echo 'ALL CHECKS PASS' || echo '*** ONE OR MORE CHECKS FAILED')"
echo "==========================================================================="
exit $FAILED
