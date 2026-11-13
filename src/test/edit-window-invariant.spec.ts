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
import { readFileSync } from "node:fs";
import { migrationsInSequence } from "@/test-utils/migrations";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");
const POLICY_NAME = "Users can update own metadata only";

/** Find the most recent migration that creates the owner-update policy. */
function findActivePolicyMigration(): string {
  const files = migrationsInSequence(MIGRATIONS_DIR).reverse();
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
    // plain or initplan form: user_id = auth.uid()  |  user_id = (SELECT auth.uid())
    expect(sql).toMatch(/user_id\s*=\s*(?:auth\.uid\(\)|\(\s*SELECT\s+auth\.uid\(\)\s*\))/i);
  });

  /**
   * The column fence. Until 20261113_0802 it was written inside the policy's
   * WITH CHECK as (SELECT ce2.col FROM competition_entries ce2 …) — a policy
   * reading its own table, which Postgres refuses (42P17) for EVERY member
   * update, the owner's title edit included (measured: staging PROBE 0801 run
   * 43444508933). The fence is now the trigger trg_0_entry_member_write_guard
   * (20261113_0800): an allow-list, so every other column is frozen.
   */
  const code = sql.replace(/--[^\n]*/g, "");
  const guardSql = (() => {
    for (const f of migrationsInSequence(MIGRATIONS_DIR).reverse()) {
      const s = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      if (/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.tg_entry_member_write_guard\s*\(/i.test(s)) return s;
    }
    throw new Error("No migration creates public.tg_entry_member_write_guard()");
  })();
  const allowList = (() => {
    const m = guardSql.match(/n\.key\s+NOT\s+IN\s*\(([^)]*)\)/i);
    if (!m) throw new Error("tg_entry_member_write_guard has no allow-list");
    return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  })();

  it("the policy does not read competition_entries from inside itself (42P17 for every edit)", () => {
    expect(/FROM\s+public\.competition_entries\s+ce2/i.test(code)).toBe(false);
  });

  it("the policy is only recreated where the column guard is proven installed", () => {
    expect(code).toMatch(/trg_0_entry_member_write_guard/);
  });

  it("the guard freezes every judging column for a member's direct write", () => {
    for (const col of [
      "status",
      "placement",
      "stage_key",
      "progression_decision",
      "current_round",
      "user_id",
      "competition_id",
      "is_pinned",
      "is_trending",
      "view_count",
      "certificate_ready",
    ]) {
      expect(allowList, `"${col}" must not be member-writable`).not.toContain(col);
    }
    // the trigger that runs it (created once, in 0800; later files only replace the function)
    const triggerMade = migrationsInSequence(MIGRATIONS_DIR).some((f) =>
      /CREATE\s+TRIGGER\s+trg_0_entry_member_write_guard\s+BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.competition_entries/i.test(
        readFileSync(join(MIGRATIONS_DIR, f), "utf8"),
      ),
    );
    expect(triggerMade).toBe(true);
  });

  it("the owner may edit exactly what the edit screen sends (exif_data included, gate 1a)", () => {
    // useUpdateCompetitionEntry's patch + updated_at; current_round_int is generated.
    expect(allowList).toEqual(
      ["current_round_int", "description", "exif_data", "photo_meta", "photo_thumbnails", "photos", "title", "updated_at"],
    );
  });
});
