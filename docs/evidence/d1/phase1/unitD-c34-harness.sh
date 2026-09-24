#!/usr/bin/env bash
# ===========================================================================
# D1 · UNIT D · C-34 HARNESS — SCRATCH PostgreSQL 17 ONLY.
#
# No staging connection. No production connection. No GitHub Actions dispatch.
# Everything below runs against a throwaway cluster created by this script's
# caller on a local socket. The two files under test are executed UNMODIFIED
# from the working tree; p32.lane is supplied from OUTSIDE the file, via
# PGOPTIONS, never by an edit to the file and never by a stand-in statement.
#
# [A-2] MAINTAIN requires PostgreSQL >= 17. The version is printed first and
#       asserted, because a PG 16 run is not evidence — it is a parse error
#       wearing the costume of one.
# [A-3] The UNMODIFIED 0033 file runs against stubs of all ELEVEN names.
#
# The cluster this was run against was created like this, and thrown away
# afterwards -- it holds no project data and is reachable only over a local
# unix socket:
#
#   apt-get install -y postgresql-17          # PGDG, Ubuntu 24.04 noble-pgdg
#   initdb -D /tmp/ud/pg17/data -U postgres
#   pg_ctl -D /tmp/ud/pg17/data \
#          -o '-p 5433 -k /tmp/ud/pg17 -c listen_addresses=' start
#
# Then, from the repository root:   bash docs/evidence/d1/phase1/unitD-c34-harness.sh
# ===========================================================================
set -uo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/17/bin}
SOCK=${SOCK:-/tmp/ud/pg17}
PORT=${PORT:-5433}
DB=${DB:-unitd}
REPO=${REPO:-/home/claude/repo}
FIXTURE=${FIXTURE:-$REPO/docs/evidence/d1/phase1/unitD-fixture.sql}

APPLY="$REPO/supabase/migrations/20260910_0033_p33_definer_view_write_revoke.sql"
RB="$REPO/supabase/rollback/20260910_0033_p33_definer_view_write_revoke_ROLLBACK.sql"

CONN="-h $SOCK -p $PORT -U postgres"
q()  { su postgres -c "$PGBIN/psql -X -q -A -t $CONN -d $DB -c \"$1\"" 2>&1; }
run(){ su postgres -c "PGOPTIONS='$1' $PGBIN/psql -X -q $CONN -d $DB -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f '$2'" 2>&1; }
runf(){ su postgres -c "$PGBIN/psql -X -q $CONN -d $DB -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -f '$2'" 2>&1; }
build(){ su postgres -c "$PGBIN/dropdb $CONN --if-exists $DB" >/dev/null 2>&1
         su postgres -c "$PGBIN/createdb $CONN $DB" >/dev/null 2>&1
         su postgres -c "$PGBIN/psql -X -q $CONN -d $DB -v ON_ERROR_STOP=1 -f '$FIXTURE'" >/dev/null 2>&1; }

# The ACL of all eleven, as a SET, one line per relation. [A-1]
ACLQ="SELECT c.relname||' :: '||coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(c.relacl) x),'(null)') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY 1"

# Step 10 recurrence detector.
DETQ="SELECT count(DISTINCT c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL (SELECT grantee, priv FROM unnest(ARRAY['public','anon','authenticated']) AS grantee CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS priv WHERE has_table_privilege(grantee, c.oid, priv)) g WHERE n.nspname='public' AND c.relkind IN ('v','m')"

FAILED=0
ok(){ if [ "$2" = "$3" ]; then printf '  PASS  %-58s %s\n' "$1" "$2"; else printf '  FAIL  %-58s got=%s want=%s\n' "$1" "$2" "$3"; FAILED=1; fi; }

echo "==========================================================================="
echo " D1 · UNIT D · C-34 — scratch PostgreSQL 17 only. No staging, no production."
echo "==========================================================================="
echo
echo "-- [A-2] SERVER VERSION"
VER=$(q "SELECT version()")
echo "   $VER"
MAJ=$(q "SELECT current_setting('server_version_num')::int / 10000")
ok "server major version >= 17" "$([ "$MAJ" -ge 17 ] && echo yes || echo no)" "yes"
echo

# ---------------------------------------------------------------------------
echo "-- STEP 7  FIXTURE SHAPE (must reproduce the Step 2 staging measurement)"
build
echo "   relname                          kind mask  acl-as-a-set"
q "SELECT rpad(c.relname,33)||rpad(c.relkind::text,5)||rpad(pg_relation_is_updatable(c.oid,true)::text,6)||coalesce((SELECT string_agg(x::text,',' ORDER BY x::text) FROM unnest(c.relacl) x),'(null)') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY 1" | sed 's/^/   /'
ok "eleven relations present" "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m')")" "11"
ok "auto-updatable (mask 28) count" "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v' AND pg_relation_is_updatable(c.oid,true)=28")" "5"
ok "[A-7] every ACL grantor is postgres" "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace, LATERAL unnest(c.relacl) a(x) WHERE n.nspname='public' AND c.relkind IN ('v','m') AND a.x::text NOT LIKE '%/postgres'")" "0"
ok "security_invoker unset on all five (definer)" "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v' AND pg_relation_is_updatable(c.oid,true)=28 AND c.reloptions IS NOT NULL")" "0"
echo

# ---------------------------------------------------------------------------
echo "-- STEP 10 RECURRENCE DETECTOR, fixture BEFORE 0033"
ok "relations with a write-class priv for public/anon/authenticated" "$(q "$DETQ")" "11"
echo

# ---------------------------------------------------------------------------
echo "-- STEP 9  C-34 OLD-RED — anon writes through the definer view, BEFORE 0033"
N_BEFORE=$(q "SET ROLE anon; SELECT count(*) FROM public.profiles_public")
# The row count is taken from RETURNING, not from psql's command tag: with -q
# the tag is suppressed, and a check whose evidence is an empty string is a
# check that could not have failed for the reason it claims. (C-34.)
DIRECT=$(su postgres -c "$PGBIN/psql -X -q -A -t $CONN -d $DB -c \"SET ROLE anon; UPDATE public.profiles_base SET bio='DIRECT' WHERE id=1 RETURNING id;\"" 2>&1 | grep -c '^[0-9]')
VIEWUP=$(su postgres -c "$PGBIN/psql -X -q -A -t $CONN -d $DB -c \"SET ROLE anon; UPDATE public.profiles_public SET bio='WRITTEN BY anon THROUGH A DEFINER VIEW' WHERE id=1 RETURNING id;\"" 2>&1 | grep -c '^[0-9]')
LANDED=$(q "SELECT bio FROM public.profiles_base WHERE id=1")
echo "   control: anon UPDATE on the BASE TABLE (RLS applies) ....... $DIRECT row(s)"
echo "   subject: anon UPDATE through public.profiles_public ........ $VIEWUP row(s)"
echo "   the row in the base table now reads ........................ $LANDED"
ok "SELECT rows visible to anon before" "$N_BEFORE" "2"
ok "RLS denies the direct write (control): 0 rows" "$DIRECT" "0"
ok "the definer view lets the write through (old-RED): 1 row" "$VIEWUP" "1"
ok "and the base row actually changed" "$LANDED" "WRITTEN BY anon THROUGH A DEFINER VIEW"
echo

# ---------------------------------------------------------------------------
echo "-- STEP 8  LANE-GUARD C-34 — seven fail-closed variants, then 'staging'"
echo "   Each variant must RAISE and leave every ACL byte-identical, set-compared."
build
BASE_ACL=$(q "$ACLQ")
printf '   %-24s %-8s %-10s %s\n' "p32.lane" "outcome" "SQLSTATE" "ACL identical"
for v in "__UNSET__" "production" "Production" "stagingx" "STAGING" "" " staging"; do
  if [ "$v" = "__UNSET__" ]; then OUT=$(runf "" "$APPLY"); LABEL="(unset)"
  else OUT=$(run "-c p32.lane=$(printf '%q' "$v")" "$APPLY"); LABEL="'$v'"; fi
  RC=$?
  SS=$(printf '%s' "$OUT" | sed -nE 's/.*ERROR:[[:space:]]+([0-9A-Z]{5}):.*/\1/p' | head -1)
  RAISED=$(printf '%s' "$OUT" | grep -qi 'APPLY REFUSED' && echo refused || echo "PROCEEDED")
  SAME=$([ "$(q "$ACLQ")" = "$BASE_ACL" ] && echo yes || echo NO)
  printf '   %-24s %-8s %-10s %s\n' "$LABEL" "$RAISED" "${SS:-none}" "$SAME"
  [ "$RAISED" = "refused" ] || FAILED=1
  [ "$SAME" = "yes" ] || FAILED=1
done
OUT=$(run "-c p32.lane=staging" "$APPLY"); RC=$?
PROCEEDED=$(printf '%s' "$OUT" | grep -qi 'APPLY REFUSED' && echo refused || echo proceeded)
printf '   %-24s %-8s %-10s %s\n' "'staging'" "$PROCEEDED" "-" "$([ "$(q "$ACLQ")" = "$BASE_ACL" ] && echo yes || echo changed)"
ok "only 'staging' proceeds" "$PROCEEDED" "proceeded"
ok "apply exit status" "$RC" "0"
echo

# ---------------------------------------------------------------------------
echo "-- STEP 10 RECURRENCE DETECTOR, fixture AFTER 0033"
ok "relations with a write-class priv for public/anon/authenticated" "$(q "$DETQ")" "0"
echo

echo "-- STEP 9  C-34 NEW-GREEN — the same anon write, AFTER 0033"
ERR=$(su postgres -c "$PGBIN/psql -X -q $CONN -d $DB -v VERBOSITY=verbose -c \"SET ROLE anon; UPDATE public.profiles_public SET bio='SHOULD NOT LAND' WHERE id=1;\"" 2>&1)
SS=$(printf '%s' "$ERR" | sed -nE 's/.*ERROR:[[:space:]]+([0-9A-Z]{5}):.*/\1/p' | head -1)
MSG=$(printf '%s' "$ERR" | sed -nE 's/.*ERROR:[[:space:]]+[0-9A-Z]{5}:[[:space:]]+(.*)/\1/p' | head -1)
N_AFTER=$(q "SET ROLE anon; SELECT count(*) FROM public.profiles_public")
echo "   anon UPDATE through public.profiles_public .................. $MSG"
ok "SQLSTATE" "$SS" "42501"
ok "message is a permission denial" "$(printf '%s' "$MSG" | grep -qi 'permission denied' && echo yes || echo no)" "yes"
ok "SELECT row count unchanged (N before = N after)" "$N_AFTER" "$N_BEFORE"
ok "the base row was NOT touched" "$(q "SELECT bio FROM public.profiles_base WHERE id=1")" "original bio"
echo
echo "   the same test on the other four auto-updatable views:"
for pair in "judge_comments_owner_safe|comment" "judge_decisions_owner_safe|decision" "judge_tag_assignments_owner_safe|tag_id" "judge_tag_assignments_public_r4|tag_id"; do
  V=${pair%|*}; C=${pair#*|}
  if [ "$C" = "tag_id" ]; then SET="$C=99"; else SET="$C='SHOULD NOT LAND'"; fi
  E=$(su postgres -c "$PGBIN/psql -X -q $CONN -d $DB -v VERBOSITY=verbose -c \"SET ROLE anon; UPDATE public.$V SET $SET WHERE id=1;\"" 2>&1)
  S2=$(printf '%s' "$E" | sed -nE 's/.*ERROR:[[:space:]]+([0-9A-Z]{5}):.*/\1/p' | head -1)
  ok "anon UPDATE on $V" "$S2" "42501"
done
echo

# ---------------------------------------------------------------------------
echo "-- STEP 11 ROLLBACK ROUND TRIP"
POST_ACL=$(q "$ACLQ")
OUT=$(run "-c p32.lane=staging" "$RB"); RC1=$?
ok "rollback exit status" "$RC1" "0"
ok "ACL equals the measured pre-state, as a set, on all eleven" "$([ "$(q "$ACLQ")" = "$BASE_ACL" ] && echo yes || echo no)" "yes"
ok "no PUBLIC entry anywhere in the eleven" "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace, LATERAL unnest(c.relacl) a(x) WHERE n.nspname='public' AND c.relkind IN ('v','m') AND a.x::text LIKE '=%'")" "0"
ok "anon SELECT unchanged after rollback" "$(q "SET ROLE anon; SELECT count(*) FROM public.profiles_public")" "$N_BEFORE"
ok "detector back to eleven" "$(q "$DETQ")" "11"
OUT=$(run "-c p32.lane=staging" "$RB"); RC2=$?
ok "a SECOND consecutive rollback refuses (precondition, not a silent no-op)" "$([ "$RC2" -ne 0 ] && echo refused || echo proceeded)" "refused"
ok "  and it refuses with the rollback precondition code" "$(printf '%s' "$OUT" | grep -qi 'P33-0033-RB-PRE-002' && echo yes || echo no)" "yes"
OUT=$(run "-c p32.lane=staging" "$APPLY"); RC3=$?
ok "apply again (the pair is re-runnable)" "$RC3" "0"
ok "revoked state restored, as a set" "$([ "$(q "$ACLQ")" = "$POST_ACL" ] && echo yes || echo no)" "yes"
ok "detector back to zero" "$(q "$DETQ")" "0"
OUT=$(run "-c p32.lane=staging" "$APPLY"); RC4=$?
ok "a SECOND consecutive apply refuses (precondition holds both ways)" "$([ "$RC4" -ne 0 ] && echo refused || echo proceeded)" "refused"
ok "  and it refuses with the apply precondition code" "$(printf '%s' "$OUT" | grep -qi 'P33-0033-PRE-003' && echo yes || echo no)" "yes"
echo
echo "==========================================================================="
echo " OVERALL: $([ $FAILED -eq 0 ] && echo 'ALL CHECKS PASS' || echo '*** ONE OR MORE CHECKS FAILED')"
echo "==========================================================================="
exit $FAILED
