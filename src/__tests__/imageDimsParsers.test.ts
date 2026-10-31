/**
 * DIMENSION RECOVERY IS TESTED ON BYTES, BECAUSE A WRONG ANSWER IS WORSE
 * THAN NO ANSWER.
 *
 * The B3d-2 backfill writes recovered dimensions into filenames that the
 * renderer then trusts for frame aspect and srcset widths. A parser that
 * misreads a header would mis-size the frame and mislabel every candidate for
 * exactly the posts the job was meant to repair — silently. So every parser
 * is exercised on hand-built binary fixtures, including the refusal paths.
 *
 * The module under test is the SAME file the edge function runs (pure bytes,
 * no Deno APIs) — one implementation, tested here, deployed there.
 */
import { describe, it, expect } from "vitest";
import { imageDimsFromBytes } from "../../supabase/functions/_shared/imageDims";

const bytes = (...parts: (number[] | Uint8Array | string)[]) => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...(p as number[]));
  }
  return new Uint8Array(out);
};
const u16le = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
const u16be = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32be = (n: number) => [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

describe("WebP — the platform's own output format", () => {
  it("VP8X (extended): 24-bit canvas minus-one encoding", () => {
    const b = bytes("RIFF", u32le(100), "WEBP", "VP8X", u32le(10), [0, 0, 0, 0], u24le(2559), u24le(1706));
    expect(imageDimsFromBytes(b)).toEqual({ width: 2560, height: 1707 });
  });
  it("VP8L (lossless): 14+14 bits packed after the 0x2F signature", () => {
    const w = 1620, h = 1080;
    const packed = (w - 1) | ((h - 1) << 14);
    // Trailing padding: a real VP8L stream continues past the size bits; the
    // parser's 30-byte floor exists so truncated downloads are refused, and a
    // fixture below the floor tests the floor, not the parser.
    const b = bytes("RIFF", u32le(100), "WEBP", "VP8L", u32le(10), [0x2f], u32le(packed), [0, 0, 0, 0, 0]);
    expect(imageDimsFromBytes(b)).toEqual({ width: 1620, height: 1080 });
  });
  it("VP8 (lossy): start code then 14-bit LE fields", () => {
    const b = bytes("RIFF", u32le(100), "WEBP", "VP8 ", u32le(10), [0, 0, 0], [0x9d, 0x01, 0x2a], u16le(900), u16le(1600));
    expect(imageDimsFromBytes(b)).toEqual({ width: 900, height: 1600 });
  });
  it("refuses a lossy chunk without the start code", () => {
    const b = bytes("RIFF", u32le(100), "WEBP", "VP8 ", u32le(10), [0, 0, 0], [0x00, 0x01, 0x2a], u16le(900), u16le(1600));
    expect(imageDimsFromBytes(b)).toBeNull();
  });
});

describe("PNG", () => {
  it("reads IHDR", () => {
    const b = bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a], u32be(13), "IHDR", u32be(720), u32be(480));
    expect(imageDimsFromBytes(b)).toEqual({ width: 720, height: 480 });
  });
});

describe("JPEG — legacy pre-uploader files", () => {
  const seg = (marker: number, payload: number[]) => [0xff, marker, ...u16be(payload.length + 2), ...payload];
  it("walks past APP/DQT segments to a baseline SOF0", () => {
    const b = bytes(
      [0xff, 0xd8],
      seg(0xe1, [1, 2, 3]),          // APP1
      seg(0xdb, [0, 1, 2, 3]),       // DQT
      seg(0xc0, [8, ...u16be(1280), ...u16be(1920), 3]), // SOF0: precision, H, W
    );
    expect(imageDimsFromBytes(b)).toEqual({ width: 1920, height: 1280 });
  });
  it("reads progressive SOF2 — common in old exports", () => {
    const b = bytes([0xff, 0xd8], seg(0xc2, [8, ...u16be(800), ...u16be(1200), 3]));
    expect(imageDimsFromBytes(b)).toEqual({ width: 1200, height: 800 });
  });
  it("refuses when image data (SOS) arrives before any SOF", () => {
    const b = bytes([0xff, 0xd8], seg(0xda, [1, 2]), [0xaa, 0xbb]);
    expect(imageDimsFromBytes(b)).toBeNull();
  });
  it("refuses on marker desynchronisation instead of guessing", () => {
    const b = bytes([0xff, 0xd8], [0x00, 0x11, 0x22]);
    expect(imageDimsFromBytes(b)).toBeNull();
  });
});

describe("refusal is the default", () => {
  it("unknown container → null", () => {
    expect(imageDimsFromBytes(bytes("GIF89a", [0, 1, 2, 3]))).toBeNull();
  });
  it("absurd dimensions → null (a 0×0 or 200k-wide 'image' is a parse gone wrong)", () => {
    const b = bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a], u32be(13), "IHDR", u32be(0), u32be(480));
    expect(imageDimsFromBytes(b)).toBeNull();
    const c = bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a], u32be(13), "IHDR", u32be(200000), u32be(480));
    expect(imageDimsFromBytes(c)).toBeNull();
  });
  it("truncated header → null", () => {
    expect(imageDimsFromBytes(bytes("RIFF", u32le(100), "WEB"))).toBeNull();
  });
});
