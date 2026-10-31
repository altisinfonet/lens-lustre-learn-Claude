/**
 * THE LADDER'S CONTRACT: EVERY OFFERED ADDRESS IS A STORED FILE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * B3d-1 stores 1080/1440 rungs beside new uploads and announces them with a
 * `-l3` filename marker. Three parties must agree on that naming, character
 * for character, or members feel it immediately:
 *
 *   uploader   (imageUpload.ts)          — writes  `…-l3-r1080.webp`
 *   renderer   (PostMedia srcset)        — derives `…-l3-r1080.webp`
 *   orphan set (detect-orphan-files)     — derives `…-l3-r1080.webp`
 *
 * Renderer ≠ uploader → 404 on every feed card of the post.
 * Orphan set ≠ uploader → the cleanup companion deletes the rungs that make
 * the feed fast (the 263-file near-miss, rediscovered).
 *
 * The pure logic is unit-tested on values; the three-party agreement is
 * asserted on source, comments stripped so prose cannot satisfy it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LADDER_MARKER,
  LADDER_RUNGS,
  RUNG_QUALITY,
  hasLadderMarker,
  rungPath,
  rungPlan,
  rungWidthFor,
} from "@/lib/imageLadder";

describe("rungPlan — no upscaling, ever", () => {
  it("a 2560-wide landscape supports both rungs", () => {
    expect(rungPlan(2560, 1707)).toEqual([1080, 1440]);
  });
  it("a 1200-wide landscape supports only 1080", () => {
    expect(rungPlan(1200, 800)).toEqual([1080]);
  });
  it("PORTRAIT: the LONG edge decides — 900×1600 supports both rungs", () => {
    // Width alone would say 'no rungs'; the rung caps the long edge, exactly
    // like the encoder's maxDimension. Using width here would silently strip
    // the ladder from every portrait photo — half the corpus.
    expect(rungPlan(900, 1600)).toEqual([1080, 1440]);
  });
  it("equal size is NOT a rung — it would duplicate the original", () => {
    expect(rungPlan(1080, 720)).toEqual([]);
    expect(rungPlan(1440, 900)).toEqual([1080]);
  });
});

describe("rungWidthFor — srcset width descriptors are honest", () => {
  it("landscape: descriptor equals the rung", () => {
    expect(rungWidthFor(1080, 2560, 1707)).toBe(1080);
  });
  it("portrait: descriptor is the SCALED width, not the rung", () => {
    // A 900×1600 image capped at 1080 long-edge is 608 wide. Declaring 1080w
    // would make the browser pick a file 40% smaller than promised.
    expect(rungWidthFor(1080, 900, 1600)).toBe(608);
    expect(rungWidthFor(1440, 900, 1600)).toBe(810);
  });
});

describe("marker and path derivation", () => {
  it("recognises marked originals and their thumbs; rejects legacy names", () => {
    expect(hasLadderMarker("https://cdn.x/a/b-w1620h1080-l3.webp")).toBe(true);
    expect(hasLadderMarker("https://cdn.x/a/b-w1620h1080-l3-thumb.webp")).toBe(true);
    expect(hasLadderMarker("https://cdn.x/a/b-w1620h1080.webp")).toBe(false);
    expect(hasLadderMarker("https://cdn.x/a/b-w1620h1080-l3.webp?v=2")).toBe(true);
  });
  it("derives rung addresses, preserving query strings", () => {
    expect(rungPath("post-images/u/p/x-w1620h1080-l3.webp", 1080)).toBe(
      "post-images/u/p/x-w1620h1080-l3-r1080.webp",
    );
    expect(rungPath("https://cdn.x/a-l3.webp?v=2", 1440)).toBe("https://cdn.x/a-l3-r1440.webp?v=2");
  });
});

describe("three-party naming agreement (source-level)", () => {
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const read = (p: string) => strip(readFileSync(join(process.cwd(), p), "utf8"));

  it("the uploader publishes the marker only via LADDER_MARKER, and strips it on every fallback", () => {
    const up = read("src/lib/imageUpload.ts");
    expect(/LADDER_MARKER/.test(up), "uploader does not use the shared marker constant").toBe(true);
    // Every path that publishes WITHOUT rungs must strip the promise.
    // ⚠ Mutation L5 ESCAPED a count-based version of this assertion (there are
    // many strip sites, so deleting one kept the count high). Each fallback is
    // asserted INDIVIDUALLY instead:
    // 1. thumbnail-failure early return actually uploads the stripped name…
    expect(
      /const unmarkedFullPath = fullPath\.replace\(`\$\{LADDER_MARKER\}\.\$\{ext\}`, `\.\$\{ext\}`\);/.test(up),
      "the thumbnail-failure early return no longer strips the marker — it " +
        "publishes a rung promise with zero rungs uploaded.",
    ).toBe(true);
    expect(
      /storageUpload\(bucket, unmarkedFullPath, fullResFile/.test(up),
      "unmarkedFullPath is computed but the early return uploads something else.",
    ).toBe(true);
    // 2. rung-upload failure reverts BOTH s3 paths…
    expect(
      /markerKept = false;[\s\S]{0,200}?s3FullPath = `\$\{bucket\}\/\$\{fullPath\.replace\(`\$\{LADDER_MARKER\}/.test(up),
      "the rung-pair failure branch no longer reverts to the unmarked name.",
    ).toBe(true);
    // 3. the supabase-storage fallback reverts on rung failure.
    expect(
      /catch \{\s*fbFullPath = fullPath\.replace\(`\$\{LADDER_MARKER\}/.test(up),
      "the supabase-storage fallback publishes the marker even when rung " +
        "uploads failed.",
    ).toBe(true);
  });

  it("the renderer offers rungs only behind hasLadderMarker and derives with rungPath", () => {
    const pm = read("src/components/post/PostMedia.tsx");
    expect(/hasLadderMarker\(original\)/.test(pm)).toBe(true);
    expect(/rungPath\(original,\s*rung\)/.test(pm)).toBe(true);
    // The renderer must NOT hand-build the suffix — that is how three parties
    // drift into two spellings.
    expect(/-r\$\{rung\}/.test(pm)).toBe(false);
  });

  it("the orphan reference set derives BOTH rung addresses from marked keys", () => {
    const fn = read("supabase/functions/detect-orphan-files/index.ts");
    expect(/-l3-r1080/.test(fn), "1080 rung not derived — it will read as an orphan").toBe(true);
    expect(/-l3-r1440/.test(fn), "1440 rung not derived — it will read as an orphan").toBe(true);
    expect(
      /referencedPaths\.add\(`\$\{m\[1\]\}-l3-r1080\$\{m\[2\]\}`\)/.test(fn),
      "the derivation no longer feeds referencedPaths",
    ).toBe(true);
  });

  it("the frame parser and the renderer's parser both tolerate the marker", () => {
    const frame = read("src/lib/imageFrame.ts");
    const pm = read("src/components/post/PostMedia.tsx");
    expect(/\(\?:-l3\)\?/.test(frame), "imageFrame DIMS_RE breaks on marked names — every new post's frame falls back to 4:5").toBe(true);
    expect(/\(\?:-l3\)\?/.test(pm), "PostMedia intrinsicFromName breaks on marked names — no srcset for exactly the posts that carry rungs").toBe(true);
  });

  it("ladder constants are the single source of truth", () => {
    expect(LADDER_MARKER).toBe("-l3");
    expect([...LADDER_RUNGS]).toEqual([1080, 1440]);
  });
});

describe("B3d-4: rung encode quality is the measured display tier", () => {
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const read = (p: string) => strip(readFileSync(join(process.cwd(), p), "utf8"));

  it("RUNG_QUALITY is 0.82 — the value the 2026-08-13 byte curve was measured at", () => {
    // A VALUE test, not a grep: the ladder's 56/83 KB targets exist only at
    // this number. Change it knowingly or not at all.
    expect(RUNG_QUALITY).toBe(0.82);
  });

  it("the uploader's RUNG branch passes RUNG_QUALITY (not the 0.92 master default)", () => {
    const up = read("src/lib/imageUpload.ts");
    // Branch-scoped (the loose-anchor lessons): the assertion lives between
    // the rung loop's encode call and its push — a file-wide 'RUNG_QUALITY'
    // grep would pass on the import line alone.
    expect(
      /compressImageToFiles\(file, `\$\{baseName\}-r\$\{rung\}`, \{\s*maxDimension: rung,\s*webpQuality: RUNG_QUALITY,\s*\}\)/.test(up),
      "the rung encode no longer passes RUNG_QUALITY — rungs ship at the " +
        "0.92 master default, ~2× the bytes the ladder was sized around.",
    ).toBe(true);
  });

  it("the FULL-RES encode still does NOT take a quality override — 0.92 master stays", () => {
    const up = read("src/lib/imageUpload.ts");
    // The full-res call passes only maxDimension (posts) or nothing.
    expect(
      /await compressImageToFiles\(\s*file,\s*baseName,\s*maxDimension \? \{ maxDimension \} : undefined,\s*\)/.test(up),
      "the full-res encode call changed shape — if a quality override was " +
        "added there, the zoom/download master is being softened.",
    ).toBe(true);
  });
});
