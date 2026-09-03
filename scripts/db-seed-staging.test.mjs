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
import { SEED_NAMESPACE, insertBatchSql, parseArgs, TEARDOWN_SQL } from './db-seed-staging.mjs';

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
