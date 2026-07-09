/**
 * Phase 5 closure — buildPhotoStatusMaps invariant.
 *
 * Locks the alias rewriter to its CURRENT minimal shape after Phase 5:
 *
 *   - Dead branches DELETED: r2_not_selected / r3_not_selected (the live
 *     `get_per_photo_consensus` RPC's CASE statement never emits these —
 *     verified 2026-05-02 against pg_get_functiondef).
 *
 *   - LIVE alias arms RETAINED: r2_qualified_r3 → round2_qualified,
 *     r3_qualified_final → finalist. These cannot be deleted until 7
 *     downstream consumers (PersonalResultBanner, ParticipantStageBadge,
 *     Dashboard, AdminCompetitionFunnel, AdminCompetitionRounds,
 *     useCompetitionDetail, SubmissionDetail) stop string-comparing the
 *     legacy keys. Tracked as the "alias retirement" follow-up.
 *
 * If you need to add OR remove an alias arm, read the alias-retirement
 * memory and migrate every consumer in the same PR — do not silently
 * loosen this test.
 */
import { describe, it, expect } from "vitest";
import {
  buildPhotoStatusMaps,
  type PhotoConsensusRow,
} from "@/hooks/judging/usePhotoDecisions";

function row(
  entry_id: string,
  photo_index: number,
  round_number: number,
  status: string,
): PhotoConsensusRow {
  return {
    entry_id,
    photo_index,
    round_number,
    decision: "x",
    judges_decided: 1,
    total_judges: 1,
    ratio: 1,
    threshold: 0.5,
    has_consensus: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: status as any,
  };
}

describe("Phase 5 — buildPhotoStatusMaps alias invariant", () => {
  it("rewrites r2_qualified_r3 → round2_qualified (LIVE alias)", () => {
    const map = buildPhotoStatusMaps([row("e1", 0, 2, "r2_qualified_r3")]);
    expect(map.get("e1")?.[0]).toBe("round2_qualified");
  });

  it("rewrites r3_qualified_final → finalist (LIVE alias)", () => {
    const map = buildPhotoStatusMaps([row("e1", 0, 3, "r3_qualified_final")]);
    expect(map.get("e1")?.[0]).toBe("finalist");
  });

  it("passes r2_accepted through unchanged", () => {
    const map = buildPhotoStatusMaps([row("e1", 0, 2, "r2_accepted")]);
    expect(map.get("e1")?.[0]).toBe("r2_accepted");
  });

  it("passes r3_accepted through unchanged", () => {
    const map = buildPhotoStatusMaps([row("e1", 0, 3, "r3_accepted")]);
    expect(map.get("e1")?.[0]).toBe("r3_accepted");
  });

  it("passes r1_* canonical keys through unchanged", () => {
    for (const k of ["r1_accepted", "r1_shortlisted_r2", "r1_needs_review", "r1_rejected"]) {
      const map = buildPhotoStatusMaps([row("e", 0, 1, k)]);
      expect(map.get("e")?.[0]).toBe(k);
    }
  });

  it("passes R4 legacy aliases (winner / finalist) through unchanged", () => {
    expect(buildPhotoStatusMaps([row("e", 0, 4, "winner")]).get("e")?.[0]).toBe("winner");
    expect(buildPhotoStatusMaps([row("e", 0, 4, "finalist")]).get("e")?.[0]).toBe("finalist");
  });

  it("passes pending_consensus through unchanged", () => {
    const map = buildPhotoStatusMaps([row("e", 0, 1, "pending_consensus")]);
    expect(map.get("e")?.[0]).toBe("pending_consensus");
  });

  it("DEAD branches removed: r2_not_selected NOT rewritten to round2_not_selected", () => {
    // Phase 5 — the live RPC CASE never emits r2_not_selected, so this
    // branch was dead. It now passes through unchanged. If this test
    // starts failing because someone re-added the rewrite arm, ask why
    // the RPC suddenly emits it instead — the parity audit
    // (rpc_contract_parity.mjs) should already have flagged it.
    const map = buildPhotoStatusMaps([row("e", 0, 2, "r2_not_selected")]);
    expect(map.get("e")?.[0]).toBe("r2_not_selected");
  });

  it("DEAD branches removed: r3_not_selected NOT rewritten to round3_not_selected", () => {
    const map = buildPhotoStatusMaps([row("e", 0, 3, "r3_not_selected")]);
    expect(map.get("e")?.[0]).toBe("r3_not_selected");
  });

  it("highest round wins when same (entry, photo) appears in multiple rounds", () => {
    const map = buildPhotoStatusMaps([
      row("e", 0, 1, "r1_accepted"),
      row("e", 0, 3, "r3_qualified_final"),
      row("e", 0, 2, "r2_accepted"),
    ]);
    // R3 (highest) wins → r3_qualified_final → rewritten to finalist
    expect(map.get("e")?.[0]).toBe("finalist");
  });
});
