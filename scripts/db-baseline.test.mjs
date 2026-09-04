#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// D1 · TESTS FOR THE PHASE 0 INSTRUMENTS.
//
// Run:  node scripts/db-baseline.test.mjs
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

import {
  LANES, PRODUCTION_REF, assertLane, refParsedFromDsn, refuseProduction,
  scrub, scrubExternal, redactSecrets, psqlPayload } from './db-lane-guard.mjs';
import { PROBES, ADDENDUM_CLAIMS, wrap } from './db-baseline.mjs';

// The seeder has its own suite, scripts/db-seed-staging.test.mjs. The two are
// separate files on purpose: 0-D1-04 lands the baseline and the seeder as
// different PRs, and a suite that imports both cannot run on either PR alone.

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

console.log('\nLane guard');

check('a session-pooler string yields its project ref', () => {
  assert(refParsedFromDsn(POOLER_STAGING) === LANES.staging.ref, refParsedFromDsn(POOLER_STAGING));
});

check('a DIRECT string parses to nothing and is not guessed at', () => {
  // A direct string's username is a bare `postgres` with no `.<ref>`. The gate
  // must return null rather than inventing a ref from the hostname — the
  // hostname is not what the credential authenticates as.
  assert(refParsedFromDsn(DIRECT_STAGING) === null, `expected null, got ${refParsedFromDsn(DIRECT_STAGING)}`);
});

check('a production credential aimed at the staging lane is REFUSED', () => {
  throws(() => assertLane('staging', POOLER_PROD), /refusing/i);
});

check('a staging credential aimed at the production lane is REFUSED', () => {
  throws(() => assertLane('production', POOLER_STAGING), /refusing/i);
});

check('an unparseable credential is REFUSED rather than waved through', () => {
  throws(() => assertLane('staging', DIRECT_STAGING), /Could not parse a project ref/);
});

check('an unknown lane name is REFUSED', () => {
  throws(() => assertLane('prod', POOLER_STAGING), /Unknown target/);
});

check('refuseProduction names production explicitly in its refusal', () => {
  throws(() => refuseProduction(POOLER_PROD), new RegExp(PRODUCTION_REF));
});

check('refuseProduction allows staging through', () => {
  assert(refuseProduction(POOLER_STAGING) === LANES.staging.ref);
});

check('the two lanes have distinct, non-empty cluster fingerprints', () => {
  const a = LANES.production.system_identifier;
  const b = LANES.staging.system_identifier;
  assert(a && b, 'a fingerprint is empty');
  assert(a !== b, 'both lanes carry the same fingerprint — the check would never fire');
  assert(/^\d+$/.test(a) && /^\d+$/.test(b), 'a fingerprint is not a bare integer');
});

console.log('\nCredential scrubbing');

check('scrub removes the literal credential', () => {
  process.env.SUPABASE_DB_URL = POOLER_PROD;
  assert(!scrub(`connecting to ${POOLER_PROD} now`).includes('pw@'), 'the credential survived scrub()');
  delete process.env.SUPABASE_DB_URL;
});

check('⟵ REGRESSION · scrub does NOT eat the shape in our own help text', () => {
  // The first version of this code applied one aggressive scrubber to
  // everything, so the message whose entire job is to tell the operator what a
  // correct connection string looks like printed "postgres://«redacted»".
  // A control that destroys its own instruction is a defect.
  const help = 'Expected postgresql://postgres.<ref>:<password>@...:5432/postgres.';
  assert(scrub(help) === help, `scrub() mangled its own help text: ${scrub(help)}`);
});

check('scrubExternal DOES redact a URI psql echoed back at us', () => {
  const out = scrubExternal(`could not connect to ${POOLER_PROD}`);
  assert(!out.includes('pw@'), 'a credential survived scrubExternal()');
  assert(out.includes('«redacted»'), out);
});

check('redactSecrets removes a JWT from data about to be written to a file', () => {
  // ⟵ F-61. This fixture used to be the canonical jwt.io example token as a
  // string literal. It is not a credential and grants nothing — but the secret
  // scan (gitleaks, rule `jwt`) flagged it, and .gitleaks.toml allowlists exact
  // literals only and says so in its own header. The control was working as
  // designed, so the fixture changed, not the control. It is now BUILT at
  // runtime from the same header and payload objects, so no JWT-shaped literal
  // exists anywhere in the tree and the scan has nothing to find. The test's
  // meaning is unchanged: redactSecrets() still receives a real-shaped JWT
  // (three base64url segments, each well over the 10-character floor the
  // redactor's pattern requires) and must remove it.
  const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v))
    .toString('base64url');
  const jwt = [
    b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({ sub: '1234567890' }),
    b64url('a signature-shaped third segment, long enough to match'),
  ].join('.');
  // The fixture must have teeth: if it does not look like a JWT to the
  // redactor's own pattern, a pass here would prove nothing.
  assert(/^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(jwt),
    `the runtime-built fixture is not JWT-shaped: ${jwt}`);
  const out = redactSecrets({ nested: [{ command: `curl -H "Authorization: Bearer ${jwt}"` }] });
  assert(!JSON.stringify(out).includes(jwt.slice(0, 40)), 'a JWT survived redactSecrets()');
});


console.log('\nProbe set');

check('every probe carries an id, a title, a reason and SQL', () => {
  for (const p of PROBES) {
    assert(p.id && p.title && p.why && p.sql, `probe ${p.id || '(unnamed)'} is incomplete`);
  }
});

check('probe ids are unique', () => {
  const ids = PROBES.map((p) => p.id);
  assert(new Set(ids).size === ids.length, `duplicate probe id in: ${ids.join(', ')}`);
});

check('every probe is a single statement — no statement separator outside a literal', () => {
  // ⟵ THE FIRST VERSION OF THIS TEST WAS WRONG, and it is worth leaving the
  // note. It flagged S3, whose counting_rule string contains a semicolon inside
  // a quoted literal. S3 is a single statement — proved by running it. A
  // semicolon inside a string is not a separator, and the fix was to correct
  // the test rather than to reword the SQL so the test would pass. Rewording
  // the thing being measured to satisfy the instrument is the mistake this
  // whole file exists to catch.
  const stripLiterals = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");
  for (const p of PROBES) {
    assert(!stripLiterals(p.sql).includes(';'), `probe ${p.id} contains a statement separator`);
  }
});

check('the stripLiterals helper actually strips — a planted separator is still caught', () => {
  // A test whose helper silently matched nothing would pass for every input.
  const stripLiterals = (sql) => sql.replace(/'(?:[^']|'')*'/g, "''");
  assert(stripLiterals("SELECT 'a;b'") === "SELECT ''", stripLiterals("SELECT 'a;b'"));
  assert(stripLiterals('SELECT 1; DROP TABLE x').includes(';'), 'a real separator was swallowed');
});

check('the wrapper stamps EVERY ROW, not the run', () => {
  // The gate sentence is literal: "with the timestamp of measurement on every
  // line". A single run-level timestamp would not satisfy it, and probes run
  // seconds apart on a live system.
  const w = wrap('SELECT 1 AS x');
  assert(w.includes('measured_at_utc'), 'no per-row timestamp');
  assert(w.includes('clock_timestamp()'), 'used a transaction-stable timestamp, not a per-row one');
  assert(w.includes('jsonb_agg'), 'rows are not aggregated per row');
});

check('⟵ REGRESSION · no probe uses `NOT ~*`, which PostgreSQL does not parse', () => {
  // Postgres has no `NOT <operator>` form; the negated regex operator is `!~*`.
  // This shipped once and was caught by running the probes, not by reading them.
  for (const p of PROBES) {
    assert(!/NOT\s+~\*/.test(p.sql), `probe ${p.id} uses NOT ~*`);
  }
});

check('⟵ REGRESSION · R1 does not read pg_stat_statements_info.statements', () => {
  // That column does not exist. The view has exactly dealloc and stats_reset.
  const r1 = PROBES.find((p) => p.id === 'R1');
  assert(!/\bstatements\s+FROM\s+pg_stat_statements_info/i.test(r1.sql), 'R1 reads a column that does not exist');
  assert(/dealloc/.test(r1.sql), 'R1 does not report dealloc, so it cannot say whether its denominator is complete');
});

check('C-2 HARD HOLD · the unused-index probe emits several named methods, never one number', () => {
  const i2 = PROBES.find((p) => p.id === 'I2');
  const methods = i2.sql.match(/'M\d[A-Za-z0-9_]*'/g) || [];
  assert(methods.length >= 4, `I2 emits ${methods.length} methods; C-2 requires the disagreement to be reproduced, not resolved`);
  assert(/M5|total/i.test(i2.sql), 'I2 has no denominator, so its counts cannot be interpreted');
});

check('no probe reads an application table', () => {
  // Control 4: catalogue and statistics views only. cron.job_run_details is a
  // platform table, not member data, and is counted rather than selected from.
  const forbidden = /\bFROM\s+public\./i;
  for (const p of PROBES) {
    assert(!forbidden.test(p.sql), `probe ${p.id} selects from a public table`);
  }
});

check('every addendum claim names a probe that exists', () => {
  const ids = new Set(PROBES.map((p) => p.id));
  for (const c of ADDENDUM_CLAIMS) {
    assert(ids.has(c.probe), `claim ${c.id} names probe ${c.probe}, which does not exist`);
  }
});

check('the C-2 claim is carried in the re-check list and still names four numbers', () => {
  const c2 = ADDENDUM_CLAIMS.find((c) => /HARD HOLD/.test(c.claim));
  assert(c2, 'C-2 is not in the re-check list at all');
  assert(/79/.test(c2.value) && /78/.test(c2.value) && /298/.test(c2.value) && /188/.test(c2.value),
    `the C-2 claim no longer carries all four unreconciled numbers: ${c2.value}`);
});


// ── F-84 · every session setting must travel as SQL, not as PGOPTIONS ───────
console.log('\nF-84 · session settings through the pooler');

check('⟵ REGRESSION F-84 · statement_timeout travels in the query stream, with the caller\'s value', () => {
  // THE DEFECT. The 100k seed (run 33892294982) died at 80,200 rows with
  // "canceling statement due to statement timeout" at 16:06:07.461Z, on a
  // connection open exactly 120.14 s. The seeder had asked for 600 s — through
  // PGOPTIONS, which F-78 had already proved the session pooler does not
  // forward. The server's own 120 s stood. A limit set out of the way that was
  // never actually moved.
  const p = psqlPayload('INSERT INTO t VALUES (1)', { readOnly: false, timeoutMs: 600000 });
  assert(/SET LOCAL statement_timeout = 600000;/.test(p),
    `statement_timeout does not travel as SET LOCAL, or lost the caller's value: ${p}`);
  assert(p.indexOf('SET LOCAL statement_timeout') < p.indexOf('INSERT'),
    'the timeout is set after the statement it is supposed to bound');
  // The write path opens its own transaction. Measured on the fixture: psql
  // already wraps a multi-statement -c in one implicit transaction (txid 741,
  // 741), so SET LOCAL would bite without this — the explicit BEGIN is here so
  // the guarantee rests on the SQL we send rather than on a psql client
  // behaviour that could change under us. That is the F-78/F-84 lesson: never
  // let a control depend on how the transport happens to behave.
  assert(/^BEGIN;/.test(p.trim()), `a write payload does not open a transaction: ${p}`);
  assert(p.trim().endsWith('COMMIT;'), 'a write payload does not commit');
  assert(p.indexOf('BEGIN;') < p.indexOf('SET LOCAL'),
    'SET LOCAL lands before BEGIN, where it is a no-op');
});

check('⟵ REGRESSION F-84 · lock_timeout and idle_in_transaction travel too', () => {
  // These were in the same PGOPTIONS string and had no second mechanism either.
  // F-78 fixed one of four and its comment called the rest "belt and braces".
  const p = psqlPayload('SELECT 1', { readOnly: false, timeoutMs: 1000 });
  assert(/SET LOCAL lock_timeout = 5000;/.test(p), 'lock_timeout still relies on PGOPTIONS');
  assert(/SET LOCAL idle_in_transaction_session_timeout = 120000;/.test(p),
    'idle_in_transaction_session_timeout still relies on PGOPTIONS');
  assert(!/SET (?!LOCAL)/.test(p),
    `a session-level SET would leak to whatever reuses this pooled backend: ${p}`);
});

check('⟵ REGRESSION F-78 · the read-only wrapper is not regressed, and SET LOCAL sits INSIDE it', () => {
  const p = psqlPayload('SELECT 1', { readOnly: true, timeoutMs: 180000 });
  assert(/BEGIN READ ONLY;/.test(p), 'the read-only wrapper is gone — F-78 regressed');
  // ⚠ The order is the OPPOSITE of what I first wrote. SET LOCAL must land
  // INSIDE the transaction; before BEGIN it is a no-op outside any transaction.
  assert(p.indexOf('BEGIN READ ONLY') < p.indexOf('SET LOCAL statement_timeout'),
    'SET LOCAL lands before BEGIN READ ONLY, where it does nothing');
  assert(p.indexOf('SET LOCAL statement_timeout') < p.indexOf('SELECT 1'),
    'the timeout is set after the statement it bounds');
});

check('⟵ REGRESSION F-84 · a WRITE payload is never wrapped read-only', () => {
  // The seeder passes readOnly:false on every call. If the wrapper or the
  // read-only SET leaked into the write path the seeder could not write at all.
  const p = psqlPayload('INSERT INTO t VALUES (1)', { readOnly: false, timeoutMs: 600000 });
  assert(!/READ ONLY/.test(p), 'a write payload is wrapped in a read-only transaction');
  assert(!/default_transaction_read_only/.test(p), 'a write payload sets default_transaction_read_only');
});


console.log('\nWorkflows I own');

for (const wf of ['.github/workflows/d1-baseline.yml', '.github/workflows/d1-guard-check.yml']) {
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


check('⟵ REGRESSION 0-D1-01 · the baseline is recoverable from the log, not only from the artifact', () => {
  // A baseline that was measured correctly and cannot be committed leaves the
  // task open with nothing wrong with the measurement. That is what happened on
  // 2026-09-04: run 9939163591's artifact returned 403 from the blob store, and
  // the only other route was a step printing the first 4000 bytes — a preview,
  // not a recovery, because a truncated JSON does not parse.
  const src = readFileSync(new URL('../.github/workflows/d1-baseline.yml', import.meta.url), 'utf8');
  assert(/base64 -w 100/.test(src), 'the workflow no longer emits the whole file as base64');
  assert(/sha256sum/.test(src), 'the workflow emits base64 with no checksum — a transcription error would be silent');
  assert(/BEGIN BASE64/.test(src) && /END BASE64/.test(src),
    'the base64 block has no delimiters, so it cannot be sliced out of a log mechanically');
  // Proved by round trip 2026-09-04: a 37,437-byte artefact recovered
  // byte-identical, and flipping one base64 character changed the sha256.
});

check('⟵ REGRESSION F-78 · the artefact does not claim PGOPTIONS is what enforces read-only', () => {
  // Standing Rule 21: an instructing comment is a control, and this string is
  // worse than a comment — it is metadata that ships inside the committed
  // evidence. F-78 measured that PGOPTIONS does not survive the Supabase session
  // pooler; the wrapper does the work. A baseline whose own instrument block
  // names the wrong mechanism is a document disagreeing with the system it
  // claims to describe.
  const src = readFileSync(new URL('./db-baseline.mjs', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('read_only:'), src.indexOf('read_only:') + 700);
  assert(/BEGIN READ ONLY/.test(block),
    'the artefact does not say the read-only wrapper is what enforces read-only');
  assert(/25006/.test(block), 'the artefact no longer names the negative control that proves it');
  assert(/F-78/.test(block) && /pooler/.test(block),
    'the artefact still presents PGOPTIONS without recording that F-78 measured it inoperative here');
});


check('d1-guard-check.yml holds no secret: placeholder password, RFC 2606 host, no secrets.* reference', () => {
  const src = readFileSync(new URL('../.github/workflows/d1-guard-check.yml', import.meta.url), 'utf8');
  assert(!/secrets\./.test(src), 'the guard check reads a secret — it must not need one');
  assert(/NOT-A-REAL-PASSWORD@invalid\.invalid/.test(src), 'the decoy is not the placeholder@reserved-host shape');
  assert(/jtdtehuqtinjxropkkcn/.test(src), 'the decoy does not name the production ref, so it plants nothing');
});


check('none of my workflows grants contents: write', () => {
  for (const wf of ['d1-baseline.yml', 'd1-guard-check.yml']) {
    const src = readFileSync(new URL(`../.github/workflows/${wf}`, import.meta.url), 'utf8');
    assert(!/contents:\s*write/.test(src), `${wf} can write to the repository`);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length > 0) process.exit(1);
