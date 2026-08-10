/**
 * A POST FILLS THE PHONE, AND ITS THREE BUTTONS CAN BE HIT WITH A THUMB.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, measured 2026-08-10 from the owner's own screenshot
 *
 * He sent a screenshot of his feed beside one of Instagram and said the posts
 * were "not coming with 100% and without any border", and that the buttons
 * were "too small / hard to tap".
 *
 * 1. THE WIDTH. `src/index.css` sets `.container { width: 90% !important }`
 *    — under a comment that reads "Enforce full-bleed containers site-wide",
 *    which is the opposite of what it does. Every page column therefore sits
 *    5% in from each screen edge: a ~20px dead strip down both sides of every
 *    photograph on a 400px phone. That matched the screenshot exactly.
 *
 *    It could NOT be fixed by changing the 90%. `.container` is used in 150
 *    places — navbar, footer, Journal, Dashboard, Friends, Certificates — and
 *    on those the 5% IS the page gutter. So a post now opts out of its parent
 *    width by itself, on phones only, with `margin-left: calc(50% - 50vw)`.
 *
 * 2. THE BORDER. The card was `border border-border rounded-xl`. Instagram has
 *    no box around a post — one hairline between posts, nothing else.
 *
 * 3. THE BUTTONS. React / comment / share were `py-2` around a 20px icon —
 *    a 36px target, under Android's 48dp minimum and iOS's 44pt, and the row
 *    was `justify-start md:justify-stretch`, so on a phone all three huddled
 *    against the left edge instead of dividing the width.
 *
 * WHY THE ICON GREW AND NOT JUST THE HIT AREA
 *   On 2026-08-03 the owner called an invisible-only 44px tap zone "fraud —
 *   button same size as before". He was right, and it is now a working rule:
 *   a fix you cannot see is indistinguishable from no fix. So the icons went
 *   20px → 24px on phones as well as the target going 36px → 48px.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These read the source rather than rendering. That is deliberate and it is the
 * same reason SendButtonTapTarget.test.ts gives: jsdom has no layout engine and
 * reports every element as 0 x 0, so a rendered assertion about size or width
 * would pass no matter how small the button got. The real geometry was checked
 * in Chromium against the production bundle before this shipped.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const postCard = read("src/components/post/PostCard.tsx");
/**
 * ReactionPicker with its comments stripped. The prose in that file explains
 * what `md:flex-1` used to do, and a naive substring search matched the
 * explanation instead of the code — the same trap the mojibake scan fell into
 * when it flagged its own documentation. Check the code, never the commentary.
 */
const picker = read("src/components/ReactionPicker.tsx")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const skeleton = read("src/components/post/PostCardSkeleton.tsx");
const wall = read("src/components/WallPosts.tsx");
const css = read("src/index.css");

/** The root <div> of PostCard — the element that carries the card's shape. */
const postCardRoot = (() => {
  const i = postCard.indexOf("return (");
  expect(i, "PostCard's return moved — update this test").toBeGreaterThan(-1);
  const open = postCard.indexOf("<div", i);
  return postCard.slice(open, postCard.indexOf(">", open) + 1);
})();

describe("a post reaches both edges of the phone", () => {
  it("opts out of the 90% container on phones", () => {
    expect(postCardRoot).toContain("bleed-phone");
    expect(skeleton).toContain("bleed-phone");
  });

  it("defines bleed-phone as a real viewport-width breakout, phones only", () => {
    const at = css.indexOf(".bleed-phone");
    expect(at, "the .bleed-phone rule is gone from src/index.css").toBeGreaterThan(-1);
    const rule = css.slice(at, at + 260);
    expect(rule).toMatch(/width:\s*100vw/);
    // The 50% resolves against the parent and the 50vw against the screen, so
    // this works whatever the parent's width is — nothing to keep in sync.
    expect(rule).toMatch(/margin-left:\s*calc\(50%\s*-\s*50vw\)/);
    expect(rule).toMatch(/margin-right:\s*calc\(50%\s*-\s*50vw\)/);
    // Guarded by a phone-only media query: the 590px desktop column is unchanged.
    const before = css.slice(Math.max(0, at - 200), at);
    expect(before, "bleed-phone must sit inside a max-width media query").toMatch(
      /@media\s*\(max-width:\s*767\.98px\)/,
    );
  });

  it("keeps the sideways-scroll guard that makes the breakout safe", () => {
    // Without this, a 100vw element inside a 90% parent can push the document
    // wider than the screen and create a horizontal scrollbar.
    expect(read("src/App.css")).toMatch(/overflow-x:\s*hidden/);
  });

  it("has no box drawn around it on a phone", () => {
    // A hairline BETWEEN posts is the separator; a four-sided border is the box
    // the owner asked to remove. `md:border` restores the card on desktop.
    expect(postCardRoot).toContain("border-b");
    expect(postCardRoot).toContain("md:border");
    expect(postCardRoot).not.toMatch(/(^|\s)border\s/);
    expect(postCardRoot, "rounded corners at a screen edge look broken").not.toContain("rounded-xl");
  });

  it("stacks posts flush so the hairline is the only separator", () => {
    expect(postCardRoot).toContain("mb-0");
    expect(postCardRoot).toContain("md:mb-4");
    expect(wall, "a 16px gap with no border reads as floating text").toContain(
      'className="space-y-0 md:space-y-4"',
    );
  });
});

describe("react, comment and share are thumb-sized", () => {
  /** Every action-bar button's opening tag, comments stripped. */
  const actionButtons = (() => {
    const start = postCard.indexOf("── Action Bar ──");
    expect(start, "the action bar moved — update this test").toBeGreaterThan(-1);
    const block = postCard.slice(start, postCard.indexOf("── Comments ──", start));
    return block.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  })();

  it("gives each button the 48px Android minimum", () => {
    const targets = actionButtons.match(/min-h-\[48px\]/g) ?? [];
    // comment + share here; the react button lives in ReactionPicker.
    expect(targets.length).toBe(2);
    expect(picker).toContain("min-h-[48px]");
  });

  it("divides the full width into three EQUAL thirds", () => {
    // Two bugs here, not one.
    //   `md:flex-1` meant that on a phone the buttons shrank to their icons and
    //   huddled left under `justify-start`.
    //   Plain `flex-1` (flex-basis 0) then made them UNEQUAL — measured in
    //   Chromium at 390px: 107 / 131 / 131, because the react button sits in a
    //   wrapper with no padding while the other two carry px-3. `basis-1/3` is
    //   a percentage of the row, so border-box padding is inside it and all
    //   three come out identical. Re-measured: 123 / 123 / 123.
    expect(actionButtons).not.toContain("md:flex-1");
    expect(picker).not.toContain("md:flex-1");
    const thirds = actionButtons.match(/basis-1\/3 grow/g) ?? [];
    expect(thirds.length).toBe(2);
    expect(picker).toContain("basis-1/3 grow");
    expect(actionButtons).not.toContain("justify-start");
  });

  it("makes the icons visibly bigger, not just the invisible hit area", () => {
    // Owner, 2026-08-03: an invisible-only tap zone is "fraud — button same
    // size as before". Both icons go 20px -> 24px on phones.
    const grown = actionButtons.match(/h-6 w-6 md:h-5 md:w-5/g) ?? [];
    expect(grown.length).toBe(2);
    expect(picker).toContain("h-6 w-6 md:h-5 md:w-5");
    expect(picker, "the chosen-reaction emoji has to grow with them").toContain("text-2xl md:text-lg");
  });

  it("still names each button for screen readers once the label is hidden", () => {
    // The text label is `hidden md:inline`, so on a phone the button is an icon
    // with no accessible name unless one is given.
    expect(actionButtons).toMatch(/aria-label=\{t\("post\.comment"\)\}/);
    expect(actionButtons).toMatch(/aria-label=\{t\("post\.share"\)\}/);
  });
});
