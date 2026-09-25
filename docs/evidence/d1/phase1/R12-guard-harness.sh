#!/usr/bin/env bash
# D1 · R-12 §4 — C-34 FAIL-BEFORE PROOF for the R-9 lane guard.
# Disposable local PostgreSQL 16. Nothing here touches staging or production;
# the only database contacted is the throwaway one it creates.
#
# The proof shape, per file, three cases:
#   A  p32.lane unset        → MUST raise, and change ZERO grants
#   B  p32.lane='production' → MUST raise, and change ZERO grants
#   C  p32.lane='staging'    → MUST proceed, post-conditions pass, grants change
# then §4.3: reset p32.lane to unset in the SAME fixture → refuses again.
#
# Case C changing the ACL is what makes A and B evidence. A guard proven only
# against a fixture where the rollback had nothing to do would be C-34 again.
set -u
REPO=/home/claude/repo
W=/tmp/r12
FAILED=0
P() { su postgres -c "psql -X -qAt -d $1 -c \"$2\"" 2>&1; }

mkroles() {
  su postgres -c "psql -X -qAtc \"DO \\\$\\\$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
  END \\\$\\\$;\"" >/dev/null 2>&1; }

echo "D1 · R-12 §4 GUARD TRANSCRIPT — C-34 FAIL-BEFORE PROOF"
echo "started_utc : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "engine      : $(su postgres -c 'psql -X -qAtc "show server_version"')"
echo "repo tree   : $(cd $REPO && git rev-parse HEAD) on $(cd $REPO && git rev-parse --abbrev-ref HEAD)"
echo "base        : origin/staging $(cd $REPO && git rev-parse origin/staging)"
echo
mkroles


# Seed the measured staging pre-state on every named object. Used identically by
# the SEED step and by every case's reset, so no case starts from a state the
# other cases did not.
seed_staging_shape() {
  su postgres -c "psql -X -qAt -d $1 -c \"
    DO \\\$s\\\$ DECLARE r record; BEGIN
      FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='public' AND p.proname IN ($2) LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', r.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated, service_role', r.sig);
      END LOOP;
    END \\\$s\\\$;\"" >/dev/null 2>&1; }

# ═════════════════════════════════════════════════════════════════════════════
# Per-file driver.
#   $1 db   $2 ordinal   $3 apply file   $4 rollback file   $5 object list SQL
# ═════════════════════════════════════════════════════════════════════════════
run_file_proof() {
  local DB="$1" ORD="$2" APPLY="$3" RB="$4" OBJS="$5"
  echo "═══════════════════════════════════════════════════════════════════════════"
  echo "FILE $ORD · $(basename "$RB")"
  echo "═══════════════════════════════════════════════════════════════════════════"

  su postgres -c "dropdb --if-exists $DB" >/dev/null 2>&1
  su postgres -c "createdb $DB" >/dev/null 2>&1
  P "$DB" "CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null
  su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $REPO/docs/evidence/d1/phase1/R8-fixture-stubs.sql" >/dev/null 2>&1

  # snapshot table — regular, not TEMP: it must outlive each psql session.
  P "$DB" "CREATE TABLE r12_snap(phase text, obj text, acl text);" >/dev/null
  P "$DB" "CREATE OR REPLACE FUNCTION r12_capture(_phase text) RETURNS void LANGUAGE sql AS \\\$f\\\$
     DELETE FROM r12_snap WHERE phase = _phase;
     INSERT INTO r12_snap SELECT _phase, p.oid::regprocedure::text, coalesce(p.proacl::text,'(NULL)')
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ($OBJS);
   \\\$f\\\$;" >/dev/null

  echo
  echo "── SEED · staging shape, then the MERGED apply run verbatim ───────────────"
  echo "   seeding the measured staging pre-state on every object:"
  echo "     =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres"
  seed_staging_shape "$DB" "$OBJS"
  echo "   applying $(basename "$APPLY") (verbatim from the merged tree):"
  su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $APPLY" 2>&1 | grep -vE '^\s*$' | sed 's/^/     /' | head -6
  P "$DB" "SELECT r12_capture('post_apply');" >/dev/null
  echo "   post-apply ACL, object by object — this is the state each case starts from:"
  su postgres -c "psql -X -d $DB -c \"SELECT obj, acl FROM r12_snap WHERE phase='post_apply' ORDER BY obj;\"" 2>&1 | sed 's/^/     /'

  local CASE_N=0
  for CASE in A B C; do
    CASE_N=$((CASE_N+1))
    case "$CASE" in
      A) SETLINE="-- p32.lane deliberately NOT set"; DESC="p32.lane UNSET";        EXPECT="RAISE";   ;;
      B) SETLINE="SET p32.lane = 'production';";     DESC="p32.lane='production'"; EXPECT="RAISE";   ;;
      C) SETLINE="SET p32.lane = 'staging';";        DESC="p32.lane='staging'";    EXPECT="PROCEED"; ;;
    esac
    echo
    echo "── CASE $CASE · $DESC — expected: $EXPECT ────────────────────────────────"

    # Restore the post-apply starting state: re-seed the staging shape, then run
    # the merged apply. CORRECTED — the first revision revoked only, which left
    # `authenticated` and `service_role` stripped, because 0027 retains those BY
    # OMISSION and never re-grants them. Case C's post-condition would then have
    # failed for a reason that had nothing to do with the guard.
    seed_staging_shape "$DB" "$OBJS"
    su postgres -c "psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $APPLY" >/dev/null 2>&1
    P "$DB" "SELECT r12_capture('before');" >/dev/null
    echo "   session default before the case   : $(P "$DB" "SELECT coalesce(current_setting('p32.lane', true),'(unset)');")  (a fresh psql session; the case's own SET, if any, is shown in the raw output below)"

    cat > $W/case_$CASE.sql <<EOS
\\set VERBOSITY verbose
$SETLINE
\\i $RB
EOS
    local OUT RC
    OUT=$(su postgres -c "psql -X -v ON_ERROR_STOP=1 -d $DB -f $W/case_$CASE.sql" 2>&1); RC=$?
    P "$DB" "SELECT r12_capture('after');" >/dev/null

    echo "   psql exit code : $RC"
    echo "   ── raw psql output, unedited ──"
    echo "$OUT" | sed 's/^/     │ /'
    echo "   ── end raw output ──"

    local SQLSTATE
    # psql's verbose format is "ERROR:  P0001: <message>" — the code is inline.
    # CORRECTED TWICE: a bare grep -oE '[0-9A-Z]{5}' over that match returns the
    # word ERROR, not the code. The capture group is the only reliable read.
    SQLSTATE=$(echo "$OUT" | sed -nE 's/.*ERROR:[[:space:]]+([0-9A-Z]{5}):.*/\1/p' | head -1)
    [ -z "$SQLSTATE" ] && SQLSTATE="(none — no error raised)"
    echo "   SQLSTATE                          : $SQLSTATE"
    if echo "$OUT" | grep -q 'p32\.lane'; then
      echo "   message names p32.lane            : YES"
    else
      echo "   message names p32.lane            : no"
    fi

    echo "   ── proacl comparison, object by object (before vs after) ──"
    su postgres -c "psql -X -d $DB -c \"
      SELECT b.obj,
             (b.acl = a.acl) AS byte_identical,
             b.acl AS before_acl,
             a.acl AS after_acl
        FROM r12_snap b JOIN r12_snap a ON a.obj=b.obj AND a.phase='after'
       WHERE b.phase='before' ORDER BY b.obj;\"" 2>&1 | sed 's/^/     /'

    local CHANGED TOTAL
    CHANGED=$(P "$DB" "SELECT count(*) FROM r12_snap b JOIN r12_snap a ON a.obj=b.obj AND a.phase='after' WHERE b.phase='before' AND b.acl <> a.acl;")
    TOTAL=$(P "$DB" "SELECT count(*) FROM r12_snap WHERE phase='before';")
    echo "   objects whose proacl changed      : $CHANGED of $TOTAL"

    if [ "$EXPECT" = "RAISE" ]; then
      if [ "$RC" -ne 0 ] && [ "$CHANGED" = "0" ] && echo "$OUT" | grep -q 'ROLLBACK REFUSED'; then
        echo "   VERDICT                           : ✓ PASS — refused, zero grants changed"
      else
        echo "   VERDICT                           : ✗ FAIL — rc=$RC changed=$CHANGED"; FAILED=1
      fi
    else
      if [ "$RC" -eq 0 ] && [ "$CHANGED" != "0" ] && echo "$OUT" | grep -q 'POST-CONDITION PASSED'; then
        echo "   VERDICT                           : ✓ PASS — proceeded, $CHANGED of $TOTAL objects changed,"
        echo "                                         post-conditions passed. This is what A and B suppressed."
      else
        echo "   VERDICT                           : ✗ FAIL — rc=$RC changed=$CHANGED"; FAILED=1
      fi
    fi
  done

  # ── §4.3 — same fixture, reset to unset after a passing case C ─────────────
  echo
  echo "── §4.3 · SAME FIXTURE, p32.lane RESET TO UNSET AFTER CASE C ─────────────"
  P "$DB" "SELECT r12_capture('before');" >/dev/null
  cat > $W/case_reset.sql <<EOS
\\set VERBOSITY verbose
SET p32.lane = 'staging';
SELECT 'lane after SET   : ' || coalesce(current_setting('p32.lane', true),'(unset)') AS step;
RESET p32.lane;
SELECT 'lane after RESET : ' || coalesce(current_setting('p32.lane', true),'(unset)') AS step;
\\i $RB
EOS
  OUT=$(su postgres -c "psql -X -v ON_ERROR_STOP=1 -d $DB -f $W/case_reset.sql" 2>&1); RC=$?
  P "$DB" "SELECT r12_capture('after');" >/dev/null
  echo "$OUT" | sed 's/^/     │ /'
  echo "   psql exit code : $RC"
  CHANGED=$(P "$DB" "SELECT count(*) FROM r12_snap b JOIN r12_snap a ON a.obj=b.obj AND a.phase='after' WHERE b.phase='before' AND b.acl <> a.acl;")
  TOTAL=$(P "$DB" "SELECT count(*) FROM r12_snap WHERE phase='before';")
  su postgres -c "psql -X -d $DB -c \"
    SELECT b.obj, (b.acl = a.acl) AS byte_identical
      FROM r12_snap b JOIN r12_snap a ON a.obj=b.obj AND a.phase='after'
     WHERE b.phase='before' ORDER BY b.obj;\"" 2>&1 | sed 's/^/     /'
  echo "   objects whose proacl changed      : $CHANGED of $TOTAL"
  if [ "$RC" -ne 0 ] && [ "$CHANGED" = "0" ] && echo "$OUT" | grep -q 'ROLLBACK REFUSED'; then
    echo "   VERDICT                           : ✓ PASS — the assertion does not stick; it refuses again"
  else
    echo "   VERDICT                           : ✗ FAIL — rc=$RC changed=$CHANGED"; FAILED=1
  fi

  # ── case sensitivity, all four near-misses ─────────────────────────────────
  echo
  echo "── §2.1 · EXACT, CASE-SENSITIVE COMPARISON — the near-misses ─────────────"
  for V in "Staging" "STAGING" " staging" "staging "; do
    cat > $W/case_cs.sql <<EOS
SET p32.lane = '$V';
\\i $RB
EOS
    OUT=$(su postgres -c "psql -X -v ON_ERROR_STOP=1 -d $DB -f $W/case_cs.sql" 2>&1); RC=$?
    if [ "$RC" -ne 0 ] && echo "$OUT" | grep -q 'ROLLBACK REFUSED'; then
      echo "   p32.lane = '$V'  → REFUSED  ✓"
    else
      echo "   p32.lane = '$V'  → ACCEPTED ✗ FAIL"; FAILED=1
    fi
  done
  cat > $W/case_cs.sql <<EOS
SET p32.lane = '';
\\i $RB
EOS
  OUT=$(su postgres -c "psql -X -v ON_ERROR_STOP=1 -d $DB -f $W/case_cs.sql" 2>&1); RC=$?
  if [ "$RC" -ne 0 ] && echo "$OUT" | grep -q 'ROLLBACK REFUSED'; then
    echo "   p32.lane = ''          → REFUSED  ✓"
  else
    echo "   p32.lane = ''          → ACCEPTED ✗ FAIL"; FAILED=1
  fi
  echo
}

OBJS_27="'admin_delete_auth_user','admin_purge_orphan_user_data','admin_reject_wallet_transaction','admin_wallet_credit','approve_deposit','create_pending_deposit','expire_gift_credit','request_withdrawal','soft_void_wallet_transactions','wallet_ledger_apply_v2','wallet_transaction'"
OBJS_28="'admin_search_users','admin_search_users_v2','admin_list_certificates','admin_search_certificate_recipients','generate_custom_url'"

run_file_proof r12_g27 0027 \
  "$REPO/supabase/migrations/20260910_0027_p32_money_account_control_revoke.sql" \
  "$REPO/supabase/rollback/20260910_0027_p32_money_account_control_revoke_ROLLBACK.sql" \
  "$OBJS_27"

run_file_proof r12_g28 0028 \
  "$REPO/supabase/migrations/20260910_0028_p32identity2_admin_search_and_generate_url_revoke.sql" \
  "$REPO/supabase/rollback/20260910_0028_p32identity2_admin_search_and_generate_url_revoke_ROLLBACK.sql" \
  "$OBJS_28"

echo "═══════════════════════════════════════════════════════════════════════════"
echo "finished_utc : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$FAILED" = "0" ]; then echo "HARNESS RESULT : ALL CASES PASSED"; else echo "HARNESS RESULT : ✗ FAILURES PRESENT"; fi
exit $FAILED
