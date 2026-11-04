/**
 * IS THE CREDIT REALLY IN THIS PICTURE? The vacuity guard of
 * tools/uishot/photo-feed-credit.mjs: without it the check could compare two
 * clean files and call that proof.
 *
 * Two screenshots of one photo differ everywhere by a little: different copies,
 * resampling, encoding. So counting pixels over the whole picture proves nothing
 * (creditGuard.test.ts: it passes with no credit drawn). The renderer knows the
 * exact box the line was drawn in. The same box mirrored to the left is the
 * control: noise lands in both, the credit lands in one.
 */
import { PNG } from "pngjs";

/** A pixel differs when any channel moves more than this (0–255). v5 is faint and small on a scaled-down photo. */
export const CREDIT_CHANNEL = 12;
/** At least this many pixels of real ink in the box, at screen size. */
export const CREDIT_MIN_PIXELS = 40;
/** The box must hold this many times what its mirror holds. */
export const CREDIT_MIN_RATIO = 3;

function count(a, b, channel, x0, y0, x1, y1) {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * a.width + x) * 4;
    if (Math.abs(a.data[i] - b.data[i]) > channel || Math.abs(a.data[i + 1] - b.data[i + 1]) > channel || Math.abs(a.data[i + 2] - b.data[i + 2]) > channel) n++;
  }
  return n;
}

/** Pixels differing anywhere in two same-size PNG buffers. */
export function differingPixels(aBuf, bBuf, channel = CREDIT_CHANNEL) {
  const a = PNG.sync.read(aBuf), b = PNG.sync.read(bBuf);
  return count(a, b, channel, 0, 0, a.width, a.height);
}

/**
 * `clean` and `credited`: PNG screenshots of the same element. `line`: the box the
 * renderer drew in, as shares of the file (`lineBox`). `photo`: where the picture
 * sits inside the element, as shares of it (object-contain letterboxes).
 */
export function creditSeen(cleanBuf, creditedBuf, line, photo = { x: 0, y: 0, w: 1, h: 1 }) {
  const a = PNG.sync.read(cleanBuf), b = PNG.sync.read(creditedBuf);
  if (a.width !== b.width || a.height !== b.height) return { seen: false, box: 0, mirror: 0, why: "sizes differ" };
  const px = photo.x * a.width, pw = photo.w * a.width, py = photo.y * a.height, ph = photo.h * a.height;
  const x0 = Math.floor(px + line.x * pw), x1 = Math.ceil(px + (line.x + line.w) * pw);
  const y0 = Math.floor(py + line.y * ph), y1 = Math.ceil(py + (line.y + line.h) * ph);
  const mx0 = Math.floor(px + (1 - line.x - line.w) * pw), mx1 = mx0 + (x1 - x0);
  const box = count(a, b, CREDIT_CHANNEL, x0, y0, x1, y1);
  const mirror = count(a, b, CREDIT_CHANNEL, mx0, y0, mx1, y1);
  const seen = box >= CREDIT_MIN_PIXELS && box >= CREDIT_MIN_RATIO * mirror;
  return { seen, box, mirror, why: `${box} px in the credit's box, ${mirror} in its mirror` };
}

/** The renderer's box for a file, as shares of it. */
export const lineBox = (width, height, c) => ({ x: c.left / width, y: c.top / height, w: c.textW / width, h: c.textH / height });
