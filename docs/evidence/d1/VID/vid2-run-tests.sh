#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# VID-2 videos (20261005_0005) · C-34 harness, staging shape AND production
# shape. Acts as the API roles (SET ROLE + JWT sub), the way PostgREST does.
# Every apply / rollback / probe runs through apply-migration.yml's extracted
# "Run it" step.        PGPORT=5433 bash docs/evidence/d1/VID/vid2-run-tests.sh
# The music check itself is 20261005_0006 (VID-4): here a check row is written
# the way its service path will (as the owner role), to prove the GATE.
# ═══════════════════════════════════════════════════════════════════════════
set -u
source "$(cd "$(dirname "$0")" && pwd)/vid-lib.sh"
M4="$ROOT/supabase/migrations/20261005_0004_vid7_feature_access.sql"
MIG="$ROOT/supabase/migrations/20261005_0005_vid2_videos.sql"
RB="$ROOT/supabase/rollback/20261005_0005_vid2_videos_ROLLBACK.sql"
PROBE="$ROOT/supabase/migrations/PROBE_vid2_videos.sql"
H1=$(printf 'a%.0s' {1..64}); H2=$(printf 'b%.0s' {1..64}); HM=$(printf 'c%.0s' {1..64})
uuid() { cat /proc/sys/kernel/random/uuid; }
# rb <seconds> [audio yes|no] → rendition_bytes json at sane rates (240p 50 KB/s, audio 10 KB/s, other 50 KB)
rb() { local a=""; [ "${2:-yes}" = yes ] && a=", \"audio\": $(( $1 * 10000 ))"; echo "{\"240p\": $(( $1 * 50000 ))$a, \"other\": 50000}"; }
tot() { local t=$(( $1 * 50000 + 50000 )); [ "${2:-yes}" = yes ] && t=$(( t + $1 * 10000 )); echo $t; }
# bu <uid> <purpose> <seconds> [field] [key] [audio] → video_begin_upload(...)->>field  (or the ERROR line)
bu() { local s=$3 au=${6:-yes}; as authenticated "$1" "SELECT public.video_begin_upload('$2', '$H1', $(tot $s $au), $s, $( [ $au = yes ] && echo true || echo false ), '${5:-$(uuid)}', '$(rb $s $au)')->>'${4:-state}'"; }
raw() { as authenticated "$1" "SELECT public.video_begin_upload('$2', '$H1', $3, $4, true, '$(uuid)', '$5')->>'state'"; }
# ready <video> <audio hash> [verdict] [measured] → walks the video to ready the way 0006 will (owner role)
ready() { q "UPDATE public.video_versions SET audio_sha256 = '$2', measured_audio_s = (SELECT declared_duration_s FROM public.video_versions WHERE video_id = '$1' AND version_no = 1), uploaded_at = now() WHERE video_id = '$1' AND version_no = 1;
             UPDATE public.videos SET state = 'checking' WHERE id = '$1';
             WITH c AS (INSERT INTO public.video_music_checks (video_id, version_no, provider, attempt, verdict, audio_sha256, measured_audio_s)
                        SELECT '$1', 1, 'fixture', 1, '${3:-clean}', '$2', ${4:-declared_duration_s} FROM public.video_versions WHERE video_id = '$1' AND version_no = 1 RETURNING id)
             UPDATE public.videos SET state = 'ready', music_check_id = (SELECT id FROM c) WHERE id = '$1' RETURNING state" 2>&1 | grep -m1 -oE 'ready|VID-[A-Z]+-[0-9]+'; }
nvid() { q "SELECT count(*) FROM public.videos WHERE owner_id = '$1'"; }
timetravel() { q "ALTER TABLE public.videos DISABLE TRIGGER tg_videos_state_guard; $1; ALTER TABLE public.videos ENABLE TRIGGER tg_videos_state_guard" >/dev/null; }

for LANE in staging production; do
step "$LANE · 0 · fixture + 20261005_0004 (switches); admin turns video_posts on for Neil only"
fixture $LANE
run $LANE "$M4"; [ $rc -eq 0 ] && echo "  PASS  0004 applied" || { echo "  FAIL  0004"; fail=1; }
as authenticated $ADMIN "SELECT public.feature_set_mode('video_posts','selected'); SELECT public.feature_add_member('video_posts','$NEIL')" >/dev/null

step "$LANE · 1 · fail first: there is no video unit, so nothing is enforced"
probe_is fail "before 0005" "$PROBE" "VID-2" "V1 the videos unit is not installed"
want "$(err "$(bu $NEIL post 60)" 'does not exist')" "does not exist" "video_begin_upload does not exist yet"

step "$LANE · 2 · apply 20261005_0005 (lane $LANE) and probe"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$MIG" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'APPLY REFUSED' && echo "  PASS  apply with no lane — refused" || { echo "  FAIL  apply lane guard"; fail=1; }
run $LANE "$MIG"; [ $rc -eq 0 ] && echo "  PASS  apply — $(echo "$out" | grep -o 'VID2-0005: .*' | head -1 | cut -c1-120)" || { echo "  FAIL  apply"; echo "$out" | grep -E 'ERROR|LINE' | head -4; fail=1; }
probe_is pass "after 0005" "$PROBE" "VID-2"
run $LANE "$MIG"; [ $rc -ne 0 ] && echo "$out" | grep -q 'VID2-0005-PRE-002' && echo "  PASS  a second apply is refused (PRE-002)" || { echo "  FAIL  second apply"; fail=1; }

step "$LANE · 3 · the switch is the enforcement point (VID-7)"
want "$(bu $NEIL post 60)" "uploading" "Neil (on the Selected list) → uploading"
want "$(err "$(bu $RIYA post 60)" 'VID-UP-003')" "VID-UP-003" "Riya (not on the list) → VID-UP-003"
want "$(err "$(bu '' post 60 | sed 's/^$/x/')" 'VID-UP-001\|permission denied')" "VID-UP-001" "no signed-in user → VID-UP-001"
want "$(err "$(as anon '' "SELECT public.video_begin_upload('post','$H1',1,1,false,gen_random_uuid(),'{}')")" 'permission denied')" "permission denied" "anon cannot call it at all"
as authenticated $ADMIN "SELECT public.feature_set_mode('video_posts','off')" >/dev/null
want "$(err "$(bu $NEIL post 60)" 'VID-UP-003')" "VID-UP-003" "switch Off → Neil refused too"
as authenticated $ADMIN "SELECT public.feature_set_mode('video_posts','everyone')" >/dev/null
want "$(bu $RIYA post 60)" "uploading" "switch All members → Riya may"
want "$(err "$(bu $NEIL ad 60)" 'VID-UP-003')" "VID-UP-003" "a member asking for an AD video → VID-UP-003"
want "$(err "$(bu $ADMIN ad 60)" 'VID-UP-003')" "VID-UP-003" "admin, video_ads Off → VID-UP-003"

step "$LANE · 4 · limits: 3 min / 500 MB / 10 a day for members; 5 min / 500 MB admin ads"
q "DELETE FROM public.video_versions; ALTER TABLE public.videos DISABLE TRIGGER USER; DELETE FROM public.videos; ALTER TABLE public.videos ENABLE TRIGGER USER" >/dev/null
want "$(bu $NEIL post 180)" "uploading" "3:00 exactly → accepted"
want "$(err "$(bu $NEIL post 181)" 'VID-LIM-001')" "VID-LIM-001" "3:01 → VID-LIM-001"
want "$(err "$(raw $NEIL post 524288001 100 "{\"240p\": 5000000, \"audio\": 1000000, \"other\": 50000}")" 'VID-LIM-002')" "VID-LIM-002" "500 MB + 1 byte → VID-LIM-002"
want "$(err "$(raw $NEIL post 7250000 100 "{\"240p\": 6200000, \"audio\": 1000000, \"other\": 50000}")" 'VID-LIM-006')" "VID-LIM-006" "240p at 62 000 B/s (ceiling 61 440) → VID-LIM-006"
want "$(err "$(raw $NEIL post 4150000 100 "{\"240p\": 1000000, \"audio\": 1000000, \"other\": 2150000}")" 'VID-LIM-005')" "VID-LIM-005" "poster + playlists over 2 MB → VID-LIM-005"
want "$(err "$(raw $NEIL post 999 100 "{\"240p\": 1000000, \"audio\": 1000000, \"other\": 50000}")" 'VID-UP-006')" "VID-UP-006" "renditions that do not add up to total_bytes → VID-UP-006"
want "$(err "$(raw $NEIL post 1050000 100 "{\"240p\": 1000000, \"other\": 50000}")" 'VID-UP-006')" "VID-UP-006" "has_audio true but no audio rendition → VID-UP-006"
want "$(err "$(raw $NEIL post 1050000 100 "{\"240p\": 1000000, \"1080p\": 1, \"other\": 49999}")" 'VID-UP-006')" "VID-UP-006" "an unknown rendition key (1080p) → VID-UP-006"
K=$(uuid)
want "$(bu $NEIL post 60 replayed $K)|$(bu $NEIL post 60 replayed $K)|$(nvid $NEIL)" "false|true|2" "same idempotency key twice → one row (the replay returns it)"
want "$(bu $NEIL post 60)|$(err "$(bu $NEIL post 60)" 'VID-LIM-004')" "uploading|VID-LIM-004" "3 in progress, the 4th → VID-LIM-004"
want "$(bu $NEIL post 60 replayed $K)" "true" "…while a replay of an existing key still answers (limits never count a retry)"
for i in 1 2 3 4 5 6 7; do q "UPDATE public.videos SET state = 'failed' WHERE owner_id = '$NEIL' AND state = 'uploading'" >/dev/null; bu $NEIL post 30 >/dev/null; done
want "$(nvid $NEIL)|$(err "$(bu $NEIL post 30)" 'VID-LIM-003')" "10|VID-LIM-003" "10 uploads in 24 h, the 11th → VID-LIM-003"
timetravel "UPDATE public.videos SET created_at = now() - interval '25 hours' WHERE owner_id = '$NEIL'"
q "UPDATE public.videos SET state = 'failed' WHERE owner_id = '$NEIL' AND state = 'uploading'" >/dev/null
want "$(bu $NEIL post 30)" "uploading" "…and the window rolls: 25 h later Neil may again"
as authenticated $ADMIN "SELECT public.feature_set_mode('video_ads','everyone')" >/dev/null
want "$(bu $ADMIN ad 300)|$(err "$(bu $ADMIN ad 301)" 'VID-LIM-001')" "uploading|VID-LIM-001" "admin ad: 5:00 accepted, 5:01 → VID-LIM-001"
for i in $(seq 1 11); do q "UPDATE public.videos SET state = 'failed' WHERE owner_id = '$ADMIN' AND state = 'uploading'" >/dev/null; bu $ADMIN ad 30 >/dev/null; done
want "$(nvid $ADMIN)" "12" "ads have no daily cap (12 in an hour)"

step "$LANE · 5 · the state machine and the publish gate bind every role, the owner role included"
V=$(bu $NEIL post 60 video_id); q "UPDATE public.videos SET state = 'failed' WHERE owner_id = '$NEIL' AND state = 'uploading' AND id <> '$V'" >/dev/null
want "$(err "$(q "UPDATE public.videos SET state = 'ready' WHERE id = '$V'" 2>&1)" 'VID-STATE-003')" "VID-STATE-003" "uploading → ready (skipping the check) → VID-STATE-003"
want "$(err "$(as service_role '' "UPDATE public.videos SET state = 'ready' WHERE id = '$V'")" 'VID-STATE-003')" "VID-STATE-003" "…as service_role too"
want "$(err "$(as authenticated $NEIL "UPDATE public.videos SET state = 'checking' WHERE id = '$V'")" 'permission denied')" "permission denied" "the owner cannot move their own video from the API"
want "$(err "$(q "INSERT INTO public.videos (owner_id, purpose, idempotency_key, state) VALUES ('$NEIL','post',gen_random_uuid(),'ready')" 2>&1)" 'VID-STATE-004')" "VID-STATE-004" "a row born ready → VID-STATE-004"
q "UPDATE public.video_versions SET audio_sha256 = '$H1', measured_audio_s = 60, uploaded_at = now() WHERE video_id = '$V'; UPDATE public.videos SET state = 'checking' WHERE id = '$V'" >/dev/null
want "$(err "$(q "UPDATE public.videos SET state = 'ready' WHERE id = '$V'" 2>&1)" 'VID-GATE-001')" "VID-GATE-001" "checking → ready with no check → VID-GATE-001"
ck() { q "INSERT INTO public.video_music_checks (video_id, version_no, provider, attempt, verdict, audio_sha256, measured_audio_s) VALUES ('$V', 1, 'fixture', 1, '$1', $2, $3) RETURNING id" | head -1; }
C=$(ck match "'$H1'" 60); want "$(err "$(q "UPDATE public.videos SET state = 'ready', music_check_id = '$C' WHERE id = '$V'" 2>&1)" 'VID-GATE-002')" "VID-GATE-002" "a MATCH verdict → VID-GATE-002 (and, as service_role:) $(err "$(as service_role '' "UPDATE public.videos SET state = 'ready', music_check_id = '$C' WHERE id = '$V'")" 'VID-GATE-002')"
C=$(ck clean "'$H2'" 60); want "$(err "$(q "UPDATE public.videos SET state = 'ready', music_check_id = '$C' WHERE id = '$V'" 2>&1)" 'VID-GATE-003')" "VID-GATE-003" "a clean check of OTHER audio bytes → VID-GATE-003"
C=$(ck clean "'$H1'" 50); want "$(err "$(q "UPDATE public.videos SET state = 'ready', music_check_id = '$C' WHERE id = '$V'" 2>&1)" 'VID-GATE-004')" "VID-GATE-004" "measured audio 10 s short of the declared 60 s → VID-GATE-004"
C=$(ck clean "'$H1'" 59); want "$(q "UPDATE public.videos SET state = 'ready', music_check_id = '$C' WHERE id = '$V' RETURNING state || ':' || (ready_at IS NOT NULL)::text" | head -1)" "ready:true" "a clean check of these bytes (±2 s) → ready, ready_at stamped"
want "$(err "$(q "UPDATE public.video_versions SET audio_sha256 = '$H2' WHERE video_id = '$V'" 2>&1)" 'VID-VER-00[23]')" "VID-VER-002" "re-pointing the audio hash after ready → VID-VER-002"
want "$(err "$(q "UPDATE public.video_versions SET total_bytes = total_bytes + 1 WHERE video_id = '$V'" 2>&1)" 'VID-VER-001')" "VID-VER-001" "changing declared bytes → VID-VER-001"
want "$(err "$(q "UPDATE public.video_music_checks SET verdict = 'clean' WHERE video_id = '$V'" 2>&1)" 'append-only')|$(err "$(q "DELETE FROM public.video_music_checks WHERE video_id = '$V'" 2>&1)" 'append-only')|$(err "$(q "TRUNCATE public.video_music_checks CASCADE" 2>&1)" 'append-only')" "append-only|append-only|append-only" "check history: UPDATE, DELETE, TRUNCATE all refused"
want "$(err "$(q "UPDATE public.videos SET owner_id = '$RIYA' WHERE id = '$V'" 2>&1)" 'VID-STATE-001')" "VID-STATE-001" "changing the owner → VID-STATE-001"
want "$(err "$(q "UPDATE public.videos SET state = 'uploading', current_version = 2 WHERE id = '$V'" 2>&1)" 'VID-STATE-00[23]')" "VID-STATE-002" "a new version straight from ready → VID-STATE-002"
q "UPDATE public.videos SET state = 'taken_down' WHERE id = '$V'; UPDATE public.videos SET state = 'uploading', current_version = 2 WHERE id = '$V'" >/dev/null
q "INSERT INTO public.video_versions (video_id, version_no, manifest_sha256, total_bytes, declared_duration_s, has_audio, rendition_bytes, renditions, audio_sha256, remedy) VALUES ('$V', 2, '$H2', 1, 60, true, '{}', '{}', '$H2', 'mute'); UPDATE public.videos SET state = 'checking' WHERE id = '$V'" >/dev/null
want "$(err "$(q "UPDATE public.videos SET state = 'ready', music_check_id = '$C' WHERE id = '$V'" 2>&1)" 'VID-GATE-001')" "VID-GATE-001" "taken down → v2: v1's clean check cannot publish v2 → VID-GATE-001"
W=$(bu $NEIL post 40 video_id "" no); q "UPDATE public.videos SET state = 'failed' WHERE owner_id = '$NEIL' AND state = 'uploading' AND id <> '$W'" >/dev/null
q "UPDATE public.videos SET state = 'checking' WHERE id = '$W'" >/dev/null
CN=$(q "INSERT INTO public.video_music_checks (video_id, version_no, provider, attempt, verdict, audio_sha256, mode_at_check) VALUES ('$W', 1, 'none', 1, 'not_required', NULL, 'off') RETURNING id" | head -1)
want "$(q "UPDATE public.videos SET state = 'ready', music_check_id = '$CN' WHERE id = '$W' RETURNING state" | head -1)" "ready" "a silent video with a not_required check (switch Off) → ready"

step "$LANE · 6 · links: a ready video, its own author's post, 1–5 categories"
P0=$(q "INSERT INTO public.posts (user_id, content, categories) VALUES ('$NEIL', 'no cats', '{}') RETURNING id" 2>&1 | head -1)
if [ $LANE = staging ]; then
  want "$(err "$(as authenticated $NEIL "INSERT INTO public.post_videos (post_id, video_id) VALUES ('$P0', '$W')")" 'VID-CAT-001')" "VID-CAT-001" "staging shape: a post with 0 categories exists (B1), linking a video to it → VID-CAT-001"
else
  want "$(err "$P0" 'POST-CAT-002')" "POST-CAT-002" "production shape: a 0-category post cannot even exist (B2) — VID-CAT-001 is the backstop behind it"
fi
P1=$(q "INSERT INTO public.posts (user_id, content, categories) VALUES ('$NEIL', 'street walk', '{street,night}') RETURNING id" | head -1)
PR=$(q "INSERT INTO public.posts (user_id, content, categories) VALUES ('$RIYA', 'riya', '{portrait}') RETURNING id" | head -1)
U=$(bu $NEIL post 20 video_id)
want "$(err "$(as authenticated $NEIL "INSERT INTO public.post_videos (post_id, video_id) VALUES ('$P1', '$U')")" 'VID-LINK-001')" "VID-LINK-001" "linking an UPLOADING video → VID-LINK-001"
want "$(err "$(as authenticated $NEIL "INSERT INTO public.post_videos (post_id, video_id) VALUES ('$PR', '$W')")" 'VID-LINK-002\|row-level security')" "VID-LINK-002" "Neil linking his video to Riya's post → VID-LINK-002 (RLS would refuse it next)"
want "$(err "$(q "INSERT INTO public.post_videos (post_id, video_id) VALUES ('$PR', '$W')" 2>&1)" 'VID-LINK-002')" "VID-LINK-002" "…and by the trigger even as the owner role"
as authenticated $ADMIN "SELECT public.feature_set_mode('video_posts','off')" >/dev/null
want "$(err "$(as authenticated $NEIL "INSERT INTO public.post_videos (post_id, video_id) VALUES ('$P1', '$W')")" 'row-level security')" "row-level security" "video_posts switched Off → Neil cannot attach even a ready video"
as authenticated $ADMIN "SELECT public.feature_set_mode('video_posts','everyone')" >/dev/null
want "$(as authenticated $NEIL "INSERT INTO public.post_videos (post_id, video_id) VALUES ('$P1', '$W') RETURNING 'linked'")" "linked" "Neil's ready video on Neil's 2-category post → linked"
as authenticated $RIYA "DELETE FROM public.post_videos WHERE post_id = '$P1'" >/dev/null
want "$(q "SELECT count(*) FROM public.post_videos WHERE post_id = '$P1'")|$(err "$(as authenticated $RIYA "INSERT INTO public.post_videos VALUES ('$P1', '$W')")" 'VID-LINK\|row-level security\|duplicate')" "1|row-level security" "Riya cannot remove Neil's link (RLS: 0 rows), nor link Neil's video to Neil's post (RLS insert_own; the trigger alone would allow it)"
want "$(err "$(as authenticated $NEIL "UPDATE public.posts SET categories = '{}' WHERE id = '$P1'")" 'POST-CAT-003\|VID-CAT-002')" "POST-CAT-003" "removing every category: the posts trigger refuses first (POST-CAT-003)"
PS=$(q "INSERT INTO public.posts (user_id, content, categories, post_kind) VALUES ('$NEIL', 'system', '{street}', 'system') RETURNING id" | head -1)
X=$(bu $NEIL post 20 video_id "" no); q "UPDATE public.videos SET state = 'failed' WHERE id = '$U'" >/dev/null
q "UPDATE public.videos SET state = 'checking' WHERE id = '$X'" >/dev/null
CX=$(q "INSERT INTO public.video_music_checks (video_id, version_no, provider, attempt, verdict, mode_at_check) VALUES ('$X', 1, 'none', 1, 'not_required', 'off') RETURNING id" | head -1)
q "UPDATE public.videos SET state = 'ready', music_check_id = '$CX' WHERE id = '$X'; INSERT INTO public.post_videos VALUES ('$PS', '$X')" >/dev/null
want "$(err "$(q "UPDATE public.posts SET categories = '{}' WHERE id = '$PS'" 2>&1)" 'VID-CAT-002')" "VID-CAT-002" "…where the posts trigger lets it through (a system post), VID-CAT-002 holds"
A=$(bu $ADMIN ad 30 video_id); q "UPDATE public.videos SET state = 'failed' WHERE owner_id = '$ADMIN' AND state = 'uploading' AND id <> '$A'" >/dev/null
want "$(ready $A $H1)" "ready" "admin ad video → ready"
AD=$(q "INSERT INTO public.ad_creatives (headline) VALUES ('ad') RETURNING id" | head -1)
want "$(err "$(as authenticated $ADMIN "INSERT INTO public.ad_videos VALUES ('$AD', '$A', '{retired}')")" 'VID-CAT-003')" "VID-CAT-003" "an inactive category on a video ad → VID-CAT-003"
want "$(err "$(as authenticated $ADMIN "INSERT INTO public.ad_videos VALUES ('$AD', '$A', '{street,portrait,landscape,night,wildlife,macro}')")" 'VID-CAT-001')" "VID-CAT-001" "6 categories → VID-CAT-001"
want "$(err "$(as authenticated $ADMIN "INSERT INTO public.ad_videos VALUES ('$AD', '$A', '{\" \"}')")" 'VID-CAT-001')" "VID-CAT-001" "only blanks (0 after cleaning) → VID-CAT-001"
want "$(err "$(as authenticated $NEIL "INSERT INTO public.ad_videos VALUES ('$AD', '$A', '{street}')")" 'row-level security')" "row-level security" "a member writing ad_videos → refused by RLS"
as authenticated $ADMIN "SELECT public.feature_set_mode('video_ads','off')" >/dev/null
want "$(err "$(as authenticated $ADMIN "INSERT INTO public.ad_videos VALUES ('$AD', '$A', '{street}')")" 'row-level security')" "row-level security" "video_ads Off → even the admin cannot attach a video ad"
as authenticated $ADMIN "SELECT public.feature_set_mode('video_ads','everyone')" >/dev/null
want "$(as authenticated $ADMIN "INSERT INTO public.ad_videos VALUES ('$AD', '$A', '{Street, street ,night}') RETURNING array_to_string(categories, ',')")" "street,night" "admin, switch on: linked, categories cleaned to street,night"
want "$(err "$(q "INSERT INTO public.post_videos VALUES ('$P1', '$A')" 2>&1)" 'VID-LINK-00[12]\|duplicate key')" "VID-LINK-001" "an ad video in a post → VID-LINK-001"

step "$LANE · 7 · who sees what (RLS + hidden columns)"
want "$(as authenticated $RIYA "SELECT count(*) FROM public.videos WHERE id = '$W'")|$(as anon '' "SELECT count(*) FROM public.videos WHERE id = '$W'")" "1|1" "a ready video on a public post: Riya and anon see it"
q "UPDATE public.posts SET privacy = 'private' WHERE id = '$P1'" >/dev/null
want "$(as authenticated $RIYA "SELECT count(*) FROM public.videos WHERE id = '$W'")|$(as anon '' "SELECT count(*) FROM public.video_versions WHERE video_id = '$W'")|$(as authenticated $NEIL "SELECT count(*) FROM public.videos WHERE id = '$W'")" "0|0|1" "post made private: Riya and anon no longer see the video or its versions; Neil does"
want "$(as authenticated $RIYA "SELECT count(*) FROM public.videos WHERE owner_id = '$NEIL' AND state <> 'ready'")" "0" "Riya sees none of Neil's unfinished / failed videos"
want "$(as anon '' "SELECT count(*) FROM public.videos WHERE id = '$A'")" "1" "the active video ad is public"
want "$(err "$(as authenticated $NEIL "SELECT idempotency_key FROM public.videos LIMIT 1")" 'permission denied')|$(err "$(as authenticated $NEIL "SELECT audio_sha256 FROM public.video_versions LIMIT 1")" 'permission denied')|$(err "$(as authenticated $NEIL "SELECT manifest_sha256 FROM public.video_versions LIMIT 1")" 'permission denied')" "permission denied|permission denied|permission denied" "hidden even from the owner: idempotency key, audio hash, manifest hash"
want "$(as authenticated $NEIL "SELECT count(*) FROM public.video_music_checks WHERE video_id = '$V'")|$(as authenticated $RIYA "SELECT count(*) FROM public.video_music_checks WHERE video_id = '$V'")|$(err "$(as anon '' "SELECT count(*) FROM public.video_music_checks")" 'permission denied')" "4|0|permission denied" "verdicts: Neil reads his 4, Riya none, anon cannot ask"
want "$(err "$(as authenticated $NEIL "SELECT count(*) FROM public.video_r2_purge_queue")" 'permission denied')" "permission denied" "the purge queue is internal"

step "$LANE · 8 · delete → kept 30 days → purged; uploads abandoned 48 h → failed"
want "$(err "$(as authenticated $RIYA "SELECT public.video_delete('$W')")" 'VID-DEL-001')" "VID-DEL-001" "Riya cannot delete Neil's video"
want "$(as authenticated $NEIL "SELECT public.video_delete('$W')")|$(q "SELECT state || ':' || (deleted_at IS NOT NULL)::text FROM public.videos WHERE id = '$W'")" "deleted|deleted:true" "Neil deletes his → deleted, deleted_at stamped"
want "$(as authenticated $RIYA "SELECT count(*) FROM public.videos WHERE id = '$W'")" "0" "a deleted video is hidden at once"
want "$(err "$(q "SELECT public.video_housekeeping(interval '29 days')" 2>&1)" 'below the 30 days')" "below the 30 days" "housekeeping refuses a keep shorter than 30 days"
want "$(q "SELECT public.video_housekeeping()->>'purged'")|$(q "SELECT count(*) FROM public.videos WHERE id = '$W'")" "0|1" "day 0: kept"
timetravel "UPDATE public.videos SET deleted_at = now() - interval '29 days 23 hours' WHERE id = '$W'"
want "$(q "SELECT public.video_housekeeping()->>'purged'")|$(q "SELECT count(*) FROM public.videos WHERE id = '$W'")" "0|1" "day 29 + 23 h: still kept"
timetravel "UPDATE public.videos SET deleted_at = now() - interval '30 days 1 hour' WHERE id = '$W'"
nf=$(q "SELECT count(*) FROM public.videos WHERE state = 'failed'")
want "$(q "SELECT public.video_housekeeping()->>'purged'")" "1" "day 30 + 1 h: purged"
want "$(q "SELECT count(*) FROM public.videos WHERE id = '$W'")|$(q "SELECT count(*) FROM public.video_versions WHERE video_id = '$W'")|$(q "SELECT count(*) FROM public.video_music_checks WHERE video_id = '$W'")|$(q "SELECT count(*) FROM public.post_videos WHERE video_id = '$W'")|$(q "SELECT prefix = 'video/$NEIL/$W/' FROM public.video_r2_purge_queue WHERE video_id = '$W'")" "0|0|0|0|t" "row, versions, checks and post link gone; R2 prefix video/<owner>/<id>/ queued for the file worker"
G=$(bu $RIYA post 20 video_id)
timetravel "UPDATE public.videos SET updated_at = now() - interval '47 hours' WHERE id = '$G'"
want "$(q "SELECT public.video_housekeeping()->>'failed'")" "0" "an upload idle 47 h is left alone"
timetravel "UPDATE public.videos SET updated_at = now() - interval '49 hours' WHERE id = '$G'"
want "$(q "SELECT public.video_housekeeping()->>'failed'")|$(q "SELECT state || ':' || failed_reason FROM public.videos WHERE id = '$G'")" "1|failed:abandoned" "idle 49 h → failed (abandoned)"
timetravel "UPDATE public.videos SET updated_at = now() - interval '31 days' WHERE id = '$G'"
want "$(q "SELECT (public.video_housekeeping()->>'purged')::int >= 1")|$(q "SELECT count(*) FROM public.videos WHERE id = '$G'")" "t|0" "failed for 30 days → purged too"
want "$(q "SELECT count(*) FROM cron.job WHERE jobname = 'video-housekeeping' AND schedule = '41 * * * *' AND command LIKE '%video_housekeeping()%'")" "1" "hourly job 'video-housekeeping' (minute 41)"
M=$(as authenticated $ADMIN "SELECT public.feature_add_member('video_posts','$MIRA')" >/dev/null; bu $MIRA post 20 video_id); want "$(ready $M $H1)" "ready" "Mira: a ready video with a check"
q "DELETE FROM auth.users WHERE id = '$MIRA'" >/dev/null 2>&1
want "$(q "SELECT count(*) FROM public.videos WHERE id = '$M'")" "0" "a hard-deleted account takes its videos and checks with it (cascade passes the append-only guard)"
q "INSERT INTO auth.users VALUES ('$MIRA', 'mira@example.invalid'); INSERT INTO public.profiles VALUES ('$MIRA', 'Mira Roy', NULL, 'mira')" >/dev/null

step "$LANE · 9 · R-82 launch scale: 200 000 videos, 2 000 members"
q "INSERT INTO auth.users SELECT ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'm' || g || '@example.invalid' FROM generate_series(1, 2000) g;
   INSERT INTO public.profiles (id, full_name) SELECT id, 'member' FROM auth.users WHERE email LIKE 'm%@example.invalid' AND email ~ '^m[0-9]';
   INSERT INTO public.videos (owner_id, purpose, idempotency_key) SELECT ('00000000-0000-0000-0001-' || lpad((1 + g % 2000)::text, 12, '0'))::uuid, 'post', gen_random_uuid() FROM generate_series(1, 200000) g" >/dev/null
timetravel "UPDATE public.videos SET state = CASE WHEN random() < 0.05 THEN 'deleted' ELSE 'failed' END, deleted_at = now() - interval '40 days', updated_at = now() - interval '40 days', created_at = now() - (random() * interval '60 days') WHERE owner_id::text LIKE '00000000-0000-0000-0001-%'"
q "ANALYZE public.videos" >/dev/null
t0=$(date +%s%N); bu 00000000-0000-0000-0001-000000000007 post 30 >/dev/null; t1=$(date +%s%N)
want "$(( (t1 - t0) / 1000000 < 500 ))" "1" "video_begin_upload for a member with 100 rows among 200 000: $(( (t1 - t0) / 1000000 )) ms (< 500 ms incl. psql start)"
want "$(q "EXPLAIN SELECT count(*) FROM public.videos WHERE owner_id = '00000000-0000-0000-0001-000000000007' AND purpose = 'post' AND created_at > now() - interval '24 hours'" | grep -c idx_videos_owner_created)" "1" "the daily count reads idx_videos_owner_created"
t0=$(date +%s%N); r=$(q "SELECT public.video_housekeeping()->>'purged'"); t1=$(date +%s%N)
want "$r|$(( (t1 - t0) / 1000000 < 3000 ))" "500|1" "one hourly run purges one batch of 500 in $(( (t1 - t0) / 1000000 )) ms (< 3 s); the backlog drains batch by batch"
q "SET vid.purge = 'on'; DELETE FROM public.videos WHERE owner_id::text LIKE '00000000-0000-0000-0001-%'; DELETE FROM auth.users WHERE email ~ '^m[0-9]'; DELETE FROM public.video_r2_purge_queue WHERE owner_id::text LIKE '00000000-0000-0000-0001-%'" >/dev/null

step "$LANE · 10 · the PROBE catches each regression (mutants, each undone)"
probe_is pass "with data" "$PROBE" "VID-2"
mut() { q "$1" >/dev/null; probe_is fail "$3" "$PROBE" "VID-2" "$2"; q "$4" >/dev/null; }
mut "ALTER TABLE public.videos DISABLE TRIGGER tg_videos_state_guard" "V2 public.videos has no enabled tg_videos_state_guard" "the state machine switched off" "ALTER TABLE public.videos ENABLE TRIGGER tg_videos_state_guard"
mut "ALTER TABLE public.posts DISABLE TRIGGER trg_videos_keep_post_categories" "V2 public.posts has no enabled" "the keep-categories backstop switched off" "ALTER TABLE public.posts ENABLE TRIGGER trg_videos_keep_post_categories"
mut "GRANT SELECT (idempotency_key) ON public.videos TO authenticated" "V3 a hidden column" "the idempotency key exposed" "REVOKE SELECT (idempotency_key) ON public.videos FROM authenticated"
mut "GRANT UPDATE ON public.videos TO authenticated" "V3 public.videos: an API role can write it" "members can write videos" "REVOKE UPDATE ON public.videos FROM authenticated"
mut "GRANT MAINTAIN ON public.post_videos TO authenticated" "V3 public.post_videos: an API role holds TRUNCATE" "MAINTAIN on post_videos (PG17)" "REVOKE MAINTAIN ON public.post_videos FROM authenticated"
mut "ALTER TABLE public.post_videos DISABLE ROW LEVEL SECURITY" "V3 public.post_videos: RLS off" "RLS off on post_videos" "ALTER TABLE public.post_videos ENABLE ROW LEVEL SECURITY"
mut "GRANT EXECUTE ON FUNCTION public.video_housekeeping(interval,integer) TO authenticated" "V3 a video RPC" "housekeeping callable by members" "REVOKE EXECUTE ON FUNCTION public.video_housekeeping(interval,integer) FROM authenticated"
mut "SELECT cron.unschedule('video-housekeeping')" "V5 the video-housekeeping job" "the purge job gone" "SELECT cron.schedule('video-housekeeping', '41 * * * *', 'SELECT public.video_housekeeping();')"
mut "ALTER TABLE public.posts DISABLE TRIGGER trg_videos_keep_post_categories; UPDATE public.posts SET categories = '{}' WHERE id = '$PS'" "V4 1 video post(s) without 1–5 categories" "a video post that lost its categories (live data)" "UPDATE public.posts SET categories = '{street}' WHERE id = '$PS'; ALTER TABLE public.posts ENABLE TRIGGER trg_videos_keep_post_categories"
timetravel "UPDATE public.videos SET state = 'deleted', deleted_at = now() - interval '31 days' WHERE id = '$X'"
probe_is fail "a deleted video kept past 30 days (the purge stopped)" "$PROBE" "VID-2" "V4 1 deleted video(s) kept past 30 days"
q "SELECT public.video_housekeeping()" >/dev/null
probe_is pass "every mutant undone (the stale one purged)" "$PROBE" "VID-2"

step "$LANE · 11 · rollback: refused while any video exists (member data); removes an empty unit; re-apply"
out=$(psql -X -d "$DB" -v ON_ERROR_STOP=1 -f "$RB" 2>&1); [ $? -ne 0 ] && echo "$out" | grep -q 'ROLLBACK REFUSED' && echo "  PASS  rollback with no lane — refused" || { echo "  FAIL  rollback lane guard"; fail=1; }
n0=$(q "SELECT count(*) FROM public.videos")
run $LANE "$RB"; [ $rc -ne 0 ] && echo "$out" | grep -q 'VID2-0005-RB-PRE-003' && echo "  PASS  rollback with $n0 videos — refused (RB-PRE-003), nothing dropped: $(q "SELECT count(*) FROM public.videos") videos" || { echo "  FAIL  rollback should refuse with data"; fail=1; }
q "SELECT public.feature_set_mode('video_posts','off')" >/dev/null 2>&1
q "SET vid.purge = 'on'; DELETE FROM public.videos; DELETE FROM public.video_r2_purge_queue" >/dev/null
run $LANE "$RB"; [ $rc -eq 0 ] && echo "  PASS  rollback of the empty unit (lane $LANE)" || { echo "  FAIL  rollback"; echo "$out" | grep -E 'ERROR|LINE' | head -3; fail=1; }
want "$(q "SELECT to_regclass('public.videos') IS NULL AND to_regprocedure('public.feature_allowed(text,uuid)') IS NOT NULL")|$(q "SELECT count(*) FROM cron.job WHERE jobname = 'video-housekeeping'")|$(q "SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_videos_keep_post_categories'")" "t|0|0" "video unit gone (job, posts trigger too); the switches (0004) untouched"
probe_is fail "after the rollback" "$PROBE" "VID-2" "V1"
run $LANE "$MIG"; [ $rc -eq 0 ] && echo "  PASS  re-apply" || { echo "  FAIL  re-apply"; echo "$out" | grep ERROR | head -3; fail=1; }
probe_is pass "re-applied" "$PROBE" "VID-2"
done

echo; [ $fail -eq 0 ] && echo "ALL CASES PASS" || echo "SOME CASES FAILED"; exit $fail
