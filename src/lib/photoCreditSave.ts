/**
 * THE CREDIT IS DRAWN ON SAVE, IN THE BROWSER — never stored (Owner order,
 * 4 Nov 2026, feed posts).
 *
 * A feed photo (`-l6`, imageLadder FEED PHOTO SET) is stored as three CLEAN
 * WebP files. When someone saves it, this ONE function (web and the installed
 * app bundle the same src) fetches the 2048 copy, draws it on a canvas, draws
 * the credit line on it with the ONE geometry — CREDIT_GEOMETRY_V5 /
 * creditGeometryV5For (src/lib/creditGeometry.mjs), the same numbers and the same
 * committed font (tools/media-derivatives/fonts/FiraSans-SemiBold-latin.ttf, via
 * FontFace) the server renderer (tools/media-derivatives/credit-render.mjs) uses
 * — and hands the browser that picture as a download. The screen never shows a
 * credit; nothing credited is ever uploaded.
 *
 * PIXELS: the 2048 is fetched with `fetch(mode: "cors")` and decoded from the
 * blob, so the canvas is never tainted. That needs CORS on the public media
 * host for the page's origin — measured 4 Nov 2026 on cdn.50mmretina.com:
 * https://50mmretina.com, https://www.50mmretina.com and https://localhost (the
 * Android app) are allowed; capacitor://localhost (the iOS app) is NOT. Never a
 * `/cdn-cgi/image/` URL (no CORS there).
 *
 * If anything fails (network, CORS, decode, encode) NOTHING is saved and the
 * failure is logged (FILE-5016): a clean, uncredited copy is never the fallback.
 */
import { CREDIT_GEOMETRY_V5 as G, creditGeometryV5For } from "@/lib/creditGeometry.mjs";
import { FEED_PHOTO_MARKER, FEED_PHOTO_SIZES, photoSetCleanUrl, photoSetMarker, photoSetUrl } from "@/lib/imageLadder";
import { creditOwnerName, creditText } from "@/lib/photoCredit";
import { logger } from "@/lib/logger";
import creditFontUrl from "../../tools/media-derivatives/fonts/FiraSans-SemiBold-latin.ttf?url";

const FILE = "src/lib/photoCreditSave.ts";

/** Our own family name for the committed font, so no page font can stand in for it. */
export const CREDIT_FONT_FAMILY = "50mm Credit Fira Sans";
/** The saved file: JPEG (opens everywhere a member keeps photos), high quality. */
export const SAVED_PHOTO_TYPE = "image/jpeg";
export const SAVED_PHOTO_QUALITY = 0.92;

/** A FEED post photo: its key is `post-images/<owner uuid>/posts/…` (any marker, or none). */
const FEED_POST_PHOTO_RE = /\/post-images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/posts\//i;

/**
 * True for a photo whose credit is drawn at save time: EVERY feed post photo —
 * the feed set (`-l6`) and the older ones (`-l3`, `-l4`, `-l5`, unmarked).
 * Owner, 5 Nov 2026: old photos still saved their old stored copy, with the old
 * small credit ("from 11 to 22 not done"). Feed only: competition photos do not
 * match (their credit is left for later).
 */
export function drawsCreditOnSave(url: string | null | undefined): boolean {
  return !!url && (photoSetMarker(url) === FEED_PHOTO_MARKER || FEED_POST_PHOTO_RE.test(url));
}

/**
 * The CLEAN public file the credit is drawn on: a feed set photo's 2048; an
 * older photo's largest public clean copy (photoSetCleanUrl — never a stored
 * credited file, never the private clean 2048).
 */
export function saveSourceUrl(url: string): string {
  return photoSetMarker(url) === FEED_PHOTO_MARKER ? photoSetUrl(url, FEED_PHOTO_SIZES[0]) : photoSetCleanUrl(url);
}

function creditFont(px: number): string {
  return `${G.weight} ${px}px "${CREDIT_FONT_FAMILY}", "${G.fontFamily}", sans-serif`;
}

export interface DrawnCredit {
  drawn: boolean;
  fontPx: number;
  inset: number;
  textW: number;
  textH: number;
  left: number;
  top: number;
}

/**
 * Draw `text` on a `width × height` canvas exactly as the server renderer
 * places it: v5 size from the short side, the measured fit-to-width step, inset
 * bottom-right, a blurred black shadow dropped ≈ 0.08 em, then white at 0.32.
 * A photo too small for the line keeps no credit (drawn false) — as the server.
 */
export function paintSaveCredit(ctx: CanvasRenderingContext2D, width: number, height: number, text: string): DrawnCredit {
  const geo = creditGeometryV5For(width, height);
  const measure = (px: number) => {
    ctx.font = creditFont(px);
    const m = ctx.measureText(text);
    const asc = m.fontBoundingBoxAscent ?? px * 0.935;
    const desc = m.fontBoundingBoxDescent ?? px * 0.265;
    return { w: Math.ceil(m.width), asc, h: Math.ceil(asc + desc) };
  };
  let px = geo.fontPx;
  for (let i = 0; i < 40; i++) {
    const m = measure(px);
    if (m.w <= geo.maxLineWidth || px <= G.tinyMinFontPx) break;
    px = Math.max(G.tinyMinFontPx, Math.min(px - 1, Math.floor((px * geo.maxLineWidth) / m.w)));
  }
  const m = measure(px);
  const pad = Math.max(2, Math.ceil(px * 0.5));
  const base = { fontPx: px, inset: geo.inset, textW: m.w, textH: m.h };
  if (m.w > Math.floor(width * G.maxLinePct) || m.w + 2 * pad > width || m.h + 2 * pad > height) {
    return { ...base, drawn: false, left: 0, top: 0 };
  }
  const left = Math.max(0, width - geo.inset - m.w);
  const top = Math.max(0, height - geo.inset - m.h);
  const baseline = top + m.asc;
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.font = creditFont(px);
  // The shadow alone: opaque text drawn far off the canvas, its shadow offset
  // back onto the photo (so the shadow's alpha is exactly shadowAlpha).
  const away = width + height + 1000;
  ctx.shadowColor = `rgba(0, 0, 0, ${G.shadowAlpha})`;
  ctx.shadowBlur = 2 * Math.max(0.4, px * G.shadowBlurEm); // canvas blur ≈ 2σ (sharp's blur takes σ)
  ctx.shadowOffsetX = away;
  ctx.shadowOffsetY = Math.max(1, Math.round(px * G.shadowOffsetEm));
  ctx.fillStyle = "#000000";
  ctx.fillText(text, left - away, baseline);
  ctx.shadowColor = "rgba(0, 0, 0, 0)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = `rgba(255, 255, 255, ${G.fillAlpha})`;
  ctx.fillText(text, left, baseline);
  ctx.restore();
  return { ...base, drawn: true, left, top };
}

let fontReady: Promise<void> | null = null;
/** The committed font, loaded once (FontFace). A failure is not fatal: the line falls back to a sans font. */
export function loadCreditFont(): Promise<void> {
  fontReady ??= (async () => {
    const face = new FontFace(CREDIT_FONT_FAMILY, `url(${creditFontUrl})`, { weight: String(G.weight) });
    await face.load();
    document.fonts.add(face);
  })().catch(() => { fontReady = null; });
  return fontReady;
}

/** The post owner's id from a feed photo's key (`…/post-images/<uid>/posts/…`). */
export function ownerIdFromPhotoUrl(url: string): string | null {
  const m = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/posts\//i.exec(url);
  return m ? m[1] : null;
}

/** The credit line for the photo's owner (photoCredit.ts rule); "© 50mm Retina World" when unknown. */
async function creditLineFor(url: string): Promise<string> {
  const id = ownerIdFromPhotoUrl(url);
  if (!id) return creditText("");
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.from("profiles_public").select("full_name, custom_url").eq("id", id).maybeSingle();
    return creditText(creditOwnerName(data));
  } catch {
    return creditText("");
  }
}

async function decode(blob: Blob): Promise<{ img: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const b = await createImageBitmap(blob);
    return { img: b, width: b.width, height: b.height, close: () => b.close() };
  }
  // A blob: URL is same-origin, so this never taints the canvas either.
  const u = URL.createObjectURL(blob);
  try {
    const el = new Image();
    el.src = u;
    await el.decode();
    return { img: el, width: el.naturalWidth, height: el.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(u);
  }
}

function savedName(url: string): string {
  const leaf = (url.split(/[?#]/)[0].split("/").pop() ?? "photo").replace(/\.[a-z0-9]+$/i, "");
  return `50mm-retina-world-${leaf.replace(/(-w\d+h\d+)?-l[3-6]f?.*$/i, "") || "photo"}.jpg`;
}

/**
 * THE ONE SAVE: the photo's 2048 copy with the credit drawn on it, handed to the
 * browser as a download. Resolves true when the file was handed over.
 */
export async function savePhotoWithCredit(url: string): Promise<boolean> {
  try {
    const source = saveSourceUrl(url);
    const [res, text] = await Promise.all([fetch(source, { mode: "cors", credentials: "omit" }), creditLineFor(url), loadCreditFont()]);
    if (!res.ok) throw new Error(`photo fetch ${res.status}`);
    const pic = await decode(await res.blob());
    const canvas = document.createElement("canvas");
    canvas.width = pic.width;
    canvas.height = pic.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(pic.img, 0, 0, pic.width, pic.height);
    pic.close();
    paintSaveCredit(ctx, pic.width, pic.height, text);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob returned nothing"))), SAVED_PHOTO_TYPE, SAVED_PHOTO_QUALITY));
    canvas.width = 0;
    canvas.height = 0;
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = savedName(url);
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
    return true;
  } catch (err) {
    logger.warn({
      code: "FILE-5016",
      event: "PHOTO_SAVE_CREDIT_FAILED",
      fn: "savePhotoWithCredit",
      file: FILE,
      message: "Saving a feed photo with its credit failed; nothing was saved.",
      reason: err instanceof Error ? err.message : String(err),
      expected: "The 2048 copy drawn with the credit, handed over as a download",
      actual: "No download (a clean copy is never the fallback)",
      nextStep: "A TypeError / 'Failed to fetch' means the media host refused CORS for this page's origin (check Access-Control-Allow-Origin on the photo). Anything else: decode or canvas limits on this device.",
      detail: { origin: typeof location !== "undefined" ? location.origin : "" },
    });
    return false;
  }
}
