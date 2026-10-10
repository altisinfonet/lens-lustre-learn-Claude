#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# SEC-P3E-1 · post_shares SELECT scoped to post visibility (20261010_0003)
# C-34 harness, two lane shapes: staging (post_shares not published) and
# production (post_shares in supabase_realtime). Every apply / rollback / probe
# runs through apply-migration.yml's extracted "Run it" step.
# SCRATCH CLUSTER ONLY.   bash docs/evidence/d1/SEC-P3E-1/p3e1-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB=p3e1
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../../.." && pwd)"
MIG="$ROOT/supabase/migrations/20261010_0003_sec_p3e_1_post_shares_select.sql"
RB="$ROOT/supabase/rollback/20261010_0003_sec_p3e_1_post_shares_select_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_sec_p3e_1_post_shares.sql"
RUNIT="$ROOT/docs/evidence/d1/phase1/p1-0037-runit2.sh"
fail=0; NPASS=0
step() { printf '\n══ %s\n' "$*"; }
q() { psql -q -X -d "$DB" -tAc "$1"; }
ok()  { echo "  PASS  $*"; NPASS=$((NPASS+1)); }
bad() { echo "  FAIL  $*"; fail=1; }
want() { [ "$1" = "$2" ] && ok "$3" || { bad "$3"; echo "        want: $2"; echo "        got : $1"; }; }
run() { out=$(TARGET_LANE="$LANE" bash "$RUNIT" "$DB" "$1" 5432 2>&1); rc=$?; }
err() { echo "$out" | grep -m1 'ERROR' | sed 's/.*ERROR: *//' | cut -c1-150; }
probe_red() { run "$PROBE"; [ $rc -ne 0 ] && echo "$out" | grep -q "$1" && ok "PROBE red — $2: $(err)" || bad "PROBE should be red ($1) — $2 (rc=$rc: $(err))"; }
probe_green() { run "$PROBE"; [ $rc -eq 0 ] && { ok "PROBE green — $1"; echo "$out" | grep -o 'PROBE PASS[^"]*' | head -1 | sed 's/^/        /'; } || { bad "PROBE should pass — $1"; echo "$out" | grep ERROR | head -3; }; }
pol() { q "SELECT string_agg(policyname||'|'||cmd||'|'||permissive||'|'||array_to_string(roles,',')||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n' ORDER BY policyname) FROM pg_policies WHERE tablename='post_shares'"; }
# as member $1: how many of user 1's three shares are visible
seen() { q "BEGIN; SELECT set_config('request.jwt.claim.sub', '$1', true); SET LOCAL ROLE authenticated; SELECT count(*) FROM public.post_shares WHERE user_id = '00000000-0000-0000-0000-000000000001'; ROLLBACK;" | grep -E '^[0-9]+$' | tail -1; }
setpol() { q "DROP POLICY IF EXISTS \"Users can view shares on visible posts\" ON public.post_shares; CREATE POLICY \"Users can view shares on visible posts\" ON public.post_shares AS PERMISSIVE FOR SELECT TO authenticated USING ($1)"; }
SCOPED="user_id = (SELECT auth.uid()) OR EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_shares.post_id AND public.can_view_post((SELECT auth.uid()), p.user_id, p.privacy))"
fixture() {
  psql -q -X -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1
  psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -v shape="$SHAPE" -f "$HERE/p3e1-fixture.sql" >/dev/null || { echo "fixture failed"; exit 2; }
  q "INSERT INTO public.post_shares (post_id, user_id) SELECT id, '00000000-0000-0000-0000-000000000001' FROM public.posts" >/dev/null
}
U2=00000000-0000-0000-0000-000000000002; U6=00000000-0000-0000-0000-000000000006

for SHAPE in staging production; do
LANE=$SHAPE
step "$SHAPE · 0 · fixture"
fixture
echo "  $(q "SELECT 'PG '||current_setting('server_version')||' · post_shares published: '||EXISTS (SELECT 1 FROM pg_publication_tables WHERE tablename='post_shares')")"
want "$(seen $U2)" "3" "fail first: a stranger reads all 3 of member 1's shares (public, friends-only, private) under USING (true)"
P0=$(pol)
probe_red "S2 the SELECT policy is not scoped" "fail first: today's policy"

step "$SHAPE · 1 · apply"
run "$MIG"; [ $rc -eq 0 ] && { ok "0003 applied"; echo "$out" | grep -o 'SEC-P3E-1-0003:[^"]*' | head -1 | sed 's/^/        /'; } || bad "apply: $(err)"
want "$(seen $U2)|$(seen 00000000-0000-0000-0000-000000000001)|$(seen $U6)" "1|3|2" "stranger 1 of 3 (public) · sharer 3 of 3 (own) · private post's author 2 (public + their own post's)"
probe_green "after 0003"
run "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'PRE-002' && ok "a second apply is refused (PRE-002)" || bad "second apply"
want "$(q "SELECT count(*) FROM pg_policies WHERE tablename='post_shares' AND cmd IN ('SELECT','ALL') AND permissive='PERMISSIVE'")" "1" "one permissive SELECT policy"
[ "$SHAPE" = production ] && want "$(q "SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='post_shares'")" "1" "publication untouched (realtime applies this same SELECT policy)"

step "$SHAPE · 2 · PROBE mutants (each red, then restored)"
q "ALTER POLICY \"Users can view shares on visible posts\" ON public.post_shares USING (true)"; probe_red "S2" "the policy back to USING (true)"; setpol "$SCOPED"
setpol "EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_shares.post_id AND public.can_view_post((SELECT auth.uid()), p.user_id, p.privacy))"
probe_red "B2 the sharer sees 1 of their 3" "post_reactions' expression alone (no own-row arm): the sharer loses sight of a share"
unshare() { local pid; pid=$(q "SELECT id FROM public.posts WHERE privacy = 'private'")   # the client deletes by a known post_id
  q "BEGIN; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true); SET LOCAL ROLE authenticated;
  WITH d AS (DELETE FROM public.post_shares WHERE user_id = '00000000-0000-0000-0000-000000000001' AND post_id = '$pid' RETURNING 1) SELECT count(*) FROM d; ROLLBACK;" | grep -E '^[0-9]+$' | tail -1; }
want "$(unshare)" "0" "…and the sharer's unshare of a private post deletes 0 rows (why the own-row arm is there)"
setpol "$SCOPED"
want "$(unshare)" "1" "with the shipped expression the same unshare deletes 1 row"
setpol "user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_shares.post_id AND public.can_view_post(auth.uid(), p.user_id, p.privacy))"; probe_red "S3 a bare auth.uid()" "bare auth.uid() (per-row re-evaluation)"; setpol "$SCOPED"
q "CREATE POLICY m4 ON public.post_shares AS PERMISSIVE FOR SELECT TO authenticated USING (true)"; probe_red "S1" "a second permissive SELECT USING (true) next to it"; q "DROP POLICY m4 ON public.post_shares"
setpol "user_id = (SELECT auth.uid()) OR post_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_shares.post_id AND public.can_view_post((SELECT auth.uid()), p.user_id, p.privacy))"
probe_red "B1 a stranger sees 3 of 3" "an always-true arm hidden next to can_view_post (passes the text checks S1–S3; behaviour catches it)"; setpol "$SCOPED"
q "INSERT INTO public.user_roles VALUES ('00000000-0000-0000-0000-000000000002', 'admin')"
probe_green "the oldest candidate is an admin (sees every post): the PROBE skips admins and still proves B1–B6"
q "DELETE FROM public.user_roles"
probe_green "every mutant undone"

step "$SHAPE · 3 · rollback and re-apply"
run "$RB"; [ $rc -eq 0 ] && ok "rollback applied" || bad "rollback: $(err)"
want "$(pol)" "$P0" "every post_shares policy exactly as before 0003"
want "$(seen $U2)" "3" "the stranger reads all 3 again (the leak is back — as the rollback says)"
run "$RB"; [ $rc -ne 0 ] && echo "$out" | grep -q 'RB-PRE-001' && ok "a second rollback is refused" || bad "second rollback"
run "$MIG"; [ $rc -eq 0 ] && ok "re-apply after rollback" || bad "re-apply: $(err)"
probe_green "after re-apply"

step "$SHAPE · 4 · drift refusal"
fixture
q "ALTER POLICY \"Authenticated users can view shares\" ON public.post_shares TO authenticated, anon"
before=$(pol); run "$MIG"
[ $rc -ne 0 ] && echo "$out" | grep -q 'PRE-002' && [ "$(pol)" = "$before" ] && ok "refused PRE-002 on a drifted policy, nothing changed: $(err)" || bad "drift should be refused"
before=$(pol); out=$(psql -X -d "$DB" -f "$MIG" 2>&1)
echo "$out" | grep -q 'APPLY REFUSED' && [ "$(pol)" = "$before" ] && ok "refused — lane not asserted" || bad "lane guard"
done

echo; echo "$NPASS PASS"; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
