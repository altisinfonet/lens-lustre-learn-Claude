#!/usr/bin/env bash
# D1 · R-7 fixture harness. Disposable local PostgreSQL 16.
# Proves grant mechanics per unit, per lane shape. Nothing here touches staging
# or production; the only database contacted is the throwaway one it creates.
set -u
REPO=/home/claude/repo
PSQL() { su postgres -c "psql -v ON_ERROR_STOP=1 -qAt -d $1 -c \"$2\"" 2>&1; }
PSQLF() { su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $1 -f $2" 2>&1; }

# ---- object lists per unit (type-only signatures, for to_regprocedure) ----
U0032="admin_delete_auth_user(uuid)|admin_purge_orphan_user_data(uuid)|admin_reject_wallet_transaction(uuid,uuid,text)|admin_wallet_credit(uuid,uuid,numeric,text,text,uuid,text,jsonb)|approve_deposit(uuid,uuid)|create_pending_deposit(uuid,numeric,text,text,jsonb,text)|expire_gift_credit(uuid)|soft_void_wallet_transactions(uuid[],text,uuid)|wallet_ledger_apply_v2(text,uuid,numeric,text,text,text,text,boolean)|wallet_transaction(uuid,text,numeric,text,uuid,text,jsonb)"
U0033="request_withdrawal(numeric,jsonb)"
U0034="admin_list_certificates(text,text,integer,integer)|admin_search_certificate_recipients(text,integer)|admin_search_users_v2(text,text,text,text,integer,integer)|generate_custom_url(text,uuid)"
U0035="admin_search_users(text,text)"
U0036="password_verification_hook(jsonb)"

stem_for() { case $1 in
  0032) echo p32r7_money_account_control_revoke;;
  0033) echo p32r7_request_withdrawal_revoke;;
  0034) echo p32r7_identity2_admin_search_and_generate_url_revoke;;
  0035) echo p32r7_admin_search_users_revoke;;
  0036) echo p32r7_password_verification_hook_revoke;; esac; }
objs_for() { case $1 in 0032) echo "$U0032";; 0033) echo "$U0033";; 0034) echo "$U0034";; 0035) echo "$U0035";; 0036) echo "$U0036";; esac; }

acl_of() { PSQL "$1" "SELECT coalesce(array_to_string(proacl,' | '),'(NULL=built-in default)') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.oid=to_regprocedure('public.$2')::oid;"; }

# probe: asserts the CLOSED state. Exits non-zero (and says why) when open.
probe() { local db=$1 unit=$2 objs=$3 rc=0
  IFS='|' read -ra A <<< "$objs"
  for s in "${A[@]}"; do
    local anon pub auth svc aadm
    anon=$(PSQL "$db" "SELECT has_function_privilege('anon',to_regprocedure('public.$s')::oid,'EXECUTE');")
    pub=$(PSQL "$db" "SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid=to_regprocedure('public.$s')::oid AND a.grantee=0 AND a.privilege_type='EXECUTE';")
    auth=$(PSQL "$db" "SELECT has_function_privilege('authenticated',to_regprocedure('public.$s')::oid,'EXECUTE');")
    svc=$(PSQL "$db" "SELECT has_function_privilege('service_role',to_regprocedure('public.$s')::oid,'EXECUTE');")
    [ "$anon" = "t" ] && { echo "      C3 FAIL  anon can EXECUTE public.$s"; rc=1; }
    [ "$pub" != "0" ] && { echo "      C4 FAIL  PUBLIC holds EXECUTE on public.$s ($pub entry)"; rc=1; }
    [ "$svc" != "t" ] && { echo "      C6 FAIL  service_role lost EXECUTE on public.$s"; rc=1; }
    if [ "$unit" = "0036" ]; then
      aadm=$(PSQL "$db" "SELECT has_function_privilege('supabase_auth_admin',to_regprocedure('public.$s')::oid,'EXECUTE');")
      [ "$auth" = "t" ] && { echo "      C5 FAIL  authenticated can EXECUTE public.$s (0036 closes it)"; rc=1; }
      [ "$aadm" != "t" ] && { echo "      C7 FAIL  supabase_auth_admin CANNOT EXECUTE public.$s — GoTrue sign-in would break"; rc=1; }
    else
      [ "$auth" != "t" ] && { echo "      C5 FAIL  authenticated lost EXECUTE on public.$s (required caller)"; rc=1; }
    fi
  done
  return $rc; }

seed() { local db=$1 unit=$2 shape=$3 objs=$4
  IFS='|' read -ra A <<< "$objs"
  for s in "${A[@]}"; do
    PSQL "$db" "REVOKE ALL ON FUNCTION public.$s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;" >/dev/null
    if [ "$shape" = "A" ]; then
      PSQL "$db" "GRANT EXECUTE ON FUNCTION public.$s TO PUBLIC;" >/dev/null
      PSQL "$db" "GRANT EXECUTE ON FUNCTION public.$s TO anon;" >/dev/null
      PSQL "$db" "GRANT EXECUTE ON FUNCTION public.$s TO authenticated;" >/dev/null
      PSQL "$db" "GRANT EXECUTE ON FUNCTION public.$s TO service_role;" >/dev/null
    else
      case $unit in
        0036) PSQL "$db" "GRANT EXECUTE ON FUNCTION public.$s TO service_role;" >/dev/null
              PSQL "$db" "GRANT EXECUTE ON FUNCTION public.$s TO supabase_auth_admin;" >/dev/null ;;
        0033|0035) PSQL "$db" "GRANT EXECUTE ON FUNCTION public.$s TO anon;" >/dev/null
              PSQL "$db" "GRANT EXECUTE ON FUNCTION public.$s TO authenticated;" >/dev/null
              PSQL "$db" "GRANT EXECUTE ON FUNCTION public.$s TO service_role;" >/dev/null ;;
        *)    PSQL "$db" "GRANT EXECUTE ON FUNCTION public.$s TO authenticated;" >/dev/null
              PSQL "$db" "GRANT EXECUTE ON FUNCTION public.$s TO service_role;" >/dev/null ;;
      esac
    fi
  done; }

run_unit() {
  local unit="$1"
  local shape="$2"
  local db
  db="r7_${unit}_$(echo "$shape" | tr "A-Z" "a-z")"
  local stem objs first out p
  stem=$(stem_for "$unit"); objs=$(objs_for "$unit")
  IFS='|' read -ra A <<< "$objs"; first="${A[0]}"
  echo "──────────────────────────────────────────────────────────────────────"
  echo "UNIT $unit  ·  FIXTURE $shape  ·  $( [ "$shape" = A ] && echo 'STAGING shape (PUBLIC holds EXECUTE)' || echo 'PRODUCTION shape (PUBLIC does NOT hold EXECUTE)')"
  echo "  db=$db   utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  su postgres -c "dropdb --if-exists $db" >/dev/null 2>&1
  su postgres -c "createdb $db" >/dev/null 2>&1
  PSQL "$db" "CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null
  PSQLF "$db" /tmp/p1r7/stubs.sql >/dev/null
  seed "$db" "$unit" "$shape" "$objs"
  # canary seeded identically on every fixture and never named by a migration
  PSQL "$db" "REVOKE ALL ON FUNCTION public.r7_canary_untouched(text) FROM PUBLIC, anon, authenticated, service_role;" >/dev/null
  PSQL "$db" "GRANT EXECUTE ON FUNCTION public.r7_canary_untouched(text) TO PUBLIC, anon, authenticated, service_role;" >/dev/null
  local CAN0; CAN0=$(acl_of "$db" "r7_canary_untouched(text)")

  echo "  STEP 1 · measured starting ACL ($first):"
  echo "           $(acl_of "$db" "$first")"
  echo "           named entries present: $(PSQL "$db" "SELECT string_agg(coalesce(r.rolname,'PUBLIC'),',' ORDER BY coalesce(r.rolname,'PUBLIC')) FROM pg_proc p, aclexplode(p.proacl) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=to_regprocedure('public.$first')::oid AND a.privilege_type='EXECUTE';")"

  # Is this fixture OPEN before the apply? Staging: always. Production: only the
  # two Set B units. 0032/0034/0036 are already closed on production (relayed),
  # so their production fixture starts in the target state and the apply is a
  # no-op there. Expecting a fail-before on an already-closed lane would be
  # expecting the probe to lie.
  local expect_open="no"
  if [ "$shape" = "A" ]; then expect_open="yes"
  elif [ "$unit" = "0033" ] || [ "$unit" = "0035" ]; then expect_open="yes"; fi

  local ACL_PRE; ACL_PRE=$(acl_of "$db" "$first")
  echo "  STEP 2 · FAIL-BEFORE probe (asserts the closed state). expected_open=$expect_open"
  if probe "$db" "$unit" "$objs" > /tmp/p1r7/_probe.out 2>&1; then
    if [ "$expect_open" = "yes" ]; then
      echo "      ✗✗ PROBE PASSED BEFORE THE FIX ON AN OPEN FIXTURE — NOT EVIDENCE (C-34). Unit $unit/$shape."; FAILED=1
    else
      echo "      → probe PASSED, and that is the correct result here: this lane shape is"
      echo "        ALREADY CLOSED for this unit (relayed production state), so the apply is"
      echo "        a no-op. The C-34 fail-before control for unit $unit is carried by"
      echo "        FIXTURE A above, where the object is genuinely open."
    fi
  else
    sed 's/^/  /' /tmp/p1r7/_probe.out
    if [ "$expect_open" = "yes" ]; then echo "      → probe FAILED as required. The probe can fail."
    else echo "      ✗✗ PROBE FAILED ON A FIXTURE EXPECTED TO BE ALREADY CLOSED. Unit $unit/$shape."; FAILED=1; fi
  fi

  echo "  STEP 3 · apply supabase/migrations/20260910_${unit}_${stem}.sql"
  out=$(PSQLF "$db" "$REPO/supabase/migrations/20260910_${unit}_${stem}.sql"); echo "$out" | sed 's/^/           /' | grep -v '^\s*$' | head -6
  echo "           apply exit=$?"

  echo "  STEP 4 · PASS-AFTER probe:"
  if probe "$db" "$unit" "$objs"; then echo "      → PASS. anon closed, no PUBLIC entry, required named grants intact."
  else echo "      ✗✗ PASS-AFTER FAILED. Unit $unit/$shape."; FAILED=1; fi

  if [ "$unit" = "0036" ]; then
    local aa; aa=$(PSQL "$db" "SELECT has_function_privilege('supabase_auth_admin',to_regprocedure('public.password_verification_hook(jsonb)')::oid,'EXECUTE');")
    local aan; aan=$(PSQL "$db" "SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=to_regprocedure('public.password_verification_hook(jsonb)')::oid AND r.rolname='supabase_auth_admin' AND a.privilege_type='EXECUTE';")
    echo "  STEP 4c · §15 REQUIRED ASSERTION — has_function_privilege('supabase_auth_admin', ..., 'EXECUTE') after apply"
    echo "           = $aa      NAMED supabase_auth_admin ACL entries = $aan"
    if [ "$aa" = "t" ] && [ "$aan" -ge 1 ]; then
      echo "           → HOLDS, and by a NAMED grant, not through PUBLIC. On fixture A the named"
      echo "             entry did not exist before the apply — this is the grant 0036 ADDS."
    else
      echo "           ✗✗ supabase_auth_admin cannot execute the hook after apply — GoTrue would break."; FAILED=1
    fi
  fi
  local ACL1; ACL1=$(acl_of "$db" "$first")
  if [ "$expect_open" = "no" ]; then
    if [ "$ACL_PRE" = "$ACL1" ]; then
      echo "  STEP 4b · NO-OP PROOF (already-closed lane): ACL byte-identical before and after apply."
    else
      echo "  STEP 4b · ✗✗ apply CHANGED an already-closed lane: [$ACL_PRE] -> [$ACL1]"; FAILED=1
    fi
  fi
  echo "  STEP 5 · idempotence — re-apply the same file"
  PSQLF "$db" "$REPO/supabase/migrations/20260910_${unit}_${stem}.sql" >/dev/null
  local ACL2; ACL2=$(acl_of "$db" "$first")
  if [ "$ACL1" = "$ACL2" ]; then echo "      → IDEMPOTENT. ACL byte-identical after second apply."
  else echo "      ✗✗ NOT IDEMPOTENT: [$ACL1] -> [$ACL2]"; FAILED=1; fi

  echo "  STEP 6 · rollback supabase/rollback/20260910_${unit}_${stem}_ROLLBACK.sql"
  out=$(PSQLF "$db" "$REPO/supabase/rollback/20260910_${unit}_${stem}_ROLLBACK.sql"); echo "$out" | sed 's/^/           /' | grep -v '^\s*$' | head -4

  echo "  STEP 7 · post-rollback ACL ($first):"
  echo "           $(acl_of "$db" "$first")"

  echo "  STEP 8 · THE TWO-LANE ASSERTION — PUBLIC must NOT hold EXECUTE anywhere:"
  local pubbad=0
  for s in "${A[@]}"; do
    p=$(PSQL "$db" "SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid=to_regprocedure('public.$s')::oid AND a.grantee=0 AND a.privilege_type='EXECUTE';")
    [ "$p" != "0" ] && { echo "      ✗✗ PUBLIC EXECUTE PRESENT after rollback on public.$s — UNAPPLIED_0023 hazard"; pubbad=1; FAILED=1; }
  done
  [ $pubbad -eq 0 ] && echo "      → CONFIRMED: PUBLIC holds EXECUTE on 0 of ${#A[@]} object(s) after rollback."

  echo "  STEP 9 · named grants after rollback:"
  for s in "${A[@]}"; do
    echo "           public.$s  anon=$(PSQL "$db" "SELECT has_function_privilege('anon',to_regprocedure('public.$s')::oid,'EXECUTE');") authenticated=$(PSQL "$db" "SELECT has_function_privilege('authenticated',to_regprocedure('public.$s')::oid,'EXECUTE');") service_role=$(PSQL "$db" "SELECT has_function_privilege('service_role',to_regprocedure('public.$s')::oid,'EXECUTE');")$( [ "$unit" = "0036" ] && echo " supabase_auth_admin=$(PSQL "$db" "SELECT has_function_privilege('supabase_auth_admin',to_regprocedure('public.$s')::oid,'EXECUTE');")" )"
  done

  if [ "$expect_open" = "no" ]; then
    local opened=0
    for s in "${A[@]}"; do
      if [ "$(PSQL "$db" "SELECT has_function_privilege('anon',to_regprocedure('public.$s')::oid,'EXECUTE');")" = "t" ]; then opened=$((opened+1)); fi
    done
    echo "  STEP 9b · BLOCKER-C, MEASURED RATHER THAN ASSERTED:"
    echo "           this fixture started ALREADY CLOSED to anon (production shape). After the"
    echo "           rollback, anon holds EXECUTE on $opened of ${#A[@]} object(s)."
    if [ "$opened" -gt 0 ]; then
      echo "           → the rollback OPENS anon on a lane where it was closed. Correct on"
      echo "             staging, an exposure on production. The file cannot tell the lanes"
      echo "             apart, so the operating constraint (STAGING ONLY) is the only control"
      echo "             until the Auditor rules. This is BLOCKER-C, demonstrated."
    fi
  fi
  echo "  STEP 10 · canary (public.r7_canary_untouched(text)) — no unrelated object affected:"
  local CAN1; CAN1=$(acl_of "$db" "r7_canary_untouched(text)")
  if [ "$CAN0" = "$CAN1" ]; then echo "      → UNCHANGED across apply, re-apply and rollback."
  else echo "      ✗✗ CANARY CHANGED: [$CAN0] -> [$CAN1]"; FAILED=1; fi
  su postgres -c "dropdb --if-exists $db" >/dev/null 2>&1
  echo; }

FAILED=0
echo "D1 · R-7 FIXTURE TRANSCRIPT"
echo "started_utc : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "engine      : $(su postgres -c "psql -qAtc 'show server_version'")"
echo "repo tree   : $(cd $REPO && git rev-parse HEAD) on $(cd $REPO && git rev-parse --abbrev-ref HEAD)"
echo
su postgres -c "psql -qAtc \"DO \\\$\\\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
END \\\$\\\$;\"" >/dev/null 2>&1
echo "roles present: $(su postgres -c "psql -qAtc \"SELECT string_agg(rolname,', ' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','supabase_auth_admin')\"")"
echo
for unit in 0032 0033 0034 0035 0036; do
  run_unit "$unit" A
  run_unit "$unit" B
done
echo "══════════════════════════════════════════════════════════════════════"
echo "finished_utc : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
[ $FAILED -eq 0 ] && echo "RESULT: every assertion held on every unit and both fixture shapes." || echo "RESULT: ONE OR MORE ASSERTIONS FAILED — see ✗✗ above."
exit $FAILED
