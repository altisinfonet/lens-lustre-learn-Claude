#!/usr/bin/env bash
# D1 · R-8 fixture harness. Disposable local PostgreSQL 16.
# Nothing here touches staging or production; the only database contacted is the
# throwaway one it creates and drops.
set -u
REPO=/home/claude/repo
Q() { su postgres -c "psql -v ON_ERROR_STOP=1 -qAt -d $1 -c \"$2\"" 2>&1; }
F() { su postgres -c "psql -v ON_ERROR_STOP=1 -q -d $1 -f $2" 2>&1; }
HOOK='password_verification_hook(jsonb)'
FAILED=0

mkdb() { su postgres -c "dropdb --if-exists $1" >/dev/null 2>&1; su postgres -c "createdb $1" >/dev/null 2>&1
         Q "$1" "CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null; F "$1" /tmp/r8/stubs.sql >/dev/null; }

acl() { Q "$1" "SELECT coalesce(array_to_string(proacl,' | '),'(NULL)') FROM pg_proc WHERE oid=to_regprocedure('public.$2')::oid;"; }
named() { Q "$1" "SELECT EXISTS(SELECT 1 FROM pg_proc p, unnest(p.proacl) a WHERE p.oid=to_regprocedure('public.$2')::oid AND a::text LIKE '$3=%');"; }
eff()  { Q "$1" "SELECT has_function_privilege('$3',to_regprocedure('public.$2')::oid,'EXECUTE');"; }
pubn() { Q "$1" "SELECT count(*) FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid=to_regprocedure('public.$2')::oid AND a.grantee=0 AND a.privilege_type='EXECUTE';"; }

# ── THE ASSERTION. Written first, deliberately, and used unchanged everywhere.
#    It is the assertion that would have caught the 0029 defect.
assert_authadmin() { # db label
  local e n; e=$(eff "$1" "$HOOK" supabase_auth_admin); n=$(named "$1" "$HOOK" supabase_auth_admin)
  echo "        A1 · has_function_privilege('supabase_auth_admin', hook, 'EXECUTE') = $e"
  echo "        A2 · NAMED supabase_auth_admin ACL entry                            = $n"
  if [ "$e" = "t" ] && [ "$n" = "t" ]; then echo "        → HOLDS (effective AND named). GoTrue keeps its path."; return 0
  else echo "        → ✗ FAILS. GoTrue's path to the hook is gone: effective=$e named=$n"; return 1; fi; }

seed_hook() { # db shape
  Q "$1" "REVOKE ALL ON FUNCTION $HOOK FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;" >/dev/null
  if [ "$2" = "A" ]; then
    for r in PUBLIC anon authenticated service_role; do Q "$1" "GRANT EXECUTE ON FUNCTION $HOOK TO $r;" >/dev/null; done
  else
    for r in service_role supabase_auth_admin; do Q "$1" "GRANT EXECUTE ON FUNCTION $HOOK TO $r;" >/dev/null; done
  fi
  # get_public_role_user_ids seeded staging-shape on both, so MERGED_0029 has a target
  Q "$1" "REVOKE ALL ON FUNCTION public.get_public_role_user_ids(text) FROM PUBLIC, anon, authenticated, service_role;" >/dev/null
  for r in PUBLIC anon authenticated service_role; do Q "$1" "GRANT EXECUTE ON FUNCTION public.get_public_role_user_ids(text) TO $r;" >/dev/null; done
  Q "$1" "REVOKE ALL ON FUNCTION public.r8_canary_untouched(text) FROM PUBLIC, anon, authenticated, service_role;" >/dev/null
  Q "$1" "GRANT EXECUTE ON FUNCTION public.r8_canary_untouched(text) TO PUBLIC, anon, authenticated, service_role;" >/dev/null; }

echo "D1 · R-8 FIXTURE TRANSCRIPT"
echo "started_utc : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "engine      : $(su postgres -c "psql -qAtc 'show server_version'")"
echo "repo tree   : $(cd $REPO && git rev-parse HEAD) on $(cd $REPO && git rev-parse --abbrev-ref HEAD)"
echo "base        : origin/staging $(cd $REPO && git rev-parse origin/staging)"
su postgres -c "psql -qAtc \"DO \\\$\\\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
END \\\$\\\$;\"" >/dev/null 2>&1
echo "roles       : $(su postgres -c "psql -qAtc \"SELECT string_agg(rolname,', ' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','supabase_auth_admin')\"")"
echo

echo "══════════════════════════════════════════════════════════════════════════"
echo "PART 1 · THE DISCRIMINATING TEST — the assertion, shown failing against the"
echo "         MERGED 0029 and passing against 0038, on the SAME staging shape."
echo "         R-8 §7: \"build it first and show it failing against a fixture that"
echo "         applies 0029 instead of 0038.\""
echo "══════════════════════════════════════════════════════════════════════════"
echo
echo "1A · FIXTURE A (staging shape) + the MERGED 0029  —  EXPECTED TO FAIL"
mkdb r8_0029_a; seed_hook r8_0029_a A
echo "     starting ACL : $(acl r8_0029_a "$HOOK")"
echo "     PUBLIC entries=$(pubn r8_0029_a "$HOOK")  auth_admin effective=$(eff r8_0029_a "$HOOK" supabase_auth_admin)  auth_admin NAMED=$(named r8_0029_a "$HOOK" supabase_auth_admin)"
echo "     ^ this is the staging pre-state the 0029 author read as 'it already holds it'."
echo "     applying /tmp/r8/MERGED_0029.sql (verbatim from origin/staging):"
F r8_0029_a /tmp/r8/MERGED_0029.sql | sed 's/^/       /' | grep -v '^\s*$' | head -4
echo "     resulting ACL: $(acl r8_0029_a "$HOOK")"
echo "     assertion:"
if assert_authadmin r8_0029_a; then
  echo "     ✗✗ THE ASSERTION PASSED AGAINST THE DEFECTIVE MIGRATION — it cannot discriminate, and is not evidence (C-34)."; FAILED=1
else
  echo "     → CONFIRMED: the merged 0029 BREAKS GoTrue's path on the staging shape."
  echo "       This is the outage the withdrawal prevents. The assertion can fail."
fi
su postgres -c "dropdb --if-exists r8_0029_a" >/dev/null 2>&1
echo

echo "1B · FIXTURE A (staging shape) + 0038  —  EXPECTED TO PASS"
mkdb r8_0038_a; seed_hook r8_0038_a A
ACL_PRE_A=$(acl r8_0038_a "$HOOK")
echo "     starting ACL : $ACL_PRE_A"
echo "     fail-before probe (asserts the closed state):"
FB=0
[ "$(eff r8_0038_a "$HOOK" anon)" = "t" ] && { echo "        C3 FAIL  anon can EXECUTE the hook"; FB=1; }
[ "$(pubn r8_0038_a "$HOOK")" != "0" ] && { echo "        C4 FAIL  PUBLIC holds EXECUTE"; FB=1; }
[ "$(named r8_0038_a "$HOOK" supabase_auth_admin)" != "t" ] && { echo "        C7 FAIL  supabase_auth_admin has NO named entry"; FB=1; }
[ $FB -eq 1 ] && echo "        → probe FAILED as required. It can fail." || { echo "     ✗✗ fail-before passed on an open fixture (C-34)."; FAILED=1; }
echo "     applying supabase/migrations/20260910_0038_*.sql:"
F r8_0038_a "$REPO/supabase/migrations/20260910_0038_p32_password_verification_hook_closure.sql" | sed 's/^/       /' | grep -v '^\s*$' | head -6
echo "     resulting ACL: $(acl r8_0038_a "$HOOK")"
echo "     assertion:"
assert_authadmin r8_0038_a || { echo "     ✗✗ 0038 failed its own assertion."; FAILED=1; }
echo "     pass-after: anon=$(eff r8_0038_a "$HOOK" anon) authenticated=$(eff r8_0038_a "$HOOK" authenticated) PUBLIC_entries=$(pubn r8_0038_a "$HOOK") service_role=$(eff r8_0038_a "$HOOK" service_role)"
echo "     marker     : $(Q r8_0038_a "SELECT substring(obj_description(to_regprocedure('$HOOK')::oid,'pg_proc') from '\[R8-0038[^]]*\]');")"
ACL1=$(acl r8_0038_a "$HOOK")
F r8_0038_a "$REPO/supabase/migrations/20260910_0038_p32_password_verification_hook_closure.sql" | sed 's/^/       [re-apply] /' | grep -i "RE-RUN\|MARKER" | head -2
ACL2=$(acl r8_0038_a "$HOOK")
[ "$ACL1" = "$ACL2" ] && echo "     idempotence: ACL byte-identical after re-apply ✅"; echo "     marker after re-apply: $(Q r8_0038_a "SELECT substring(obj_description(to_regprocedure('public.$HOOK')::oid,'pg_proc') from '\\[R8-0038[^]]*\\]');")  (must still say added=true)" || { echo "     ✗✗ NOT IDEMPOTENT: [$ACL1] -> [$ACL2]"; FAILED=1; }
echo "     rollback:"
F r8_0038_a "$REPO/supabase/rollback/20260910_0038_p32_password_verification_hook_closure_ROLLBACK.sql" | sed 's/^/       /' | grep -v '^\s*$' | head -4
echo "     post-rollback ACL: $(acl r8_0038_a "$HOOK")"
echo "     PUBLIC after rollback = $(pubn r8_0038_a "$HOOK")  (must be 0)"
[ "$(pubn r8_0038_a "$HOOK")" != "0" ] && { echo "     ✗✗ PUBLIC recreated — UNAPPLIED_0023 hazard"; FAILED=1; }
echo "     auth_admin NAMED after rollback = $(named r8_0038_a "$HOOK" supabase_auth_admin)  (staging shape: must be f — the apply added it)"
[ "$(named r8_0038_a "$HOOK" supabase_auth_admin)" != "f" ] && { echo "     ✗✗ the grant the apply ADDED was not dropped on the staging shape (R-8 §6.2)"; FAILED=1; } || echo "     → pre-apply state restored: anon=$(eff r8_0038_a "$HOOK" anon) authenticated=$(eff r8_0038_a "$HOOK" authenticated), no PUBLIC, no auth-admin"
su postgres -c "dropdb --if-exists r8_0038_a" >/dev/null 2>&1
echo

echo "1C · FIXTURE B (production shape) + 0038  —  apply is a no-op, rollback must NOT revoke auth-admin"
mkdb r8_0038_b; seed_hook r8_0038_b B
ACL_PRE_B=$(acl r8_0038_b "$HOOK")
echo "     starting ACL : $ACL_PRE_B"
echo "     PUBLIC entries=$(pubn r8_0038_b "$HOOK")  auth_admin NAMED=$(named r8_0038_b "$HOOK" supabase_auth_admin)"
F r8_0038_b "$REPO/supabase/migrations/20260910_0038_p32_password_verification_hook_closure.sql" | sed 's/^/       /' | grep -v '^\s*$' | head -4
ACLB1=$(acl r8_0038_b "$HOOK")
echo "     resulting ACL: $ACLB1"
[ "$ACL_PRE_B" = "$ACLB1" ] && echo "     → NO-OP PROVED on the production shape: ACL byte-identical before and after." || echo "     note: apply changed the production shape: [$ACL_PRE_B] -> [$ACLB1]"
echo "     marker     : $(Q r8_0038_b "SELECT substring(obj_description(to_regprocedure('$HOOK')::oid,'pg_proc') from '\[R8-0038[^]]*\]');")"
echo "     assertion:"; assert_authadmin r8_0038_b || FAILED=1
echo "     rollback:"
F r8_0038_b "$REPO/supabase/rollback/20260910_0038_p32_password_verification_hook_closure_ROLLBACK.sql" | sed 's/^/       /' | grep -v '^\s*$' | head -4
echo "     post-rollback ACL: $(acl r8_0038_b "$HOOK")"
echo "     PUBLIC after rollback = $(pubn r8_0038_b "$HOOK")  (must be 0)"
[ "$(pubn r8_0038_b "$HOOK")" != "0" ] && { echo "     ✗✗ PUBLIC recreated on the PRODUCTION shape — UNAPPLIED_0023 hazard"; FAILED=1; }
echo "     auth_admin NAMED after rollback = $(named r8_0038_b "$HOOK" supabase_auth_admin)  (production shape: must be t — it pre-existed)"
if [ "$(named r8_0038_b "$HOOK" supabase_auth_admin)" = "t" ]; then
  echo "     → CONFIRMED: the rollback LEFT production's pre-existing auth-admin grant alone."
  echo "       Revoking it would have removed GoTrue's only named path — the outage the apply prevents,"
  echo "       caused by the file meant to undo it. The marker is what distinguishes the two lanes."
else echo "     ✗✗ the rollback REVOKED production's pre-existing auth-admin grant. GoTrue would break."; FAILED=1; fi
CAN=$(acl r8_0038_b "r8_canary_untouched(text)")
echo "     canary: $CAN"
su postgres -c "dropdb --if-exists r8_0038_b" >/dev/null 2>&1
echo

echo "══════════════════════════════════════════════════════════════════════════"
echo "PART 2 · ROLLBACKS FOR THE MERGED 0027 AND 0028"
echo "         apply the merged migration, run the new rollback, assert the"
echo "         starting named grants return and PUBLIC is never recreated."
echo "══════════════════════════════════════════════════════════════════════════"

O0027="admin_delete_auth_user(uuid) admin_purge_orphan_user_data(uuid) admin_reject_wallet_transaction(uuid,uuid,text) admin_wallet_credit(uuid,uuid,numeric,text,text,uuid,text,jsonb) approve_deposit(uuid,uuid) create_pending_deposit(uuid,numeric,text,text,jsonb,text) expire_gift_credit(uuid) request_withdrawal(numeric,jsonb) soft_void_wallet_transactions(uuid[],text,uuid) wallet_ledger_apply_v2(text,uuid,numeric,text,text,text,text,boolean) wallet_transaction(uuid,text,numeric,text,uuid,text,jsonb)"
O0028="admin_search_users(text,text) admin_search_users_v2(text,text,text,text,integer,integer) admin_list_certificates(text,text,integer,integer) admin_search_certificate_recipients(text,integer) generate_custom_url(text,uuid)"

run_pair() { # unit shape mergedfile rollbackfile objs
  local unit=$1 shape=$2 mf=$3 rf=$4 objs=$5
  local db="r8_${unit}_$(echo $shape | tr A-Z a-z)"
  echo
  echo "── UNIT $unit · FIXTURE $shape · $( [ "$shape" = A ] && echo 'STAGING shape (PUBLIC held)' || echo 'PRODUCTION shape (no PUBLIC, no anon)')"
  mkdb "$db"
  for s in $objs; do
    Q "$db" "REVOKE ALL ON FUNCTION public.$s FROM PUBLIC, anon, authenticated, service_role;" >/dev/null
    if [ "$shape" = "A" ]; then for r in PUBLIC anon authenticated service_role; do Q "$db" "GRANT EXECUTE ON FUNCTION public.$s TO $r;" >/dev/null; done
    else for r in authenticated service_role; do Q "$db" "GRANT EXECUTE ON FUNCTION public.$s TO $r;" >/dev/null; done; fi
  done
  Q "$db" "REVOKE ALL ON FUNCTION public.r8_canary_untouched(text) FROM PUBLIC, anon, authenticated, service_role;" >/dev/null
  Q "$db" "GRANT EXECUTE ON FUNCTION public.r8_canary_untouched(text) TO PUBLIC, anon, authenticated, service_role;" >/dev/null
  local C0; C0=$(acl "$db" "r8_canary_untouched(text)")
  local first; first=$(echo $objs | awk '{print $1}')
  echo "   starting ACL ($first): $(acl "$db" "$first")"
  echo "   applying the MERGED $unit:"; F "$db" "$mf" >/dev/null && echo "      apply ok"
  echo "   post-apply ($first): $(acl "$db" "$first")"
  echo "   running the new rollback:"
  F "$db" "$rf" | sed 's/^/      /' | grep -v '^\s*$' | head -3
  echo "   post-rollback ($first): $(acl "$db" "$first")"
  local pb=0 ar=0
  for s in $objs; do
    [ "$(pubn "$db" "$s")" != "0" ] && { echo "      ✗✗ PUBLIC recreated on public.$s"; pb=1; FAILED=1; }
    [ "$(eff "$db" "$s" anon)" = "t" ] && ar=$((ar+1))
  done
  [ $pb -eq 0 ] && echo "   → PUBLIC holds EXECUTE on 0 of $(echo $objs | wc -w) object(s) after rollback ✅"
  echo "   → anon restored on $ar of $(echo $objs | wc -w) object(s)"
  if [ "$shape" = "B" ]; then
    echo "   ⚠ BLOCKER-C, MEASURED: this fixture started with NO anon. After the rollback anon holds"
    echo "     EXECUTE on $ar of $(echo $objs | wc -w). On production that is an exposure the rollback created."
    echo "     0038 avoids this with a marker its own apply writes; 0027/0028 are merged and §8 forbids"
    echo "     editing them, so they cannot record anything. Operating constraint: STAGING ONLY."
  fi
  local C1; C1=$(acl "$db" "r8_canary_untouched(text)")
  [ "$C0" = "$C1" ] && echo "   canary: UNCHANGED ✅" || { echo "   ✗✗ CANARY CHANGED: [$C0] -> [$C1]"; FAILED=1; }
  su postgres -c "dropdb --if-exists $db" >/dev/null 2>&1; }

run_pair 0027 A /tmp/r8/MERGED_0027.sql "$REPO/supabase/rollback/20260910_0027_p32_money_account_control_revoke_ROLLBACK.sql" "$O0027"
run_pair 0027 B /tmp/r8/MERGED_0027.sql "$REPO/supabase/rollback/20260910_0027_p32_money_account_control_revoke_ROLLBACK.sql" "$O0027"
run_pair 0028 A /tmp/r8/MERGED_0028.sql "$REPO/supabase/rollback/20260910_0028_p32identity2_admin_search_and_generate_url_revoke_ROLLBACK.sql" "$O0028"
run_pair 0028 B /tmp/r8/MERGED_0028.sql "$REPO/supabase/rollback/20260910_0028_p32identity2_admin_search_and_generate_url_revoke_ROLLBACK.sql" "$O0028"

echo
echo "══════════════════════════════════════════════════════════════════════════"
echo "finished_utc : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
[ $FAILED -eq 0 ] && echo "RESULT: every assertion held." || echo "RESULT: ONE OR MORE ASSERTIONS FAILED — see ✗✗ above."
exit $FAILED
