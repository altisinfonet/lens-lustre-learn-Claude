/**
 * THE CREDIT'S GEOMETRY — ONE source for the ONE renderer
 * (tools/media-derivatives/credit-render.mjs, credit U3). Plain ES module (no
 * TypeScript) so Node tools import it as is; types in creditGeometry.d.mts.
 *
 * HISTORY (Owner, 3 Nov 2026): v1 the approved sample (13 px on a 400 px-wide
 * photo, white 0.82) · v2 "too big": a third · v3 a third again, "unreadable"
 * · v4 "MIDDLE SIZE", sized from the WIDTH with a 3 px floor (4–6 px on real
 * copies) · v5 below, Owner approved 4 Nov. The v1–v4 numbers are gone with the
 * browser canvas and the SVG overlay that drew them.
 *
 * `version` is the geometry new credited files are drawn with, and what every
 * record stores. `urlVersion` is what the web puts on credited URLs as `?cv=`
 * (src/lib/photoProtection.ts withCreditVersion) — SEPARATE ON PURPOSE (review of
 * #856): credited files are cached as immutable for a year, so the URL may only
 * change AFTER every existing credited file on the lane has been redrawn;
 * otherwise a view in between would cache the old bytes under the new URL.
 */
export const CREDIT_GEOMETRY = Object.freeze({
  version: 5,
  urlVersion: 4, // raised 3 Nov 2026 after PROBE_20261110_0108_photo_credit_redraw_v4 PASS on production; stays until the v5 redraw has run
});

/*
 * ═════════════════════════════════════════════════════════════════════════════
 * v5 (credit fix U2, Owner 4 Nov 2026: "Now have too small credit and very big
 * credit — make it presentable as approved"). The one server renderer
 * (tools/media-derivatives/credit-render.mjs) draws every credited file with it.
 *
 * WHY v4 LOOKED "TOO SMALL": its font follows the photo's WIDTH with a 3 px
 * floor, so a 1080 copy got 6 px and an 810-wide portrait 4 px. The approved
 * look is v4 on a 2048-wide landscape: ≈ 11 px, white ≈ 0.30, soft shadow.
 * v5 keeps that look and scales it from the SHORT side, with a visible floor
 * and a ceiling, so portrait / landscape / small photos look alike:
 *
 *   fontPx = clamp(round(short × 0.0162), 22, 56)        2048×1365 → 22 px
 *   (Owner, 4 Nov 2026: "double", from 11 to 22. THE ONE PLACE to change the size:
 *   the three numbers below. New photos follow at once; old files need one redraw.)
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
  fontPctShort: 0.0162,
  minFontPx: 22,
  maxFontPx: 56,
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
