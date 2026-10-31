#!/usr/bin/env node
/**
 * Test Agent — runs every push + every 5 min.
 * Outputs:
 *   .lovable/test-reports/latest.md
 *   .lovable/test-reports/history/<ts>.md
 *   .lovable/test-reports/latest.json
 *   GITHUB_STEP_SUMMARY (if in CI)
 * Posts results to public.record_test_agent_run via supabase REST.
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://isywidnfnjhtydmdfgtk.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzeXdpZG5mbmpodHlkbWRmZ3RrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NDIyNDQsImV4cCI6MjA4NzUxODI0NH0.M2Kd2YQ9-D0koY68AX-AEXA2ry-kg53aDnFMY2G3jfQ';
const INGEST_TOKEN = process.env.TEST_AGENT_INGEST_TOKEN || '';
const RUN_ID = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
const TRIGGER = process.env.GITHUB_EVENT_NAME || 'manual';
const COMMIT = process.env.GITHUB_SHA || 'local';
const BRANCH = process.env.GITHUB_REF_NAME || 'local';
const RUN_URL = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${RUN_ID}`
  : '';

const failures = [];
const checks = {};
const start = Date.now();

function run(label, cmd, opts = {}) {
  const t0 = Date.now();
  try {
    execSync(cmd, { stdio: 'pipe', encoding: 'utf-8', ...opts });
    checks[label] = { pass: true, ms: Date.now() - t0 };
    console.log(`✅ ${label} (${Date.now() - t0}ms)`);
    return true;
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    checks[label] = { pass: false, ms: Date.now() - t0, err: out.slice(-2000) };
    failures.push({ check: label, error: out.slice(-500) });
    console.log(`❌ ${label} (${Date.now() - t0}ms)`);
    return false;
  }
}

// 1. tsc
run('tsc', 'npx tsc --noEmit');

// 2. vitest (allow-empty: only run if config exists)
if (existsSync('vitest.config.ts') || existsSync('vitest.config.js')) {
  run('vitest', 'npx vitest run --reporter=basic');
} else {
  checks.vitest = { pass: true, ms: 0, skipped: true };
}

// 3. eslint
run('eslint', 'npx eslint . --max-warnings=0 --quiet');

// 4. Live DB health snapshot
let health = null;
try {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_test_agent_health_admin`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const arr = await res.json();
  health = Array.isArray(arr) ? arr[0] : arr;
  checks.db_health = {
    pass: health?.rpc_parity_pass === true && (health?.nr_drift_5min ?? 0) === 0,
    ms: 0,
    data: health,
  };
  if (!checks.db_health.pass) {
    failures.push({
      check: 'db_health',
      error: `parity=${health?.rpc_parity_pass} mismatch=${health?.rpc_parity_mismatch_count} drift_5m=${health?.nr_drift_5min}`,
    });
  }
} catch (e) {
  checks.db_health = { pass: false, ms: 0, err: e.message };
  failures.push({ check: 'db_health', error: e.message });
}

const status = failures.length === 0 ? 'passed' : 'failed';
const duration = Date.now() - start;
const ts = new Date().toISOString();

// Build markdown report
const md = `# Test Agent Report — ${status === 'passed' ? '✅ PASSED' : '❌ FAILED'}

**Time:** ${ts}
**Trigger:** \`${TRIGGER}\`
**Branch:** \`${BRANCH}\`
**Commit:** \`${COMMIT.slice(0, 7)}\`
**Duration:** ${(duration / 1000).toFixed(1)}s
${RUN_URL ? `**Run:** ${RUN_URL}` : ''}

## Checks

| Check | Status | Time |
|-------|--------|------|
| tsc --noEmit | ${checks.tsc?.pass ? '✅' : '❌'} | ${checks.tsc?.ms ?? 0}ms |
| vitest | ${checks.vitest?.skipped ? '⏭️ skipped' : checks.vitest?.pass ? '✅' : '❌'} | ${checks.vitest?.ms ?? 0}ms |
| eslint | ${checks.eslint?.pass ? '✅' : '❌'} | ${checks.eslint?.ms ?? 0}ms |
| DB health | ${checks.db_health?.pass ? '✅' : '❌'} | live |

## Live DB Health

- **RPC parity:** ${health?.rpc_parity_pass ? '✅ healthy' : '❌ ' + health?.dual_emit_status}
- **Sample size:** ${health?.rpc_parity_sample_size ?? 'n/a'}
- **Mismatch count:** ${health?.rpc_parity_mismatch_count ?? 'n/a'}
- **NR drift (5min):** ${health?.nr_drift_5min ?? 'n/a'}
- **NR drift (24h):** ${health?.nr_drift_24h ?? 'n/a'}

${failures.length ? '## Failures\n\n' + failures.map(f => `### ${f.check}\n\`\`\`\n${f.error}\n\`\`\``).join('\n\n') : '## ✅ All checks passed.\n'}
`;

mkdirSync('.lovable/test-reports/history', { recursive: true });
writeFileSync('.lovable/test-reports/latest.md', md);
writeFileSync(`.lovable/test-reports/history/${ts.replace(/[:.]/g, '-')}.md`, md);
writeFileSync('.lovable/test-reports/latest.json', JSON.stringify({
  ts, status, trigger: TRIGGER, commit: COMMIT, branch: BRANCH,
  duration_ms: duration, checks, health, failures, run_url: RUN_URL,
}, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: 'a' });
}

// Post to DB
if (INGEST_TOKEN) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_test_agent_run`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_token: INGEST_TOKEN,
        p_run_id: RUN_ID,
        p_trigger: TRIGGER === 'pull_request' || TRIGGER === 'push' || TRIGGER === 'schedule' || TRIGGER === 'workflow_dispatch' ? TRIGGER : 'manual',
        p_commit_sha: COMMIT,
        p_branch: BRANCH,
        p_status: status,
        p_rpc_parity_pass: health?.rpc_parity_pass ?? null,
        p_nr_drift_5min: health?.nr_drift_5min ?? null,
        p_dual_emit_status: health?.dual_emit_status ?? null,
        p_tsc_pass: checks.tsc?.pass ?? null,
        p_vitest_pass: checks.vitest?.pass ?? null,
        p_eslint_pass: checks.eslint?.pass ?? null,
        p_failures: failures,
        p_duration_ms: duration,
        p_github_run_url: RUN_URL,
      }),
    });
    if (!res.ok) console.error('record_test_agent_run failed:', res.status, await res.text());
    else console.log('✅ Logged run to DB');
  } catch (e) { console.error('DB post error:', e.message); }
} else {
  console.warn('⚠️ TEST_AGENT_INGEST_TOKEN not set — skipping DB log');
}

process.exit(status === 'passed' ? 0 : 1);
