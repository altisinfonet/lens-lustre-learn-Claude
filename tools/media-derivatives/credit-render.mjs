/**
 * THE ONE CREDIT RENDERER — credit fix U2, geometry v5 (src/lib/creditGeometry.mjs
 * CREDIT_GEOMETRY_V5). Server side: sharp (libvips + Pango) with an EMBEDDED
 * font file (fonts/FiraSans-SemiBold-latin.ttf, SIL OFL 1.1 — see fonts/README.md),
 * so a GitHub runner, the Oracle VM and a developer PC draw the same glyphs,
 * and the line is MEASURED with the real font (Pango's own text box), never
 * estimated (credit-svg.mjs estimates 0.58 em per character).
 *
 *   renderCredit(sharp, input, text) → {
 *     image   a sharp pipeline: the photo with the credit (encode it as you like),
 *     width, height,
 *     credit  { version: 5, drawn, fontPx, textW, textH, left, top, inset, fallbackChars }
 *   }
 * drawn = false: the photo is too small for the line and comes back unmarked.
 * fallbackChars: characters the committed font lacks (see fonts/README.md).
 *
 * The photo is NEVER resized here: the caller decides the file's size (2048 for
 * a new photo, the clean 1080 for a rectified one, ≤ 2048 for an old one). The
 * pixels are only turned upright (EXIF).
 *
 * NOT YET WIRED: the workers keep credit-svg.mjs (v4) until the Owner approves
 * the v5 samples; switching them is U3/U4 (one renderer for every path).
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CREDIT_GEOMETRY_V5 as G, creditGeometryV5For } from "../../src/lib/creditGeometry.mjs";

export const CREDIT_FONT_FILE = join(dirname(fileURLToPath(import.meta.url)), "fonts", "FiraSans-SemiBold-latin.ttf");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One line of plain text: control characters, line breaks and broken surrogates would stop Pango or wrap the line. */
const oneLine = (s) => String(s).replace(/\p{Cs}/gu, "").normalize("NFC").replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/ {2,}/g, " ").trim();

/** The Unicode ranges kept in the font subset (fonts/README.md). */
const COVERED = /[ -~ -ɏḀ-ỿ‐-‧‰-›€™]/u;

/** How many characters of the line the committed font cannot draw (Pango takes those from the machine's fonts). */
export function creditFallbackChars(text) {
  return [...oneLine(text)].filter((c) => !COVERED.test(c)).length;
}

/** The credit line as a transparent PNG at `px`, `color` at `alpha` (0..1) — real glyphs, real box. */
async function textImage(sharp, text, px, color, alpha) {
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="${color}" fgalpha="${Math.round(alpha * 100)}%">${esc(oneLine(text))}</span>`,
      font: `${G.fontFamily} ${G.fontStyle} ${px}px`,
      fontfile: CREDIT_FONT_FILE,
      dpi: 72,
      rgba: true,
    },
  }).png().toBuffer({ resolveWithObject: true });
  return { png: data, w: info.width, h: info.height };
}

/**
 * SELF-CHECK — the committed font is really the one drawing. If the machine's
 * fontconfig does not match it (CI, 4 Nov 2026: a subset without name IDs
 * 16/17), Pango silently uses a fallback font and every width is wrong. The
 * reference line at 100 px measures 984 px in Fira Sans SemiBold; anything off
 * by more than 3 % refuses to draw rather than writing a wrong credit.
 */
const REFERENCE = { text: "© 50mm Retina World", px: 100, w: 984 };
let fontChecked = null;
export async function assertCreditFont(sharp) {
  fontChecked ??= (async () => {
    const t = await textImage(sharp, REFERENCE.text, REFERENCE.px, "#FFFFFF", 1);
    if (Math.abs(t.w - REFERENCE.w) > REFERENCE.w * 0.03) {
      throw new Error(`CREDIT-FONT-001 the credit font is not the committed Fira Sans SemiBold here (reference ${t.w} px, expected ${REFERENCE.w}) — refusing to draw`);
    }
    return true;
  })();
  return fontChecked;
}

/** The real width × height of the line at `px`. */
export async function measureCredit(sharp, text, px) {
  const t = await textImage(sharp, text, px, "#FFFFFF", 1);
  return { w: t.w, h: t.h };
}

/** v5's font size for this file and this line, including the measured fit-to-width step. */
export async function creditFontPx(sharp, width, height, text) {
  const geo = creditGeometryV5For(width, height);
  let px = geo.fontPx;
  for (let i = 0; i < 40; i++) {
    const m = await measureCredit(sharp, text, px);
    if (m.w <= geo.maxLineWidth || px <= G.tinyMinFontPx) break;
    px = Math.max(G.tinyMinFontPx, Math.min(px - 1, Math.floor((px * geo.maxLineWidth) / m.w)));
  }
  return { px, inset: geo.inset };
}

/** Draw the v5 credit bottom-right on `input` (a path or a Buffer). */
export async function renderCredit(sharp, input, text) {
  await assertCreditFont(sharp);
  const upright = await sharp(input).rotate().toBuffer({ resolveWithObject: true });
  const { width, height } = upright.info;
  const { px, inset } = await creditFontPx(sharp, width, height, text);
  const fill = await textImage(sharp, text, px, "#FFFFFF", G.fillAlpha);
  // room for the blur to spread before it is composited
  const pad = Math.max(2, Math.ceil(px * 0.5));
  const fallbackChars = creditFallbackChars(text);
  // A photo too small for the line, even at the smallest size: keep it clean and
  // say so. A clipped credit looks broken, and sharp refuses an overlay larger
  // than the photo, which would stop a whole batch.
  if (fill.w > Math.floor(width * G.maxLinePct) || fill.w + 2 * pad > width || fill.h + 2 * pad > height) {
    return {
      image: sharp(upright.data),
      width,
      height,
      credit: { version: G.version, drawn: false, fontPx: px, textW: fill.w, textH: fill.h, left: 0, top: 0, inset, fallbackChars },
    };
  }
  const shadowText = await textImage(sharp, text, px, "#000000", G.shadowAlpha);
  const shadow = await sharp(shadowText.png)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(Math.max(0.4, px * G.shadowBlurEm))
    .png()
    .toBuffer();
  const left = Math.max(0, width - inset - fill.w);
  const top = Math.max(0, height - inset - fill.h);
  const drop = Math.max(1, Math.round(px * G.shadowOffsetEm));
  const image = sharp(upright.data).composite([
    { input: shadow, left: Math.max(0, left - pad), top: Math.max(0, top - pad + drop) },
    { input: fill.png, left, top },
  ]);
  return { image, width, height, credit: { version: G.version, drawn: true, fontPx: px, textW: fill.w, textH: fill.h, left, top, inset, fallbackChars } };
}
