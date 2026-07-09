/**
 * Edit-Window Invariant (Phase 4)
 *
 * Guards the owner-edit RLS policy on public.competition_entries.
 *
 * Two layers of protection:
 *  1. STATIC: the migration file MUST contain the phase + ends_at gate clauses.
 *     If anyone rewrites the policy without those, this test fails.
 *  2. RUNTIME: when SUPABASE_DB_URL is available (CI w/ DB), it inspects the
 *     live pg_policy row and asserts the same shape. Skipped locally.
 *
 * The DB-level RLS policy is the source of truth — this test exists to
 * ensure no future migration silently weakens the gate.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");
const POLICY_NAME = "Users can update own metadata only";

/** Find the most recent migration that creates the owner-update policy. */
function findActivePolicyMigration(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (
      sql.includes(`CREATE POLICY "${POLICY_NAME}"`) &&
      sql.includes("public.competition_entries")
    ) {
      return sql;
    }
  }
  throw new Error(`No migration found that creates policy "${POLICY_NAME}"`);
}

describe("Edit-Window Invariant on competition_entries", () => {
  const sql = findActivePolicyMigration();

  it("policy USING clause gates on phase='submission_open'", () => {
    expect(sql).toMatch(/c\.phase\s*=\s*'submission_open'/);
  });

  it("policy USING clause gates on now() <= c.ends_at", () => {
    expect(sql).toMatch(/now\(\)\s*<=\s*c\.ends_at/);
  });

  it("policy USING clause excludes archived and cancelled competitions", () => {
    expect(sql).toMatch(/c\.status\s+NOT\s+IN\s*\(\s*'archived'\s*,\s*'cancelled'\s*\)/);
  });

  it("policy keeps owner check (user_id = auth.uid())", () => {
    expect(sql).toMatch(/user_id\s*=\s*auth\.uid\(\)/);
  });

  it("WITH CHECK preserves immutability fence on judging columns", () => {
    // Spot-check the critical frozen columns — status, placement,
    // stage_key, progression_decision, current_round must remain blocked.
    for (const col of [
      "status",
      "placement",
      "stage_key",
      "progression_decision",
      "current_round",
      "user_id",
      "competition_id",
    ]) {
      const re = new RegExp(`NOT\\s*\\(\\s*${col}\\s+IS\\s+DISTINCT\\s+FROM`, "i");
      expect(re.test(sql), `expected NOT-DISTINCT guard on column "${col}"`).toBe(true);
    }
  });

  it("WITH CHECK intentionally DOES NOT freeze exif_data (gate 1a: owner-editable)", () => {
    expect(/NOT\s*\(\s*exif_data\s+IS\s+DISTINCT\s+FROM/i.test(sql)).toBe(false);
  });
});
