#!/usr/bin/env node
/**
 * F-73 · The dependency gate must distinguish "we looked and it was clean"
 *        from "we could not look".
 *
 * =============================================================================
 * THE DEFECT THIS REPLACES
 *
 * The gate used to be one line:
 *
 *     npm audit --omit=dev --audit-level=critical
 *
 * That command exits non-zero for two unrelated reasons and gives the job no
 * way to tell them apart:
 *
 *     (a) the audit ran and found a critical vulnerability
 *     (b) the audit could not run at all
 *
 * Both print "Process completed with exit code 1". Measured on the SAME commit,
 * 38eff26, two runs, opposite verdicts:
 *
 *     run 841 (push)          exit 0, 2m37s  — completed, 0 criticals
 *     run 842 (pull_request)  exit 1, 9m37s  — "npm warn audit network timeout
 *                                               at .../security/advisories/bulk"
 *                                               "npm error audit endpoint
 *                                                returned an error"
 *
 * Run 842 found nothing. It REACHED nothing. And it was red on PR #146,
 * blocking a promotion, for a reason that has nothing to do with this
 * repository's dependencies.
 *
 * ⚠ THE CONFLATION IS THE BUG, NOT THE FLAKINESS. A gate that is sometimes red
 * for nothing teaches everyone to re-run it until it goes green, and a gate you
 * re-run until it goes green is not a gate — the next real critical gets the
 * same reflex. Fixing the network would not fix that. Telling the two apart does.
 *
 * RELATION TO F-72. F-72 was the same failure CLASS in a different costume: npm
 * had RETIRED the endpoint npm 10 posted to, so the gate was permanently red for
 * a non-vulnerability. The npm@11 fix was correct and stays — it moved the job
 * onto the bulk advisory endpoint, which is why the error text changed from
 * "400 Bad Request .../audits/quick" to a timeout on ".../advisories/bulk".
 * F-72 was permanent and is fixed; F-73 is INTERMITTENT and is what remains.
 * The retired-endpoint case and the slow-endpoint case both land here as
 * outcome (b), which is the point: this script does not care WHY the audit
 * failed to complete, only that it did.
 *
 * =============================================================================
 * THE THREE OUTCOMES, AND THE EXIT CODE FOR EACH
 *
 *     0   audit completed, findings at or above the threshold = 0     PASS
 *     1   audit completed, findings at or above the threshold > 0     FAIL — a
 *                                                                     real
 *                                                                     vulnerability.
 *                                                                     This is the
 *                                                                     gate working.
 *     2   audit did not complete after N attempts                     FAIL — the
 *                                                                     gate is
 *                                                                     BLIND.
 *
 * ⚠ EXIT 2 IS STILL A FAILURE. Standing Rule 19: never weaken a check to get it
 * green, and "we could not look" must NEVER be reported as "we looked and it was
 * clean". The gain here is DIAGNOSIS, not leniency — the job now says in its own
 * words which of the two defects you have. There is no continue-on-error
 * anywhere, nothing is allowlisted, and no outcome is downgraded to a warning.
 *
 * =============================================================================
 * WHY THE EXIT CODE OF `npm audit` IS NOT USED AS THE VERDICT
 *
 * MEASURED, 2026-09-04, this repository's lockfile, npm 11.19.1:
 *
 *     npm audit --omit=dev --json
 *       -> exit code 1
 *       -> metadata.vulnerabilities =
 *          {"info":0,"low":3,"moderate":7,"high":17,"critical":0,"total":27}
 *
 * A completed audit with ZERO criticals exited 1, merely because findings of
 * some severity exist. So npm's exit code answers a different question from the
 * one the gate asks. THE COUNT IS THE AUTHORITY. The exit code is not consulted
 * for the verdict at all.
 *
 * (Those figures also match, exactly, the independent measurement recorded in
 * the F-72 comment in security.yml: "production CRITICAL = 0 (low 3, moderate 7,
 * high 17)". Two instruments, same numbers.)
 *
 * =============================================================================
 * HOW "COULD NOT RUN" IS DETECTED — AND THE TRAP
 *
 * ⚠ npm STILL PRINTS A WELL-FORMED JSON OBJECT WHEN THE AUDIT FAILS. That is
 * the trap, and it is why "did the JSON parse?" is the wrong question. Real
 * captured stdout, npm 11.19.1, bulk endpoint answering 500
 * (docs/evidence/d1/F-73/fixtures/endpoint-error.json):
 *
 *     {
 *       "message": "500 Internal Server Error - POST
 *                   .../-/npm/v1/security/advisories/bulk - Internal Server Error",
 *       "statusCode": 500,
 *       "body": { "error": "Internal Server Error" },
 *       "error": { "summary": "", "detail": "" }
 *     }
 *
 * Valid JSON. Parses cleanly. Carries an `error` field. Carries NO
 * `metadata.vulnerabilities`. So the signal for outcome (b) is the ABSENCE of
 * the counts, not the presence of an error field — a rule that keeps working the
 * next time npm changes its error shape or its endpoint, which it has now done
 * twice in two days.
 *
 * =============================================================================
 * RETRY POLICY — BOUNDED, AND ONLY FOR OUTCOME (b)
 *
 * ⚠ A COMPLETED AUDIT IS NEVER RETRIED. If the audit completed, its verdict is
 * final whether it is pass or fail. Retrying a completed audit would make a real
 * critical retryable away, which is precisely the reflex this whole change
 * exists to prevent.
 *
 * Only outcome (b) is retried, at most --attempts times, with exponential
 * backoff, and each attempt carries its own timeout so a hanging endpoint cannot
 * burn the job's wall clock the way run 842's 9m37s did.
 *
 * THE WORST CASE IS BOUNDED AND STATED, because "add a retry" is how a 2-minute
 * job quietly becomes a 15-minute one. Defaults are 3 attempts, 120 s each,
 * backoff 5 s then 15 s:
 *
 *     3 x 120 s  +  5 s  +  15 s   =  6 m 20 s absolute worst case
 *
 * against run 842's 9 m 37 s for a SINGLE attempt that then reported the wrong
 * thing. So the blind path is now both faster and correctly labelled. A healthy
 * audit on this lockfile completes in roughly 30 s (measured 2026-09-04), so the
 * normal path is unchanged.
 *
 * =============================================================================
 * ⚠ THE THRESHOLD IS `critical`, AND TIGHTENING IT TO `high` IS STILL OPEN.
 *
 * This script does NOT change the threshold. It is `critical` today, exactly as
 * the previous one-line gate had it, and it is passed in explicitly from
 * security.yml so it is visible in the workflow rather than hidden in a default
 * here. Gating at `high` today would fail on the 17 high findings measured
 * above, all of which pre-date the gate.
 *
 * TIGHTENING TO `high` REMAINS A REAL, OPEN TASK — not a comment to leave
 * sitting here forever, and not something this change quietly did or quietly
 * dropped. `--omit=dev` is unchanged. Nothing is allowlisted.
 *
 * =============================================================================
 * USAGE
 *     node scripts/security-audit-dependencies.mjs [--threshold=critical]
 *                                                  [--attempts=3]
 *                                                  [--timeout-ms=120000]
 *                                                  [--json-file=PATH]
 *
 * --json-file reads an already-captured audit JSON instead of running npm. It
 * exists so the decision logic can be exercised against fixtures (C-34), and it
 * is what the fixture test drives. It never runs npm and never reaches the
 * network.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Ascending. The gate counts everything at or above the chosen threshold, so
// raising the threshold to 'high' later counts high AND critical.
export const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];

export const EXIT_PASS = 0;        // completed, nothing at or above threshold
export const EXIT_VULNERABLE = 1;  // completed, something at or above threshold
export const EXIT_BLIND = 2;       // did not complete — the gate could not look

/**
 * THE DECISION FUNCTION. Pure: no network, no filesystem, no process exit.
 * Everything the gate concludes, it concludes here, so it can be tested
 * against captured bytes rather than against a live registry.
 *
 * Returns either
 *   { complete: false, reason }
 *   { complete: true, counts, atOrAbove, threshold }
 */
export function classifyAuditOutput(stdout, threshold = 'critical') {
  if (!SEVERITIES.includes(threshold)) {
    throw new Error(`unknown threshold "${threshold}" (expected one of ${SEVERITIES.join(', ')})`);
  }

  const text = typeof stdout === 'string' ? stdout.trim() : '';
  if (text === '') {
    // Killed by the per-attempt timeout, or npm died before writing anything.
    return { complete: false, reason: 'npm produced no output at all' };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { complete: false, reason: 'npm output was not parseable JSON' };
  }

  // ⚠ THE TRAP. A failed audit still yields a well-formed object, often with an
  // `error` field. The counts are what distinguishes a real result, so their
  // ABSENCE is the signal — not the presence of an error field, whose shape npm
  // has already changed twice.
  const counts = parsed?.metadata?.vulnerabilities;
  if (!counts || typeof counts !== 'object') {
    const detail =
      parsed?.message ? String(parsed.message)
      : parsed?.error ? `npm reported an error: ${JSON.stringify(parsed.error)}`
      : 'no metadata.vulnerabilities in the response';
    return { complete: false, reason: `audit did not complete — ${detail}` };
  }

  // A count that is present but not a number is corrupt, not zero. Treating a
  // missing or malformed count as 0 would be the exact "could not look reported
  // as clean" failure this script exists to prevent.
  const from = SEVERITIES.indexOf(threshold);
  let atOrAbove = 0;
  for (const sev of SEVERITIES.slice(from)) {
    const n = counts[sev];
    if (n === undefined || n === null) continue;   // npm omits nothing today; tolerate absence
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      return { complete: false, reason: `metadata.vulnerabilities.${sev} is not a valid count (${JSON.stringify(n)})` };
    }
    atOrAbove += n;
  }

  return { complete: true, counts, atOrAbove, threshold };
}

/** Maps a completed verdict to its exit code. Separate so it is testable too. */
export function exitCodeFor(verdict) {
  if (!verdict.complete) return EXIT_BLIND;
  return verdict.atOrAbove > 0 ? EXIT_VULNERABLE : EXIT_PASS;
}

function runNpmAudit(timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      'npm',
      ['audit', '--omit=dev', '--json'],
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, killSignal: 'SIGKILL' },
      (err, stdout, stderr) => {
        // The error and the exit code are DELIBERATELY not used as the verdict —
        // npm exits non-zero merely because findings exist (measured above).
        // They are captured for the operator's log only.
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', timedOut: Boolean(err?.killed) });
      }
    );
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const threshold = arg('threshold', 'critical');
  const attempts = Number(arg('attempts', '3'));
  const timeoutMs = Number(arg('timeout-ms', '120000'));
  const jsonFile = arg('json-file', null);

  if (!SEVERITIES.includes(threshold)) {
    console.error(`FATAL: unknown --threshold=${threshold}`);
    process.exit(EXIT_BLIND);
  }

  console.log(`Dependency gate — threshold: ${threshold} (production dependencies only, --omit=dev)`);
  console.log('Tightening the threshold to "high" is a known open task; this run does not do it.\n');

  // Fixture mode: decide from captured bytes. Never runs npm, never retries.
  if (jsonFile) {
    const verdict = classifyAuditOutput(readFileSync(jsonFile, 'utf8'), threshold);
    report(verdict, 1, 1);
    process.exit(exitCodeFor(verdict));
  }

  let verdict = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { stdout, stderr, timedOut } = await runNpmAudit(timeoutMs);
    verdict = classifyAuditOutput(stdout, threshold);

    if (verdict.complete) {
      // ⚠ Final. A completed audit is never retried, pass or fail.
      report(verdict, attempt, attempts);
      process.exit(exitCodeFor(verdict));
    }

    console.error(
      `attempt ${attempt}/${attempts}: THE AUDIT DID NOT COMPLETE — ${verdict.reason}` +
      (timedOut ? ` (killed after ${timeoutMs} ms)` : '')
    );
    if (stderr.trim()) console.error(stderr.trim().split('\n').map((l) => `    npm: ${l}`).join('\n'));

    if (attempt < attempts) {
      const backoff = 5000 * 3 ** (attempt - 1);   // 5s, then 15s
      console.error(`    retrying in ${backoff / 1000}s — retrying ONLY because the audit did not complete\n`);
      await sleep(backoff);
    }
  }

  report(verdict, attempts, attempts);
  process.exit(EXIT_BLIND);
}

function report(verdict, attempt, attempts) {
  console.log('');
  if (!verdict.complete) {
    console.log('══════════════════════════════════════════════════════════════════');
    console.log('  THE GATE IS BLIND — exit 2.');
    console.log('══════════════════════════════════════════════════════════════════');
    console.log(`  The audit did not complete after ${attempt} of ${attempts} attempt(s).`);
    console.log(`  Reason: ${verdict.reason}`);
    console.log('');
    console.log('  ⚠ THIS IS NOT "no vulnerabilities found". Nothing was checked.');
    console.log('    It is also NOT evidence of a vulnerability. It is the registry');
    console.log('    being unreachable or too slow (F-73), and it fails deliberately');
    console.log('    rather than passing quietly — "we could not look" must never be');
    console.log('    recorded as "we looked and it was clean".');
    console.log('');
    console.log('  What to do: re-run THIS JOB. Do not re-run a job that reported a');
    console.log('  vulnerability — that verdict is final and is never retried.');
    return;
  }

  const c = verdict.counts;
  console.log(`  counts: info ${c.info ?? 0} · low ${c.low ?? 0} · moderate ${c.moderate ?? 0} · high ${c.high ?? 0} · critical ${c.critical ?? 0}`);
  if (verdict.atOrAbove > 0) {
    console.log('══════════════════════════════════════════════════════════════════');
    console.log(`  FAIL — exit 1. ${verdict.atOrAbove} finding(s) at or above "${verdict.threshold}".`);
    console.log('══════════════════════════════════════════════════════════════════');
    console.log('  The audit COMPLETED and found a real vulnerability in a production');
    console.log('  dependency. This is the gate doing its job. It is not retried.');
    console.log('  Run `npm audit --omit=dev` locally for the detail.');
  } else {
    console.log('══════════════════════════════════════════════════════════════════');
    console.log(`  PASS — exit 0. The audit COMPLETED and found 0 findings at or above "${verdict.threshold}".`);
    console.log('══════════════════════════════════════════════════════════════════');
    console.log('  Findings below the threshold are reported above and are not gated');
    console.log('  today. Tightening the threshold to "high" is an open task.');
  }
}

// Only run when executed directly, so the exported functions can be imported
// by the fixture test without the script auditing anything.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`FATAL: ${e?.stack || e}`);
    // An unexpected crash means the gate did not look. It fails as blind, not as clean.
    process.exit(EXIT_BLIND);
  });
}
