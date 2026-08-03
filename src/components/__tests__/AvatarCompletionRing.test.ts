/**
 * THE PROFILE-COMPLETION PANEL STAYS ON THE SCREEN, AND A THUMB CAN DRIVE IT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG — owner report with screenshot, 2026-08-03
 *
 * On the mobile profile the completion ring is 80px and sits 16px from the left
 * screen edge. Its "complete your profile" panel was:
 *
 *   1. positioned `left-1/2 -translate-x-1/2` — centred on a 40px midpoint,
 *      so the 224px panel started at x = 16 + 40 − 112 = −56: a third of it
 *      OFF the left edge of the screen. "Showing outside of page."
 *
 *   2. gated on `hovered` set by mouseenter/mouseleave ONLY. A phone tap fires
 *      a synthetic mouseenter and never a mouseleave, so the panel appeared on
 *      first touch and stuck, with no deliberate way to open or dismiss it.
 *
 * The geometry check that catches (1) needs real layout, which jsdom does not
 * do — every element measures 0×0 there. So, as with SendButtonTapTarget, this
 * test pins the SOURCE: the classes and handlers that make the panel behave.
 * The rendered proof was taken in a real browser before shipping.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/components/AvatarCompletionRing.tsx"), "utf8");
const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** The tooltip's JSX only — from its gate to its closing tag. */
const panel = (() => {
  const start = body.indexOf("hovered && missing.length");
  expect(start, "the tooltip gate moved — update this test").toBeGreaterThan(-1);
  return body.slice(start, start + 600);
})();

describe("the completion panel stays on screen", () => {
  it("is anchored to the ring's left edge, never centred off-screen", () => {
    expect(panel).toMatch(/left-0/);
    expect(panel).not.toMatch(/left-1\/2/);
    expect(panel).not.toMatch(/-translate-x-1\/2/);
  });

  it("can never be wider than the viewport", () => {
    expect(panel).toMatch(/max-w-\[calc\(100vw-2rem\)\]/);
  });
});

describe("a thumb can open and close it", () => {
  it("click toggles it on touch devices only", () => {
    // A tap fires mouseenter AND click, in that order. An ungated click-toggle
    // opened the panel and instantly closed it on every first tap (measured in
    // a rendered harness). Hover and click must each be gated to their own
    // pointer world or they fight.
    expect(body).toMatch(/onClick=\{\(\) => \{ if \(isTouch\(\)\) setHovered\(\(h\) => !h\); \}\}/);
    expect(body).toMatch(/\(pointer: coarse\)/);
  });

  it("hover drives it on fine pointers only", () => {
    expect(body).toMatch(/onMouseEnter=\{\(\) => \{ if \(!isTouch\(\)\) setHovered\(true\); \}\}/);
    expect(body).toMatch(/onMouseLeave=\{\(\) => \{ if \(!isTouch\(\)\) setHovered\(false\); \}\}/);
  });
});
