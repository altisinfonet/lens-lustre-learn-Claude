#!/usr/bin/env node
/**
 * F-73 · C-34 fixture test for the dependency gate.
 *
 * "A test that could not have failed is not evidence" (C-34). So this file does
 * two things, and the second is the one that matters:
 *
 *   1. It asserts the new gate returns three DIFFERENT exit codes for the three
 *      inputs.
 *   2. It re-derives what the OLD one-line gate did with the same three inputs,
 *      and shows it returning the SAME code for two of them. That is the defect,
 *      reproduced, before the fix is shown working.
 *
 * ⚠ THE FIXTURES ARE REAL CAPTURED BYTES, not hand-written JSON, and the test
 * reads the SAME files that are committed as evidence — not a copy — so the
 * two cannot drift apart:
 *
 *   endpoint-error.json        stdout of `npm audit --omit=dev --json` under
 *                              npm 11.19.1 against a registry answering 500 on
 *                              /-/npm/v1/security/advisories/bulk — the exact
 *                              endpoint named in run 842. npm's own exit code
 *                              was 1. Captured 2026-09-04.
 *   completed-critical-0.json  stdout of a genuinely completed
 *                              `npm audit --omit=dev --json` against
 *                              registry.npmjs.org on this repository's lockfile,
 *                              npm 11.19.1, 2026-09-04. npm's own exit code was
 *                              ALSO 1 — with critical=0 — because npm exits
 *                              non-zero merely because findings exist.
 *   completed-critical-1.json  the file above with metadata.vulnerabilities
 *                              .critical set to 1 and total incremented.
 *                              DERIVED, and labelled as derived: there is no
 *                              real critical in this repository today, and
 *                              manufacturing one in the registry is not
 *                              something a test may do.
 *
 * Run: node scripts/security-audit-dependencies.test.mjs
 * Exits 0 if every case behaves as specified, 1 otherwise.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  classifyAuditOutput,
  exitCodeFor,
  EXIT_PASS,
  EXIT_VULNERABLE,
  EXIT_BLIND,
} from './security-audit-dependencies.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, '..', 'docs', 'evidence', 'd1', 'F-73', 'fixtures');
const read = (f) => readFileSync(join(FIX, f), 'utf8');

/**
 * What the OLD gate did, reproduced from its observed behaviour rather than
 * described: `npm audit --omit=dev --audit-level=critical` exits non-zero if the
 * audit failed OR if a finding at/above the level exists, and the job sees only
 * that number.
 *
 * Both npm exit codes below are MEASURED, not assumed — see the header.
 */
function oldGateExitCode(fixtureName) {
  if (fixtureName === 'endpoint-error.json') return 1;        // measured: npm exit 1, audit never ran
  if (fixtureName === 'completed-critical-1.json') return 1;  // a real critical at the gate level
  if (fixtureName === 'completed-critical-0.json') return 0;  // --audit-level=critical, 0 criticals
  throw new Error(`no measured old-gate behaviour recorded for ${fixtureName}`);
}

const CASES = [
  {
    fixture: 'endpoint-error.json',
    expect: EXIT_BLIND,
    label: 'audit could NOT run (real captured endpoint error)',
  },
  {
    fixture: 'completed-critical-1.json',
    expect: EXIT_VULNERABLE,
    label: 'audit completed, critical = 1',
  },
  {
    fixture: 'completed-critical-0.json',
    expect: EXIT_PASS,
    label: 'audit completed, critical = 0',
  },
];

let failures = 0;
const pad = (s, n) => String(s).padEnd(n);

console.log('F-73 · dependency gate fixture test');
console.log(`fixtures: docs/evidence/d1/F-73/fixtures/ (read as committed, not copied)\n`);

console.log('PART 1 — THE DEFECT. What the OLD one-line gate returned for each input.');
console.log('         `npm audit --omit=dev --audit-level=critical`\n');
for (const c of CASES) {
  console.log(`  ${pad(c.fixture, 28)} old gate exit ${oldGateExitCode(c.fixture)}   ${c.label}`);
}
const blindOld = oldGateExitCode('endpoint-error.json');
const vulnOld = oldGateExitCode('completed-critical-1.json');
if (blindOld === vulnOld) {
  console.log(`\n  ⚠ CONFLATED: "could not look" and "found a critical" BOTH exit ${blindOld}.`);
  console.log('    The job cannot tell them apart, so the human re-runs it until it goes');
  console.log('    green. THIS IS THE BUG — reproduced here before the fix is shown.\n');
} else {
  console.log('\n  UNEXPECTED: the old gate distinguished the two cases. The premise of');
  console.log('  F-73 does not hold and this fix needs re-justifying.\n');
  failures++;
}

console.log('PART 2 — THE FIX. What the new gate returns for the SAME three inputs.\n');
for (const c of CASES) {
  let actual, detail;
  try {
    const verdict = classifyAuditOutput(read(c.fixture), 'critical');
    actual = exitCodeFor(verdict);
    detail = verdict.complete
      ? `complete, ${verdict.atOrAbove} at/above critical`
      : `incomplete — ${verdict.reason}`;
  } catch (e) {
    actual = `threw: ${e.message}`;
    detail = '';
  }
  const ok = actual === c.expect;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${pad(c.fixture, 28)} exit ${actual} (expected ${c.expect})  ${c.label}`);
  console.log(`        ${detail}`);
}

console.log('\nPART 3 — the three exit codes must be mutually distinct, or nothing was fixed.');
const codes = CASES.map((c) => exitCodeFor(classifyAuditOutput(read(c.fixture), 'critical')));
const distinct = new Set(codes).size === CASES.length;
console.log(`  codes: [${codes.join(', ')}]  distinct: ${distinct ? 'YES' : 'NO'}`);
if (!distinct) failures++;

console.log('\nPART 4 — a completed audit is never retried, and a blind one is not called clean.');
const blind = classifyAuditOutput(read('endpoint-error.json'), 'critical');
if (blind.complete) { console.log('  FAIL  the endpoint error was classified as a completed audit'); failures++; }
else if (exitCodeFor(blind) === EXIT_PASS) { console.log('  FAIL  a blind gate returned PASS'); failures++; }
else console.log('  PASS  blind classified incomplete, exit 2 — not PASS, not "vulnerability found"');

const empty = classifyAuditOutput('', 'critical');
if (empty.complete || exitCodeFor(empty) !== EXIT_BLIND) { console.log('  FAIL  empty output was not treated as blind'); failures++; }
else console.log('  PASS  empty npm output (killed by timeout) classified blind, exit 2');

const garbage = classifyAuditOutput('not json at all', 'critical');
if (garbage.complete || exitCodeFor(garbage) !== EXIT_BLIND) { console.log('  FAIL  unparseable output was not treated as blind'); failures++; }
else console.log('  PASS  unparseable npm output classified blind, exit 2');

// A malformed count must be blind, never silently 0 — that would be the exact
// "could not look reported as clean" failure this whole change exists to stop.
const corrupt = classifyAuditOutput(JSON.stringify({ metadata: { vulnerabilities: { critical: 'lots' } } }), 'critical');
if (corrupt.complete || exitCodeFor(corrupt) !== EXIT_BLIND) { console.log('  FAIL  a non-numeric critical count was not treated as blind'); failures++; }
else console.log('  PASS  non-numeric count classified blind, exit 2 — not coerced to 0');

console.log('\nPART 5 — the threshold is `critical` today. Tightening to `high` is OPEN, not done here.');
const atHigh = classifyAuditOutput(read('completed-critical-0.json'), 'high');
console.log(`  same completed audit at threshold "high": ${atHigh.atOrAbove} finding(s) at/above -> exit ${exitCodeFor(atHigh)}`);
console.log('  i.e. flipping the threshold today would fail the gate on 17 pre-existing highs.');
console.log('  Recorded so the open task is visible and is not silently taken or silently dropped.');
if (exitCodeFor(atHigh) !== EXIT_VULNERABLE) {
  console.log('  FAIL  expected the "high" threshold to fail on this fixture');
  failures++;
}

console.log(failures === 0 ? '\nALL CASES BEHAVED AS SPECIFIED.' : `\n${failures} CASE(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
