-- B5-1 PROBES — every clause of the publish contract, run as a real member.
\set ON_ERROR_STOP off
\set QUIET off
\pset footer off
\set U '''00000000-0000-0000-0000-0000000000a4'''
\set V '''00000000-0000-0000-0000-0000000000a5'''

\echo ''
\echo '── setup: three READY photos for member A, one for member B'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT media_begin_upload(decode(repeat('b1',32),'hex'),1620,1080,400000,'image/webp') AS p1 \gset
SELECT media_begin_upload(decode(repeat('b2',32),'hex'),1620,1080,400000,'image/webp') AS p2 \gset
SELECT media_begin_upload(decode(repeat('b3',32),'hex'),1620,1080,400000,'image/webp') AS p3 \gset
SELECT media_begin_upload(decode(repeat('b4',32),'hex'),1620,1080,400000,'image/webp') AS pend \gset
SELECT media_mark_verified(:'p1'); SELECT media_mark_ready(:'p1','{"original":"a"}'::jsonb);
SELECT media_mark_verified(:'p2'); SELECT media_mark_ready(:'p2','{"original":"b"}'::jsonb);
SELECT media_mark_verified(:'p3'); SELECT media_mark_ready(:'p3','{"original":"c"}'::jsonb);
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a5';
SELECT media_begin_upload(decode(repeat('c1',32),'hex'),1620,1080,400000,'image/webp') AS other \gset
SELECT media_mark_verified(:'other'); SELECT media_mark_ready(:'other','{"original":"d"}'::jsonb);
COMMIT;
\echo '   setup committed'

\echo ''
\echo '── P1 (positive control): member A publishes 3 photos — EXPECT a post id, 3 refs, ords 0,1,2'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT post_publish_with_media(ARRAY[:'p1',:'p2',:'p3']::uuid[], 'three photos', 'public') AS newpost \gset
SELECT 'P1 refs' AS check, count(*), array_agg(ord ORDER BY ord) AS ords FROM post_media WHERE post_id = :'newpost';
SELECT 'P1 post exists' AS check, count(*) FROM posts WHERE id = :'newpost';
ROLLBACK;

\echo ''
\echo '── P2: one photo still PENDING — EXPECT refusal, and NO post left behind'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT post_publish_with_media(ARRAY[:'p1',:'pend']::uuid[], 'half ready', 'public');
ROLLBACK;
SELECT 'P2 posts with that caption (expect 0)' AS check, count(*) FROM posts WHERE content = 'half ready';

\echo ''
\echo '── P3: attaching ANOTHER member''s photo — EXPECT refusal'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT post_publish_with_media(ARRAY[:'p1',:'other']::uuid[], 'stolen', 'public');
ROLLBACK;

\echo ''
\echo '── P4: the same photo twice — EXPECT refusal (no duplicate reference)'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT post_publish_with_media(ARRAY[:'p1',:'p1']::uuid[], 'twice', 'public');
ROLLBACK;

\echo ''
\echo '── P5: empty photo list — EXPECT refusal'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT post_publish_with_media(ARRAY[]::uuid[], 'no photos', 'public');
ROLLBACK;

\echo ''
\echo '── P6: unauthenticated caller — EXPECT refusal'
BEGIN;
SELECT post_publish_with_media(ARRAY[:'p1']::uuid[], 'anon', 'public');
ROLLBACK;

\echo ''
\echo '── P7 IDEMPOTENCY: same key twice — EXPECT the SAME post id, and only ONE post'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT post_publish_with_media(ARRAY[:'p1',:'p2']::uuid[], 'retry me', 'public', '{}', false, 'key-abc') AS first \gset
SELECT post_publish_with_media(ARRAY[:'p1',:'p2']::uuid[], 'retry me', 'public', '{}', false, 'key-abc') AS second \gset
SELECT 'P7 same id returned' AS check, (:'first' = :'second') AS identical,
       (SELECT count(*) FROM posts WHERE idempotency_key = 'key-abc') AS posts_created;
ROLLBACK;

\echo ''
\echo '── P8: a nonexistent media id — EXPECT refusal'
BEGIN;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a4';
SELECT post_publish_with_media(ARRAY['00000000-0000-0000-0000-0000000000ff']::uuid[], 'ghost', 'public');
ROLLBACK;

\echo ''
\echo '════ B5-1 PROBES COMPLETE ════'
