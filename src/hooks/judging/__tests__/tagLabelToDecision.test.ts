import { describe, it, expect } from "vitest";
import { tagLabelToDecision } from "../tagLabelToDecision";

/**
 * Locks the canonical tag-label → decision mapping. If anyone changes a DB
 * tag label without updating `tagLabelToDecision`, this suite fails before
 * the regression ships. Mirrors live `judging_tags` rows verified 2026-04-28.
 */
describe("tagLabelToDecision", () => {
  describe("Round 1 — decision-only", () => {
    it("'Reject' → 'reject'", () => {
      expect(tagLabelToDecision("Reject")).toBe("reject");
    });
    it("'Accept' → 'accept'", () => {
      expect(tagLabelToDecision("Accept")).toBe("accept");
    });
    it("'Shortlist for R2' → 'shortlist'", () => {
      expect(tagLabelToDecision("Shortlist for R2")).toBe("shortlist");
    });
    it("legacy 'Qualified for 2nd Round' → 'shortlist'", () => {
      expect(tagLabelToDecision("Qualified for 2nd Round")).toBe("shortlist");
    });
    it("'Needs Review' → null (R1 surfaces it separately)", () => {
      expect(tagLabelToDecision("Needs Review")).toBeNull();
    });
  });

  describe("Round 2 — live DB labels", () => {
    it("'Qualified for R3' → 'shortlist' (regression test for the L221 bug)", () => {
      expect(tagLabelToDecision("Qualified for R3")).toBe("shortlist");
    });
    it("'Not Selected for R3' → 'reject' (regression test for the L221 bug)", () => {
      expect(tagLabelToDecision("Not Selected for R3")).toBe("reject");
    });
    it("legacy long-form 'Qualified for Round 3' still maps", () => {
      expect(tagLabelToDecision("Qualified for Round 3")).toBe("shortlist");
    });
    it("legacy long-form 'Not Selected for Round 3' still maps", () => {
      expect(tagLabelToDecision("Not Selected for Round 3")).toBe("reject");
    });
  });

  describe("Round 3", () => {
    it("'Shortlisted for Final' → 'shortlist'", () => {
      expect(tagLabelToDecision("Shortlisted for Final")).toBe("shortlist");
    });
    it("'Not Selected for Final' → 'reject'", () => {
      expect(tagLabelToDecision("Not Selected for Final")).toBe("reject");
    });
  });

  describe("Ruleset v4 — Stay bucket REMOVED (2026-04-29)", () => {
    it("'Stayed at R2' → null (legacy tag, no longer mapped)", () => {
      expect(tagLabelToDecision("Stayed at R2")).toBeNull();
    });
    it("'Stayed at R3' → null (legacy tag, no longer mapped)", () => {
      expect(tagLabelToDecision("Stayed at R3")).toBeNull();
    });
  });

  describe("Round 4 — award tags must NOT update optimistic decisions", () => {
    it.each([
      ["Winner"],
      ["1st Runner-up"],
      ["2nd Runner-up"],
      ["Honorary Mention"],
      ["Special Jury"],
      ["Top 50"],
      ["Top 100"],
    ])("'%s' → null", (label) => {
      expect(tagLabelToDecision(label)).toBeNull();
    });
  });

  describe("normalization edge cases", () => {
    it("is case-insensitive", () => {
      expect(tagLabelToDecision("QUALIFIED FOR R3")).toBe("shortlist");
      expect(tagLabelToDecision("not selected for r3")).toBe("reject");
    });
    it("trims whitespace", () => {
      expect(tagLabelToDecision("  Reject  ")).toBe("reject");
    });
    it("returns null for empty / null / undefined", () => {
      expect(tagLabelToDecision("")).toBeNull();
      expect(tagLabelToDecision(null)).toBeNull();
      expect(tagLabelToDecision(undefined)).toBeNull();
    });
    it("returns null for unknown labels", () => {
      expect(tagLabelToDecision("Some Future Tag")).toBeNull();
    });
  });
});
