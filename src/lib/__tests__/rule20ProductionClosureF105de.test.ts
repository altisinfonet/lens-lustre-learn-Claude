/**
 * @decision D-007
 *
 * PINS THE EXACT, PATH-EXACT SCOPE OF RULE 20's F-105de EXCEPTION.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `docs/DECISIONS.md` D-007 and `docs/ADDENDUM_A_EXECUTION_MASTER.md` §7.1 both
 * name the same eight paths, and only these eight, as files `compare/main..
 * staging` may show as a real, non-zero difference without blocking Rule 20
 * closure. This file holds that exact list in one place so the register, the
 * addendum, and this test cannot silently drift apart from each other — the
 * same discipline `src/test-utils/migrations.ts` already documents for the
 * `PROBE_`/`UNAPPLIED_` prefix mechanism, applied here to a fixed, named set
 * instead of a prefix rule.
 *
 * ⚠ THIS TEST DOES NOT ASSERT WHICH LANE IT RUNS ON, ON PURPOSE. These eight
 * files belong on `main` only, by design (D-007) — so on `staging`, or any
 * branch built from it (including a main-to-staging reconciliation branch
 * that has not carried them), their CORRECT state is absent. A test that
 * required them to exist would be exactly as wrong, on this lane, as a test
 * that forbade them on `main`. What this file pins is narrower and lane-
 * independent: the set itself is exactly these eight paths, no more and no
 * fewer; whichever of them are present on the current lane are real files at
 * exactly these paths, not a near-miss; and nothing else in the repository
 * claims the D-007 exception for a ninth file.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** The exact, path-exact set — must match docs/DECISIONS.md D-007 verbatim. */
export const RULE_20_F105DE_EXCEPTION_PATHS = [
  "src/lib/__tests__/referralReward0023Withdrawn.test.ts",
  "src/lib/__tests__/referralRewardProductionRederive.test.ts",
  "supabase/migrations/20260910_0024_f105de_referral_reward_production_close.sql",
  "supabase/migrations/PROBE_f105de_referral_reward_production_closed.sql",
  "supabase/migrations/PROBE_process_referral_reward_source_dump_readonly.sql",
  "supabase/migrations/UNAPPLIED_20260910_0023_f105de_referral_reward_production_close.sql",
  "supabase/rollback/20260910_0024_f105de_referral_reward_production_close_ROLLBACK.sql",
  "supabase/rollback/UNAPPLIED_20260910_0023_f105de_referral_reward_production_close_ROLLBACK.sql",
] as const;

const NAMED_DIRS = ["supabase/migrations", "supabase/rollback", "src/lib/__tests__"];
/** This file necessarily contains the literal marker string; it must not scan itself. */
const SELF = "src/lib/__tests__/rule20ProductionClosureF105de.test.ts";

describe("Rule 20 / F-105de exception (D-007) — the set is exactly eight paths", () => {
  it("has exactly eight entries, no duplicates", () => {
    expect(RULE_20_F105DE_EXCEPTION_PATHS.length).toBe(8);
    expect(new Set(RULE_20_F105DE_EXCEPTION_PATHS).size).toBe(8);
  });

  it("every entry is under one of the three directories D-007 actually reasons about", () => {
    for (const p of RULE_20_F105DE_EXCEPTION_PATHS) {
      expect(
        NAMED_DIRS.some((d) => p.startsWith(`${d}/`)),
        `${p} is outside the directories D-007 gives a reason for`,
      ).toBe(true);
    }
  });

  it("whichever entries exist on this lane are real files at exactly these paths — never a near-miss", () => {
    // Lane-tolerant by design (see file header): absence is not a failure here.
    // What this catches is a file existing under a name CLOSE to one of the
    // eight but not identical to it — the exact shape of near-miss
    // src/test-utils/migrations.ts documents as this repository's one real
    // migration-resolver incident.
    for (const p of RULE_20_F105DE_EXCEPTION_PATHS) {
      const abs = join(ROOT, p);
      if (existsSync(abs)) {
        expect(statSync(abs).isFile(), `${p} exists but is not a regular file`).toBe(true);
      }
    }
  });

  it("no OTHER file under these directories claims the D-007 exception", () => {
    // A file only "claims" the exception if it carries the decision id
    // literally — this catches a ninth file being pointed at D-007 without a
    // new decision, not ordinary unrelated migrations that say nothing about
    // Rule 20 at all.
    const known = new Set<string>(RULE_20_F105DE_EXCEPTION_PATHS);
    const offenders: string[] = [];
    for (const d of NAMED_DIRS) {
      const abs = join(ROOT, d);
      if (!existsSync(abs)) continue;
      for (const name of readdirSync(abs)) {
        const rel = `${d}/${name}`;
        if (known.has(rel) || rel === SELF) continue;
        const full = join(abs, name);
        if (!statSync(full).isFile() || !/\.(sql|ts)$/.test(name)) continue;
        if (readFileSync(full, "utf8").includes("D-007")) offenders.push(rel);
      }
    }
    expect(offenders, "a file outside the named eight claims the D-007 exception").toEqual([]);
  });

  it("this test itself is not counted as one of the eight, and is not under a D-007-named directory", () => {
    // Sanity check on the guard above: this file lives beside two of the
    // eight (src/lib/__tests__/) and must not accidentally match itself.
    const self = "src/lib/__tests__/rule20ProductionClosureF105de.test.ts";
    expect(RULE_20_F105DE_EXCEPTION_PATHS as readonly string[]).not.toContain(self);
  });
});
