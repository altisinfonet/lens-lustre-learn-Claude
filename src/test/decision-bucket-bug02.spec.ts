/**
 * Phase 5 — Verification harness for the Master Fix Plan.
 *
 * Locks in the BUG-02 fix (R2 `qualified_r3` saved rows must count under
 * BOTH the `qualified` AND `shortlisted` sidebar buckets) and freezes the
 * unified decisionBuckets() contract against silent regressions.
 *
 * If any active row in STAGE_CATALOG ships without a bucket mapping, the
 * Phase-2 module's load-time invariant throws — importing this file is
 * itself part of the harness.
 */
import { describe, it, expect } from "vitest";
import {
  decisionBuckets,
  tryDecisionBuckets,
  primaryDecisionBucket,
  bucketsForStageKey,
  StageKeyResolutionError,
} from "@/lib/judging/decisionBucket";
import { STAGE_CATALOG } from "@/lib/judging/stageCatalog";

describe("Phase 5 — decisionBucket BUG-02 lock", () => {
  it("R2 qualified_r3 maps to BOTH qualified and shortlisted (BUG-02 fix)", () => {
    const buckets = decisionBuckets(2, "qualified_r3");
    expect(buckets).toContain("qualified");
    expect(buckets).toContain("shortlisted");
    // Primary bucket is the most-specific one.
    expect(buckets[0]).toBe("qualified");
  });

  it("R3 qualified_final maps to BOTH finalist and shortlisted", () => {
    const buckets = decisionBuckets(3, "qualified_final");
    expect(buckets).toContain("finalist");
    expect(buckets).toContain("shortlisted");
  });

  it("R1 shortlist resolves to a single shortlisted bucket", () => {
    expect(decisionBuckets(1, "shortlist")).toEqual(["shortlisted"]);
  });

  it("R2 accept stays at this round (no progression bucket)", () => {
    expect(decisionBuckets(2, "accept")).toEqual(["accepted"]);
  });

  it("strict resolver throws StageKeyResolutionError on unknown tuples", () => {
    expect(() => decisionBuckets(2, "no_such_token")).toThrow(StageKeyResolutionError);
    expect(() => decisionBuckets(9, "accept")).toThrow(StageKeyResolutionError);
  });

  it("soft resolver returns null on unknown tuples (no throw)", () => {
    expect(tryDecisionBuckets(2, "no_such_token")).toBeNull();
    expect(tryDecisionBuckets(null, "accept")).toBeNull();
    expect(primaryDecisionBucket(2, "no_such_token")).toBeNull();
  });

  it("bucketsForStageKey resolves R2 r2_qualified_r3 stage_key path", () => {
    const buckets = bucketsForStageKey("r2_qualified_r3");
    expect(buckets).not.toBeNull();
    expect(buckets!).toContain("qualified");
    expect(buckets!).toContain("shortlisted");
  });

  it("every active catalog row has a bucket mapping (parity guard)", () => {
    for (const row of STAGE_CATALOG) {
      if (!row.is_active) continue;
      const buckets = tryDecisionBuckets(row.round_number, row.decision_token);
      expect(buckets, `missing bucket for ${row.stage_key}`).not.toBeNull();
      expect(buckets!.length).toBeGreaterThan(0);
    }
  });
});
