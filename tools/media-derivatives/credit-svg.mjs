/**
 * PHOTO PLAN U5 · the credit on a backfilled / rectified credited copy, as an
 * SVG overlay for sharp (libvips/librsvg). The geometry is the ONE shared
 * geometry (src/lib/creditGeometry.mjs), the same the uploader's canvas uses
 * (src/lib/photoCredit.ts) — audit M3: there is no second copy of the numbers.
 *
 * The SVG has no width measurement, so the line width is ESTIMATED at 0.58 em
 * per character (DejaVu Sans / Liberation Sans semibold average, the fonts a
 * Linux runner has) — only used for the "too wide → smaller font" rule.
 */
import { CREDIT_GEOMETRY, creditGeometryFor } from "../../src/lib/creditGeometry.mjs";

export function creditLayout(width, height) {
  return creditGeometryFor(width, height);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function creditSvg(width, height, text) {
  const l = creditLayout(width, height);
  let px = l.fontPx;
  const est = Array.from(text).length * 0.58 * px;
  if (est > width * CREDIT_GEOMETRY.maxLinePct) px = Math.max(CREDIT_GEOMETRY.minFontPx, Math.floor((px * width * CREDIT_GEOMETRY.maxLinePct) / est));
  const font = `font-family="DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif" font-weight="${CREDIT_GEOMETRY.weight}" font-size="${px}"`;
  const t = esc(text);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<defs><filter id="s" x="-10%" y="-100%" width="120%" height="300%"><feGaussianBlur stdDeviation="${l.shadowBlur / 2}"/></filter></defs>`
    + `<text x="${l.x}" y="${l.y + l.shadowOffsetY}" text-anchor="end" ${font} fill="${l.shadow}" filter="url(#s)">${t}</text>`
    + `<text x="${l.x}" y="${l.y}" text-anchor="end" ${font} fill="${l.fill}">${t}</text>`
    + `</svg>`;
}
