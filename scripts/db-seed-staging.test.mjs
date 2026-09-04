#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// D1 · TESTS FOR THE STAGING SEEDER (deliverable 0.3).
//
// Run:  node scripts/db-seed-staging.test.mjs
// Exits non-zero on the first failure. Zero npm dependencies; connects to no
// database — everything here is about the parts that must be right BEFORE a
// connection is opened, which is exactly the part a live run cannot test,
// because by the time a live run is wrong it has already connected.
//
// C-34 in this project: a test that could not have failed is not evidence. So
// every case below plants something and requires the guard to reject it. There
// are no assertions of the form "the happy path still works" without a matching
// case that proves the guard would have refused the unhappy one.
//
// The regression cases are marked ⟵ REGRESSION and each names the defect it
// pins. They are the ones worth keeping when this file is next tidied.
// ═══════════════════════════════════════════════════════════════════════════


import { readFileSync } from 'node:fs';

import { LANES, PRODUCTION_REF, refuseProduction } from './db-lane-guard.mjs';
import {
  SEED_NAMESPACE, insertBatchSql, parseArgs, CENSUS_SQL, TEARDOWN_SQL,
  TEARDOWN_ALBUM_GUARD_SQL, TEARDOWN_PROOF_COUNTS,
} from './db-seed-staging.mjs';

// The lane guard and the baseline have their own suite,
// scripts/db-baseline.test.mjs. Separate files, separate PRs (0-D1-04).

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push({ name, message: e.message });
    console.log(`  FAIL ${name}\n         ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function throws(fn, matcher, msg) {
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  assert(threw, msg || 'expected a throw, got none');
  if (matcher) assert(matcher.test(threw.message), `threw, but with the wrong message: ${threw.message}`);
}

const POOLER_STAGING = `postgresql://postgres.${LANES.staging.ref}:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`;
const POOLER_PROD = `postgresql://postgres.${PRODUCTION_REF}:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`;
const DIRECT_STAGING = `postgresql://postgres:pw@db.${LANES.staging.ref}.supabase.co:5432/postgres`;

console.log('\nThe seeder-specific refusal');

check('refuseProduction names production explicitly in its refusal', () => {
  throws(() => refuseProduction(POOLER_PROD), new RegExp(PRODUCTION_REF));
});

check('refuseProduction allows staging through', () => {
  assert(refuseProduction(POOLER_STAGING) === LANES.staging.ref);
});

console.log('\nSeeder');

const MIX = [{ name: 'public', weight: 80 }, { name: 'friends', weight: 10 }, { name: 'private', weight: 10 }];

check('a privacy mix that does not total 100 is REFUSED', () => {
  throws(() => parseArgs(['--privacy-mix', 'public:50,private:10']), /must total 100/);
});

check('a privacy value outside the table CHECK constraint is REFUSED', () => {
  throws(() => parseArgs(['--privacy-mix', 'secret:100']), /posts_privacy_check/);
});

check('--rows must be a positive integer', () => {
  throws(() => parseArgs(['--rows', '0']), /positive integer/);
  throws(() => parseArgs(['--rows', 'lots']), /positive integer/);
});

check('the seed is deterministic — same arguments, byte-identical SQL', () => {
  const a = insertBatchSql({ fromOrdinal: 1, toOrdinal: 100, privacyMix: MIX });
  const b = insertBatchSql({ fromOrdinal: 1, toOrdinal: 100, privacyMix: MIX });
  assert(a === b, 'two identical calls produced different SQL');
});

check('the seed is re-runnable — ON CONFLICT DO NOTHING, keyed on the derived id', () => {
  const sql = insertBatchSql({ fromOrdinal: 1, toOrdinal: 10, privacyMix: MIX });
  assert(/ON CONFLICT \(id\) DO NOTHING/.test(sql), 'a re-run would raise a duplicate-key error');
  assert(sql.includes(`md5('${SEED_NAMESPACE}:post:'`), 'ids are not derived from the seed namespace');
});

check('⟵ the seed BACKDATES created_at, which is what stops rate_limit_posts firing', () => {
  // rate_limit_posts() raises after 30 rows per author with created_at within
  // the last hour. Backdating is the whole reason a bulk seed is possible
  // without disabling anything. If this ever changes, the seed stops at row 31.
  const sql = insertBatchSql({ fromOrdinal: 1, toOrdinal: 10, privacyMix: MIX });
  assert(/timestamptz '20\d\d-\d\d-\d\d[^']*'\s*-\s*\(r\.ordinal \* interval/.test(sql),
    'created_at is no longer backdated by ordinal');
  assert(!/\bnow\(\)/.test(sql), 'the seed writes now() into created_at, which will trip the rate limiter');
});

check('every seeded row is marked, so a human can tell it from a member’s', () => {
  const sql = insertBatchSql({ fromOrdinal: 1, toOrdinal: 10, privacyMix: MIX });
  assert(sql.includes(`[seed ${SEED_NAMESPACE}]`), 'seeded content carries no marker');
});

check('teardown is keyed on the derived id set, never on the content marker', () => {
  // An id set is exact. A LIKE on content would also match a member who typed
  // the marker, and a teardown that can delete a member's row is not a teardown.
  const sql = TEARDOWN_SQL(1, 1000);
  assert(/md5\('.*:post:'/.test(sql), 'teardown does not use the derived id set');
  assert(!/LIKE/i.test(sql), 'teardown matches on content — it could delete a real row');
});

check('⟵ REGRESSION F-79 · teardown removes the notifications the seed CAUSES, not only the posts it writes', () => {
  // The defect: TEARDOWN_SQL deleted from public.posts and nothing else, and
  // user_notifications has NO foreign key to posts. Measured on staging
  // 2026-09-04 by two instruments independently — the Auditor listed the nine
  // foreign keys referencing posts and user_notifications was not among them;
  // I read fan_out_new_post()'s deployed source and found it inserting there on
  // every public post. At 100k seeded rows that is ~80,000 rows surviving a
  // teardown that prints success, on a database holding 1,060.
  //
  // This test would have passed before the fix if it only checked that posts
  // are deleted. It checks the second delete, which did not exist.
  const sql = TEARDOWN_SQL(1, 1000);
  assert(/DELETE\s+FROM\s+public\.user_notifications/i.test(sql),
    'teardown does not delete from user_notifications — the fan-out rows survive it (F-79)');
  assert(/DELETE\s+FROM\s+public\.posts/i.test(sql),
    'teardown no longer deletes the posts themselves');
});

check('⟵ REGRESSION F-79 · the notification teardown is keyed on the DERIVED ID SET, never on content', () => {
  // The trap this file has forbidden for posts since it was written, now closed
  // for notifications too. A member's notification must not be reachable by the
  // teardown, and `message LIKE '%seed%'` would make every one of them
  // reachable. fan_out_new_post sets reference_id := NEW.id, so the derived id
  // set reaches exactly the rows the seed caused and nothing else.
  const sql = TEARDOWN_SQL(1, 1000);
  const notifDelete = sql.slice(
    sql.search(/DELETE\s+FROM\s+public\.user_notifications/i),
    sql.search(/DELETE\s+FROM\s+public\.posts/i),
  );
  assert(notifDelete.length > 0, 'could not isolate the notification delete');
  assert(/reference_id\s*=\s*md5\('.*:post:'/.test(notifDelete),
    'the notification delete is not keyed on the derived id set');
  assert(!/LIKE/i.test(notifDelete),
    'the notification delete matches on content — it could delete a member’s notification');
  assert(!notifDelete.includes(`[seed ${SEED_NAMESPACE}]`),
    'the notification delete references the content marker');
  for (const col of ['message', 'title']) {
    assert(!new RegExp(`n\\.${col}\\b`).test(notifDelete),
      `the notification delete reads n.${col} — that is a content match by another name`);
  }
});

check('⟵ REGRESSION F-79 · no type filter narrows the notification delete', () => {
  // `AND type = 'new_post_from_following'` reads as caution and is the opposite.
  // A member who reacts to a seeded post gets a DIFFERENT type pointing at the
  // same id; filtering leaves that row behind, pointing at a post that no longer
  // exists. The id set is already exact — an md5 digest collision is the only
  // way a member's row is reached — so a filter on top of it only subtracts.
  const sql = TEARDOWN_SQL(1, 1000);
  const notifDelete = sql.slice(
    sql.search(/DELETE\s+FROM\s+public\.user_notifications/i),
    sql.search(/DELETE\s+FROM\s+public\.posts/i),
  );
  assert(!/\btype\s*=/i.test(notifDelete),
    'the notification delete filters on type, so it leaves rows pointing at deleted posts');
});

check('⟵ REGRESSION F-79 · notifications are deleted BEFORE the posts, in one statement string', () => {
  // Both deletes reach the server in one string, so psql runs them in a single
  // implicit transaction — either both apply or neither does. Order still
  // matters for readability of intent: the notification delete keys on the id
  // set by itself and must never come to depend on the posts row surviving.
  const sql = TEARDOWN_SQL(1, 1000);
  assert(sql.search(/DELETE\s+FROM\s+public\.user_notifications/i)
       < sql.search(/DELETE\s+FROM\s+public\.posts/i),
    'posts are deleted before the notifications that reference them');
  assert(/;/.test(sql), 'the two deletes are not separated — they cannot both run');
});

check('⟵ REGRESSION F-79 · album_photos is SET NULL, so the teardown refuses instead of nulling a member’s row', () => {
  // album_photos.post_id is ON DELETE SET NULL, alone among the nine foreign
  // keys to posts. A delete therefore does not reverse such a row; it silently
  // detaches a member's album entry and reports success. It holds 0 rows today.
  // "Today it is zero" is not a contract.
  const guard = TEARDOWN_ALBUM_GUARD_SQL(1, 1000);
  assert(/album_photos/.test(guard), 'the album guard does not read album_photos');
  assert(/md5\('.*:post:'/.test(guard), 'the album guard is not keyed on the derived id set');
  assert(!/DELETE|UPDATE/i.test(guard), 'the album guard writes — it must only look');

  // ⚠ COMMENTS ARE STRIPPED BEFORE THIS SEARCH, and that is not fussiness.
  // The first version of this assertion searched the raw source for the token
  // TEARDOWN_ALBUM_GUARD_SQL. The negative control then moved the guard CALL
  // below the delete and left the explanatory comment above it — and the test
  // stayed green, because indexOf found the comment at offset 348 and the
  // delete at 473. It was measuring prose. That is the same defect as F-76,
  // where a guard grepped raw SQL and my own explanation of a function made it
  // believe the function gated itself. A check that a comment can satisfy is
  // not a check, so the comment is removed before the question is asked.
  const src = readFileSync(new URL('./db-seed-staging.mjs', import.meta.url), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  const branch = code.slice(code.indexOf('if (args.teardown)'));
  const guardCall = branch.indexOf('queryOne(dsn, TEARDOWN_ALBUM_GUARD_SQL(');
  const deleteCall = branch.indexOf('psql(dsn, TEARDOWN_SQL(');
  assert(guardCall > 0, 'the teardown branch never CALLS the album guard');
  assert(deleteCall > 0, 'could not find the teardown delete');
  assert(guardCall < deleteCall, 'the album guard runs AFTER the delete — the rows are already detached');
  assert(/REFUSING at ordinals/.test(branch), 'the guard does not refuse, it only measures');
});

check('⟵ REGRESSION F-79 · the teardown proves its own reversal on the five named counts', () => {
  // C-34 applied to the cleanup. A teardown is not trusted because it exited 0;
  // it is trusted because the counts came back. These five are the set the
  // Auditor named on 2026-09-04, and CENSUS_SQL must supply every one of them
  // or the check silently compares undefined with undefined.
  for (const k of ['posts_total', 'user_notifications', 'post_hashtags', 'feed_events', 'album_photos']) {
    assert(TEARDOWN_PROOF_COUNTS.includes(k), `${k} is not in the teardown proof set`);
    assert(new RegExp(`AS\\s+${k}\\b`).test(CENSUS_SQL),
      `CENSUS_SQL does not produce ${k}, so the reversal check would compare undefined with undefined`);
  }
  const src = readFileSync(new URL('./db-seed-staging.mjs', import.meta.url), 'utf8');
  const branch = src.slice(src.indexOf('if (args.teardown)'), src.indexOf('// ── Plan ──'));
  assert(/TEARDOWN_DID_NOT_REVERSE|TEARDOWN DID NOT REVERSE/.test(branch),
    'the teardown never says it failed to reverse');
  assert(/process\.exit\(1\)/.test(branch),
    'a teardown that did not reverse still exits 0 — the failure would be invisible in CI');
});

check('⟵ REGRESSION F-79 · every table a posts trigger writes to is counted by the census', () => {
  // The census used to count posts and two neighbours, which is enough to watch
  // a seed arrive and not enough to watch a teardown fail. Read from the
  // deployed trigger sources on staging 2026-09-04: fan_out_new_post →
  // user_notifications, flag_post_for_review → post_reports, sync_post_hashtags
  // → hashtags and post_hashtags. Plus the CASCADE child feed_events and the
  // SET NULL child album_photos.
  for (const t of ['user_notifications', 'post_reports', 'hashtags', 'post_hashtags',
                   'feed_events', 'album_photos']) {
    assert(new RegExp(`AS\\s+${t}\\b`).test(CENSUS_SQL),
      `the census does not count ${t}, so a teardown that leaves rows there looks clean`);
  }
});

check('--ack-enqueue-jobs is a distinct flag, parsed separately from --yes', () => {
  const a = parseArgs(['--yes']);
  assert(a.yes === true && a.ackEnqueueJobs === false, '--yes implied the enqueue acknowledgement');
  const b = parseArgs(['--yes', '--ack-enqueue-jobs']);
  assert(b.ackEnqueueJobs === true, '--ack-enqueue-jobs was not parsed');
});

check('the seeder refuses to write without --ack-enqueue-jobs, and the refusal sits before the canary', () => {
  // The Auditor's instruction: enqueue_post_created_job fires on every post
  // insert, so a 1 M-row seed enqueues 1 M jobs; the seeder must refuse without
  // an explicit acknowledgement. --yes is not that acknowledgement.
  const src = readFileSync(new URL('./db-seed-staging.mjs', import.meta.url), 'utf8');
  const refusal = src.indexOf('if (!args.ackEnqueueJobs)');
  const canary = src.indexOf('Canary: inserting');
  assert(refusal > 0, 'no refusal on ackEnqueueJobs');
  assert(canary > 0, 'canary marker not found');
  assert(refusal < canary, 'the refusal comes AFTER the canary insert — a write could happen first');
  assert(/REFUSING:.*enqueue/s.test(src.slice(refusal, canary)), 'the refusal does not say why');
});

check('the seeder never sets session_replication_role', () => {
  // Switching the triggers off would produce a database with no hashtag rows,
  // no queue rows, no fan-out and no counters — one the application could never
  // have produced — which silently changes what every gate measured on it means.
  const src = readFileSync(new URL('./db-seed-staging.mjs', import.meta.url), 'utf8');
  const setsIt = /^\s*[^/].*session_replication_role\s*=/m.test(src)
    || /SET\s+session_replication_role/i.test(src.replace(/^\s*\/\/.*$/gm, ''));
  assert(!setsIt, 'the seeder sets session_replication_role');
});


console.log('\nWorkflows I own');

for (const wf of ['.github/workflows/d1-seed-staging.yml', '.github/workflows/d1-seeder-guard-check.yml']) {
  check(`${wf} · no \${{ }} inside any run: block (F-47's bright line)`, () => {
    // GitHub substitutes an expression into a run: script's TEXT before a shell
    // exists, so a value containing an apostrophe executes ABOVE every check the
    // step then performs. Inputs are bound in env: and read as "$NAME" instead.
    const src = readFileSync(new URL(`../${wf}`, import.meta.url), 'utf8');
    const lines = src.split('\n');
    let inRun = false;
    let runIndent = 0;
    lines.forEach((line, i) => {
      const m = /^(\s*)(- name:.*)?\s*run:\s*\|/.exec(line);
      if (m) { inRun = true; runIndent = (/^(\s*)/.exec(line))[1].length; return; }
      if (inRun) {
        const indent = (/^(\s*)/.exec(line))[1].length;
        if (line.trim() !== '' && indent <= runIndent) { inRun = false; return; }
        assert(!line.includes('${{'), `${wf}:${i + 1} has \${{ }} inside a run: block — ${line.trim()}`);
      }
    });
  });
}


check('d1-seed-staging.yml offers no production target at all', () => {
  const src = readFileSync(new URL('../.github/workflows/d1-seed-staging.yml', import.meta.url), 'utf8');
  assert(!/^\s+- production\s*$/m.test(src), 'production appears as a dispatch option in the seeding workflow');
  assert(/environment:\s*staging/.test(src), 'the seeding job does not pin the staging Environment');
});


check('d1-seeder-guard-check.yml holds no secret: placeholder password, RFC 2606 host, no secrets.* reference', () => {
  const src = readFileSync(new URL('../.github/workflows/d1-seeder-guard-check.yml', import.meta.url), 'utf8');
  assert(!/secrets\./.test(src), 'the guard check reads a secret — it must not need one');
  assert(/NOT-A-REAL-PASSWORD@invalid\.invalid/.test(src), 'the decoy is not the placeholder@reserved-host shape');
  assert(/jtdtehuqtinjxropkkcn/.test(src), 'the decoy does not name the production ref, so it plants nothing');
});


check('none of my workflows grants contents: write', () => {
  for (const wf of ['d1-seed-staging.yml', 'd1-seeder-guard-check.yml']) {
    const src = readFileSync(new URL(`../.github/workflows/${wf}`, import.meta.url), 'utf8');
    assert(!/contents:\s*write/.test(src), `${wf} can write to the repository`);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) process.exit(1);
