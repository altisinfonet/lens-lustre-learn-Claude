/**
 * Client-side image compression utility — WebP-only pipeline.
 *
 * • Accepts ANY size image.
 * • Produces a high-quality **WebP** blob preserving original resolution.
 * • JPEG downloads are generated on-demand via Canvas (no storage).
 * • Thumbnails remain unchanged (handled separately).
 */

interface CompressedImage {
  /** WebP blob – used for storage & display */
  webp: Blob;
  /** Width (original or as passed via maxDimension) */
  width: number;
  /** Height (original or as passed via maxDimension) */
  height: number;
}

interface CompressOptions {
  /** Max dimension (width or height) in px. Default Infinity (no downscale). */
  maxDimension?: number;
  /** WebP quality 0-1. Default 0.92 */
  webpQuality?: number;
}

const DEFAULT_OPTIONS: Required<CompressOptions> = {
  maxDimension: Infinity,
  webpQuality: 0.92,
};

/**
 * Thrown when the browser cannot turn the chosen file into pixels.
 *
 * Carries the file's own type and size, because that is the one piece of
 * information that makes the next report diagnosable from a screenshot.
 */
export class ImageDecodeError extends Error {
  readonly fileType: string;
  readonly fileSize: number;
  constructor(fileType: string, fileSize: number) {
    // NO FORMAT OR VENDOR NAME IN THIS STRING. Owner's standing rule: nothing a
    // member can read may name a third-party format or brand — "a newer format
    // where supported", never the name of it. The type IS needed to diagnose
    // the next report, so it goes to the console and onto the error object,
    // never into the sentence.
    super(
      "This device could not open that photo. Your phone may be saving pictures " +
        "in a newer, space-saving format. Switch your camera to the most " +
        "compatible photo setting, or pick a different picture, and try again.",
    );
    this.name = "ImageDecodeError";
    this.fileType = fileType;
    this.fileSize = fileSize;
  }
}

/** `<img src=objectURL>`, promisified. Resolves null instead of throwing. */
const tryImageElement = (file: File | Blob): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });

/**
 * Load a File / Blob into something drawable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A THREE-LINE PROMISE ANY MORE  (2026-08-02)
 *
 * A member was stopped at onboarding by "Upload failed / Please try another
 * image" with no reason given, and could not finish signing up, because a
 * profile photo is mandatory.
 *
 * The reason the message was empty is here. `img.onerror` hands its listener a
 * DOM **Event**, and the old code did `reject(err)` with it. An Event has no
 * `.message`, so every caller that reported `err?.message` printed its fallback
 * string and told the member nothing. The failure was real; the silence was the
 * bug that made it unfixable from the outside.
 *
 * Two changes:
 *   1. A SECOND ATTEMPT. `createImageBitmap` is a different decode path from
 *      `<img>` and succeeds on files the element rejects (very large images and
 *      some unusual JPEG encodings). It costs nothing when the first attempt
 *      already worked.
 *   2. A REAL ERROR when both fail, naming the file's own MIME type, so the
 *      next screenshot of this says what the file actually was.
 *
 * What it still cannot do is decode a format the browser has no decoder for —
 * which is the common case on a modern phone saving in a newer, space-saving
 * format. That is handled where the file is CHOSEN, by asking the picker for
 * formats the browser can read; see the file inputs for the avatar.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const loadImage = async (file: File | Blob): Promise<CanvasImageSource & { width: number; height: number }> => {
  const el = await tryImageElement(file);
  if (el) {
    // naturalWidth/Height are the true pixels; width/height can be CSS-scaled.
    return Object.assign(el, { width: el.naturalWidth, height: el.naturalHeight });
  }

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file as Blob);
      return bitmap;
    } catch {
      /* fall through to the error below */
    }
  }

  const type = (file as File).type || "";
  const size = (file as File).size ?? 0;
  // The diagnosable half, kept out of the member's view.
  console.warn("[image] no decoder for this file", { type, size });
  throw new ImageDecodeError(type, size);
};

/**
 * Load an image from a URL into an HTMLImageElement.
 */
const loadImageFromUrl = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });

/**
 * Draw the image on a canvas, respecting maxDimension, and export a WebP blob.
 * Resolution is preserved by default (maxDimension = Infinity).
 */
export async function compressImage(
  file: File,
  options?: CompressOptions
): Promise<CompressedImage> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const img = await loadImage(file);

  // `width`/`height` are set by loadImage from naturalWidth/Height for an
  // <img>, and are the intrinsic size for an ImageBitmap. One shape, both paths.
  let { width: w, height: h } = img;

  // Down-scale only if an explicit maxDimension is provided and exceeded
  if (opts.maxDimension !== Infinity && (w > opts.maxDimension || h > opts.maxDimension)) {
    const ratio = Math.min(opts.maxDimension / w, opts.maxDimension / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0, w, h);

  const webp = await canvasToBlob(canvas, "image/webp", opts.webpQuality);

  return { webp, width: w, height: h };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error(`Failed to create ${type} blob`));
      },
      type,
      quality
    );
  });
}

/**
 * Convenience: compress & return a WebP File object with proper name.
 */
export async function compressImageToFiles(
  file: File,
  baseName?: string,
  options?: CompressOptions
): Promise<{ webpFile: File; width: number; height: number }> {
  const name = baseName || file.name.replace(/\.[^.]+$/, "");
  const result = await compressImage(file, options);
  return {
    webpFile: new File([result.webp], `${name}.webp`, { type: "image/webp" }),
    width: result.width,
    height: result.height,
  };
}

/**
 * Avatar-specific compression (smaller dimensions, WebP only).
 */
export async function compressAvatar(file: File): Promise<{ webpFile: File }> {
  const { webpFile } = await compressImageToFiles(file, "avatar", {
    maxDimension: 400,
    webpQuality: 0.85,
  });
  return { webpFile };
}

/**
 * Thumbnail compression for gallery grids (unchanged — kept as-is).
 */
export async function compressThumbnail(file: File, baseName?: string): Promise<{ webpFile: File }> {
  const name = baseName || file.name.replace(/\.[^.]+$/, "");
  const result = await compressImage(file, {
    maxDimension: 600,
    webpQuality: 0.7,
  });
  return {
    webpFile: new File([result.webp], `${name}-thumb.webp`, { type: "image/webp" }),
  };
}

/**
 * On-demand client-side conversion: fetch WebP image → convert to JPEG via Canvas → trigger download.
 * No server roundtrip, no storage cost.
 */
export async function downloadImageAsJpeg(imageUrl: string, fileName?: string): Promise<void> {
  const img = await loadImageFromUrl(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0);

  const blob = await canvasToBlob(canvas, "image/jpeg", 0.95);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "photo.jpg";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
