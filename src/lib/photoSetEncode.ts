/**
 * PHOTO SET V2 ENCODER (photo plan U1b) — browser canvas, no dependency.
 *
 * Decodes the source ONCE, then draws each planned copy (imageLadder.photoSetPlan)
 * from that one clean bitmap:
 *
 *   2048  drawn and encoded CLEAN (the private copy, Unit A), THEN the credit
 *         is drawn on top of the same canvas (photoCredit.drawCredit) and it is
 *         encoded again (the credited copy, full screen only)
 *   1080 / 600 / 320  drawn from the same clean bitmap — never from the credited
 *         canvas, so the smaller copies carry no credit (Owner decision 4)
 *
 * No upscaling (a copy's long edge is min(cap, source long edge)); the same
 * rounding as compressImage, so the dimensions in the filename are exact.
 * A canvas re-encode carries no metadata, so no copy can carry GPS.
 *
 * Throws (ImageDecodeError, no canvas, encoder refusal) or returns null (a copy
 * came back as anything but real WebP) — either way the uploader then
 * falls back to today's set, so a post is never lost to this encoder.
 */
import { decodeImageForCanvas } from "@/lib/imageCompression";
import { photoSetPlan, photoSetSuffix, type PhotoSetCopy } from "@/lib/imageLadder";
import { drawCredit } from "@/lib/photoCredit";

export interface EncodedSetCopy extends PhotoSetCopy {
  file: File;
  width: number;
  height: number;
}
export interface EncodedPhotoSet {
  source: { width: number; height: number };
  copies: EncodedSetCopy[];
}

/** compressImage's rounding: fit the long edge inside `max`, never upscale. */
export function fitInside(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= max && height <= max) return { width, height };
  const ratio = Math.min(max / width, max / height);
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to create image/webp blob"))), WEBP, quality);
  });
}

/**
 * U2 (review of #823): a browser without a WebP encoder does not refuse —
 * `toBlob(cb, "image/webp")` silently hands back a PNG. Stored under a `.webp`
 * name with `image/webp` metadata that would be a lie (and a 5–10× heavier
 * file), so ANY copy whose blob is not really WebP makes the whole set null and
 * the uploader uses today's path.
 */
const WEBP = "image/webp";

/** Null = this browser cannot make the set (no real WebP encoder); use today's path. */
export async function encodePhotoSet(file: File, keepFull: boolean, creditText: string): Promise<EncodedPhotoSet | null> {
  const img = await decodeImageForCanvas(file);
  const source = { width: img.width, height: img.height };
  if (!(source.width > 0 && source.height > 0)) throw new Error("decoded image has no size");
  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  const copies: EncodedSetCopy[] = [];
  // Unit A: the private clean 2048 and the credited 2048 share ONE canvas —
  // encoded clean first, then the credit is drawn on top and encoded again.
  let kept: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; max: number } | null = null;
  const free = (c: HTMLCanvasElement) => { c.width = 0; c.height = 0; };
  try {
    for (const c of photoSetPlan(source.width, source.height, keepFull)) {
      const { width, height } = fitInside(source.width, source.height, c.maxDimension);
      let canvas: HTMLCanvasElement;
      let ctx: CanvasRenderingContext2D;
      if (kept && kept.max === c.maxDimension && !c.private) {
        ({ canvas, ctx } = kept);
        kept = null;
      } else {
        if (kept) { free(kept.canvas); kept = null; }
        canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const got = canvas.getContext("2d");
        if (!got) throw new Error("Canvas 2D context unavailable");
        ctx = got;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);
      }
      if (c.credit) drawCredit(ctx, width, height, creditText);
      const blob = await toBlob(canvas, c.quality);
      // Keep the clean 2048 canvas for the credited copy that follows; free every
      // other backing store now (a phone holds the source plus ONE canvas at a time).
      if (c.private) kept = { canvas, ctx, max: c.maxDimension };
      else free(canvas);
      if (blob.type !== WEBP) return null;
      copies.push({ ...c, width, height, file: new File([blob], `${base}${photoSetSuffix(c.slot)}.webp`, { type: "image/webp" }) });
    }
  } finally {
    if (kept) free(kept.canvas);
    if (typeof (img as ImageBitmap).close === "function") (img as ImageBitmap).close();
  }
  return { source, copies };
}
