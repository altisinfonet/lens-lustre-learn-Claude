/**
 * VID-1 · cover.ts — the member's cover must always fit inside VID-LIM-005
 * (poster + playlists ≤ 2 MB) and keep the picture's shape.
 */
import { describe, expect, it, vi } from "vitest";
import { COVER_MAX_BYTES, coverSize, jpegUnder } from "../cover";

describe("coverSize", () => {
  it("fits the long edge inside 1280 and keeps the shape", () => {
    expect(coverSize(1080, 1920)).toEqual({ width: 720, height: 1280 });
    expect(coverSize(4000, 3000)).toEqual({ width: 1280, height: 960 });
  });
  it("never enlarges a small picture", () => {
    expect(coverSize(640, 360)).toEqual({ width: 640, height: 360 });
  });
});

describe("jpegUnder", () => {
  it("returns the first encoding under the limit, best quality first", async () => {
    const toJpeg = vi.fn(async (q: number) => new Uint8Array(q > 0.8 ? COVER_MAX_BYTES + 1 : 1000));
    const out = await jpegUnder(toJpeg);
    expect(out.byteLength).toBe(1000);
    expect(toJpeg.mock.calls.map((c) => c[0])).toEqual([0.85, 0.72]);
  });
  it("shrinks the picture when quality alone is not enough", async () => {
    const toJpeg = vi.fn(async (_q: number, scale: number) => new Uint8Array(scale > 0.6 ? COVER_MAX_BYTES * 2 : 500));
    await jpegUnder(toJpeg);
    expect(toJpeg.mock.calls.at(-1)?.[1]).toBe(0.5);
  });
  it("refuses, clearly, a picture that never fits", async () => {
    await expect(jpegUnder(async () => new Uint8Array(COVER_MAX_BYTES + 1))).rejects.toThrow(/VID-COVER-002/);
  });
});
