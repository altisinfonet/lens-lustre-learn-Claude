/**
 * THE TOP MENU BAR STAYS PUT WHILE SCROLLING — ON WEB.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner rule, 2026-08-04: "Only for Web: Top Menu bar will be strict all the
 * time, even on scrolling all the time top bar will be fix."
 *
 * THE TRAP THIS PINS, because it looks fixed already and is not:
 *
 * `Navbar.tsx` has carried `sticky top-0 z-50` for a long time and it never
 * held. Measured on production before the fix — the nav's COMPUTED style was
 * `position: sticky`, `top: 0px`, `z-index: 50`, all correct, and after
 * scrolling 1400px its bounding top was **-1400**: gone.
 *
 * `position: sticky` only holds while the element's CONTAINING BLOCK is on
 * screen. The nav's wrapper is exactly as tall as the bar (89px measured), so
 * the nav had 89px of travel and then left with its parent. The stickiness has
 * to live on the element whose parent spans the page.
 *
 * So a test that only asserted "Navbar has sticky" would have passed happily
 * for months while the bar scrolled away. These assert the LAYOUT WRAPPER, and
 * the rendered proof (pinned at top 0 at 1600px and 3000px of scroll) was taken
 * on the live page.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const layout = readFileSync(join(process.cwd(), "src/components/Layout.tsx"), "utf8");
/** Comments stripped — a source-pin test must never match its own explanation. */
const body = layout
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/** The header wrapper's className expression. */
const headerBlock = (() => {
  const at = body.indexOf("{!hideNav && (");
  expect(at, "the header wrapper moved — update this test").toBeGreaterThan(-1);
  return body.slice(at, body.indexOf("<Navbar", at));
})();

describe("the header sticks on web", () => {
  it("the WRAPPER carries the sticky, not just the nav inside it", () => {
    // This is the whole fix: sticky on the element whose parent spans the page.
    expect(headerBlock).toContain('"sticky top-0 z-50"');
  });

  it("sits above page content", () => {
    expect(headerBlock).toMatch(/z-50/);
  });

  it("is skipped inside the installed app, per 'Only for Web'", () => {
    expect(headerBlock).toContain("isNativeCapacitorApp()");
    // native -> undefined (unchanged behaviour), web -> sticky
    expect(headerBlock).toMatch(/isNativeCapacitorApp\(\)\s*\?\s*undefined\s*:\s*"sticky top-0 z-50"/);
  });

  it("imports the native check from the one helper that already exists", () => {
    expect(body).toMatch(/import \{ isNativeCapacitorApp \} from "@\/lib\/native\/authDeepLink"/);
  });

  it("leaves the home page's transparent overlay alone", () => {
    // /home overlays a transparent bar on the hero; that is a deliberate design
    // and the owner did not ask for it to change.
    expect(headerBlock).toContain('"absolute top-0 left-0 right-0 z-50"');
    expect(headerBlock).toMatch(/isHome/);
  });

  it("uses sticky rather than fixed, so no content padding is needed", () => {
    // A `fixed` bar leaves a gap at the top of every page unless every layout
    // adds matching padding — a maintenance trap. Sticky stays in flow.
    expect(headerBlock).not.toMatch(/\bfixed top-0\b/);
  });
});

describe("the nav keeps its own appearance", () => {
  const navbar = readFileSync(join(process.cwd(), "src/components/Navbar.tsx"), "utf8");

  it("still paints a background when not transparent", () => {
    // Without this the sticky bar would show page content straight through it.
    //
    // ⚠ THE BORDER ASSERTION WAS REMOVED ON PURPOSE, 2026-08-15, not to make a
    // test pass. The owner asked for it gone — "I want line be remove one top
    // menus" — which is the same instruction he gave for the post card on
    // 2026-08-10: "I told No border anything to anywhere, example like
    // Instagram". The blur and the translucent background are what separate the
    // bar from the page now, and BOTH are still asserted below, so the original
    // worry (page content showing straight through) is still covered.
    expect(navbar).not.toMatch(/border-b border-border/);
    expect(navbar).toMatch(/bg-background\/80/);
    expect(navbar).toMatch(/backdrop-blur/);
  });
});
