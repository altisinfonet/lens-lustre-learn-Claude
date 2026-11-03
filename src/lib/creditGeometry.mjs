/**
 * THE CREDIT'S GEOMETRY — ONE source for both renderers (audit M3):
 *   · the uploader's canvas            src/lib/photoCredit.ts (creditLayout / drawCredit)
 *   · the backfill / rectify workers   tools/media-derivatives/credit-svg.mjs (creditSvg)
 * Plain ES module (no TypeScript) so Node tools import it as is; types in
 * creditGeometry.d.mts.
 *
 * HISTORY (Owner, 3 Nov 2026):
 *   v1  the approved sample: 13 px on a 400 px-wide photo, white 0.82, shadow 0.65
 *   v2  "too big": one third of v1 (13/3), opacity halved (0.41, shadow 0.325)
 *   v3  after his web test, 12:45Z: "1/3 text font small and 50% opacity down" —
 *       one third of v2 (13/9), half of v2's opacity (0.205, shadow 0.1625)
 *   v4  16:05Z, after seeing v3 on real files ("unreadable"): "MIDDLE SIZE" —
 *       HALF of v2's size (13/6), slightly fainter than v2 (white 0.32, shadow 0.25;
 *       measured ≈ 0.30 in the file, v2 measured ≈ 0.38)
 * `version` is the geometry new credited files are drawn with (and what the
 * redraw records). `urlVersion` is what the web puts on credited URLs as
 * `?cv=` (src/lib/photoProtection.ts withCreditVersion) — SEPARATE ON PURPOSE
 * (review of #856): credited files are cached as immutable for a year, so the
 * URL may only change AFTER every existing credited file on the lane has been
 * redrawn (PROBE_20261110_0108 PASS on production); otherwise a view in between
 * would cache the old bytes under the new URL. 0 = no query (today's URLs).
 */
export const CREDIT_GEOMETRY = Object.freeze({
  version: 4,
  urlVersion: 0, // raised to 4 in a follow-up, only after the v4 redraw PROBE passes on production
  /** font = SAMPLE_FONT_PX × (width / SAMPLE_WIDTH) / SIZE_DIVISOR */
  sampleFontPx: 13,
  sampleWidth: 400,
  sizeDivisor: 6,
  /** No floor that would undo the Owner's chosen size: 3 px is the smallest a renderer draws. */
  minFontPx: 3,
  fillAlpha: 0.32,
  shadowAlpha: 0.25,
  /** margins: right / bottom as a share of the photo's width / height */
  rightPct: 0.022,
  bottomPct: 0.026,
  /** a line wider than this share of the photo is scaled down to fit */
  maxLinePct: 0.9,
  weight: 600,
});

/** The geometry for a `width × height` image (both renderers). */
export function creditGeometryFor(width, height) {
  const g = CREDIT_GEOMETRY;
  const k = width / g.sampleWidth;
  const fontPx = Math.max(g.minFontPx, Math.round((g.sampleFontPx * k) / g.sizeDivisor));
  return {
    fontPx,
    x: width - Math.round(width * g.rightPct),
    y: height - Math.round(height * g.bottomPct),
    fill: `rgba(255,255,255,${g.fillAlpha})`,
    shadow: `rgba(0,0,0,${g.shadowAlpha})`,
    // offset and blur scale with the text (v3: a ninth of the v1 values)
    shadowOffsetY: Math.max(1, Math.round(k / g.sizeDivisor)),
    shadowBlur: Math.max(1, Math.round((2 * k) / g.sizeDivisor)),
  };
}
