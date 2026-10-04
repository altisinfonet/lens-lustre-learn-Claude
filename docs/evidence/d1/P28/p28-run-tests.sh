#!/usr/bin/env bash
# P28 · C-34 harness: the build check and the live PROBE both fail first.
# SCRATCH CLUSTER ONLY.   PGPORT=5433 bash docs/evidence/d1/P28/p28-run-tests.sh
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p28ratio
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
PROBE="$ROOT/supabase/migrations/PROBE_p28_index_ratio.sql"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT; fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
probe() { out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$1" 2>&1); rc=$?; }
expect() { local want="$1" what="$2" needle="$3"; probe "$4"
  if [ "$want" = pass ]; then [ $rc -eq 0 ] && { echo "  PASS  $what"; echo "$out" | grep -o 'PROBE PASS.*' | sed 's/^/        /'; } || { echo "  FAIL  $what"; echo "$out" | grep ERROR; fail=1; }
  else [ $rc -ne 0 ] && echo "$out" | grep ERROR | grep -q "$needle" && { echo "  PASS  $what:"; echo "$out" | grep -m1 ERROR | sed 's/.*ERROR: */        /'; } || { echo "  FAIL  $what (rc=$rc)"; fail=1; }; fi; }

step "1 · build-time check: self-test, real tree, planted migration"
node "$ROOT/scripts/db-p28-index-review-check.test.mjs" | tail -1 | grep -q 'ALL CASES PASS' && echo "  PASS  self-test (14 cases)" || { echo "  FAIL  self-test"; fail=1; }
node "$ROOT/scripts/db-p28-index-review-check.mjs" "$ROOT" >/dev/null && echo "  PASS  real tree green" || { echo "  FAIL  real tree"; fail=1; }
mkdir -p "$T/tree/supabase/migrations" "$T/tree/scripts"; cp "$ROOT"/supabase/migrations/*.sql "$T/tree/supabase/migrations/"; cp "$ROOT/scripts/db-p28-index-ratio-reasons.json" "$T/tree/scripts/"
printf 'CREATE INDEX idx_posts_planted ON public.posts (created_at);\n' > "$T/tree/supabase/migrations/20261004_9999_planted.sql"
out=$(node "$ROOT/scripts/db-p28-index-review-check.mjs" "$T/tree" 2>&1); rc=$?
[ $rc -eq 1 ] && { echo "  PASS  FAIL FIRST: planted unreviewed CREATE INDEX → red"; echo "$out" | grep HIT | sed 's/^/        /'; } || { echo "  FAIL  planted index not caught"; fail=1; }
printf -- '-- P28: posts · ~1M rows at launch · created_at range scans for the archive page\nCREATE INDEX idx_posts_planted ON public.posts (created_at);\n' > "$T/tree/supabase/migrations/20261004_9999_planted.sql"
node "$ROOT/scripts/db-p28-index-review-check.mjs" "$T/tree" >/dev/null && echo "  PASS  the same index with its review line → green" || { echo "  FAIL  annotated index"; fail=1; }

step "2 · live PROBE on scratch PG17 — a 'posts' shaped like staging's (heap ≥ 1 MB, index > heap)"
dropdb --force --if-exists "$DB" >/dev/null 2>&1; createdb "$DB"
q "CREATE TABLE public.posts (id bigint PRIMARY KEY, content text, user_id int, created_at timestamptz)"
q "INSERT INTO public.posts SELECT g, md5(g::text)||' '||md5((g*7)::text), g % 500, now() - g * interval '1 min' FROM generate_series(1, 20000) g"
q "CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE INDEX ON public.posts USING gin (content gin_trgm_ops); CREATE INDEX ON public.posts (user_id); CREATE INDEX ON public.posts (user_id, created_at DESC); CREATE INDEX ON public.posts (created_at DESC); ANALYZE public.posts"
echo "        posts: heap $(q "SELECT pg_size_pretty(pg_table_size('public.posts'))"), indexes $(q "SELECT pg_size_pretty(pg_indexes_size('public.posts'))")"
q "CREATE TABLE public.tiny (id int PRIMARY KEY, a int, b int); CREATE INDEX ON public.tiny (a); CREATE INDEX ON public.tiny (b)"
sed "s/ARRAY\['public.posts'\]::text\[\]/ARRAY[]::text[]/" "$PROBE" > "$T/probe_empty.sql"
expect fail "FAIL FIRST: posts with no written reason" "more index than heap" "$T/probe_empty.sql"
expect pass "the PROBE as committed (posts reasoned; the tiny table under the 1 MB floor is not judged)" "" "$PROBE"
q "DROP INDEX public.posts_content_idx" >/dev/null 2>&1; q "DO \$\$DECLARE r record; BEGIN FOR r IN SELECT indexrelid::regclass AS i FROM pg_index WHERE indrelid='public.posts'::regclass AND NOT indisprimary LOOP EXECUTE 'DROP INDEX '||r.i; END LOOP; END\$\$"
expect fail "a reason that is no longer needed is reported (stale)" "no longer needed" "$PROBE"

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
