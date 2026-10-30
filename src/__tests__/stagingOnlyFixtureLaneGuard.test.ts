/**
 * S8 carry of #214 (F-110) — "STAGING ONLY" in a comment is not a lock.
 *
 * 20260910_00095 fabricates 21 accounts in auth.users. apply-migration.yml
 * sets p32.lane from the dispatch target and refuses a credential that does
 * not point at that target's database, so `p32.lane = 'staging'` is the one
 * fact that proves the file is running on staging. The file must refuse
 * before writing anything unless it reads exactly 'staging'.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FILE = join(process.cwd(), "supabase/migrations/20260910_00095_f93_staging_hard_case_fixture.sql");

describe("staging-only account fixture refuses every lane but staging", () => {
  it("checks p32.lane = 'staging' before the first INSERT", () => {
    const sql = readFileSync(FILE, "utf8").replace(/--[^\n]*/g, "");
    const guard = sql.search(/current_setting\('p32\.lane',\s*true\),\s*''\)\s*(?:<>|IS DISTINCT FROM)\s*'staging'[\s\S]*?RAISE EXCEPTION/i);
    const firstInsert = sql.search(/\binsert\s+into\b/i);
    expect(guard).toBeGreaterThan(-1);
    expect(firstInsert).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstInsert);
  });
});
