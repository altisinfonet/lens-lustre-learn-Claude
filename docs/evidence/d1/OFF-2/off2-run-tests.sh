#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# OFF-2 · exactly once (20261004_0008) · the C-34 harness + the R-82 synthetic
# replay test on a scratch PG17. Every apply/rollback/probe runs through the
# extracted "Run it" step of apply-migration.yml (p1-0037-runit2.sh).
# A "send" is what an outbox retry does: the same INSERT, same key, again.
# SCRATCH CLUSTER ONLY.   PGPORT=5433 bash docs/evidence/d1/OFF-2/off2-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=off2; USERS="${USERS:-1000}"; SENDS="${SENDS:-100000}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20261004_0008_off2_idempotency_keys.sql"
RB="$ROOT/supabase/rollback/20261004_0008_off2_idempotency_keys_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_off2_idempotency.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
P=00000000-0000-0000-0000-0000000000a1; U=00000000-0000-0000-0000-0000000000b1; K=4f1c2d3e-5a6b-4c7d-8e9f-a0b1c2d3e4f5
fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" 5432 2>&1); rc=$?; }
probe_is() { run staging "$PROBE"; if [ "$1" = pass ]; then [ $rc -eq 0 ] && { echo "  PASS  PROBE passes — $2"; echo "$out" | grep -o 'PROBE PASS.*' | sed 's/^/        /' | cut -c1-220; } || { echo "  FAIL  PROBE should pass — $2"; echo "$out" | grep -E 'ERROR|^  ' | head -4; fail=1; }
  else [ $rc -ne 0 ] && echo "$out" | grep -q "PROBE FAIL OFF-2" && echo "$out" | grep -q "${3:-PROBE FAIL}" && { echo "  PASS  PROBE refuses — $2:"; echo "$out" | grep -E '^  [a-z_]+: ' | sed 's/^/      /' | head -4; } || { echo "  FAIL  PROBE should refuse — $2"; echo "$out" | grep -E 'ERROR|NOTICE|^  ' | head -4; fail=1; }; fi; }
counts() { q "SELECT (SELECT count(*) FROM public.post_comments)||' comments · comments_count '||(SELECT comments_count FROM public.posts WHERE id='$P')||' · notices '||(SELECT count(*) FROM public.user_notifications)"; }
send_comment() { psql -X -d "$DB" -tAc "INSERT INTO public.post_comments (post_id, user_id, content${2:+, idempotency_key}) VALUES ('$P', '$U', 'great light'${2:+, '$2'}) RETURNING id" 2>&1; }

step "0 · fixture: the outbox action tables with staging's keys"
psql -q -X -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1
psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/off2-fixture.sql" >/dev/null || { echo "  FAIL  fixture"; exit 2; }
q "SELECT '  server '||current_setting('server_version')"

step "1 · fail first: the build check on the tree without 0008, and the live PROBE"
node "$ROOT/scripts/db-off2-idempotency-check.test.mjs" | tail -1 | grep -q 'ALL CASES PASS' && echo "  PASS  self-test" || { echo "  FAIL  self-test"; fail=1; }
T=$(mktemp -d); mkdir -p "$T/supabase/migrations" "$T/scripts"; cp "$ROOT"/supabase/migrations/*.sql "$T/supabase/migrations/"; cp "$ROOT"/scripts/db-off2-* "$ROOT"/scripts/db-p5-cron-cadence-check.mjs "$T/scripts/"
rm "$T/supabase/migrations/$(basename "$MIG")"
o=$(node "$T/scripts/db-off2-idempotency-check.mjs" "$T"); r=$?
[ $r -eq 1 ] && [ "$(echo "$o" | grep -c 'HIT  K2')" = 4 ] && { echo "  PASS  the tree WITHOUT 0008 is RED:"; echo "$o" | grep 'HIT' | sed 's/^/    /'; } || { echo "  FAIL  the tree without 0008 should be red"; echo "$o" | tail -3; fail=1; }
node "$ROOT/scripts/db-off2-idempotency-check.mjs" "$ROOT" >/dev/null && echo "  PASS  the tree WITH 0008 is green" || { echo "  FAIL  tree with 0008"; fail=1; }
rm -rf "$T"
probe_is fail "before 0008 (post_comments and reports have nothing)" "post_comments: no idempotency_key column"

step "2 · BEFORE — one comment, sent 3 times (an outbox retry after two timeouts)"
for i in 1 2 3; do send_comment >/dev/null; done
want "$(counts)" "3 comments · comments_count 3 · notices 3" "3 sends → 3 comments, the count +3, the author notified 3 times (the defect)"
q "DELETE FROM public.post_comments; DELETE FROM public.user_notifications; UPDATE public.posts SET comments_count = 0" >/dev/null

step "3 · apply 20261004_0008 (lane staging) and probe"
run staging "$MIG"; [ $rc -eq 0 ] && echo "  PASS  apply — $(echo "$out" | grep -o 'OFF2-0008: .*' | head -1)" || { echo "  FAIL  apply"; echo "$out" | grep -E 'ERROR|CONTEXT' | head -4; fail=1; }
probe_is pass "after 0008"
run staging "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'OFF2-0008-PRE-002' && echo "  PASS  a second apply is refused (PRE-002)" || { echo "  FAIL  second apply"; fail=1; }

step "4 · AFTER — the same comment, same key, sent 3 times"
first=$(send_comment x "$K"); r2=$(send_comment x "$K"); r3=$(send_comment x "$K")
echo "$r2$r3" | grep -c 'duplicate key value violates unique constraint "post_comments_user_idempotency_key"' | grep -q '^2$' && echo "  PASS  sends 2 and 3 → 23505, naming post_comments_user_idempotency_key" || { echo "  FAIL  $r2 $r3"; fail=1; }
want "$(counts)" "1 comments · comments_count 1 · notices 1" "ONE comment, the count +1, ONE notice (no AFTER trigger fired for a repeat)"
want "$(q "SELECT id FROM public.post_comments WHERE user_id='$U' AND idempotency_key='$K'")" "$(echo "$first" | head -1)" "reading back by (user_id, key) returns the original row"

step "5 · the PostgREST upsert path (on_conflict=user_id,idempotency_key, ignore-duplicates)"
K2=7e57c0de-0000-4000-8000-000000000002
a=$(q "INSERT INTO public.post_comments (post_id, user_id, content, idempotency_key) VALUES ('$P', '$U', 'second', '$K2') ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING 'new'")
b=$(q "INSERT INTO public.post_comments (post_id, user_id, content, idempotency_key) VALUES ('$P', '$U', 'second', '$K2') ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING 'new'")
want "$a|$b" "new|" "first send inserts; the repeat returns no row and no error (the full constraint is usable as on_conflict)"
want "$(counts)" "2 comments · comments_count 2 · notices 2" "…and still one comment per key"

step "6 · a race: 8 sessions send the same key at the same instant"
K3=7e57c0de-0000-4000-8000-000000000003
psql -q -X -d "$DB" -c "SELECT pg_advisory_lock(4242)" -c "SELECT pg_sleep(3)" -c "SELECT pg_advisory_unlock(4242)" >/dev/null 2>&1 &
sleep 0.5
for i in $(seq 1 8); do (psql -X -d "$DB" -tA -c "SELECT pg_advisory_lock_shared(4242)" -c "INSERT INTO public.post_comments (post_id, user_id, content, idempotency_key) VALUES ('$P', '$U', 'race', '$K3')" > "/tmp/off2race.$i" 2>&1) & done; wait
won=$(grep -l '^INSERT 0 1' /tmp/off2race.* 2>/dev/null | wc -l); lost=$(grep -l 'post_comments_user_idempotency_key' /tmp/off2race.* | wc -l); rm -f /tmp/off2race.*
want "$won/$lost/$(q "SELECT count(*) FROM public.post_comments WHERE idempotency_key='$K3'")" "1/7/1" "1 insert wins, 7 get 23505, 1 row"

step "7 · launch scale: $SENDS sends from $USERS members, every key sent 3 times, in random order"
q "TRUNCATE public.post_comments CASCADE; DELETE FROM public.user_notifications; UPDATE public.posts SET comments_count = 0" >/dev/null
t0=$(date +%s%N)
q "INSERT INTO public.post_comments (post_id, user_id, content, idempotency_key)
   SELECT '$P', ('00000000-0000-0000-0000-'||lpad(((g / 3) % $USERS)::text, 12, '0'))::uuid, 'c', md5((g / 3)::text)::uuid::text
     FROM generate_series(0, $SENDS - 1) g ORDER BY random()
   ON CONFLICT (user_id, idempotency_key) DO NOTHING" >/dev/null
t1=$(date +%s%N); keys=$(( (SENDS + 2) / 3 ))
want "$(q "SELECT count(*) FROM public.post_comments")" "$keys" "$SENDS sends → $keys comments (one per key)"
want "$(q "SELECT comments_count FROM public.posts WHERE id='$P'")|$(q "SELECT count(*) FROM public.user_notifications")" "$keys|$keys" "the count and the notices = one per key"
echo "        $(( (t1 - t0) / 1000000 )) ms for $SENDS sends, one statement, including the two AFTER triggers on the $keys accepted rows"

step "8 · the key's scope and shape"
K4=7e57c0de-0000-4000-8000-000000000004; U2=00000000-0000-0000-0000-0000000000b2
q "INSERT INTO public.post_comments (post_id, user_id, content, idempotency_key) VALUES ('$P', '$U', 'x', '$K4'), ('$P', '$U2', 'x', '$K4')" >/dev/null && echo "  PASS  the same key from two members → two comments (a key is scoped to its owner)" || { echo "  FAIL  owner scope"; fail=1; }
q "INSERT INTO public.post_comments (post_id, user_id, content) VALUES ('$P', '$U', 'legacy'), ('$P', '$U', 'legacy')" >/dev/null && echo "  PASS  no key (today's client) → unchanged behaviour" || { echo "  FAIL  null keys"; fail=1; }
o=$(q "INSERT INTO public.post_comments (post_id, user_id, content, idempotency_key) VALUES ('$P', '$U', 'x', '1')" 2>&1); echo "$o" | grep -q 'post_comments_idempotency_key_format' && echo "  PASS  a key that is not a UUID → 23514" || { echo "  FAIL  $o"; fail=1; }
o=$(psql -X -d "$DB" -tA -c "SET ROLE authenticated" -c "INSERT INTO public.post_comments (post_id, user_id, content, idempotency_key) VALUES ('$P', '$U', 'as authenticated', '7e57c0de-0000-4000-8000-000000000005')" 2>&1); echo "$o" | grep -q 'INSERT 0 1' && echo "  PASS  the API role can write the key" || { echo "  FAIL  $o"; fail=1; }

step "9 · reports: the same, keyed on reporter_id"
R=7e57c0de-0000-4000-8000-0000000000aa
for i in 1 2 3; do q "INSERT INTO public.reports (reporter_id, target_type, target_id, reason, idempotency_key) VALUES ('$U', 'post', '$P', 'spam', '$R')" >/dev/null 2>&1; done
want "$(q "SELECT count(*) FROM public.reports")" "1" "a report sent 3 times → 1 report"

step "10 · the natural keys the outbox relies on (unchanged, measured)"
for i in 1 2 3; do q "INSERT INTO public.post_reactions (post_id, user_id) VALUES ('$P', '$U')" >/dev/null 2>&1; q "INSERT INTO public.follows (follower_id, following_id) VALUES ('$U', '$U2')" >/dev/null 2>&1; done
q "INSERT INTO public.friendships (requester_id, addressee_id) VALUES ('$U', '$U2')" >/dev/null 2>&1; q "INSERT INTO public.friendships (requester_id, addressee_id) VALUES ('$U2', '$U')" >/dev/null 2>&1
want "$(q "SELECT (SELECT count(*) FROM public.post_reactions)||'/'||(SELECT count(*) FROM public.follows)||'/'||(SELECT count(*) FROM public.friendships)")" "1/1/1" "like ×3, follow ×3, a friend request both ways → 1 / 1 / 1"

step "11 · the PROBE catches each regression (mutants, each undone)"
mut() { psql -q -X -d "$DB" -c "$1" >/dev/null 2>&1; probe_is fail "$3" "$2"; psql -q -X -d "$DB" -c "$4" >/dev/null 2>&1; }
mut "ALTER TABLE public.post_comments DROP CONSTRAINT post_comments_user_idempotency_key; CREATE UNIQUE INDEX post_comments_user_idempotency_key ON public.post_comments (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL" "post_comments: no valid UNIQUE" "the full constraint replaced by a partial index (unusable as on_conflict)" "DROP INDEX public.post_comments_user_idempotency_key; ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_user_idempotency_key UNIQUE (user_id, idempotency_key)"
mut "ALTER TABLE public.reports DROP CONSTRAINT reports_reporter_idempotency_key; ALTER TABLE public.reports ADD CONSTRAINT reports_reporter_idempotency_key UNIQUE (idempotency_key, reporter_id)" "reports: no valid UNIQUE" "the key's columns in the wrong order" "ALTER TABLE public.reports DROP CONSTRAINT reports_reporter_idempotency_key; ALTER TABLE public.reports ADD CONSTRAINT reports_reporter_idempotency_key UNIQUE (reporter_id, idempotency_key)"
mut "ALTER TABLE public.follows DROP CONSTRAINT follows_follower_id_following_id_key" "follows: no valid UNIQUE" "a natural key dropped" "ALTER TABLE public.follows ADD CONSTRAINT follows_follower_id_following_id_key UNIQUE (follower_id, following_id)"
mut "DROP INDEX public.posts_user_idempotency_key" "posts: no valid UNIQUE" "posts' key index dropped" "CREATE UNIQUE INDEX posts_user_idempotency_key ON public.posts (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL"
probe_is pass "every mutant undone"

step "12 · rollback (lane guard first), the column kept, re-apply guarded"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'ROLLBACK REFUSED' && echo "  PASS  rollback with no lane — refused" || { echo "  FAIL  rollback lane guard"; fail=1; }
n0=$(q "SELECT count(*) FROM public.post_comments WHERE idempotency_key IS NOT NULL")
run production "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback (lane production)" || { echo "  FAIL  rollback"; echo "$out" | grep ERROR; fail=1; }
want "$(q "SELECT count(*) FROM pg_constraint WHERE conname LIKE '%idempotency_key%' AND conrelid IN ('public.post_comments'::regclass, 'public.reports'::regclass)")|$(q "SELECT count(*) FROM public.post_comments WHERE idempotency_key IS NOT NULL")" "0|$n0" "constraints gone; the column and its $n0 keys kept (no data dropped)"
probe_is fail "after the rollback" "post_comments: no valid UNIQUE"
q "INSERT INTO public.post_comments (post_id, user_id, content, idempotency_key) VALUES ('$P', '$U', 'dup while rolled back', '$K'), ('$P', '$U', 'dup while rolled back', '$K')" >/dev/null
run staging "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'OFF2-0008-PRE-003: 1 (user_id, idempotency_key) pair' && echo "  PASS  re-apply with a repeat that crept in → refused, naming the count (PRE-003)" || { echo "  FAIL  PRE-003"; echo "$out" | grep ERROR; fail=1; }
q "DELETE FROM public.post_comments WHERE content = 'dup while rolled back'" >/dev/null
run staging "$MIG"; [ $rc -eq 0 ] && echo "  PASS  re-apply after the rollback (column reused)" || { echo "  FAIL  re-apply"; echo "$out" | grep ERROR; fail=1; }
probe_is pass "re-applied"

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
