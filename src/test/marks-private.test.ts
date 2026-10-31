/**
 * Spec v3 Golden Rule #2 / Blocker H7 — Marks Private Invariant
 * --------------------------------------------------------------
 * Marks (per-criterion scores, raw `score`, judge `feedback`) MUST NEVER
 * surface to a participant. Participants see STATUS only.
 *
 * This static-text invariant test scans the canonical participant-facing
 * data surfaces (`useGatedEntryStatus`, `entry_public_status`-driven
 * helpers) and asserts that none of the forbidden mark fields appear in
 * their declared row shape. It runs in every PR (no DB needed) and
 * complements the runtime DB check in `judging-invariants.test.ts`.
 *
 * If a future refactor re-introduces a mark field on the participant
 * surface, this test fails immediately — which is the entire point.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN_MARK_FIELDS = [
  "line_score",
  "shape_score",
  "form_score",
  "texture_score",
  "color_palette_score",
  "space_score",
  "tone_score",
  "balance_score",
  "light_score",
  "depth_score",
  "composition_score",
  "technique_score",
  "editing_score",
  "story_score",
  "moment_score",
  // Aggregate marks that must also never reach participants directly
  "judge_score",
  "raw_score",
];

const PARTICIPANT_SURFACES = [
  "src/hooks/judging/useGatedEntryStatus.ts",
];

describe("Spec v3 — marks-private invariant (participant surfaces)", () => {
  for (const path of PARTICIPANT_SURFACES) {
    it(`${path} declares no mark fields`, () => {
      const src = readFileSync(join(process.cwd(), path), "utf8");
      const offenders: string[] = [];
      for (const f of FORBIDDEN_MARK_FIELDS) {
        // Word-boundary match so "score" alone (which appears in legitimate
        // status strings like "scored") never trips the test — only the exact
        // mark column names do.
        const re = new RegExp(`\\b${f}\\b`);
        if (re.test(src)) offenders.push(f);
      }
      expect(
        offenders,
        `Participant surface "${path}" leaks mark field(s): ${offenders.join(", ")}. ` +
          `Spec v3 Golden Rule #2 forbids exposing per-criterion or raw judge scores to participants.`,
      ).toEqual([]);
    });
  }

  it("gatedStatusLabel exports do not include score-like copy", () => {
    const src = readFileSync(
      join(process.cwd(), "src/hooks/judging/useGatedEntryStatus.ts"),
      "utf8",
    );
    const labelBlock = src.split("function gatedStatusLabel")[1] ?? "";
    // Forbid score-shaped tokens: decimals (e.g. "8.5"), "/10", or "X of 10"
    // patterns. Round identifiers like "Round 2" remain allowed.
    const numericLeak =
      /return\s+["'`][^"'`]*(\d+\.\d+|\/\s*10|\bof\s+10\b)[^"'`]*["'`]/i.test(
        labelBlock,
      );
    expect(numericLeak, "gatedStatusLabel must not embed score-like copy").toBe(
      false,
    );
  });
});
