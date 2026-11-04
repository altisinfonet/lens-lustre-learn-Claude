// @vitest-environment node
/**
 * CREDIT FIX U2 · GEOMETRY v5 + THE ONE SERVER RENDERER (Owner, 4 Nov 2026:
 * "Now have too small credit and very big credit — make it presentable as
 * approved").
 *
 * MEASURED CAUSE of "too small": v4 sized the font from the photo's WIDTH only
 * with a 3 px floor (creditGeometry.mjs creditGeometryFor) — a 1080 copy got
 * 6 px, an 810-wide portrait 4 px. Of "too big": the v1 `-l4` masters (50 px;
 * U1). Two renderers (browser canvas + system font, sharp SVG + an ESTIMATED
 * width) drew different glyphs at different widths.
 *
 * v5: font from the SHORT side (0.81 % — 11 px on a 2048×1365 landscape, the
 * approved v4 "middle" look), floor 11 px, ceiling 28 px; drawn by ONE renderer
 * with an EMBEDDED font and MEASURED in the output pixels here.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { CREDIT_GEOMETRY_V5, creditGeometryV5For } from "@/lib/creditGeometry.mjs";
import { CREDIT_FONT_FILE, measureCredit, renderCredit } from "../../../../tools/media-derivatives/credit-render.mjs";

const LINE = "© Dipannita Sen, 50mm Retina World";
const LONG = "© Venkataraghavan C., 50mm Retina World";

describe("the photo's own pixels (credit U3: the workers now feed it WebP)", () => {
  it("are decoded once: outside the credit's box the output equals the input, no lossy step in between", async () => {
    const noise = Buffer.alloc(800 * 600 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    const input = await sharp(noise, { raw: { width: 800, height: 600, channels: 3 } }).webp({ quality: 85 }).toBuffer();
    const r = await renderCredit(sharp, input, LINE);
    const out = await r.image.removeAlpha().raw().toBuffer();
    const was = await sharp(input).removeAlpha().raw().toBuffer();
    const top = (r.credit.top - 20) * 800 * 3; // every row above the credit
    expect(Buffer.compare(out.subarray(0, top), was.subarray(0, top))).toBe(0);
  });
});

describe("v5 geometry — from the SHORT side, visible floor and ceiling", () => {
  it("the approved look: 11 px on a 2048×1365 landscape; a portrait of the same photo gets the same", () => {
    expect(creditGeometryV5For(2048, 1365).fontPx).toBe(11);
    expect(creditGeometryV5For(1365, 2048).fontPx).toBe(11);
  });
  it("never the near-invisible v4 sizes: every 1080 / 810 / small copy is at least 11 px", () => {
    for (const [w, h] of [[1080, 682], [810, 1080], [1080, 1080], [480, 319], [1536, 2048]]) {
      expect(creditGeometryV5For(w, h).fontPx, `${w}x${h}`).toBeGreaterThanOrEqual(CREDIT_GEOMETRY_V5.minFontPx);
    }
    expect(CREDIT_GEOMETRY_V5.minFontPx).toBe(11);
  });
  it("never the big v1 size: at most 28 px, whatever the file", () => {
    expect(creditGeometryV5For(8000, 6000).fontPx).toBe(28);
    expect(creditGeometryV5For(2048, 2048).fontPx).toBe(17);
  });
  it("inset bottom-right grows with the short side, never tighter than 1.2 em", () => {
    expect(creditGeometryV5For(2048, 1365).inset).toBe(25);
    expect(creditGeometryV5For(1080, 682).inset).toBe(13);
    expect(creditGeometryV5For(480, 319).inset).toBe(13);
  });
  it("alpha ≈ 0.30 with a soft shadow (the approved v4 look, measured ≈ 0.29–0.30)", () => {
    expect(CREDIT_GEOMETRY_V5.fillAlpha).toBe(0.32);
    expect(CREDIT_GEOMETRY_V5.shadowAlpha).toBe(0.25);
  });
});

describe("the one renderer — embedded font, measured in the output pixels", () => {
  it("draws with the committed font file (Fira Sans SemiBold, Latin subset, OFL) — never a machine's own font", () => {
    const sum = createHash("sha256").update(readFileSync(CREDIT_FONT_FILE)).digest("hex");
    const readme = readFileSync(join(process.cwd(), "tools/media-derivatives/fonts/README.md"), "utf8");
    expect(readme).toContain(sum);
    expect(readFileSync(join(process.cwd(), "tools/media-derivatives/fonts/OFL.txt"), "utf8")).toMatch(/SIL Open Font License, Version 1\.1/);
  });

  it("the glyphs really ARE the committed font, on this machine too (a fallback font would be ~15 % wider)", async () => {
    // CI 4 Nov 2026: with the typographic family names (name IDs 16/17) stripped
    // from the subset, Linux fontconfig did not match "Fira Sans SemiBold" and
    // Pango silently drew a fallback — every width was wrong. Fira Sans SemiBold
    // sets this line at ≈ 182 px at 11 px; DejaVu Sans ≈ 210+.
    const { w } = await measureCredit(sharp, LINE, 11);
    expect(w).toBeGreaterThanOrEqual(174);
    expect(w).toBeLessThanOrEqual(190);
  });

  /** A mid-grey photo with texture, so the white text + dark shadow both change pixels. */
  async function photo(w: number, h: number): Promise<Buffer> {
    const raw = Buffer.alloc(w * h * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = 110 + ((i * 7919) % 23);
    return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  }
  /** The box of pixels the credit changed (|Δ| > 6 on any channel). */
  async function inkBox(clean: Buffer, credited: Buffer, w: number, h: number) {
    const a = await sharp(clean).removeAlpha().raw().toBuffer();
    const b = await sharp(credited).removeAlpha().raw().toBuffer();
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      if (Math.abs(a[i] - b[i]) > 6 || Math.abs(a[i + 1] - b[i + 1]) > 6 || Math.abs(a[i + 2] - b[i + 2]) > 6) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  for (const [w, h] of [[2048, 1365], [1365, 2048], [1080, 682], [810, 1080], [480, 319]] as const) {
    it(`${w}×${h}: the credit sits bottom-right, its ink is a readable 11 px line, inside the photo`, async () => {
      const clean = await photo(w, h);
      const r = await renderCredit(sharp, clean, LINE);
      const out = await r.image.png().toBuffer();
      expect([r.width, r.height]).toEqual([w, h]);
      expect(r.credit.version).toBe(5);
      expect(r.credit.fontPx).toBe(11);
      const box = await inkBox(clean, out, w, h);
      // the glyphs + soft shadow: taller than the near-invisible v4 (4–8 px), far below v1 (50 px)
      expect(box.h, JSON.stringify(box)).toBeGreaterThanOrEqual(9);
      expect(box.h, JSON.stringify(box)).toBeLessThanOrEqual(20);
      // measured width = the real line (not an estimate): ≈ 15 em for this line at 11 px
      expect(box.w).toBeGreaterThan(140);
      expect(box.w).toBeLessThan(230);
      // bottom-right, inset as the geometry says (± the shadow's spread)
      const inset = creditGeometryV5For(w, h).inset;
      expect(w - 1 - box.x1).toBeGreaterThanOrEqual(inset - 4);
      expect(w - 1 - box.x1).toBeLessThanOrEqual(inset + 4);
      expect(h - 1 - box.y1).toBeGreaterThanOrEqual(inset - 6);
      expect(h - 1 - box.y1).toBeLessThanOrEqual(inset + 6);
    });
  }

  it("a photo too narrow for the line: set smaller to fit 90 % of the width, never below 8 px", async () => {
    const clean = await photo(200, 134);
    const r = await renderCredit(sharp, clean, LONG);
    expect(r.credit.fontPx).toBeLessThan(11);
    expect(r.credit.fontPx).toBeGreaterThanOrEqual(CREDIT_GEOMETRY_V5.tinyMinFontPx);
    expect(r.credit.textW).toBeLessThanOrEqual(Math.floor(200 * 0.9));
  });

  it("the same input draws the same bytes (deterministic)", async () => {
    const clean = await photo(1080, 682);
    const a = await (await renderCredit(sharp, clean, LINE)).image.raw().toBuffer();
    const b = await (await renderCredit(sharp, clean, LINE)).image.raw().toBuffer();
    expect(Buffer.compare(a, b)).toBe(0);
  });

  // Review of #876, 4 Nov 2026: sharp refuses an overlay larger than the photo,
  // so a tiny photo threw and would have stopped a whole redraw batch.
  for (const [w, h] of [[100, 100], [140, 80], [12, 12], [5000, 20]] as const) {
    it(`${w}×${h}: a photo too small for the line keeps its pixels and says so, it never throws`, async () => {
      const clean = await photo(w, h);
      const r = await renderCredit(sharp, clean, LONG);
      expect(r.credit.drawn).toBe(false);
      expect([r.width, r.height]).toEqual([w, h]);
      const box = await inkBox(clean, await r.image.png().toBuffer(), w, h);
      expect(box.x1).toBe(-1); // no pixel changed
    });
  }

  it("a normal photo reports drawn: true", async () => {
    const r = await renderCredit(sharp, await photo(1080, 682), LINE);
    expect(r.credit.drawn).toBe(true);
  });

  it("the drawn pixels are the approved look: white ≈ 0.32 over a soft dark shadow (measured, not the constants)", async () => {
    const raw = Buffer.alloc(2048 * 2048 * 3, 100);
    const clean = await sharp(raw, { raw: { width: 2048, height: 2048, channels: 3 } }).png().toBuffer();
    const r = await renderCredit(sharp, clean, LINE);
    const px = await r.image.removeAlpha().raw().toBuffer();
    let hi = 0, lo = 255;
    for (let i = 0; i < px.length; i += 3) { if (px[i] > hi) hi = px[i]; if (px[i] < lo) lo = px[i]; }
    // full white at 0.32 over grey 100 is 150; with the shadow beneath it, a little less
    expect(hi).toBeGreaterThanOrEqual(125);
    expect(hi).toBeLessThanOrEqual(151);
    expect(lo).toBeLessThan(97);
  });

  it("markup characters in a name draw as text", async () => {
    const r = await renderCredit(sharp, await photo(1080, 682), "© A&B <Studio>, 50mm Retina World");
    expect(r.credit.drawn).toBe(true);
    expect(r.credit.textW).toBeGreaterThan(100);
  });

  it("a control character or a line break in a name cannot break the line", async () => {
    const one = await measureCredit(sharp, "© Asha Sen, 50mm Retina World", 11);
    expect(await measureCredit(sharp, "© Asha\nSen,\u0000 50mm\r\nRetina\tWorld", 11)).toEqual(one);
    expect(await measureCredit(sharp, "© Asha Sen\uD800, 50mm Retina World", 11)).toEqual(one);
  });

  it("a name the font does not cover still draws, and the result says how many characters used a fallback font", async () => {
    const latin = await renderCredit(sharp, await photo(1080, 682), "© René Sen, 50mm Retina World");
    expect(latin.credit.fallbackChars).toBe(0);
    const other = await renderCredit(sharp, await photo(1080, 682), "© 王小明, 50mm Retina World");
    expect(other.credit.drawn).toBe(true);
    expect(other.credit.fallbackChars).toBe(3);
  });
});
