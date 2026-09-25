#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# P33 · 20260910_0044 — the harness.
#
# Every apply and rollback goes through p1-0037-runit2.sh, the extracted
# "Run it" step of apply-migration.yml (R-13), already on staging with #299:
# one psql session, -c "SET p32.lane = '<lane>';" then -f.
#
# WHO RUNS WHAT, and why it matters here more than in any earlier unit:
#   PGUSER=supabase_admin     a superuser. Stands in for supautils' delegation,
#                             which on the platform runs privileged-extension
#                             DDL as supabase_admin on postgres's behalf.
#   PGUSER=postgres_nonsuper  a non-superuser, not a member of supabase_admin:
#                             the platform's `postgres` WITHOUT supautils.
# The delegation itself is not reproduced — there is no supautils here — and
# the harness says so rather than letting a superuser run pass for it.
#
# SCRATCH CLUSTER ONLY. Never point PGHOST at staging or production.
#
#   bash docs/evidence/d1/phase1/p33-0044-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}"
DB=p44
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20260910_0044_p33_plpgsql_check_out_of_public.sql"
RB="$ROOT/supabase/rollback/20260910_0044_p33_plpgsql_check_out_of_public_ROLLBACK.sql"
RUNIT="$HERE/p1-0037-runit2.sh"
LOOSEN="$HERE/p33-0044-loosen.py"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail=0
step() { printf '\n══ %s\n' "$*"; }
q()   { PGUSER=postgres psql -q -d "$DB" -tA -c "$1"; }

# The staging reading, 2026-09-25: the ACL every plpgsql_check 2.8 function has
# in `extensions`. Compared as a SET of aclitems (see step 4).
STAGING_ACL='{=X/supabase_admin,supabase_admin=X/supabase_admin,postgres=X*/supabase_admin}'

digest() { q "SELECT md5(coalesce(string_agg(x, E'\n' ORDER BY x), '(none)')) FROM (
    SELECT 'ext ' || e.extname || ' ' || e.extversion || ' ' || e.extnamespace::regnamespace::text
           || ' ' || pg_get_userbyid(e.extowner) AS x
      FROM pg_extension e WHERE e.extname = 'plpgsql_check'
    UNION ALL
    SELECT 'fn ' || p.oid::regprocedure::text || ' ' || coalesce(p.proacl::text, 'NULL')
      FROM pg_depend d JOIN pg_proc p ON p.oid = d.objid
     WHERE d.classid='pg_proc'::regclass AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
       AND d.refobjid = (SELECT oid FROM pg_extension WHERE extname='plpgsql_check')) t"; }
# Counted by EXTENSION MEMBERSHIP and by the member NAMES captured before the
# move -- not by a name pattern. The first draft counted `proname LIKE
# 'plpgsql%'`, which silently misses __plpgsql_show_dependency_tb: 23 of 25.
members_in() { q "SELECT count(*) FROM pg_depend d JOIN pg_proc p ON p.oid = d.objid
    WHERE d.classid='pg_proc'::regclass AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
      AND d.refobjid = (SELECT oid FROM pg_extension WHERE extname='plpgsql_check')
      AND p.pronamespace = '$1'::regnamespace"; }
names_in_public() { q "SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname = ANY ('$1'::text[])"; }
member_names() { q "SELECT '{' || string_agg(DISTINCT p.proname, ',') || '}' FROM pg_depend d JOIN pg_proc p ON p.oid = d.objid
    WHERE d.classid='pg_proc'::regclass AND d.refclassid='pg_extension'::regclass AND d.deptype='e'
      AND d.refobjid = (SELECT oid FROM pg_extension WHERE extname='plpgsql_check')"; }
where() { q "SELECT extversion || ' in ' || extnamespace::regnamespace || ', owner ' || pg_get_userbyid(extowner)
             FROM pg_extension WHERE extname='plpgsql_check'"; }
build() { PGUSER=postgres dropdb --if-exists "$DB" >/dev/null 2>&1; PGUSER=postgres createdb "$DB" || return 1
          PGUSER=postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/p33-0044-fixture.sql" >/dev/null 2>&1; }

run() { out=$(PGUSER="$1" TARGET_LANE="$2" bash "$RUNIT" "$DB" "$3" "${4:-5432}" 2>&1); rc=$?; }
expect_fail() { local what="$1" needle="$2"; run "$3" "$4" "$5" "${6:-5432}"
  if [ "$rc" -eq 0 ]; then echo "  FAIL  $what — ACCEPTED (exit 0). It must refuse."; fail=1
  elif ! printf '%s' "$out" | grep -q -- "$needle"; then
    echo "  FAIL  $what — refused, but not with '$needle':"; printf '%s\n' "$out" | grep -m3 ERROR | sed 's/^/        /'; fail=1
  else echo "  PASS  $what — refused (exit $rc), '$needle'"; fi; }
expect_ok() { local what="$1"; run "$2" "$3" "$4" "${5:-5432}"
  if [ "$rc" -ne 0 ]; then echo "  FAIL  $what — exit $rc:"; printf '%s\n' "$out" | grep -m5 ERROR | sed 's/^/        /'; fail=1
  else echo "  PASS  $what"; fi; }
ck()   { [ ${#1} -eq 32 ] && [ ${#2} -eq 32 ] && return 0
         echo "  FAIL  $3 — a digest was empty or malformed; the comparison proves nothing"; fail=1; return 1; }
same() { ck "$1" "$2" "$3" || return; [ "$1" = "$2" ] && echo "  PASS  $3" || { echo "  FAIL  $3 (digests differ)"; fail=1; }; }
diff_(){ ck "$1" "$2" "$3" || return; [ "$1" != "$2" ] && echo "  PASS  $3" || { echo "  FAIL  $3 (digest did not change)"; fail=1; }; }
want() { if [ "$1" = "$2" ]; then echo "  PASS  $3"; else echo "  FAIL  $3"; echo "        want: $2"; echo "        got : $1"; fail=1; fi; }

step "0 · the fixture: plpgsql_check in public, owned by supabase_admin"
PGUSER=postgres psql -q -d postgres -tAc "SELECT '  server_version '||current_setting('server_version')"
if build; then echo "  PASS  fixture built"; else echo "  FAIL  fixture did not build"; exit 2; fi
echo "  $(where)"
NAMES=$(member_names)
echo "  member functions in public: $(members_in public), anon-executable: $(q "SELECT count(*) FROM pg_depend d JOIN pg_proc p ON p.oid=d.objid WHERE d.classid='pg_proc'::regclass AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND d.refobjid=(SELECT oid FROM pg_extension WHERE extname='plpgsql_check') AND has_function_privilege('anon', p.oid, 'EXECUTE')")"
echo "  member names ($(q "SELECT cardinality('$NAMES'::text[])") distinct): $NAMES"
echo "  their ACL: $(q "SELECT string_agg(DISTINCT proacl::text, ' | ') FROM pg_proc WHERE proname = ANY ('$NAMES'::text[])")"
PRE=$(digest); echo "  pre digest: $PRE"

step "1 · WHY DROP + CREATE: the one-statement move does not exist"
o=$(PGUSER=supabase_admin psql -q -d "$DB" -c "ALTER EXTENSION plpgsql_check SET SCHEMA extensions" 2>&1)
if printf '%s' "$o" | grep -q 'does not support SET SCHEMA'; then
  echo "  PASS  ALTER EXTENSION plpgsql_check SET SCHEMA extensions →"
  printf '%s\n' "$o" | sed 's/^/        /'
else echo "  FAIL  expected 'does not support SET SCHEMA', got: $o"; fail=1; fi
same "$PRE" "$(digest)" "and nothing changed"

step "2 · 0044 REFUSES off the production lane and off the session pooler"
expect_fail "TARGET_LANE=staging"       "APPLY REFUSED"  supabase_admin staging    "$MIG"
expect_fail "TARGET_LANE='' (unset)"    "Unknown target" supabase_admin ""         "$MIG"
expect_fail "transaction pooler, 6543"  "6543"           supabase_admin production "$MIG" 6543
same "$PRE" "$(digest)" "three refusals left the extension exactly as it was"

step "3 · WITHOUT delegation, the file refuses before it touches anything"
# the platform's `postgres` is not a superuser and not a member of
# supabase_admin; only supautils lets it drop and create this extension. Here
# there is no supautils.
expect_fail "as a non-superuser, no supautils" "P33-0044-PRE-004" postgres_nonsuper production "$MIG"
same "$PRE" "$(digest)" "the extension is still in public, byte for byte"

step "4 · 0044 APPLIES (as supabase_admin, standing in for supautils)"
expect_ok "apply, TARGET_LANE=production" supabase_admin production "$MIG"
POST=$(digest); diff_ "$PRE" "$POST" "the apply changed the extension"
echo "  $(where)"
want "$(q "SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname='plpgsql_check'")" "extensions" "extnamespace = extensions"
want "$(members_in public)" "0" "0 plpgsql_check member functions in public"
want "$(names_in_public "$NAMES")" "0" "0 functions in public carrying any of the pre-move member names"
want "$(members_in extensions)" "$(q "SELECT count(*) FROM pg_proc WHERE pronamespace='extensions'::regnamespace AND proname = ANY ('$NAMES'::text[])")" "every member is in extensions"
want "$(q "SELECT pg_get_userbyid(extowner) FROM pg_extension WHERE extname='plpgsql_check'")" "supabase_admin" "still owned by supabase_admin"
# the ACL each function is born with in extensions, against staging's measured
# string as a SET: aclitem order records grant history, and staging's copy was
# installed under a different one, so byte order is not the claim.
q "WITH got AS (SELECT DISTINCT proacl FROM pg_proc WHERE pronamespace='extensions'::regnamespace AND proname = ANY ('$NAMES'::text[]))
   SELECT CASE WHEN (SELECT count(*) FROM got) = 1
               AND (SELECT array_agg(x ORDER BY x) FROM got, unnest(got.proacl::text[]) x)
                 = (SELECT array_agg(x ORDER BY x) FROM unnest('$STAGING_ACL'::text[]) x)
          THEN '  PASS  every moved function has staging''s ACL (set-equal): ' || (SELECT proacl::text FROM got)
          ELSE '  FAIL  ACL differs from staging''s: ' || coalesce((SELECT string_agg(proacl::text, ' | ') FROM got), '(none)') END"
q "SELECT '  note  anon can still EXECUTE them (' || count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')) || '/' || count(*)
          || ') — as on staging. The change is WHERE they live: extensions is not an API schema.'
     FROM pg_proc p WHERE pronamespace='extensions'::regnamespace AND proname = ANY ('$NAMES'::text[])"

step "5 · a second dispatch refuses, with nothing changed"
expect_fail "apply again" "P33-0044-PRE-002" supabase_admin production "$MIG"
same "$POST" "$(digest)" "the refused second apply left everything as it was"

step "6 · the ROLLBACK"
expect_fail "rollback, TARGET_LANE=staging (it would MOVE staging's copy into public)" "ROLLBACK REFUSED" supabase_admin staging "$RB"
expect_fail "rollback as a non-superuser, no supautils" "P33-0044-RB-PRE-003" postgres_nonsuper production "$RB"
expect_ok   "rollback, TARGET_LANE=production" supabase_admin production "$RB"
echo "  $(where)"
same "$PRE" "$(digest)" "the round trip is BYTE-EXACT: extension row and every function's ACL as before"
expect_fail "rollback a second time" "P33-0044-RB-PRE-002" supabase_admin production "$RB"

step "7 · apply → rollback → apply reproduces the post-apply state"
expect_ok "apply again" supabase_admin production "$MIG"
same "$POST" "$(digest)" "the post-apply digest is reproduced exactly"

step "8 · C-34 — each guard, and what happens without it"
echo "  8a · a VIEW depends on a plpgsql_check function"
DEPVIEW="CREATE VIEW public._pc_dependent AS SELECT * FROM public.plpgsql_profiler_functions_all()"
build; q "$DEPVIEW" >/dev/null
expect_fail "the real file" "P33-0044-PRE-005" supabase_admin production "$MIG"
want "$(q "SELECT count(*) FROM pg_class WHERE relname='_pc_dependent'")" "1" "  and the view is still there"
python3 "$LOOSEN" no-deps-check "$T/nodeps.sql" >/dev/null
expect_fail "without precondition 4 — RESTRICT is the second line" "other objects depend on it" supabase_admin production "$T/nodeps.sql"
want "$(q "SELECT count(*) FROM pg_class WHERE relname='_pc_dependent'")" "1" "  and the view is still there"
python3 "$LOOSEN" cascade "$T/cascade.sql" >/dev/null
run supabase_admin production "$T/cascade.sql"
if [ "$rc" -eq 0 ] && [ "$(q "SELECT count(*) FROM pg_class WHERE relname='_pc_dependent'")" = "0" ]; then
  echo "  PASS  without precondition 4 AND with CASCADE: the move 'succeeds' and the view is GONE"
  echo "        — which is exactly what both guards exist to prevent"
else echo "  FAIL  the CASCADE control did not show the loss (rc=$rc)"; fail=1; fi

echo "  8b · a function body calls a plpgsql_check function by its public name"
CALLER="CREATE FUNCTION public._calls_pc() RETURNS void LANGUAGE plpgsql SET search_path = '' AS \$f\$ BEGIN PERFORM public.plpgsql_profiler_reset_all(); END \$f\$"
build; q "$CALLER" >/dev/null
q "SELECT public._calls_pc()" >/dev/null 2>&1 && echo "  PASS  before the move, public._calls_pc() works" || { echo "  FAIL  _calls_pc() does not work even before the move"; fail=1; }
expect_fail "the real file" "P33-0044-PRE-006" supabase_admin production "$MIG"
python3 "$LOOSEN" no-body-check "$T/nobody.sql" >/dev/null
expect_ok "without precondition 5, the move goes through" supabase_admin production "$T/nobody.sql"
o=$(q "SELECT public._calls_pc()" 2>&1)
if printf '%s' "$o" | grep -q 'does not exist'; then
  echo "  PASS  …and public._calls_pc() is now BROKEN, silently, until someone calls it:"
  printf '%s\n' "$o" | grep -m1 ERROR | sed 's/^/        /'
else echo "  FAIL  expected the caller to break, got: $o"; fail=1; fi

echo "  8c · a cron job mentions plpgsql_check (stand-in cron.job table — no pg_cron here)"
build; q "CREATE SCHEMA cron; CREATE TABLE cron.job (jobid serial, command text); INSERT INTO cron.job(command) VALUES ('SELECT public.plpgsql_profiler_reset_all()')" >/dev/null
expect_fail "the real file" "P33-0044-PRE-007" supabase_admin production "$MIG"

echo "  8d · production runs a DIFFERENT version from the image's default"
SHARE=$(pg_config --sharedir 2>/dev/null || echo /usr/share/postgresql/17)/extension
DEF=$(q "SELECT default_version FROM pg_available_extensions WHERE name='plpgsql_check'")
SYN="$SHARE/plpgsql_check--0.0synthetic.sql"
if [ -w "$SHARE" ] && [ -f "$SHARE/plpgsql_check--$DEF.sql" ]; then
  [ -f "$SYN" ] || cp "$SHARE/plpgsql_check--$DEF.sql" "$SYN"
  echo "  (fixture scaffolding outside the repo: $SYN is a byte copy of the $DEF install script under"
  echo "   another version label, so a second version exists to be 'production's'. It is removed below.)"
  PGUSER=postgres dropdb --if-exists "$DB" >/dev/null 2>&1; PGUSER=postgres createdb "$DB"
  sed "s|CREATE EXTENSION plpgsql_check WITH SCHEMA public;|CREATE EXTENSION plpgsql_check WITH SCHEMA public VERSION '0.0synthetic';|" \
      "$HERE/p33-0044-fixture.sql" > "$T/fx-old.sql"
  PGUSER=postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$T/fx-old.sql" >/dev/null 2>&1
  echo "  installed: $(where)   (image default: $DEF)"
  expect_fail "the real file" "P33-0044-POST-003" supabase_admin production "$MIG"
  echo "  $(where)   — unchanged, nothing upgraded"
  python3 "$LOOSEN" no-version-check "$T/nover.sql" >/dev/null
  expect_ok "without postcondition 2, the move goes through" supabase_admin production "$T/nover.sql"
  v=$(q "SELECT extversion FROM pg_extension WHERE extname='plpgsql_check'")
  if [ "$v" = "$DEF" ]; then echo "  PASS  …and the extension was silently UPGRADED 0.0synthetic → $v as a side effect of a move"
  else echo "  FAIL  expected a silent upgrade to $DEF, got $v"; fail=1; fi
  PGUSER=postgres dropdb "$DB" >/dev/null 2>&1; rm -f "$SYN"
  [ -f "$SYN" ] && { echo "  FAIL  could not remove $SYN"; fail=1; } || echo "  (synthetic version file removed)"
else
  echo "  SKIP  cannot create a second version here ($SHARE not writable) — not counted as a pass"
fi

step "9 · THE PROBE AGREES WITH THE FILE — seven scenarios"
# PROBE_p33_0044_plpgsql_check_readonly.sql is what the Owner runs on
# production before dispatch. It is only worth running if its verdict predicts
# what 0044 will actually do, so each scenario is probed first and then
# dispatched, and the two answers must match. A probe that says CLEAR while
# the file refuses — or the reverse — fails this step.
PROBE="$ROOT/supabase/migrations/PROBE_p33_0044_plpgsql_check_readonly.sql"
# The probe is run AS A FILE (-f), exactly as the Owner would run it. The
# first version of this step collapsed it onto one line to pass it with -c,
# which turned everything after its first `--` comment into a comment; the
# probe returned nothing and every scenario read "probe=?". The file's answers
# were right all along -- the instrument was not reading the probe.
code_of_verdict() { printf '%s' "$1" | grep -o 'PRE-00[0-9]\|POST-003' | head -1 || true; }
scenario() {  # scenario <label> <pguser> <expected> <setup-sql or ''>
  local label="$1" who="$2" want_="$3" setup="$4" v vc mc
  build
  [ -n "$setup" ] && q "$setup" >/dev/null 2>&1
  v=$(PGUSER="$who" psql -q -d "$DB" -tA -F "$(printf '\t')" -f "$PROBE" 2>&1 | awk -F'\t' 'NF>1{print $NF}')
  case "$v" in CLEAR*) vc=OK ;; *) vc=$(code_of_verdict "$v") ;; esac
  run "$who" production "$MIG"
  if [ "$rc" -eq 0 ]; then mc=OK; else mc=$(printf '%s' "$out" | grep -o 'P33-0044-\(PRE\|POST\)-00[0-9]' | head -1 | sed 's/P33-0044-//'); fi
  if [ "$vc" = "$want_" ] && [ "$mc" = "$want_" ]; then
    printf '  PASS  %-44s probe=%-8s file=%-8s\n' "$label" "$vc" "$mc"
  else
    printf '  FAIL  %-44s probe=%-8s file=%-8s want=%s\n' "$label" "${vc:-?}" "${mc:-?}" "$want_"
    printf '        verdict: %s\n' "$v"; fail=1
  fi
}
scenario "clean, delegated"                     supabase_admin    OK      ""
scenario "no privilege path"                    postgres_nonsuper PRE-004 ""
scenario "a view depends on a member"           supabase_admin    PRE-005 "$DEPVIEW"
scenario "a function body calls a member"       supabase_admin    PRE-006 "$CALLER"
scenario "a cron job calls a member (stand-in)" supabase_admin    PRE-007 "CREATE SCHEMA cron; CREATE TABLE cron.job (jobid serial, command text); INSERT INTO cron.job(command) VALUES ('SELECT public.plpgsql_profiler_reset_all()')"
# already moved: build, move, then probe + dispatch again
build; run supabase_admin production "$MIG" >/dev/null
v=$(PGUSER=supabase_admin psql -q -d "$DB" -tA -F "$(printf '\t')" -f "$PROBE" 2>&1 | awk -F'\t' 'NF>1{print $NF}')
vc=$(code_of_verdict "$v"); run supabase_admin production "$MIG"
mc=$(printf '%s' "$out" | grep -o 'P33-0044-PRE-00[0-9]' | head -1 | sed 's/P33-0044-//')
if [ "$vc" = "PRE-002" ] && [ "$mc" = "PRE-002" ]; then printf '  PASS  %-44s probe=%-8s file=%-8s\n' "already moved (the post-dispatch check)" "$vc" "$mc"
else printf '  FAIL  %-44s probe=%-8s file=%-8s\n' "already moved" "${vc:-?}" "${mc:-?}"; fail=1; fi
# version drift, if a second version can be staged
if [ -w "$SHARE" ] && [ -f "$SHARE/plpgsql_check--$DEF.sql" ]; then
  cp "$SHARE/plpgsql_check--$DEF.sql" "$SYN"
  PGUSER=postgres dropdb --if-exists "$DB" >/dev/null 2>&1; PGUSER=postgres createdb "$DB"
  PGUSER=postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$T/fx-old.sql" >/dev/null 2>&1
  v=$(PGUSER=supabase_admin psql -q -d "$DB" -tA -F "$(printf '\t')" -f "$PROBE" 2>&1 | awk -F'\t' 'NF>1{print $NF}')
  vc=$(code_of_verdict "$v"); run supabase_admin production "$MIG"
  mc=$(printf '%s' "$out" | grep -o 'P33-0044-POST-003' | head -1 | sed 's/P33-0044-//')
  if [ "$vc" = "POST-003" ] && [ "$mc" = "POST-003" ]; then printf '  PASS  %-44s probe=%-8s file=%-8s\n' "version drift" "$vc" "$mc"
  else printf '  FAIL  %-44s probe=%-8s file=%-8s\n' "version drift" "${vc:-?}" "${mc:-?}"; fail=1; fi
  PGUSER=postgres dropdb "$DB" >/dev/null 2>&1; rm -f "$SYN"
else
  echo "  SKIP  version drift — no second version can be staged here; not counted as a pass"
fi

step "VERDICT"
if [ "$fail" -eq 0 ]; then echo "  ALL GREEN"; else echo "  FAILURES ABOVE"; fi
exit "$fail"
