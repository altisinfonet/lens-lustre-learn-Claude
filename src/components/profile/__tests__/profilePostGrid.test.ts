/**
 * ALARMS FOR THE WALL RHYTHM.
 *
 * Owner, 2026-08-15, settled after FOUR rounds. The last two rulings are the
 * ones this file guards:
 *   • *"this style not approved as long vertical block found. only horizontal
 *     block after three samll block is approved"* → the band is fixed at 3:2.
 *   • *"the layout what ever you showed me that is wrong. I want this style"*,
 *     sent as a PICTURE showing three full rows of squares before the band →
 *     nine squares per block, not three.
 *
 * Three claims are made by that layout and all three are testable:
 *   1. Nine squares — three whole rows — then one band, forever.
 *   2. The band is ALWAYS 3:2: horizontal, and the same height every time.
 *   3. The photograph inside it is never cropped to fill it.
 *
 * The rhythm is asserted on the arithmetic, not on rendered nodes: a test that
 * counts `<img>` elements passes just as happily when every tile is a showcase.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BLOCK, SQUARES_PER_BLOCK, SHOWCASE_ASPECT, isShowcase, tileSrc,
} from "@/components/profile/ProfilePostGrid";
import type { UnifiedPost } from "@/types/post";

const GRID = readFileSync(
  join(process.cwd(), "src/components/profile/ProfilePostGrid.tsx"),
  "utf8",
);

function post(over: Partial<UnifiedPost> = {}): UnifiedPost {
  return {
    id: "p", user_id: "u", content: "", image_url: null, image_urls: [],
    privacy: "public", created_at: "2026-08-01T00:00:00.000Z",
    author_name: "Avijit Sheel", author_avatar: null,
    like_count: 0, comment_count: 0, share_count: 0, is_liked: false,
    user_reaction: null, top_reactions: [], reaction_counts: {},
    ...over,
  };
}

/**
 * The one `<img …/>` element inside ShowcaseTile that carries `marker`.
 *
 * Element-scoped rather than a character window: a window around a keyword
 * breaks the moment a comment is added between two attributes, and a test that
 * fails for a reason unrelated to the product is a test people learn to ignore.
 * Throws when there is not exactly one — two matches means the assertion below
 * it would have been checking an arbitrary one of them.
 */
function showcaseImage(marker: string): string {
  const showcase = GRID.slice(GRID.indexOf("const ShowcaseTile"));
  const elements = showcase.split("<img").slice(1).map((chunk) => chunk.slice(0, chunk.indexOf("/>")));
  const hits = elements.filter((e) => e.includes(marker));
  if (hits.length !== 1) {
    throw new Error(`expected exactly one showcase <img> with "${marker}", found ${hits.length}`);
  }
  return hits[0];
}

describe("the nine-then-one rhythm", () => {
  it("is nine squares — three full rows — then the band", () => {
    // The owner sent a picture rather than a sentence, and the picture shows
    // THREE rows of three before the band, not one. This is that picture.
    expect(SQUARES_PER_BLOCK).toBe(9);
    expect(BLOCK).toBe(10);
    const pattern = Array.from({ length: 21 }, (_, i) => (isShowcase(i) ? "F" : "s"));
    expect(pattern.join("")).toBe("sssssssssFsssssssssFs");
  });

  it("never opens with a showcase — the squares come FIRST", () => {
    for (let i = 0; i < 9; i++) expect(isShowcase(i)).toBe(false);
    expect(isShowcase(9)).toBe(true);
  });

  it("the band always lands at the END of a row, never mid-row", () => {
    // A band that started in column 2 would leave a hole in the grid. The
    // squares before each band must be a whole number of 3-wide rows.
    expect(SQUARES_PER_BLOCK % 3).toBe(0);
  });

  it("leaves exactly nine small tiles between showcases", () => {
    const shows = Array.from({ length: 200 }, (_, i) => i).filter(isShowcase);
    for (let i = 1; i < shows.length; i++) {
      expect(shows[i] - shows[i - 1]).toBe(BLOCK);
    }
    expect(shows.length).toBe(20); // 200 posts / one showcase per 10
  });

  it("a short wall still renders — fewer than ten posts means no showcase", () => {
    expect(Array.from({ length: 9 }, (_, i) => i).some(isShowcase)).toBe(false);
  });
});

describe("the showcase shows the whole photograph", () => {
  it("shows the sharp photo with object-contain, and crops nothing but the blur", () => {
    // The small tiles are deliberately object-cover — that IS the scanning
    // view. The showcase must not be: cropping a photograph to fill a fixed
    // band is precisely what the showcase exists to avoid.
    //
    // Asserted per <img> ELEMENT rather than over a character window: a window
    // breaks the moment a comment is added between two attributes, which is a
    // test failing for a reason that has nothing to do with the product.
    const sharp = showcaseImage("object-contain");
    const backdrop = showcaseImage("object-cover");

    // Exactly one of each, and they are different elements.
    expect(sharp).not.toBeNull();
    expect(backdrop).not.toBeNull();

    // The one that crops is the decorative blurred layer, and nothing else.
    expect(backdrop).toMatch(/aria-hidden/);
    expect(backdrop).toMatch(/blur-2xl/);

    // The one carrying the actual photograph is never hidden and never cropped.
    expect(sharp).not.toMatch(/aria-hidden/);
    expect(sharp).not.toMatch(/object-cover/);
  });

  it("spans all three columns", () => {
    expect(GRID).toMatch(/col-span-3/);
  });

  it("is ALWAYS 3:2 — horizontal, and the same height every time", () => {
    // Owner ruling: "1-2-3 then 3:2 style is final" — 3:2, fixed.
    expect(SHOWCASE_ASPECT).toBeCloseTo(1.5, 10);
    // Horizontal is the part that was explicitly rejected when it failed:
    // "not approved as long vertical block found".
    expect(SHOWCASE_ASPECT).toBeGreaterThan(1);
    // And the band must actually USE it.
    expect(GRID).toMatch(/aspectRatio:\s*String\(SHOWCASE_ASPECT\)/);
  });

  it("does not measure the photo — a fixed band has nothing to look up", () => {
    // An earlier version measured each photo and corrected the row height on
    // load, because 129 of 210 production posts carry no dimensions in their
    // filename. The fixed band deletes that problem; reintroducing a
    // measurement would reintroduce a wall that jumps while it loads.
    const showcase = GRID.slice(GRID.indexOf("const ShowcaseTile"));
    expect(showcase).not.toMatch(/naturalWidth/);
    expect(showcase).not.toMatch(/measuredAspect/);
    expect(GRID).not.toMatch(/frameAspectForUrls|parseImageDims/);
  });

  it("blurs the THUMBNAIL behind the bars, never the full-size original", () => {
    // PostMedia measured it: blurring the full-size copy spent ~200KB per post
    // to render about 1KB of unrecognisable mush.
    const backdrop = showcaseImage("blur-2xl");
    expect(backdrop).toMatch(/src=\{thumb\}/);
    expect(backdrop).not.toMatch(/src=\{full\}/);
    expect(backdrop).not.toMatch(/src=\{src\}/);
  });
});

describe("MY WALL ONLY — this layout must never reach the feed", () => {
  // Owner, 2026-08-15: *"please notte this style only for my wall section like
  // instagram not for feed"*.
  //
  // It is already true, and this is here so it STAYS true. Feed.tsx renders
  // <WallPosts composerOnly />, and `composerOnly` gates the entire posts
  // block — so the feed mounts the composer and nothing else. Deleting that
  // flag, or moving the grid outside the guard, would put a wall layout on the
  // home feed, and nothing else in the suite would notice.
  const WALL = readFileSync(join(process.cwd(), "src/components/WallPosts.tsx"), "utf8");
  const FEED = readFileSync(join(process.cwd(), "src/pages/Feed.tsx"), "utf8");

  it("the feed mounts the wall in composer-only mode", () => {
    expect(FEED).toMatch(/<WallPosts[^>]*composerOnly/);
  });

  it("the grid and its switch live INSIDE the !composerOnly guard", () => {
    const guarded = WALL.slice(WALL.indexOf("{!composerOnly && ("));
    expect(guarded).toContain("<ProfilePostGrid");
    expect(guarded).toContain("<WallViewToggle");
    // …and nowhere before it.
    const before = WALL.slice(0, WALL.indexOf("{!composerOnly && ("));
    expect(before).not.toContain("<ProfilePostGrid");
    expect(before).not.toContain("<WallViewToggle");
  });

  it("no page other than the profile renders the grid directly", () => {
    // A second importer is not automatically wrong, but it must be a decision
    // somebody makes on purpose rather than a copy-paste.
    expect(WALL.match(/from "@\/components\/profile\/ProfilePostGrid"/g) ?? []).toHaveLength(1);
    expect(FEED).not.toContain("ProfilePostGrid");
  });
});

describe("the tile image source", () => {
  it("prefers the stored thumbnail — the point of a small tile is a small file", () => {
    expect(tileSrc(post({ image_urls: ["big.jpg"], thumbnail_urls: ["small.jpg"] }))).toBe("small.jpg");
  });

  it("falls back to the original for the 9 posts that predate the thumbnail writer", () => {
    expect(tileSrc(post({ image_urls: ["big.jpg"], thumbnail_urls: null }))).toBe("big.jpg");
  });

  it("treats an empty-string thumbnail as absent, not as a valid address", () => {
    expect(tileSrc(post({ image_urls: ["big.jpg"], thumbnail_urls: [""] }))).toBe("big.jpg");
  });

  it("returns null rather than an undefined src when there is no photograph", () => {
    expect(tileSrc(post({ image_urls: [] }))).toBeNull();
  });
});
