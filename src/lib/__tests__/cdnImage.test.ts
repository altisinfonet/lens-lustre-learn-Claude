/**
 * THE IMAGE RESIZER MAY MAKE A PICTURE LIGHTER. IT MAY NEVER MAKE ONE MISSING.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE ARE STRICT
 *
 * `/cdn-cgi/image/` broke this site once. It shipped 2026-08-01 against the
 * APEX host, and for four days the owner reported "images are not coming".
 * Every check passed, because every check was made from the apex — while every
 * member was on **www**, where the request was killed at network level. Builds
 * 1035–1051 shipped with no photographs at all.
 *
 * Measured again on production 2026-08-10, from a www page, the situation had
 * INVERTED:
 *
 *     apex 50mmretina.com/cdn-cgi/…  -> FAILS   <- what August shipped
 *     www.50mmretina.com/cdn-cgi/…   -> OK
 *     cdn.50mmretina.com/cdn-cgi/…   -> OK
 *
 * The zone configuration lives in Cloudflare, outside this repository, and it
 * has already changed once without any commit. So the code may not depend on
 * WHICH origin happens to work today. Two rules, both pinned below:
 *
 *   1. Address the image's own host, `cdn.50mmretina.com` — never the apex,
 *      never `location.origin`. Then www, the apex and the Android app's own
 *      scheme all produce the identical request.
 *   2. Every image can fall back to the untransformed original by itself.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { isCdnImage, isResizable, cdnResized, cdnSrcSet, originalOnError } from "@/lib/cdnImage";

const OURS = "https://cdn.50mmretina.com/portfolio-images/potd/photo.webp";

describe("the resizer is addressed at the image's own host", () => {
  it("never uses the apex, which is the host that failed in August and fails today", () => {
    const out = cdnResized(OURS, 900);
    expect(out.startsWith("https://cdn.50mmretina.com/cdn-cgi/image/")).toBe(true);
    expect(out).not.toContain("https://50mmretina.com/cdn-cgi");
    expect(out).not.toContain("www.50mmretina.com/cdn-cgi");
  });

  it("encodes the option separator as %2C, or srcset silently loads nothing", () => {
    // A raw comma inside a candidate URL breaks the whole comma-separated
    // srcset attribute: currentSrc comes back empty and NO image renders.
    // That shipped for a few minutes on 2026-08-01.
    const set = cdnSrcSet(OURS, [480, 900]);
    expect(set).toContain("%2C");
    // Exactly two candidates, so exactly one separating comma.
    expect(set.split(" 480w,").length).toBe(2);
    expect(set.match(/cdn-cgi/g)?.length).toBe(2);
  });

  it("asks for the widths it was given, in order", () => {
    const set = cdnSrcSet(OURS, [480, 640, 900]);
    expect(set).toMatch(/width=480%2C[^ ]* 480w/);
    expect(set).toMatch(/width=900%2C[^ ]* 900w/);
  });
});

describe("anything that is not ours is left completely alone", () => {
  it("does not touch another host", () => {
    const other = "https://images.unsplash.com/photo.jpg";
    expect(isCdnImage(other)).toBe(false);
    expect(cdnResized(other, 900)).toBe(other);
    expect(cdnSrcSet(other, [480])).toBe("");
  });

  it("does not touch Supabase storage, data: or blob: urls", () => {
    const sb = "https://jtdtehuqtinjxropkkcn.supabase.co/storage/v1/object/public/avatars/a.webp";
    expect(cdnResized(sb, 900)).toBe(sb);
    expect(cdnResized("data:image/png;base64,AAA", 900)).toBe("data:image/png;base64,AAA");
    expect(cdnResized("blob:http://x/y", 900)).toBe("blob:http://x/y");
  });

  it("never resizes a GIF or an SVG", () => {
    // A resize kills the animation and defeats the point of a vector.
    const gif = "https://cdn.50mmretina.com/a.gif";
    const svg = "https://cdn.50mmretina.com/a.svg";
    expect(isResizable(gif)).toBe(false);
    expect(isResizable(svg)).toBe(false);
    expect(cdnResized(gif, 900)).toBe(gif);
  });

  it("never transforms an already-transformed url", () => {
    const once = cdnResized(OURS, 900);
    expect(cdnResized(once, 480)).toBe(once);
  });

  it("survives a malformed url instead of throwing", () => {
    expect(isCdnImage("not a url")).toBe(false);
    expect(cdnResized("not a url", 900)).toBe("not a url");
  });
});

describe("rule 2 — a picture can always get back to the original", () => {
  const makeImg = () => {
    const el = { srcset: "x 900w", src: cdnResized(OURS, 900), dataset: {} as Record<string, string> };
    return el as unknown as HTMLImageElement;
  };

  it("drops back to the untransformed original when the transform fails", () => {
    const img = makeImg();
    originalOnError(OURS)({ currentTarget: img });
    expect(img.src).toBe(OURS);
    // srcset must be cleared too, or the browser simply re-picks a transformed
    // candidate and the fallback achieves nothing.
    expect(img.srcset).toBe("");
  });

  it("gives up after ONE attempt, so a genuinely dead file cannot loop", () => {
    const img = makeImg();
    const handler = originalOnError(OURS);
    handler({ currentTarget: img });
    img.src = "something-else-that-also-fails";
    handler({ currentTarget: img });
    // Second call is a no-op: it did not re-write src back again.
    expect(img.src).toBe("something-else-that-also-fails");
  });
});

describe("the Curated Wall shows the original, not the soft thumbnail", () => {
  const src = readSource("src/components/PhotoOfTheDay.tsx");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  it("no longer prefers the 600px thumbnail for the big square", () => {
    // `thumbnail_url || image_url` is what made it extremely soft: a 600x338
    // thumbnail inside a 663x663 object-cover square, at dpr 1.25, is a 2.45x
    // upscale of only 338 real pixels.
    expect(code).not.toContain("potd.thumbnail_url || potd.image_url");
    expect(code).toMatch(/const base = potd\.image_url \|\| potd\.thumbnail_url/);
    expect(code).toMatch(/src=\{base\}/);
  });

  it("does NOT put a cdn-cgi srcset on the carousel", () => {
    /**
     * This is a regression guard with a specific story. A /cdn-cgi/image/
     * srcset was shipped here and the square rendered EMPTY: the component
     * swaps photo every 5s and `key={potd.id}` unmounts the <img>, so a size
     * Cloudflare had never generated never finished loading before it was
     * destroyed — and a stalled request fires no error event, so the fallback
     * never ran either.
     *
     * The URLs were fine (81-272ms measured). The carousel was the problem.
     * Anyone re-adding this must first warm the derivatives or hold each photo
     * until its image has decoded.
     */
    expect(code).not.toContain("cdnSrcSet");
    expect(code).not.toContain("cdn-cgi");
  });
});

function readSource(p: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require("node:path") as typeof import("node:path");
  return readFileSync(join(process.cwd(), p), "utf8");
}
