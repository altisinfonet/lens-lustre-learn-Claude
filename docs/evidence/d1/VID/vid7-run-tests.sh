#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# VID-7 feature switches (20261005_0004) · C-34 harness, staging shape AND
# production shape. Acts as the API roles (SET ROLE + JWT sub), the way
# PostgREST does. Every apply / rollback / probe runs through apply-migration.yml's
# extracted "Run it" step.   PGPORT=5433 bash docs/evidence/d1/VID/vid7-run-tests.sh
# ═══════════════════════════════════════════════════════════════════════════
set -u
source "$(cd "$(dirname "$0")" && pwd)/vid-lib.sh"
MIG="$ROOT/supabase/migrations/20261005_0004_vid7_feature_access.sql"
RB="$ROOT/supabase/rollback/20261005_0004_vid7_feature_access_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_vid7_feature_access.sql"
allowed() { q "SELECT string_agg(f || '=' || public.feature_allowed(f, '$1')::text, ' ' ORDER BY f) FROM unnest(ARRAY['copyright_music_check','video_ads','video_posts']) f"; }
audits() { q "SELECT count(*) FROM public.feature_access_audit"; }

for LANE in staging production; do
step "$LANE · 0 · fixture"
fixture $LANE

step "$LANE · 1 · fail first: nothing enforces a switch today"
probe_is fail "before 0004" "$PROBE" "VID-7" "F1 feature_allowed"

step "$LANE · 2 · apply 20261005_0004 (lane $LANE) and probe"
run $LANE "$MIG"; [ $rc -eq 0 ] && echo "  PASS  apply — $(echo "$out" | grep -o 'VID7-0004: .*' | head -1)" || { echo "  FAIL  apply"; echo "$out" | grep -E 'ERROR|CONTEXT' | head -4; fail=1; }
probe_is pass "after 0004" "$PROBE" "VID-7"
run $LANE "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'VID7-0004-PRE-002' && echo "  PASS  a second apply is refused (PRE-002)" || { echo "  FAIL  second apply"; fail=1; }
want "$(allowed $NEIL)" "copyright_music_check=false video_ads=false video_posts=false" "seeded OFF: nobody has any feature"

step "$LANE · 3 · only an admin changes a switch; members can't read or probe"
want "$(err "$(as authenticated $NEIL "SELECT public.feature_set_mode('video_posts','everyone')")" 'FEATURE-001')" "FEATURE-001" "a member calling feature_set_mode → FEATURE-001"
want "$(err "$(as anon '' "SELECT public.feature_set_mode('video_posts','everyone')")" 'permission denied')" "permission denied" "anon cannot even call it"
want "$(err "$(as authenticated $NEIL "SELECT count(*) FROM public.feature_access_members")" 'permission denied')" "permission denied" "a member cannot read the member lists"
want "$(err "$(as authenticated $NEIL "SELECT public.feature_allowed('video_posts', '$RIYA')")" 'permission denied')" "permission denied" "a member cannot ask about ANOTHER member (feature_allowed is internal)"
want "$(as authenticated $NEIL "SELECT public.feature_allowed_me('video_posts')")" "f" "a member can ask about themself (feature_allowed_me)"
want "$(err "$(as authenticated $NEIL "SELECT * FROM public.feature_admin_state()")" 'FEATURE-001')" "FEATURE-001" "a member cannot read the admin page"

step "$LANE · 4 · Off → Selected members → All members → Selected members (list kept) → Off"
a0=$(audits)
want "$(as authenticated $ADMIN "SELECT public.feature_set_mode('video_posts','selected','pilot')")" "selected" "admin: video_posts → Selected members"
want "$(as authenticated $ADMIN "SELECT public.feature_add_member('video_posts','$NEIL','first tester')")" "t" "admin: add Neil"
want "$(as authenticated $ADMIN "SELECT public.feature_add_member('video_posts','$NEIL')")" "f" "adding Neil again: no-op, no audit row"
want "$(allowed $NEIL)|$(allowed $RIYA)" "copyright_music_check=false video_ads=false video_posts=true|copyright_music_check=false video_ads=false video_posts=false" "Neil may post video; Riya may not"
want "$(as authenticated $ADMIN "SELECT public.feature_set_mode('video_posts','everyone')")" "everyone" "admin: → All members"
want "$(q "SELECT public.feature_allowed('video_posts', '$RIYA')")" "t" "Riya may now"
want "$(as authenticated $ADMIN "SELECT public.feature_set_mode('video_posts','selected')")" "selected" "admin: back to Selected members"
want "$(q "SELECT public.feature_allowed('video_posts', '$NEIL')")|$(q "SELECT public.feature_allowed('video_posts', '$RIYA')")" "t|f" "the saved list came back: Neil yes, Riya no"
want "$(as authenticated $ADMIN "SELECT public.feature_set_mode('video_posts','off')")" "off" "admin: → Off"
want "$(q "SELECT public.feature_allowed('video_posts', '$NEIL')")|$(q "SELECT count(*) FROM public.feature_access_members WHERE feature='video_posts'")" "f|1" "Off: nobody, and the list is still saved"
want "$(( $(audits) - a0 ))" "5" "5 audit rows (4 mode changes + 1 add; the no-op wrote none)"
want "$(q "SELECT action||':'||coalesce(old_value,'')||'→'||coalesce(new_value,'')||':'||(actor = '$ADMIN')::text FROM public.feature_access_audit ORDER BY id LIMIT 1")" "mode:off→selected:true" "an audit row names the admin and old → new"
want "$(err "$(as authenticated $ADMIN "SELECT public.feature_set_mode('video_posts','sometimes')")" 'FEATURE-002')" "FEATURE-002" "an unknown mode → FEATURE-002"

step "$LANE · 5 · copyright_music_check: refused ON while the music-API key is missing (R-102)"
a0=$(audits)
o=$(as authenticated $ADMIN "SELECT public.feature_set_mode('copyright_music_check','selected')"); want "$(err "$o" 'FEATURE-003')" "FEATURE-003" "Selected members, no key → FEATURE-003"
o=$(as authenticated $ADMIN "SELECT public.feature_set_mode('copyright_music_check','everyone')"); want "$(err "$o" 'FEATURE-003')" "FEATURE-003" "All members, no key → FEATURE-003"
want "$(q "SELECT mode FROM public.feature_access WHERE feature='copyright_music_check'")|$(( $(audits) - a0 ))" "off|0" "still off, no audit row"
want "$(as authenticated $ADMIN "SELECT public.feature_add_member('copyright_music_check','$NEIL','R-103 example')")" "t" "the list can be prepared while Off (add Neil Basu)"
q "SELECT vault.create_secret('', 'music_check_api_key')" >/dev/null
o=$(as authenticated $ADMIN "SELECT public.feature_set_mode('copyright_music_check','selected')"); want "$(err "$o" 'FEATURE-003')" "FEATURE-003" "an EMPTY key counts as missing"
q "UPDATE vault.secrets SET secret = 'fixture-not-a-key-0000' WHERE name = 'music_check_api_key'" >/dev/null
want "$(as authenticated $ADMIN "SELECT public.feature_set_mode('copyright_music_check','selected')")" "selected" "key configured → Selected members accepted"
want "$(allowed $NEIL)|$(allowed $RIYA)" "copyright_music_check=true video_ads=false video_posts=false|copyright_music_check=false video_ads=false video_posts=false" "R-103's example: only Neil's videos are checked"

step "$LANE · 6 · the audit trail cannot be edited, even by the owner role"
want "$(err "$(q "UPDATE public.feature_access_audit SET note = 'x'" 2>&1)" 'append-only')" "append-only" "UPDATE → refused"
want "$(err "$(q "DELETE FROM public.feature_access_audit" 2>&1)" 'append-only')" "append-only" "DELETE → refused"
want "$(err "$(q "TRUNCATE public.feature_access_audit" 2>&1)" 'append-only')" "append-only" "TRUNCATE → refused"

step "$LANE · 7 · the admin Features page and member search"
want "$(as authenticated $ADMIN "SELECT jsonb_array_length(public.feature_admin_state())")" "3" "feature_admin_state: three cards"
want "$(as authenticated $ADMIN "SELECT e->'members'->0->>'full_name' || ' @' || (e->'members'->0->>'username') || ' key=' || (e->>'key_configured') FROM jsonb_array_elements(public.feature_admin_state()) e WHERE e->>'feature' = 'copyright_music_check'")" "Neil Basu @neilbasu key=true" "card shows the member chip (name + @username) and the key state"
want "$(as authenticated $ADMIN "SELECT string_agg(username, ',' ORDER BY username) FROM public.feature_member_search('neil')")" "neilbasu" "search by name"
want "$(as authenticated $ADMIN "SELECT string_agg(username, ',') FROM public.feature_member_search('@riya')")" "riya" "search by @username"
want "$(as authenticated $ADMIN "SELECT string_agg(username, ',') FROM public.feature_member_search('arun@example')")" "arun" "search by email"
want "$(err "$(as authenticated $NEIL "SELECT * FROM public.feature_member_search('riya')")" 'FEATURE-001')" "FEATURE-001" "a member cannot search (emails stay admin-only)"

step "$LANE · 8 · a deleted account leaves every list"
q "DELETE FROM auth.users WHERE id = '$NEIL'" >/dev/null
want "$(q "SELECT count(*) FROM public.feature_access_members WHERE user_id = '$NEIL'")" "0" "Neil's rows cascaded away"
q "INSERT INTO auth.users VALUES ('$NEIL', 'neil@example.invalid'); INSERT INTO public.profiles VALUES ('$NEIL', 'Neil Basu', NULL, 'neilbasu')" >/dev/null

step "$LANE · 9 · the PROBE catches each regression (mutants, each undone)"
mut() { q "$1" >/dev/null; probe_is fail "$3" "$PROBE" "VID-7" "$2"; q "$4" >/dev/null; }
mut "GRANT SELECT ON public.feature_access_members TO authenticated" "F3 public.feature_access_members" "members can read the lists" "REVOKE SELECT ON public.feature_access_members FROM authenticated"
mut "GRANT MAINTAIN ON public.feature_access_audit TO authenticated" "F3 public.feature_access_audit" "MAINTAIN on the audit (PG17)" "REVOKE MAINTAIN ON public.feature_access_audit FROM authenticated"
mut "GRANT EXECUTE ON FUNCTION public.feature_allowed(text,uuid) TO authenticated" "F3 an internal check" "feature_allowed callable by members" "REVOKE EXECUTE ON FUNCTION public.feature_allowed(text,uuid) FROM authenticated"
mut "DELETE FROM vault.secrets WHERE name = 'music_check_api_key'" "F2 copyright_music_check is on" "the key removed while the check is on" "SELECT vault.create_secret('fixture-not-a-key-0000', 'music_check_api_key')"
mut "ALTER TABLE public.feature_access_audit DISABLE TRIGGER tg_feature_audit_append_only" "F4 feature_access_audit has no enabled" "the append-only trigger disabled" "ALTER TABLE public.feature_access_audit ENABLE TRIGGER tg_feature_audit_append_only"
mut "ALTER TABLE public.feature_access DISABLE ROW LEVEL SECURITY" "F4 public.feature_access: RLS off" "RLS off" "ALTER TABLE public.feature_access ENABLE ROW LEVEL SECURITY"
probe_is pass "every mutant undone" "$PROBE" "VID-7"

step "$LANE · 10 · rollback keeps the records; a re-apply resets every mode to Off (audited)"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'ROLLBACK REFUSED' && echo "  PASS  rollback with no lane — refused" || { echo "  FAIL  rollback lane guard"; fail=1; }
a0=$(audits); m0=$(q "SELECT count(*) FROM public.feature_access_members")
run $LANE "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback (lane $LANE)" || { echo "  FAIL  rollback"; echo "$out" | grep ERROR | head -3; fail=1; }
want "$(q "SELECT to_regprocedure('public.feature_allowed(text,uuid)') IS NULL")|$(audits)|$(q "SELECT count(*) FROM public.feature_access_members")" "t|$a0|$m0" "functions gone; audit trail ($a0 rows) and lists ($m0) kept"
probe_is fail "after the rollback" "$PROBE" "VID-7"
run $LANE "$MIG"; [ $rc -eq 0 ] && echo "  PASS  re-apply" || { echo "  FAIL  re-apply"; echo "$out" | grep ERROR | head -3; fail=1; }
want "$(q "SELECT string_agg(mode, ',') FROM public.feature_access")|$(( $(audits) - a0 ))|$(q "SELECT count(*) FROM public.feature_access_members")" "off,off,off|1|$m0" "every mode Off again (1 reset audited: copyright_music_check was Selected); lists kept"
probe_is pass "re-applied" "$PROBE" "VID-7"
done

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
