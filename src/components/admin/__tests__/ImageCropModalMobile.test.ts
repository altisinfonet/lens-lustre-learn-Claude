/**
 * THE CROP DIALOG'S TWO INVARIANTS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER REPORT, 2026-08-16, from his phone:
 *   "After uplaidng image any editing and Crop not working, any of options not
 *    wokring., croipping selction not wokring."
 *
 * Two separate faults were behind that, and both are the kind that come back
 * quietly because the code that causes them looks completely reasonable.
 *
 * ── 1. THE ELEMENT BOX AND THE PICTURE MUST BE THE SAME RECTANGLE ───────────
 *
 * `handleConfirm` maps the crop to the source with `naturalWidth / img.width`.
 * `img.width` is the ELEMENT's layout width. That is only the width of the
 * PICTURE while nothing lets the two diverge — and `object-contain` plus a
 * `max-height` is exactly what lets them diverge. Measured in Chromium at 360px
 * before the fix:
 *
 *     zoom 100%   element 270x480   painted 270x480   scale used 3.33  true 3.33
 *     zoom 200%   element 540x480   painted 270x480   scale used 1.67  true 3.33
 *
 * A member who zoomed in got a crop of the wrong part of their photograph, and
 * at high zoom the source rectangle left the image entirely and the preview
 * canvas drew nothing — the blank "After" panel he photographed. After the fix,
 * `used` equals `truth` at 100%, 200% and 400% on portrait, landscape and
 * square sources.
 *
 * Adding `object-contain` back "so it fits nicely" would reintroduce it in one
 * line, and nothing would fail. Hence this test.
 *
 * ── 2. NOTHING IN HERE MAY BE SMALLER THAN A THUMB ──────────────────────────
 *
 * The sweep measured EIGHTEEN targets under 44px: the close button at 16x16,
 * every zoom/rotate/mirror button at 20x20, the aspect chips at 35x27. That is
 * what "any of options not working" means when it is written by someone using
 * their thumb rather than a mouse.
 *
 * WHAT THIS TEST CANNOT DO, said plainly: it reads TEXT. It cannot measure a
 * pixel and it cannot drag a crop handle. The measuring is done by the
 * `crop-modal-tall`, `crop-modal-wide` and `crop-modal-avatar` screenshot
 * scenes, which render this dialog in real Chromium at three widths and fail on
 * any target under 44px. This file exists to catch the specific one-line
 * reversions that would put the faults back before anyone ran a sweep.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const src = stripComments(
  readFileSync(join(process.cwd(), "src/components/admin/ImageCropModal.tsx"), "utf8"),
);

/** The `<img>` the crop is measured against — sliced out so a match on one of
 *  the preview thumbnails elsewhere in the file cannot satisfy these checks. */
const cropImg = (() => {
  const at = src.indexOf('alt="Crop preview"');
  expect(at, "the crop image moved — update this test").toBeGreaterThan(-1);
  return src.slice(Math.max(0, at - 500), at + 400);
})();

describe("the crop image's box must equal the picture inside it", () => {
  it("does not use object-contain on the image the crop is measured from", () => {
    expect(
      /object-(contain|cover|fit)/.test(cropImg),
      "object-fit lets the element box grow away from the picture, and every " +
        "crop coordinate is derived from that box — this is the wrong-crop bug",
    ).toBe(false);
  });

  it("does not cap the image's own height", () => {
    // A max-height on the IMAGE clamps the box while the picture keeps its
    // ratio. The cap belongs on the scrolling container, which it now has.
    expect(
      /max-h-\[|maxHeight/.test(cropImg),
      "a height cap on the crop image reintroduces the mismatch; cap the container",
    ).toBe(false);
  });

  it("sizes the image by an explicit width with height auto", () => {
    expect(cropImg).toMatch(/height:\s*["']auto["']/);
    expect(cropImg).toContain("fitWidth");
  });

  it("measures the space and fits the photo at 100% zoom", () => {
    // Without this the member arrives already needing to scroll to see the
    // picture they are about to crop.
    expect(src).toContain("recomputeFit");
    expect(src).toMatch(/ResizeObserver/);
  });
});

describe("every control is reachable with a thumb", () => {
  it("has no p-1 icon buttons left — those measured 20x20", () => {
    expect(/className="[^"]*\bp-1\b[^"]*"/.test(src)).toBe(false);
  });

  it("uses h-11 (44px) for the dialog's own controls", () => {
    // 44px is the floor the whole project holds to. Counted rather than
    // spot-checked: header close, reset, 2 zoom, 2 rotate, 2 mirror, cancel,
    // confirm, and the aspect chips are all h-11.
    const h11 = src.match(/\bh-11\b/g) ?? [];
    expect(h11.length, "controls have dropped below the 44px floor again").toBeGreaterThanOrEqual(9);
  });
});

describe("the dialog behaves like a dialog", () => {
  it("locks the page behind it and restores what was there before", () => {
    // Owner: "this light boxes opened but back screen scrolled."
    expect(src).toMatch(/body\.style\.overflow\s*=\s*["']hidden["']/);
    expect(src).toMatch(/body\.style\.overflow\s*=\s*previous/);
  });

  it("makes the back gesture close it instead of leaving the page", () => {
    /**
     * Owner: "after any button noting working after gesture back".
     *
     * The first version of this asserted that the strings "popstate" and
     * "pushState" appear somewhere in the file, and it SURVIVED the mutation
     * that deletes the listener — because `removeEventListener("popstate", …)`
     * in the cleanup still contains the word. A test that a real regression
     * walks straight through is worse than no test, since it reports green.
     *
     * Pinned on the wiring itself, and on the handler calling `onCancel`,
     * which is the part that actually closes the dialog.
     */
    expect(src).toMatch(/addEventListener\(\s*["']popstate["']/);
    expect(src).toMatch(/history\.pushState\(/);
    expect(src).toMatch(/onPop\s*=\s*\(\)\s*=>\s*\{[^}]*onCancel\(\)/);
  });

  it("answers a two-finger pinch", () => {
    // Owner: "if someone tried to zoom and fit the position based on the grid
    // not happening, this happens in instagram".
    expect(src).toContain("onTouchStartCapture");
    expect(src).toMatch(/touches\.length !== 2/);
  });

  it("shows the rule-of-thirds guide the grid complaint was about", () => {
    expect(src).toContain("ruleOfThirds");
  });

  it("is announced as a modal", () => {
    expect(src).toContain('aria-modal="true"');
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DIALOG MUST STAY REACHABLE WHILE ANOTHER DIALOG IS OPEN.
 *
 * OWNER, 2026-08-16, on 1.2.9: "after uploadling any image clicked crop after
 * that any of option any fuction not wokring even not in web too, no cross, no
 * mirror, no moving the selection nothing - its like Screen is freezed - web
 * and app."
 *
 * `WallPosts` renders `ImageCropModal` as a SIBLING of the composer's Radix
 * <Dialog>, which is open when Crop is pressed. A Radix modal makes the rest of
 * the page inert by setting `pointer-events: none` on <body>; this overlay is
 * outside the dialog's content, so it inherited that and was painted perfectly
 * and completely deaf.
 *
 * Measured at 412px, hit-testing the centre of each control:
 *
 *     with `pointer-events-auto`      Cancel/Close/4:5/Mirror/ZoomIn/frame  ALL reachable
 *     without it                      Cancel/Close/4:5/Mirror               ALL dead
 *
 * WHY THIS TEST IS WORTH HAVING despite reading only text: the three crop
 * screenshot scenes mount this component ALONE, where the body is untouched
 * and everything works — which is exactly why every measurement reported to
 * the owner was true and useless. The arrangement, not the component, was
 * broken. `crop-modal-behind-dialog` reproduces the arrangement and is the
 * real proof; this pin is here so the one class that makes it work cannot be
 * "tidied away" by someone who does not know what it is holding up.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("the crop dialog survives being opened beside another dialog", () => {
  it("re-enables pointer events on its own root", () => {
    const root = src.slice(0, src.indexOf('role="dialog"'));
    expect(
      root,
      "without pointer-events-auto the whole dialog is inert whenever a Radix " +
        "dialog is open behind it — which is every time Crop is pressed",
    ).toContain("pointer-events-auto");
  });

  it("sits above the Radix overlay it has to escape", () => {
    // Radix's overlay is z-50. Paint order was never the problem, but if this
    // ever dropped below 50 the dialog would be invisible as well as inert.
    expect(src).toContain("z-[100]");
  });
});
