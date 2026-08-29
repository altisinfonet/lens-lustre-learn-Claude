/**
 * THE REACTION AND SHARE SUMMARY TRIGGERS CLEAR THE 44/32 TAP FLOOR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT HAPPENED, AND WHY THIS FILE EXISTS.
 *
 * On 2026-08-28 the reaction summary trigger became a real <button>
 * (`e7dbf51`). That was correct and is kept: as `<div onClick>` it had no role,
 * no tabindex and no accessible name, so the Reactions dialog — the only place
 * the app names WHO reacted — could be opened with a mouse and by nothing else.
 *
 * It also broke the UI gate, and the reason is worth stating precisely so a
 * later reader does not "fix" it by reverting:
 *
 *   THE CONTROL DID NOT SHRINK. It was always ~16-24 x 20. As a <div> it was
 *   never MEASURED — the gate's tap-target rule only looks at interactive
 *   elements. Becoming a button is what surfaced the defect, not what caused
 *   it. Reverting would hide it again AND restore the keyboard trap.
 *
 * Measured on staging, UI gate #120-#122 (runs 33232872781 and its two
 * predecessors), 9 problems across 3 scenes x 3 mobile viewports:
 *
 *   layout: tap targets too small (6): button.cursor-pointer.inline-flex 45x20,
 *     24x20, 69x16, 16x20, 24x20, 16x20
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE IS NOT 44 x 44.
 *
 * tools/uishot/capture.mjs:412 —  `if (long < 44 || short < 32)`  — so the
 * requirement is LONG >= 44 AND SHORT >= 32, a relaxation the owner approved so
 * that a 32x44 control (full height, deliberately narrow) passes. The rect is
 * getBoundingClientRect, which INCLUDES padding.
 *
 * `h-12 px-2.5` is therefore not decoration and not arbitrary:
 *   • h-12 = 48px  -> long axis 48, clears 44
 *   • px-2.5 = 20px total -> the narrowest content (16px) reaches 36, clears 32
 *   • it is the SAME box the Comment and Share buttons in PostActionRow already
 *     use, so the row keeps one shape rather than three.
 *
 * The row is already 48px tall because of those siblings, so the height costs
 * no layout at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BOTH FILES, NOT ONE. ShareSummaryTooltip carried the identical trigger and
 * was NOT reported by the gate only because every fixture scene has shareCount
 * 0, so its trigger never rendered. It would have gone red the first time a
 * post was shared. Pinned here so the pair cannot drift.
 *
 * Verified by removing the classes and re-running the sweep: the six failures
 * return, byte for byte.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ⚠ COMMENTS ARE STRIPPED BEFORE ANY ASSERTION RUNS.
 *
 * Both components' headers QUOTE the old markup they replaced —
 * "This was `<div onClick={handleOpen} className=\"cursor-pointer\">`" — so a
 * naive source match finds the very string it is meant to forbid and fails on
 * the documentation rather than on the code. This project has hit that exact
 * trap before (a guard that failed on its own comment containing `|| true`).
 * The stripper is therefore part of the assertion, not a convenience.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), "utf8"));

const TRIGGERS = [
  ["ReactionSummaryTooltip", "src/components/ReactionSummaryTooltip.tsx"],
  ["ShareSummaryTooltip", "src/components/ShareSummaryTooltip.tsx"],
] as const;

describe("summary triggers clear the gate's 44/32 tap floor", () => {
  for (const [name, path] of TRIGGERS) {
    describe(name, () => {
      const src = read(path);

      it("is a real <button>, not a clickable div", () => {
        expect(src).toMatch(/<button\s/);
        expect(src).not.toMatch(/<div[^>]*onClick=\{handleOpen\}/);
      });

      it("carries an accessible name that keeps the count", () => {
        expect(src).toMatch(/aria-label=\{`See who (reacted|shared) \(\$\{\w+\}\)`\}/);
      });

      it("sets h-12, so the long axis clears 44", () => {
        expect(src).toMatch(/className="cursor-pointer inline-flex[^"]*\bh-12\b/);
      });

      it("sets px-2.5, so the short axis clears 32", () => {
        expect(src).toMatch(/className="cursor-pointer inline-flex[^"]*\bpx-2\.5\b/);
      });

      it("has NOT been returned to the bare inline-flex box the gate rejected", () => {
        expect(src).not.toMatch(/className="cursor-pointer inline-flex items-center"/);
      });
    });
  }

  it("the gate's rule is still long>=44 AND short>=32 — if this fails, the numbers above are stale", () => {
    const gate = read("tools/uishot/capture.mjs");
    expect(gate).toMatch(/long\s*<\s*44\s*\|\|\s*short\s*<\s*32/);
  });
});
