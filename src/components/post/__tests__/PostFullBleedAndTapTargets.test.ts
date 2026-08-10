/**
 * A POST IS SHAPED LIKE AN INSTAGRAM POST: NO BOX, ONE ICON ROW, CAPTION UNDER IT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HISTORY THIS FILE GUARDS — all of it from the owner, all on 2026-08-10,
 * each instruction arriving after he looked at the previous one on his phone.
 *
 * 1. THE WIDTH. `src/index.css` sets `.container { width: 90% !important }`
 *    — under a comment reading "Enforce full-bleed containers site-wide", which
 *    is the opposite of what it does. Every column sat 5% in from each screen
 *    edge: a ~20px dead strip down both sides of every photograph.
 *
 *    It could NOT be fixed by changing the 90%. `.container` is used in 150
 *    places — navbar, footer, Journal, Dashboard, Friends — and on those the 5%
 *    IS the page gutter. A post opts out by itself with
 *    `margin-left: calc(50% - 50vw)`, phones only.
 *
 * 2. THE BUTTONS were `py-2` around a 20px icon — a 36px target, under
 *    Android's 48dp minimum — and were made 48×48.
 *
 * 3. THEN HE SAW 48×48 NEXT TO INSTAGRAM: "icons are big unparral, match the
 *    icon size instagram". So the squares became 44 wide × 48 TALL — height is
 *    what a thumb needs in a horizontal row, and it is unchanged. The width is
 *    the icon plus px-2.5, which is what Instagram looks like. **Anything that
 *    reduces the 48px height puts back the bug he reported at 36px.**
 *
 * 4. "I told No border anything to anywhere, example like Instagram, didnt do
 *    it it." `md:border` and `md:mb-4` are therefore gone: phone and desktop
 *    render the same shape, and the hairline between posts is the only border
 *    left on the component.
 *
 * 5. Shown Instagram's order and asked to choose, he took it exactly: photo →
 *    icon row with the counts beside the icons → "<name> caption" → comments.
 *    That collapsed TWO rows (a counts row, then a divider, then a bare icon
 *    row) into one, and moved the caption below the actions.
 *
 * WHY THE ICON GREW AND NOT JUST THE HIT AREA
 *   On 2026-08-03 the owner called an invisible-only 44px tap zone "fraud —
 *   button same size as before". A fix you cannot see is indistinguishable from
 *   no fix. The icons are 24px, the same as Instagram's.
 *
 * These read the SOURCE rather than rendering, for the reason
 * SendButtonTapTarget.test.ts gives: jsdom has no layout engine and reports
 * every element as 0 × 0, so a rendered assertion about size or width would
 * pass no matter how small the button got. Real geometry is measured in
 * Chromium against the production bundle before shipping.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const postCard = read("src/components/post/PostCard.tsx");
/**
 * ReactionPicker with its comments stripped. The prose in that file explains
 * what the old sizes used to be, and a naive substring search matched the
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

  it("draws NO border on any edge, at any screen size", () => {
    // Two instructions, both his, both on 2026-08-10. First "I told No border
    // anything to anywhere, example like Instagram", which took away
    // `md:border` and the desktop card. Then, looking at the result: "between
    // two posts there is line, but instagram has no border, why kept ??" — so
    // the separating hairline went as well.
    expect(postCardRoot, "the separator between posts is back").not.toContain("border-b");
    expect(postCardRoot, "md:border puts the desktop card back").not.toContain("md:border");
    expect(postCardRoot).not.toMatch(/border/);
    expect(postCardRoot, "rounded corners at a screen edge look broken").not.toMatch(/rounded/);
    expect(skeleton, "the loading placeholder must match").not.toMatch(/border/);
  });

  it("separates posts by ONE fixed gap, defined in ONE place", () => {
    // With no border, the gap IS the separator, so it has to be the same after
    // every post. Measured on the live feed while it was not: the space between
    // the last text of one post and the first of the next came out at 21px,
    // 23px, 34px and once at MINUS 1px, because it was whatever the last
    // element's own padding happened to be. Owner: "After removing the thin
    // border line between two post gap also maintain exactly like Instagram."
    //
    // Now: `mb-4` on the card and nothing else. Caption carries no bottom
    // padding, so a post that ends in a caption and one that ends in the icon
    // row leave the same 16px.
    expect(postCardRoot).toContain("mb-4");
    expect(postCardRoot, "a second source of spacing is how it drifted before").not.toContain("mb-0");
    expect(postCardRoot).not.toContain("md:mb-4");
    const caption = read("src/components/post/Caption.tsx");
    expect(caption, "the caption must not add its own bottom padding").toContain('<div className="px-3">');
    expect(wall).toContain('className="space-y-0"');
    expect(wall, "list spacing on top of the card margin doubles the gap").not.toContain("md:space-y-4");
    expect(postCard, "the header's top padding is the other half of the gap").toContain("flex items-center gap-2.5 p-3 pb-2");
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   The action row. Sliced from its own banner to the caption that follows it,
   so a change to either boundary fails loudly instead of silently widening
   what these assertions look at.
   ───────────────────────────────────────────────────────────────────────── */
const ACTION_ANCHOR = "── ACTION ROW — ICONS WITH THEIR COUNTS BESIDE THEM ──";
const CAPTION_ANCHOR = "── Caption, UNDER the actions";
const COMMENTS_ANCHOR = "── Comments ──";
const MEDIA_ANCHOR = "── Media ──";

const actionButtons = (() => {
  const start = postCard.indexOf(ACTION_ANCHOR);
  expect(start, "the action row moved — update this test").toBeGreaterThan(-1);
  const end = postCard.indexOf(CAPTION_ANCHOR, start);
  expect(end, "the caption no longer follows the action row").toBeGreaterThan(start);
  return postCard.slice(start, end).replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
})();

describe("react, comment and share are thumb-sized", () => {
  it("keeps the 48px height that fixed 'too small / hard to tap'", () => {
    // h-12 IS 48px. It replaced min-h-[48px] when the square became a
    // rectangle; the height is the same number and must stay that way.
    const targets = actionButtons.match(/h-12 px-2\.5/g) ?? [];
    // comment + share here; the react button lives in ReactionPicker.
    expect(targets.length).toBe(2);
    expect(picker).toContain("h-12 px-2.5");
  });

  it("groups the icons on the LEFT, Instagram-style", () => {
    // Owner, with an Instagram screenshot: "the icons will be all in left
    // allignment with nice space". A flex row with no justify- rule and no
    // grow on the children is left-aligned by default; what must never come
    // back is anything that stretches them across the width.
    expect(actionButtons).not.toContain("basis-1/3");
    expect(picker).not.toContain("basis-1/3");
    expect(actionButtons, "the buttons must not stretch across the row").not.toContain("flex-1");
    expect(actionButtons).not.toContain("justify-around");
    expect(actionButtons).not.toContain("justify-between");
  });

  it("draws no rule above the icons", () => {
    // Instagram has no divider there. It was `mx-2.5 border-t border-border`.
    expect(actionButtons, "a divider above the icons is one of the borders he removed")
      .not.toContain("border-t");
  });

  it("carries NO text label at any screen size", () => {
    // "After Like Comment and Share icon dont write the text" — so `hidden
    // md:inline` is not enough; the words are gone entirely.
    expect(actionButtons).not.toContain("post.comment\")}</span>");
    expect(actionButtons).not.toMatch(/<span className="hidden md:inline">/);
    expect(picker).not.toMatch(/<span className="hidden md:inline">/);
  });

  it("makes the icons visibly bigger, not just the invisible hit area", () => {
    // Owner, 2026-08-03: an invisible-only tap zone is "fraud — button same
    // size as before". Icons are 24px everywhere now — Instagram's size.
    const grown = actionButtons.match(/className="h-6 w-6"/g) ?? [];
    expect(grown.length).toBe(2);
    expect(picker).toContain('className="h-6 w-6"');
    // Same stroke as the two beside it. Lucide defaults to 2, and a single
    // heavier glyph in a row of three is visible immediately — measured on
    // the live site as stroke-width 2 next to two at 1.75.
    expect(picker).toMatch(/<ThumbsUp className="h-6 w-6" strokeWidth=\{1\.75\} \/>/);
  });

  it("uses Instagram's paper plane for share, and its lighter stroke", () => {
    // Share2 is a three-node network glyph — heavier than anything in
    // Instagram's row and not the shape anyone recognises as "send". Lucide's
    // default stroke is 2; Instagram's outline icons are visibly thinner.
    expect(actionButtons, "the network-nodes glyph is back").not.toMatch(/<Share2 className="h-6 w-6"/);
    expect(actionButtons).toMatch(/<Send className="h-6 w-6" strokeWidth=\{1\.75\} \/>/);
    expect(actionButtons).toMatch(/<MessageCircle className="h-6 w-6" strokeWidth=\{1\.75\} \/>/);
  });

  it("writes the like count as a plain number, with no emoji in front of it", () => {
    // Two coloured faces used to sit between the like button and the comment
    // button, which is what broke the even spacing of the row. The breakdown by
    // emoji still exists — it is what ReactionSummaryTooltip opens.
    expect(actionButtons, "the emoji cluster is back in the row").not.toContain("REACTION_EMOJI_MAP");
    expect(actionButtons).toContain("ReactionSummaryTooltip");
  });

  it("renders the chosen reaction in the SAME 24px box as the outline icons", () => {
    // "icons are big unparral". A colour emoji at text-2xl paints well outside
    // its em box and rendered around 30px, so a post you had reacted to showed
    // a bigger, higher symbol than the two icons beside it.
    expect(picker, "sizing an emoji by font-size alone is what made it unparallel")
      .not.toContain("text-2xl");
    expect(picker).toMatch(/h-6 w-6 flex items-center justify-center text-\[20px\] leading-none/);
  });

  it("names each icon-only button for screen readers", () => {
    // With the words gone the button has no accessible name unless given one,
    // and a sighted member gets no tooltip either.
    expect(actionButtons).toMatch(/aria-label=\{t\("post\.comment"\)\}/);
    expect(actionButtons).toMatch(/aria-label=\{t\("post\.share"\)\}/);
    expect(actionButtons).toMatch(/title=\{t\("post\.comment"\)\}/);
    expect(actionButtons).toMatch(/title=\{t\("post\.share"\)\}/);
  });
});

describe("the card is laid out in Instagram's order", () => {
  it("puts the photo first, then the icons, then the caption, then the comments", () => {
    const media = postCard.indexOf(MEDIA_ANCHOR);
    const actions = postCard.indexOf(ACTION_ANCHOR);
    const caption = postCard.indexOf(CAPTION_ANCHOR);
    const comments = postCard.indexOf(COMMENTS_ANCHOR);
    for (const [name, at] of [["media", media], ["actions", actions], ["caption", caption], ["comments", comments]] as const) {
      expect(at, `the ${name} section is missing`).toBeGreaterThan(-1);
    }
    expect(actions, "the icon row must come after the photo").toBeGreaterThan(media);
    expect(caption, "the caption must come after the icon row").toBeGreaterThan(actions);
    expect(comments, "the comments must come last").toBeGreaterThan(caption);
  });

  it("shows each count beside its own icon instead of on a separate row", () => {
    // The old shape was: a counts row, a horizontal rule, then a row of bare
    // icons — two rows for the same three facts.
    expect(postCard, "the separate counts row is back").not.toContain("── Reactions Row ──");
    expect(actionButtons).toContain("formatNumber(post.like_count)");
    expect(actionButtons).toContain("formatNumber(post.comment_count)");
    expect(actionButtons).toContain("formatNumber(post.share_count)");
  });

  it("keeps every count's tooltip when the count moves", () => {
    // Moving a number is not an excuse to drop what it opens.
    expect(actionButtons).toContain("ReactionSummaryTooltip");
    expect(actionButtons).toContain("ShareSummaryTooltip");
  });

  it("keeps a count hidden while it is zero", () => {
    // A fresh post shows three clean icons and no zeros, as on Instagram.
    expect(actionButtons).toContain("post.like_count > 0");
    expect(actionButtons).toContain("post.comment_count > 0");
    expect(actionButtons).toContain("post.share_count > 0");
  });

  it("writes the author's name in front of the caption, inside the clamp", () => {
    // Instagram's "<name> caption". Passed as Caption's `prefix` so it sits
    // INSIDE the clamped paragraph — above it, the name would survive on its
    // own line while the sentence it introduces was collapsed.
    const captionBlock = postCard.slice(postCard.indexOf(CAPTION_ANCHOR), postCard.indexOf(COMMENTS_ANCHOR));
    expect(captionBlock).toContain("prefix={");
    expect(captionBlock).toContain("post.author_name");
    const caption = read("src/components/post/Caption.tsx");
    expect(caption, "the prefix must render inside the clamped <p>").toMatch(
      /\{prefix\}\s*\n\s*<RichContentRenderer/,
    );
  });

  it("keeps reach and viewed, which he was offered the chance to remove", () => {
    // Asked on 2026-08-10 which of three details to drop from the card, he
    // answered "Nothing — keep all three".
    expect(actionButtons).toContain("reached");
    expect(actionButtons).toContain("viewed");
    expect(postCard, "the Suggested pill was kept too").toContain("Suggested");
  });
});
