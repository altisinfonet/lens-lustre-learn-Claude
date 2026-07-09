/**
 * Phase 2 / D3 acceptance — alias snapshot test.
 *
 * Asserts that every CANONICAL Frozen Contract v3 stage_key resolves to the
 * EXACT SAME participant-facing string as its retired LEGACY sibling. This
 * is the byte-parity guarantee that lets the dual-emit window flip the
 * reader from `status_legacy` to `status` without any UI string churn.
 *
 * If this test fails, the v3 vocabulary has drifted from the legacy
 * vocabulary — fix `participantStageLabels.ts` (D3) before merging.
 */
import { describe, it, expect } from "vitest";
import { PARTICIPANT_STAGE_LABELS, participantStageLabel } from "@/lib/judging/participantStageLabels";

describe("Phase 2 / D3 — canonical ↔ legacy participant-label parity", () => {
  // (canonical key emitted by Phase 1 `status` column,
  //  legacy key emitted by Phase 1 `status_legacy` column)
  const PARITY_PAIRS: Array<[canonical: string, legacy: string]> = [
    // R1
    ["r1_accepted",       "approved"],
    ["r1_shortlisted_r2", "round1_qualified"],
    ["r1_shortlisted_r2", "shortlisted"],
    ["r1_needs_review",   "needs_review"],
    ["r1_rejected",       "rejected"],
    // R2 (Phase 1 negatives → pending_consensus, so only positives parity-checked)
    ["r2_accepted",       "r2_accepted"],
    ["r2_qualified_r3",   "round2_qualified"],
    // R3 (Phase 1 negatives → pending_consensus, so only positives parity-checked)
    ["r3_accepted",       "r3_accepted"],
    ["r3_qualified_final","finalist"],
    ["r3_qualified_final","qualified_final"],
    // R4 (Phase 3) — 8 canonical keys must render identically to their
    // retired legacy aliases (the keys the UI used before the sibling RPC).
    ["r4_winner",          "winner"],
    ["r4_runner_up_1",     "runner_up_1"],
    ["r4_runner_up_2",     "runner_up_2"],
    // NOTE: `r4_finalist` is the R4 AWARD ("Finalist") whereas legacy `finalist`
    // is the R3→R4 ADVANCEMENT ("Shortlisted for Final Round"). They are
    // intentionally different stages → no parity assertion.
    ["r4_top_50",          "top_50"],
    ["r4_top_100",         "top_100"],
    ["r4_honorary_mention","honorary_mention"],
    ["r4_special_jury",    "special_jury"],
    ["r4_top_50",          "top_50"],
    ["r4_top_100",         "top_100"],
    ["r4_honorary_mention","honorary_mention"],
    ["r4_special_jury",    "special_jury"],
  ];

  for (const [canonical, legacy] of PARITY_PAIRS) {
    it(`canonical "${canonical}" renders identically to legacy "${legacy}"`, () => {
      const canonicalLabel = participantStageLabel(canonical);
      const legacyLabel    = participantStageLabel(legacy);
      expect(canonicalLabel).toBe(legacyLabel);
      expect(canonicalLabel).toBeTruthy();
    });
  }

  it("every canonical R1 key is present in PARTICIPANT_STAGE_LABELS", () => {
    const required = ["r1_accepted", "r1_shortlisted_r2", "r1_needs_review", "r1_rejected"] as const;
    for (const k of required) {
      expect(PARTICIPANT_STAGE_LABELS).toHaveProperty(k);
    }
  });

  it("every canonical R4 key is present in PARTICIPANT_STAGE_LABELS (Phase 3)", () => {
    const required = [
      "r4_winner", "r4_runner_up_1", "r4_runner_up_2", "r4_finalist",
      "r4_top_50", "r4_top_100", "r4_honorary_mention", "r4_special_jury",
    ] as const;
    for (const k of required) {
      expect(PARTICIPANT_STAGE_LABELS).toHaveProperty(k);
    }
  });
});
