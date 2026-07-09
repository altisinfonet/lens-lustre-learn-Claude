/**
 * Phase 3 — mergeConsensusAndPlacement unit test.
 *
 * Verifies the canonical merge order: R4 placement ALWAYS overrides
 * per-round consensus when both refer to the same (entry, photo).
 */
import { describe, it, expect } from "vitest";
import { mergeConsensusAndPlacement } from "@/lib/judging/mergeConsensusAndPlacement";
import type { PhotoStatusMap } from "@/lib/judging/perPhotoStatusTypes";

describe("Phase 3 — mergeConsensusAndPlacement", () => {
  it("placement wins over consensus on overlapping (entry, photo)", () => {
    const consensus = new Map<string, PhotoStatusMap>([
      ["entry-A", { 0: "r1_accepted", 1: "r3_qualified_final", 2: "r1_rejected" }],
    ]);
    const placement = new Map<string, PhotoStatusMap>([
      ["entry-A", { 1: "r4_winner" }],
    ]);
    const merged = mergeConsensusAndPlacement(consensus, placement);

    expect(merged.get("entry-A")).toEqual({
      0: "r1_accepted",
      1: "r4_winner",     // placement wins over r3_qualified_final
      2: "r1_rejected",
    });
  });

  it("consensus passes through untouched when no placement exists", () => {
    const consensus = new Map<string, PhotoStatusMap>([
      ["entry-A", { 0: "r2_qualified_r3", 1: "r2_accepted" }],
    ]);
    const placement = new Map<string, PhotoStatusMap>();
    const merged = mergeConsensusAndPlacement(consensus, placement);

    expect(merged.get("entry-A")).toEqual({ 0: "r2_qualified_r3", 1: "r2_accepted" });
  });

  it("placement-only entry surfaces with no consensus side", () => {
    const consensus = new Map<string, PhotoStatusMap>();
    const placement = new Map<string, PhotoStatusMap>([
      ["entry-B", { 0: "r4_top_50", 5: "r4_honorary_mention" }],
    ]);
    const merged = mergeConsensusAndPlacement(consensus, placement);

    expect(merged.get("entry-B")).toEqual({ 0: "r4_top_50", 5: "r4_honorary_mention" });
  });

  it("does not mutate input maps", () => {
    const consensus = new Map<string, PhotoStatusMap>([["e", { 0: "r1_accepted" }]]);
    const placement = new Map<string, PhotoStatusMap>([["e", { 0: "r4_winner" }]]);
    const consensusBefore = JSON.stringify(Array.from(consensus.entries()));
    const placementBefore = JSON.stringify(Array.from(placement.entries()));

    mergeConsensusAndPlacement(consensus, placement);

    expect(JSON.stringify(Array.from(consensus.entries()))).toBe(consensusBefore);
    expect(JSON.stringify(Array.from(placement.entries()))).toBe(placementBefore);
  });

  it("multiple entries merge independently", () => {
    const consensus = new Map<string, PhotoStatusMap>([
      ["A", { 0: "r1_accepted" }],
      ["B", { 0: "r2_accepted" }],
    ]);
    const placement = new Map<string, PhotoStatusMap>([
      ["A", { 0: "r4_winner" }],
      ["C", { 0: "r4_top_100" }],
    ]);
    const merged = mergeConsensusAndPlacement(consensus, placement);

    expect(merged.get("A")).toEqual({ 0: "r4_winner" });
    expect(merged.get("B")).toEqual({ 0: "r2_accepted" });
    expect(merged.get("C")).toEqual({ 0: "r4_top_100" });
  });
});
