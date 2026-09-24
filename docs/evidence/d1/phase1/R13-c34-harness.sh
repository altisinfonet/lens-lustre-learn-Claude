#!/usr/bin/env bash
# ===========================================================================
# D1 · R-13 · C-34 HARNESS — SCRATCH PostgreSQL 17 ONLY.
#
# No staging connection. No production connection. No workflow_dispatch.
#
# WHAT MAKES THIS EVIDENCE RATHER THAN A RE-ENACTMENT: the script under test is
# EXTRACTED FROM .github/workflows/apply-migration.yml and executed verbatim,
# with exactly the three environment variables the job binds ($DB_URL,
# $TARGET_LANE, $MIGRATION_PATH). Nothing is re-typed. If the step's text and
# this transcript ever disagree, the extraction fails rather than the check
# passing against a copy that drifted.
#
# The cluster:
#   apt-get install -y postgresql-17          # PGDG, Ubuntu 24.04 noble-pgdg
#   initdb -D /tmp/ud/pg17/data -U postgres
#   echo 'host all all 127.0.0.1/32 trust' >> /tmp/ud/pg17/data/pg_hba.conf
#   pg_ctl -D /tmp/ud/pg17/data \
#          -o '-p 5432 -k /tmp/ud/pg17 -c listen_addresses=127.0.0.1' start
#   CREATE ROLE "postgres.fpszggreishhuvdpkmdr" LOGIN SUPERUSER;
# The role name is pooler-shaped so the connection URL has the real shape the
# port parser reads. The password in the URL below is ignored (trust auth on
# loopback); it is there so the string parses like the real one.
# ===========================================================================
set -uo pipefail

REPO=${REPO:-/home/claude/repo}
WF="$REPO/.github/workflows/apply-migration.yml"
BASE=${BASE:-5d563e7}
PGBIN=${PGBIN:-/usr/lib/postgresql/17/bin}
HOSTP=${HOSTP:-127.0.0.1}
DB=${DB:-r13}
FIXTURE="$REPO/docs/evidence/d1/phase1/unitD-fixture.sql"
APPLY0033="supabase/migrations/20260910_0033_p33_definer_view_write_revoke.sql"
PROBE="supabase/migrations/PROBE_credential_connectivity_readonly.sql"

URL_OK="postgresql://postgres.fpszggreishhuvdpkmdr:notthepassword@${HOSTP}:5432/${DB}"
URL_TXN="postgresql://postgres.fpszggreishhuvdpkmdr:notthepassword@${HOSTP}:6543/${DB}"
URL_BAD="postgresql://postgres.fpszggreishhuvdpkmdr:notthepassword@${HOSTP}/${DB}"

FAILED=0
ok(){ if [ "$2" = "$3" ]; then printf '  PASS  %-60s %s\n' "$1" "$2"; else printf '  FAIL  %-60s got=%s want=%s\n' "$1" "$2" "$3"; FAILED=1; fi; }

# ── Extract the two run scripts: HEAD's and the BASE's. ────────────────────
mkdir -p /tmp/r13
extract() {  # $1 = yaml file, $2 = out
python3 - "$1" "$2" <<'PY'
import sys, yaml, io
doc = yaml.safe_load(io.open(sys.argv[1], encoding='utf-8').read())
for s in doc['jobs']['apply']['steps']:
    if s.get('name') == 'Run it':
        io.open(sys.argv[2],'w',encoding='utf-8',newline='').write("#!/usr/bin/env bash\n" + s['run'])
        sys.exit(0)
sys.exit("no 'Run it' step")
PY
}
cd "$REPO"
extract "$WF" /tmp/r13/run-head.sh || exit 1
git show "$BASE:.github/workflows/apply-migration.yml" > /tmp/r13/base-wf.yml
extract /tmp/r13/base-wf.yml /tmp/r13/run-base.sh || exit 1
chmod +x /tmp/r13/run-head.sh /tmp/r13/run-base.sh

q(){ "$PGBIN/psql" -X -A -t -h "$HOSTP" -p 5432 -U postgres -d "$DB" -c "$1" 2>&1; }
build(){ "$PGBIN/dropdb" -h "$HOSTP" -p 5432 -U postgres --if-exists "$DB" >/dev/null 2>&1
         "$PGBIN/createdb" -h "$HOSTP" -p 5432 -U postgres "$DB" >/dev/null 2>&1
         "$PGBIN/psql" -X -q -h "$HOSTP" -p 5432 -U postgres -d "$DB" -v ON_ERROR_STOP=1 -f "$FIXTURE" >/dev/null 2>&1; }

ACLQ="SELECT c.relname||' :: '||coalesce((SELECT string_agg(x::text,',' ORDER BY x::text) FROM unnest(c.relacl) x),'(null)') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY 1"
DETQ="SELECT count(DISTINCT c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL (SELECT grantee, priv FROM unnest(ARRAY['public','anon','authenticated']) AS grantee CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS priv WHERE has_table_privilege(grantee, c.oid, priv)) g WHERE n.nspname='public' AND c.relkind IN ('v','m')"

echo "==========================================================================="
echo " D1 · R-13 · C-34 — scratch PostgreSQL 17 only. No staging, no production."
echo "==========================================================================="
echo
echo "-- SERVER"
build   # the database must exist before it can be asked its version; the first
        # cut of this harness asked before building and recorded the connection
        # error in place of the version.
echo "   $(q 'SELECT version()')"
MAJ=$(q "SELECT current_setting('server_version_num')::int / 10000")
ok "server major version >= 17" "$([ "${MAJ:-0}" -ge 17 ] && echo yes || echo no)" "yes"
echo "   psql client: $("$PGBIN/psql" --version)"
echo
echo "-- THE SCRIPT UNDER TEST is extracted from $WF"
echo "   HEAD 'Run it'  : $(wc -l < /tmp/r13/run-head.sh) lines, sha256 $(sha256sum /tmp/r13/run-head.sh | cut -c1-16)"
echo "   BASE 'Run it'  : $(wc -l < /tmp/r13/run-base.sh) lines, sha256 $(sha256sum /tmp/r13/run-base.sh | cut -c1-16)   ($BASE)"
echo

run_step(){  # $1 script  $2 DB_URL  $3 TARGET_LANE  $4 MIGRATION_PATH
  ( cd "$REPO" && DB_URL="$2" TARGET_LANE="$3" MIGRATION_PATH="$4" bash "$1" 2>&1 )
}

# ── ROW 6 · old-RED: the BASE step, which sets nothing. ───────────────────
echo "-- ROW 6  the CURRENT workflow (no -c line) against 0033 — the defect"
build
B_ACL=$(q "$ACLQ")
OUT=$(run_step /tmp/r13/run-base.sh "$URL_OK" staging "$APPLY0033"); RC=$?
echo "$OUT" | grep -iE 'APPLY REFUSED|p32.lane' | head -2 | sed 's/^/   /'
ok "base step exit status is non-zero" "$([ $RC -ne 0 ] && echo nonzero || echo zero)" "nonzero"
ok "it refuses on the lane guard" "$(echo "$OUT" | grep -qi 'APPLY REFUSED' && echo yes || echo no)" "yes"
ok "ACL unchanged" "$([ "$(q "$ACLQ")" = "$B_ACL" ] && echo yes || echo no)" "yes"
ok "detector still 11" "$(q "$DETQ")" "11"
echo

# ── ROW 4 · the new step, staging. ────────────────────────────────────────
echo "-- ROW 4  the R-13 step, TARGET_LANE=staging, against 0033"
build
OUT=$(run_step /tmp/r13/run-head.sh "$URL_OK" staging "$APPLY0033"); RC=$?
echo "$OUT" | grep -E 'Credential port|Asserting p32.lane' | sed 's/^/   /'
ok "exit status" "$RC" "0"
ok "no refusal in the output" "$(echo "$OUT" | grep -qi 'REFUSED' && echo refused || echo proceeded)" "proceeded"
ok "detector: 11 relations revoked -> 0" "$(q "$DETQ")" "0"
ok "anon keeps SELECT on profiles_public" "$(q "SELECT has_table_privilege('anon','public.profiles_public','SELECT')")" "t"
ok "anon lost UPDATE on profiles_public" "$(q "SELECT has_table_privilege('anon','public.profiles_public','UPDATE')")" "f"
echo

# ── ROW 5 · the new step, production. ─────────────────────────────────────
echo "-- ROW 5  the R-13 step, TARGET_LANE=production, against the same file"
build
B_ACL=$(q "$ACLQ")
OUT=$(run_step /tmp/r13/run-head.sh "$URL_OK" production "$APPLY0033"); RC=$?
echo "$OUT" | grep -E 'Credential port|Asserting p32.lane' | sed 's/^/   /'
echo "$OUT" | grep -i 'APPLY REFUSED' | head -1 | cut -c1-118 | sed 's/^/   /'
ok "exit status is non-zero" "$([ $RC -ne 0 ] && echo nonzero || echo zero)" "nonzero"
ok "it refuses on the lane guard" "$(echo "$OUT" | grep -qi 'APPLY REFUSED' && echo yes || echo no)" "yes"
ok "the refusal reports the lane it was given" "$(echo "$OUT" | grep -qi "read: production" && echo yes || echo no)" "yes"
ok "ACL unchanged" "$([ "$(q "$ACLQ")" = "$B_ACL" ] && echo yes || echo no)" "yes"
ok "detector still 11" "$(q "$DETQ")" "11"
echo

# ── ROW 7 · port parse. ───────────────────────────────────────────────────
echo "-- ROW 7  pooler-mode parse"
build
B_ACL=$(q "$ACLQ")
OUT=$(run_step /tmp/r13/run-head.sh "$URL_TXN" staging "$APPLY0033"); RC=$?
echo "$OUT" | grep -E 'Credential port|::error::' | head -2 | cut -c1-118 | sed 's/^/   /'
ok "6543 exit status is non-zero" "$([ $RC -ne 0 ] && echo nonzero || echo zero)" "nonzero"
ok "6543 refuses with the mandated message" \
   "$(echo "$OUT" | grep -qF 'transaction-mode pooler cannot carry p32.lane; the Environment secret must use the session pooler (5432)' && echo yes || echo no)" "yes"
ok "6543 never reached psql (ACL unchanged)" "$([ "$(q "$ACLQ")" = "$B_ACL" ] && echo yes || echo no)" "yes"

OUT=$(run_step /tmp/r13/run-head.sh "$URL_BAD" staging "$APPLY0033"); RC=$?
echo "$OUT" | grep -E '::error::' | head -1 | cut -c1-118 | sed 's/^/   /'
ok "malformed (no port) exit status is non-zero" "$([ $RC -ne 0 ] && echo nonzero || echo zero)" "nonzero"
ok "malformed refuses on the parse" "$(echo "$OUT" | grep -qi 'Could not parse a port' && echo yes || echo no)" "yes"
ok "malformed never reached psql (ACL unchanged)" "$([ "$(q "$ACLQ")" = "$B_ACL" ] && echo yes || echo no)" "yes"

OUT=$(run_step /tmp/r13/run-head.sh "$URL_OK" staging "$APPLY0033"); RC=$?
ok "5432 proceeds" "$RC" "0"
ok "  and the file actually ran (detector 0)" "$(q "$DETQ")" "0"

# the lane re-assert, with a value the choice input cannot produce
OUT=$(run_step /tmp/r13/run-head.sh "$URL_OK" stagingx "$APPLY0033"); RC=$?
ok "an unknown TARGET_LANE is refused at the point of use" "$([ $RC -ne 0 ] && echo nonzero || echo zero)" "nonzero"
ok "  with the point-of-use message" "$(echo "$OUT" | grep -qi 'at the point of use' && echo yes || echo no)" "yes"
echo

# ── ROW 8 · an unguarded file is unaffected by the SET. ───────────────────
echo "-- ROW 8  an UNGUARDED historical file, run through the new step"
build
B_ACL=$(q "$ACLQ")
OUT=$(run_step /tmp/r13/run-head.sh "$URL_OK" staging "$PROBE"); RC=$?
ok "exit status" "$RC" "0"
ok "no refusal" "$(echo "$OUT" | grep -qi 'REFUSED' && echo refused || echo proceeded)" "proceeded"
# The probe SELECTs current_database, current_user, server_version and now().
# Assert the actual values, not "the output is equal to itself" -- the first
# cut of this line compared one expression to the same expression, which is a
# check that could not have failed (C-34).
ok "the probe returned exactly one row" "$(echo "$OUT" | grep -c '^(1 row)$')" "1"
ok "  naming this database" "$(echo "$OUT" | grep -c "\\b${DB}\\b")" "1"
ok "  connected as the pooler-shaped role" "$(echo "$OUT" | grep -c 'postgres\.fpszggreishhuvdpkmdr')" "1"
ok "  and reporting a 17.x server" "$(echo "$OUT" | grep -cE '\| 17\.')" "1"
ok "ACL unchanged (the GUC is inert to a file that never reads it)" "$([ "$(q "$ACLQ")" = "$B_ACL" ] && echo yes || echo no)" "yes"
ok "detector unchanged at 11" "$(q "$DETQ")" "11"
OUT2=$(run_step /tmp/r13/run-base.sh "$URL_OK" staging "$PROBE"); RC2=$?
ok "the BASE step runs the same file identically (behaviour unchanged)" "$RC2" "0"
echo

echo "==========================================================================="
echo " OVERALL: $([ $FAILED -eq 0 ] && echo 'ALL CHECKS PASS' || echo '*** ONE OR MORE CHECKS FAILED')"
echo "==========================================================================="
exit $FAILED
