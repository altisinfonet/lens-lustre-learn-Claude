#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P9 → P5-b · e-mail queue (20261004_0006) · the C-34 harness + the R-82 synthetic
# test, on a scratch PG17 running the REAL pg_cron 1.6 and REAL pgmq 1.5.1; vault
# and pg_net are stubs with their real signatures (p9-email-fixture.sql says so).
# Every apply/rollback/probe runs through the extracted "Run it" step of
# apply-migration.yml (p1-0037-runit2.sh). The edge function is simulated by
# worker(): read_email_batch(10, vt 30) per queue, then one delete_email per
# message, each its own transaction — the calls the real function makes.
# SCRATCH CLUSTER ONLY.   PGPORT=5433 bash docs/evidence/d1/P9/p9-email-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p5cron; WINDOW="${WINDOW:-30}"; BACKLOG="${BACKLOG:-500}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20261004_0006_p9_email_queue_wake.sql"
RB="$ROOT/supabase/rollback/20261004_0006_p9_email_queue_wake_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_p9_email_queue_wake.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" 5432 2>&1); rc=$?; }
probe_is() { run staging "$PROBE"; if [ "$1" = pass ]; then [ $rc -eq 0 ] && { echo "  PASS  PROBE passes — $2"; echo "$out" | grep -o 'PROBE PASS.*' | sed 's/^/        /' | cut -c1-230; } || { echo "  FAIL  PROBE should pass — $2"; echo "$out" | grep ERROR | head -3; fail=1; }
  else [ $rc -ne 0 ] && echo "$out" | grep -q 'PROBE FAIL P9-email' && { echo "  PASS  PROBE refuses — $2:"; echo "$out" | grep -E 'ERROR|^  E[0-9]' | grep -v STATEMENT | sed 's/.*ERROR: */        /; s/^  E/          E/' | head -6 | cut -c1-160; } || { echo "  FAIL  PROBE should refuse — $2"; echo "$out" | tail -3; fail=1; }; fi; }
reqs() { q "SELECT count(*) FROM net.http_request_queue"; }
pending() { q "SELECT count(*) FROM net.http_request_queue WHERE NOT done"; }
enqueue() { q "SELECT public.enqueue_email('$1', jsonb_build_object('message_id', gen_random_uuid()::text, 'to', 'member@example.invalid', 'queued_at', clock_timestamp()))" >/dev/null; }
# One simulated edge-function run, answering request $1.
worker() {
  q "UPDATE net.http_request_queue SET done = true WHERE id = $1" >/dev/null
  local qn ids sql
  for qn in auth_emails transactional_emails; do
    ids=$(q "SELECT msg_id FROM public.read_email_batch('$qn', 10, 30)")
    [ -z "$ids" ] && continue
    sql=""; for id in $ids; do sql="$sql WITH s AS (INSERT INTO public.sim_sent (msg_id, queue, enqueued_at, request_id) SELECT $id, '$qn', (message->>'queued_at')::timestamptz, $1 FROM pgmq.q_$qn WHERE msg_id = $id) SELECT public.delete_email('$qn', $id);"; done
    psql -q -X -d "$DB" -tA -c "SET client_min_messages = warning;" $(for s in $(echo "$sql" | tr ';' '\n' | sed 's/ /§/g'); do printf -- "-c %s; " "$s"; done | sed 's/§/ /g') >/dev/null 2>&1 \
      || { echo "$sql" | tr ';' '\n' | sed '/^ *$/d; s/$/;/' | psql -q -X -d "$DB" -tA >/dev/null; }
  done
}
# Answer requests until none is pending; prints the number of worker runs.
drain() { local n=0 id; while :; do id=$(q "SELECT min(id) FROM net.http_request_queue WHERE NOT done"); [ -z "$id" ] && break; worker "$id"; n=$((n+1)); [ $n -gt 400 ] && break; done; echo $n; }

step "0 · fixture: real pg_cron + pgmq, production's job shape with invented values ('10 seconds')"
q "SELECT cron.unschedule(jobid) FROM cron.job" >/dev/null 2>&1
q "DELETE FROM cron.job_run_details" >/dev/null 2>&1
q "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS vault CASCADE; DROP SCHEMA IF EXISTS net CASCADE; DROP EXTENSION IF EXISTS pgmq CASCADE; CREATE EXTENSION pgmq; CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null 2>&1
psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p9-email-fixture.sql" >/dev/null || { echo "  FAIL  fixture"; exit 2; }
q "SELECT '  server '||current_setting('server_version')||' · pg_cron '||(SELECT extversion FROM pg_extension WHERE extname='pg_cron')||' · pgmq '||(SELECT extversion FROM pg_extension WHERE extname='pgmq')"
ORIG=$(q "SELECT md5(schedule||'|'||command) FROM cron.job WHERE jobname='process-email-queue'")
ORIG_DE=$(q "SELECT md5(pg_get_functiondef('public.delete_email(text,bigint)'::regprocedure))")
echo "  job: $(q "SELECT schedule FROM cron.job WHERE jobname='process-email-queue'") · select net.http_post(url, headers {Authorization: Bearer <literal>, x-cron-secret: <literal>}) · md5 $ORIG"

step "1 · build-time check: self-test, the tree, and production's shape planted — fail first"
node "$ROOT/scripts/db-p9-cron-http-check.test.mjs" | tail -1 | grep -q 'ALL CASES PASS' && echo "  PASS  self-test" || { echo "  FAIL  self-test"; fail=1; }
node "$ROOT/scripts/db-p9-cron-http-check.mjs" "$ROOT" >/dev/null && echo "  PASS  the tree passes (no HTTP cron command in git)" || { echo "  FAIL  the tree"; fail=1; }
T=$(mktemp -d); mkdir -p "$T/supabase/migrations"; cp "$ROOT"/supabase/migrations/*.sql "$T/supabase/migrations/"
psql -q -X -d "$DB" -tA -c "SELECT format('SELECT cron.schedule(%L, %L, %s);', jobname, schedule, quote_literal(command)) FROM cron.job WHERE jobname='process-email-queue'" > "$T/supabase/migrations/20261005_9999_planted_production_shape.sql"
o=$(node "$ROOT/scripts/db-p9-cron-http-check.mjs" "$T"); r=$?
[ $r -eq 1 ] && echo "$o" | grep -q 'H1  process-email-queue' && echo "$o" | grep -q 'H3  process-email-queue' && { echo "  PASS  production's job, planted as a migration, is RED:"; echo "$o" | grep -E '^  H[0-9]' | sed 's/^/      /'; } || { echo "  FAIL  planted job not caught"; echo "$o" | tail -4; fail=1; }
rm -rf "$T"
probe_is fail "before 0006 (the wake is not installed)"

step "2 · BEFORE — real pg_cron, ${WINDOW}s window, both queues EMPTY"
b0=$(reqs); sleep "$WINDOW"; b=$(( $(reqs) - b0 ))
echo "        process-email-queue made $b HTTP call(s) in ${WINDOW}s with nothing queued → $(( b * 86400 / WINDOW )) a day"
[ "$b" -ge $(( WINDOW / 10 - 1 )) ] && echo "  PASS  the 10-second job really calls HTTP ~every 10 s while idle (A-P9-1)" || { echo "  FAIL  expected ≈ $((WINDOW/10)) calls"; fail=1; }
want "$(q "SELECT (count(*) > 0)::text FROM cron.job_run_details WHERE command LIKE '%FIXTURE-NOT-A-SECRET%'")" "true" "F-P6-1 shown: every run copies the literal credential into cron.job_run_details"

step "3 · apply 20261004_0006 (lane staging) and probe"
run staging "$MIG"; [ $rc -eq 0 ] && echo "  PASS  apply — $(echo "$out" | grep -o 'P9-0006: e-mail.*' | head -1)" || { echo "  FAIL  apply"; echo "$out" | grep -E 'ERROR|CONTEXT' | head -5; fail=1; }
echo "  job: $(q "SELECT schedule||' · '||command FROM cron.job WHERE jobname='process-email-queue'")"
want "$(q "SELECT (command LIKE '%FIXTURE%' OR command ILIKE '%http_post%')::text FROM cron.job WHERE jobname='process-email-queue'")" "false" "the command carries no literal and no HTTP call"
want "$(q "SELECT (decrypted_secret::jsonb->>'url')||' · headers '||(SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(decrypted_secret::jsonb->'headers') k) FROM vault.decrypted_secrets WHERE name='p9_cron_http:process-email-queue'")" \
     "https://fixture-not-a-project.supabase.co/functions/v1/process-email-queue · headers Authorization,Content-Type,x-cron-secret" "the target (url + the three headers) was captured into vault, evaluated in the database"
want "$(q "SELECT md5((decrypted_secret::jsonb->>'schedule')||'|'||(decrypted_secret::jsonb->>'command')) FROM vault.decrypted_secrets WHERE name='p9_cron_previous:process-email-queue'")" "$ORIG" "the previous job is kept in vault byte for byte (for the rollback)"
probe_is pass "after 0006"
run staging "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'P9-0006-PRE-003' && echo "  PASS  a second apply is refused (PRE-003)" || { echo "  FAIL  second apply"; fail=1; }

step "4 · AFTER — real pg_cron, ${WINDOW}s window, both queues EMPTY"
a0=$(reqs); sleep "$WINDOW"; a=$(( $(reqs) - a0 ))
want "$a" "0" "no HTTP call in ${WINDOW}s while idle (was $b)"
q "SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname='process-email-queue'" >/dev/null
q "UPDATE net.http_request_queue SET done = true WHERE NOT done" >/dev/null
echo "        (job paused from here on so every count below is deterministic; ticks are called by hand;"
echo "         the old job's idle calls from step 2 are marked answered)"

step "5 · a full idle day: 1,440 ticks"
r=$(psql -q -X -d "$DB" -tA -c "SET track_functions='all';" -c "SELECT pg_stat_reset();" -c "SELECT count(*) FILTER (WHERE public.email_queue_tick() = 'idle') FROM generate_series(1,1440);" -c "SELECT pg_stat_force_next_flush();" -c "SELECT 'decrypts='||coalesce((SELECT calls FROM pg_stat_user_functions WHERE funcname='_decrypt'),0);" | grep -v '^$' | tr '\n' ' ')
want "$r" "1440 decrypts=0 " "1,440 ticks → 1,440 'idle', 0 vault reads (was 8,640 HTTP calls + reads a day)"
want "$(( $(reqs) - a0 ))" "0" "…and 0 HTTP calls"

step "6 · woken by an enqueue — at commit, and only at commit"
r0=$(reqs); psql -q -X -d "$DB" -c "BEGIN; SELECT public.enqueue_email('auth_emails', '{\"message_id\":\"rolled-back\"}'); ROLLBACK;" >/dev/null 2>&1
want "$(( $(reqs) - r0 ))" "0" "a rolled-back enqueue wakes nothing"
enqueue auth_emails
want "$(( $(reqs) - r0 ))" "1" "one committed enqueue → one wake"
for i in $(seq 1 49); do enqueue auth_emails; done
want "$(( $(reqs) - r0 ))" "1" "49 more enqueues, each its own transaction, while that wake is outstanding → still one wake"
n=$(drain); sent=$(q "SELECT count(*) FROM public.sim_sent")
want "$sent" "50" "the worker chain sent all 50"
want "$n" "5" "5 worker runs (10 a batch): each batch's last delete woke the next; the sweep was never needed"
want "$(q "SELECT count(*) FROM pgmq.q_auth_emails")" "0" "queue empty"

step "7 · a backlog of $BACKLOG in one statement (a bulk send)"
q "TRUNCATE public.sim_sent" >/dev/null; r0=$(reqs)
q "SELECT count(*) FROM generate_series(1,$BACKLOG) g, LATERAL (SELECT public.enqueue_email('transactional_emails', jsonb_build_object('message_id','bulk-'||g,'queued_at',clock_timestamp()))) x" >/dev/null
want "$(( $(reqs) - r0 ))" "1" "one statement → one wake"
t0=$(date +%s%N); n=$(drain); t1=$(date +%s%N)
want "$(q "SELECT count(*) FROM public.sim_sent")" "$BACKLOG" "all $BACKLOG sent"
want "$n" "$(( BACKLOG / 10 ))" "$(( BACKLOG / 10 )) worker runs back to back, no tick"
echo "        drained in $(( (t1 - t0) / 1000000 )) ms of simulated worker time; the old job took 20 per 10-s tick → $(( BACKLOG / 20 * 10 )) s minimum"

step "8 · an enqueue while a batch is claimed waits for that batch, then goes"
q "TRUNCATE public.sim_sent" >/dev/null
for i in $(seq 1 12); do enqueue auth_emails; done
id=$(q "SELECT min(id) FROM net.http_request_queue WHERE NOT done"); q "UPDATE net.http_request_queue SET done = true WHERE id = $id" >/dev/null
ids=$(q "SELECT msg_id FROM public.read_email_batch('auth_emails', 10, 30)")
r0=$(reqs); enqueue auth_emails
want "$(( $(reqs) - r0 ))" "0" "enqueue during a claimed batch → no second worker ('busy')"
last=""; for m in $ids; do q "INSERT INTO public.sim_sent (msg_id, queue) VALUES ($m, 'auth_emails'); SELECT public.delete_email('auth_emails', $m)" >/dev/null; last=$(( $(reqs) - r0 )); [ "$m" != "$(echo $ids | awk '{print $NF}')" ] && [ "$last" != "0" ] && { echo "  FAIL  woke before the last delete"; fail=1; }; done
want "$last" "1" "the batch's LAST delete woke the next run"
n=$(drain); want "$(q "SELECT count(*) FROM public.sim_sent")" "13" "all 13 sent (10 + the 2 left + the one enqueued mid-batch)"

step "9 · rate-limited: no wake; the sweep resumes after the pause"
q "UPDATE public.email_send_state SET retry_after_until = clock_timestamp() + interval '1 hour'" >/dev/null; r0=$(reqs)
enqueue transactional_emails
want "$(( $(reqs) - r0 )):$(q "SELECT public.email_queue_tick()")" "0:idle" "enqueue and tick while rate-limited → no HTTP call"
q "UPDATE public.email_send_state SET retry_after_until = NULL" >/dev/null
want "$(q "SELECT public.email_queue_tick()"):$(( $(reqs) - r0 ))" "woken:1" "pause over → the next tick wakes it"
n=$(drain)

step "10 · a lost wake (HTTP failed, worker never read): retried after 30 s, not before"
enqueue auth_emails; r0=$(reqs)
q "UPDATE net.http_request_queue SET done = true WHERE NOT done" >/dev/null
want "$(q "SELECT public.email_queue_tick()")" "outstanding" "tick inside 30 s → 'outstanding', no second call"
q "UPDATE public.email_queue_wake_state SET last_wake_at = clock_timestamp() - interval '31 seconds'" >/dev/null
want "$(q "SELECT public.email_queue_tick()"):$(( $(reqs) - r0 ))" "woken:1" "after 30 s the tick wakes it again"
n=$(drain)

step "11 · a failing wake never fails the enqueue"
q "ALTER FUNCTION net.http_post(text,jsonb,jsonb,jsonb,integer) RENAME TO http_post_ok; CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000) RETURNS bigint LANGUAGE plpgsql AS \$f\$BEGIN RAISE EXCEPTION 'pg_net down'; END\$f\$;" >/dev/null
o=$(psql -X -d "$DB" -tAc "SELECT public.enqueue_email('auth_emails', '{\"message_id\":\"while-net-down\"}') IS NOT NULL" 2>&1)
echo "$o" | grep -q '^t$' && echo "$o" | grep -q 'WARNING:  email_queue_wake failed' && echo "  PASS  enqueue committed; the wake failure is a WARNING" || { echo "  FAIL  $o"; fail=1; }
q "DROP FUNCTION net.http_post(text,jsonb,jsonb,jsonb,integer); ALTER FUNCTION net.http_post_ok(text,jsonb,jsonb,jsonb,integer) RENAME TO http_post;" >/dev/null
want "$(q "SELECT public.email_queue_tick()")" "woken" "…and the next tick delivers it"
n=$(drain)

step "12 · delete_email allow-list (A-P9-3)"
o=$(psql -X -d "$DB" -tAc "SELECT public.delete_email('post_jobs', 1)" 2>&1); echo "$o" | grep -q 'delete_email: queue post_jobs is not permitted' && echo "  PASS  delete_email('post_jobs', …) → 42501 not permitted" || { echo "  FAIL  $o"; fail=1; }
want "$(q "SELECT public.delete_email('auth_emails', 999999)")" "f" "an allow-listed queue still works"

step "12b · the PROBE catches each regression (mutants, each undone)"
mut() { psql -q -X -d "$DB" -c "BEGIN" -c "$1" -c "COMMIT" >/dev/null 2>&1; run staging "$PROBE"; if [ $rc -ne 0 ] && echo "$out" | grep -q "$2"; then echo "  PASS  PROBE red on: $3"; else echo "  FAIL  PROBE missed: $3"; fail=1; fi; psql -q -X -d "$DB" -c "$4" >/dev/null 2>&1; }
mut "SELECT cron.schedule('process-email-queue', '10 seconds', 'SELECT public.email_queue_tick();')" "E1 schedule is sub-minute" "the job put back to 10 seconds" "SELECT cron.schedule('process-email-queue', '* * * * *', 'SELECT public.email_queue_tick();')"
mut "SELECT cron.schedule('process-email-queue', '* * * * *', \$c\$select net.http_post(url := 'https://x/functions/v1/process-email-queue', headers := jsonb_build_object('Authorization','Bearer FIXTURE-NOT-A-SECRET-0000000000'))\$c\$)" "E1 the command still calls net.http_post" "an HTTP command with a literal credential" "SELECT cron.schedule('process-email-queue', '* * * * *', 'SELECT public.email_queue_tick();')"
mut "ALTER TABLE pgmq.q_auth_emails DISABLE TRIGGER p9_email_wake" "E2 pgmq.q_auth_emails" "the wake trigger disabled" "ALTER TABLE pgmq.q_auth_emails ENABLE TRIGGER p9_email_wake"
mut "SELECT pgmq.drop_queue('auth_emails'); SELECT pgmq.create('auth_emails')" "E2 pgmq.q_auth_emails" "the queue re-created without its trigger" "CREATE TRIGGER p9_email_wake AFTER INSERT OR UPDATE OR DELETE ON pgmq.q_auth_emails FOR EACH STATEMENT EXECUTE FUNCTION public.email_queue_wake_trg()"
mut "DO \$d\$ BEGIN EXECUTE (SELECT prev_delete_email FROM public.email_queue_wake_state); END \$d\$" "E3 delete_email has no queue allow-list" "delete_email without its allow-list" "CREATE OR REPLACE FUNCTION public.delete_email(queue_name text, message_id bigint) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS \$f\$ BEGIN IF queue_name IS NULL OR queue_name NOT IN ('transactional_emails', 'auth_emails') THEN RAISE EXCEPTION 'x' USING ERRCODE = '42501'; END IF; RETURN pgmq.delete(queue_name, message_id); END \$f\$"
mut "GRANT EXECUTE ON FUNCTION public.email_queue_wake(text) TO anon" "E4 an API role" "anon granted the wake" "REVOKE EXECUTE ON FUNCTION public.email_queue_wake(text) FROM anon"
probe_is pass "every mutant undone"

step "13 · a lane with no job (staging today): rollback, unschedule, re-apply"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'ROLLBACK REFUSED' && echo "  PASS  rollback with no lane — refused" || { echo "  FAIL  rollback lane guard"; fail=1; }
run production "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback (lane production)" || { echo "  FAIL  rollback"; echo "$out" | grep -E 'ERROR|CONTEXT' | head -4; fail=1; }
want "$(q "SELECT md5(schedule||'|'||command) FROM cron.job WHERE jobname='process-email-queue'")" "$ORIG" "job restored byte for byte from vault"
want "$(q "SELECT md5(pg_get_functiondef('public.delete_email(text,bigint)'::regprocedure))")" "$ORIG_DE" "delete_email restored byte for byte"
want "$(q "SELECT (SELECT count(*) FROM pg_trigger WHERE tgname='p9_email_wake')||'/'||(SELECT count(*) FROM vault.secrets WHERE name LIKE 'p9%')")" "0/0" "no trigger and no 0006 vault secret left"
probe_is fail "after the rollback"
q "SELECT cron.unschedule('process-email-queue')" >/dev/null
run staging "$MIG"; [ $rc -eq 0 ] && echo "$out" | grep -q 'no process-email-queue job on this lane' && echo "  PASS  apply on a lane without the job — none created" || { echo "  FAIL  apply without job"; echo "$out" | grep -E 'ERROR|NOTICE' | head -4; fail=1; }
enqueue auth_emails
want "$(q "SELECT public.email_queue_tick()")" "no target" "wakes answer 'no target' (nothing wired to wake)"
probe_is pass "lane without the job"

step "14 · rollback on that lane, then re-apply with the job back"
run staging "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback (no job to restore)" || { echo "  FAIL  rollback"; fail=1; }
want "$(q "SELECT count(*) FROM cron.job WHERE jobname='process-email-queue'")" "0" "still no job (none invented)"

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
