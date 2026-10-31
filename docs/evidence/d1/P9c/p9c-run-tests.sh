#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P9-c (20261005_0003) · C-34 harness on a scratch PG17, real pg_cron 1.6; vault
# and pg_net stubbed with their real signatures (p9c-fixture.sql). Every apply /
# rollback / probe runs through apply-migration.yml's extracted "Run it" step.
# SCRATCH ONLY.   PGPORT=5433 bash docs/evidence/d1/P9c/p9c-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p5cron
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20261005_0003_p9c_cron_http_into_vault.sql"
RB="$ROOT/supabase/rollback/20261005_0003_p9c_cron_http_into_vault_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_p9c_cron_http.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
SIX="'apply-scheduled-boosts','autoscale-ad-traffic','expire-gift-credits','judging-invariants-nightly','send-reengagement-emails','backup-reminder'"
fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" 5432 2>&1); rc=$?; }
probe_is() { run staging "$PROBE"; if [ "$1" = pass ]; then [ $rc -eq 0 ] && { echo "  PASS  PROBE passes — $2"; echo "$out" | grep -o 'PROBE PASS.*' | sed 's/^/        /' | cut -c1-220; } || { echo "  FAIL  PROBE should pass — $2"; echo "$out" | grep -E 'ERROR|^  C' | head -4; fail=1; }
  else [ $rc -ne 0 ] && echo "$out" | grep -q "${3:-PROBE FAIL P9-c}" && { echo "  PASS  PROBE refuses — $2:"; echo "$out" | grep -E '^  C|PROBE FAIL P9-c: C1 public' | grep -v RAISE | sed 's/.*ERROR: */        /; s/^  C/          C/' | head -7; } || { echo "  FAIL  PROBE should refuse — $2"; echo "$out" | grep -E 'ERROR|NOTICE|^  C' | tail -4; fail=1; }; fi; }
fixture() {
  q "SELECT cron.unschedule(jobid) FROM cron.job" >/dev/null 2>&1; q "DELETE FROM cron.job_run_details" >/dev/null 2>&1
  q "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS vault CASCADE; DROP SCHEMA IF EXISTS net CASCADE; CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null 2>&1
  psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p9c-fixture.sql" >/dev/null || { echo "  FAIL  fixture"; exit 2; }; }
jobs_md5() { q "SELECT string_agg(jobname||'='||md5(schedule||'|'||command), ' ' ORDER BY jobname) FROM cron.job WHERE jobname IN ($SIX)"; }
# run every one of the six commands once, by hand; print the requests made (url + header names + body), one line per job
calls() { q "TRUNCATE net.http_request_queue" >/dev/null
  q "DO \$d\$ DECLARE r record; BEGIN FOR r IN SELECT command FROM cron.job WHERE jobname IN ($SIX) ORDER BY jobname LOOP EXECUTE r.command; END LOOP; END \$d\$" >/dev/null
  q "SELECT md5(string_agg(url||'|'||headers::text||'|'||body::text||'|'||timeout_milliseconds, E'\n' ORDER BY id)) || ' (' || count(*) || ' calls)' FROM net.http_request_queue"; }

step "0 · fixture: production's six HTTP jobs (literal headers, invented values) + one plain SQL job"
fixture
q "SELECT '  server '||current_setting('server_version')||' · pg_cron '||(SELECT extversion FROM pg_extension WHERE extname='pg_cron')"
ORIG=$(jobs_md5); BEFORE=$(calls)
echo "  the six commands, executed by hand: $BEFORE"

step "1 · fail first: the PROBE, and a real scheduler run copying the literal into its history"
probe_is fail "before 0003" "C1 public.cron_http_call(text) is not installed"
q "SELECT cron.alter_job(jobid, schedule := '* * * * *', active := true) FROM cron.job WHERE jobname = 'backup-reminder'" >/dev/null
for i in $(seq 1 14); do sleep 5; [ "$(q "SELECT count(*) FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='backup-reminder') AND status = 'succeeded'")" -ge 1 ] && break; done
want "$(q "SELECT (count(*) > 0)::text FROM cron.job_run_details WHERE command LIKE '%FIXTURE-NOT-A-SECRET%'")" "true" "F-P6-1 shown: the scheduler's run history holds the literal credential"
q "SELECT cron.alter_job(jobid, schedule := '0 8 * * 1', active := false) FROM cron.job WHERE jobname = 'backup-reminder'" >/dev/null
q "DELETE FROM cron.job_run_details" >/dev/null
want "$(jobs_md5)" "$ORIG" "fixture back to its first state"

step "2 · apply 20261005_0003 (lane production) and probe"
run production "$MIG"; [ $rc -eq 0 ] && echo "  PASS  apply — $(echo "$out" | grep -o 'P9c-0003: [0-9]* job(s) moved' | head -1)" || { echo "  FAIL  apply"; echo "$out" | grep -E 'ERROR|CONTEXT' | head -4; fail=1; }
q "SELECT '    '||jobname||'  ['||schedule||']  '||command FROM cron.job WHERE jobname IN ($SIX) ORDER BY jobname"
want "$(q "SELECT count(*) FROM cron.job WHERE command LIKE '%FIXTURE%' OR command ILIKE '%http_post%'")" "0" "no literal and no HTTP call left in any command"
want "$(q "SELECT count(*) FROM vault.secrets WHERE name LIKE 'p9_cron_http:%'")|$(q "SELECT count(*) FROM vault.secrets WHERE name LIKE 'p9_cron_previous:%'")" "6|6" "six targets and six previous jobs in vault"
want "$(q "SELECT string_agg(jobname||'='||schedule, ' ' ORDER BY jobname) FROM cron.job WHERE jobname IN ($SIX)")" "apply-scheduled-boosts=*/5 * * * * autoscale-ad-traffic=0 */6 * * * backup-reminder=0 8 * * 1 expire-gift-credits=15 0 * * * judging-invariants-nightly=0 2 * * * send-reengagement-emails=0 9 * * *" "every schedule unchanged"
want "$(calls)" "$BEFORE" "EQUIVALENCE: the six new commands make byte-identical requests (url, headers, body, timeout) to the old ones"
probe_is pass "after 0003 (C2 judges all 7 jobs: rollup-engagement-daily's short literals are not a hit)"
run production "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'P9c-0003-PRE-003' && echo "  PASS  a second apply is refused (PRE-003)" || { echo "  FAIL  second apply"; fail=1; }

step "3 · the real scheduler runs a moved job; its history holds no credential"
q "SELECT cron.alter_job(jobid, schedule := '* * * * *', active := true) FROM cron.job WHERE jobname = 'backup-reminder'" >/dev/null
for i in $(seq 1 14); do sleep 5; s=$(q "SELECT status FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='backup-reminder') ORDER BY start_time DESC LIMIT 1"); [ "$s" = succeeded ] && break; done
want "$s|$(q "SELECT count(*) FROM cron.job_run_details WHERE command LIKE '%FIXTURE%'")" "succeeded|0" "run succeeded; 0 history rows hold the literal"
want "$(q "SELECT (count(*) >= 1)::text FROM net.http_request_queue WHERE url LIKE '%/backup-reminder'")" "true" "…and it made its call"
q "SELECT cron.alter_job(jobid, schedule := '0 8 * * 1', active := false) FROM cron.job WHERE jobname = 'backup-reminder'" >/dev/null

step "4 · cron_http_call's own refusals"
o=$(q "SELECT public.cron_http_call('x''; drop')" 2>&1); echo "$o" | grep -q 'is not a job name' && echo "  PASS  a name that is not a job name → refused" || { echo "  FAIL  $o"; fail=1; }
o=$(q "SELECT public.cron_http_call('no-such-job')" 2>&1); echo "$o" | grep -q 'no vault target p9_cron_http:no-such-job' && echo "  PASS  a job with no vault target → RAISES (the run would show failed, never a silent skip)" || { echo "  FAIL  $o"; fail=1; }

step "5 · the PROBE catches each regression (mutants, each undone)"
mut() { q "$1" >/dev/null; probe_is fail "$3" "$2"; q "$4" >/dev/null; }
mut "SELECT cron.schedule('expire-gift-credits', '15 0 * * *', \$c\$ select net.http_post(url := 'https://x.supabase.co/functions/v1/expire-gift-credits', headers := jsonb_build_object('x-cron-secret','fixture-not-a-secret-9999999999')) \$c\$)" "C2 expire-gift-credits: calls net.http" "one job put back to a literal HTTP command" "SELECT cron.schedule('expire-gift-credits', '15 0 * * *', 'SELECT public.cron_http_call(''expire-gift-credits'');')"
mut "SELECT cron.schedule('new-http-job', '0 4 * * *', \$c\$ select net.http_post(url := 'https://x.supabase.co/functions/v1/n', headers := (select jsonb_build_object('x', decrypted_secret) from vault.decrypted_secrets where name = 'n')) \$c\$)" "C2 new-http-job: reads the vault inline" "a NEW job with an inline vault read (not one of the six)" "SELECT cron.unschedule('new-http-job')"
mut "DELETE FROM vault.secrets WHERE name = 'p9_cron_http:autoscale-ad-traffic'" "C1 autoscale-ad-traffic: no vault target" "a vault target deleted" "SELECT vault.create_secret('{\"url\":\"https://fixture-not-a-project.supabase.co/functions/v1/autoscale-ad-traffic\"}', 'p9_cron_http:autoscale-ad-traffic')"
mut "GRANT EXECUTE ON FUNCTION public.cron_http_call(text) TO authenticated" "C3" "authenticated granted cron_http_call" "REVOKE EXECUTE ON FUNCTION public.cron_http_call(text) FROM authenticated"
probe_is pass "every mutant undone"

step "6 · rollback (lane guard first): the six jobs byte for byte"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'ROLLBACK REFUSED' && echo "  PASS  rollback with no lane — refused" || { echo "  FAIL  rollback lane guard"; fail=1; }
run production "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback (lane production)" || { echo "  FAIL  rollback"; echo "$out" | grep ERROR | head -3; fail=1; }
want "$(jobs_md5)" "$ORIG" "all six jobs restored byte for byte (schedule and command)"
want "$(q "SELECT count(*) FROM vault.secrets WHERE name LIKE 'p9\_cron\_%'")|$(q "SELECT to_regprocedure('public.cron_http_call(text)') IS NULL")" "0|t" "0003's vault secrets and function removed"
probe_is fail "after the rollback"

step "7 · STAGING SHAPE: only three of the six exist"
fixture
q "SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('autoscale-ad-traffic','send-reengagement-emails','backup-reminder')" >/dev/null
ORIG3=$(jobs_md5)
run staging "$MIG"; [ $rc -eq 0 ] && echo "  PASS  apply — $(echo "$out" | grep -o 'P9c-0003: [0-9]* job(s) moved' | head -1); skipped: $(echo "$out" | grep -o 'no [a-z-]* job on this lane' | sed 's/ job on this lane//; s/^no //' | tr '\n' ' ')" || { echo "  FAIL  apply staging shape"; echo "$out" | grep ERROR | head -3; fail=1; }
want "$(q "SELECT count(*) FROM cron.job WHERE jobname IN ($SIX)")" "3" "no job created for the three that do not exist"
probe_is pass "staging shape"
run staging "$RB"; [ $rc -eq 0 ] && want "$(jobs_md5)" "$ORIG3" "rollback restores the three byte for byte" || { echo "  FAIL  rollback staging shape"; fail=1; }

step "8 · refusals that change nothing"
fixture; ORIG=$(jobs_md5)
q "SELECT cron.schedule('judging-invariants-nightly', '0 2 * * *', \$c\$ select net.http_post(url := 'https://fixture-not-a-project.supabase.co/functions/v1/judging-invariants-nightly', headers := jsonb_build_object('x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'missing_on_this_lane'))) \$c\$)" >/dev/null
J2=$(jobs_md5)
run production "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'P9c-0003-MOVE-002' && echo "  PASS  an inline vault read whose secret is missing → refused (MOVE-002)" || { echo "  FAIL  MOVE-002"; echo "$out" | grep ERROR | head -2; fail=1; }
want "$(jobs_md5)|$(q "SELECT to_regprocedure('public.cron_http_call(text)') IS NULL")|$(q "SELECT count(*) FROM vault.secrets WHERE name LIKE 'p9%'")" "$J2|t|0" "…and nothing changed (whole transaction rolled back)"
q "SELECT cron.schedule('expire-gift-credits', '15 0 * * *', \$c\$ select net.http_post(url := 'https://fixture-not-a-project.supabase.co/functions/v1/expire-gift-credits'); select 1 \$c\$)" >/dev/null
run production "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'P9c-0003-PRE-002: not a single "select net.http_post(...)": expire-gift-credits' && echo "  PASS  a job of another shape → refused by name (PRE-002), command not printed" || { echo "  FAIL  PRE-002"; echo "$out" | grep ERROR | head -2; fail=1; }
q "SELECT cron.unschedule(jobid) FROM cron.job" >/dev/null

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
