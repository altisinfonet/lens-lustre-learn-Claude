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

describe("the reach/views row fits a 360px screen", () => {
  it("the words are hidden on phones; the numbers never are", () => {
    // Owner's decision, 2026-08-15: icon plus figure on a phone, words from
    // `sm` up. A number cut through the middle reads as a smaller number,
    // which is worse than no number at all.
    const start = CARD.indexOf('<Users className="h-3 w-3" />');
    const row = CARD.slice(start, CARD.indexOf("stats.views", start) + 300);
    expect(start).toBeGreaterThan(0);
    expect(row).toMatch(/<span className="hidden sm:inline">reached<\/span>/);
    expect(row).toMatch(/<span className="hidden sm:inline">viewed<\/span>/);
    // The figures themselves carry no responsive class — they must always show.
    expect(row).toMatch(/font-medium text-foreground\/80">\{formatEngagementCount\(stats\.reach\)\}/);
    expect(row).toMatch(/font-medium text-foreground\/80">\{formatEngagementCount\(stats\.views\)\}/);
  });
});
