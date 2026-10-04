#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P6 · C-34 harness + R-82 synthetic test, scratch PG17 with REAL pg_cron 1.6
# (database p5cron = cron.database_name). Applies/rollbacks via the extracted
# "Run it" step (p1-0037-runit2.sh); 20261004_0005 runs exactly as dispatched
# (psql -f, no -1).   SCRATCH ONLY.   PGPORT=5433 bash docs/evidence/d1/P6/p6-run-tests.sh
# Model: a 1,000,000-row backlog older than 36 h (production's baseline was
# 202,082 rows; staging's 135,831) with ~1 KB rows (staging avg 1,012 B), plus
# the last 36 h at the post-P5 cadence (~3,400 runs/day), next to ten 13 MB
# stand-ins for launch-scale member tables.
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p5cron; BACKLOG="${BACKLOG:-1000000}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
M4="$ROOT/supabase/migrations/20261004_0004_p6_cron_history_retention.sql"
M5="$ROOT/supabase/migrations/20261004_0005_p6_cron_history_compact.sql"
RB="$ROOT/supabase/rollback/20261004_0004_p6_cron_history_retention_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_p6_cron_history.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT; fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" 5432 2>&1); rc=$?; }
probe() { local want="$1" what="$2" needle="${3:-}"; run staging "$PROBE"
  if [ "$want" = pass ]; then [ $rc -eq 0 ] && { echo "  PASS  PROBE passes — $what"; echo "$out" | grep -o 'PROBE PASS.*' | sed 's/^/        /'; } || { echo "  FAIL  PROBE should pass — $what"; echo "$out" | grep ERROR; fail=1; }
  else [ $rc -ne 0 ] && echo "$out" | grep ERROR | grep -q "$needle" && { echo "  PASS  PROBE refuses — $what:"; echo "$out" | grep -m1 ERROR | sed 's/.*ERROR: */        /'; } || { echo "  FAIL  PROBE should refuse — $what"; echo "$out" | grep ERROR | head -2; fail=1; }; fi; }
state() { echo "        job_run_details: $(q "SELECT count(*) FROM cron.job_run_details") rows, $(q "SELECT pg_size_pretty(pg_total_relation_size('cron.job_run_details'))"), rank #$(q "SELECT r FROM (SELECT oid, row_number() OVER (ORDER BY pg_total_relation_size(oid) DESC) r FROM pg_class WHERE relkind IN ('r','m')) x WHERE oid='cron.job_run_details'::regclass")"; }

step "1 · build-time check: self-test; staging's tree is red without 20261004_0004"
node "$ROOT/scripts/db-p6-cron-history-check.test.mjs" | tail -1 | grep -q 'ALL CASES PASS' && echo "  PASS  self-test (11 cases)" || { echo "  FAIL  self-test"; fail=1; }
mkdir -p "$T/supabase/migrations"; cp "$ROOT"/supabase/migrations/*.sql "$T/supabase/migrations/"; rm -f "$T"/supabase/migrations/20261004_000[45]_p6_*.sql
out=$(node "$ROOT/scripts/db-p6-cron-history-check.mjs" "$T" 2>&1); [ $? -eq 1 ] && { echo "  PASS  FAIL FIRST: staging's tree:"; echo "$out" | grep HIT | sed 's/^/        /'; } || { echo "  FAIL  expected red"; fail=1; }
node "$ROOT/scripts/db-p6-cron-history-check.mjs" "$ROOT" >/dev/null && echo "  PASS  with 20261004_0004 the tree is green" || { echo "  FAIL  tree with fix"; fail=1; }

step "2 · scratch: real pg_cron, staging's purge job verbatim, the backlog"
q "SELECT cron.unschedule(jobid) FROM cron.job" >/dev/null 2>&1
q "DELETE FROM cron.job_run_details" >/dev/null
q "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public" >/dev/null 2>&1
q "DO \$r\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END \$r\$"
q "SELECT cron.schedule('purge-cron-history', '0 3 * * *', ' delete from cron.job_run_details where end_time < now() - interval ''7 days'' ')" >/dev/null
q "INSERT INTO cron.job_run_details (jobid, job_pid, database, username, command, status, return_message, start_time, end_time)
   SELECT 2, 0, 'postgres', 'postgres', repeat('select net.http_post(url := ''https://x.example/functions/v1/job'', headers := ''{}''::jsonb) ', 8),
          'failed', 'job startup timeout', t, t + interval '1 second'
     FROM (SELECT now() - interval '8 days' + (g * (interval '6 days 12 hours' / $BACKLOG)) AS t FROM generate_series(1, $BACKLOG) g) x"
q "INSERT INTO cron.job_run_details (jobid, job_pid, database, username, command, status, return_message, start_time, end_time)
   SELECT 9, 0, 'postgres', 'postgres', repeat('select public.drain_post_jobs(100) ', 20), 'succeeded', '1 row', t, t + interval '1 second'
     FROM (SELECT now() - interval '36 hours' + (g * interval '25 seconds') AS t FROM generate_series(1, 5100) g) x"
for i in $(seq 1 10); do q "CREATE TABLE public.member_table_$i AS SELECT g AS id, md5(g::text) AS a, md5((g+1)::text) AS b FROM generate_series(1, 150000) g"; done
q "VACUUM ANALYZE"
state
probe fail "staging's daily 7-day unbounded delete" "no active hourly purge-cron-history"

step "3 · apply 20261004_0004 (lane staging)"
run staging "$M4"; [ $rc -eq 0 ] && echo "  PASS  apply — $(echo "$out" | grep -o 'P6-0004: .*')" || { echo "  FAIL  apply"; echo "$out" | grep ERROR; fail=1; }
echo "        saved: $(q "SELECT schedule||' ·'||command FROM public.p6_cron_previous")"
run staging "$M4"; [ $rc -ne 0 ] && echo "$out" | grep -q 'P6-0004-PRE-002' && echo "  PASS  second apply refused (PRE-002)" || { echo "  FAIL  second apply"; fail=1; }
probe fail "the backlog is still there (oldest > 49 h)" "oldest finished run"
out=$(psql -X -d "$DB" -c "CALL public.purge_cron_run_details(interval '7 days')" 2>&1); echo "$out" | grep -q 'outside the P6 gate' && echo "  PASS  a 7-day retention is refused by the procedure itself" || { echo "  FAIL  7-day keep accepted"; fail=1; }
out=$(psql -X -d "$DB" -c "BEGIN" -c "CALL public.purge_cron_run_details()" -c "ROLLBACK" 2>&1); echo "$out" | grep -q 'invalid transaction termination' && echo "  PASS  inside a transaction block the procedure refuses (it must COMMIT per batch)" || { echo "  FAIL  ran inside a transaction"; echo "$out" | tail -2; fail=1; }

step "4 · real pg_cron runs the CALL (job switched to every 5 s for this step only)"
q "SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='purge-cron-history'), schedule := '5 seconds')" >/dev/null
before=$(q "SELECT count(*) FROM cron.job_run_details WHERE end_time < now() - interval '36 hours'")
for i in $(seq 1 60); do st=$(q "SELECT status FROM cron.job_run_details WHERE command ~* 'purge_cron_run_details' ORDER BY runid DESC LIMIT 1"); [ "$st" = succeeded ] && break; sleep 1; done
q "SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='purge-cron-history'), schedule := '17 * * * *')" >/dev/null
want "$st" "succeeded" "pg_cron ran 'CALL public.purge_cron_run_details();' to completion (COMMIT per batch inside a cron job works)"
echo "        rows older than 36 h: $before → $(q "SELECT count(*) FROM cron.job_run_details WHERE end_time < now() - interval '36 hours'")"
echo "        return_message: $(q "SELECT left(return_message, 80) FROM cron.job_run_details WHERE command ~* 'purge_cron_run_details' ORDER BY runid DESC LIMIT 1")"
state
echo "        (the rows are gone, the file is not: a plain DELETE leaves the space inside it)"

step "5 · 20261004_0005 exactly as dispatched (psql -f, no -1): purge + VACUUM FULL"
q "INSERT INTO cron.job_run_details (jobid, job_pid, database, username, command, status, return_message, start_time, end_time)
   SELECT 2, 0, 'postgres', 'postgres', repeat('x', 900), 'failed', 'job startup timeout', t, t
     FROM (SELECT now() - interval '6 days' + g * interval '1 second' AS t FROM generate_series(1, 200000) g) x"
echo "        re-seeded 200,000 old rows (production's baseline size) to time the batches"
t0=$(date +%s%3N); run staging "$M5"; t1=$(date +%s%3N)
[ $rc -eq 0 ] && echo "  PASS  0005 applied in $((t1 - t0)) ms — $(echo "$out" | grep -o 'purge_cron_run_details: .*' | head -1)" || { echo "  FAIL  0005"; echo "$out" | grep ERROR; fail=1; }
state
probe pass "after the purge + compaction"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -1 -c "SET p32.lane = 'staging';" -f "$M5" 2>&1); echo "$out" | grep -q -E 'cannot run inside a transaction block|invalid transaction termination' && echo "  PASS  under psql -1 the file refuses (cannot half-run in single-transaction mode)" || { echo "  FAIL  -1 mode"; echo "$out" | grep ERROR | head -2; fail=1; }

step "6 · bounded batches: each batch is its own transaction"
q "INSERT INTO cron.job_run_details (jobid, job_pid, database, username, command, status, return_message, start_time, end_time)
   SELECT 2, 0, 'postgres', 'postgres', 'x', 'failed', 'x', t, t FROM (SELECT now() - interval '4 days' + g * interval '1 second' AS t FROM generate_series(1, 23456) g) x"
x0=$(q "SELECT txid_current()")
out=$(psql -X -d "$DB" -c "CALL public.purge_cron_run_details()" 2>&1)
x1=$(q "SELECT txid_current()")
echo "        $(echo "$out" | grep -o 'purge_cron_run_details: .*')"
[ $((x1 - x0)) -ge 5 ] && echo "  PASS  23,456 rows → 5 batches of ≤ 5,000, $((x1 - x0 - 1)) transaction id(s) consumed (one per batch, not one for all)" || { echo "  FAIL  batches/xids $((x1-x0))"; fail=1; }

step "7 · rollback: lane guard, exact restore"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'ROLLBACK REFUSED' && echo "  PASS  rollback with no lane — refused" || { echo "  FAIL  rollback guard"; fail=1; }
run production "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback (lane production)" || { echo "  FAIL  rollback"; echo "$out" | grep ERROR; fail=1; }
want "$(q "SELECT schedule||'|'||command FROM cron.job WHERE jobname='purge-cron-history'")" "0 3 * * *| delete from cron.job_run_details where end_time < now() - interval '7 days' " "the job is back byte for byte"
probe fail "after the rollback" "no active hourly purge-cron-history"
q "SELECT cron.unschedule(jobid) FROM cron.job" >/dev/null; q "DELETE FROM cron.job_run_details" >/dev/null

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
