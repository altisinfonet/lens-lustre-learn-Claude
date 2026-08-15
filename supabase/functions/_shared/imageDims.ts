/**
 * Pixel dimensions from image HEADER BYTES — no decoder, no canvas.
 *
 * B3d-2 exists because 59% of production slides (153/258, measured
 * 2026-08-13) carry no `-wXhY` in their filename, so the renderer can build
 * no srcset and no frame aspect for them: every device downloads the
 * full-size original AND the card falls back to a 4:5 frame. The backfill
 * reads each file's first bytes from R2 and recovers width×height from the
 * container header.
 *
 * DELIBERATELY Deno-free and DOM-free: pure byte parsing, so the exact same
 * code is unit-tested in vitest on hand-built fixtures and run in the edge
 * function on real files. One implementation, both worlds.
 *
 * Supported: WebP (VP8 / VP8L / VP8X), JPEG (SOF0/1/2), PNG (IHDR).
 * Everything the platform's own uploader has ever produced is WebP; JPEG and
 * PNG cover pre-uploader legacy files. Anything else returns null — the
 * backfill SKIPS and reports it, never guesses. A wrong dimension is worse
 * than a missing one: it silently mis-sizes the frame and mislabels srcset
 * widths for exactly the posts this job was meant to repair.
 */

export interface Dims {
  width: number;
  height: number;
}

const te = (s: string, b: Uint8Array, off: number) =>
  s.split("").every((ch, i) => b[off + i] === ch.charCodeAt(0));

function u16le(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function u24le(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
}
function u32le(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}
function u16be(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}
function u32be(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

/** WebP: RIFF????WEBP then VP8 /VP8L/VP8X chunk. */
function webpDims(b: Uint8Array): Dims | null {
  if (b.length < 30 || !te("RIFF", b, 0) || !te("WEBP", b, 8)) return null;
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (fourcc === "VP8X") {
    // Canvas size: 24-bit little-endian minus one, at offsets 24 and 27.
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  if (fourcc === "VP8L") {
    // Lossless: signature 0x2F then 14+14 bits packed little-endian.
    if (b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === "VP8 ") {
    // Lossy: 3-byte frame tag, then start code 9D 01 2A, then 16-bit LE
    // width/height with 2 scaling bits to mask off.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  return null;
}

/** PNG: 8-byte signature, IHDR is always the first chunk. */
function pngDims(b: Uint8Array): Dims | null {
  if (b.length < 24) return null;
  if (b[0] !== 0x89 || !te("PNG", b, 1)) return null;
  if (!te("IHDR", b, 12)) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

/**
 * JPEG: walk marker segments to the first SOF (C0/C1/C2). Progressive (C2)
 * is common in pre-uploader legacy files.
 */
function jpegDims(b: Uint8Array): Dims | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null; // desynchronised — refuse to guess
    const marker = b[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2; // standalone markers have no length
      continue;
    }
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      // SOF: [len][precision][height u16][width u16]
      return { width: u16be(b, i + 7), height: u16be(b, i + 5) };
    }
    if (marker === 0xda) return null; // image data reached without a SOF
    i += 2 + len;
  }
  return null;
}

/**
 * Recover dimensions from the first bytes of a file, or null.
 * 64 KiB is enough for every real case: WebP and PNG carry dims in the first
 * 30 bytes; JPEG SOF sits after metadata segments, which the platform's own
 * files do not have (canvas-encoded) and legacy files rarely push past 64 KiB.
 */
export function imageDimsFromBytes(bytes: Uint8Array): Dims | null {
  const d = webpDims(bytes) ?? pngDims(bytes) ?? jpegDims(bytes);
  if (!d) return null;
  if (!Number.isInteger(d.width) || !Number.isInteger(d.height)) return null;
  if (d.width <= 0 || d.height <= 0 || d.width > 100000 || d.height > 100000) return null;
  return d;
}

/**
 * Insert recovered dims into the LAST path segment, before the extension —
 * producing exactly the shape DIMS_RE and intrinsicFromName already parse
 * (`…-w1620h1080.webp`). Applied identically to the storage key and the
 * public URL so the two can never disagree.
 */
export function insertDimsInName(pathOrUrl: string, width: number, height: number): string {
  return pathOrUrl.replace(/(\.[a-z0-9]+)((?:[?#].*)?)$/i, `-w${width}h${height}$1$2`);
}
