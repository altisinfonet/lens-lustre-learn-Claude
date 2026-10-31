#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# F-AUD-2 fix-up of 20261004_0006 (+ SEC-P9-1) · the C-34 harness, two lanes.
#   STAGING SHAPE  — pgmq.q_auth_emails absent, no process-email-queue job, an
#                    empty email_send_state (read on staging fpszgg 2026-10-05):
#                    the merged 0006 (git b2aa236) must FAIL as runs #128/#131 did;
#                    the fixed one must apply, probe, roll back and re-apply.
#   LOCK           — a second enqueue while a first enqueue's transaction is open:
#                    old function WAITS (SEC-P9-1), fixed one does not.
#   PRODUCTION SHAPE — both queues + the 10-second job: the full P9 harness
#                    (p9-email-run-tests.sh) on the fixed files.
# Real pg_cron 1.6 + pgmq 1.5.1; vault and pg_net stubbed (p9-email-fixture.sql).
# SCRATCH CLUSTER ONLY.   PGPORT=5433 bash docs/evidence/d1/P9/p9-fixup-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p5cron; OLD_REF="${OLD_REF:-b2aa236}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
REL_MIG=supabase/migrations/20261004_0006_p9_email_queue_wake.sql
REL_RB=supabase/rollback/20261004_0006_p9_email_queue_wake_ROLLBACK.sql   # unchanged by the fix-up
REL_PROBE=supabase/migrations/PROBE_p9_email_queue_wake.sql
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
for f in $REL_MIG $REL_RB $REL_PROBE; do git -C "$ROOT" show "$OLD_REF:$f" > "$T/old_$(basename $f)" || { echo "cannot read $f at $OLD_REF"; exit 2; }; done
OMIG="$T/old_$(basename $REL_MIG)"; ORB="$T/old_$(basename $REL_RB)"; OPROBE="$T/old_$(basename $REL_PROBE)"
MIG="$ROOT/$REL_MIG"; RB="$ROOT/$REL_RB"; PROBE="$ROOT/$REL_PROBE"
fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" 5432 2>&1); rc=$?; }
err() { echo "$out" | grep -m1 'ERROR' | sed 's/.*ERROR: */        /' | cut -c1-170; }
fixture() {   # $1 = staging | production
  q "SELECT cron.unschedule(jobid) FROM cron.job" >/dev/null 2>&1; q "DELETE FROM cron.job_run_details" >/dev/null 2>&1
  q "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS vault CASCADE; DROP SCHEMA IF EXISTS net CASCADE; DROP EXTENSION IF EXISTS pgmq CASCADE; CREATE EXTENSION pgmq; CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null 2>&1
  psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p9-email-fixture.sql" >/dev/null || { echo "  FAIL  fixture"; exit 2; }
  q "SELECT cron.alter_job(jobid, active := false) FROM cron.job" >/dev/null
  if [ "$1" = staging ]; then
    q "SELECT pgmq.drop_queue('auth_emails'); SELECT pgmq.drop_queue('auth_emails_dlq'); SELECT pgmq.drop_queue('transactional_emails_dlq'); SELECT cron.unschedule('process-email-queue'); DELETE FROM public.email_send_state;" >/dev/null
  fi
  echo "  lane shape: $1 · queues $(q "SELECT string_agg(queue_name, ',' ORDER BY queue_name) FROM pgmq.list_queues()") · job $(q "SELECT count(*) FROM cron.job WHERE jobname='process-email-queue'") · email_send_state rows $(q "SELECT count(*) FROM public.email_send_state")"
}

step "1 · STAGING SHAPE, the merged 0006 ($OLD_REF) — fail first: it must fail as runs #128/#131 did"
fixture staging
run staging "$OMIG"
[ $rc -ne 0 ] && echo "$out" | grep -q 'relation "pgmq.q_auth_emails" does not exist' && { echo "  PASS  the merged 0006 FAILS on the staging shape:"; err; } || { echo "  FAIL  the merged 0006 should fail here"; echo "$out" | tail -3; fail=1; }
want "$(q "SELECT (to_regprocedure('public.email_queue_wake(text)') IS NULL)::text||'/'||(SELECT count(*) FROM pg_trigger WHERE tgname='p9_email_wake')")" "true/0" "…and rolled back whole: nothing applied (staging read 05:42 says the same)"

step "2 · STAGING SHAPE, the fixed 0006"
run staging "$MIG"; [ $rc -eq 0 ] && echo "  PASS  apply — $(echo "$out" | grep -o 'P9-0006: e-mail.*' | head -1)" || { echo "  FAIL  apply"; echo "$out" | grep -E 'ERROR|CONTEXT' | head -4; fail=1; }
echo "$out" | grep -o 'pgmq.q_auth_emails does not exist on this lane[^"]*' | head -1 | sed 's/^/        NOTICE /'
echo "$out" | grep -o 'no process-email-queue job on this lane[^"]*' | head -1 | sed 's/^/        NOTICE /'
want "$(q "SELECT count(*) FROM pg_trigger WHERE tgname='p9_email_wake'")|$(q "SELECT count(*) FROM cron.job WHERE jobname='process-email-queue'")" "1|0" "one trigger (the queue that exists), no job created"
run staging "$OPROBE"; [ $rc -ne 0 ] && echo "$out" | grep -q 'relation "pgmq.q_auth_emails" does not exist' && { echo "  PASS  the merged PROBE errors on this lane (same defect, E2):"; err; } || { echo "  FAIL  old PROBE should error"; echo "$out" | tail -2; fail=1; }
run staging "$PROBE"; [ $rc -eq 0 ] && { echo "  PASS  the fixed PROBE passes:"; echo "$out" | grep -o 'PROBE PASS.*' | sed 's/^/        /' | cut -c1-200; } || { echo "  FAIL  fixed PROBE"; echo "$out" | grep ERROR | head -3; fail=1; }
q "SELECT public.enqueue_email('transactional_emails', jsonb_build_object('message_id','s1','queued_at',clock_timestamp()))" >/dev/null
want "$(q "SELECT public.email_queue_tick()")|$(q "SELECT count(*) FROM net.http_request_queue")" "no target|0" "an enqueue on staging: the wake answers 'no target', no HTTP call"
run staging "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'P9-0006-PRE-003' && echo "  PASS  a second apply is refused (PRE-003)" || { echo "  FAIL  second apply"; fail=1; }

step "3 · STAGING SHAPE, rollback (unchanged file: DROP TRIGGER IF EXISTS on an absent table only notices)"
run staging "$RB"; [ $rc -eq 0 ] && { echo "  PASS  rollback works on the staging shape"; echo "$out" | grep -o 'relation "pgmq.q_auth_emails" does not exist, skipping' | head -1 | sed 's/^/        NOTICE /'; } || { echo "  FAIL  rollback"; echo "$out" | grep ERROR | head -3; fail=1; }
want "$(q "SELECT (to_regprocedure('public.email_queue_wake(text)') IS NULL)::text||'/'||(SELECT count(*) FROM pg_trigger WHERE tgname='p9_email_wake')||'/'||(SELECT count(*) FROM cron.job WHERE jobname='process-email-queue')")" "true/0/0" "nothing left, no job invented"
want "$(q "SELECT pg_get_functiondef('public.delete_email(text,bigint)'::regprocedure) LIKE '%not permitted%'")" "f" "delete_email back to its staging body"
run staging "$MIG"; [ $rc -eq 0 ] && echo "  PASS  re-apply after rollback" || { echo "  FAIL  re-apply"; fail=1; }

step "4 · LOCK (SEC-P9-1), production shape: a second enqueue while the first enqueue's transaction is open"
lock_test() {   # $1 = migration file; prints ms the second enqueue took (lock_timeout 3 s)
  fixture production >/dev/null; run production "$1" >/dev/null
  [ $rc -eq 0 ] || { echo "apply-failed"; return; }
  q "UPDATE public.email_queue_wake_state SET last_wake_at = NULL, last_read_at = NULL" >/dev/null
  psql -q -X -d "$DB" -c "BEGIN" -c "SELECT public.enqueue_email('auth_emails', '{\"message_id\":\"first\"}')" -c "SELECT pg_sleep(5)" -c "COMMIT" >/dev/null 2>&1 &
  sleep 1
  local t0=$(date +%s%N) o
  o=$(psql -X -d "$DB" -tA -c "SET lock_timeout = '3s'" -c "SELECT public.enqueue_email('auth_emails', '{\"message_id\":\"second\"}') IS NOT NULL" 2>&1)
  local t1=$(date +%s%N); wait
  echo "$(( (t1 - t0) / 1000000 )) $(echo "$o" | grep -c 'WARNING:  email_queue_wake failed') $(echo "$o" | grep -c '^t$')"
}
read ms warn ok <<< "$(lock_test "$OMIG")"
[ "${ms:-0}" -ge 2500 ] 2>/dev/null && { echo "  PASS  merged 0006 — fail first: the second enqueue WAITED ${ms} ms on the first one's lock (then the trigger timed out: warning=${warn}, enqueue kept=${ok})"; } || { echo "  FAIL  merged 0006 should make the second enqueue wait (took ${ms} ms)"; fail=1; }
run staging "$PROBE"; [ $rc -ne 0 ] && echo "$out" | grep -q 'E5 email_queue_wake makes an enqueue wait' && echo "  PASS  the fixed PROBE is RED on the merged 0006's wake (E5, no try-lock)" || { echo "  FAIL  PROBE E5 should be red here"; echo "$out" | grep -E 'ERROR|PASS' | head -2; fail=1; }
read ms warn ok <<< "$(lock_test "$MIG")"
[ "${ms:-9999}" -lt 1000 ] 2>/dev/null && [ "$warn" = 0 ] && [ "$ok" = 1 ] && echo "  PASS  fixed 0006: the second enqueue returned in ${ms} ms, no warning, enqueued" || { echo "  FAIL  fixed 0006: ${ms} ms, warning=${warn}, ok=${ok}"; fail=1; }
q "SELECT count(*) FROM net.http_request_queue" >/dev/null
want "$(q "SELECT count(*) FROM pgmq.q_auth_emails")|$(q "SELECT count(*) FROM net.http_request_queue")" "2|1" "both e-mails queued; exactly one wake (the first enqueue's)"
# the one race try-lock leaves: a skipped enqueue-wake with nothing else pending → the tick delivers it
q "UPDATE net.http_request_queue SET done = true; DELETE FROM pgmq.q_auth_emails; UPDATE public.email_queue_wake_state SET last_wake_at = NULL, last_read_at = NULL" >/dev/null
psql -q -X -d "$DB" -c "BEGIN" -c "SELECT pg_advisory_xact_lock(hashtext('p9:process-email-queue'))" -c "SELECT pg_sleep(3)" -c "COMMIT" >/dev/null 2>&1 &
sleep 1; r0=$(q "SELECT count(*) FROM net.http_request_queue")
q "SELECT public.enqueue_email('auth_emails', '{\"message_id\":\"raced\"}')" >/dev/null; wait
want "$(( $(q "SELECT count(*) FROM net.http_request_queue") - r0 ))" "0" "the race: lock held elsewhere, the enqueue's wake is skipped (not waited for)"
want "$(q "SELECT public.email_queue_tick()"):$(( $(q "SELECT count(*) FROM net.http_request_queue") - r0 ))" "woken:1" "…and the next tick wakes it (bound: 60 s)"

step "5 · PRODUCTION SHAPE: the full P9 harness on the fixed files"
o=$(PGPORT=$PGPORT WINDOW="${WINDOW:-30}" bash "$HERE/p9-email-run-tests.sh" 2>&1); r=$?
echo "$o" > "$HERE/p9-email-transcript.txt"
echo "$o" | grep -E '^══|^  (PASS|FAIL)' | sed 's/^/    /'
[ $r -eq 0 ] && echo "  PASS  p9-email-run-tests.sh: ALL CASES PASS (transcript rewritten)" || { echo "  FAIL  p9-email-run-tests.sh"; fail=1; }

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
