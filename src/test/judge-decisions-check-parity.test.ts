/**
 * Phase 2 / Finding #5 — F5-C-2 Strict Cleanup parity guard.
 *
 * Asserts that the TS mirror of the `judge_decisions_decision_check_v2`
 * CHECK constraint stays a strict superset of every ACTIVE catalog
 * decision_token. If a future migration adds a new active catalog token
 * without widening the CHECK, this test fails BEFORE the writer 500s in
 * production.
 *
 * Mirrors live DB constraint as of 2026-05-01:
 *   accept, reject, shortlist, needs_verification,
 *   qualified_r3, qualified_final,
 *   winner, runner_up_1, runner_up_2, honorary_mention, special_jury,
 *   top_50, top_100, finalist_only,
 *   not_selected_r3, not_selected_final, shortlisted_final  (back-compat)
 *
 * Legacy DROPPED tokens (must NEVER reappear in either side):
 *   qualified, finalist, skip, needs_review
 */
import { describe, it, expect } from "vitest";
import { STAGE_CATALOG } from "@/lib/judging/stageCatalog";

/** Byte-identical TS mirror of judge_decisions_decision_check_v2 (17 tokens). */
const JUDGE_DECISIONS_CHECK_V2 = new Set<string>([
  // Active R1
  "accept", "reject", "shortlist", "needs_verification",
  // Active R2
  "qualified_r3",
  // Active R3
  "qualified_final",
  // Active R4 awards (Phase 2 / Finding #1+2+3 per-tag tokens)
  "winner", "runner_up_1", "runner_up_2",
  "honorary_mention", "special_jury",
  "top_50", "top_100", "finalist_only",
  // Back-compat retired
  "not_selected_r3", "not_selected_final", "shortlisted_final",
]);

/** Tokens deliberately removed by F5-C-2 — must never resurface. */
const FORBIDDEN_LEGACY_TOKENS = new Set<string>([
  "qualified", "finalist", "skip", "needs_review",
]);

describe("judge_decisions.decision CHECK ↔ v3_stage_catalog parity (F5-C-2)", () => {
  it("CHECK whitelist contains every ACTIVE catalog decision_token", () => {
    const missing: string[] = [];
    for (const stage of STAGE_CATALOG) {
      if (!stage.is_active) continue;
      if (!JUDGE_DECISIONS_CHECK_V2.has(stage.decision_token)) {
        missing.push(`${stage.stage_key} → '${stage.decision_token}'`);
      }
    }
    expect(
      missing,
      `Active catalog tokens missing from judge_decisions CHECK: ${missing.join(", ")}. ` +
      `Add a migration to widen judge_decisions_decision_check_v2 BEFORE merging.`,
    ).toEqual([]);
  });

  it("does NOT contain any legacy F5-C-2 dropped tokens", () => {
    const resurrected = [...FORBIDDEN_LEGACY_TOKENS].filter((t) =>
      JUDGE_DECISIONS_CHECK_V2.has(t),
    );
    expect(
      resurrected,
      `Legacy tokens reappeared in CHECK whitelist: ${resurrected.join(", ")}`,
    ).toEqual([]);
  });

  it("catalog has no ACTIVE row using a forbidden legacy decision_token", () => {
    const offenders = STAGE_CATALOG
      .filter((s) => s.is_active && FORBIDDEN_LEGACY_TOKENS.has(s.decision_token))
      .map((s) => `${s.stage_key} → '${s.decision_token}'`);
    expect(
      offenders,
      `Active catalog re-introduced a forbidden legacy token: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("CHECK whitelist size matches snapshot (17)", () => {
    expect(JUDGE_DECISIONS_CHECK_V2.size).toBe(17);
  });
});
