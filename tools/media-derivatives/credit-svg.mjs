/**
 * PHOTO PLAN U5 · the credit on a backfilled 2048 copy, as an SVG overlay for
 * sharp (libvips/librsvg). Same geometry as the uploader's canvas drawing
 * (src/lib/photoCredit.ts creditLayout — parity locked in
 * src/lib/media/__tests__/photoSetCreditSvg.test.ts): Unit A (Owner, 3 Nov) —
 * one third of the sample's 13 px on a 400 px-wide photo (min 8 px), weight 600,
 * right 2.2 % / bottom 2.6 %, rgba(255,255,255,.41), shadow halved
 * (rgba(0,0,0,.325), offset and blur scaled with the text), scaled to the real
 * width. A line wider than 90 % of the photo gets a smaller font instead of
 * running off.
 *
 * The SVG has no width measurement, so the line width is ESTIMATED at 0.58 em
 * per character (DejaVu Sans / Liberation Sans semibold average, the fonts a
 * Linux runner has) — only used for that 90 % scale-down.
 */
export function creditLayout(width, height) {
  const k = width / 400;
  const fontPx = Math.max(8, Math.round((13 * k) / 3));
  return {
    fontPx,
    x: width - Math.round(width * 0.022),
    y: height - Math.round(height * 0.026),
    fill: "rgba(255,255,255,0.41)",
    shadow: "rgba(0,0,0,0.325)",
    shadowOffsetY: Math.max(1, Math.round(k / 3)),
    shadowBlur: Math.max(1, Math.round((2 * k) / 3)),
  };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function creditSvg(width, height, text) {
  const l = creditLayout(width, height);
  let px = l.fontPx;
  const est = Array.from(text).length * 0.58 * px;
  if (est > width * 0.9) px = Math.max(8, Math.floor((px * width * 0.9) / est));
  const font = `font-family="DejaVu Sans, Liberation Sans, Arial, Helvetica, sans-serif" font-weight="600" font-size="${px}"`;
  const t = esc(text);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<defs><filter id="s" x="-10%" y="-100%" width="120%" height="300%"><feGaussianBlur stdDeviation="${l.shadowBlur / 2}"/></filter></defs>`
    + `<text x="${l.x}" y="${l.y + l.shadowOffsetY}" text-anchor="end" ${font} fill="${l.shadow}" filter="url(#s)">${t}</text>`
    + `<text x="${l.x}" y="${l.y}" text-anchor="end" ${font} fill="${l.fill}">${t}</text>`
    + `</svg>`;
}
