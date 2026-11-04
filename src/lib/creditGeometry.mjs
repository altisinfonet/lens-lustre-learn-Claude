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
  urlVersion: 4, // raised 3 Nov 2026 after PROBE_20261110_0108_photo_credit_redraw_v4 PASS on production (every credited file redrawn at v4)
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

/*
 * ═════════════════════════════════════════════════════════════════════════════
 * v5 (credit fix U2, Owner 4 Nov 2026: "Now have too small credit and very big
 * credit — make it presentable as approved"). NOT YET IN USE: the renderers
 * above keep v4 until the Owner approves the v5 samples (creditv5-REAL-*.png);
 * then the one server renderer (tools/media-derivatives/credit-render.mjs) draws
 * every credited file with v5 and the browser canvas stops drawing (U3).
 *
 * WHY v4 LOOKED "TOO SMALL": its font follows the photo's WIDTH with a 3 px
 * floor, so a 1080 copy got 6 px and an 810-wide portrait 4 px. The approved
 * look is v4 on a 2048-wide landscape: ≈ 11 px, white ≈ 0.30, soft shadow.
 * v5 keeps that look and scales it from the SHORT side, with a visible floor
 * and a ceiling, so portrait / landscape / small photos look alike:
 *
 *   fontPx = clamp(round(short × 0.0081), 11, 28)        2048×1365 → 11 px
 *   inset  = max(round(short × 0.018), round(fontPx × 1.2)), bottom-right
 *   a line wider than 90 % of the photo is set smaller (MEASURED with the real
 *   font by the renderer), never below 8 px
 *   white 0.32, shadow black 0.25 blurred ≈ 0.09 em, dropped ≈ 0.08 em
 * The font is the committed Fira Sans SemiBold (SIL OFL 1.1) — every machine
 * draws the same glyphs.
 * ═════════════════════════════════════════════════════════════════════════════
 */
export const CREDIT_GEOMETRY_V5 = Object.freeze({
  version: 5,
  fontPctShort: 0.0081,
  minFontPx: 11,
  maxFontPx: 28,
  /** Only when the measured line would not fit `maxLinePct` of the width. */
  tinyMinFontPx: 8,
  insetPctShort: 0.018,
  insetMinEm: 1.2,
  fillAlpha: 0.32,
  shadowAlpha: 0.25,
  shadowBlurEm: 0.09,
  shadowOffsetEm: 0.08,
  maxLinePct: 0.9,
  fontFamily: "Fira Sans",
  fontStyle: "SemiBold",
  weight: 600,
});

/** v5 for a `width × height` file, before the renderer's measured fit-to-width step. */
export function creditGeometryV5For(width, height) {
  const g = CREDIT_GEOMETRY_V5;
  const short = Math.max(1, Math.min(width, height));
  const fontPx = Math.min(g.maxFontPx, Math.max(g.minFontPx, Math.round(short * g.fontPctShort)));
  return {
    fontPx,
    inset: Math.max(Math.round(short * g.insetPctShort), Math.round(fontPx * g.insetMinEm)),
    maxLineWidth: Math.floor(width * g.maxLinePct),
  };
}
