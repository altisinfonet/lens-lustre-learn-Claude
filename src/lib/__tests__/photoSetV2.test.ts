/**
 * Photo plan U1b — the new stored set (2048 / 1080 / 600 / 320) and its names.
 *
 * The set is announced by a filename marker, exactly like `-l3` (see the long
 * comment in imageLadder.ts): the feed renders from `posts.image_urls`, so
 * WHICH copies exist must be knowable from the URL alone.
 *
 *   `-l4`   (posts)        the URL itself IS the credited 2048 copy;
 *                          siblings `-r1080`, `-r320` (no upscaling) + `-thumb` (600)
 *   `-l4f`  (competition)  the URL is the kept FULL-SIZE file; the credited 2048
 *                          copy is the `-r2048` sibling (always stored), plus the
 *                          same `-r1080`, `-r320`, `-thumb`
 *
 * Old `-l3` and unmarked URLs keep resolving exactly as today.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PHOTO_SET_MARKER,
  PHOTO_SET_FULL_MARKER,
  PHOTO_SET_QUALITY,
  hasLadderMarker,
  photoSetMarker,
  photoSetPlan,
  photoSetSiblingKeys,
  photoSetUrl,
} from "@/lib/imageLadder";
import { parseImageDims } from "@/lib/imageFrame";

const CDN = "https://cdn.50mmretina.com/post-images/u1/posts";

describe("the marker", () => {
  it("is -l4 for posts and -l4f for competition full-size keeps", () => {
    expect(PHOTO_SET_MARKER).toBe("-l4");
    expect(PHOTO_SET_FULL_MARKER).toBe("-l4f");
    expect(photoSetMarker(`${CDN}/a-w2048h1365-l4.webp`)).toBe("-l4");
    expect(photoSetMarker(`${CDN}/a-w2048h1365-l4-thumb.webp?v=1`)).toBe("-l4");
    expect(photoSetMarker(`${CDN}/a-w6000h4000-l4f.webp`)).toBe("-l4f");
    expect(photoSetMarker(`${CDN}/a-w2560h1707-l3.webp`)).toBeNull();
    expect(photoSetMarker(`${CDN}/a-w2560h1707.webp`)).toBeNull();
  });

  it("is never mistaken for the -l3 ladder (the renderer would ask for a 1440 that does not exist)", () => {
    expect(hasLadderMarker(`${CDN}/a-w2048h1365-l4.webp`)).toBe(false);
    expect(hasLadderMarker(`${CDN}/a-w6000h4000-l4f.webp`)).toBe(false);
  });

  it("does not break the frame parser: dims still read from -l4 / -l4f / -thumb names", () => {
    expect(parseImageDims(`${CDN}/a-w2048h1365-l4.webp`)).toMatchObject({ width: 2048, height: 1365 });
    expect(parseImageDims(`${CDN}/a-w2048h1365-l4-thumb.webp`)).toMatchObject({ width: 2048, height: 1365 });
    expect(parseImageDims(`${CDN}/a-w6000h4000-l4f.webp`)).toMatchObject({ width: 6000, height: 4000 });
    // old names unchanged
    expect(parseImageDims(`${CDN}/a-w2560h1707-l3-thumb.webp`)).toMatchObject({ width: 2560, height: 1707 });
    expect(parseImageDims(`${CDN}/a-w2560h1707.webp`)).toMatchObject({ width: 2560, height: 1707 });
  });
});

describe("photoSetPlan — what is stored, at which quality, and where the credit goes", () => {
  it("post, large photo: credited 2048 master + 1080 + 600 thumb + 320; qualities are U0's", () => {
    const plan = photoSetPlan(4000, 3000, false);
    expect(plan.map((c) => c.slot)).toEqual(["master", "r1080", "thumb", "r320"]);
    expect(plan.map((c) => c.maxDimension)).toEqual([2048, 1080, 600, 320]);
    expect(plan.map((c) => c.quality)).toEqual([0.85, 0.82, 0.78, 0.75]);
    expect(PHOTO_SET_QUALITY).toEqual({ 2048: 0.85, 1080: 0.82, 600: 0.78, 320: 0.75 });
  });

  it("the credit is burned into the 2048 copy ONLY", () => {
    for (const keepFull of [false, true]) {
      const plan = photoSetPlan(4000, 3000, keepFull);
      const credited = plan.filter((c) => c.credit);
      expect(credited.length).toBe(1);
      expect(credited[0].maxDimension).toBe(2048);
      expect(plan.filter((c) => c.maxDimension !== 2048).every((c) => !c.credit)).toBe(true);
    }
  });

  it("competition keeps the full file, so the credited 2048 is a separate -r2048 copy (always)", () => {
    expect(photoSetPlan(6000, 4000, true).map((c) => c.slot)).toEqual(["r2048", "r1080", "thumb", "r320"]);
    // even a small entry gets its credited copy: the full size is deleted after the window
    expect(photoSetPlan(900, 600, true).map((c) => c.slot)).toEqual(["r2048", "thumb", "r320"]);
  });

  it("no upscaling: a 1000px post has no 1080 copy, a 300px post no 320 copy", () => {
    expect(photoSetPlan(1000, 700, false).map((c) => c.slot)).toEqual(["master", "thumb", "r320"]);
    expect(photoSetPlan(300, 200, false).map((c) => c.slot)).toEqual(["master", "thumb"]);
    // the LONG edge decides (portrait)
    expect(photoSetPlan(900, 1600, false).map((c) => c.slot)).toEqual(["master", "r1080", "thumb", "r320"]);
  });
});

describe("photoSetUrl — the one helper U2 (display) and U5 (backfill) reuse", () => {
  const post = `${CDN}/1793-abc-w2048h1365-l4.webp`;
  const comp = "https://cdn.50mmretina.com/competition-photos/u1/competitions/1793-abc-w6000h4000-l4f.webp";

  it("-l4 post: 2048 is the URL itself, the rest are siblings", () => {
    expect(photoSetUrl(post, 2048)).toBe(post);
    expect(photoSetUrl(post, 1080)).toBe(`${CDN}/1793-abc-w2048h1365-l4-r1080.webp`);
    expect(photoSetUrl(post, 600)).toBe(`${CDN}/1793-abc-w2048h1365-l4-thumb.webp`);
    expect(photoSetUrl(post, 320)).toBe(`${CDN}/1793-abc-w2048h1365-l4-r320.webp`);
  });

  it("-l4f competition: 2048 is the -r2048 sibling, never the full-size file", () => {
    const base = comp.replace(/\.webp$/, "");
    expect(photoSetUrl(comp, 2048)).toBe(`${base}-r2048.webp`);
    expect(photoSetUrl(comp, 1080)).toBe(`${base}-r1080.webp`);
    expect(photoSetUrl(comp, 600)).toBe(`${base}-thumb.webp`);
    expect(photoSetUrl(comp, 320)).toBe(`${base}-r320.webp`);
  });

  it("no upscaling seen from the URL side: a missing size resolves to the next larger stored copy", () => {
    const small = `${CDN}/s-w1000h700-l4.webp`;
    expect(photoSetUrl(small, 1080)).toBe(small);
    expect(photoSetUrl(small, 320)).toBe(`${CDN}/s-w1000h700-l4-r320.webp`);
    const tiny = `${CDN}/t-w300h200-l4.webp`;
    expect(photoSetUrl(tiny, 320)).toBe(tiny);
    const smallComp = `${CDN}/c-w900h600-l4f.webp`;
    expect(photoSetUrl(smallComp, 1080)).toBe(`${CDN}/c-w900h600-l4f-r2048.webp`);
  });

  it("accepts a sibling or thumb URL of the set and resolves from its master; keeps the query", () => {
    expect(photoSetUrl(`${CDN}/1793-abc-w2048h1365-l4-thumb.webp`, 2048)).toBe(post);
    expect(photoSetUrl(`${CDN}/1793-abc-w2048h1365-l4-r320.webp`, 1080)).toBe(`${CDN}/1793-abc-w2048h1365-l4-r1080.webp`);
    expect(photoSetUrl(`${post}?v=2`, 320)).toBe(`${CDN}/1793-abc-w2048h1365-l4-r320.webp?v=2`);
  });

  it("OLD URLs keep working: -l3 resolves to its own stored files, unmarked to itself", () => {
    const l3 = `${CDN}/o-w2560h1707-l3.webp`;
    expect(photoSetUrl(l3, 2048)).toBe(l3);
    expect(photoSetUrl(l3, 1080)).toBe(`${CDN}/o-w2560h1707-l3-r1080.webp`);
    expect(photoSetUrl(l3, 600)).toBe(`${CDN}/o-w2560h1707-l3-thumb.webp`);
    expect(photoSetUrl(l3, 320)).toBe(`${CDN}/o-w2560h1707-l3-thumb.webp`);
    const small3 = `${CDN}/o-w1000h700-l3.webp`; // a -l3 name is only published with a rung, but never guess
    expect(photoSetUrl(small3, 1080)).toBe(small3);
    const legacy = `${CDN}/o-w2560h1707.webp`;
    for (const s of [2048, 1080, 600, 320] as const) expect(photoSetUrl(legacy, s)).toBe(legacy);
    const noDims = `${CDN}/1700000000-x.webp`;
    for (const s of [2048, 1080, 600, 320] as const) expect(photoSetUrl(noDims, s)).toBe(noDims);
  });
});

describe("photoSetSiblingKeys — the derived (column-less) copies of a stored key", () => {
  it("lists the rung siblings a -l4 / -l4f key promises, none for old keys", () => {
    expect(photoSetSiblingKeys("post-images/u/posts/a-w2048h1365-l4.webp")).toEqual([
      "post-images/u/posts/a-w2048h1365-l4-r1080.webp",
      "post-images/u/posts/a-w2048h1365-l4-r320.webp",
    ]);
    expect(photoSetSiblingKeys("competition-photos/u/competitions/a-w900h600-l4f.webp")).toEqual([
      "competition-photos/u/competitions/a-w900h600-l4f-r2048.webp",
      "competition-photos/u/competitions/a-w900h600-l4f-r320.webp",
    ]);
    expect(photoSetSiblingKeys("post-images/u/posts/a-w2560h1707-l3.webp")).toEqual([]);
    expect(photoSetSiblingKeys("post-images/u/posts/a.webp")).toEqual([]);
  });
});

describe("the orphan reference set derives the new siblings (or they would read as orphans)", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const fn = strip(readFileSync(join(process.cwd(), "supabase/functions/detect-orphan-files/index.ts"), "utf8"));

  it("derives -r1080, -r320, -r2048 and -thumb from a -l4 / -l4f key into referencedPaths", () => {
    expect(/-l4\(f\?\)/.test(fn), "the -l4 / -l4f key match is missing").toBe(true);
    for (const s of ["-r1080", "-r320", "-r2048", "-thumb"]) {
      expect(new RegExp(`referencedPaths\\.add\\(\`\\$\\{m4\\[1\\]\\}-l4\\$\\{m4\\[2\\]\\}${s}\\$\\{m4\\[3\\]\\}\`\\)`).test(fn), s).toBe(true);
    }
  });

  it("still derives the -l3 rungs exactly as before", () => {
    expect(/referencedPaths\.add\(`\$\{m\[1\]\}-l3-r1080\$\{m\[2\]\}`\)/.test(fn)).toBe(true);
    expect(/referencedPaths\.add\(`\$\{m\[1\]\}-l3-r1440\$\{m\[2\]\}`\)/.test(fn)).toBe(true);
  });
});
