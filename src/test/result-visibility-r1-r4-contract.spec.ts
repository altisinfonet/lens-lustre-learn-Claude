import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase/migrations");
const latestVisibilityMigration = readFileSync(
  join(migrationsDir, "20260502173039_8b60387e-3eb1-4725-974a-05f5b09d46ed.sql"),
  "utf8",
);

describe("R1-R4 declared result visibility contract", () => {
  it("prioritizes R4 placement/award over older progression decisions", () => {
    expect(latestVisibilityMigration).toContain("latest_published_round >= 4 AND r4_public_award IS NOT NULL");
    expect(latestVisibilityMigration.indexOf("latest_published_round >= 4 AND r4_public_award IS NOT NULL"))
      .toBeLessThan(latestVisibilityMigration.indexOf("canonical_stage_key IS NOT NULL"));
  });

  it("keeps R1-R3 visibility derived from progression_decision after declare", () => {
    expect(latestVisibilityMigration).toContain("JOIN v3_stage_catalog c ON c.stage_key = e.progression_decision");
    expect(latestVisibilityMigration).toContain("decision_round <= latest_published_round");
    expect(latestVisibilityMigration).toContain("THEN canonical_stage_key");
  });

  it("has an all-round invariant proof function", () => {
    expect(latestVisibilityMigration).toContain("declared_r1_r2_r3_r4_result_visibility");
    expect(latestVisibilityMigration).toContain("eligible_declared_results");
    expect(latestVisibilityMigration).toContain("failure_rows");
  });
});
