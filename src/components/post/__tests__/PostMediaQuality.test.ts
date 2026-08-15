import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * A FEED PHOTO MUST NOT BE UPSCALED FROM ITS OWN THUMBNAIL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER REPORT, 2026-08-09: *"Photos are uploading with extremely low reducing
 * size so that images value quality getting very poor."*
 *
 * MEASURED IN THE LIVE PAGE, 2026-08-10, before the fix:
 *
 *   slot          588 CSS px × DPR 1.125 = 662 device px needed
 *   delivered     600 × 400  (480 × 600 for portraits)
 *   srcset        none
 *
 * Every feed photo was the 600px thumbnail, stretched. On a phone at DPR 3 the
 * same slot needs ~1,760 device pixels and still received 600 — three times too
 * few.
 *
 * THE UPLOAD WAS NEVER THE PROBLEM. The stored originals measure 1920×1280,
 * 1080×1350 and 2560×1165; a sample of 50 thumbnails and 10 originals all
 * loaded. Nothing is destroyed on the way in. The wrong copy was displayed.
 *
 * THE CAUSE, and it was my change of 2026-08-07: `isTransformable()` matches
 * only `/storage/v1/object/public/…`, but every stored address is on the custom
 * domain `cdn.50mmretina.com`. So `transformable` was always false,
 * `buildSrcSet()` always returned undefined, and the sharp layer fell through
 * to `thumb ?? src` — the thumbnail, on every device.
 *
 * These read the source: the choice is made by the browser from `srcset` and
 * DPR, and jsdom has neither a layout engine nor a device pixel ratio to
 * exercise it. What must hold is the SHAPE — that the original is offered, that
 * the thumbnail is offered beside it with an honest width, and that the
 * thumbnail is never the sharp layer on its own again.
 */
const SRC = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/post/PostMedia.tsx"),
  "utf8",
);

/** Comments describe the defect; they must never satisfy the rules. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the sharp layer shows the original, not the thumbnail", () => {
  it("no longer falls back to `thumb ?? src` for the sharp image", () => {
    // THE BUG, in one expression. This is what shipped on 2026-08-07.
    expect(CODE).not.toMatch(/sharpSrc\s*=\s*transformable[\s\S]{0,80}?\(\s*thumb\s*\?\?\s*src\s*\)/);
  });

  it("uses the original when the URL cannot be transformed", () => {
    expect(CODE).toMatch(/const sharpSrc = transformable \? buildRenderUrl\(src, 800\) : src;/);
  });

  it("still paints the thumbnail as the instant backdrop", () => {
    // Losing this would trade one complaint (soft) for another (slow).
    // The expression moved on 2026-08-13; what must survive is that a stored
    // thumbnail is still what paints the backdrop.
    expect(CODE).toMatch(/const lqip = backdropFailed[\s\S]{0,160}?thumb \?\? null/);
  });

  it("⚠ the backdrop can NEVER fall through to the full-resolution original", () => {
    /**
     * The single most expensive line this file has ever contained was the tail
     * of the old LQIP expression: `: src`. With no stored thumbnail it fetched
     * the 2560px original, eagerly, to blur it into mush — ~14.7 MB of decoded
     * bitmap per card, on a feed that mounts every card ever scrolled past.
     *
     * Asserted on the SOURCE and not on a render, because the danger is someone
     * reinstating it to fix "blank bars" without knowing what it costs. If that
     * is ever the right trade again, it needs a conversation, not a one-line
     * edit that passes the suite.
     */
    expect(CODE).not.toMatch(/lqip[\s\S]{0,120}?:\s*src\b/);
    expect(CODE).toMatch(/\{lqip && \(/);      // rendered conditionally
    expect(CODE).toMatch(/fetchPriority="low"/); // and never competes with the photo
  });
});

describe("the browser is given both copies, with honest widths", () => {
  it("builds a srcset on the CDN path, where there was none", () => {
    expect(CODE).toMatch(/srcSet = transformable \? buildSrcSet\(src\) : buildThumbFirstSrcSet\(thumb, src\)/);
  });

  it("reads the real pixel size out of the filename rather than assuming one", () => {
    expect(CODE).toContain("function intrinsicFromName");
    expect(CODE).toContain("-w(\\d+)h(\\d+)");
  });

  it("declares a portrait thumbnail's real width, not a flat 600", () => {
    // The thumbnail is capped on its LONG edge, so a portrait is ~480 wide.
    // Claiming 600w would make the browser skip the original when it should
    // not — the exact upscaling this file exists to stop.
    expect(CODE).toMatch(/dim\.w >= dim\.h \? THUMB_LONG_EDGE : .*Math\.round\(\(THUMB_LONG_EDGE \* dim\.w\) \/ dim\.h\)/);
  });

  it("offers the thumbnail first and the original last, both with descriptors", () => {
    // B3d-1 rebuilt the pair as an ordered list so stored rungs can sit
    // between them: thumb first, original always last, descriptors intact.
    expect(CODE).toMatch(/const parts = \[`\$\{thumb\} \$\{thumbW\}w`\];/);
    expect(CODE).toMatch(/parts\.push\(`\$\{original\} \$\{dim\.w\}w`\);/);
  });

  it("skips the srcset entirely when it would be a lie", () => {
    // No filename dimensions, or an "original" no bigger than its thumbnail:
    // in both cases a descriptor would be invented. Better none at all.
    expect(CODE).toMatch(/if \(!dim \|\| dim\.w <= THUMB_LONG_EDGE\) return undefined;/);
    expect(CODE).toMatch(/if \(thumbW >= dim\.w\) return undefined;/);
  });

  it("keeps `sizes` — a srcset without it makes the browser assume 100vw", () => {
    expect(CODE).toContain("FEED_SIZES");
    expect(CODE).toMatch(/sizes=\{[^}]*FEED_SIZES[^}]*\}/);
  });
});

describe("a dead thumbnail still degrades instead of breaking", () => {
  it("drops the srcset and shows the original when the sharp image errors", () => {
    expect(CODE).toMatch(/srcSet=\{failed \? undefined : srcSet\}/);
    expect(CODE).toMatch(/src=\{failed \? src : sharpSrc\}/);
  });

  it("never guesses a thumbnail address — it only reads a stored one", () => {
    // The 2026-08-07 incident: guessed thumbnail URLs broke ~28% of photos.
    expect(CODE).toContain("function usableThumb");
    expect(CODE).not.toContain("buildCdnThumb");
  });
});
