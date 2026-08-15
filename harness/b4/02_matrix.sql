-- ═══════════════════════════════════════════════════════════════════════════
-- B4 ATOMICITY MATRIX — single-session rows. Races live in 03_races.sh.
-- Contract under test (FINAL PLAN, B4 gate):
--   no half-publish · no duplicate post · no duplicate reference ·
--   no duplicate object · no orphans.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP off
\set QUIET off
\pset footer off

\set U '''00000000-0000-0000-0000-0000000000a4'''

\echo ''
\echo '════ REGIME 2 — MEDIA ENGINE (built, empty until B5) ════'

\echo ''
\echo '── R7: post_media may reference only READY media — pending refused'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT media_begin_upload(decode(repeat('11',32),'hex'), 1620, 1080, 400000, 'image/webp') AS m1 \gset
INSERT INTO posts (id, user_id, content, image_urls, privacy)
VALUES ('00000000-0000-0000-0000-0000000000b1', :U, 'R7 post', ARRAY[]::text[], 'public');
INSERT INTO post_media (post_id, ord, media_id) VALUES ('00000000-0000-0000-0000-0000000000b1', 0, :'m1');
ROLLBACK;

\echo ''
\echo '── R8a: illegal transition pending -> ready (skipping verification) refused'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT media_begin_upload(decode(repeat('22',32),'hex'), 1620, 1080, 400000, 'image/webp') AS m2 \gset
UPDATE media_objects SET state='ready', derivatives='{"original":"k"}'::jsonb, verified_at=now() WHERE id = :'m2';
ROLLBACK;

\echo ''
\echo '── R8b: legal chain pending -> verified -> ready, then post_media accepts it'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT media_begin_upload(decode(repeat('33',32),'hex'), 1620, 1080, 400000, 'image/webp') AS m3 \gset
SELECT media_mark_verified(:'m3');
SELECT media_mark_ready(:'m3', '{"original":"o.webp","1080":"r1080.webp"}'::jsonb);
INSERT INTO posts (id, user_id, content, image_urls, privacy)
VALUES ('00000000-0000-0000-0000-0000000000b2', :U, 'R8b post', ARRAY[]::text[], 'public');
INSERT INTO post_media (post_id, ord, media_id) VALUES ('00000000-0000-0000-0000-0000000000b2', 0, :'m3');
SELECT 'R8b refs' AS check, count(*) FROM post_media WHERE post_id='00000000-0000-0000-0000-0000000000b2';
ROLLBACK;

\echo ''
\echo '── R8c: ready -> verified (backwards) refused; ready -> quarantined allowed'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT media_begin_upload(decode(repeat('34',32),'hex'), 1620, 1080, 400000, 'image/webp') AS m3c \gset
SELECT media_mark_verified(:'m3c');
SELECT media_mark_ready(:'m3c', '{"original":"o.webp"}'::jsonb);
UPDATE media_objects SET state='verified' WHERE id = :'m3c';
ROLLBACK;
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT media_begin_upload(decode(repeat('35',32),'hex'), 1620, 1080, 400000, 'image/webp') AS m3d \gset
SELECT media_mark_verified(:'m3d');
SELECT media_mark_ready(:'m3d', '{"original":"o.webp"}'::jsonb);
SELECT media_quarantine(:'m3d', 'takedown');
SELECT 'R8c quarantine from ready' AS check, state FROM media_objects WHERE id = :'m3d';
ROLLBACK;

\echo ''
\echo '── R9: same bytes twice, same owner — ONE object, same id (no duplicate object)'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT media_begin_upload(decode(repeat('44',32),'hex'), 1620, 1080, 400000, 'image/webp') AS a \gset
SELECT media_begin_upload(decode(repeat('44',32),'hex'), 1620, 1080, 400000, 'image/webp') AS b \gset
SELECT 'R9 same id returned' AS check, (:'a' = :'b') AS identical,
       (SELECT count(*) FROM media_objects WHERE sha256 = decode(repeat('44',32),'hex')) AS rows;
ROLLBACK;

\echo ''
\echo '── R11: a quarantined object is never handed back (no upload/refuse loop)'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT media_begin_upload(decode(repeat('55',32),'hex'), 1620, 1080, 400000, 'image/webp') AS q \gset
SELECT media_quarantine(:'q', 'failed content verification');
SELECT media_begin_upload(decode(repeat('55',32),'hex'), 1620, 1080, 400000, 'image/webp');
ROLLBACK;

\echo ''
\echo '── R12: media still referenced cannot be deleted (ON DELETE RESTRICT)'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT media_begin_upload(decode(repeat('66',32),'hex'), 1620, 1080, 400000, 'image/webp') AS m6 \gset
SELECT media_mark_verified(:'m6');
SELECT media_mark_ready(:'m6', '{"original":"o.webp"}'::jsonb);
INSERT INTO posts (id, user_id, content, image_urls, privacy)
VALUES ('00000000-0000-0000-0000-0000000000b3', :U, 'R12 post', ARRAY[]::text[], 'public');
INSERT INTO post_media (post_id, ord, media_id) VALUES ('00000000-0000-0000-0000-0000000000b3', 0, :'m6');
DELETE FROM media_objects WHERE id = :'m6';
ROLLBACK;

\echo ''
\echo '── R13: deleting the POST cascades its refs; the media row SURVIVES (sweep territory)'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT media_begin_upload(decode(repeat('77',32),'hex'), 1620, 1080, 400000, 'image/webp') AS m7 \gset
SELECT media_mark_verified(:'m7');
SELECT media_mark_ready(:'m7', '{"original":"o.webp"}'::jsonb);
INSERT INTO posts (id, user_id, content, image_urls, privacy)
VALUES ('00000000-0000-0000-0000-0000000000b4', :U, 'R13 post', ARRAY[]::text[], 'public');
INSERT INTO post_media (post_id, ord, media_id) VALUES ('00000000-0000-0000-0000-0000000000b4', 0, :'m7');
DELETE FROM posts WHERE id = '00000000-0000-0000-0000-0000000000b4';
SELECT 'R13 refs after post delete' AS check, count(*) FROM post_media WHERE post_id='00000000-0000-0000-0000-0000000000b4';
SELECT 'R13 media row survives' AS check, count(*) FROM media_objects WHERE id = :'m7';
ROLLBACK;

\echo ''
\echo '── R14: in-flight cap — the 51st never-completed upload is refused'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
DO $$
DECLARE i int;
BEGIN
  FOR i IN 1..50 LOOP
    PERFORM media_begin_upload(decode(lpad(to_hex(i), 64, '0'),'hex'), 100, 100, 1000, 'image/webp');
  END LOOP;
END $$;
SELECT 'R14 in flight' AS check, count(*) FROM media_objects WHERE state IN ('pending','verified');
SELECT media_begin_upload(decode(lpad(to_hex(999), 64, '0'),'hex'), 100, 100, 1000, 'image/webp');
ROLLBACK;

\echo ''
\echo '── R15: PARTIAL post_media set — is a 2-of-3 photo post refused anywhere?'
\echo '        (design step 7 says publish requires every ord; probe finds out)'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT media_begin_upload(decode(repeat('88',32),'hex'), 1620, 1080, 400000, 'image/webp') AS p1 \gset
SELECT media_begin_upload(decode(repeat('99',32),'hex'), 1620, 1080, 400000, 'image/webp') AS p2 \gset
SELECT media_mark_verified(:'p1'); SELECT media_mark_ready(:'p1', '{"original":"a"}'::jsonb);
SELECT media_mark_verified(:'p2'); SELECT media_mark_ready(:'p2', '{"original":"b"}'::jsonb);
INSERT INTO posts (id, user_id, content, image_urls, privacy)
VALUES ('00000000-0000-0000-0000-0000000000b5', :U, 'R15 three-photo post, only two refs', ARRAY[]::text[], 'public');
INSERT INTO post_media (post_id, ord, media_id) VALUES ('00000000-0000-0000-0000-0000000000b5', 0, :'p1');
INSERT INTO post_media (post_id, ord, media_id) VALUES ('00000000-0000-0000-0000-0000000000b5', 2, :'p2');
SELECT 'R15 post exists with a HOLE at ord=1' AS check,
       (SELECT array_agg(ord ORDER BY ord) FROM post_media WHERE post_id='00000000-0000-0000-0000-0000000000b5') AS ords;
ROLLBACK;

\echo ''
\echo '── R16: duplicate REFERENCE — same media twice in one post at different ord'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT media_begin_upload(decode(repeat('aa',32),'hex'), 1620, 1080, 400000, 'image/webp') AS d1 \gset
SELECT media_mark_verified(:'d1'); SELECT media_mark_ready(:'d1', '{"original":"a"}'::jsonb);
INSERT INTO posts (id, user_id, content, image_urls, privacy)
VALUES ('00000000-0000-0000-0000-0000000000b6', :U, 'R16', ARRAY[]::text[], 'public');
INSERT INTO post_media (post_id, ord, media_id) VALUES ('00000000-0000-0000-0000-0000000000b6', 0, :'d1');
INSERT INTO post_media (post_id, ord, media_id) VALUES ('00000000-0000-0000-0000-0000000000b6', 1, :'d1');
SELECT 'R16 same media at two ords' AS check, count(*) FROM post_media WHERE post_id='00000000-0000-0000-0000-0000000000b6';
ROLLBACK;

\echo ''
\echo '════ REGIME 1 — TODAY (posts.image_urls array) ════'

\echo ''
\echo '── R4: identical repost INSIDE the 10-minute window — refused by content_hash'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
INSERT INTO posts (user_id, content, image_urls, privacy)
VALUES (:U, 'same caption', ARRAY['a.webp','b.webp'], 'public');
INSERT INTO posts (user_id, content, image_urls, privacy)
VALUES (:U, 'same caption', ARRAY['a.webp','b.webp'], 'public');
ROLLBACK;

\echo ''
\echo '── R4b: same caption, DIFFERENT photos — allowed (hash covers the urls)'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
INSERT INTO posts (user_id, content, image_urls, privacy)
VALUES (:U, 'same caption', ARRAY['a.webp'], 'public');
INSERT INTO posts (user_id, content, image_urls, privacy)
VALUES (:U, 'same caption', ARRAY['c.webp'], 'public');
SELECT 'R4b posts created' AS check, count(*) FROM posts WHERE user_id = :U;
ROLLBACK;

\echo ''
\echo '── R6: author cannot swap the photos of an existing post (media immutable after publish)'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
INSERT INTO posts (id, user_id, content, image_urls, privacy)
VALUES ('00000000-0000-0000-0000-0000000000b7', :U, 'original caption', ARRAY['a.webp'], 'public');
UPDATE posts SET image_urls = ARRAY['evil.webp'] WHERE id = '00000000-0000-0000-0000-0000000000b7';
ROLLBACK;

\echo ''
\echo '── R6b: caption-only edit IS allowed (positive control — R6 is not vacuous)'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
INSERT INTO posts (id, user_id, content, image_urls, privacy)
VALUES ('00000000-0000-0000-0000-0000000000b8', :U, 'original caption', ARRAY['a.webp'], 'public');
UPDATE posts SET content = 'edited caption' WHERE id = '00000000-0000-0000-0000-0000000000b8';
SELECT 'R6b caption updated' AS check, content FROM posts WHERE id = '00000000-0000-0000-0000-0000000000b8';
ROLLBACK;

\echo ''
\echo '════ MATRIX (single-session) COMPLETE ════'
