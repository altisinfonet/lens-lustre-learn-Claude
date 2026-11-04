/**
 * THE ONE PIXEL COMPARISON for every visual baseline (central-control plan B1).
 *
 * Two PNGs are decoded with sharp and every pixel is compared. It runs in plain
 * Node, so src/uiharness/__tests__/pixelCompare.test.ts proves the verdict
 * itself without a browser.
 *
 *   channel  a pixel "differs" when any channel moves more than this (0-255)
 *   share    a picture "matches" when at most this share of its pixels differ
 *   tile     optional { size, share }: a picture also fails when any one
 *            size x size square has more than this share of differing pixels
 *
 * WHY THE TILE: 0.1 % of a whole card is about 1,300 pixels at 2x. A name that
 * moves 1 px can change fewer than that, so the whole-picture number alone
 * cannot see the smallest change the plan requires it to see. One small square
 * can. Scattered anti-aliasing noise never fills a square, so the tile adds no
 * false alarms.
 */
import sharp from "sharp";

async function decode(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, d: data };
}

export async function comparePixels(aPng, bPng, { channel, share, tile = null }) {
  const a = await decode(aPng);
  const b = await decode(bPng);
  if (a.w !== b.w || a.h !== b.h) return { same: false, why: `size ${a.w}x${a.h} vs ${b.w}x${b.h}` };
  const tiles = new Map();
  let bad = 0;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const i = (y * a.w + x) * 4;
      if (Math.abs(a.d[i] - b.d[i]) > channel || Math.abs(a.d[i + 1] - b.d[i + 1]) > channel
        || Math.abs(a.d[i + 2] - b.d[i + 2]) > channel || Math.abs(a.d[i + 3] - b.d[i + 3]) > channel) {
        bad++;
        if (tile) {
          const key = Math.floor(y / tile.size) * 1_000_000 + Math.floor(x / tile.size);
          tiles.set(key, (tiles.get(key) ?? 0) + 1);
        }
      }
    }
  }
  const s = bad / (a.w * a.h);
  const worst = tile ? Math.max(0, ...tiles.values()) / (tile.size * tile.size) : 0;
  const whole = `${bad} px differ (${(s * 100).toFixed(3)} %)`;
  return {
    same: s <= share && (!tile || worst <= tile.share),
    why: tile ? `${whole}, worst ${tile.size} px square ${(worst * 100).toFixed(1)} %` : whole,
  };
}
