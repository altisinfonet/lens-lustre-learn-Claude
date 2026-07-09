/**
 * Phase 7 — Email template re-keying regression lock.
 *
 * Asserts that every judging-lifecycle notification emitter installed in the DB
 * passes a canonical v3 `stageKey` in its email_data payload — never just legacy
 * `placement` / `entryStatus` / raw status strings.
 *
 * The proof is static: we read the source SQL of each function from the
 * supabase/migrations directory and assert the payload jsonb_build_object call
 * includes a `'stageKey'` key. This catches future regressions where someone
 * edits a function and drops the canonical key.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');

/** Find the most recent migration that defines a given function name. */
function latestDefinitionOf(fnName: string): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    const re = new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fnName}\\s*\\(`,
      'i',
    );
    if (re.test(sql)) return sql;
  }
  throw new Error(`No migration defines public.${fnName}`);
}

/** Extract the body of a named function from a SQL blob. */
function bodyOf(sql: string, fnName: string): string {
  const start = sql.search(
    new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fnName}\\s*\\(`, 'i'),
  );
  if (start < 0) throw new Error(`function ${fnName} not in given SQL`);
  // body runs until the next CREATE OR REPLACE / COMMENT ON / end of file
  const tail = sql.slice(start);
  const stop = tail
    .slice(50)
    .search(/CREATE\s+OR\s+REPLACE|^COMMENT\s+ON|^--\s*=+/im);
  return stop > 0 ? tail.slice(0, 50 + stop) : tail;
}

const EMITTERS_REQUIRING_STAGE_KEY = [
  'notify_entry_status_change',
  'notify_round_published',
  'notify_round_published_insert',
  'backfill_judging_notifications',
  'trg_entry_status_lifecycle_emit',
];

describe('Phase 7 — judging-lifecycle email payloads carry canonical stageKey', () => {
  for (const fn of EMITTERS_REQUIRING_STAGE_KEY) {
    it(`public.${fn} passes stageKey in every emit_notification call`, () => {
      const sql = latestDefinitionOf(fn);
      const body = bodyOf(sql, fn);

      // Count the number of emit_notification(...) calls in the body.
      const emitCalls = body.match(/emit_notification\s*\(/g) ?? [];
      expect(emitCalls.length, `${fn} should call emit_notification at least once`).toBeGreaterThan(0);

      // Count the number of payloads carrying 'stageKey'.
      // Both jsonb_build_object('stageKey', ...) and 'stageKey', _stage_key forms count.
      const stageKeyOccurrences = body.match(/'stageKey'/g) ?? [];

      // Every emit_notification call must have a corresponding stageKey in its payload.
      // Allow >= because backfill builds the payload separately.
      expect(
        stageKeyOccurrences.length,
        `${fn}: found ${emitCalls.length} emit_notification calls but only ${stageKeyOccurrences.length} stageKey payload keys`,
      ).toBeGreaterThanOrEqual(emitCalls.length);
    });
  }

  it('canonical resolver _resolve_stage_key_from_entry exists and is IMMUTABLE', () => {
    const sql = latestDefinitionOf('_resolve_stage_key_from_entry');
    expect(sql).toMatch(/IMMUTABLE/);
    // Must contain the four canonical R4 keys:
    for (const k of ['r4_winner', 'r4_top_50', 'r4_top_100', 'r4_finalist', 'r1_shortlisted_r2', 'r2_qualified_r3', 'r3_qualified_final']) {
      expect(sql).toContain(`'${k}'`);
    }
  });
});
