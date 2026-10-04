#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P5 · the C-34 harness + the R-82 synthetic test, on a scratch PG17 running the
# REAL pg_cron 1.6 and pgmq 1.5.1. Every apply/rollback/probe runs through the
# extracted "Run it" step of apply-migration.yml (p1-0037-runit2.sh).
# Needs: shared_preload_libraries='pg_cron', cron.database_name='p5cron'.
# SCRATCH CLUSTER ONLY.   PGPORT=5433 bash docs/evidence/d1/P5/p5-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p5cron; WINDOW="${WINDOW:-30}"; LOAD="${LOAD:-5000}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20261004_0002_p5_post_jobs_idle_backoff.sql"
RB="$ROOT/supabase/rollback/20261004_0002_p5_post_jobs_idle_backoff_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_p5_cron_cadence.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" 5432 2>&1); rc=$?; }
probe_is() { run staging "$PROBE"; if [ "$1" = pass ]; then [ $rc -eq 0 ] && echo "  PASS  PROBE passes — $2" || { echo "  FAIL  PROBE should pass — $2"; echo "$out" | grep ERROR | head -2; fail=1; }
  else [ $rc -ne 0 ] && echo "$out" | grep -q 'PROBE FAIL P5' && { echo "  PASS  PROBE refuses — $2:"; echo "$out" | grep -m1 ERROR | sed 's/.*ERROR: */        /' | cut -c1-160; } || { echo "  FAIL  PROBE should refuse — $2"; fail=1; }; fi; }
runs_in_window() { local before after; before=$(q "SELECT count(*) FROM cron.job_run_details WHERE jobid=(SELECT jobid FROM cron.job WHERE jobname='process-post-jobs')"); sleep "$WINDOW"
  after=$(q "SELECT count(*) FROM cron.job_run_details WHERE jobid=(SELECT jobid FROM cron.job WHERE jobname='process-post-jobs')"); echo $((after - before)); }

step "0 · fixture: real pg_cron + pgmq, the staging job verbatim ('5 seconds')"
q "SELECT cron.unschedule(jobid) FROM cron.job" >/dev/null 2>&1
q "DELETE FROM cron.job_run_details" >/dev/null 2>&1
q "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP EXTENSION IF EXISTS pgmq CASCADE; CREATE EXTENSION pgmq;" >/dev/null 2>&1
psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p5-fixture.sql" >/dev/null || { echo "  FAIL  fixture"; exit 2; }
q "SELECT '  server '||current_setting('server_version')||' · pg_cron '||(SELECT extversion FROM pg_extension WHERE extname='pg_cron')||' · pgmq '||(SELECT extversion FROM pg_extension WHERE extname='pgmq')"
echo "  job: $(q "SELECT schedule||' · '||trim(command) FROM cron.job WHERE jobname='process-post-jobs'")"

step "1 · build-time check (self-test + tree) and the live PROBE — fail first"
node "$ROOT/scripts/db-p5-cron-cadence-check.test.mjs" | tail -1 | grep -q 'ALL CASES PASS' && echo "  PASS  self-test" || { echo "  FAIL  self-test"; fail=1; }
probe_is fail "the 5-second job, as on staging today"

step "2 · BEFORE — real pg_cron, ${WINDOW}s window, empty queue"
b=$(runs_in_window); echo "        process-post-jobs ran $b time(s) in ${WINDOW}s → $(( b * 86400 / WINDOW )) runs/day"
[ "$b" -ge $(( WINDOW / 5 - 2 )) ] && echo "  PASS  the 5-second schedule really runs ~every 5 s while idle" || { echo "  FAIL  expected ≈ $((WINDOW/5)) runs"; fail=1; }

step "3 · apply 20261004_0002 (lane staging) and probe"
run staging "$MIG"; [ $rc -eq 0 ] && echo "  PASS  apply — $(echo "$out" | grep -o 'P5-0002: .*' | head -1)" || { echo "  FAIL  apply"; echo "$out" | grep ERROR; fail=1; }
echo "  job: $(q "SELECT schedule||' · '||command FROM cron.job WHERE jobname='process-post-jobs'")"
echo "  saved: $(q "SELECT schedule||' · '||trim(command) FROM public.p5_cron_previous")"
probe_is pass "once a minute, idle-guarded"
run staging "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'P5-0002-PRE-002' && echo "  PASS  a second apply is refused (PRE-002)" || { echo "  FAIL  second apply"; fail=1; }

step "4 · AFTER — real pg_cron, ${WINDOW}s window"
a=$(runs_in_window); echo "        process-post-jobs ran $a time(s) in ${WINDOW}s (schedule '* * * * *' → 1,440 runs/day, was 17,280)"
[ "$a" -le 1 ] && echo "  PASS  at most one run in the window" || { echo "  FAIL  $a runs"; fail=1; }

step "5 · idle back-off: what one idle run costs"
r=$(psql -q -X -d "$DB" -tA -c "SET track_functions='all';" -c "SELECT pg_stat_reset();" -c "SELECT public.drain_post_jobs(100, interval '20 seconds')->>'idle';" -c "SELECT pg_stat_force_next_flush();" -c "SELECT 'calls='||coalesce((SELECT calls FROM pg_stat_user_functions WHERE funcname='process_post_jobs'),0);" | grep '^calls=')
want "$(psql -q -X -d "$DB" -tAc "SELECT public.drain_post_jobs()->>'idle'")" "true" "empty queue → {idle: true}"
want "$r" "calls=0" "…and process_post_jobs() (pgmq.read + its batch loop) is not called at all"

step "6 · load: $LOAD messages, one run"
want "$(q "SELECT count(*) FROM generate_series(1, $LOAD) g, LATERAL pgmq.send('post_jobs', jsonb_build_object('type','post_created','post_id', g))")" "$LOAD" "$LOAD messages enqueued"
res=$(psql -q -X -d "$DB" -tA -c "SET track_functions='all';" -c "SELECT pg_stat_reset();" -c "SELECT public.drain_post_jobs(100, interval '20 seconds');" -c "SELECT pg_stat_force_next_flush();" -c "SELECT 'calls='||coalesce((SELECT calls FROM pg_stat_user_functions WHERE funcname='process_post_jobs'),0);" | grep -v '^$')
calls=$(echo "$res" | grep '^calls='); res=$(echo "$res" | grep '^{')
echo "        $res"
want "$(echo "$res" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("processed"))')" "$LOAD" "one run processed all $LOAD"
want "$calls" "calls=51" "positive control for step 5's counter: the same counter sees all 51 batch calls"
want "$(q "SELECT count(*) FROM pgmq.q_post_jobs")" "0" "one run drained all $LOAD (the old job cleared 100 per 5-second run = 1,200 a minute)"

step "7 · queue absent (staging today: post_jobs does not exist)"
q "SELECT pgmq.drop_queue('post_jobs')" >/dev/null
want "$(q "SELECT public.drain_post_jobs()->>'reason'")" "queue post_jobs does not exist" "no queue → idle, no error (the old job errored or timed out 122,591 times on staging)"
q "SELECT pgmq.create('post_jobs')" >/dev/null

step "8 · rollback: lane guard, exact restore, then re-apply"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'ROLLBACK REFUSED' && echo "  PASS  rollback with no lane — refused" || { echo "  FAIL  rollback lane guard"; fail=1; }
run production "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback (lane production)" || { echo "  FAIL  rollback"; echo "$out" | grep ERROR; fail=1; }
want "$(q "SELECT schedule||'|'||command FROM cron.job WHERE jobname='process-post-jobs'")" "5 seconds| SELECT public.process_post_jobs(100); " "job restored byte for byte (schedule and command)"
want "$(q "SELECT to_regprocedure('public.drain_post_jobs(integer,interval)') IS NULL")" "t" "drain_post_jobs dropped"
probe_is fail "after the rollback"
run staging "$MIG"; [ $rc -eq 0 ] && echo "  PASS  re-apply after rollback" || { echo "  FAIL  re-apply"; fail=1; }
q "SELECT cron.unschedule('process-post-jobs')" >/dev/null

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
