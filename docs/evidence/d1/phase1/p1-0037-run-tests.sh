#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P-1 · 20260910_0037 — the harness.
#
# 0037 is the only Phase-1 unit whose target lane cannot be measured. So the
# fixture IS the evidence: p1-0037-fixture.sql reconstructs production's ACL
# state from the Owner's 2026-09-25 reading and asserts all 73 strings
# byte-exact before anything runs. Everything below happens on that.
#
# Every apply and every rollback goes through p1-0037-runit2.sh, the extracted
# "Run it" step of apply-migration.yml (R-13): one psql session, -c "SET
# p32.lane = '<lane>';" then -f. Nothing here sets the GUC another way.
#
# SCRATCH CLUSTER ONLY. Never point PGHOST at staging or production.
#
#   bash docs/evidence/d1/phase1/p1-0037-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p37
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260910_0037_p1_production_closure.sql"
RB="$ROOT/supabase/rollback/20260910_0037_p1_production_closure_ROLLBACK.sql"
RUNIT="$HERE/p1-0037-runit2.sh"
fail=0
step() { printf '\n══ %s\n' "$*"; }

# A stable, order-independent digest of every ACL this unit can touch.
snap() {
  psql -q -d "$DB" -tA -c "
    SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
      SELECT p.oid::regprocedure::text || ' ' || coalesce(p.proacl::text,'NULL') AS x
        FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
      UNION ALL
      SELECT c.relname || ' ' || coalesce(c.relacl::text,'NULL')
        FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','v','m')
      UNION ALL
      SELECT 'defacl ' || d.defaclobjtype::text || ' ' || coalesce(d.defaclacl::text,'NULL')
        FROM pg_default_acl d WHERE d.defaclrole='postgres'::regrole
    ) t"
}
build() { dropdb --if-exists "$DB" >/dev/null 2>&1; createdb "$DB" || return 1
          psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p1-0037-fixture.sql" >/dev/null 2>&1; }

run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" "${3:-5432}" 2>&1); rc=$?; }
expect_fail() { local what="$1" needle="$2"; run "$3" "$4" "${5:-5432}"
  if [ "$rc" -eq 0 ]; then echo "  FAIL  $what — ACCEPTED (exit 0). It must refuse."; fail=1
  elif ! printf '%s' "$out" | grep -q "$needle"; then
    echo "  FAIL  $what — refused, but not with '$needle':"; printf '%s\n' "$out" | sed 's/^/        /' | head -5; fail=1
  else echo "  PASS  $what — refused (exit $rc), '$needle'"; fi; }
expect_ok() { local what="$1"; run "$2" "$3" "${4:-5432}"
  if [ "$rc" -ne 0 ]; then echo "  FAIL  $what — exit $rc:"; printf '%s\n' "$out" | sed 's/^/        /' | tail -12; fail=1
  else echo "  PASS  $what"; fi; }
# A digest comparison between two EMPTY strings passes and means nothing. The
# first version of this harness had a snap() that errored and returned empty,
# and every "identical" check below passed vacuously. Both helpers now refuse a
# blank digest (C-34: a check that could not have failed is not evidence).
ck() { [ -n "$1" ] && [ -n "$2" ] && [ ${#1} -eq 32 ] && [ ${#2} -eq 32 ] && return 0
       echo "  FAIL  $3 — a snapshot was empty or malformed; the comparison proves nothing"; fail=1; return 1; }
same() { ck "$1" "$2" "$3" || return; [ "$1" = "$2" ] && echo "  PASS  $3" || { echo "  FAIL  $3 (snapshots differ)"; fail=1; }; }
diff_() { ck "$1" "$2" "$3" || return; [ "$1" != "$2" ] && echo "  PASS  $3" || { echo "  FAIL  $3 (snapshot did not change)"; fail=1; }; }

step "0 · the production-exact fixture"
psql -q -d postgres -tAc "SELECT '  server_version '||current_setting('server_version')"
if build; then echo "  PASS  fixture built"; else echo "  FAIL  fixture did not build"; psql -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p1-0037-fixture.sql" 2>&1 | tail -6; exit 2; fi
PRE=$(snap); echo "  pre-apply ACL digest: $PRE"
psql -q -d "$DB" -tA -c "SELECT '  anon-executable definer volatile functions: '||count(*) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f' AND p.provolatile='v' AND p.prosecdef AND p.prorettype<>'trigger'::regtype AND has_function_privilege('anon',p.oid,'EXECUTE')"

step "1 · 0037 REFUSES on any lane but production, and on any pooler but 5432"
expect_fail "TARGET_LANE=staging"                  "APPLY REFUSED"  staging    "$MIG"
expect_fail "TARGET_LANE='' (unset)"               "Unknown target" ""         "$MIG"
expect_fail "TARGET_LANE with an injection string" "Unknown target" "production'; DROP" "$MIG"
expect_fail "transaction pooler, port 6543"        "6543"           production "$MIG" 6543
expect_fail "some other port, 5433"                "Unexpected port" production "$MIG" 5433
AFTER_REFUSALS=$(snap); same "$PRE" "$AFTER_REFUSALS" "five refusals left the ACL snapshot identical"

step "2 · 0037 applies on the production lane"
expect_ok "apply, TARGET_LANE=production" production "$MIG"
POST=$(snap); diff_ "$PRE" "$POST" "the apply changed the ACL snapshot"
psql -q -d "$DB" -tA <<'Q'
SELECT CASE WHEN array_agg(proname::text ORDER BY proname) = ARRAY['increment_managed_page_view','log_app_event','log_client_error','record_test_agent_run']
       THEN '  PASS  exactly the four justified functions remain anon-executable'
       ELSE '  FAIL  survivors are ' || array_agg(proname::text ORDER BY proname)::text END
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'
    AND p.provolatile='v' AND p.prosecdef AND p.prorettype<>'trigger'::regtype
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
UNION ALL
SELECT CASE WHEN count(*)=0 THEN '  PASS  no closed function kept a PUBLIC ACL entry (F-62)'
            ELSE '  FAIL  ' || count(*) || ' still have one' END
  FROM pg_proc p, LATERAL aclexplode(p.proacl) a
 WHERE p.pronamespace='public'::regnamespace AND a.grantee=0
   AND p.proname NOT IN ('increment_managed_page_view','log_app_event','log_client_error','record_test_agent_run',
                         'verify_certificate','verify_certificate_by_token')
UNION ALL
SELECT CASE WHEN bool_and(NOT has_table_privilege(r, 'public.posts_dead_host_backup_20260812', pr))
       THEN '  PASS  the backup table is closed to anon and authenticated, every privilege'
       ELSE '  FAIL  a write privilege survived on the backup table' END
  FROM unnest(ARRAY['anon','authenticated']) r,
       unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr
UNION ALL
SELECT CASE WHEN bool_and(NOT has_table_privilege(r, v::regclass, pr))
       THEN '  PASS  the 11 relations lost every write privilege for anon, authenticated and PUBLIC'
       ELSE '  FAIL  a write privilege survived on a definer relation' END
  FROM unnest(ARRAY['anon','authenticated','public']) r,
       unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) pr,
       unnest(ARRAY['public.entry_final_votes','public.entry_final_votes_legacy','public.entry_public_status',
                    'public.entry_vote_counts','public.judge_comments_owner_safe','public.judge_decisions_owner_safe',
                    'public.judge_tag_assignments_owner_safe','public.judge_tag_assignments_public_r4',
                    'public.judging_progression_audit','public.profiles_public','public.v_judging_drift']) v
UNION ALL
SELECT CASE WHEN bool_and(has_table_privilege(r, v::regclass, 'SELECT'))
       THEN '  PASS  SELECT is untouched on the ten relations that had it'
       ELSE '  FAIL  a SELECT grant was lost' END
  FROM unnest(ARRAY['anon','authenticated']) r,
       unnest(ARRAY['public.entry_final_votes','public.entry_final_votes_legacy','public.entry_public_status',
                    'public.entry_vote_counts','public.judge_comments_owner_safe','public.judge_decisions_owner_safe',
                    'public.judge_tag_assignments_owner_safe','public.judge_tag_assignments_public_r4',
                    'public.profiles_public','public.v_judging_drift']) v
UNION ALL
SELECT CASE WHEN NOT has_function_privilege('authenticated','public.email_exists(text)'::regprocedure,'EXECUTE')
             AND has_function_privilege('service_role','public.email_exists(text)'::regprocedure,'EXECUTE')
       THEN '  PASS  email_exists: authenticated closed, service_role kept'
       ELSE '  FAIL  email_exists end state is wrong' END
UNION ALL
SELECT CASE WHEN NOT has_function_privilege('anon','public.get_primary_admin_user_id()'::regprocedure,'EXECUTE')
             AND has_function_privilege('authenticated','public.get_primary_admin_user_id()'::regprocedure,'EXECUTE')
       THEN '  PASS  get_primary_admin_user_id: anon closed, authenticated kept'
       ELSE '  FAIL  get_primary_admin_user_id end state is wrong' END
UNION ALL
SELECT CASE WHEN (SELECT count(*) FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
                   WHERE d.defaclrole='postgres'::regrole AND d.defaclnamespace='public'::regnamespace
                     AND d.defaclobjtype='f' AND (a.grantee=0 OR a.grantee='anon'::regrole)) = 0
       THEN '  PASS  the postgres/public FUNCTION default no longer grants anon or PUBLIC'
       ELSE '  FAIL  the function default still grants anon or PUBLIC' END;
Q

step "3 · a second apply is a no-op, not a second change"
expect_ok "apply again, TARGET_LANE=production" production "$MIG"
same "$POST" "$(snap)" "the second apply left the ACL snapshot identical"

step "4 · GROUP A did not take authenticated with PUBLIC"
psql -q -d "$DB" -tA <<'Q'
SELECT CASE WHEN bool_and(has_function_privilege('authenticated', s::regprocedure, 'EXECUTE'))
       THEN '  PASS  all 21 GROUP A functions still execute for authenticated'
       ELSE '  FAIL  authenticated lost ' || count(*) FILTER (WHERE NOT has_function_privilege('authenticated', s::regprocedure,'EXECUTE')) END
  FROM unnest(ARRAY[
   'public.admin_flag_entry_for_review(uuid)','public.admin_rewind_stage(uuid,text,text)',
   'public.admin_search_users(text,text)','public.admin_set_photo_rejected(uuid,integer,boolean,text)',
   'public.backfill_judging_notifications(integer,boolean)','public.backfill_tag_decision_drift_admin()',
   'public.change_custom_url(text)','public.claim_username(text)','public.fix_certificate_readiness_admin(uuid)',
   'public.fix_gift_drift_admin(uuid)','public.fix_referral_drift_admin(uuid)',
   'public.get_broadcast_feed(uuid[],integer)','public.get_broadcast_feed(uuid[],integer,integer)',
   'public.get_broadcast_feed(uuid[],integer,integer,text[])','public.get_certificate_drift_admin(uuid)',
   'public.get_judge_collusion_admin(uuid,integer,numeric)','public.get_judging_tag_assignment_counts()',
   'public.register_push_token(text,text)','public.request_withdrawal(numeric,jsonb)',
   'public.submit_competition_entry(uuid,text,text,text[],text[],jsonb,boolean,jsonb)',
   'public.unregister_push_token(text)']) s
UNION ALL
SELECT CASE WHEN bool_and(NOT has_function_privilege('authenticated', s::regprocedure, 'EXECUTE'))
       THEN '  PASS  all 8 GROUP B functions are closed to authenticated'
       ELSE '  FAIL  authenticated survives on a GROUP B function' END
  FROM unnest(ARRAY[
   'public._gen_competition_order_no()','public.apply_decision_to_remaining(uuid,integer,text)',
   'public.clear_custom_url()','public.get_derived_status_drift_admin()',
   'public.judging_write_decision_atomic(uuid,text,text)','public.recompute_entry_from_tag_assignments(uuid)',
   'public.recompute_entry_public_status(uuid)','public.set_write_path(text)']) s;
Q

step "5 · the ROLLBACK refuses on any lane but production"
expect_fail "rollback, TARGET_LANE=staging" "ROLLBACK REFUSED" staging "$RB"
same "$POST" "$(snap)" "the refused rollback left the ACL snapshot identical"

step "6 · the ROLLBACK restores the production pre-image"
expect_ok "rollback, TARGET_LANE=production" production "$RB"
RBACK=$(snap)
psql -q -d "$DB" -tA <<'Q'
SELECT CASE WHEN count(*)=33 THEN '  PASS  33 anon-executable definer volatile functions again — the production count'
            ELSE '  FAIL  ' || count(*) || ' anon-executable, expected 33' END
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'
   AND p.provolatile='v' AND p.prosecdef AND p.prorettype<>'trigger'::regtype
   AND has_function_privilege('anon', p.oid, 'EXECUTE');
Q
# Access-equivalence to the reading for the three roles that have named grants
# in it, and NO re-created PUBLIC entry. Both halves are the claim the header
# makes; neither is taken on trust.
psql -q -d "$DB" -tA <<'Q'
WITH reading(sig, acl) AS (
  SELECT r.sig, r.acl FROM (VALUES
   ('public.change_custom_url(text)','{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
   ('public.register_push_token(text,text)','{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
   ('public.unregister_push_token(text)','{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
   ('public.claim_username(text)','{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
   ('public.apply_decision_to_remaining(uuid,integer,text)','{=X/postgres,postgres=X/postgres,authenticated=X/postgres,anon=X/postgres,service_role=X/postgres}'),
   ('public.recompute_entry_from_tag_assignments(uuid)','{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
   ('public.clear_custom_url()','{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
  ) AS r(sig, acl))
SELECT CASE WHEN bool_and(has_function_privilege(role_, sig::regprocedure, 'EXECUTE'))
       THEN '  PASS  the 7 PUBLIC-carrying functions execute for anon, authenticated and service_role again'
       ELSE '  FAIL  a role lost access the reading gave it' END
  FROM reading, unnest(ARRAY['anon','authenticated','service_role']) role_
UNION ALL
SELECT CASE WHEN (SELECT count(*) FROM reading r JOIN pg_proc p ON p.oid = r.sig::regprocedure,
                       LATERAL aclexplode(p.proacl) a WHERE a.grantee = 0) = 0
       THEN '  PASS  and NOT by re-creating a PUBLIC grant — restored by name (R-11, F-62)'
       ELSE '  FAIL  a PUBLIC ACL entry was re-created' END;
Q

step "7 · the ROLLBACK refuses when there is nothing to undo"
expect_fail "rollback run a second time" "P1-0037-RB-PRE-002" production "$RB"
same "$RBACK" "$(snap)" "the refused second rollback left the ACL snapshot identical"

step "8 · apply → rollback → apply lands back on the same state"
expect_ok "apply again after the rollback" production "$MIG"
same "$POST" "$(snap)" "the round trip is closed: the post-apply snapshot is reproduced exactly"

step "VERDICT"
if [ "$fail" -eq 0 ]; then echo "  ALL GREEN"; else echo "  FAILURES ABOVE"; fi
exit "$fail"
