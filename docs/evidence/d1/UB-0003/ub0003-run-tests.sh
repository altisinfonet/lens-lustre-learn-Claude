#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# UB-0003 (20261005_0002) · C-34 harness on a scratch PG17 with real pg_cron 1.6.
# The cap is the REAL notify_admin_user_blocked() of 20261003_0002 (verbatim in
# the fixture), fired by real INSERTs into user_blocks. Every apply / rollback /
# probe runs through apply-migration.yml's extracted "Run it" step.
# SCRATCH ONLY.   PGPORT=5433 bash docs/evidence/d1/UB-0003/ub0003-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p5cron; OLD="${OLD:-200000}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20261005_0002_ub0003_notice_purge.sql"
RB="$ROOT/supabase/rollback/20261005_0002_ub0003_notice_purge_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_ub0003_notice_purge.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" 5432 2>&1); rc=$?; }
probe_is() { run staging "$PROBE"; if [ "$1" = pass ]; then [ $rc -eq 0 ] && { echo "  PASS  PROBE passes — $2"; echo "$out" | grep -o 'PROBE PASS.*' | sed 's/^/        /' | cut -c1-200; } || { echo "  FAIL  PROBE should pass — $2"; echo "$out" | grep -E 'ERROR|^  U' | head -4; fail=1; }
  else [ $rc -ne 0 ] && echo "$out" | grep -q "${3:-PROBE FAIL UB-0003}" && { echo "  PASS  PROBE refuses — $2:"; echo "$out" | grep -E 'PROBE FAIL|^  U' | grep -v RAISE | sed 's/.*ERROR: */        /; s/^  U/          U/' | head -3; } || { echo "  FAIL  PROBE should refuse — $2"; echo "$out" | grep -E 'ERROR|NOTICE' | tail -3; fail=1; }; fi; }
u() { printf '00000000-0000-0000-0000-%012d' "$1"; }
notices() { q "SELECT count(*) FROM public.admin_notifications"; }

step "0 · fixture: user_blocks + the real 24 h notice cap (20261003_0002), real pg_cron"
q "SELECT cron.unschedule(jobid) FROM cron.job" >/dev/null 2>&1; q "DELETE FROM cron.job_run_details" >/dev/null 2>&1
q "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS auth CASCADE;" >/dev/null 2>&1
psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/ub0003-fixture.sql" >/dev/null || { echo "  FAIL  fixture"; exit 2; }
q "SELECT '  server '||current_setting('server_version')||' · pg_cron '||(SELECT extversion FROM pg_extension WHERE extname='pg_cron')"

step "1 · fail first: the ledger only grows, and the PROBE refuses"
# OLD pairs notified 2..30 days ago (each a row the cap no longer needs), 300 pairs notified within the last 24 h
q "INSERT INTO public.user_block_notices SELECT ('00000000-0000-0000-0000-'||lpad((1+g%1000)::text,12,'0'))::uuid, ('00000000-0000-0000-0000-'||lpad((1001+g/1000)::text,12,'0'))::uuid, now() - interval '2 days' - (g % 28) * interval '1 day' FROM generate_series(0, $OLD - 1) g;
   INSERT INTO public.user_block_notices SELECT ('00000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid, ('00000000-0000-0000-0000-'||lpad((1999)::text,12,'0'))::uuid, now() - (g % 23) * interval '1 hour' - interval '5 minutes' FROM generate_series(1, 300) g" >/dev/null
want "$(q "SELECT count(*) FROM public.user_block_notices")" "$(( OLD + 300 ))" "$OLD rows ≥ 24 h old + 300 inside the window — nothing in the schema ever removes the old ones"
probe_is fail "before 0002 (no purge)"

step "2 · why purging is safe: the real cap, row ≥ 24 h old PRESENT vs PURGED vs YOUNGER"
A=$(u 1); B=$(u 1500); C=$(u 2); D=$(u 1600); E=$(u 3); F=$(u 1700)
q "INSERT INTO public.user_block_notices VALUES ('$A','$B', now() - interval '25 hours'), ('$E','$F', now() - interval '23 hours')" >/dev/null
n0=$(notices); q "INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('$A','$B')" >/dev/null
want "$(( $(notices) - n0 ))" "1" "pair with a 25 h-old row still present → the block notifies (the row was inert)"
n0=$(notices); q "INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('$C','$D')" >/dev/null
want "$(( $(notices) - n0 ))" "1" "pair whose row was purged (absent) → notifies the same: once"
n0=$(notices); q "INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('$E','$F')" >/dev/null
want "$(( $(notices) - n0 ))" "0" "pair with a 23 h-old row → NO notice: that row is the cap, and the purge must never touch it"
q "DELETE FROM public.user_blocks; DELETE FROM public.user_block_notices WHERE (blocker_id, blocked_id) IN (('$A','$B'),('$C','$D'),('$E','$F'))" >/dev/null

step "3 · apply 20261005_0002 (lane staging): the first purge runs inside it"
t0=$(date +%s%N); run staging "$MIG"; t1=$(date +%s%N)
[ $rc -eq 0 ] && echo "  PASS  apply in $(( (t1 - t0) / 1000000 )) ms — $(echo "$out" | grep -o 'UB0003: first purge.*' | head -1 | cut -c1-110)" || { echo "  FAIL  apply"; echo "$out" | grep -E 'ERROR|CONTEXT' | head -4; fail=1; }
want "$(q "SELECT count(*) FROM public.user_block_notices")" "300" "the 300 rows inside the 24 h window are all kept"
want "$(q "SELECT count(*) FROM public.user_block_notices WHERE notified_at < now() - interval '24 hours'")" "0" "no row older than 24 h"
probe_is pass "after 0002"
run staging "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'UB0003-PRE-002' && echo "  PASS  a second apply is refused (PRE-002)" || { echo "  FAIL  second apply"; fail=1; }
echo "  job: $(q "SELECT schedule||' · '||command FROM cron.job WHERE jobname='purge-user-block-notices'")"

step "4 · the guard and the bound"
o=$(q "SELECT public.purge_user_block_notices(interval '23 hours')" 2>&1); echo "$o" | grep -q 'below 24 hours' && echo "  PASS  _keep 23 h → refused (it would re-open the cap)" || { echo "  FAIL  $o"; fail=1; }
q "INSERT INTO public.user_block_notices SELECT ('00000000-0000-0000-0000-'||lpad((1+g%1000)::text,12,'0'))::uuid, ('00000000-0000-0000-0000-'||lpad((1001+g/1000)::text,12,'0'))::uuid, now() - interval '3 days' FROM generate_series(0, 12499) g ON CONFLICT DO NOTHING" >/dev/null
want "$(q "SELECT public.purge_user_block_notices(interval '24 hours', 1000, 5)")" "5000" "one call is bounded: batch 1000 × 5 batches = 5,000 rows"
want "$(q "SELECT public.purge_user_block_notices(interval '24 hours', 1000, 5)")|$(q "SELECT public.purge_user_block_notices(interval '24 hours', 1000, 5)")" "5000|2500" "the next calls continue where it stopped"
want "$(q "SELECT count(*) FROM public.user_block_notices")" "300" "the window's 300 rows untouched throughout"

step "5 · the PROBE catches each regression (mutants, each undone)"
mut() { q "$1" >/dev/null; probe_is fail "$3" "$2"; q "$4" >/dev/null; }
mut "SELECT cron.unschedule('purge-user-block-notices')" "U1" "the job removed" "SELECT cron.schedule('purge-user-block-notices', '23 * * * *', 'SELECT public.purge_user_block_notices();')"
mut "SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='purge-user-block-notices'), active := false)" "U1" "the job paused" "SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='purge-user-block-notices'), active := true)"
SAVED=$(q "SELECT pg_get_functiondef('public.purge_user_block_notices(interval,integer,integer)'::regprocedure)")
mut "CREATE OR REPLACE FUNCTION public.purge_user_block_notices(_keep interval DEFAULT interval '24 hours', _batch integer DEFAULT 5000, _max_batches integer DEFAULT 200) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS 'SELECT 0::bigint'" "U2" "the 24 h guard removed" "$SAVED"
mut "GRANT EXECUTE ON FUNCTION public.purge_user_block_notices(interval,integer,integer) TO authenticated" "U3" "authenticated granted the purge" "REVOKE EXECUTE ON FUNCTION public.purge_user_block_notices(interval,integer,integer) FROM authenticated"
mut "INSERT INTO public.user_block_notices VALUES ('$(u 9)','$(u 1998)', now() - interval '27 hours')" "U4 1 ledger row" "a row older than 26 h (purge not running)" "DELETE FROM public.user_block_notices WHERE blocker_id = '$(u 9)' AND blocked_id = '$(u 1998)'"
probe_is pass "every mutant undone"

step "6 · real pg_cron runs it (the job, executed by the scheduler)"
q "SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='purge-user-block-notices'), schedule := '* * * * *')" >/dev/null
q "INSERT INTO public.user_block_notices VALUES ('$(u 8)','$(u 1998)', now() - interval '30 hours')" >/dev/null
for i in $(seq 1 14); do sleep 5; s=$(q "SELECT status FROM cron.job_run_details WHERE jobid=(SELECT jobid FROM cron.job WHERE jobname='purge-user-block-notices') ORDER BY start_time DESC LIMIT 1"); [ "$s" = succeeded ] && break; done
want "$s|$(q "SELECT count(*) FROM public.user_block_notices WHERE blocker_id='$(u 8)' AND blocked_id='$(u 1998)'")" "succeeded|0" "the scheduler ran the job: status succeeded, the 30 h row gone"
q "SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='purge-user-block-notices'), schedule := '23 * * * *')" >/dev/null

step "7 · rollback (lane guard first), then re-apply"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'ROLLBACK REFUSED' && echo "  PASS  rollback with no lane — refused" || { echo "  FAIL  rollback lane guard"; fail=1; }
run production "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback (lane production)" || { echo "  FAIL  rollback"; echo "$out" | grep ERROR | head -3; fail=1; }
want "$(q "SELECT count(*) FROM cron.job WHERE jobname='purge-user-block-notices'")|$(q "SELECT to_regprocedure('public.purge_user_block_notices(interval,integer,integer)') IS NULL")|$(q "SELECT count(*) FROM public.user_block_notices")" "0|t|300" "job and function gone; the ledger untouched"
probe_is fail "after the rollback"
run staging "$MIG"; [ $rc -eq 0 ] && echo "  PASS  re-apply after rollback" || { echo "  FAIL  re-apply"; fail=1; }
q "SELECT cron.unschedule('purge-user-block-notices')" >/dev/null

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
