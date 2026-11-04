/**
 * Photo plan — the stored photo sets (2048 / 1080 / 600 / 320) and their names.
 *
 * A set is announced by a filename marker, exactly like `-l3` (see the long
 * comment in imageLadder.ts): the feed renders from `posts.image_urls`, so
 * WHICH copies exist must be knowable from the URL alone.
 *
 *   v3 `-l5`   (posts, written now)   the URL is the CLEAN 1080; credited 2048 `-r2048c`
 *                                     (always), `-thumb`, `-r320`; private clean `-r2048`
 *   v3 `-l5f`  (competition)          the URL is the kept full size; `-r2048c`, `-r1080`
 *                                     (always), `-thumb`, `-r320`; private clean `-r2048`
 *   v2 `-l4` / `-l4f` (read only)     the 2 → 3 Nov names; never offered credited below 2048
 *
 * Old `-l3` and unmarked URLs keep resolving exactly as today.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PHOTO_SET_V3_MARKER,
  PHOTO_SET_V3_FULL_MARKER,
  PHOTO_SET_QUALITY,
  hasLadderMarker,
  isCreditedPhotoUrl,
  photoSetCleanKey,
  photoSetCleanUrl,
  photoSetMarker,
  photoSetPlan,
  photoSetSiblingKeys,
  photoSetUrl,
  photoSetWidth,
} from "@/lib/imageLadder";
import { parseImageDims } from "@/lib/imageFrame";

const CDN = "https://cdn.50mmretina.com/post-images/u1/posts";

describe("the markers", () => {
  it("v3 is -l5 for posts and -l5f for competition; v2 -l4 / -l4f still read", () => {
    expect(PHOTO_SET_V3_MARKER).toBe("-l5");
    expect(PHOTO_SET_V3_FULL_MARKER).toBe("-l5f");
    expect(photoSetMarker(`${CDN}/a-w1080h720-l5.webp`)).toBe("-l5");
    expect(photoSetMarker(`${CDN}/a-w1080h720-l5-r2048c.webp?v=1`)).toBe("-l5");
    expect(photoSetMarker(`${CDN}/a-w6000h4000-l5f.webp`)).toBe("-l5f");
    expect(photoSetMarker(`${CDN}/a-w2048h1365-l4.webp`)).toBe("-l4");
    expect(photoSetMarker(`${CDN}/a-w6000h4000-l4f.webp`)).toBe("-l4f");
    expect(photoSetMarker(`${CDN}/a-w2560h1707-l3.webp`)).toBeNull();
    expect(photoSetMarker(`${CDN}/a-w2560h1707.webp`)).toBeNull();
  });

  it("is never mistaken for the -l3 ladder (the renderer would ask for a 1440 that does not exist)", () => {
    for (const m of ["-l4", "-l4f", "-l5", "-l5f"]) expect(hasLadderMarker(`${CDN}/a-w2048h1365${m}.webp`)).toBe(false);
  });

  it("does not break the frame parser: dims still read from every set name", () => {
    expect(parseImageDims(`${CDN}/a-w1080h720-l5.webp`)).toMatchObject({ width: 1080, height: 720 });
    expect(parseImageDims(`${CDN}/a-w1080h720-l5-thumb.webp`)).toMatchObject({ width: 1080, height: 720 });
    expect(parseImageDims(`${CDN}/a-w6000h4000-l5f.webp`)).toMatchObject({ width: 6000, height: 4000 });
    expect(parseImageDims(`${CDN}/a-w2048h1365-l4.webp`)).toMatchObject({ width: 2048, height: 1365 });
    expect(parseImageDims(`${CDN}/a-w2560h1707-l3-thumb.webp`)).toMatchObject({ width: 2560, height: 1707 });
    expect(parseImageDims(`${CDN}/a-w2560h1707.webp`)).toMatchObject({ width: 2560, height: 1707 });
  });
});

describe("photoSetPlan (v3) — what is stored, at which quality, and where the credit goes", () => {
  it("post: private clean 2048 + credited 2048 + clean 1080 (the URL) + 600 + 320; qualities are U0's", () => {
    const plan = photoSetPlan(4000, 3000, false);
    expect(plan.map((c) => c.slot)).toEqual(["clean2048", "r2048c", "master", "thumb", "r320"]);
    expect(plan.map((c) => c.maxDimension)).toEqual([2048, 2048, 1080, 600, 320]);
    expect(plan.map((c) => c.quality)).toEqual([0.85, 0.85, 0.82, 0.78, 0.75]);
    expect(plan.filter((c) => c.private).map((c) => c.slot)).toEqual(["clean2048"]);
    expect(PHOTO_SET_QUALITY).toEqual({ 2048: 0.85, 1080: 0.82, 600: 0.78, 320: 0.75 });
  });

  it("the credit is burned into the credited 2048 ONLY — never the URL, never the private copy", () => {
    for (const keepFull of [false, true]) {
      const plan = photoSetPlan(4000, 3000, keepFull);
      expect(plan.filter((c) => c.credit).map((c) => c.slot)).toEqual(["r2048c"]);
    }
  });

  it("every size of photo gets a credited copy and a clean 1080-or-smaller copy (audit B2)", () => {
    expect(photoSetPlan(1000, 700, false).map((c) => c.slot)).toEqual(["clean2048", "r2048c", "master", "thumb", "r320"]);
    expect(photoSetPlan(300, 200, false).map((c) => c.slot)).toEqual(["clean2048", "r2048c", "master", "thumb"]);
    expect(photoSetPlan(900, 600, true).map((c) => c.slot)).toEqual(["clean2048", "r2048c", "r1080", "thumb", "r320"]);
  });
});

describe("photoSetUrl — the feed is NEVER handed a credited file", () => {
  const post = `${CDN}/1793-abc-w1080h720-l5.webp`;
  const comp = "https://cdn.50mmretina.com/competition-photos/u1/competitions/1793-abc-w6000h4000-l5f.webp";

  it("-l5 post: 1080 is the URL itself (clean), 2048 is the credited sibling", () => {
    expect(photoSetUrl(post, 2048)).toBe(`${CDN}/1793-abc-w1080h720-l5-r2048c.webp`);
    expect(photoSetUrl(post, 1080)).toBe(post);
    expect(photoSetUrl(post, 600)).toBe(`${CDN}/1793-abc-w1080h720-l5-thumb.webp`);
    expect(photoSetUrl(post, 320)).toBe(`${CDN}/1793-abc-w1080h720-l5-r320.webp`);
    expect(photoSetUrl(`${CDN}/1793-abc-w1080h720-l5-r320.webp?v=2`, 1080)).toBe(`${post}?v=2`);
  });

  it("-l5f competition: 2048 credited sibling, 1080 the clean -r1080 (always stored), never the full size", () => {
    const base = comp.replace(/\.webp$/, "");
    expect(photoSetUrl(comp, 2048)).toBe(`${base}-r2048c.webp`);
    expect(photoSetUrl(comp, 1080)).toBe(`${base}-r1080.webp`);
    expect(photoSetUrl(comp, 600)).toBe(`${base}-thumb.webp`);
    expect(photoSetUrl(comp, 320)).toBe(`${base}-r320.webp`);
    const tiny = "https://cdn.x/competition-photos/u/competitions/t-w300h200-l5f.webp";
    expect(photoSetUrl(tiny, 320)).toBe("https://cdn.x/competition-photos/u/competitions/t-w300h200-l5f-r1080.webp");
  });

  it("v2 -l4 (read only): every size is a CLEAN copy, 2048 included (credit fix U1); a small photo's 1080 / 320 fall to the clean thumb", () => {
    const l4 = `${CDN}/1793-abc-w2048h1365-l4.webp`;
    expect(photoSetUrl(l4, 2048)).toBe(`${CDN}/1793-abc-w2048h1365-l4-r1080.webp`);
    expect(photoSetUrl(l4, 1080)).toBe(`${CDN}/1793-abc-w2048h1365-l4-r1080.webp`);
    expect(photoSetUrl(l4, 600)).toBe(`${CDN}/1793-abc-w2048h1365-l4-thumb.webp`);
    expect(photoSetUrl(l4, 320)).toBe(`${CDN}/1793-abc-w2048h1365-l4-r320.webp`);
    const small = `${CDN}/s-w1000h700-l4.webp`;
    expect(photoSetUrl(small, 1080)).toBe(`${CDN}/s-w1000h700-l4-thumb.webp`);
    const tiny = `${CDN}/t-w300h200-l4.webp`;
    expect(photoSetUrl(tiny, 320)).toBe(`${CDN}/t-w300h200-l4-thumb.webp`);
    const smallComp = `${CDN}/c-w900h600-l4f.webp`;
    expect(photoSetUrl(smallComp, 2048)).toBe(`${CDN}/c-w900h600-l4f-thumb.webp`);
    expect(photoSetUrl(smallComp, 1080)).toBe(`${CDN}/c-w900h600-l4f-thumb.webp`);
  });

  it("for every set and size below 2048, the answer is never a credited file", () => {
    const urls = [
      post, comp, `${CDN}/s-w800h533-l5.webp`, `${CDN}/t-w300h200-l5.webp`,
      `${CDN}/a-w2048h1365-l4.webp`, `${CDN}/s-w1000h700-l4.webp`, `${CDN}/t-w300h200-l4.webp`,
      `${CDN}/c-w6000h4000-l4f.webp`, `${CDN}/c-w900h600-l4f.webp`,
    ];
    for (const u of urls) {
      for (const s of [1080, 600, 320] as const) expect(isCreditedPhotoUrl(photoSetUrl(u, s)), `${u} @${s}`).toBe(false);
      expect(isCreditedPhotoUrl(photoSetCleanUrl(u)), `${u} clean`).toBe(false);
      // credit fix U1: a v3 set's 2048 is its credited copy; a v2 set's 2048 is clean (its old credit is retired)
      expect(isCreditedPhotoUrl(photoSetUrl(u, 2048)), `${u} @2048`).toBe(/-l5f?\.webp$/.test(u));
    }
  });

  it("widths for srcset are the real widths of the named files", () => {
    expect(photoSetWidth(post, 1080)).toBe(1080);
    expect(photoSetWidth(post, 600)).toBe(600);
    expect(photoSetWidth(`${CDN}/p-w720h1080-l5.webp`, 600)).toBe(400);
    expect(photoSetWidth(`${CDN}/s-w800h533-l5.webp`, 1080)).toBe(800);
    expect(photoSetWidth(`${CDN}/s-w1000h700-l4.webp`, 1080)).toBe(600);
    expect(photoSetWidth(`${CDN}/x.webp`, 1080)).toBeNull();
  });

  it("OLD URLs keep working: -l3 resolves to its own stored files, unmarked to itself", () => {
    const l3 = `${CDN}/o-w2560h1707-l3.webp`;
    expect(photoSetUrl(l3, 2048)).toBe(l3);
    expect(photoSetUrl(l3, 1080)).toBe(`${CDN}/o-w2560h1707-l3-r1080.webp`);
    expect(photoSetUrl(l3, 600)).toBe(`${CDN}/o-w2560h1707-l3-thumb.webp`);
    expect(photoSetUrl(l3, 320)).toBe(`${CDN}/o-w2560h1707-l3-thumb.webp`);
    const small3 = `${CDN}/o-w1000h700-l3.webp`;
    expect(photoSetUrl(small3, 1080)).toBe(small3);
    const legacy = `${CDN}/o-w2560h1707.webp`;
    for (const s of [2048, 1080, 600, 320] as const) expect(photoSetUrl(legacy, s)).toBe(legacy);
    const noDims = `${CDN}/1700000000-x.webp`;
    for (const s of [2048, 1080, 600, 320] as const) expect(photoSetUrl(noDims, s)).toBe(noDims);
  });
});

describe("photoSetSiblingKeys / photoSetCleanKey — the derived (column-less) copies of a stored key", () => {
  it("lists the public siblings each kind of key promises, none for old keys", () => {
    expect(photoSetSiblingKeys("post-images/u/posts/a-w1080h720-l5.webp")).toEqual([
      "post-images/u/posts/a-w1080h720-l5-r2048c.webp",
      "post-images/u/posts/a-w1080h720-l5-r320.webp",
    ]);
    expect(photoSetSiblingKeys("competition-photos/u/competitions/a-w900h600-l5f.webp")).toEqual([
      "competition-photos/u/competitions/a-w900h600-l5f-r2048c.webp",
      "competition-photos/u/competitions/a-w900h600-l5f-r1080.webp",
      "competition-photos/u/competitions/a-w900h600-l5f-r320.webp",
    ]);
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

  it("names the private clean 2048 in photo-clean/ for v3 keys only", () => {
    expect(photoSetCleanKey("post-images/u/posts/a-w1080h720-l5.webp")).toBe("photo-clean/post-images/u/posts/a-w1080h720-l5-r2048.webp");
    expect(photoSetCleanKey("competition-photos/u/competitions/a-w900h600-l5f.webp")).toBe("photo-clean/competition-photos/u/competitions/a-w900h600-l5f-r2048.webp");
    expect(photoSetCleanKey("post-images/u/posts/a-w2048h1365-l4.webp")).toBeNull();
  });
});

describe("the orphan reference set derives the set siblings (or they would read as orphans)", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const fn = strip(readFileSync(join(process.cwd(), "supabase/functions/detect-orphan-files/index.ts"), "utf8"));
  const add = (v: string, s: string) =>
    new RegExp(`referencedPaths\\.add\\(\`\\$\\{m${v}\\[1\\]\\}-l${v}\\$\\{m${v}\\[2\\]\\}${s}\\$\\{m${v}\\[3\\]\\}\`\\)`).test(fn);

  it("derives -r1080, -r320, -r2048 and -thumb from a -l4 / -l4f key", () => {
    expect(/-l4\(f\?\)/.test(fn), "the -l4 / -l4f key match is missing").toBe(true);
    for (const s of ["-r1080", "-r320", "-r2048", "-thumb"]) expect(add("4", s), s).toBe(true);
  });

  it("derives -r2048c, -r1080, -r320 and -thumb from a -l5 / -l5f key", () => {
    expect(/-l5\(f\?\)/.test(fn), "the -l5 / -l5f key match is missing").toBe(true);
    for (const s of ["-r2048c", "-r1080", "-r320", "-thumb"]) expect(add("5", s), s).toBe(true);
  });

  it("still derives the -l3 rungs exactly as before", () => {
    expect(/referencedPaths\.add\(`\$\{m\[1\]\}-l3-r1080\$\{m\[2\]\}`\)/.test(fn)).toBe(true);
    expect(/referencedPaths\.add\(`\$\{m\[1\]\}-l3-r1440\$\{m\[2\]\}`\)/.test(fn)).toBe(true);
  });
});
