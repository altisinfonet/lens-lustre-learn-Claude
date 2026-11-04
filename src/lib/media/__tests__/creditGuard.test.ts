// @vitest-environment node
/**
 * CREDIT U3 (delta review of #881): the check's vacuity guard must prove the
 * credit is really in the picture. "40 pixels differ somewhere" also passes on
 * resampling and encode noise with no credit drawn at all. The guard now counts
 * only where the credit sits, against the same box mirrored to the left.
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { creditSeen, differingPixels, lineBox } from "../../../../tools/uishot/credit-guard.mjs";
import { renderCredit } from "../../../../tools/media-derivatives/credit-render.mjs";

const LINE = "© Dipannita Sen, 50mm Retina World";
const W = 2048, H = 1366, SCREEN = 1280;

/** A photo-like source: soft gradient plus fine grain, so encoders and resamplers really leave noise. */
async function photo(level: number): Promise<Buffer> {
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const grain = ((x * 7919 + y * 104729) ^ (x * y)) % 41 - 20;
    raw[i] = Math.max(0, Math.min(255, level + (x * 60) / W + grain));
    raw[i + 1] = Math.max(0, Math.min(255, level + (y * 60) / H + grain));
    raw[i + 2] = Math.max(0, Math.min(255, level + 20 + grain));
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 85 }).toBuffer();
}
const SIZE = { width: SCREEN, height: Math.round((SCREEN * H) / W), fit: "fill" as const };
const screen = (file: Buffer) => sharp(file).resize(SIZE).png().toBuffer();
const clean1080 = (file: Buffer) => sharp(file).resize({ width: 1080 }).webp({ quality: 82 }).toBuffer();

describe("the credit guard", { timeout: 60_000 }, () => {
  for (const level of [40, 110]) {
    it(`level ${level}: a copy with NO credit (only resampled and encoded differently) fails it, though the old rule passed`, async () => {
      const src = await photo(level);
      const shown = await screen(await clean1080(src));
      const noCredit = await screen(await sharp(src).webp({ quality: 85 }).toBuffer());
      const { width, height, credit } = await renderCredit(sharp, src, LINE);
      expect(differingPixels(shown, noCredit, 12)).toBeGreaterThanOrEqual(40); // the fault: the old guard said "credited"
      expect(creditSeen(shown, noCredit, lineBox(width, height, credit)).seen).toBe(false);
    });

    it(`level ${level}: the real renderer's credit passes it at screen size`, async () => {
      const src = await photo(level);
      const shown = await screen(await clean1080(src));
      const { image, width, height, credit } = await renderCredit(sharp, src, LINE);
      const credited = await screen(await image.webp({ quality: 85 }).toBuffer());
      const r = creditSeen(shown, credited, lineBox(width, height, credit));
      expect(r.seen, JSON.stringify(r)).toBe(true);
    });
  }

  it("two identical pictures fail it, and the photo's place inside a letterboxed element is honoured", async () => {
    const src = await photo(110);
    const { image, width, height, credit } = await renderCredit(sharp, src, LINE);
    const line = lineBox(width, height, credit);
    const credited = await sharp(await image.webp({ quality: 85 }).toBuffer()).resize(SIZE).png().toBuffer();
    const pad = (b: Buffer) => sharp(b).extend({ top: 100, bottom: 100, left: 0, right: 0, background: "#000" }).png().toBuffer();
    const a = await pad(await sharp(src).resize(SIZE).png().toBuffer());
    const b = await pad(credited);
    expect(creditSeen(a, a, line).seen).toBe(false);
    const h = Math.round((SCREEN * H) / W) + 200;
    const place = { x: 0, y: 100 / h, w: 1, h: 1 - 200 / h };
    expect(creditSeen(a, b, line, place).seen).toBe(true);
    expect(creditSeen(a, b, line).seen).toBe(false); // the box in the wrong place sees no credit
  });
});
