#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# F-AUD-8 (SEC-P9-2) · cron credential rotation · C-34 harness, TWO lane shapes.
# 20261010_0001 (rotate) · its rollback · 20261010_0002 (finalize) · its refusing
# rollback · PROBE_faud8_cron_credentials — every file through apply-migration.yml's
# extracted "Run it" step (p1-0037-runit2.sh). The lane copies are made by the
# REAL 20261005_0003 (and its real rollback is exercised in step 8).
# Values are INVENTED here (fixture JWTs / sb_secret_ / secrets); none is real.
# Value-bearing harness statements run with logging off for THAT session only
# (PGOPTIONS), so step 12 can prove the rotation files never put a value in the
# server log (log_statement=all, log_parameter_max_length=-1) or pg_stat_statements
# (track=all).
# SCRATCH CLUSTER ONLY.   bash docs/evidence/d1/F-AUD-8/faud8-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p5cron
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20261010_0001_faud8_cron_credential_rotate.sql"
RB="$ROOT/supabase/rollback/20261010_0001_faud8_cron_credential_rotate_ROLLBACK.sql"
FIN="$ROOT/supabase/migrations/20261010_0002_faud8_cron_credential_finalize.sql"
FINRB="$ROOT/supabase/rollback/20261010_0002_faud8_cron_credential_finalize_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_faud8_cron_credentials.sql"
M3="$ROOT/supabase/migrations/20261005_0003_p9c_cron_http_into_vault.sql"
M3RB="$ROOT/supabase/rollback/20261005_0003_p9c_cron_http_into_vault_ROLLBACK.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
LOG="${PGLOG:-/var/log/postgresql/postgresql-16-main.log}"

# ── invented values ──
eval "$(python3 - <<'PY'
import base64, json
b = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).decode().rstrip('=')
h = b({"alg": "HS256", "typ": "JWT"})
jwt = lambda p, s: f"{h}.{b(p)}.{s}"
v = {
 "OLD_KEY":  jwt({"iss": "supabase", "ref": "fixtureref00000000", "role": "service_role", "iat": 1}, "FIXTUREoldSIGnotAsecret0000000000000000000"),
 "NEW_KEY":  jwt({"iss": "supabase", "ref": "fixtureref00000000", "role": "service_role", "iat": 2}, "FIXTUREnewSIGnotAsecret1111111111111111111"),
 "ANON_KEY": jwt({"iss": "supabase", "ref": "fixtureref00000000", "role": "anon", "iat": 3}, "FIXTUREanonSIGnotAsecret222222222222222222"),
 "OTHER_KEY": jwt({"iss": "supabase", "ref": "otherproject000000", "role": "service_role", "iat": 4}, "FIXTUREotherSIGnotAsecret33333333333333333"),
 "SB1": "sb_secret_FIXTUREnotAsecret4444444444444444", "SB2": "sb_secret_FIXTUREnotAsecret5555555555555555",
 "OLD_CS": "fixtureOLDcronSecretNOTreal66666666666666666", "NEW_CS": "fixtureNEWcronSecretNOTreal77777777777777777",
 "CS3": "fixtureCS3cronSecretNOTreal88888888888888888", "SP": "fixtureScheduledPostsSecret999999999999999",
}
for k, x in v.items(): print(f"{k}='{x}'")
PY
)"
ALLVALS="$OLD_KEY $NEW_KEY $ANON_KEY $OTHER_KEY $SB1 $SB2 $OLD_CS $NEW_CS $CS3 $SP"

fail=0; NPASS=0
step() { printf '\n══ %s\n' "$*"; }
q()  { psql -q -X -d "$DB" -tAc "$1"; }
qs() { PGOPTIONS='-c log_statement=none -c pg_stat_statements.track=none' psql -q -X -d "$DB" -tAc "$1"; }   # value-bearing, not logged
ok()  { echo "  PASS  $*"; NPASS=$((NPASS+1)); }
bad() { echo "  FAIL  $*"; fail=1; }
want() { [ "$1" = "$2" ] && ok "$3" || { bad "$3"; echo "        want: $2"; echo "        got : $1"; }; }
run() { out=$(TARGET_LANE="$LANE" bash "$RUNIT" "$DB" "$1" 5432 2>&1); rc=$?; }
err() { echo "$out" | grep -m1 -E 'ERROR' | sed 's/.*ERROR: *//' | cut -c1-150; }
note() { echo "$out" | grep -o "$1[^\"]*" | head -1 | cut -c1-230 | sed 's/^/        /'; }
refuses() {   # $1 code  $2 what
  local before=$(snap); run "$MIG"
  if [ $rc -ne 0 ] && echo "$out" | grep -q "$1"; then
    [ "$(snap)" = "$before" ] && ok "refused $1 — $2; nothing changed: $(err)" || bad "$1 refused but something changed — $2"
  else bad "should refuse $1 — $2 (rc=$rc: $(err))"; fi; }
probe_red() { run "$PROBE"; [ $rc -ne 0 ] && echo "$out" | grep -q "$1" && ok "PROBE red — $2: $(echo "$out" | grep -o "$1[^\"]*" | head -1 | cut -c1-120)" || bad "PROBE should be red ($1) — $2 (rc=$rc)"; }
probe_green() { run "$PROBE"; [ $rc -eq 0 ] && { ok "PROBE green — $1"; note 'PROBE PASS'; } || { bad "PROBE should pass — $1"; echo "$out" | grep -E 'ERROR|^  R' | head -6; }; }
# every vault secret except faud8_* and every cron job, hashed — "nothing changed"
snap() { q "SELECT md5(coalesce((SELECT string_agg(name||'='||md5(secret), ',' ORDER BY name) FROM vault.secrets WHERE name NOT LIKE 'faud8\_%'),'')
                 || coalesce((SELECT string_agg(name, ',' ORDER BY name) FROM vault.secrets WHERE name LIKE 'faud8\_%'),'')
                 || (SELECT string_agg(jobname||schedule||command, ',' ORDER BY jobname) FROM cron.job))"; }
holding() { qs "SELECT count(*) FROM vault.secrets WHERE (name LIKE 'p9\_cron\_%') AND strpos(secret, '$1') > 0"; }
temps() { qs "DELETE FROM vault.secrets WHERE name LIKE 'faud8\_new:%'"
          [ -n "${1:-}" ] && qs "SELECT vault.create_secret('$1', 'faud8_new:cron_secret')" >/dev/null
          [ -n "${2:-}" ] && qs "SELECT vault.create_secret('$2', 'faud8_new:service_key')" >/dev/null; true; }
# run every cron_http_call job once; are all requests carrying exactly the expected key / cron secret?
calls_ok() {  # $1 key  $2 cs  $3 form(jwt|sb)
  qs "TRUNCATE net.http_request_queue" >/dev/null
  q "DO \$d\$ DECLARE r record; BEGIN FOR r IN SELECT command FROM cron.job WHERE command LIKE '%cron_http_call%' LOOP EXECUTE r.command; END LOOP; END \$d\$" >/dev/null
  if [ "$3" = jwt ]; then
    qs "SELECT count(*)||'/'||count(*) FILTER (WHERE headers->>'Authorization' = 'Bearer $1' AND headers->>'x-cron-secret' = '$2' AND NOT headers ? 'apikey') FROM net.http_request_queue"
  else
    qs "SELECT count(*)||'/'||count(*) FILTER (WHERE headers->>'apikey' = '$1' AND headers->>'x-cron-secret' = '$2' AND NOT headers ? 'Authorization') FROM net.http_request_queue"
  fi; }
fixture() {
  q "SELECT cron.unschedule(jobid) FROM cron.job" >/dev/null 2>&1; q "DELETE FROM cron.job_run_details" >/dev/null 2>&1
  q "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS vault CASCADE; DROP SCHEMA IF EXISTS net CASCADE;" >/dev/null 2>&1
  PGOPTIONS='-c log_statement=none -c pg_stat_statements.track=none' psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -v shape="$SHAPE" -v old_key="$OLD_KEY" -v old_cs="$OLD_CS" -v sp_secret="$SP" -f "$HERE/faud8-fixture.sql" >/dev/null || { echo "fixture 1 failed"; exit 2; }
  run "$M3"; [ $rc -eq 0 ] || { echo "real 0003 failed on the fixture: $(err)"; exit 2; }
  PGOPTIONS='-c log_statement=none -c pg_stat_statements.track=none' psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -v shape="$SHAPE" -v old_key="$OLD_KEY" -v old_cs="$OLD_CS" -f "$HERE/faud8-fixture-post0003.sql" >/dev/null || { echo "fixture 2 failed"; exit 2; }
}

LOGSTART=$(stat -c %s "$LOG" 2>/dev/null || echo 0)
q "CREATE SCHEMA IF NOT EXISTS pss; DROP EXTENSION IF EXISTS pg_stat_statements; CREATE EXTENSION pg_stat_statements SCHEMA pss;" >/dev/null && q "SELECT pss.pg_stat_statements_reset()" >/dev/null || { echo "pg_stat_statements unavailable"; exit 2; }

for SHAPE in staging production; do
LANE=$SHAPE
step "$SHAPE · 0 · fixture (real 0003 + 0006/P5-b captures)"
fixture
echo "  copies: $(q "SELECT string_agg(name, ' ' ORDER BY name) FROM vault.secrets WHERE name LIKE 'p9\_cron\_http:%'" | sed 's/p9_cron_http://g')"
echo "  previous: $(q "SELECT count(*) FROM vault.secrets WHERE name LIKE 'p9\_cron\_previous:%'") · run-history rows: $(q "SELECT count(*) FROM cron.job_run_details") · $(q "SELECT 'PG '||current_setting('server_version')||' · pg_cron '||extversion FROM pg_extension WHERE extname='pg_cron'")"
NCOPY=$(q "SELECT count(*) FROM vault.secrets WHERE name LIKE 'p9\_cron\_%'")
want "$(holding "$OLD_KEY")" "$NCOPY" "fail first: every one of the $NCOPY copies holds the OLD key"
probe_red "R1 no rotation recorded" "fail first: before any rotation"
S0=$(snap)

step "$SHAPE · 1 · refusals (each must change nothing)"
temps; refuses "PRE-003: neither" "no temporaries"
temps "$NEW_CS"$'\n' "$NEW_KEY"; refuses "NEW-001" "cron secret pasted with a line break"
temps "$NEW_CS" "$ANON_KEY";    refuses "NEW-003.*role is not service_role" "an anon key pasted as the service key"
temps "$NEW_CS" "$OTHER_KEY";   refuses "NEW-003.*another project" "a service key of another project"
temps "$NEW_CS" "sb_publishable_FIXTURE00000000000000"; refuses "NEW-001" "a publishable key"
temps "$NEW_CS" "$OLD_KEY";     refuses "NEW-002" "new key = old key"
temps "$NEW_CS" "$NEW_KEY"
qs "SELECT vault.create_secret('x', 'faud8_new:other')" >/dev/null; refuses "PRE-003: an unknown" "an unknown faud8_new:* secret"; q "DELETE FROM vault.secrets WHERE name='faud8_new:other'"
J=p9_cron_http:apply-scheduled-boosts; SAVE=$(qs "SELECT secret FROM vault.secrets WHERE name='$J'")
qs "UPDATE vault.secrets SET secret = jsonb_set(secret::jsonb, '{headers,x-cron-secret}', '\"fixtureDIFFERENTcronSecret00000000000000000\"')::text WHERE name='$J'"
refuses "OLD-001" "two copies disagree on the cron secret"
qs "UPDATE vault.secrets SET secret = \$v\$$SAVE\$v\$ WHERE name='$J'"
qs "SELECT vault.create_secret('$OLD_KEY', 'service_role_key')" >/dev/null; refuses "CONTAIN-001" "another vault secret holds the old key"; q "DELETE FROM vault.secrets WHERE name='service_role_key'"
qs "CREATE FUNCTION public.mutant_fn() RETURNS text LANGUAGE sql AS \$f\$ SELECT '$OLD_CS' \$f\$"; refuses "CONTAIN-001" "a function body holds the old cron secret"; q "DROP FUNCTION public.mutant_fn()"
qs "SELECT cron.schedule('mutant-job', '0 0 1 1 *', 'SELECT ''Bearer $OLD_KEY''')" >/dev/null; refuses "CONTAIN-001" "a cron command holds the old key"; q "SELECT cron.unschedule('mutant-job')" >/dev/null
P=p9_cron_previous:judging-invariants-nightly; SAVE=$(qs "SELECT secret FROM vault.secrets WHERE name='$P'")
qs "UPDATE vault.secrets SET secret = replace(secret, 'functions/v1/judging', 'functions/v1/tampered') WHERE name='$P'"
refuses "PREV-001" "a previous copy that no longer matches its live target"
qs "UPDATE vault.secrets SET secret = \$v\$$SAVE\$v\$ WHERE name='$P'"
before=$(snap); out=$(psql -X -d "$DB" -f "$MIG" 2>&1); rc=$?
echo "$out" | grep -q 'APPLY REFUSED' && [ "$(snap)" = "$before" ] && ok "refused — lane not asserted (psql without SET p32.lane): $(echo "$out" | grep -m1 -o 'APPLY REFUSED[^(]*')" || bad "lane guard"
temps; want "$(snap)" "$S0" "after all refusals the lane is exactly as before (temporaries aside)"; temps "$NEW_CS" "$NEW_KEY"

step "$SHAPE · 2 · rotate JWT → JWT, both credentials"
JOBS0=$(q "SELECT md5(string_agg(jobname||schedule||command, ',' ORDER BY jobname)) FROM cron.job")
run "$MIG"; [ $rc -eq 0 ] && { ok "0001 applied"; note 'F-AUD-8-0001'; } || { bad "0001 apply: $(err)"; }
want "$(holding "$OLD_KEY")/$(holding "$OLD_CS")" "0/0" "no p9_cron_* copy holds an old value"
want "$(qs "SELECT count(*) FROM vault.secrets WHERE name LIKE 'p9\_cron\_http:%' AND secret::jsonb->'headers'->>'Authorization' = 'Bearer $NEW_KEY'")" "$(q "SELECT count(*) FROM vault.secrets WHERE name LIKE 'p9\_cron\_http:%'")" "every live copy: Authorization = Bearer <new key>"
want "$(calls_ok "$NEW_KEY" "$NEW_CS" jwt)" "$(q "SELECT count(*) FROM cron.job WHERE command LIKE '%cron_http_call%'")/$(q "SELECT count(*) FROM cron.job WHERE command LIKE '%cron_http_call%'")" "every moved job, run, sends the new key and the new cron secret"
want "$(q "SELECT md5(string_agg(jobname||schedule||command, ',' ORDER BY jobname)) FROM cron.job")" "$JOBS0" "cron.job untouched (no value ever written there)"
want "$(qs "SELECT (secret LIKE '%decrypted_secrets%')::text||'/'||(secret LIKE '%$NEW_KEY%')::text||'/'||(strpos(secret,'$SP')=0)::text FROM vault.secrets WHERE name='p9_cron_previous:publish-scheduled-posts'")" "true/true/true" "P5-b previous: same key form → value replaced in the text, its inline vault read kept inline"
want "$(qs "SELECT secret::jsonb->'headers'->>'x-scheduled-posts-secret' = '$SP' FROM vault.secrets WHERE name='p9_cron_http:publish-scheduled-posts'")" "t" "P5-b's own secret untouched (not a rotated credential)"
want "$(q "SELECT count(*) FROM vault.secrets WHERE name LIKE 'faud8\_new:%'")|$(q "SELECT count(*) FROM vault.secrets WHERE name LIKE 'faud8\_undo:%'")" "0|$((NCOPY+1))" "temporaries deleted; one undo copy per changed copy + the record's"
want "$(qs "SELECT (strpos(secret,'$NEW_KEY')+strpos(secret,'$OLD_KEY')+strpos(secret,'$NEW_CS')+strpos(secret,'$OLD_CS'))::text||'/'||(secret::jsonb->'rotations'->0 ? 'service_key')::text FROM vault.secrets WHERE name='faud8_rotation:last'")" "0/true" "the record holds hashes, no value"
probe_red "R1 the latest rotation is not finalized" "rotated, not finalized (the way back still exists)"
temps "$CS3"; refuses "PRE-002" "a second rotation before finalize"; temps
run "$FINRB"; [ $rc -ne 0 ] && echo "$out" | grep -q 'no rollback by design' && ok "0002's rollback refuses by design" || bad "0002 rollback should refuse"

step "$SHAPE · 3 · rollback 0001 (before finalize): byte for byte"
run "$RB"; [ $rc -eq 0 ] && { ok "rollback applied"; note 'F-AUD-8-0001-RB'; } || bad "rollback: $(err)"
want "$(snap)" "$S0" "every vault secret and cron job byte-identical to before the rotation"
want "$(q "SELECT count(*) FROM vault.secrets WHERE name LIKE 'faud8\_%'")" "0" "no undo copy and no record left (first rotation undone)"
run "$RB"; [ $rc -ne 0 ] && echo "$out" | grep -q 'RB-PRE-001' && ok "a second rollback is refused (RB-PRE-001)" || bad "second rollback"
run "$FIN"; [ $rc -ne 0 ] && echo "$out" | grep -q '0002-PRE-001' && ok "finalize with nothing pending is refused" || bad "finalize PRE-001"

step "$SHAPE · 4 · rotate again → finalize → PROBE"
temps "$NEW_CS" "$NEW_KEY"; run "$MIG"; [ $rc -eq 0 ] && ok "0001 re-applied" || bad "0001 re-apply: $(err)"
HIST=$(qs "SELECT count(*) FROM cron.job_run_details WHERE strpos(command,'$OLD_KEY') > 0")
run "$FIN"; [ $rc -eq 0 ] && { ok "0002 finalize applied"; note 'F-AUD-8-0002'; } || bad "finalize: $(err)"
want "$(qs "SELECT count(*) FROM cron.job_run_details WHERE strpos(command,'$OLD_KEY') + strpos(command,'$OLD_CS') > 0")|$(q "SELECT count(*) FROM vault.secrets WHERE name LIKE 'faud8\_undo:%'")" "0|0" "run history held $HIST old-credential row(s): now 0; undo copies deleted"
probe_green "finalized rotation, $SHAPE shape"

step "$SHAPE · 5 · PROBE mutants after finalize (each red, then undone)"
qs "SELECT vault.create_secret('$OLD_KEY', 'mutant_copy')" >/dev/null; probe_red "R2 vault secret mutant_copy holds a RETIRED" "a vault secret holding the retired key"; q "DELETE FROM vault.secrets WHERE name='mutant_copy'"
qs "CREATE FUNCTION public.mutant_fn() RETURNS text LANGUAGE sql AS \$f\$ SELECT 'Bearer $OLD_KEY' \$f\$"; probe_red "R2 function mutant_fn() holds a RETIRED" "a function body holding 'Bearer <retired key>'"; q "DROP FUNCTION public.mutant_fn()"
qs "SELECT cron.schedule('mutant-job', '0 0 1 1 *', 'SELECT ''$NEW_CS''')" >/dev/null; probe_red "R4 cron job mutant-job holds a CURRENT" "a cron command holding the CURRENT cron secret"; q "SELECT cron.unschedule('mutant-job')" >/dev/null
qs "INSERT INTO cron.job_run_details (jobid, runid, command, status, start_time) VALUES (1, nextval('cron.runid_seq'), 'x-cron-secret: $NEW_CS', 'succeeded', now())"; probe_red "R4 run history of job 1 holds a CURRENT" "run history holding the CURRENT cron secret"; qs "DELETE FROM cron.job_run_details WHERE strpos(command,'$NEW_CS') > 0"
J=p9_cron_http:expire-gift-credits; SAVE=$(qs "SELECT secret FROM vault.secrets WHERE name='$J'")
qs "UPDATE vault.secrets SET secret = replace(secret, '$NEW_CS', '$OLD_CS') WHERE name='$J'"; probe_red "R2 vault secret $J holds a RETIRED" "a live copy put back to the retired cron secret"
qs "UPDATE vault.secrets SET secret = \$v\$$SAVE\$v\$ WHERE name='$J'"
qs "SELECT vault.create_secret('x', 'faud8_new:cron_secret')" >/dev/null; probe_red "R1 left behind: faud8_new:cron_secret" "a temporary left in vault"; q "DELETE FROM vault.secrets WHERE name LIKE 'faud8\_new:%'"
probe_green "every mutant undone"

step "$SHAPE · 6 · the p9_cron_previous decision, shown: the REAL 0003 rollback after a rotation"
run "$M3RB"; [ $rc -eq 0 ] && ok "0003 rollback applied (P9-c undone)" || bad "0003 rollback: $(err)"
N6=$(q "SELECT count(*) FROM cron.job WHERE command ILIKE '%net.http_post%'")
want "$(qs "SELECT count(*) FILTER (WHERE strpos(command,'$NEW_KEY')>0 AND strpos(command,'$NEW_CS')>0)||'/'||count(*) FILTER (WHERE strpos(command,'$OLD_KEY')+strpos(command,'$OLD_CS')>0) FROM cron.job WHERE command ILIKE '%net.http_post%'")" "$N6/0" "the $N6 restored literal jobs carry the NEW credentials, none the old (a working job, not a revoked one)"
probe_red "R4 cron job .* holds a CURRENT" "after a P9-c rollback the credentials are literal in cron.job again — the PROBE says so"
run "$M3"; [ $rc -eq 0 ] && ok "0003 re-applied (re-captured from the restored jobs)" || bad "0003 re-apply: $(err)"
want "$(calls_ok "$NEW_KEY" "$NEW_CS" jwt)" "$(q "SELECT count(*) FROM cron.job WHERE command LIKE '%cron_http_call%'")/$(q "SELECT count(*) FROM cron.job WHERE command LIKE '%cron_http_call%'")" "every moved job again sends the new credentials"
probe_green "back to the rotated, P9-c state"

step "$SHAPE · 7 · rotate the service key JWT → sb_secret_ (key only)"
temps "" "$SB1"; run "$MIG"; [ $rc -eq 0 ] && { ok "0001 applied"; note 'F-AUD-8-0001'; } || bad "0001 jwt→sb: $(err)"
want "$(calls_ok "$SB1" "$NEW_CS" sb)" "$(q "SELECT count(*) FROM cron.job WHERE command LIKE '%cron_http_call%'")/$(q "SELECT count(*) FROM cron.job WHERE command LIKE '%cron_http_call%'")" "every moved job sends apikey: <sb_secret_>, no Authorization (Bearer sb_secret_ is refused as Invalid JWT); cron secret unchanged"
want "$(qs "SELECT count(*) FROM vault.secrets WHERE name LIKE 'p9\_cron\_%' AND (strpos(secret,'$NEW_KEY') > 0 OR secret ~ 'Bearer sb_secret_')")" "0" "no copy holds the old JWT or a Bearer sb_secret_"
want "$(qs "SELECT (secret LIKE '%decrypted_secrets%')::text||'/'||(secret LIKE '%apikey%')::text FROM vault.secrets WHERE name='p9_cron_previous:publish-scheduled-posts'")" "false/true" "form change → P5-b previous REBUILT from its live target (the evaluated header is now a literal; stated in 0001)"
run "$FIN"; [ $rc -eq 0 ] && ok "finalized" || bad "finalize: $(err)"
probe_green "after JWT → sb_secret_"
J=p9_cron_http:judging-invariants-nightly; SAVE=$(qs "SELECT secret FROM vault.secrets WHERE name='$J'")
qs "UPDATE vault.secrets SET secret = jsonb_set(secret::jsonb, '{headers,Authorization}', '\"Bearer $SB1\"')::text WHERE name='$J'"
probe_red "R3 $J does not hold the current value" "a copy sending Bearer sb_secret_"
qs "UPDATE vault.secrets SET secret = \$v\$$SAVE\$v\$ WHERE name='$J'"

step "$SHAPE · 8 · rotate sb_secret_ → sb_secret_ and the cron secret (same form: text replace)"
temps "$CS3" "$SB2"; run "$MIG"; [ $rc -eq 0 ] && { ok "0001 applied"; note 'F-AUD-8-0001'; } || bad "0001 sb→sb: $(err)"
want "$(calls_ok "$SB2" "$CS3" sb)" "$(q "SELECT count(*) FROM cron.job WHERE command LIKE '%cron_http_call%'")/$(q "SELECT count(*) FROM cron.job WHERE command LIKE '%cron_http_call%'")" "every moved job sends the second sb_secret_ and the third cron secret"
run "$FIN"; [ $rc -eq 0 ] && ok "finalized" || bad "finalize: $(err)"
want "$(qs "SELECT jsonb_array_length(secret::jsonb->'retired_sha256')||'/'||jsonb_array_length(secret::jsonb->'rotations') FROM vault.secrets WHERE name='faud8_rotation:last'")" "5/3" "record: 5 retired hashes (old key, old cs, new key, SB1, new cs), 3 kept rotations (the rolled-back one is gone)"
probe_green "after three rotations, every retired value checked"
done

step "12 · no value in the server log or pg_stat_statements"
q "SELECT 'fixtureLOGcontrolNOTaSecret000000000000'" >/dev/null   # positive control: an ordinary logged statement
SEG=$(tail -c +$((LOGSTART+1)) "$LOG")
LINES=$(echo "$SEG" | wc -l); HITS=0
for v in $ALLVALS; do c=$(echo "$SEG" | grep -cF -- "$v"); HITS=$((HITS+c)); done
want "$(echo "$SEG" | grep -c 'fixtureLOGcontrolNOTaSecret000000000000')" "1" "control: the log does capture a literal sent as an ordinary statement"
want "$HITS" "0" "server log since the start ($LINES lines, log_statement=all, parameters logged in full): 0 lines hold any of the 10 fixture values"
echo "        (that log holds the rotations' own NOTICE lines: $(echo "$SEG" | grep -c 'F-AUD-8-0001: rotated'))"
PSS=$(q "SELECT count(*) FROM pss.pg_stat_statements"); H2=0; [ -n "$PSS" ] && [ "$PSS" -gt 100 ] || { bad "pg_stat_statements not readable or empty ($PSS)"; H2=x; }
for v in $ALLVALS; do c=$(PGOPTIONS='-c pg_stat_statements.track=none -c log_statement=none' psql -q -X -d "$DB" -tAc "SELECT count(*) FROM pss.pg_stat_statements WHERE strpos(query, '$v') > 0") || c=999; H2=$((H2+c)); done
want "$( [ "$(q "SELECT count(*) FROM pss.pg_stat_statements WHERE query LIKE '%vault.update_secret%' AND query NOT LIKE '%pss.%'")" -ge 1 ] && echo yes)" "yes" "control: pg_stat_statements records the rotation's nested vault.update_secret calls (values as \$n parameters)"
want "$H2" "0" "pg_stat_statements (track=all, $PSS statements incl. nested PL/pgSQL): 0 hold any fixture value"
SECF=$(cd "$ROOT" && grep -lE "$(echo $ALLVALS | tr ' ' '|')" "$MIG" "$RB" "$FIN" "$FINRB" "$PROBE" 2>/dev/null | wc -l)
want "$SECF" "0" "none of the five shipped SQL files holds a value"

echo; echo "$NPASS PASS"; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
