/**
 * THREE FAULTS THE REAL-SCREEN HARNESS FOUND ON ITS FIRST RUN.
 *
 * All three had been live for weeks. None of them could have been found by a
 * unit test, and none of them is visible without rendering the whole feed, with
 * realistic data, at a phone width, and looking at it.
 *
 *  1. A caption that cannot wrap ran off the card and was sliced mid-word.
 *  2. `AnimatePresence` was handed `<Fragment>` children, so React 19 logged an
 *     error for every post and the wall's exit animation never ran.
 *  3. The reach/views row was cut in half at 360px on a busy post.
 *
 * These pin the fixes. A revert of any of them is a screenshot nobody would
 * look at twice — which is exactly how they got in.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const CAPTION = read("src/components/post/Caption.tsx");
const CARD = read("src/components/post/PostCard.tsx");
const FEED = read("src/pages/Feed.tsx");
const WALL = read("src/components/WallPosts.tsx");


describe("a caption must be able to break a word", () => {
  it("the caption paragraph pairs whitespace-pre-wrap with break-words", () => {
    // `whitespace-pre-wrap` keeps the author's line breaks but cannot break a
    // WORD. A filename or a pasted url is one token: measured at 360px it ran
    // 178px past the card and was cut off with no ellipsis and no "See more".
    const p = CAPTION.slice(CAPTION.indexOf("text-[13px]"), CAPTION.indexOf("text-[13px]") + 200);
    expect(p).toMatch(/whitespace-pre-wrap/);
    expect(p).toMatch(/break-words/);
  });
});

describe("AnimatePresence is never handed a Fragment", () => {
  it("the feed no longer wraps its Fragment list in AnimatePresence", () => {
    // It ran no exit animation (no card has an `exit` prop) and cost one React
    // error per post per render, because a Fragment cannot hold the ref
    // AnimatePresence attaches to measure its children.
    // The end marker must be CODE, not a comment: `code()` has just removed
    // every comment, so anchoring on one would give indexOf -1, slice(0, -1),
    // and a window stretching to the end of the file — a test that passes or
    // fails for reasons unrelated to the thing it names.
    const feed = stripComments(FEED);
    const list = feed.slice(feed.indexOf("{posts.map((post, i) => ("));
    const end = list.indexOf("<InfiniteScrollSentinel");
    expect(end).toBeGreaterThan(0);
    expect(list.slice(0, end)).not.toMatch(/<\/AnimatePresence>/);
  });

  it("the feed's other AnimatePresence blocks — which DO have exits — remain", () => {
    // The fix must not be "delete all the animation": the new-posts pill and
    // the back-to-top button both animate out and both still need it.
    expect(FEED.match(/<AnimatePresence>/g)?.length).toBe(2);
    expect(FEED).toMatch(/exit=\{\{ opacity: 0, y: -20 \}\}/);
    expect(FEED).toMatch(/exit=\{\{ opacity: 0, scale: 0\.8 \}\}/);
  });

  it("the wall keeps AnimatePresence and puts the key on the motion.div", () => {
    // Here the exit animation IS wanted — a deleted post should fade — and it
    // never ran, because the keyed child was a Fragment.
    const wall = stripComments(WALL);
    const block = wall.slice(wall.indexOf('<AnimatePresence mode="popLayout">'));
    const upto = block.slice(0, block.indexOf("</AnimatePresence>"));
    expect(upto).not.toMatch(/<Fragment/);
    expect(upto).toMatch(/<motion\.div\s+key=\{post\.id\}/);
    expect(upto).toMatch(/exit=\{\{ opacity: 0, y: -12 \}\}/);
  });

  it("the wall no longer imports Fragment it does not use", () => {
    expect(WALL).not.toMatch(/^import \{ Fragment,/m);
  });
});

describe("reach and views moved off the action row entirely", () => {
  /**
   * SUPERSEDES the `hidden sm:inline` fix that shipped hours earlier. That one
   * stopped the figures being SLICED at 360px, and it worked — but the owner
   * then reported the second half of the problem, which no width could fix:
   *
   *   "on post reactions shifting"
   *
   * The figures come from `displayEngagement`, which resolves AFTER the card
   * has painted, so the whole action row reflowed under the member's thumb as
   * they reached for it. His instruction:
   *
   *   "Viewed by and reached by will show on mouse over or on 1st touch on the
   *    image and emoji will show on the right side… web and app both."
   */
  it("the action row no longer contains the reach/views figures", () => {
    // This is what stops the row shifting: everything left in it arrives with
    // the post, so nothing in it can appear late.
    const row = CARD.slice(CARD.indexOf("── ACTION ROW"), CARD.indexOf("── Caption"));
    expect(row).not.toMatch(/stats\.reach/);
    expect(row).not.toMatch(/stats\.views/);
  });

  it("they render over the photograph instead", () => {
    const media = CARD.slice(CARD.indexOf("{imageUrls.length > 0 && ("));
    expect(media).toMatch(/data-testid="post-reach-views"/);
    expect(media).toMatch(/stats\.reach/);
    expect(media).toMatch(/stats\.views/);
  });

  it("web reveals them on hover, with no JavaScript in the path", () => {
    // A hover state React has to re-render for, on every card in a feed, is a
    // scroll-jank machine. CSS only.
    expect(CARD).toMatch(/group\/media/);
    expect(CARD).toMatch(/group-hover\/media:opacity-100/);
  });

  it("touch reveals them on the FIRST tap, and that tap opens nothing", () => {
    // Owner's choice, 2026-08-15, from three options.
    expect(CARD).toMatch(/interceptFirstTap=\{\(\) => \{/);
    const fn = CARD.slice(CARD.indexOf("interceptFirstTap={() => {"), CARD.indexOf("interceptFirstTap={() => {") + 400);
    expect(fn).toMatch(/setStatsRevealed\(true\)/);
    expect(fn).toMatch(/return true;/);
    // ...and it must NOT eat a tap when there is nothing to reveal.
    expect(fn).toMatch(/if \(!stats \|\| statsRevealed\) return false;/);
  });

  it("PostMedia only skips the viewer when the tap was actually consumed", () => {
    const MEDIA = read("src/components/post/PostMedia.tsx");
    expect(MEDIA).toMatch(/interceptFirstTap\?: \(\) => boolean/);
    // Both renderers — a single photograph and an album — or half the feed
    // keeps the old behaviour and the two feel different.
    expect((MEDIA.match(/if \(interceptFirstTap\?\.\(\)\) return;/g) ?? []).length).toBe(2);
  });
});

describe("the right of the row carries the reactions, Facebook-style", () => {
  it("each reaction shows its own emoji and its own count", () => {
    // Owner: "Icons + a count per reaction, total reaction on left side as per
    // FB current style."
    expect(CARD).toMatch(/breakdown\.map\(\(\{ type, emoji, count \}\)/);
    expect(CARD).toMatch(/formatNumber\(count\)/);
  });

  it("the total stays on the LEFT, beside the thumb, where it was", () => {
    const row = CARD.slice(CARD.indexOf("── ACTION ROW"), CARD.indexOf("── Caption"));
    expect(row.indexOf("formatNumber(post.like_count)")).toBeGreaterThan(0);
    expect(row.indexOf("formatNumber(post.like_count)")).toBeLessThan(row.indexOf("breakdown.map"));
  });

  it("a reaction nobody chose is not drawn as a zero", () => {
    expect(CARD).toMatch(/\.filter\(\(\[, n\]\) => \(n \?\? 0\) > 0\)/);
  });

  it("it is derived from data that arrives WITH the post, so it cannot shift", () => {
    // The whole point of the change. reaction_counts is on the post row.
    expect(CARD).toMatch(/Object\.entries\(post\.reaction_counts \?\? \{\}\)/);
  });

  it("`ml-auto` is outside the tooltip, or the group drifts off the edge", () => {
    // Measured in the harness: a margin on the tooltip's CHILD never reaches
    // the flex parent.
    expect(CARD).toMatch(/<div className="ml-auto">\s*\n\s*<ReactionSummaryTooltip/);
  });
});
