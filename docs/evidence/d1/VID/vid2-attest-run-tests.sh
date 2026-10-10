#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# F-D1-4 attest + SEC-VID-4 (20261005_0007) · C-34 harness, staging shape AND
# production shape. Acts as the API roles (SET ROLE + JWT sub) the way
# PostgREST does; every apply / rollback / probe runs through
# apply-migration.yml's extracted "Run it" step (p1-0037-runit2.sh).
# Signatures are made with openssl, NOT pgcrypto — the same independent HMAC
# D2's `complete` makes with Web Crypto — so a PASS proves the two agree.
#                     PGPORT=5432 bash docs/evidence/d1/VID/vid2-attest-run-tests.sh
# Needs PostgreSQL 17 (the lanes' major; the vid4 PROBE checks MAINTAIN) + pg_cron.
# ═══════════════════════════════════════════════════════════════════════════
set -u
source "$(cd "$(dirname "$0")" && pwd)/vid-lib.sh"
M4="$ROOT/supabase/migrations/20261005_0004_vid7_feature_access.sql"
M5="$ROOT/supabase/migrations/20261005_0005_vid2_videos.sql"
M6="$ROOT/supabase/migrations/20261005_0006_vid4_music_check.sql"
RB6="$ROOT/supabase/rollback/20261005_0006_vid4_music_check_ROLLBACK.sql"
MIG="$ROOT/supabase/migrations/20261005_0007_vid2_upload_attest.sql"
RB="$ROOT/supabase/rollback/20261005_0007_vid2_upload_attest_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_vid2_upload_attest.sql"
PROBE4="$ROOT/supabase/migrations/PROBE_vid4_music_check.sql"
H1=$(printf 'a%.0s' {1..64}); H2=$(printf 'b%.0s' {1..64}); H3=$(printf 'd%.0s' {1..64})
K1=fixture-attest-key-current-00000000000000001; K2=fixture-attest-key-rotated-0000000000000002
KX=fixture-attest-key-some-other-lane-00000000003; KS=short-key-31-chars-000000000000
uuid() { cat /proc/sys/kernel/random/uuid; }
rb() { local a=""; [ "${2:-yes}" = yes ] && a=", \"audio\": $(( $1 * 10000 ))"; echo "{\"240p\": $(( $1 * 50000 ))$a, \"other\": 50000}"; }
tot() { local t=$(( $1 * 50000 + 50000 )); [ "${2:-yes}" = yes ] && t=$(( t + $1 * 10000 )); echo $t; }
TF() { [ "$1" = yes ] && echo true || echo false; }
# up <uid> <seconds> [audio yes|no] [purpose] → new video id (manifest H1)
up() { as authenticated "$1" "SELECT public.video_begin_upload('${4:-post}', '$H1', $(tot $2 ${3:-yes}), $2, $(TF ${3:-yes}), '$(uuid)', '$(rb $2 ${3:-yes})')->>'video_id'"; }
now() { date +%s; }
# sign <key> <lane> <video> <version> <manifest> <true|false> <audio hex|none> <issued_at>
sign() { printf 'v1|%s|%s|%s|%s|%s|%s|%s' "$2" "$3" "$4" "$5" "$6" "$7" "$8" | openssl dgst -sha256 -hmac "$1" | awk '{print $NF}'; }
# m5 <uid> <video> <version> <audio hex|none> <issued|NULL> <attest|NULL> [field] → the 5-argument call
m5() { local a=NULL s=NULL; [ "$4" != none ] && a="'$4'"; [ "$6" != NULL ] && s="'$6'"
       as authenticated "$1" "SELECT public.video_mark_uploaded('$2', $3, $a, $5, $s)->>'${7:-state}'"; }
# ok <uid> <video> <version> <manifest> <true|false> <audio|none> [key] [field] → a correctly signed call
ok() { local t; t=$(now); m5 "$1" "$2" "$3" "$6" "$t" "$(sign "${7:-$K1}" "$LANE" "$2" "$3" "$4" "$5" "$6" "$t")" "${8:-state}"; }
state() { q "SELECT state FROM public.videos WHERE id = '$1'"; }
untouched() { q "SELECT state || ':' || (SELECT count(*) FROM public.video_music_checks c WHERE c.video_id = v.id) || ':' || (SELECT (uploaded_at IS NULL)::text FROM public.video_versions x WHERE x.video_id = v.id AND x.version_no = v.current_version) FROM public.videos v WHERE id = '$1'"; }
setkeys() { q "DELETE FROM vault.secrets WHERE name LIKE 'video_complete_attest_key%'" >/dev/null
            [ -n "${1:-}" ] && q "SELECT vault.create_secret('$1', 'video_complete_attest_key')" >/dev/null
            [ -n "${2:-}" ] && q "SELECT vault.create_secret('$2', 'video_complete_attest_key_previous')" >/dev/null; true; }
latest() { q "SELECT id FROM public.video_music_checks WHERE video_id = '$1' ORDER BY version_no DESC, attempt DESC LIMIT 1"; }
selpaths() { q "SELECT count(*) FROM pg_policy p WHERE p.polrelid = 'public.ad_videos'::regclass AND p.polpermissive AND p.polcmd IN ('r','*') AND (p.polroles @> ARRAY['authenticated'::regrole::oid] OR p.polroles = '{0}')"; }
# vid-lib's probe_is always dispatches as staging; this PROBE checks the lane, so dispatch as the fixture's lane.
eval "$(declare -f probe_is | sed 's/run staging "\$3"/run "$LANE" "$3"/')"
probe_lane() {   # $1 lane to dispatch as · $2 expected tag text → PASS if the PROBE refuses with it
  run "$1" "$PROBE"; [ $rc -ne 0 ] && echo "$out" | grep -q "$2" && echo "  PASS  PROBE refuses — dispatched as $1 on a $LANE database: $(echo "$out" | grep -o "$2.*" | head -1 | cut -c1-120)" || { echo "  FAIL  PROBE should refuse as $1"; echo "$out" | grep -E 'ERROR|NOTICE' | tail -2; fail=1; }; }

step "0 · the function body is 0006's, changed only where F-D1-4 says"
B6=$(sed -n '/^CREATE FUNCTION public.video_mark_uploaded/,/^\$fn\$;/p' "$M6")
B7=$(sed -n '/^CREATE FUNCTION public.video_mark_uploaded/,/^\$fn\$;/p' "$MIG")
D=$(diff <(echo "$B6") <(echo "$B7") | grep -E '^[<>]' | sed 's/^\(.\) */\1 /' | tr '\n' '~')
want "$D" "< CREATE FUNCTION public.video_mark_uploaded(_video_id uuid, _version_no integer, _audio_sha256 text DEFAULT NULL)~> CREATE FUNCTION public.video_mark_uploaded(_video_id uuid, _version_no integer, _audio_sha256 text,~> _issued_at bigint, _attest text)~> -- F-D1-4: only a completion signed by \`complete\` goes further — replay answer included.~> PERFORM public.video_attest_verify(_video_id, _version_no, _audio_sha256, _issued_at, _attest);~" "diff 0006 → 0007 body: the signature and the one PERFORM, nothing else"
B8=$(sed -n '/^CREATE FUNCTION public.video_mark_uploaded/,/^\$fn\$;/p' "$RB")
want "$(diff <(echo "$B6") <(echo "$B8") >/dev/null && echo same)" "same" "the rollback restores 0006's body byte for byte"
want "$(sign 0123456789abcdef0123456789abcdef staging 00000000-0000-0000-0000-000000000001 1 $H1 true none 1700000000)" \
     "$(psql -X -d "$DB" -tAc "SELECT encode(extensions.hmac('v1|staging|00000000-0000-0000-0000-000000000001|1|$H1|true|none|1700000000', '0123456789abcdef0123456789abcdef', 'sha256'), 'hex')" 2>/dev/null || echo needs-fixture)" \
     "openssl HMAC = pgcrypto HMAC on the same message (checked again after the fixture below)"

for LANE in staging production; do
step "$LANE · 1 · fixture + 0004 + 0005 + 0006 (as on staging today); video_posts and video_ads on for All members"
fixture $LANE
for f in "$M4" "$M5" "$M6"; do run $LANE "$f"; [ $rc -eq 0 ] || { echo "  FAIL  apply $(basename "$f")"; echo "$out" | grep ERROR | head -2; fail=1; }; done
echo "  PASS  0004 + 0005 + 0006 applied (lane $LANE)"
as authenticated $ADMIN "SELECT public.feature_set_mode('video_posts','everyone')" >/dev/null
as authenticated $ADMIN "SELECT public.feature_set_mode('video_ads','everyone')" >/dev/null
want "$(sign $K1 x y 1 $H1 true none 1)" "$(q "SELECT encode(extensions.hmac('v1|x|y|1|$H1|true|none|1', '$K1', 'sha256'), 'hex')")" "openssl and pgcrypto (schema extensions, as on the lanes) give the same HMAC"

step "$LANE · 2 · FAIL FIRST — before 0007 the holes are real"
probe_is fail "before 0007" "$PROBE" "VID-2A" "A1 the upload attestation"
F=$(up $NEIL 30)
want "$(as authenticated $NEIL "SELECT public.video_mark_uploaded('$F', 1, '$H3')->>'state'")|$(q "SELECT count(*) FROM public.video_versions WHERE video_id = '$F' AND audio_sha256 = '$H3'")" "ready|1" \
     "F-D1-4 reproduced: Neil calls video_mark_uploaded directly with a made-up hash, no files, no complete → ready"
want "$(selpaths)" "2" "SEC-VID-4 reproduced: ad_videos has 2 permissive SELECT paths for authenticated"

step "$LANE · 3 · apply 20261005_0007 (lane $LANE)"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$MIG" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'APPLY REFUSED' && echo "  PASS  apply with no lane asserted — refused" || { echo "  FAIL  apply lane guard"; fail=1; }
run $LANE "$MIG"; [ $rc -eq 0 ] && echo "  PASS  apply — $(echo "$out" | grep -o 'VID2-0007: .*' | head -1)" || { echo "  FAIL  apply"; echo "$out" | grep -E 'ERROR|LINE' | head -4; fail=1; }
run $LANE "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'VID2-0007-PRE-002' && echo "  PASS  a second apply is refused (PRE-002)" || { echo "  FAIL  second apply"; fail=1; }
want "$(q "SELECT public.video_attest_lane()")|$(selpaths)" "$LANE|1" "the lane word fixed into the database is '$LANE'; ad_videos has 1 SELECT path"

step "$LANE · 4 · no key on the lane → nothing completes (fail closed) and the PROBE goes red (A3)"
setkeys
V=$(up $NEIL 30)
want "$(err "$(ok $NEIL $V 1 $H1 true $H1)" 'VID-MU-004')|$(untouched $V)" "VID-MU-004|uploading:0:true" "a correctly signed call, no key in vault → VID-MU-004; video untouched"
probe_is fail "a switch is on, no key" "$PROBE" "VID-2A" "A3 a video switch is not Off"
setkeys $KS
want "$(err "$(ok $NEIL $V 1 $H1 true $H1 $KS)" 'VID-MU-004')" "VID-MU-004" "a key shorter than 32 characters counts as no key → VID-MU-004"
setkeys $K1
probe_is pass "key set" "$PROBE" "VID-2A"
probe_is pass "PROBE_vid4 accepts the attested form" "$PROBE4" "VID-4"

step "$LANE · 5 · SEC's fail-first set: every forged or stale completion is refused, and changes nothing"
T=$(now)
want "$(err "$(as authenticated $NEIL "SELECT public.video_mark_uploaded('$V', 1, '$H1')")" 'does not exist')" "does not exist" "the 3-argument call → does not exist (no unattested path)"
want "$(err "$(m5 $NEIL $V 1 $H1 $T NULL)" 'VID-MU-005')" "VID-MU-005" "none: no attestation → VID-MU-005"
want "$(err "$(m5 $NEIL $V 1 $H1 NULL "$(sign $K1 $LANE $V 1 $H1 true $H1 $T)")" 'VID-MU-005')" "VID-MU-005" "none: no issued_at → VID-MU-005"
want "$(err "$(m5 $NEIL $V 1 $H1 $T not-hex)" 'VID-MU-005')" "VID-MU-005" "malformed attestation → VID-MU-005"
G=$(sign $K1 $LANE $V 1 $H1 true $H1 $T); TAMP=$(echo "$G" | sed 's/^./0/; t; s/^/x/'); [ "$TAMP" = "$G" ] && TAMP=$(echo "$G" | sed 's/^./1/')
want "$(err "$(m5 $NEIL $V 1 $H1 $T $TAMP)" 'VID-MU-005')" "VID-MU-005" "tampered: one hex digit changed → VID-MU-005"
OL=$([ $LANE = staging ] && echo production || echo staging)
want "$(err "$(m5 $NEIL $V 1 $H1 $T "$(sign $K1 $OL $V 1 $H1 true $H1 $T)")" 'VID-MU-005')" "VID-MU-005" "other lane: signed for '$OL' → VID-MU-005"
want "$(err "$(m5 $NEIL $V 1 $H1 $T "$(sign $KX $LANE $V 1 $H1 true $H1 $T)")" 'VID-MU-005')" "VID-MU-005" "other key (another lane's key) → VID-MU-005"
want "$(err "$(m5 $NEIL $V 1 $H1 $T "$(sign $K1 $LANE $V 2 $H1 true $H1 $T)")" 'VID-MU-005')" "VID-MU-005" "other version: signed for v2, called for v1 → VID-MU-005"
W=$(up $NEIL 30)
want "$(err "$(m5 $NEIL $V 1 $H1 $T "$(sign $K1 $LANE $W 1 $H1 true $H1 $T)")" 'VID-MU-005')" "VID-MU-005" "other video: Neil's video W's attestation used on V → VID-MU-005"
want "$(err "$(m5 $NEIL $V 1 $H1 $T "$(sign $K1 $LANE $V 1 $H2 true $H1 $T)")" 'VID-MU-005')" "VID-MU-005" "other manifest: signed over a manifest hash that is not the stored one → VID-MU-005"
want "$(err "$(m5 $NEIL $V 1 none $T "$(sign $K1 $LANE $V 1 $H1 false none $T)")" 'VID-MU-005')" "VID-MU-005" "has_audio flipped to false in the signature (stored row says true) → VID-MU-005"
want "$(err "$(m5 $NEIL $V 1 $H3 $T "$(sign $K1 $LANE $V 1 $H1 true $H1 $T)")" 'VID-MU-005')" "VID-MU-005" "audio hash swapped: signed H1, passed a made-up H3 → VID-MU-005"
want "$(err "$(m5 $NEIL $V 1 none $T "$(sign $K1 $LANE $V 1 $H1 true $H1 $T)")" 'VID-MU-005')" "VID-MU-005" "audio hash dropped from the call ('none') → VID-MU-005"
TE=$(( $(now) - 901 )); want "$(err "$(m5 $NEIL $V 1 $H1 $TE "$(sign $K1 $LANE $V 1 $H1 true $H1 $TE)")" 'VID-MU-006')" "VID-MU-006" "expired: correctly signed 15 min 1 s ago → VID-MU-006"
TF2=$(( $(now) + 120 )); want "$(err "$(m5 $NEIL $V 1 $H1 $TF2 "$(sign $K1 $LANE $V 1 $H1 true $H1 $TF2)")" 'VID-MU-006')" "VID-MU-006" "dated 2 min ahead → VID-MU-006"
want "$(err "$(m5 $RIYA $V 1 $H1 $T $G)" 'VID-MU-001')" "VID-MU-001" "replay by another member: Riya sends Neil's valid attestation → VID-MU-001"
want "$(err "$(as anon '' "SELECT public.video_mark_uploaded('$V', 1, '$H1', $T, '$G')")" 'permission denied')" "permission denied" "anon cannot call it at all"
want "$(err "$(as authenticated $NEIL "SELECT public.video_attest_verify('$V', 1, '$H1', $T, '$G')")" 'permission denied')|$(err "$(as service_role '' "SELECT public.video_attest_verify('$V', 1, '$H1', $T, '$G')")" 'permission denied')|$(err "$(as authenticated $NEIL "SELECT public.video_attest_lane()")" 'permission denied')" "permission denied|permission denied|permission denied" "the check and the lane function are internal (member and service_role refused)"
want "$(untouched $V)" "uploading:0:true" "after every refusal above: V still uploading, no check row, uploaded_at unset"

step "$LANE · 6 · the real path: complete's attestation is accepted (switch Off as shipped)"
TA=$(( $(now) - 880 ))
want "$(m5 $NEIL $V 1 $H1 $TA "$(sign $K1 $LANE $V 1 $H1 true $H1 $TA)" music_check)|$(state $V)" "off|ready" "signed 14 min 40 s ago (inside 15 min) → ready, music check off"
want "$(q "SELECT audio_sha256 = '$H1' FROM public.video_versions WHERE video_id = '$V'")" "t" "the attested audio hash is the one stored"
want "$(ok $NEIL $V 1 $H1 true $H1 $K1 replayed)" "true" "outbox retry with a fresh attestation → replayed, nothing changes"
want "$(err "$(m5 $NEIL $V 1 $H1 $(now) NULL)" 'VID-MU-005')" "VID-MU-005" "a replay WITHOUT an attestation → VID-MU-005 (checked before the replay answer)"
S=$(up $NEIL 20 no); want "$(ok $NEIL $S 1 $H1 false none)" "ready" "a silent video, signed with audio 'none' → ready"
want "$(ok $RIYA $W 1 $H1 true $H1 2>/dev/null | grep -o 'VID-MU-001')" "VID-MU-001" "Riya signing for Neil's W with the real key still → VID-MU-001 (owner first)"

step "$LANE · 7 · key rotation: current + previous accepted; a bad previous is never trusted"
setkeys $K2 $K1
R1=$(up $ARUN 30); R2=$(up $ARUN 30)
want "$(ok $ARUN $R1 1 $H1 true $H1 $K1)|$(ok $ARUN $R2 1 $H1 true $H1 $K2)" "ready|ready" "after rotation: signed with the previous key → ready; with the new key → ready"
probe_is pass "rotated keys" "$PROBE" "VID-2A"
setkeys $K2 $K2; R3=$(up $ARUN 30)
want "$(err "$(ok $ARUN $R3 1 $H1 true $H1 $K1)" 'VID-MU-005')|$(ok $ARUN $R3 1 $H1 true $H1 $K2)" "VID-MU-005|ready" "previous = current: K1 is dead, only K2 works"
setkeys $K2 $KS; R4=$(up $ARUN 30)
want "$(err "$(ok $ARUN $R4 1 $H1 true $H1 $KS)" 'VID-MU-005')" "VID-MU-005" "a previous key under 32 characters is ignored, never trusted"
setkeys $K1

step "$LANE · 8 · remedies pass the same gate (music check On for Neil, a match, then mute → v2)"
q "SELECT vault.create_secret('fixture-not-a-key-0000', 'music_check_api_key')" >/dev/null
as authenticated $ADMIN "SELECT public.feature_set_mode('copyright_music_check','selected')" >/dev/null
as authenticated $ADMIN "SELECT public.feature_add_member('copyright_music_check','$NEIL','fixture')" >/dev/null
N=$(up $NEIL 30)
want "$(ok $NEIL $N 1 $H1 true $H1 $K1 music_check)" "on" "On for Neil: attested completion → checking, queued"
as service_role '' "SELECT public.music_check_record_result('$(latest $N)', 'match', '$H1', 30, '[{\"title\":\"Hit\",\"fingerprint_id\":\"fp-hit\"}]', 'fixture')" >/dev/null
want "$(state $N)" "music_blocked" "the worker reports a match → music_blocked"
want "$(as authenticated $NEIL "SELECT public.video_new_version('$N', 'mute', '$H2', $(tot 30 no), 30, false, '$(rb 30 no)', NULL, NULL)->>'state'")" "uploading" "the mute remedy makes v2 (manifest H2, no audio) → uploading"
want "$(err "$(ok $NEIL $N 1 $H1 true $H1)" 'VID-MU-002')" "VID-MU-002" "v1's call on a v2 video → VID-MU-002"
T=$(now); want "$(err "$(m5 $NEIL $N 2 none $T "$(sign $K1 $LANE $N 2 $H1 false none $T)")" 'VID-MU-005')" "VID-MU-005" "v2 signed over v1's manifest → VID-MU-005"
want "$(ok $NEIL $N 2 $H2 false none)|$(state $N)" "checking|checking" "v2 signed over v2's stored row → checking (checked again)"

step "$LANE · 9 · SEC-VID-4: ad_videos — one read path; admin writes unchanged; members refused"
A=$(up $ADMIN 30 yes ad); want "$(ok $ADMIN $A 1 $H1 true $H1)" "ready" "admin ad video, attested → ready"
AD=$(q "INSERT INTO public.ad_creatives (headline) VALUES ('ad') RETURNING id" | head -1)
want "$(err "$(as authenticated $NEIL "INSERT INTO public.ad_videos VALUES ('$AD', '$A', '{street}')")" 'row-level security')" "row-level security" "a member inserting → refused (RLS)"
as authenticated $ADMIN "SELECT public.feature_set_mode('video_ads','off')" >/dev/null
want "$(err "$(as authenticated $ADMIN "INSERT INTO public.ad_videos VALUES ('$AD', '$A', '{street}')")" 'row-level security')" "row-level security" "video_ads Off → the admin cannot attach (INSERT WITH CHECK)"
as authenticated $ADMIN "SELECT public.feature_set_mode('video_ads','everyone')" >/dev/null
want "$(as authenticated $ADMIN "INSERT INTO public.ad_videos VALUES ('$AD', '$A', '{street}') RETURNING 'linked'")" "linked" "admin, switch on → linked"
want "$(as authenticated $NEIL "WITH u AS (UPDATE public.ad_videos SET categories = '{night}' WHERE ad_creative_id = '$AD' RETURNING 1) SELECT count(*) FROM u")|$(as authenticated $NEIL "WITH d AS (DELETE FROM public.ad_videos WHERE ad_creative_id = '$AD' RETURNING 1) SELECT count(*) FROM d")" "0|0" "a member's UPDATE and DELETE touch 0 rows"
want "$(as authenticated $ADMIN "UPDATE public.ad_videos SET categories = '{night}' WHERE ad_creative_id = '$AD' RETURNING array_to_string(categories, ',')")" "night" "admin UPDATE (switch on) → night"
as authenticated $ADMIN "SELECT public.feature_set_mode('video_ads','off')" >/dev/null
want "$(err "$(as authenticated $ADMIN "UPDATE public.ad_videos SET categories = '{street}' WHERE ad_creative_id = '$AD'")" 'row-level security')" "row-level security" "admin UPDATE with video_ads Off → refused (UPDATE WITH CHECK, as before)"
as authenticated $ADMIN "SELECT public.feature_set_mode('video_ads','everyone')" >/dev/null
q "UPDATE public.ad_creatives SET is_active = false WHERE id = '$AD'" >/dev/null
want "$(as authenticated $ADMIN "SELECT count(*) FROM public.ad_videos WHERE ad_creative_id = '$AD'")|$(as authenticated $NEIL "SELECT count(*) FROM public.ad_videos WHERE ad_creative_id = '$AD'")|$(as anon '' "SELECT count(*) FROM public.ad_videos WHERE ad_creative_id = '$AD'")" "1|0|0" "inactive creative: the admin still reads its video ad (unchanged); Neil and anon do not"
as authenticated $ADMIN "SELECT public.feature_set_mode('video_ads','off')" >/dev/null
want "$(as authenticated $ADMIN "WITH d AS (DELETE FROM public.ad_videos WHERE ad_creative_id = '$AD' RETURNING 1) SELECT count(*) FROM d")" "1" "admin DELETE works even with video_ads Off (clean-up, as before)"
as authenticated $ADMIN "SELECT public.feature_set_mode('video_ads','everyone')" >/dev/null

step "$LANE · 10 · mutants — each one must turn the PROBE red (and the first proves the test could fail)"
q "CREATE TABLE IF NOT EXISTS public._mut_save AS SELECT pg_get_functiondef('public.video_mark_uploaded(uuid,integer,text,bigint,text)'::regprocedure) AS d" >/dev/null
q "DO \$m\$ BEGIN EXECUTE replace((SELECT d FROM public._mut_save), 'PERFORM public.video_attest_verify(_video_id, _version_no, _audio_sha256, _issued_at, _attest);', 'NULL;'); END \$m\$" >/dev/null
MV=$(up $MIRA 30); want "$(m5 $MIRA $MV 1 $H3 NULL NULL)" "ready" "mutant 1 (verify removed): an unattested call publishes again — the hole the tests guard"
probe_is fail "mutant 1: verify removed" "$PROBE" "VID-2A" "A1 video_mark_uploaded does not check"
q "DO \$m\$ BEGIN EXECUTE (SELECT d FROM public._mut_save); END \$m\$; DROP TABLE public._mut_save" >/dev/null
q "CREATE FUNCTION public.video_mark_uploaded(_v uuid, _n integer, _a text) RETURNS jsonb LANGUAGE sql AS \$f\$ SELECT '{}'::jsonb \$f\$" >/dev/null
probe_is fail "mutant 2: a 3-argument form is back" "$PROBE" "VID-2A" "A1 an unattested"
q "DROP FUNCTION public.video_mark_uploaded(uuid, integer, text)" >/dev/null
q "GRANT EXECUTE ON FUNCTION public.video_attest_verify(uuid,integer,text,bigint,text) TO authenticated" >/dev/null
probe_is fail "mutant 3: the check granted to authenticated" "$PROBE" "VID-2A" "A2 the attestation check is reachable"
q "REVOKE EXECUTE ON FUNCTION public.video_attest_verify(uuid,integer,text,bigint,text) FROM authenticated" >/dev/null
probe_lane $OL "A2 the lane fixed into the attestation"
q "SELECT vault.create_secret('$K1', 'media_token_key_mirror')" >/dev/null
probe_is fail "mutant 5: the attest key reused as another secret" "$PROBE" "VID-2A" "A4 the attest key has the same value"
q "DELETE FROM vault.secrets WHERE name = 'media_token_key_mirror'" >/dev/null
q "CREATE POLICY mut_admin_all ON public.ad_videos FOR ALL TO authenticated USING (true)" >/dev/null
probe_is fail "mutant 6: a second SELECT path on ad_videos" "$PROBE" "VID-2A" "A5 ad_videos has 2"
q "DROP POLICY mut_admin_all ON public.ad_videos" >/dev/null
setkeys
probe_is fail "mutant 7: key removed while switches are on" "$PROBE" "VID-2A" "A3 a video switch is not Off"
setkeys $K1
probe_is pass "every mutant undone" "$PROBE" "VID-2A"

step "$LANE · 11 · rollback (reopens F-D1-4, says so), the 0006 rollback after it, and re-apply"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'ROLLBACK REFUSED' && echo "  PASS  rollback with no lane asserted — refused" || { echo "  FAIL  rollback lane guard"; fail=1; }
run $LANE "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback — $(echo "$out" | grep -o 'VID2-0007 rolled back.*' | head -1)" || { echo "  FAIL  rollback"; echo "$out" | grep ERROR | head -3; fail=1; }
want "$(q "SELECT to_regprocedure('public.video_mark_uploaded(uuid,integer,text)') IS NOT NULL")|$(q "SELECT count(*) FROM pg_policy WHERE polrelid='public.ad_videos'::regclass AND polname='ad_videos_admin_write' AND polcmd='*'")|$(selpaths)" "t|1|2" "0006's function and 0005's FOR ALL policy are back"
probe_is fail "after rollback" "$PROBE" "VID-2A" "A1 the upload attestation"
probe_is pass "PROBE_vid4 still passes on the 3-argument form" "$PROBE4" "VID-4"
run $LANE "$RB"; [ $rc -ne 0 ] && echo "$out" | grep -q 'VID2-0007-RB-001' && echo "  PASS  a second rollback is refused (RB-001)" || { echo "  FAIL  second rollback"; fail=1; }
run $LANE "$MIG"; [ $rc -eq 0 ] && echo "  PASS  re-applied" || { echo "  FAIL  re-apply"; echo "$out" | grep ERROR | head -3; fail=1; }
probe_is pass "re-applied" "$PROBE" "VID-2A"
X=$(up $RIYA 30); want "$(ok $RIYA $X 1 $H1 true $H1)" "ready" "after re-apply: Riya's attested completion → ready"
run $LANE "$RB6"; [ $rc -ne 0 ] && echo "  PASS  0006's rollback refuses while 0007 is applied (F-D1-7: roll back 0007 first) — $(echo "$out" | grep -o 'VID4-0006[^ ]*' | head -1)" || { echo "  FAIL  0006 rollback should refuse"; fail=1; }
done

step "RESULT"
[ $fail -eq 0 ] && echo "ALL CASES PASS (staging shape + production shape)" || echo "SOME CASES FAILED"
exit $fail
