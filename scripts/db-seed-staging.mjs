#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// D1 · PHASE 0 — THE 1-MILLION-ROW STAGING SEEDER.  STAGING ONLY.  WRITES.
//
// Ruling D-16 (§9.0 of the Addendum A execution master): "Can staging be
// seeded to 1 M rows?  Yes — build the seeder in Phase 0."  §6 Phase 0, D1
// column: "deterministic, re-runnable, staging only, with a hard guard that
// refuses to run against the production project ref."
//
// It exists because several gates in the addendum are unprovable at today's
// volume.  P20 requires a named search engine meeting C4's latency budget "at
// 1 million seeded posts, not at today's volume".  P34 re-measures policy and
// index cost on seeded data.  P29 traces N+1 on the ten heaviest screens.  On
// 2026-09-02 staging held 17 posts.  Green at 17 and unknown at 1 M is not an
// answer, and "green at 106, unknown at scale" is the sentence this file
// exists to stop anyone having to write.
//
// ───────────────────────────────────────────────────────────────────────────
// ⚠ READ THIS BEFORE RUNNING IT.  THE TRIGGERS ARE THE WHOLE PROBLEM.
//
// public.posts carries NINE user triggers, measured on staging 2026-09-02:
//
//   BEFORE INSERT  trg_rate_limit_posts        rate_limit_posts()
//   BEFORE INSERT  trg_detect_duplicate_post   detect_duplicate_post()
//   BEFORE INS/UPD trg_moderate_post_content   moderate_post_content()
//   BEFORE INS/UPD trg_validate_post_categories enforce_post_categories()
//   AFTER  INSERT  trg_enqueue_post_created    enqueue_post_created_job()
//   AFTER  INSERT  trg_fan_out_new_post        fan_out_new_post()
//   AFTER  INSERT  trg_flag_post_review        flag_post_for_review()
//   AFTER  INS/UPD trg_posts_sync_hashtags     sync_post_hashtags()
//   BEFORE DELETE  trg_posts_unsync_hashtags   unsync_post_hashtags()
//
// A naive bulk insert meets three of them head-on, and the honest answers are
// data choices, not bypasses:
//
//   1. rate_limit_posts() raises 'Rate limit exceeded: maximum 30 posts per
//      hour' when the author already has 30 rows with created_at > now() - 1h.
//      SEEDED ROWS ARE BACKDATED, so that count is always zero and the trigger
//      never fires.  Nothing is disabled; the data is simply historical, which
//      is also more realistic than a million posts all written this minute.
//
//   2. fan_out_new_post() inserts one user_notifications row per follower, for
//      PUBLIC posts only, capped at 1000 followers.  It is the reason this
//      script measures a canary batch before the main run: at 513 profiles and
//      513 follow edges on staging, a public seeded post costs roughly one
//      extra row — so a million public posts is roughly a million notification
//      rows nobody asked for.  That is a real consequence of seeding, it is
//      measured rather than assumed, and --privacy-mix is how you choose it.
//
//   3. detect_duplicate_post() works from content.  Every seeded row therefore
//      gets DISTINCT deterministic content.  Determinism and duplicate
//      detection are not in conflict — identical output for the same seed is
//      not the same thing as identical rows within one run.
//
// ⚠ WHAT THIS SCRIPT WILL NOT DO: it will not set session_replication_role to
// 'replica' to switch the triggers off.  Two reasons, and the second matters
// more than the first.  It cannot — `postgres` on this platform is not a
// superuser (measured 2026-09-02: rolsuper = false).  And it should not: a
// database seeded with the triggers off has no hashtag rows, no queue rows, no
// fan-out and no counters, so every gate measured against it would be
// measuring a database the application could never have produced.  That is a
// silent change to what the evidence means, which is worse than a slow seed.
//
// ⚠ posts IS IN THE supabase_realtime PUBLICATION (measured 2026-09-02).  One
// million inserts therefore produce one million change records for the realtime
// engine to decode — the very cost P1/P2/P3 exist to reduce.  Seeding is a
// load event on staging, not a quiet one.  Plan mode says so; --yes is how you
// acknowledge it.
//
// ───────────────────────────────────────────────────────────────────────────
// DETERMINISTIC, AND WHAT THAT BUYS
//
// Every seeded id is derived from a namespace and an ordinal:
//
//   post n  →  md5('50mm-seed-v1:post:' || n)::uuid
//
// so the same seed always produces the same row set.  Three consequences:
//   * re-runnable — INSERT … ON CONFLICT (id) DO NOTHING, so a run interrupted
//     at row 640,000 is resumed by running it again, not by cleaning up first;
//   * exactly reversible — --teardown deletes precisely the derived id set and
//     nothing else, so seeded rows can never be mistaken for real ones;
//
//     ⚠ F-79, 2026-09-04: THIS LINE WAS TRUE OF THE ROWS THE SEED WRITES AND
//     FALSE OF THE ROWS THE SEED CAUSES, and it is the second that matters. The
//     teardown deleted from public.posts only. user_notifications has no foreign
//     key to posts, so the ~80,000 rows a 100k seed fans out through
//     trg_fan_out_new_post would have survived a teardown that printed success —
//     on a staging database holding 1,060 of them. The claim is left standing
//     here because it is now true, and the correction is left beside it because
//     a claim that was wrong once should not be quietly rewritten into one that
//     always looked right. Caught by reading the catalogue BEFORE the seed ran.
//     See the TEARDOWN_SQL comment and docs/evidence/d1/F-79-*;
//   * comparable — a measurement taken at 1 M rows on Tuesday and repeated in
//     Phase 7 is taken against the same thousand-thousand rows.
//
// AUTHORS — A STATED LIMITATION, NOT AN OVERSIGHT.  Seeded posts are attributed
// to the profiles that already exist on staging (513 on 2026-09-02).  Creating
// a million members would mean creating auth.users rows, which is an identity
// decision belonging to the Owner and not to a seeder.  So per-author
// cardinality in any measurement taken against seeded data is 513, and any gate
// whose result depends on author cardinality must say so.  Raising it is its
// own unit with its own gate.
//
// ───────────────────────────────────────────────────────────────────────────
// USAGE
//
//   node scripts/db-seed-staging.mjs --plan --rows 1000000
//   node scripts/db-seed-staging.mjs --rows 1000000 --yes --ack-enqueue-jobs
//   node scripts/db-seed-staging.mjs --status
//   node scripts/db-seed-staging.mjs --teardown --yes
//
// Requires psql on PATH and SUPABASE_DB_URL pointing at STAGING.  The
// credential is never printed.  Zero npm dependencies.
// ═══════════════════════════════════════════════════════════════════════════

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  LANES,
  PRODUCTION_REF,
  assertLane,
  proveFingerprint,
  psql,
  refuseProduction,
  requireDsn,
  scrub,
} from './db-lane-guard.mjs';

// ── The seed namespace ─────────────────────────────────────────────────────
// ⚠ CHANGING THIS STRING CHANGES EVERY GENERATED ID. A measurement taken
// against v1 data is not comparable with one taken against v2 data, and
// --teardown for v1 will not remove v2 rows. If it must change, it changes in
// its own PR, with the reason in the ledger, and the old set is torn down
// first.
const SEED_NAMESPACE = '50mm-seed-v1';

// Every seeded post's content begins with this, so a human looking at the
// staging site can tell instantly that a row is not a member's.
const SEED_CONTENT_MARKER = `[seed ${SEED_NAMESPACE}]`;

// Backdating is what neutralises rate_limit_posts(). One post every 30 seconds
// walking backwards from this instant: 1,000,000 rows spans about 347 days,
// which is a plausible history for a platform of this age and keeps every
// created_at comfortably outside the trigger's one-hour window.
const SEED_EPOCH_SQL = "timestamptz '2026-08-31 00:00:00+00'";
const SEED_STRIDE_SECONDS = 30;

const SEED_TABLES = ['posts'];

// ── Deterministic row expression ───────────────────────────────────────────
// Generated server-side from generate_series so a million rows never cross the
// wire. hashtextextended is deterministic for a given input and stable across
// versions, which is what "deterministic" has to mean here.
function insertBatchSql({ fromOrdinal, toOrdinal, privacyMix }) {
  const mixCase = privacyMix
    .map((p, i) => `WHEN r.bucket < ${privacyMix.slice(0, i + 1).reduce((a, b) => a + b.weight, 0)} THEN '${p.name}'`)
    .join('\n                 ');

  return `
    WITH authors AS (
      SELECT p.id, (row_number() OVER (ORDER BY p.id) - 1) AS k
        FROM public.profiles p
    ),
    author_count AS (SELECT count(*)::bigint AS c FROM authors),
    ordinals AS (
      SELECT g                                                          AS ordinal,
             abs(hashtextextended('${SEED_NAMESPACE}:post:' || g, 0))   AS h
        FROM generate_series(${fromOrdinal}, ${toOrdinal}) g
    ),
    rows_to_insert AS (
      SELECT o.ordinal,
             (o.h % 100)::int AS bucket,
             a.id             AS author_id
        FROM ordinals o
        CROSS JOIN author_count ac
        JOIN authors a ON a.k = (o.h % ac.c)
    )
    INSERT INTO public.posts
      (id, user_id, content, privacy, created_at, updated_at,
       post_kind, categories, likes_count, comments_count, shares_count)
    SELECT md5('${SEED_NAMESPACE}:post:' || r.ordinal)::uuid,
           r.author_id,
           '${SEED_CONTENT_MARKER} ' || r.ordinal || ' · '
             || md5('${SEED_NAMESPACE}:content:' || r.ordinal),
           CASE ${mixCase}
                ELSE '${privacyMix[privacyMix.length - 1].name}' END,
           ${SEED_EPOCH_SQL} - (r.ordinal * interval '${SEED_STRIDE_SECONDS} seconds'),
           ${SEED_EPOCH_SQL} - (r.ordinal * interval '${SEED_STRIDE_SECONDS} seconds'),
           'member',
           '{}'::text[],
           0, 0, 0
      FROM rows_to_insert r
    ON CONFLICT (id) DO NOTHING
  `;
}

// ── Census: what the seed has and has not touched ──────────────────────────
// Deliberately counts by the DERIVED ID SET, not by the content marker. An id
// set is exact; a LIKE on content is a guess that would also match a member who
// happened to type the marker. (The one marker count below is a cross-check on
// the id set, never the thing the teardown acts on.)
//
// F-79 widened this. It used to count posts and two neighbours, which is enough
// to see a seed arrive and not enough to see a teardown fail: the rows the seed
// CAUSES live in tables the posts count cannot see. Every table named here is
// one a trigger on public.posts writes to, or one a foreign key drags out with
// the post. If a number here does not return to its before-value after a
// teardown, the teardown did not reverse the seed.
const CENSUS_SQL = `
  SELECT (SELECT count(*) FROM public.posts)                                   AS posts_total,
         (SELECT count(*) FROM public.posts p
           WHERE p.content LIKE '${SEED_CONTENT_MARKER}%')                     AS posts_marked_seed,
         (SELECT count(*) FROM public.profiles)                                AS profiles,
         (SELECT count(*) FROM public.follows)                                 AS follows,
         (SELECT count(*) FROM public.user_notifications)                      AS user_notifications,
         (SELECT count(*) FROM public.post_hashtags)                           AS post_hashtags,
         (SELECT count(*) FROM public.hashtags)                                AS hashtags,
         (SELECT count(*) FROM public.feed_events)                             AS feed_events,
         (SELECT count(*) FROM public.album_photos)                            AS album_photos,
         (SELECT count(*) FROM public.post_reports)                            AS post_reports,
         (SELECT count(*) FROM public.post_media)                              AS post_media,
         pg_size_pretty(pg_total_relation_size('public.posts'))                AS posts_size,
         pg_size_pretty(pg_database_size(current_database()))                  AS database_size,
         to_char(clock_timestamp() AT TIME ZONE 'utc',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')                              AS measured_at_utc
`;

// The five counts the Auditor named on 2026-09-04 as the teardown's proof set.
// Named once, here, so the evidence and the assertion cannot drift apart.
//
// ⚠ THESE ARE REPORTED, NOT ASSERTED ON. Read F-79b below before using them as
// a pass/fail test: two of the five are SUPPOSED to move during a teardown, and
// a predicate demanding they hold still fails exactly when the fix works.
const TEARDOWN_PROOF_COUNTS = [
  'posts_total', 'user_notifications', 'post_hashtags', 'feed_events', 'album_photos',
];

// Tables the seed cannot write to and cannot cause a write to. If one of these
// moves across a teardown, the teardown reached something that was never the
// seed's, and that is damage rather than cleanup.
const TEARDOWN_MUST_NOT_MOVE = ['profiles', 'follows', 'post_media'];

// The highest contiguous ordinal already present. Resume starts at the first
// gap, so an interrupted run is finished by re-running it.
const HIGHEST_ORDINAL_SQL = (max) => `
  SELECT coalesce(max(g), 0) AS highest_present
    FROM generate_series(1, ${max}) g
   WHERE EXISTS (SELECT 1 FROM public.posts p
                  WHERE p.id = md5('${SEED_NAMESPACE}:post:' || g)::uuid)
`;

// ── Teardown · F-79 ────────────────────────────────────────────────────────
// A teardown must remove what the seed CAUSES, not only what the seed WRITES.
// This one used to do the second and claim the first.
//
// The seed writes into public.posts and nothing else. public.posts carries nine
// triggers, and four of them write somewhere. Read from the deployed sources on
// staging 2026-09-04 (pg_proc.prosrc, not from these files):
//
//   fan_out_new_post()         → public.user_notifications   ← NO FOREIGN KEY
//   flag_post_for_review()     → public.post_reports           FK CASCADE ✔
//   sync_post_hashtags()       → public.post_hashtags          FK CASCADE ✔
//                              → public.hashtags             ← NO FOREIGN KEY
//   enqueue_post_created_job() → pgmq queue 'post_jobs'      ← not a posts child
//
// Nine foreign keys reference public.posts. user_notifications is not one of
// them, so deleting a seeded post removes NOTHING from it. At 100,000 rows and
// today's follow graph that is roughly 80,000 notification rows surviving a
// teardown that prints success, on a staging database holding 1,060 of them —
// a 76-fold multiplication the cleanup would not touch. Caught by reading the
// catalogue BEFORE the seed ran; see docs/evidence/d1/F-79-*.
//
// THE KEY IS THE SAME KEY. fan_out_new_post sets reference_id := NEW.id, so
// every notification the seed causes is reachable by the derived id set — the
// identical md5('<namespace>:post:' || n) the posts delete already uses. No
// content match is used and none is needed: a member's notification can only be
// swept by this delete if its reference_id collides with an md5 digest of a
// string it has never seen. Deleting by `message LIKE '%seed%'` would have been
// the exact trap this file's own test has forbidden for posts since it was
// written.
//
// NO TYPE FILTER, deliberately. `AND type = 'new_post_from_following'` looks
// safer and is worse: a member who reacts to a seeded post gets a notification
// of a different type pointing at the same id, and leaving it behind leaves a
// notification whose post no longer exists. The id set is already exact; a
// filter on top of an exact key only subtracts correctness.
//
// The two statements reach the server in one string, so psql runs them in one
// implicit transaction: either both apply or neither does. Notifications first,
// because that delete reads the id set on its own and must not come to depend
// on the posts row still being there.
const TEARDOWN_SQL = (fromOrdinal, toOrdinal) => `
  DELETE FROM public.user_notifications n
   USING generate_series(${fromOrdinal}, ${toOrdinal}) g
   WHERE n.reference_id = md5('${SEED_NAMESPACE}:post:' || g)::uuid;
  DELETE FROM public.posts p
   USING generate_series(${fromOrdinal}, ${toOrdinal}) g
   WHERE p.id = md5('${SEED_NAMESPACE}:post:' || g)::uuid
`;

// ── The one child the teardown must NOT touch, and must not ignore either ───
// album_photos.post_id is ON DELETE SET NULL, alone among the nine. Deleting a
// seeded post therefore does not remove such a row — it silently NULLs a column
// on a member's album entry, and a nulled member row is damage, not a reversal.
// The seed never creates album_photos rows, so today this is zero. "Today it is
// zero" is not a contract. The teardown therefore LOOKS before it deletes and
// REFUSES if it finds any, rather than choosing on a member's behalf between
// deleting their album entry and quietly detaching it. Either choice belongs to
// the Owner; the refusal is what puts it in front of him.
// ── F-79b · WHAT A TEARDOWN CAN HONESTLY ASSERT ABOUT ITSELF ────────────────
// The first version of the verdict compared each census before and after the
// sweep and failed on any non-posts movement. It failed on the first real run —
// user_notifications 1573 → 1060 — and the failure was the CHECK being wrong,
// not the teardown. Those 513 rows were the fan-out the seed caused, and
// removing them is the whole of F-79. The predicate demanded that the thing the
// fix exists to do must not happen.
//
// The mistake underneath it: a teardown run does not know the pre-seed
// baseline. Its "before" is the census at the start of its own run, which is
// the SEEDED state. Comparing against that answers "did anything change", and
// the answer must be yes.
//
// What it can ask exactly, without knowing any baseline, is whether ANYTHING
// REACHABLE BY THE DERIVED ID SET STILL EXISTS. That question has one correct
// answer — zero — it needs no prior reading to interpret, and it is the same
// key the deletes use, so a residue row means a delete genuinely missed. The
// before/after table stays, as a report a human reads; the residue is the test
// a machine fails on.
const TEARDOWN_RESIDUE_SQL = (fromOrdinal, toOrdinal) => `
  WITH seeded AS (
    SELECT md5('${SEED_NAMESPACE}:post:' || g)::uuid AS id
      FROM generate_series(${fromOrdinal}, ${toOrdinal}) g
  )
  SELECT (SELECT count(*) FROM public.posts p
           WHERE p.id IN (SELECT id FROM seeded))              AS residue_posts,
         (SELECT count(*) FROM public.user_notifications n
           WHERE n.reference_id IN (SELECT id FROM seeded))    AS residue_user_notifications,
         (SELECT count(*) FROM public.album_photos a
           WHERE a.post_id IN (SELECT id FROM seeded))         AS residue_album_photos,
         (SELECT count(*) FROM public.post_hashtags h
           WHERE h.post_id IN (SELECT id FROM seeded))         AS residue_post_hashtags,
         (SELECT count(*) FROM public.feed_events f
           WHERE f.post_id IN (SELECT id FROM seeded))         AS residue_feed_events,
         (SELECT count(*) FROM public.post_reports r
           WHERE r.post_id IN (SELECT id FROM seeded))         AS residue_post_reports
`;

const TEARDOWN_ALBUM_GUARD_SQL = (fromOrdinal, toOrdinal) => `
  SELECT count(*)::bigint AS album_photos_pointing_at_seed
    FROM public.album_photos a
   WHERE a.post_id IN (SELECT md5('${SEED_NAMESPACE}:post:' || g)::uuid
                         FROM generate_series(${fromOrdinal}, ${toOrdinal}) g)
`;

// ── The verdict · a pure function, because a verdict tested by regex is not ──
// tested at all
//
// F-79b was a WRONG PREDICATE that lived inline in main(), where the only thing
// a test could reach was its source text. The regression test I wrote for it
// read the file and matched guard expressions with a regular expression — which
// is the same mistake one level up: it checks the shape of the code rather than
// what the code decides. It would pass against a verdict that named the right
// variables and computed the wrong answer.
//
// So the decision is separated from the I/O. This function touches no database,
// prints nothing and exits nothing; it takes numbers and returns a judgement.
// main() may only print it and choose an exit code from it. That makes the
// verdict testable the one way that actually pins it: feed it the numbers from
// the run that got this wrong — before.user_notifications 1573, after 1060,
// residue 0 — and require ok:true.
//
//   residue      { residue_posts, residue_user_notifications, ... }  all must be 0
//   before/after the census either side of the sweep — REPORTED, never asserted
//   mustNotMove  tables the seed cannot write to or cause a write to
//
// Returns { ok, reasons }. reasons is empty when ok. Every reason NAMES the
// count that produced it, so a failing run says which one and by how much.
export function teardownVerdict({ residue = {}, before = {}, after = {}, mustNotMove = [] } = {}) {
  const reasons = [];

  // 1. COMPLETENESS. Nothing reachable by the derived id set may survive a
  //    sweep of that id set. This is the only question answerable exactly
  //    without a pre-seed baseline, which a teardown run does not have.
  for (const [key, value] of Object.entries(residue)) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      reasons.push(`${key} is not a number (${JSON.stringify(value)}) — the residue query did not answer`);
    } else if (n > 0) {
      reasons.push(`${key}=${n} — rows reachable by the derived id set survived the sweep`);
    }
  }

  // 2. CONFINEMENT. Residue proves the sweep was complete; this proves it was
  //    confined. A teardown that deleted a member's profile would leave zero
  //    residue and look clean.
  for (const key of mustNotMove) {
    const b = Number(before[key]);
    const a = Number(after[key]);
    if (!Number.isFinite(b) || !Number.isFinite(a)) {
      reasons.push(`${key} was not measured on both sides — a table that cannot be compared cannot be cleared`);
    } else if (b !== a) {
      reasons.push(`${key} ${b} → ${a} — the teardown touched a table the seed cannot write to`);
    }
  }

  // 3. NOT A REASON, DELIBERATELY: a falling posts_total or user_notifications.
  //    Those SHOULD fall — the fan-out rows the seed caused are exactly what
  //    F-79 added the second delete to remove. The first version of this
  //    verdict failed on that movement and called a working teardown broken.

  return { ok: reasons.length === 0, reasons };
}

// ── Arguments ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {
    rows: 1000000,
    batch: 5000,
    canary: 200,
    plan: false,
    status: false,
    teardown: false,
    yes: false,
    ackEnqueueJobs: false,
    privacyMix: [
      { name: 'public', weight: 80 },
      { name: 'friends', weight: 10 },
      { name: 'private', weight: 10 },
    ],
    out: 'docs/evidence/d1/baseline',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--rows') out.rows = Number(argv[++i]);
    else if (a === '--batch') out.batch = Number(argv[++i]);
    else if (a === '--canary') out.canary = Number(argv[++i]);
    else if (a === '--plan') out.plan = true;
    else if (a === '--status') out.status = true;
    else if (a === '--teardown') out.teardown = true;
    else if (a === '--yes') out.yes = true;
    else if (a === '--ack-enqueue-jobs') out.ackEnqueueJobs = true;
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--privacy-mix') {
      out.privacyMix = argv[++i].split(',').map((part) => {
        const [name, weight] = part.split(':');
        return { name, weight: Number(weight) };
      });
    } else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Number.isInteger(out.rows) || out.rows < 1) throw new Error('--rows must be a positive integer.');
  if (!Number.isInteger(out.batch) || out.batch < 1) throw new Error('--batch must be a positive integer.');
  const total = out.privacyMix.reduce((a, b) => a + b.weight, 0);
  if (total !== 100) throw new Error(`--privacy-mix weights must total 100; got ${total}.`);
  for (const p of out.privacyMix) {
    if (!['public', 'friends', 'private'].includes(p.name)) {
      throw new Error(`--privacy-mix name '${p.name}' is not one of the values posts_privacy_check allows: private, friends, public.`);
    }
  }
  return out;
}

function queryOne(dsn, sql) {
  const res = psql(dsn, `SELECT row_to_json(t)::text FROM (${sql}) t`, { readOnly: false });
  const line = res.stdout.trim().split('\n').filter(Boolean)[0];
  return line ? JSON.parse(line) : null;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message));
    process.exit(2);
  }
  if (args.help) {
    console.log([
      'node scripts/db-seed-staging.mjs --plan --rows 1000000',
      'node scripts/db-seed-staging.mjs --rows 1000000 --yes --ack-enqueue-jobs [--batch 5000] [--canary 200]',
      '',
      '--yes acknowledges the printed plan. --ack-enqueue-jobs acknowledges, separately, that every',
      'seeded post enqueues a job through trg_enqueue_post_created. Both are required to write.',
      'node scripts/db-seed-staging.mjs --status',
      'node scripts/db-seed-staging.mjs --teardown --yes [--rows 1000000]',
      '',
      '--privacy-mix public:80,friends:10,private:10   weights must total 100',
      '',
      'STAGING ONLY. The production ref is refused by name before anything runs.',
    ].join('\n'));
    process.exit(0);
  }

  let dsn;
  try {
    dsn = requireDsn();
  } catch (e) {
    console.error(String(e.message));
    process.exit(2);
  }

  // ── Guard 1 · production is refused BY NAME, before anything else ────────
  // Deliberately separate from, and ahead of, the lane check. A refusal that
  // names the production project is unambiguous in a log six weeks later.
  try {
    refuseProduction(dsn);
    assertLane('staging', dsn);
  } catch (e) {
    console.error(scrub(e.message));
    process.exit(1);
  }
  console.log(`Lane OK: credential points at staging (${LANES.staging.ref}); production (${PRODUCTION_REF}) is refused by construction.`);

  // ── Guard 2 · the cluster's own answer ──────────────────────────────────
  try {
    proveFingerprint(dsn, 'staging', { readOnly: false });
  } catch (e) {
    console.error(scrub(e.message));
    process.exit(1);
  }
  console.log(`Cluster fingerprint matches staging: ${LANES.staging.system_identifier}.`);

  const before = queryOne(dsn, CENSUS_SQL);

  if (args.status) {
    const highest = queryOne(dsn, HIGHEST_ORDINAL_SQL(args.rows));
    console.log(JSON.stringify({ census: before, seed_namespace: SEED_NAMESPACE, highest_contiguous_ordinal: highest.highest_present }, null, 2));
    process.exit(0);
  }

  if (args.teardown) {
    if (!args.yes) {
      console.error('--teardown removes every row whose id is derived from the seed namespace. Re-run with --yes.');
      process.exit(2);
    }
    for (let from = 1; from <= args.rows; from += args.batch) {
      const to = Math.min(from + args.batch - 1, args.rows);
      // Look before deleting. See TEARDOWN_ALBUM_GUARD_SQL: a SET NULL child is
      // not reversed by a delete, and nulling a member's row is damage.
      const guard = queryOne(dsn, TEARDOWN_ALBUM_GUARD_SQL(from, to));
      if (Number(guard.album_photos_pointing_at_seed) > 0) {
        console.error(
          `\n\nREFUSING at ordinals ${from}..${to}: ${guard.album_photos_pointing_at_seed} album_photos row(s) `
          + 'point at a seeded post. That foreign key is ON DELETE SET NULL, so tearing the post down would not '
          + 'remove them — it would null post_id on a member\'s album entry and report success. Whether those '
          + 'rows are deleted or detached is the Owner\'s decision, not this script\'s. '
          + 'Earlier batches in this run have already been torn down; nothing in this batch was.',
        );
        process.exit(2);
      }
      psql(dsn, TEARDOWN_SQL(from, to), { readOnly: false, timeoutMs: 600000 });
      process.stdout.write(`\r  torn down through ordinal ${to} of ${args.rows}`);
    }
    const after = queryOne(dsn, CENSUS_SQL);

    // ── The teardown states its own verdict ──────────────────────────────
    // C-34 applied to the cleanup: a teardown is not trusted because it exited
    // 0. But see F-79b above for what it can honestly test. The census
    // comparison is REPORTED so a human can read what moved; the RESIDUE is
    // what the run passes or fails on, because it is the only question whose
    // right answer is knowable without a pre-seed baseline this run never saw.
    const residue = queryOne(dsn, TEARDOWN_RESIDUE_SQL(1, args.rows));
    const verdict = teardownVerdict({
      residue, before, after, mustNotMove: TEARDOWN_MUST_NOT_MOVE,
    });

    const moved = TEARDOWN_PROOF_COUNTS.map((k) => ({
      count: k,
      before_this_run: Number(before[k]),
      after: Number(after[k]),
      delta: Number(after[k]) - Number(before[k]),
    }));

    console.log(`\nTeardown swept ordinals 1..${args.rows}.`);
    console.log(JSON.stringify({
      verdict,
      residue_on_the_derived_id_set: residue,
      counts_before_and_after_this_run: moved,
      tables_the_seed_cannot_touch: TEARDOWN_MUST_NOT_MOVE.map((k) => ({
        count: k, before_this_run: Number(before[k]), after: Number(after[k]),
      })),
      seed_namespace: SEED_NAMESPACE,
      how_to_read_this:
        'The counts above are a REPORT, not the test. posts_total and '
        + 'user_notifications are SUPPOSED to fall during a teardown — the fan-out rows the seed '
        + 'caused are exactly what F-79 added the second delete to remove — so a non-zero delta on '
        + 'them is the fix working. The TEST is residue_*: every one must be 0, because nothing '
        + 'reachable by the derived id set may survive a sweep of that id set. To confirm the '
        + 'database is back to its pre-seed state, compare the after-figures with a --status '
        + 'reading taken BEFORE the seed; this run cannot do that for you and does not pretend to.',
    }, null, 2));

    if (!verdict.ok) {
      console.error(`\nTEARDOWN FAILED ITS OWN VERDICT:\n  - ${verdict.reasons.join('\n  - ')}\n`
        + 'Do not report this run as clean.');
      process.exit(1);
    }
    console.log(
      '\nZero residue on the derived id set, and nothing moved in the tables the seed cannot touch. '
      + 'The seed is reversed.',
    );
    process.exit(0);
  }

  // ── Plan ────────────────────────────────────────────────────────────────
  const publicShare = (args.privacyMix.find((p) => p.name === 'public')?.weight ?? 0) / 100;
  const plan = {
    seed_namespace: SEED_NAMESPACE,
    lane: 'staging',
    project_ref: LANES.staging.ref,
    rows_requested: args.rows,
    batch_size: args.batch,
    canary_size: args.canary,
    privacy_mix: args.privacyMix,
    authors_available: before.profiles,
    posts_per_author_approx: Math.round(args.rows / Math.max(before.profiles, 1)),
    created_at_span_days: Math.round((args.rows * SEED_STRIDE_SECONDS) / 86400),
    census_before: before,
    consequences_you_are_accepting: [
      `posts is in the supabase_realtime publication: ~${args.rows.toLocaleString()} change records will be produced for the realtime decoder.`,
      `trg_enqueue_post_created fires per row: it calls pgmq.send('post_jobs', …). MEASURED ON STAGING `
        + '2026-09-04: the pgmq queue \'post_jobs\' DOES NOT EXIST there (pgmq holds only transactional_emails), '
        + 'and enqueue_post_job swallows the failure as a RAISE WARNING. So on staging as it stands today this '
        + `costs ~${args.rows.toLocaleString()} warnings in the log, not ${args.rows.toLocaleString()} queue messages. `
        + 'The acknowledgement flag stays required anyway: the queue can be created by any migration, and a seeder '
        + 'that quietly depends on a table being absent is a seeder that breaks the day someone adds it.',
      `trg_fan_out_new_post fires for public posts by authors with followers: ~${Math.round(args.rows * publicShare).toLocaleString()} public rows, each costing one user_notifications row per follower (cap 1000). `
        + 'user_notifications has NO foreign key to posts, so these are removed by the teardown\'s own delete on '
        + 'reference_id and by nothing else (F-79). Before that fix they survived the teardown permanently.',
      'trg_posts_unsync_hashtags fires BEFORE DELETE on teardown and recounts the hashtags it releases, so the '
        + 'hashtag counters repair themselves. The hashtags VOCABULARY rows do not: public.hashtags has no foreign '
        + 'key to posts. Seeded content contains no # character and extract_hashtags matches #[A-Za-z0-9_]{1,60}, '
        + 'so the seed creates none today — measured, not assumed. Change the content template and that stops '
        + 'being true.',
      'album_photos.post_id is ON DELETE SET NULL, alone among the nine foreign keys to posts. The teardown '
        + 'refuses rather than nulling a member\'s album entry; see TEARDOWN_ALBUM_GUARD_SQL.',
      'trg_posts_sync_hashtags fires per row and will write hashtag rows derived from the seeded content.',
      'trg_rate_limit_posts does NOT fire: seeded created_at is backdated outside its one-hour window.',
      'Author cardinality is bounded by the profiles that already exist. Any gate whose result depends on author cardinality must say so.',
    ],
    reversal: `node scripts/db-seed-staging.mjs --teardown --yes --rows ${args.rows}`,
  };

  if (args.plan || !args.yes) {
    console.log(JSON.stringify(plan, null, 2));
    if (!args.plan) {
      console.error('\nRefusing to write without --yes. Read the plan above first; the consequences are not rhetorical.');
      process.exit(2);
    }
    process.exit(0);
  }

  // ── The enqueue consequence has its own flag, by the Auditor's instruction ──
  // trg_enqueue_post_created fires on every post insert and enqueues a job.
  // A million seeded posts is a million jobs, which the five-second cron will
  // then work through at 100 a run — roughly fourteen hours of a robot doing
  // work nobody asked for, on top of the seed itself. That is not a detail of
  // the plan; it is a decision the Owner makes. --yes acknowledges the plan.
  // It does NOT acknowledge this. This flag does, and nothing else does.
  if (!args.ackEnqueueJobs) {
    console.error(
      `\nREFUSING: seeding ${args.rows.toLocaleString()} posts will enqueue ~${args.rows.toLocaleString()} jobs through `
      + 'trg_enqueue_post_created, which process-post-jobs (every 5 s, 100 per run) will then drain. '
      + 'That is the Owner\'s decision, not this script\'s. Re-run with --ack-enqueue-jobs once it has been made. '
      + 'Nothing was written.',
    );
    process.exit(2);
  }

  // ── Canary first, always. Measure before you commit to a million. ───────
  console.log(`\nCanary: inserting ordinals 1..${args.canary} and measuring what each row actually costs.`);
  const canaryStart = Date.now();
  psql(dsn, insertBatchSql({ fromOrdinal: 1, toOrdinal: args.canary, privacyMix: args.privacyMix }), { readOnly: false, timeoutMs: 600000 });
  const canaryMs = Date.now() - canaryStart;
  const afterCanary = queryOne(dsn, CENSUS_SQL);

  const canary = {
    rows: args.canary,
    elapsed_ms: canaryMs,
    ms_per_row: Number((canaryMs / args.canary).toFixed(3)),
    projected_minutes_for_requested_rows: Number(((canaryMs / args.canary) * args.rows / 60000).toFixed(1)),
    derived_row_deltas: {
      posts: afterCanary.posts_total - before.posts_total,
      user_notifications: afterCanary.user_notifications - before.user_notifications,
    },
    census_after_canary: afterCanary,
  };
  console.log(JSON.stringify(canary, null, 2));

  // ── Main run, resumable ─────────────────────────────────────────────────
  console.log(`\nSeeding ordinals ${args.canary + 1}..${args.rows} in batches of ${args.batch}.`);
  const runStart = Date.now();
  for (let from = args.canary + 1; from <= args.rows; from += args.batch) {
    const to = Math.min(from + args.batch - 1, args.rows);
    psql(dsn, insertBatchSql({ fromOrdinal: from, toOrdinal: to, privacyMix: args.privacyMix }), { readOnly: false, timeoutMs: 600000 });
    const pct = ((to / args.rows) * 100).toFixed(1);
    process.stdout.write(`\r  ${to.toLocaleString()} / ${args.rows.toLocaleString()} (${pct}%)  ${Math.round((Date.now() - runStart) / 1000)}s`);
  }
  const runMs = Date.now() - runStart;
  const after = queryOne(dsn, CENSUS_SQL);

  const artefact = {
    artefact: 'd1-phase0-staging-seed',
    schema_version: 1,
    unit: 'Phase 0 · D1 · 1M-row staging seeder (ruling D-16)',
    owner: 'D1 · Database & Runtime',
    lane: 'staging',
    project_ref: LANES.staging.ref,
    instrument: { script: 'scripts/db-seed-staging.mjs', node: process.version },
    seed_namespace: SEED_NAMESPACE,
    tables_seeded: SEED_TABLES,
    plan,
    acknowledgements: { yes: true, ack_enqueue_jobs: true },
    canary,
    run: { elapsed_ms: runMs, elapsed_minutes: Number((runMs / 60000).toFixed(2)) },
    census_before: before,
    census_after: after,
    reversal: plan.reversal,
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(args.out, 'staging', `seed-${stamp}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artefact, null, 2)}\n`, 'utf8');
  console.log(`\n\nWrote ${outPath}`);
  console.log(`posts_total ${before.posts_total} → ${after.posts_total} in ${(runMs / 60000).toFixed(1)} minutes.`);
}

export {
  SEED_NAMESPACE, SEED_CONTENT_MARKER, SEED_TABLES,
  insertBatchSql, parseArgs, CENSUS_SQL, TEARDOWN_SQL, TEARDOWN_ALBUM_GUARD_SQL,
  TEARDOWN_RESIDUE_SQL, TEARDOWN_PROOF_COUNTS, TEARDOWN_MUST_NOT_MOVE, HIGHEST_ORDINAL_SQL,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
