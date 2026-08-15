#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# B4 ATOMICITY MATRIX — CONCURRENT ROWS. Two real sessions, interleaved with
# sleeps so the ordering is deterministic rather than hopeful.
# ═══════════════════════════════════════════════════════════════════════════
PSQL="/usr/lib/postgresql/16/bin/psql -h /tmp/pgrun -p 5433 -U postgres -d harness -q -t"
U='00000000-0000-0000-0000-0000000000a4'

echo ""
echo "── RACE-1: two identical submits at once (double-tap / two devices)"
echo "   A checks for a duplicate, B checks before A commits. Contract: ONE post."
$PSQL -c "DELETE FROM posts WHERE user_id='$U';" >/dev/null
(
  $PSQL <<SQL
BEGIN;
INSERT INTO posts (user_id, content, image_urls, privacy)
VALUES ('$U', 'race caption', ARRAY['x.webp','y.webp'], 'public');
SELECT pg_sleep(2);
COMMIT;
SQL
) > /tmp/b4/.raceA 2>&1 &
sleep 1
(
  $PSQL <<SQL
BEGIN;
INSERT INTO posts (user_id, content, image_urls, privacy)
VALUES ('$U', 'race caption', ARRAY['x.webp','y.webp'], 'public');
COMMIT;
SQL
) > /tmp/b4/.raceB 2>&1
wait
echo "   session A: $(grep -cE 'INSERT|ERROR' /tmp/b4/.raceA >/dev/null; grep -oE 'ERROR.*' /tmp/b4/.raceA || echo 'committed')"
echo "   session B: $(grep -oE 'ERROR.*' /tmp/b4/.raceB || echo 'committed')"
echo -n "   RESULT posts with that content_hash: "
$PSQL -c "SELECT count(*) FROM posts WHERE user_id='$U' AND content='race caption';"

echo ""
echo "── RACE-1b: SEQUENTIAL repeat of the same two submits (control — proves"
echo "   the guard works when the writes do not overlap)"
$PSQL -c "DELETE FROM posts WHERE user_id='$U';" >/dev/null
$PSQL -c "INSERT INTO posts (user_id, content, image_urls, privacy) VALUES ('$U','race caption',ARRAY['x.webp','y.webp'],'public');" >/dev/null 2>&1
$PSQL -c "INSERT INTO posts (user_id, content, image_urls, privacy) VALUES ('$U','race caption',ARRAY['x.webp','y.webp'],'public');" > /tmp/b4/.seq 2>&1
echo "   second insert: $(grep -oE 'ERROR.*' /tmp/b4/.seq || echo 'ACCEPTED (would be the defect)')"
echo -n "   RESULT rows: "
$PSQL -c "SELECT count(*) FROM posts WHERE user_id='$U' AND content='race caption';"

echo ""
echo "── RACE-2: two concurrent media_begin_upload for the SAME bytes"
echo "   Contract: both callers converge on ONE object."
$PSQL -c "DELETE FROM post_media; DELETE FROM media_objects;" >/dev/null
(
  $PSQL <<SQL
BEGIN;
SET LOCAL request.jwt.claim.sub = '$U';
SELECT media_begin_upload(decode(repeat('ab',32),'hex'), 1620, 1080, 400000, 'image/webp');
SELECT pg_sleep(2);
COMMIT;
SQL
) > /tmp/b4/.mediaA 2>&1 &
sleep 1
(
  $PSQL <<SQL
BEGIN;
SET LOCAL request.jwt.claim.sub = '$U';
SELECT media_begin_upload(decode(repeat('ab',32),'hex'), 1620, 1080, 400000, 'image/webp');
COMMIT;
SQL
) > /tmp/b4/.mediaB 2>&1
wait
echo "   A returned: $(grep -oE '[0-9a-f-]{36}|ERROR.*' /tmp/b4/.mediaA | head -1)"
echo "   B returned: $(grep -oE '[0-9a-f-]{36}|ERROR.*' /tmp/b4/.mediaB | head -1)"
echo -n "   RESULT media rows for those bytes: "
$PSQL -c "SELECT count(*) FROM media_objects WHERE sha256 = decode(repeat('ab',32),'hex');"

echo ""
echo "── RACE-3: publish racing a QUARANTINE (takedown lands mid-publish)"
echo "   Contract question: can a live post end up referencing quarantined bytes?"
$PSQL -c "DELETE FROM post_media; DELETE FROM media_objects; DELETE FROM posts WHERE user_id='$U';" >/dev/null
MID=$($PSQL -c "SET request.jwt.claim.sub='$U'; SELECT media_begin_upload(decode(repeat('cd',32),'hex'),1620,1080,400000,'image/webp');" | tr -d ' \n')
$PSQL -c "SELECT media_mark_verified('$MID'); SELECT media_mark_ready('$MID','{\"original\":\"o\"}'::jsonb);" >/dev/null
PID_POST=$($PSQL -c "INSERT INTO posts (user_id, content, image_urls, privacy) VALUES ('$U','race3',ARRAY[]::text[],'public') RETURNING id;" | tr -d ' \n')
(
  $PSQL <<SQL
BEGIN;
INSERT INTO post_media (post_id, ord, media_id) VALUES ('$PID_POST', 0, '$MID');
SELECT pg_sleep(2);
COMMIT;
SQL
) > /tmp/b4/.pubA 2>&1 &
sleep 1
$PSQL -c "SELECT media_quarantine('$MID','takedown mid-publish');" > /tmp/b4/.qB 2>&1
wait
echo "   publish session: $(grep -oE 'ERROR.*' /tmp/b4/.pubA || echo 'committed')"
echo "   quarantine:      $(grep -oE 'ERROR.*' /tmp/b4/.qB || echo 'committed')"
echo -n "   RESULT live refs pointing at quarantined media: "
$PSQL -c "SELECT count(*) FROM post_media pm JOIN media_objects m ON m.id=pm.media_id WHERE m.state='quarantined';"

echo ""
echo "── RACE-4: deleting media while a publish referencing it is in flight"
echo "   Contract: RESTRICT must win; the delete waits and then fails."
$PSQL -c "DELETE FROM post_media; DELETE FROM media_objects; DELETE FROM posts WHERE user_id='$U';" >/dev/null
MID2=$($PSQL -c "SET request.jwt.claim.sub='$U'; SELECT media_begin_upload(decode(repeat('ef',32),'hex'),1620,1080,400000,'image/webp');" | tr -d ' \n')
$PSQL -c "SELECT media_mark_verified('$MID2'); SELECT media_mark_ready('$MID2','{\"original\":\"o\"}'::jsonb);" >/dev/null
PID2=$($PSQL -c "INSERT INTO posts (user_id, content, image_urls, privacy) VALUES ('$U','race4',ARRAY[]::text[],'public') RETURNING id;" | tr -d ' \n')
(
  $PSQL <<SQL
BEGIN;
INSERT INTO post_media (post_id, ord, media_id) VALUES ('$PID2', 0, '$MID2');
SELECT pg_sleep(2);
COMMIT;
SQL
) > /tmp/b4/.pub4 2>&1 &
sleep 1
$PSQL -c "DELETE FROM media_objects WHERE id='$MID2';" > /tmp/b4/.del4 2>&1
wait
echo "   publish: $(grep -oE 'ERROR.*' /tmp/b4/.pub4 || echo 'committed')"
echo "   delete:  $(grep -oE 'ERROR.*' /tmp/b4/.del4 | head -1 || echo 'SUCCEEDED (would be the defect)')"
echo -n "   RESULT dangling refs: "
$PSQL -c "SELECT count(*) FROM post_media pm LEFT JOIN media_objects m ON m.id=pm.media_id WHERE m.id IS NULL;"

echo ""
echo "════ RACES COMPLETE ════"
