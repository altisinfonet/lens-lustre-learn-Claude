/**
 * THE VERDICT OF EVERY VISUAL BASELINE, proved without a browser, and the
 * shape of the B1 gate: all six shared pieces at all four widths, committed,
 * and a workflow that cannot be talked out of failing.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { comparePixels } from "../../../tools/uishot/pixel-compare.mjs";

const LIMITS = { channel: 16, share: 0.001, tile: { size: 48, share: 0.04 } };
const SIZE = 400;

/** A grey picture with `dots` single pixels turned white, spread out or packed into one corner. */
const picture = (dots: number, packed = false) => {
  const raw = Buffer.alloc(SIZE * SIZE * 3, 80);
  for (let n = 0; n < dots; n++) {
    const spot = packed ? n : n * 97;
    const x = spot % SIZE;
    const y = packed ? Math.floor(n / 20) : (n * 53) % SIZE;
    raw.fill(255, (y * SIZE + (packed ? n % 20 : x)) * 3, (y * SIZE + (packed ? n % 20 : x)) * 3 + 3);
  }
  return sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toBuffer();
};

describe("comparePixels", () => {
  it("calls two equal pictures the same", async () => {
    expect((await comparePixels(await picture(0), await picture(0), LIMITS)).same).toBe(true);
  });

  it("passes scattered noise up to 0.1 % and fails above it", async () => {
    const clean = await picture(0);
    expect((await comparePixels(clean, await picture(160), LIMITS)).same).toBe(true); // 0.1 %
    expect((await comparePixels(clean, await picture(161), LIMITS)).same).toBe(false);
  });

  it("fails a small change packed into one square, far below 0.1 % of the picture", async () => {
    const r = await comparePixels(await picture(0), await picture(100, true), LIMITS);
    expect(r.same).toBe(false);
    expect(r.why).toContain("0.063 %");
  });

  it("fails a picture of another size, even by 1 px", async () => {
    const other = await sharp({ create: { width: SIZE + 1, height: SIZE, channels: 3, background: "#505050" } }).png().toBuffer();
    expect((await comparePixels(await picture(0), other, LIMITS)).same).toBe(false);
  });

  it("ignores a change smaller than the channel limit", async () => {
    const a = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 80, g: 80, b: 80 } } }).png().toBuffer();
    const b = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 96, g: 80, b: 80 } } }).png().toBuffer();
    expect((await comparePixels(a, b, LIMITS)).same).toBe(true);
  });
});

describe("the B1 gate", () => {
  const root = process.cwd();
  const pieces = ["postcard", "photogrid", "commentthread", "actionrow", "userline", "notificationrow"];
  const widths = ["web-320", "web-390", "web-1280", "app-390"];
  const dir = join(root, "tools/uishot/ui-baselines");
  const tool = readFileSync(join(root, "tools/uishot/ui-baselines.mjs"), "utf8");
  const flow = readFileSync(join(root, ".github/workflows/d2-ui-baselines.yml"), "utf8");

  it("has a committed baseline for every piece at every width", () => {
    const files = existsSync(dir) ? readdirSync(dir) : [];
    for (const piece of pieces) {
      for (const width of widths) {
        const mine = files.filter((f) => f.startsWith(`${piece}--`) && f.endsWith(`--${width}.png`));
        expect(mine.length, `${piece} at ${width}`).toBeGreaterThan(0);
      }
    }
    const perVariant = new Map<string, number>();
    for (const f of files) {
      const variant = f.replace(/--(web-320|web-390|web-1280|app-390)\.png$/, "");
      perVariant.set(variant, (perVariant.get(variant) ?? 0) + 1);
    }
    for (const [variant, n] of perVariant) expect(n, variant).toBe(widths.length);
  });

  it("names the same pieces, widths and limits as this test", () => {
    for (const piece of pieces) expect(tool).toContain(`"${piece}"`);
    for (const width of widths) expect(tool).toContain(`name: "${width}"`);
    expect(tool).toContain("const LIMITS = { channel: 16, share: 0.001, tile: { size: 48, share: 0.04 } };");
  });

  it("runs on every PR and cannot be made to pass quietly", () => {
    expect(flow).toMatch(/pull_request:\s+branches: \[main, staging\]/);
    expect(flow).toContain("node tools/uishot/ui-baselines.mjs --out");
    for (const escape of ["continue-on-error", "|| true", "--update", "--no-baseline"]) expect(flow).not.toContain(escape);
    expect(tool).toContain("process.exit(pass ? 0 : 1)");
  });
});
