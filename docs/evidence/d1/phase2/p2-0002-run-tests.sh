#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P2 · 20260920_0002 — the C-34 harness (Phase 2 units 2-D1-03 / 2-D1-05, A-2).
#
# Every apply and rollback goes through docs/evidence/d1/phase1/p1-0037-runit2.sh,
# the extracted "Run it" step of apply-migration.yml (R-13).
#
# The fixture list the Auditor named, and where each is proved:
#   the 3 tables with their PKs, in a publication ...... p2-0002-fixture.sql
#   staging refuses ..................................... step 1
#   a second apply refuses .............................. step 4
#   rollback restores the pre-image ..................... step 6 (catalogue AND decoded WAL)
# plus: what a Realtime subscriber actually receives before and after — the
# WAL is decoded with wal2json run with realtime.list_changes()'s own options
# (read from staging 2026-09-26) — the primary-key precondition proved by a
# fixture that lacks one, step 7: MUTANTS (C-34), and step 8: F-P2-1, the
# reason scheduled_posts keeps FULL (R-62).
#
# SCRATCH CLUSTER ONLY (wal_level = logical, wal2json installed). Never point
# PGHOST at staging or production.
#
#   bash docs/evidence/d1/phase2/p2-0002-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p2ri
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260920_0002_p2_replica_identity_production.sql"
RB="$ROOT/supabase/rollback/20260920_0002_p2_replica_identity_production_ROLLBACK.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
build() {
  psql -q -X -d postgres -tAc "SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name='p2slot'" >/dev/null 2>&1
  dropdb --force --if-exists "$DB" >/dev/null 2>&1; createdb "$DB" || return 1
  psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p2-0002-fixture.sql" >/dev/null 2>&1 || return 1
  q "SELECT 1 FROM pg_create_logical_replication_slot('p2slot', 'wal2json')" >/dev/null
}
run() { out=$(TARGET_LANE="$1" bash "$RUNIT" "$DB" "$2" "${3:-5432}" 2>&1); rc=$?; }
expect_fail() { local what="$1" needle="$2"; run "$3" "$4" "${5:-5432}"
  if [ "$rc" -eq 0 ]; then echo "  FAIL  $what — ACCEPTED (exit 0). It must refuse."; fail=1
  elif ! printf '%s' "$out" | grep -q "$needle"; then
    echo "  FAIL  $what — refused, but not with '$needle':"; printf '%s\n' "$out" | sed 's/^/        /' | head -6; fail=1
  else echo "  PASS  $what — refused (exit $rc), '$needle'"; fi; }
expect_ok() { local what="$1"; run "$2" "$3" "${4:-5432}"
  if [ "$rc" -ne 0 ]; then echo "  FAIL  $what — exit $rc:"; printf '%s\n' "$out" | sed 's/^/        /' | tail -12; fail=1
  else echo "  PASS  $what"; fi; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }

# Drain the slot with realtime.list_changes()'s exact wal2json options and
# report, per change: action, table, the identity (old-row) column names, and
# whether a DELETE would pass the subscriber's filter — every filter column
# present in the old-row image with the filtered value (what
# realtime.is_visible_through_filters() requires; measured on staging, see
# replica-identity.md).
decode() {
  q "WITH c AS (
       SELECT data::jsonb AS w FROM pg_logical_slot_get_changes('p2slot', NULL, NULL,
         'include-pk','true','include-transaction','false','include-timestamp','true',
         'include-type-oids','true','format-version','2','actions','insert,update,delete',
         'add-tables','public.scheduled_posts,public.competition_round_publish,public.profiles'))
     SELECT '      ' || (w->>'action') || ' ' || (w->>'table') || '  old-row image: ' ||
            coalesce((SELECT string_agg(x->>'name', ',' ORDER BY x->>'name') FROM jsonb_array_elements(w->'identity') x), '(none)') ||
            CASE WHEN w->>'action' = 'D' THEN '  -> DELETE delivered to the filtered subscriber: ' ||
              CASE w->>'table'
                WHEN 'scheduled_posts' THEN (EXISTS (SELECT 1 FROM jsonb_array_elements(w->'identity') x
                     WHERE x->>'name' = 'user_id' AND x->>'value' = 'aaaaaaaa-0000-0000-0000-000000000001'))::text || ' (filter user_id=eq.<member>)'
                WHEN 'competition_round_publish' THEN (EXISTS (SELECT 1 FROM jsonb_array_elements(w->'identity') x
                     WHERE x->>'name' = 'competition_id' AND x->>'value' = 'c0000000-0000-0000-0000-000000000001'))::text || ' (filter competition_id=eq.<c>)'
                WHEN 'profiles' THEN (EXISTS (SELECT 1 FROM jsonb_array_elements(w->'identity') x
                     WHERE x->>'name' = 'id'))::text || ' (filter id=eq.<member>)'
              END ELSE '' END
       FROM c WHERE w->>'action' IN ('U','D') ORDER BY 1"
}
dml() { # one UPDATE and one DELETE on scheduled_posts and competition_round_publish, one UPDATE on profiles
  q "UPDATE public.scheduled_posts SET status='publishing' WHERE id='5c000000-0000-0000-0000-00000000000$1';
     DELETE FROM public.scheduled_posts WHERE id='5c000000-0000-0000-0000-00000000000$1';
     UPDATE public.competition_round_publish SET published_at = now() WHERE round_number=$1;
     DELETE FROM public.competition_round_publish WHERE round_number=$1;
     UPDATE public.profiles SET is_suspended = NOT is_suspended;" >/dev/null
}

step "0 · scratch cluster and fixture"
psql -q -X -d postgres -tAc "SELECT '  server_version '||current_setting('server_version')||' · wal_level='||current_setting('wal_level')"
if build; then echo "  PASS  fixture built, logical slot p2slot (wal2json) created"; else echo "  FAIL  fixture did not build"; exit 2; fi
RI0=$(q "SELECT public.fx_ri()")
echo "  published tables: $RI0"

step "1 · 0002 REFUSES outside production — staging above all"
expect_fail "no lane asserted"           "Unknown target"  ""        "$MIG"
expect_fail "a lane of 'local'"          "Unknown target"  "local"   "$MIG"
expect_fail "STAGING lane (by design)"   "APPLY REFUSED — p32.lane is not asserted as production" staging "$MIG"
expect_fail "transaction pooler, 6543"   "6543"            production "$MIG" 6543
want "$(q "SELECT public.fx_ri()")" "$RI0" "four refusals left every published table's replica identity unchanged"

step "2 · BEFORE — what Realtime is handed today (FULL)"
dml 1; decode

step "3 · 0002 applies on the production lane"
expect_ok "apply, TARGET_LANE=production" production "$MIG"
printf '%s\n' "$out" | grep -o 'P2-0002: .*' | sed 's/^/  NOTICE  /'
want "$(q "SELECT public.fx_ri()")" \
     "competition_round_publish=d posts=d profiles=f scheduled_posts=f" \
     "competition_round_publish DEFAULT; profiles and scheduled_posts still FULL; the 'd' table untouched"

step "3b · AFTER — what Realtime is handed now (DEFAULT on competition_round_publish only)"
dml 2; decode
echo "  (UPDATE and INSERT events carry the full NEW row either way; the filter is evaluated on it, so they are unaffected.)"

step "4 · a second apply is refused (PRE-002), and changes nothing"
expect_fail "second apply" "P2-0002-PRE-002" production "$MIG"
want "$(q "SELECT public.fx_ri()")" "competition_round_publish=d posts=d profiles=f scheduled_posts=f" "unchanged"

step "5 · the preconditions that make DEFAULT safe, each seen refusing"
build >/dev/null
q "ALTER TABLE public.competition_round_publish DROP CONSTRAINT competition_round_publish_pkey" >/dev/null
expect_fail "competition_round_publish has NO primary key" "P2-0002-PRE-003" production "$MIG"
want "$(q "SELECT relreplident FROM pg_class WHERE oid='public.competition_round_publish'::regclass")" "f" "…and it is still FULL (untouched)"
build >/dev/null
q "ALTER TABLE public.posts REPLICA IDENTITY FULL" >/dev/null
expect_fail "production drifted: a fourth published FULL table" "P2-0002-PRE-005" production "$MIG"
build >/dev/null
q "ALTER PUBLICATION supabase_realtime DROP TABLE public.competition_round_publish" >/dev/null
expect_fail "a target not in the publication" "P2-0002-PRE-004" production "$MIG"

step "6 · the ROLLBACK — production only; restores the pre-image"
build >/dev/null; RI0=$(q "SELECT public.fx_ri()")
expect_ok "apply (to have something to roll back)" production "$MIG"
expect_fail "rollback, lane = staging" "ROLLBACK REFUSED" staging "$RB"
o=$(psql -q -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); r=$?
if [ "$r" -ne 0 ] && printf '%s' "$o" | grep -q "ROLLBACK REFUSED"; then echo "  PASS  rollback, p32.lane unset (file run directly) — refused (exit $r)"
else echo "  FAIL  rollback with p32.lane unset was not refused (exit $r)"; fail=1; fi
want "$(q "SELECT public.fx_ri()")" "competition_round_publish=d posts=d profiles=f scheduled_posts=f" "both refusals changed nothing"
expect_ok "rollback, lane = production" production "$RB"
want "$(q "SELECT public.fx_ri()")" "$RI0" "PRE-IMAGE RESTORED: every published table's replica identity byte-identical to before the apply"
q "SELECT pg_logical_slot_get_changes('p2slot', NULL, NULL, 'format-version','2')" >/dev/null   # drain
dml 3; echo "  after the rollback, Realtime is handed:"; decode
expect_fail "rollback run a second time" "P2-0002-RB-PRE-002" production "$RB"

step "7 · C-34 MUTANTS — one control removed; each must go RED"
mutant() { python3 - "$MIG" "$T/m.sql" "$1" "$2" <<'PY'
import sys
src, dst, old, new = sys.argv[1:5]
s = open(src).read()
assert s.count(old) == 1, f"anchor count {s.count(old)}"
open(dst, "w").write(s.replace(old, new))
PY
}
# M1 — lane guard widened to staging: the staging dispatch is then ACCEPTED.
build >/dev/null
if mutant "  IF coalesce(current_setting('p32.lane', true), '') <> 'production' THEN" \
          "  IF coalesce(current_setting('p32.lane', true), '') NOT IN ('staging','production') THEN"; then
  run staging "$T/m.sql"
  [ "$rc" -eq 0 ] && echo "  PASS  RED as required — with the guard widened, a STAGING dispatch is accepted (exit 0)" \
    || { echo "  FAIL  mutant M1 not caught (rc=$rc)"; fail=1; }
fi
# M2 — the primary-key check removed, on a table with no PK: the file applies,
# and then every DELETE on that published table FAILS. This is the outage
# PRE-003 prevents.
build >/dev/null
q "ALTER TABLE public.competition_round_publish DROP CONSTRAINT competition_round_publish_pkey" >/dev/null
if mutant "  IF pk IS DISTINCT FROM 'competition_id,round_number' THEN" "  IF false THEN"; then
  run production "$T/m.sql"
  o=$(q "DELETE FROM public.competition_round_publish WHERE round_number=1" 2>&1)
  if [ "$rc" -eq 0 ] && printf '%s' "$o" | grep -q "does not have a replica identity"; then
    echo "  PASS  RED as required — without PRE-003 the file applies, and then: $(printf '%s' "$o" | head -1 | sed 's/^ERROR: *//')"
  else echo "  FAIL  mutant M2 not caught (rc=$rc, delete said: $o)"; fail=1; fi
fi
# M3 — the body also flips profiles: POST-002 refuses (R-61/R-62 keep profiles FULL).
build >/dev/null
if mutant "ALTER TABLE public.competition_round_publish REPLICA IDENTITY DEFAULT;" \
          "ALTER TABLE public.competition_round_publish REPLICA IDENTITY DEFAULT;
ALTER TABLE public.profiles REPLICA IDENTITY DEFAULT;"; then
  run production "$T/m.sql"
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "P2-0002-POST-002"; then
    echo "  PASS  RED as required — flipping profiles too is refused by POST-002"
    want "$(q "SELECT public.fx_ri()")" "competition_round_publish=f posts=d profiles=f scheduled_posts=f" "  … and the refused apply changed nothing (transaction rolled back)"
  else echo "  FAIL  mutant M3 not caught (rc=$rc)"; fail=1; fi
fi
# M4 — R-61's first cut back in: the body also flips scheduled_posts (F-P2-1).
# POST-002 refuses — R-62 keeps scheduled_posts FULL.
build >/dev/null
if mutant "ALTER TABLE public.competition_round_publish REPLICA IDENTITY DEFAULT;" \
          "ALTER TABLE public.competition_round_publish REPLICA IDENTITY DEFAULT;
ALTER TABLE public.scheduled_posts REPLICA IDENTITY DEFAULT;"; then
  run production "$T/m.sql"
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "P2-0002-POST-002"; then
    echo "  PASS  RED as required — flipping scheduled_posts too (F-P2-1) is refused by POST-002"
    want "$(q "SELECT public.fx_ri()")" "competition_round_publish=f posts=d profiles=f scheduled_posts=f" "  … and the refused apply changed nothing (transaction rolled back)"
  else echo "  FAIL  mutant M4 not caught (rc=$rc)"; fail=1; fi
fi

step "8 · F-P2-1 — why scheduled_posts is NOT in 0002 (R-62), shown on the same decode"
# Not the migration: the fixture's scheduled_posts set to DEFAULT directly, to
# show what R-61's first cut would have handed Realtime. R-62 keeps it FULL.
build >/dev/null
q "ALTER TABLE public.scheduled_posts REPLICA IDENTITY DEFAULT" >/dev/null
q "SELECT pg_logical_slot_get_changes('p2slot', NULL, NULL, 'format-version','2')" >/dev/null
q "DELETE FROM public.scheduled_posts WHERE id='5c000000-0000-0000-0000-000000000001'" >/dev/null
line=$(decode | grep "D scheduled_posts")
echo "$line"
if printf '%s' "$line" | grep -q "old-row image: id  -> DELETE delivered to the filtered subscriber: false"; then
  echo "  PASS  under DEFAULT the old-row image is id alone and the user_id-filtered DELETE is NOT delivered (F-P2-1)"
else echo "  FAIL  F-P2-1 not reproduced: $line"; fail=1; fi

build >/dev/null; psql -q -X -d postgres -tAc "SELECT pg_drop_replication_slot('p2slot')" >/dev/null 2>&1

step "VERDICT"
if [ "$fail" -eq 0 ]; then echo "  ALL GREEN"; else echo "  FAILURES ABOVE"; fi
exit "$fail"
