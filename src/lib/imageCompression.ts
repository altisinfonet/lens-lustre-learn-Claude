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
 * Load a File / Blob into an HTMLImageElement.
 */
const loadImage = (file: File | Blob): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });

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

  let { naturalWidth: w, naturalHeight: h } = img;

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
