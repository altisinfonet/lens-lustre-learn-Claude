import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "supabase/functions/complete-round/index.ts"),
  "utf8",
);

describe("complete-round declared result progression decisions", () => {
  it("stores explicit R2/R3 not-selected stage keys instead of null", () => {
    expect(source).toContain('progression_decision: "r2_not_selected_r3"');
    expect(source).toContain('progression_decision: "r3_not_selected_final"');
    expect(source).not.toMatch(/rejectedIds[\s\S]{0,220}progression_decision:\s*null/);
  });

  it("keeps dry-run proof aligned with the written stage keys", () => {
    expect(source).toContain('stage_keys_used: ["r2_qualified_r3", "r2_accepted", "r2_not_selected_r3"]');
    expect(source).toContain('stage_keys_used: ["r3_qualified_final", "r3_accepted", "r3_not_selected_final"]');
    expect(source).not.toContain("progression_decision=NULL");
  });

  it("normalizes R4 catalog decision tokens to participant/public placement keys", () => {
    expect(source).toContain("AWARD_DECISION_TOKEN_TO_PUBLIC_KEY");
    expect(source).toContain('runner_up_1: "runner_up_1"');
    expect(source).toContain('top_50: "top_50"');
    expect(source).toContain('top_100: "top_100"');
    expect(source).toContain('finalist_only: "finalist"');
  });
});
