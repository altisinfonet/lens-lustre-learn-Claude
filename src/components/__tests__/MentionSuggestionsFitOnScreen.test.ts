/**
 * THE @NAME LIST HAS TO FIT ON THE PHONE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, measured in the harness on 2026-08-31
 *
 * The owner reported, with a screenshot: "during tagging in a coments, options
 * are hiding not coming in fornt". Rendered at 360px in the harness scene
 * `mention-list-over-comment-box`:
 *
 *     list left 92px + width 277.3px = 369.3px   against a 360px screen
 *     document.scrollWidth 369                    the PAGE scrolled sideways
 *     suggestions overlay z-index 1   vs   send button z-index 10
 *
 * So two things at once: the list ran 9.3px off the right edge of the screen
 * (taking the end of every long name with it), and the send button painted over
 * its bottom-right corner. Desktop was fine, which is why it survived review.
 *
 * ⚠ THE CAUSE IS THE PART WORTH REMEMBERING.
 *
 * react-mentions ALREADY guards its right edge. From updateSuggestionsPosition:
 *
 *     if (left + suggestions.offsetWidth > container.offsetWidth) right = 0
 *     else                                                        left = left
 *
 * It measures `suggestions` — the OVERLAY. Every sizing rule had been written on
 * `list`, the <ul> inside it, together with `position: absolute`. An absolutely
 * positioned child is out of flow, so the overlay never grew past the library's
 * default `minWidth: 100`. The guard compared 100px, decided the list fitted,
 * and anchored it to the caret while 277px of names hung off the screen.
 *
 * The guard was not missing. It was being fed the wrong number by this file's
 * own styling. That is why the fix is structural — sizing on the overlay, looks
 * on the <ul> — and why this test asserts the STRUCTURE rather than a pixel.
 *
 * This test reads the source rather than rendering: jsdom reports every element
 * as 0 x 0, so a rendered assertion about width would pass at any size. The
 * pixel proof lives in tools/uishot/mention-overflow.mjs, which drives real
 * Chromium at 360px and fails on the pre-fix code.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const src = readFileSync(join(process.cwd(), "src/components/MentionInput.tsx"), "utf8");
const code = stripComments(src);

/** The `suggestions: { … }` style block, comments stripped. */
const suggestionsBlock = (() => {
  const start = code.indexOf("suggestions: {");
  expect(start, "the suggestions style block moved — update this test").toBeGreaterThan(-1);
  // Balance braces from the opening one so `list` and `item` are included.
  const from = code.indexOf("{", start);
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced braces in the suggestions style block");
})();

/** Just the nested `list: { … }` sub-block. */
const listBlock = (() => {
  const start = suggestionsBlock.indexOf("list: {");
  expect(start, "the list sub-block moved — update this test").toBeGreaterThan(-1);
  const from = suggestionsBlock.indexOf("{", start);
  let depth = 0;
  for (let i = from; i < suggestionsBlock.length; i++) {
    if (suggestionsBlock[i] === "{") depth++;
    else if (suggestionsBlock[i] === "}") {
      depth--;
      if (depth === 0) return suggestionsBlock.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced braces in the list sub-block");
})();

/** The overlay's own properties: the block minus its nested `list`/`item`. */
const overlayOwnProps = (() => {
  const listAt = suggestionsBlock.indexOf("list: {");
  return suggestionsBlock.slice(0, listAt);
})();

describe("the @mention list cannot leave the screen", () => {
  it("sizes the OVERLAY, which is what the library's right-edge guard measures", () => {
    // This is the whole fix. If width moves back onto `list`, the overlay
    // collapses to minWidth:100, the guard is blind again, and the list walks
    // off a 360px screen exactly as it did on 2026-08-31.
    expect(overlayOwnProps, "the overlay needs its own width").toMatch(/width:\s*"max-content"/);
    expect(overlayOwnProps, "the overlay needs a maxWidth bounded by the field").toMatch(
      /maxWidth:\s*"min\(320px,\s*100%\)"/,
    );
  });

  it("does NOT take the <ul> out of flow — that is what disarmed the guard", () => {
    expect(listBlock, "position on `list` collapses the overlay").not.toMatch(/position:\s*"absolute"/);
    expect(listBlock, "sizing belongs on the overlay, not the <ul>").not.toMatch(/\bwidth:/);
    expect(listBlock, "sizing belongs on the overlay, not the <ul>").not.toMatch(/\bmaxWidth:/);
    expect(listBlock, "a minWidth wider than a 360px field re-opens the overflow").not.toMatch(/\bminWidth:/);
    expect(listBlock, "hand-positioning the <ul> is what broke this").not.toMatch(/\bbottom:/);
  });

  it("opens upward using the library's computed placement, not a fixed bottom:100%", () => {
    // The composer sits at the bottom of a thread, so the list must open up.
    // `forceSuggestionsAboveCursor` recomputes from the measured overlay
    // height, so it stays right as the box grows from one line to five.
    expect(code).toMatch(/forceSuggestionsAboveCursor/);
  });

  it("stacks above the send button", () => {
    // The send button is z-10 and sits INSIDE the field; the library's default
    // for this overlay is z-index 1, so the list rendered underneath it.
    const z = overlayOwnProps.match(/zIndex:\s*(\d+)/);
    expect(z, "the suggestions overlay needs an explicit zIndex").not.toBeNull();
    expect(Number(z![1])).toBeGreaterThan(10);
    // ⚠ On the overlay, not on `list`: the <ul> is a child of the box that
    // already lost the stacking comparison, so a zIndex there changes nothing.
    expect(listBlock, "zIndex on `list` is inert — it belongs on the overlay").not.toMatch(/zIndex/);
  });

  it("truncates a long name instead of widening the list", () => {
    expect(suggestionsBlock).toMatch(/textOverflow:\s*"ellipsis"/);
    expect(suggestionsBlock).toMatch(/whiteSpace:\s*"nowrap"/);
    // A flex row's default min-width is its content, so without min-w-0 the
    // row refuses to shrink and the ellipsis never appears.
    expect(code).toMatch(/className="flex min-w-0 items-center/);
    expect(code).toMatch(/className="truncate font-medium"/);
  });
});
