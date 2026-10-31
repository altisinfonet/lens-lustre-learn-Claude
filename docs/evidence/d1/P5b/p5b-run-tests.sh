#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P5-b · publish-scheduled-posts only when due (20261004_0007) · the C-34 harness
# + the R-82 synthetic test, on a scratch PG17 with the REAL pg_cron 1.6; vault
# and pg_net are stubs with their real signatures (p5b-fixture.sql says so).
# Every apply/rollback/probe runs through the extracted "Run it" step of
# apply-migration.yml (p1-0037-runit2.sh). The job is paused in the fixture and
# its command is executed by hand, so every count is exact.
# SCRATCH CLUSTER ONLY.   PGPORT=5433 bash docs/evidence/d1/P5b/p5b-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p5cron; ROWS="${ROWS:-100000}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20261004_0007_p5b_scheduled_posts_due_only.sql"
RB="$ROOT/supabase/rollback/20261004_0007_p5b_scheduled_posts_due_only_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_p5b_scheduled_posts_tick.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" 5432 2>&1); rc=$?; }
probe_is() { run staging "$PROBE"; if [ "$1" = pass ]; then [ $rc -eq 0 ] && { echo "  PASS  PROBE passes — $2"; echo "$out" | grep -o 'PROBE PASS.*' | sed 's/^/        /' | cut -c1-200; } || { echo "  FAIL  PROBE should pass — $2"; echo "$out" | grep ERROR | head -3; fail=1; }
  else [ $rc -ne 0 ] && echo "$out" | grep -q "PROBE FAIL P5b" && echo "$out" | grep -q "${3:-PROBE FAIL}" && { echo "  PASS  PROBE refuses — $2:"; echo "$out" | grep -E 'ERROR|^  S[0-9]' | grep -v STATEMENT | sed 's/.*ERROR: */        /; s/^  S/          S/' | head -4 | cut -c1-160; } || { echo "  FAIL  PROBE should refuse — $2"; echo "$out" | grep -E 'ERROR|NOTICE' | head -3; fail=1; }; fi; }
reqs() { q "SELECT count(*) FROM net.http_request_queue"; }
# n executions of the job's CURRENT command, each its own transaction; prints "http=<calls> decrypts=<vault reads>".
runjob() { psql -q -X -d "$DB" -tA -c "SET track_functions='all';" -c "SELECT pg_stat_reset();" -c "SELECT count(*) FROM net.http_request_queue" \
  -c "DO \$d\$ DECLARE c text := (SELECT command FROM cron.job WHERE jobname='publish-scheduled-posts'); BEGIN FOR i IN 1..$1 LOOP EXECUTE c; END LOOP; END \$d\$;" \
  -c "SELECT pg_stat_force_next_flush();" -c "SELECT count(*) FROM net.http_request_queue" -c "SELECT coalesce((SELECT calls FROM pg_stat_user_functions WHERE funcname='_decrypt'),0);" \
  | grep -E '^[0-9]+$' | paste -sd' ' | awk '{print "http=" $2-$1 " decrypts=" $3}'; }
reset_fixture() {
  q "SELECT cron.unschedule(jobid) FROM cron.job" >/dev/null 2>&1; q "DELETE FROM cron.job_run_details" >/dev/null 2>&1
  q "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS vault CASCADE; DROP SCHEMA IF EXISTS net CASCADE; CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null 2>&1
  psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p5b-fixture.sql" >/dev/null || { echo "  FAIL  fixture"; exit 2; }; }

step "0 · fixture: real pg_cron; production's job shape (inline vault read), invented values"
reset_fixture
q "SELECT '  server '||current_setting('server_version')||' · pg_cron '||(SELECT extversion FROM pg_extension WHERE extname='pg_cron')"
ORIG=$(q "SELECT md5(schedule||'|'||command) FROM cron.job WHERE jobname='publish-scheduled-posts'")
echo "  job: * * * * * · select net.http_post(url, headers {Authorization literal, x-scheduled-posts-secret ← vault.decrypted_secrets inline}) · md5 $ORIG"

step "1 · fail first: the build check (if P9's check is on this tree) and the live PROBE"
if [ -f "$ROOT/scripts/db-p9-cron-http-check.test.mjs" ]; then
  node "$ROOT/scripts/db-p9-cron-http-check.test.mjs" | grep -q "PASS  production's publish-scheduled-posts shape: HTTP + inline vault read" && echo "  PASS  db-p9-cron-http-check reds production's shape: H1 + H2" || { echo "  FAIL  p9 check"; fail=1; }
else echo "        (scripts/db-p9-cron-http-check.mjs is in the sibling P9 PR; its self-test reds this job's shape H1 + H2)"; fi
probe_is fail "before 0007" "S2 the tick"

step "2 · BEFORE — the job's own command, a full day of minutes (1,440), nothing scheduled"
q "INSERT INTO public.scheduled_posts (user_id, scheduled_for, status) SELECT gen_random_uuid(), now() + interval '3 days', 'pending' FROM generate_series(1,5)" >/dev/null
b=$(runjob 1440); echo "        $b"
want "$b" "http=1440 decrypts=1440" "1,440 HTTP calls and 1,440 inline vault decrypts a day with no post due (A-P9-2, the P9 statement)"

step "3 · apply 20261004_0007 (lane production) and probe"
run production "$MIG"; [ $rc -eq 0 ] && echo "  PASS  apply — $(echo "$out" | grep -o 'P5b-0007: .*' | head -1)" || { echo "  FAIL  apply"; echo "$out" | grep -E 'ERROR|CONTEXT' | head -5; fail=1; }
echo "  job: $(q "SELECT schedule||' · '||command FROM cron.job WHERE jobname='publish-scheduled-posts'")"
want "$(q "SELECT decrypted_secret::jsonb->'headers'->>'x-scheduled-posts-secret' = (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='fixture_scheduled_posts_cron_secret') FROM vault.decrypted_secrets WHERE name='p9_cron_http:publish-scheduled-posts'")" "t" "the inline-read header was evaluated once into the vault target"
want "$(q "SELECT md5((decrypted_secret::jsonb->>'schedule')||'|'||(decrypted_secret::jsonb->>'command')) FROM vault.decrypted_secrets WHERE name='p9_cron_previous:publish-scheduled-posts'")" "$ORIG" "the previous job kept in vault byte for byte"
probe_is pass "after 0007"
run production "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'P5b-0007-PRE-003' && echo "  PASS  a second apply is refused (PRE-003)" || { echo "  FAIL  second apply"; fail=1; }

step "4 · AFTER — the same day, nothing due"
a=$(runjob 1440); echo "        $a"
want "$a" "http=0 decrypts=0" "0 HTTP calls, 0 vault decrypts"
want "$(q "SELECT idle_ticks FROM public.publish_scheduled_posts_tick_state")" "1440" "1,440 idle ticks counted"

step "5 · due → exactly the old call; published → idle again"
q "INSERT INTO public.scheduled_posts (id, user_id, scheduled_for, status) VALUES ('00000000-0000-0000-0000-00000000000a', gen_random_uuid(), clock_timestamp() - interval '1 second', 'pending')" >/dev/null
r0=$(reqs); want "$(q "SELECT public.publish_scheduled_posts_tick()")" "woken" "a pending post at its time → woken"
want "$(q "SELECT url||' · '||(SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(headers) k) FROM net.http_request_queue ORDER BY id DESC LIMIT 1")" \
     "https://fixture-not-a-project.supabase.co/functions/v1/publish-scheduled-posts · Authorization,Content-Type,x-scheduled-posts-secret" "the call made = the old job's url and headers"
q "UPDATE public.scheduled_posts SET status='published' WHERE id='00000000-0000-0000-0000-00000000000a'" >/dev/null
want "$(q "SELECT public.publish_scheduled_posts_tick()"):$(( $(reqs) - r0 ))" "idle:1" "once published → idle, no further call"

step "6 · the edge function's other selection: stale 'publishing' (> 5 min) is due; fresh is not"
q "INSERT INTO public.scheduled_posts (id, user_id, scheduled_for, status, updated_at) VALUES ('00000000-0000-0000-0000-00000000000b', gen_random_uuid(), now() - interval '10 minutes', 'publishing', clock_timestamp() - interval '1 minute')" >/dev/null
want "$(q "SELECT public.publish_scheduled_posts_tick()")" "idle" "publishing for 1 minute → idle (the edge function would not reclaim it)"
q "UPDATE public.scheduled_posts SET updated_at = clock_timestamp() - interval '6 minutes' WHERE id='00000000-0000-0000-0000-00000000000b'" >/dev/null
want "$(q "SELECT public.publish_scheduled_posts_tick()")" "woken" "publishing for 6 minutes → woken (the self-heal reclaim)"
q "UPDATE public.scheduled_posts SET status='failed' WHERE id='00000000-0000-0000-0000-00000000000b'" >/dev/null
q "UPDATE public.scheduled_posts SET scheduled_for = clock_timestamp() + interval '15 minutes', status='pending' WHERE id='00000000-0000-0000-0000-00000000000a'" >/dev/null
want "$(q "SELECT public.publish_scheduled_posts_tick()")" "idle" "failed rows and a post shifted +15 min → idle"

step "7 · launch scale: $ROWS scheduled_posts rows (published, failed, future) — the cost of an idle tick"
q "INSERT INTO public.scheduled_posts (user_id, scheduled_for, status, updated_at) SELECT gen_random_uuid(), now() - (g || ' minutes')::interval, CASE WHEN g % 50 = 0 THEN 'failed' ELSE 'published' END, now() - (g || ' minutes')::interval FROM generate_series(1,$ROWS) g; INSERT INTO public.scheduled_posts (user_id, scheduled_for, status) SELECT gen_random_uuid(), now() + (g || ' minutes')::interval, 'pending' FROM generate_series(1,1000) g; ANALYZE public.scheduled_posts;" >/dev/null
plan=$(psql -q -X -d "$DB" -tA -c "SET search_path=''; EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY ON) SELECT EXISTS (SELECT 1 FROM public.scheduled_posts WHERE status = 'pending' AND scheduled_for <= clock_timestamp()) OR EXISTS (SELECT 1 FROM public.scheduled_posts WHERE status = 'publishing' AND updated_at < clock_timestamp() - interval '5 minutes')")
echo "$plan" | grep -E 'Index|Seq Scan|Execution Time|Buffers: shared' | sed 's/^/        /' | head -8
echo "$plan" | grep -q 'Seq Scan' && { echo "  FAIL  a sequential scan in the due-check"; fail=1; } || echo "  PASS  both probes are index scans (idx_scheduled_posts_pending_due, idx_scheduled_posts_publishing_stale); no sequential scan"
want "$(q "SELECT public.publish_scheduled_posts_tick()")" "idle" "$ROWS + 1,000 future rows → still idle"

step "8 · a lane whose vault secret is missing: refuse rather than store a broken target"
run production "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback (lane production)" || { echo "  FAIL  rollback"; echo "$out" | grep -E 'ERROR' | head -3; fail=1; }
want "$(q "SELECT md5(schedule||'|'||command) FROM cron.job WHERE jobname='publish-scheduled-posts'")" "$ORIG" "job restored byte for byte from vault"
want "$(q "SELECT (SELECT count(*) FROM vault.secrets WHERE name LIKE 'p9%')||'/'||(to_regclass('public.idx_scheduled_posts_publishing_stale') IS NULL)")" "0/true" "0007's vault secrets and index removed"
want "$(q "SELECT count(*) FROM public.scheduled_posts")" "$(( ROWS + 1007 ))" "every scheduled_posts row still there"
probe_is fail "after the rollback" "S2 the tick"
q "UPDATE vault.secrets SET name = 'fixture_renamed' WHERE name = 'fixture_scheduled_posts_cron_secret'" >/dev/null
run production "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'P5b-0007-MOVE-002' && echo "  PASS  apply refused (MOVE-002) — nothing changed" || { echo "  FAIL  MOVE-002"; echo "$out" | grep ERROR | head -2; fail=1; }
want "$(q "SELECT md5(schedule||'|'||command) FROM cron.job WHERE jobname='publish-scheduled-posts'")|$(q "SELECT to_regprocedure('public.publish_scheduled_posts_tick()') IS NULL")" "$ORIG|t" "…the job and the schema untouched"
q "UPDATE vault.secrets SET name = 'fixture_scheduled_posts_cron_secret' WHERE name = 'fixture_renamed'" >/dev/null

step "9 · staging's shape (literal headers), lane staging"
q "SELECT cron.schedule('publish-scheduled-posts', '* * * * *', \$c\$ select net.http_post( url := 'https://fixture-staging.supabase.co/functions/v1/publish-scheduled-posts', headers := jsonb_build_object( 'Content-Type','application/json', 'Authorization','Bearer FIXTURE-NOT-A-SECRET-3333333333', 'x-scheduled-posts-secret','fixture-not-a-secret-4444444444'), body := '{}'::jsonb) \$c\$)" >/dev/null
SORIG=$(q "SELECT md5(schedule||'|'||command) FROM cron.job WHERE jobname='publish-scheduled-posts'")
run staging "$MIG"; [ $rc -eq 0 ] && echo "  PASS  apply on staging's shape" || { echo "  FAIL  apply staging shape"; echo "$out" | grep ERROR | head -3; fail=1; }
want "$(q "SELECT (command LIKE '%FIXTURE%')::text FROM cron.job WHERE jobname='publish-scheduled-posts'")" "false" "the literals left the command"
probe_is pass "staging's shape converted"

step "10 · the PROBE catches each regression (mutants, each undone)"
mut() { psql -q -X -d "$DB" -c "$1" >/dev/null 2>&1; run staging "$PROBE"; if [ $rc -ne 0 ] && echo "$out" | grep -q "$2"; then echo "  PASS  PROBE red on: $3"; else echo "  FAIL  PROBE missed: $3"; fail=1; fi; psql -q -X -d "$DB" -c "$4" >/dev/null 2>&1; }
TICK="SELECT cron.schedule('publish-scheduled-posts', '* * * * *', 'SELECT public.publish_scheduled_posts_tick();')"
mut "SELECT cron.schedule('publish-scheduled-posts', '* * * * *', \$c\$select net.http_post(url := 'u', headers := jsonb_build_object('x', (select decrypted_secret from vault.decrypted_secrets where name = 'n')))\$c\$)" "S1 the command reads the vault inline" "the inline-vault HTTP command put back" "$TICK"
mut "SELECT cron.schedule('publish-scheduled-posts', '30 seconds', 'SELECT public.publish_scheduled_posts_tick();')" "S1 schedule is sub-minute" "a 30-second schedule" "$TICK"
mut "GRANT EXECUTE ON FUNCTION public.publish_scheduled_posts_tick() TO authenticated" "S2 an API role" "authenticated granted the tick" "REVOKE EXECUTE ON FUNCTION public.publish_scheduled_posts_tick() FROM authenticated"
mut "CREATE OR REPLACE FUNCTION public.scheduled_posts_due() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS 'SELECT EXISTS (SELECT 1 FROM public.scheduled_posts WHERE status = ''pending'' AND scheduled_for <= clock_timestamp())'; UPDATE public.scheduled_posts SET updated_at = now() - interval '1 hour', status = 'publishing' WHERE id = '00000000-0000-0000-0000-00000000000b'" "S3 scheduled_posts_due() says false, the table says true" "a due-check that forgot the stale-reclaim selection" "UPDATE public.scheduled_posts SET status = 'failed' WHERE id = '00000000-0000-0000-0000-00000000000b'; CREATE OR REPLACE FUNCTION public.scheduled_posts_due() RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO '' AS 'SELECT EXISTS (SELECT 1 FROM public.scheduled_posts WHERE status = ''pending'' AND scheduled_for <= clock_timestamp()) OR EXISTS (SELECT 1 FROM public.scheduled_posts WHERE status = ''publishing'' AND updated_at < clock_timestamp() - interval ''5 minutes'')'"
probe_is pass "every mutant undone"

step "11 · rollback (lane guard first), then a lane with no job"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'ROLLBACK REFUSED' && echo "  PASS  rollback with no lane — refused" || { echo "  FAIL  rollback lane guard"; fail=1; }
run staging "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback (lane staging)" || { echo "  FAIL  rollback"; fail=1; }
want "$(q "SELECT md5(schedule||'|'||command) FROM cron.job WHERE jobname='publish-scheduled-posts'")" "$SORIG" "staging's job restored byte for byte"
q "SELECT cron.unschedule('publish-scheduled-posts')" >/dev/null
run staging "$MIG"; [ $rc -eq 0 ] && echo "$out" | grep -q 'no publish-scheduled-posts job on this lane' && echo "  PASS  apply on a lane without the job — none created" || { echo "  FAIL  no-job apply"; fail=1; }
probe_is pass "lane without the job"
run staging "$RB"; [ $rc -eq 0 ] && [ "$(q "SELECT count(*) FROM cron.job WHERE jobname='publish-scheduled-posts'")" = 0 ] && echo "  PASS  rollback there creates no job" || { echo "  FAIL  rollback no-job"; fail=1; }

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
