#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# VID-4 copyright music check (20261005_0006) · C-34 harness, staging shape AND
# production shape. Acts as the API roles (SET ROLE + JWT sub) and as the
# worker (service_role), the way PostgREST does. Every apply / rollback / probe
# runs through apply-migration.yml's extracted "Run it" step.
#                        PGPORT=5433 bash docs/evidence/d1/VID/vid4-run-tests.sh
# The music-check worker (Edge Function, vendor adapter) is not built yet
# (vendor not chosen): here service_role plays it, calling the same RPCs.
# ═══════════════════════════════════════════════════════════════════════════
set -u
source "$(cd "$(dirname "$0")" && pwd)/vid-lib.sh"
M4="$ROOT/supabase/migrations/20261005_0004_vid7_feature_access.sql"
M5="$ROOT/supabase/migrations/20261005_0005_vid2_videos.sql"
RB5="$ROOT/supabase/rollback/20261005_0005_vid2_videos_ROLLBACK.sql"
MIG="$ROOT/supabase/migrations/20261005_0006_vid4_music_check.sql"
RB="$ROOT/supabase/rollback/20261005_0006_vid4_music_check_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_vid4_music_check.sql"
H1=$(printf 'a%.0s' {1..64}); H2=$(printf 'b%.0s' {1..64}); H3=$(printf 'd%.0s' {1..64})
uuid() { cat /proc/sys/kernel/random/uuid; }
rb() { local a=""; [ "${2:-yes}" = yes ] && a=", \"audio\": $(( $1 * 10000 ))"; echo "{\"240p\": $(( $1 * 50000 ))$a, \"other\": 50000}"; }
tot() { local t=$(( $1 * 50000 + 50000 )); [ "${2:-yes}" = yes ] && t=$(( t + $1 * 10000 )); echo $t; }
TF() { [ "$1" = yes ] && echo true || echo false; }
# up <uid> <seconds> [audio yes|no] [purpose] → new video id
up() { as authenticated "$1" "SELECT public.video_begin_upload('${4:-post}', '$H1', $(tot $2 ${3:-yes}), $2, $(TF ${3:-yes}), '$(uuid)', '$(rb $2 ${3:-yes})')->>'video_id'"; }
# mark <uid> <video> [version] [hash] [field] → video_mark_uploaded(...)->>field
mark() { local h=NULL; [ -n "${4:-}" ] && h="'$4'"; as authenticated "$1" "SELECT public.video_mark_uploaded('$2', ${3:-1}, $h)->>'${5:-state}'"; }
latest() { q "SELECT id FROM public.video_music_checks WHERE video_id = '$1' ORDER BY version_no DESC, attempt DESC LIMIT 1"; }
# res <check> <verdict> <hash|NULL> <measured|NULL> <matches json|NULL> [field] → worker (service_role) result
res() { local h=NULL m=NULL; [ "$3" != NULL ] && h="'$3'"; [ "$5" != NULL ] && m="'$5'"; as service_role '' "SELECT public.music_check_record_result('$1', '$2', $h, $4, $m, 'fixture')->>'${6:-state}'"; }
state() { q "SELECT state FROM public.videos WHERE id = '$1'"; }
due() { as service_role '' "SELECT count(*) FROM public.music_check_due(500) WHERE video_id = '$1'"; }
post() { q "INSERT INTO public.posts (user_id, content, categories) VALUES ('$1', 'p', '{street}') RETURNING id" | head -1; }
link() { as authenticated "$1" "INSERT INTO public.post_videos VALUES ('$2', '$3') RETURNING 'linked'"; }
NV() { as authenticated "$1" "SELECT public.video_new_version('$2', '$3', '$H2', $(tot $4 $5), $4, $(TF $5), '$(rb $4 $5)', ${6:-NULL}, ${7:-NULL})->>'${8:-state}'"; }

for LANE in staging production; do
step "$LANE · 0 · fixture + 0004 (switches) + 0005 (videos); video_posts on for All members"
fixture $LANE
run $LANE "$M4"; r4=$rc; run $LANE "$M5"; [ $r4 -eq 0 ] && [ $rc -eq 0 ] && echo "  PASS  0004 + 0005 applied" || { echo "  FAIL  0004/0005"; fail=1; }
as authenticated $ADMIN "SELECT public.feature_set_mode('video_posts','everyone')" >/dev/null

step "$LANE · 1 · fail first: no music check — an uploaded video can never leave 'uploading'"
probe_is fail "before 0006" "$PROBE" "VID-4" "M1 the music check is not installed"
V=$(up $NEIL 30); want "$(err "$(mark $NEIL $V 1 $H1)" 'does not exist')|$(state $V)" "does not exist|uploading" "video_mark_uploaded does not exist; the video stays uploading"

step "$LANE · 2 · apply 20261005_0006 (lane $LANE) and probe"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$MIG" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'APPLY REFUSED' && echo "  PASS  apply with no lane — refused" || { echo "  FAIL  apply lane guard"; fail=1; }
run $LANE "$MIG"; [ $rc -eq 0 ] && echo "  PASS  apply — $(echo "$out" | grep -o 'VID4-0006: .*' | head -1)" || { echo "  FAIL  apply"; echo "$out" | grep -E 'ERROR|LINE' | head -4; fail=1; }
probe_is pass "after 0006" "$PROBE" "VID-4"
run $LANE "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'VID4-0006-PRE-002' && echo "  PASS  a second apply is refused (PRE-002)" || { echo "  FAIL  second apply"; fail=1; }

step "$LANE · 3 · copyright_music_check OFF (as shipped): any audio publishes, the hash is stored anyway"
want "$(err "$(mark $RIYA $V 1 $H1)" 'VID-MU-001')|$(err "$(mark $NEIL $V 2 $H1)" 'VID-MU-002')|$(err "$(as anon '' "SELECT public.video_mark_uploaded('$V', 1)")" 'permission denied')" "VID-MU-001|VID-MU-002|permission denied" "only the owner, only the current version, never anon"
want "$(err "$(mark $NEIL $V 1 not-a-hash)" 'VID-MU-003')" "VID-MU-003" "a malformed hash → VID-MU-003"
want "$(mark $NEIL $V 1 $H1 music_check)|$(state $V)" "off|ready" "Neil, switch Off, audio + hash → ready in the same call"
want "$(q "SELECT verdict || ':' || mode_at_check || ':' || (audio_sha256 = '$H1')::text FROM public.video_music_checks WHERE video_id = '$V'")|$(q "SELECT audio_sha256 = '$H1' FROM public.video_versions WHERE video_id = '$V'")" "not_required:off:true|t" "a not_required check (mode off) carrying the audio hash; the version stores it"
want "$(mark $NEIL $V 1 $H1 replayed)" "true" "the outbox retrying the call → replayed, nothing changes"
want "$(link $NEIL $(post $NEIL) $V)" "linked" "the ready video goes into Neil's post"
S=$(up $NEIL 20 no); want "$(mark $NEIL $S)|$(q "SELECT audio_sha256 IS NULL FROM public.video_music_checks WHERE video_id = '$S'")" "ready|t" "a silent video → ready, no hash"
P=$(up $NEIL 20); want "$(mark $NEIL $P 1 '' music_check)|$(state $P)|$(due $P)" "off|checking|1" "audio but no hash handed in → checking, queued for the worker to hash (mode off)"
want "$(err "$(res $(latest $P) clean $H2 20 NULL)" 'VID-MC-002')" "VID-MC-002" "the worker cannot JUDGE an off check (clean → VID-MC-002)"
want "$(res $(latest $P) not_required $H2 20 NULL)|$(q "SELECT audio_sha256 = '$H2' FROM public.video_versions WHERE video_id = '$P'")" "ready|t" "the worker hashes the served bytes → not_required → ready, hash stored"
want "$(err "$(as authenticated $NEIL "SELECT public.music_check_record_result('$(latest $P)', 'clean', '$H1', 20, NULL, 'x')")" 'permission denied')|$(err "$(as authenticated $ADMIN "SELECT count(*) FROM public.music_check_due()")" 'permission denied')" "permission denied|permission denied" "members and admins cannot play the worker"

step "$LANE · 4 · the switch refuses ON while the music-API key is missing (VID-7 / R-102)"
want "$(err "$(as authenticated $ADMIN "SELECT public.feature_set_mode('copyright_music_check','selected')")" 'FEATURE-003')|$(err "$(as authenticated $ADMIN "SELECT public.feature_set_mode('copyright_music_check','everyone')")" 'FEATURE-003')" "FEATURE-003|FEATURE-003" "Selected / All members without the key → FEATURE-003"
q "SELECT vault.create_secret('fixture-not-a-key-0000', 'music_check_api_key')" >/dev/null
want "$(as authenticated $ADMIN "SELECT public.feature_set_mode('copyright_music_check','selected')")|$(as authenticated $ADMIN "SELECT public.feature_add_member('copyright_music_check','$NEIL','R-103 example')")" "selected|t" "key present → Selected members: Neil Basu"

step "$LANE · 5 · ON for Neil: checked before publish; a match blocks; Riya (not listed) still publishes"
N=$(up $NEIL 30); want "$(mark $NEIL $N 1 $H1 music_check)|$(state $N)|$(q "SELECT audio_sha256 IS NULL FROM public.video_versions WHERE video_id = '$N'")|$(due $N)" "on|checking|t|1" "Neil → checking, queued; the client's hash is NOT trusted for an on check"
R=$(up $RIYA 30); want "$(mark $RIYA $R 1 $H1 music_check)|$(state $R)" "off|ready" "Riya, same moment → off → ready"
want "$(err "$(res $(latest $N) not_required $H1 30 NULL)" 'VID-MC-002')" "VID-MC-002" "the worker cannot wave an on check through (not_required → VID-MC-002)"
want "$(err "$(as service_role '' "UPDATE public.videos SET state = 'ready' WHERE id = '$N'")" 'VID-GATE-00[0-9]')" "VID-GATE-001" "service_role forcing ready → VID-GATE-001"
want "$(err "$(res $(latest $N) match $H1 30 NULL)" 'VID-MC-004')" "VID-MC-004" "a match with no matches listed → VID-MC-004"
want "$(res $(latest $N) match $H1 30 '[{"title":"Hit","artist":"Band","score":92,"begin_ms":1000,"end_ms":9000,"fingerprint_id":"fp-hit"}]')|$(due $N)" "music_blocked|0" "match → music_blocked, out of the queue"
want "$(err "$(link $NEIL $(post $NEIL) $N)" 'VID-LINK-001')" "VID-LINK-001" "a blocked video cannot go into a post"
want "$(as authenticated $NEIL "SELECT matches->0->>'title' || ' / ' || (matches->0->>'begin_ms') FROM public.video_music_checks WHERE video_id = '$N' AND verdict = 'match'")|$(as authenticated $RIYA "SELECT count(*) FROM public.video_music_checks WHERE video_id = '$N'")" "Hit / 1000|0" "Neil reads the matched title and range for the blocked screen; Riya sees nothing"

step "$LANE · 6 · remedies make a new version, and every version is checked again"
want "$(err "$(NV $RIYA $N mute 30 no)" 'VID-NV-001')|$(err "$(NV $NEIL $R mute 30 no)" 'VID-NV-001')" "VID-NV-001|VID-NV-001" "only the owner, only a blocked video"
want "$(err "$(NV $NEIL $N original 30 yes)" 'VID-NV-002')|$(err "$(NV $NEIL $N mute 30 yes)" 'VID-NV-002')" "VID-NV-002|VID-NV-002" "remedy 'original' and a muted version WITH audio → VID-NV-002"
want "$(err "$(NV $NEIL $N mute 181 no)" 'VID-LIM-001')" "VID-LIM-001" "the size rules apply to a new version too (3:01 → VID-LIM-001)"
n0=$(q "SELECT count(*) FROM public.videos WHERE owner_id = '$NEIL'")
want "$(NV $NEIL $N mute 30 no)|$(q "SELECT current_version || ':' || (music_check_id IS NULL)::text FROM public.videos WHERE id = '$N'")|$(q "SELECT count(*) FROM public.videos WHERE owner_id = '$NEIL'")" "uploading|2:true|$n0" "Remove sound → v2 uploading (not a new upload)"
want "$(mark $NEIL $N 2 '' music_check)|$(err "$(res $(latest $N) clean_no_audio $H1 NULL NULL)" 'VID-MC-003')" "on|VID-MC-003" "v2 checked again (on); a hash for a silent version → VID-MC-003"
want "$(res $(latest $N) clean_no_audio NULL NULL NULL)|$(link $NEIL $(post $NEIL) $N)" "ready|linked" "clean_no_audio → ready → linked"
T=$(up $NEIL 30); mark $NEIL $T >/dev/null
res $(latest $T) match $H1 30 '[{"title":"Hit","fingerprint_id":"fp-hit"}]' >/dev/null
want "$(err "$(as authenticated $NEIL "SELECT public.music_library_add('Calm','Lib',60,'lib/calm.m4a','CC0','https://example.invalid/cc0','none','fixture')")" 'VID-LIB-001')" "VID-LIB-001" "a member cannot add library tracks"
want "$(err "$(as authenticated $ADMIN "SELECT public.music_library_add('Calm','Lib',60,'lib/calm.m4a','CC0','http://x','none','fixture')")" 'VID-LIB-002')" "VID-LIB-002" "a licence URL that is not https → VID-LIB-002"
L=$(as authenticated $ADMIN "SELECT public.music_library_add('Calm','Lib',60,'lib/calm.m4a','CC0','https://example.invalid/cc0','none','fixture','first track')")
want "$(err "$(as authenticated $ADMIN "SELECT public.music_library_set_active('$L', true)")" 'VID-LIB-003')" "VID-LIB-003" "a track is added inactive and cannot go live before it is fingerprinted"
want "$(as service_role '' "SELECT public.music_library_set_fingerprints('$L', ARRAY['fp-lib-1'])")|$(as authenticated $ADMIN "SELECT public.music_library_set_active('$L', true)")|$(q "SELECT string_agg(action, ',' ORDER BY id) FROM public.music_library_audit")" "1|t|add,fingerprints,activate" "fingerprinted by the worker, activated by the admin — all three audited"
want "$(err "$(NV $NEIL $T library_track 30 yes "'$(uuid)'")" 'VID-NV-003')" "VID-NV-003" "an unknown library track → VID-NV-003"
want "$(NV $NEIL $T library_track 30 yes "'$L'")|$(mark $NEIL $T 2)" "uploading|checking" "Replace with a free track → v2, checked"
want "$(err "$(res $(latest $T) clean_library $H3 30 '[{"title":"Calm","fingerprint_id":"fp-lib-1"},{"title":"Hit","fingerprint_id":"fp-hit"}]')" 'VID-MC-005')" "VID-MC-005" "library track + leftover music claimed clean_library → VID-MC-005 (it is a match)"
want "$(res $(latest $T) clean_library $H3 30 '[{"title":"Calm","fingerprint_id":"fp-lib-1"}]')" "ready" "only the library track heard → clean_library → ready"
TR=$(up $NEIL 30); mark $NEIL $TR >/dev/null; res $(latest $TR) match $H1 30 '[{"title":"Hit","fingerprint_id":"fp-hit","begin_ms":0,"end_ms":5000}]' >/dev/null
want "$(err "$(NV $NEIL $TR trim 25 yes NULL "'[{\"start_ms\": 5000, \"end_ms\": 0}]'")" 'VID-NV-004')|$(err "$(NV $NEIL $TR trim 2 yes NULL "'[{\"start_ms\": 0, \"end_ms\": 5000}]'")" 'VID-NV-004')" "VID-NV-004|VID-NV-004" "a reversed cut, or under 3 s left → VID-NV-004"
want "$(NV $NEIL $TR trim 25 yes NULL "'[{\"start_ms\": 0, \"end_ms\": 5500}]'")|$(mark $NEIL $TR 2)|$(res $(latest $TR) match $H2 25 '[{"title":"Hit","fingerprint_id":"fp-hit","begin_ms":20000,"end_ms":24000}]')" "uploading|checking|music_blocked" "Trim the matched part → v2 checked; leftover music blocks again with the new range"

step "$LANE · 7 · music API down: stays 'checking', retried 1 → 2 → 5 → 15 → 30 min, never published unchecked"
want "$(q "SELECT string_agg(extract(epoch FROM public.music_check_retry_after(n))::int / 60 || '', ',' ORDER BY n) FROM generate_series(1, 7) n")" "1,2,5,15,30,30,30" "the schedule: 1, 2, 5, 15, 30 min, then every 30 min"
D=$(up $NEIL 30); mark $NEIL $D >/dev/null
for i in 1 2 3; do r=$(res $(latest $D) error NULL NULL NULL); want "$r|$(q "SELECT round(extract(epoch FROM next_retry_at - checked_at) / 60) FROM public.video_music_checks WHERE id = '$(latest $D)'")|$(due $D)" "checking|$(echo '1 2 5' | cut -d' ' -f$i)|0" "provider error $i → still checking, retry in $(echo '1 2 5' | cut -d' ' -f$i) min, not due before then"; done
want "$(err "$(as service_role '' "UPDATE public.videos SET state = 'ready', music_check_id = '$(latest $D)' WHERE id = '$D'")" 'VID-GATE-002')" "VID-GATE-002" "forcing an error row through the gate → VID-GATE-002"
q "INSERT INTO public.video_music_checks (video_id, version_no, provider, attempt, verdict, mode_at_check, next_retry_at, checked_at) VALUES ('$D', 1, 'fixture', 5, 'error', 'on', now() - interval '1 second', now() - interval '5 minutes')" >/dev/null
want "$(due $D)" "1" "…its retry time reached (5 min later) → due again"
want "$(res $(latest $D) clean $H1 30 NULL)|$(q "SELECT count(*) FILTER (WHERE verdict = 'error') || ' errors, attempt ' || max(attempt) FROM public.video_music_checks WHERE video_id = '$D'")" "ready|4 errors, attempt 6" "the API is back: clean → ready (4 error rows kept)"
want "$(err "$(res $(latest $D) clean $H1 30 NULL)" 'VID-MC-001')" "VID-MC-001" "a late duplicate result for a video no longer checking → VID-MC-001 (stale)"
O=$(up $NEIL 30); mark $NEIL $O >/dev/null
q "INSERT INTO public.video_music_checks (video_id, version_no, provider, attempt, verdict, mode_at_check, next_retry_at, checked_at) VALUES ('$O', 1, 'fixture', 2, 'error', 'on', now() + interval '30 minutes', now() - interval '7 hours')" >/dev/null
want "$(as service_role '' "SELECT count(*) FROM public.music_check_overdue() WHERE video_id = '$O'")|$(as service_role '' "SELECT count(*) FROM public.music_check_overdue() WHERE video_id = '$D'")" "1|0" "checking for 7 h → on the 6-hour alert list (VID-6); the published one is not"
want "$(err "$(res $(q "SELECT id FROM public.video_music_checks WHERE video_id = '$O' AND attempt = 1") clean $H1 30 NULL)" 'VID-MC-001')" "VID-MC-001" "a result for an OLDER attempt → VID-MC-001"

step "$LANE · 8 · the key goes missing while ON: Neil's new video waits in 'checking', never published"
q "DELETE FROM vault.secrets WHERE name = 'music_check_api_key'" >/dev/null
K=$(up $NEIL 30)
want "$(mark $NEIL $K 1 $H1 music_check)|$(state $K)" "on|checking" "Neil uploads → checking (on), not ready"
want "$(err "$(res $(latest $K) not_required $H1 30 NULL)" 'VID-MC-002')|$(res $(latest $K) error NULL NULL NULL)" "VID-MC-002|checking" "the worker (no key) cannot wave it through; it can only record an error and retry"
probe_is pass "the PROBE still passes (M3/M4 hold)" "$PROBE" "VID-4"
q "SELECT vault.create_secret('fixture-not-a-key-0000', 'music_check_api_key')" >/dev/null

step "$LANE · 9 · R-82 scale: 20 000 videos waiting in 'checking' among 220 000"
q "INSERT INTO auth.users SELECT ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'm' || g || '@example.invalid' FROM generate_series(1, 2000) g;
   INSERT INTO public.profiles (id, full_name) SELECT id, 'member' FROM auth.users WHERE email ~ '^m[0-9]';
   INSERT INTO public.videos (owner_id, purpose, idempotency_key) SELECT ('00000000-0000-0000-0001-' || lpad((1 + g % 2000)::text, 12, '0'))::uuid, 'post', gen_random_uuid() FROM generate_series(1, 220000) g;
   INSERT INTO public.video_versions (video_id, version_no, manifest_sha256, total_bytes, declared_duration_s, has_audio, rendition_bytes, renditions)
     SELECT id, 1, '$H1', 1, 30, true, '{}', '{}' FROM public.videos WHERE owner_id::text LIKE '00000000-0000-0000-0001-%'" >/dev/null
timetravel() { q "ALTER TABLE public.videos DISABLE TRIGGER tg_videos_state_guard; $1; ALTER TABLE public.videos ENABLE TRIGGER tg_videos_state_guard" >/dev/null; }
timetravel "UPDATE public.videos SET state = CASE WHEN random() < 0.0909 THEN 'checking' ELSE 'failed' END WHERE owner_id::text LIKE '00000000-0000-0000-0001-%'"
q "INSERT INTO public.video_music_checks (video_id, version_no, provider, attempt, verdict, mode_at_check, checked_at) SELECT id, 1, 'queue', 1, 'pending', 'on', now() - random() * interval '1 hour' FROM public.videos WHERE state = 'checking' AND owner_id::text LIKE '00000000-0000-0000-0001-%'; ANALYZE public.videos; ANALYZE public.video_music_checks" >/dev/null
nck=$(q "SELECT count(*) FROM public.videos WHERE state = 'checking'")
t0=$(date +%s%N); r=$(as service_role '' "SELECT count(*) FROM public.music_check_due(50)"); t1=$(date +%s%N)
want "$r|$(( (t1 - t0) / 1000000 < 2000 ))" "50|1" "music_check_due(50) with $nck checking: $(( (t1 - t0) / 1000000 )) ms (< 2 s)"
t0=$(date +%s%N); as service_role '' "SELECT count(*) FROM public.music_check_overdue()" >/dev/null; t1=$(date +%s%N)
want "$(( (t1 - t0) / 1000000 < 3000 ))" "1" "music_check_overdue() over the same: $(( (t1 - t0) / 1000000 )) ms (< 3 s)"
q "SET vid.purge = 'on'; DELETE FROM public.videos WHERE owner_id::text LIKE '00000000-0000-0000-0001-%'; DELETE FROM auth.users WHERE email ~ '^m[0-9]'" >/dev/null

step "$LANE · 10 · the PROBE catches each regression (mutants, each undone)"
mut() { q "$1" >/dev/null; probe_is fail "$3" "$PROBE" "VID-4" "$2"; q "$4" >/dev/null; }
mut "GRANT EXECUTE ON FUNCTION public.music_check_record_result(uuid,text,text,numeric,jsonb,text) TO authenticated" "M2 a worker function" "members can post verdicts" "REVOKE EXECUTE ON FUNCTION public.music_check_record_result(uuid,text,text,numeric,jsonb,text) FROM authenticated"
mut "ALTER TABLE public.music_library_audit DISABLE TRIGGER tg_music_library_audit_append_only" "M2 music_library_audit" "the library audit editable" "ALTER TABLE public.music_library_audit ENABLE TRIGGER tg_music_library_audit_append_only"
mut "INSERT INTO public.video_music_checks (video_id, version_no, provider, attempt, verdict, mode_at_check) VALUES ('$K', 1, 'rogue', 99, 'not_required', 'on')" "M3 1 check(s) closed against their mode" "an on check closed as not_required (live data)" "SET vid.purge = 'on'; DELETE FROM public.video_music_checks WHERE provider = 'rogue'"
mut "INSERT INTO public.video_music_checks (video_id, version_no, provider, attempt, verdict, mode_at_check) VALUES ('$K', 1, 'rogue', 99, 'error', 'on')" "M4 1 error row(s) without a retry time" "an error that will never be retried" "SET vid.purge = 'on'; DELETE FROM public.video_music_checks WHERE provider = 'rogue'"
mut "UPDATE public.music_library_tracks SET active = true, provider_fingerprint_ids = '{}' WHERE id = '$L'" "M5 1 active library track" "a library track live without a fingerprint" "UPDATE public.music_library_tracks SET provider_fingerprint_ids = '{fp-lib-1}' WHERE id = '$L'"
probe_is pass "every mutant undone" "$PROBE" "VID-4"

step "$LANE · 11 · rollback order and keep: 0005 refuses while 0006 is on; 0006 rollback keeps every video and check"
run $LANE "$RB5"; [ $rc -ne 0 ] && echo "$out" | grep -q 'VID2-0005-RB-PRE-002' && echo "  PASS  0005 rollback refused while 0006 is applied (RB-PRE-002)" || { echo "  FAIL  0005 rollback order"; fail=1; }
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'ROLLBACK REFUSED' && echo "  PASS  rollback with no lane — refused" || { echo "  FAIL  rollback lane guard"; fail=1; }
c0="$(q "SELECT count(*) FROM public.videos")/$(q "SELECT count(*) FROM public.video_music_checks")/$(q "SELECT count(*) FROM public.music_library_audit")"
run $LANE "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback (lane $LANE)" || { echo "  FAIL  rollback"; echo "$out" | grep ERROR | head -3; fail=1; }
want "$(q "SELECT to_regprocedure('public.video_mark_uploaded(uuid,integer,text)') IS NULL")|$(q "SELECT count(*) FROM public.videos")/$(q "SELECT count(*) FROM public.video_music_checks")/$(q "SELECT count(*) FROM public.music_library_audit")|$(state $K)" "t|$c0|checking" "functions gone; videos/checks/library audit ($c0) kept; Neil's waiting video still not published"
probe_is fail "after the rollback" "$PROBE" "VID-4" "M1"
run $LANE "$MIG"; [ $rc -eq 0 ] && echo "  PASS  re-apply" || { echo "  FAIL  re-apply"; echo "$out" | grep ERROR | head -3; fail=1; }
probe_is pass "re-applied" "$PROBE" "VID-4"
want "$(res $(latest $K) clean $H1 30 NULL)" "ready" "after the re-apply the worker finishes Neil's waiting video"
done

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
