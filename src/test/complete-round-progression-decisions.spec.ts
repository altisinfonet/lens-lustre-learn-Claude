import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "supabase/functions/complete-round/index.ts"),
  "utf8",
);

describe("complete-round declared result progression decisions", () => {
  /**
   * ⚠ THESE TWO CASES WERE STALE AND FAILING FOR SOME TIME.
   *
   * They asserted the PRE-B1.9 behaviour — that a rejected R2/R3 entry is
   * written with an explicit `r2_not_selected_r3` / `r3_not_selected_final`
   * progression_decision. B1.9 deliberately removed those writes: a rejected
   * entry now carries NO progression_decision at all, and `entry_public_status`
   * DERIVES the not-selected key from (status='rejected' + current_round=N).
   * The function says so in four places; the spec was simply never updated.
   *
   * The code was not touched to make these pass — only the assertions, to match
   * the ruling the code already documents. Corrected 2026-08-12, when the
   * Android job started gating on the test suite and a permanently-red pair
   * would have blocked every build.
   */
  it("writes NO progression_decision on rejects — the view derives it (B1.9)", () => {
    // Pass branches still carry canonical decisions...
    expect(source).toContain('progression_decision: "r2_qualified_r3"');
    expect(source).toContain('progression_decision: "r3_qualified_final"');
    expect(source).toContain('progression_decision: "r2_accepted"');
    expect(source).toContain('progression_decision: "r3_accepted"');
    // ...and the reject branches carry none.
    expect(source).not.toContain('progression_decision: "r2_not_selected_r3"');
    expect(source).not.toContain('progression_decision: "r3_not_selected_final"');
    // A literal null would defeat the vocabulary gate; absence is the contract.
    expect(source).not.toMatch(/rejectedIds[\s\S]{0,220}progression_decision:\s*null/);
  });

  it("keeps dry-run proof aligned with the written stage keys", () => {
    // The preview advertises exactly the keys the write path uses — no
    // not-selected key, because no such row is written.
    expect(source).toContain('stage_keys_used: ["r2_qualified_r3", "r2_accepted"]');
    expect(source).toContain('stage_keys_used: ["r3_qualified_final", "r3_accepted"]');
    // And it says out loud that rejects are status-only, so a reader of the
    // dry-run does not conclude the decision was lost.
    expect(source).toContain("rejects_use_status_only: true");
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
