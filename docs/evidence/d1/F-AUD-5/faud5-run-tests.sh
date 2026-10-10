#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# F-AUD-5 (INFO) · PROBE_p9_email_queue_wake's "long literal" scan, two lanes.
#   The merged PROBE judged a long literal with '[^'']{17,}' — that also matches
#   the text BETWEEN two short literals, so production's OPEN list named
#   rollup-engagement-daily (two short literals, no HTTP). The fix uses
#   PROBE_p9c's exact scan (literals read in order, '' kept inside one,
#   17+ chars, the job's own name exempt) in E1 and in the OPEN list.
#   FAIL FIRST: a fixture job with two short literals and no HTTP is listed
#   OPEN by the merged PROBE (and, as process-email-queue's command, turns E1
#   red); the fixed PROBE lists nothing / stays green.
#   CONTROLS: the fixed PROBE still catches a real long literal (also one with
#   '' inside), an http_post, and a long literal in process-email-queue (E1).
# Lane shapes: STAGING (no process-email-queue job, auth queue absent) and
# PRODUCTION (both queues + the job), from p9-email-fixture.sql — real pg_cron
# + pgmq 1.5.1, vault and pg_net stubbed. Every value is invented.
# SCRATCH CLUSTER ONLY.   bash docs/evidence/d1/F-AUD-5/faud5-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p5cron; OLD_REF="${OLD_REF:-070132a}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
FIX="$ROOT/docs/evidence/d1/P9/p9-email-fixture.sql"
MIG="$ROOT/supabase/migrations/20261004_0006_p9_email_queue_wake.sql"
PROBE="$ROOT/supabase/migrations/PROBE_p9_email_queue_wake.sql"
P9C="$ROOT/supabase/migrations/PROBE_p9c_cron_http.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
OPROBE="$T/old_PROBE.sql"
git -C "$ROOT" show "$OLD_REF:supabase/migrations/PROBE_p9_email_queue_wake.sql" > "$OPROBE" || { echo "cannot read the merged PROBE at $OLD_REF"; exit 2; }
fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
pass() { echo "  PASS  $*"; }
bad() { echo "  FAIL  $*"; fail=1; }
probe() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" 5432 2>&1); rc=$?; }
open_of() { echo "$out" | grep -o 'OPEN (P9-c, not this unit): .*' | head -1 | sed 's/.*: //; s/"$//'; }
job() { q "SELECT cron.schedule('$1', '0 3 * * *', \$c\$$2\$c\$)" >/dev/null; q "SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname='$1'" >/dev/null; }
drop() { q "SELECT cron.unschedule('$1')" >/dev/null 2>&1; }
set_cmd() { q "UPDATE cron.job SET command = \$c\$$1\$c\$ WHERE jobname='process-email-queue'" >/dev/null; }

# Two short literals, no HTTP: the text between them (", now()) - interval ") is 19 chars.
TWO_SHORT="SELECT public.rollup_engagement_daily(date_trunc('day', now()) - interval '1 day');"
LONG="SELECT public.some_job('fixture-not-a-secret-2222222222');"
LONG_Q="SELECT public.some_job('it''s-a-fixture-not-a-secret-33');"
HTTP="SELECT net.http_post(url := 'https://x.invalid/f', body := '{}'::jsonb);"
OWN="SELECT public.cron_http_call('judging-invariants-nightly');"

fixture() {   # $1 = staging | production
  q "SELECT cron.unschedule(jobid) FROM cron.job" >/dev/null 2>&1; q "DELETE FROM cron.job_run_details" >/dev/null 2>&1
  q "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS vault CASCADE; DROP SCHEMA IF EXISTS net CASCADE; DROP EXTENSION IF EXISTS pgmq CASCADE; CREATE EXTENSION pgmq; CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null 2>&1
  psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$FIX" >/dev/null || { echo "  FAIL  fixture"; exit 2; }
  q "SELECT cron.alter_job(jobid, active := false) FROM cron.job" >/dev/null
  if [ "$1" = staging ]; then
    q "SELECT pgmq.drop_queue('auth_emails'); SELECT pgmq.drop_queue('auth_emails_dlq'); SELECT pgmq.drop_queue('transactional_emails_dlq'); SELECT cron.unschedule('process-email-queue'); DELETE FROM public.email_send_state;" >/dev/null
  fi
  out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$MIG" 5432 2>&1) || { echo "  FAIL  0006 apply on the $1 shape"; echo "$out" | grep ERROR | head -3; exit 2; }
  echo "  lane shape: $1 · queues $(q "SELECT string_agg(queue_name, ',' ORDER BY queue_name) FROM pgmq.list_queues()") · process-email-queue jobs $(q "SELECT count(*) FROM cron.job WHERE jobname='process-email-queue'") · 0006 applied"
}

step "0 · the fixed PROBE uses PROBE_p9c's literal scan byte for byte"
RX=$(grep -o "regexp_matches(j.command, '''((?:\[^'']|'''')\*)''', 'g') m" "$P9C" | head -1)
[ -n "$RX" ] && grep -qF "$RX" "$PROBE" && grep -qF "WHERE length(m[1]) >= 17 AND m[1] <> j.jobname" "$PROBE" && grep -qF "WHERE length(m[1]) >= 17 AND m[1] <> j.jobname" "$P9C" \
  && pass "E1 scan = p9c scan (regexp_matches …, length >= 17, own name exempt)" || bad "E1 scan differs from p9c"
grep -qF "regexp_matches(c.command, '''((?:[^'']|'''')*)''', 'g') m" "$PROBE" && grep -qF "WHERE length(m[1]) >= 17 AND m[1] <> c.jobname" "$PROBE" \
  && pass "OPEN scan = p9c scan" || bad "OPEN scan differs from p9c"
[ "$(grep -v '^\s*--' "$PROBE" | grep -c "\[^''\]{17,}" | tr -d ' ')" = 0 ] && pass "no '[^'']{17,}' left in the fixed PROBE's code (the header comment names it)" || bad "old regex still present in code"

for LANE in staging production; do
  step "$LANE · OPEN list"
  fixture $LANE
  job rollup-engagement-daily "$TWO_SHORT"
  probe $LANE "$OPROBE"
  [ $rc -eq 0 ] && [ "$(open_of)" = "rollup-engagement-daily" ] \
    && pass "FAIL FIRST — merged PROBE lists the two-short-literal job as OPEN: $(open_of)" || { bad "merged PROBE should list rollup-engagement-daily (rc=$rc, OPEN=$(open_of))"; echo "$out" | grep -E 'ERROR' | head -2; }
  probe $LANE "$PROBE"
  [ $rc -eq 0 ] && [ "$(open_of)" = "none" ] \
    && pass "fixed PROBE passes, OPEN: none" || { bad "fixed PROBE (rc=$rc, OPEN=$(open_of))"; echo "$out" | grep -E 'ERROR' | head -2; }
  job a-long-literal "$LONG"; job b-long-with-quote "$LONG_Q"; job c-http "$HTTP"; job judging-invariants-nightly "$OWN"
  probe $LANE "$PROBE"
  [ $rc -eq 0 ] && [ "$(open_of)" = "a-long-literal, b-long-with-quote, c-http" ] \
    && pass "control — fixed PROBE still lists a real long literal, one with '' inside, and an http_post; own name exempt: $(open_of)" \
    || bad "control (rc=$rc, OPEN=$(open_of))"
  probe $LANE "$OPROBE"
  echo "        (merged PROBE on the same set lists: $(open_of))"
  for j in a-long-literal b-long-with-quote c-http judging-invariants-nightly rollup-engagement-daily; do drop $j; done

  if [ $LANE = production ]; then
    step "production · E1 (process-email-queue's own command)"
    probe $LANE "$PROBE"; [ $rc -eq 0 ] && pass "fixed PROBE green on 0006's command: $(q "SELECT command FROM cron.job WHERE jobname='process-email-queue'")" || bad "baseline E1"
    set_cmd "SELECT public.email_queue_tick() WHERE 'a' = 'a' AND current_date > '2026-01-01';"
    probe $LANE "$OPROBE"
    [ $rc -ne 0 ] && echo "$out" | grep -q 'E1 the command holds a long quoted literal' \
      && pass "FAIL FIRST — merged PROBE turns E1 red on short literals only (gap ' AND current_date > ' is 21 chars)" || bad "merged PROBE should be red on E1 here (rc=$rc)"
    probe $LANE "$PROBE"
    [ $rc -eq 0 ] && pass "fixed PROBE green on the same command" || { bad "fixed PROBE E1 (rc=$rc)"; echo "$out" | grep ERROR | head -2; }
    set_cmd "SELECT public.email_queue_tick() WHERE 'fixture-not-a-secret-4444444444' IS NOT NULL;"
    probe $LANE "$PROBE"
    [ $rc -ne 0 ] && echo "$out" | grep -q 'E1 the command holds a long quoted literal' \
      && pass "control — fixed PROBE red on a real long literal in process-email-queue" || bad "fixed PROBE should be red on E1 here (rc=$rc)"
    set_cmd "SELECT public.email_queue_tick() WHERE 'process-email-queue' IS NOT NULL;"
    probe $LANE "$PROBE"
    [ $rc -eq 0 ] && pass "control — the job's own name is not a credential (p9c rule)" || bad "own-name exemption on E1 (rc=$rc)"
  else
    step "staging · E1: no process-email-queue job on this lane — E1 has nothing to read (same as the live lane)"
    probe $LANE "$PROBE"; [ $rc -eq 0 ] && echo "$out" | grep -q 'job absent on this lane' && pass "fixed PROBE: 'job absent on this lane'" || bad "staging E1 (rc=$rc)"
  fi
done

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
