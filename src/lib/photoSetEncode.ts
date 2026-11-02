/**
 * PHOTO SET V2 ENCODER (photo plan U1b) — browser canvas, no dependency.
 *
 * Decodes the source ONCE, then draws each planned copy (imageLadder.photoSetPlan)
 * from that one clean bitmap:
 *
 *   2048  drawn, THEN the credit is drawn on top (photoCredit.drawCredit)
 *   1080 / 600 / 320  drawn from the same clean bitmap — never from the credited
 *         canvas, so the smaller copies carry no credit (Owner decision 4)
 *
 * No upscaling (a copy's long edge is min(cap, source long edge)); the same
 * rounding as compressImage, so the dimensions in the filename are exact.
 * A canvas re-encode carries no metadata, so no copy can carry GPS.
 *
 * Throws (ImageDecodeError, no canvas, encoder refusal) — the uploader then
 * falls back to today's set, so a post is never lost to this encoder.
 */
import { decodeImageForCanvas } from "@/lib/imageCompression";
import { photoSetPlan, type PhotoSetCopy } from "@/lib/imageLadder";
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
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to create image/webp blob"))), "image/webp", quality);
  });
}

export async function encodePhotoSet(file: File, keepFull: boolean, creditText: string): Promise<EncodedPhotoSet> {
  const img = await decodeImageForCanvas(file);
  const source = { width: img.width, height: img.height };
  if (!(source.width > 0 && source.height > 0)) throw new Error("decoded image has no size");
  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  const copies: EncodedSetCopy[] = [];
  try {
    for (const c of photoSetPlan(source.width, source.height, keepFull)) {
      const { width, height } = fitInside(source.width, source.height, c.maxDimension);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, width, height);
      if (c.credit) drawCredit(ctx, width, height, creditText);
      const blob = await toBlob(canvas, c.quality);
      // Free the backing store now: a phone holds the source plus ONE canvas at a time.
      canvas.width = 0;
      canvas.height = 0;
      const suffix = c.slot === "master" ? "" : c.slot === "thumb" ? "-thumb" : `-${c.slot}`;
      copies.push({ ...c, width, height, file: new File([blob], `${base}${suffix}.webp`, { type: "image/webp" }) });
    }
  } finally {
    if (typeof (img as ImageBitmap).close === "function") (img as ImageBitmap).close();
  }
  return { source, copies };
}
