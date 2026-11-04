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
 * (4 Nov 2026, Owner, Instagram's side-to-side spacing: the box is now
 * ROW_COUNT_TAP — h-11 -mt-3 pt-3, content-sized, `min-w-8` for the short axis
 * with the number at the start. The history below is how it got here.)
 *
 * `h-11 -my-1.5 px-2.5` is therefore not decoration and not arbitrary:
 *   • h-11 = 44px  -> long axis 44, clears 44
 *   • px-2.5 = 20px total -> the narrowest content (16px) reaches 36, clears 32
 *   • -my-1.5 takes 12px back out of the flow: since 3 Nov 2026 (Owner, "too
 *     much space" under the photo) the row is 32px, its Like / Comment / Share
 *     boxes h-8 with a 44px finger target (`.tap-44-under`). Before that this
 *     was h-12, the same box as those buttons.
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

/** The row's one count box (src/components/post/actionRowGeometry.ts), both template parts joined. */
const GEOMETRY = read("src/components/post/actionRowGeometry.ts");
const ROW_TAP_SRC = GEOMETRY.match(/ROW_TAP\s*=\s*"([^"]*)"/)?.[1] ?? "";
const COUNT_TAP = (GEOMETRY.match(/ROW_COUNT_TAP\s*=\s*`([^`]*)`/)?.[1] ?? "").replace("${ROW_TAP}", ROW_TAP_SRC);

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

      it("uses the row's one count box (ROW_COUNT_TAP)", () => {
        expect(src).toMatch(/className=\{ROW_COUNT_TAP\}/);
      });

      it("sets h-11, so the long axis clears 44 — reaching UP only (-mt-3 pt-3), never down into the caption (Owner 3 Nov 2026; review of #867)", () => {
        expect(COUNT_TAP).toMatch(/\bh-11\b/);
        expect(COUNT_TAP).toMatch(/\s-mt-3 pt-3\b/);
        expect(COUNT_TAP).not.toMatch(/-m[yb]-|\bmb-/);
      });

      it("sets min-w-8 with the number at the START, so the short axis clears 32 without moving the number off its icon (Owner 4 Nov 2026)", () => {
        expect(COUNT_TAP).toMatch(/\bmin-w-8\b/);
        expect(COUNT_TAP).toMatch(/\bjustify-start\b/);
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
