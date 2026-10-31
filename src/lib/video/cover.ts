/**
 * VID-1 · the video's COVER (poster.jpg): a frame the member picks, or an image
 * they upload (Owner, staging 2026-10-11: "no option to choose thumbnail and
 * upload thumbnail externally").
 *
 * The cover travels inside the HLS package as poster.jpg, exactly where the
 * encoder's own frame went before, so nothing on the server changes: complete
 * still requires it to start FF D8 FF (judge.ts), and the database still caps
 * poster + playlists at 2 MB (VID-LIM-005). This file keeps a cover well under
 * that: at most 1280 px on its long edge and at most COVER_MAX_BYTES.
 *
 * A plain <canvas> (not OffscreenCanvas.convertToBlob) so it works in every
 * browser that can show the upload screen, Safari included.
 */

/** Leaves room for the playlists inside VID-LIM-005's 2 MB. */
export const COVER_MAX_BYTES = 1_500_000;
export const COVER_MAX_EDGE = 1280;

export const COVER_IMAGE_UNREADABLE =
  "We couldn't open that image. Choose a JPEG, PNG or WebP picture.";

/** Fit (w, h) inside COVER_MAX_EDGE on its long edge, shape kept. */
export function coverSize(w: number, h: number, maxEdge = COVER_MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * JPEG bytes no larger than maxBytes: lower the quality first, then the size.
 * `toJpeg(quality, scale)` draws at `scale` of the cover size and encodes.
 */
export async function jpegUnder(
  toJpeg: (quality: number, scale: number) => Promise<Uint8Array>,
  maxBytes = COVER_MAX_BYTES,
): Promise<Uint8Array> {
  let last: Uint8Array | null = null;
  for (const scale of [1, 0.75, 0.5, 0.35]) {
    for (const q of [0.85, 0.72, 0.6]) {
      last = await toJpeg(q, scale);
      if (last.byteLength <= maxBytes) return last;
    }
  }
  throw new Error(`VID-COVER-002: the cover is still over ${Math.round(maxBytes / 1000)} KB — choose another picture`);
}

function canvasJpeg(source: CanvasImageSource, w: number, h: number) {
  return async (quality: number, scale: number): Promise<Uint8Array> => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("VID-COVER-003: this browser can't draw the cover");
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob) throw new Error("VID-COVER-003: this browser can't make the cover");
    return new Uint8Array(await blob.arrayBuffer());
  };
}

/** The frame at `seconds` of the video, as the cover. */
export async function coverFromVideoAt(file: Blob, seconds: number, timeoutMs = 15_000): Promise<Uint8Array> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("VID-COVER-001: couldn't read that frame — try another point")), timeoutMs);
      v.onerror = () => { clearTimeout(timer); reject(new Error("VID-COVER-001: couldn't read that frame — try another point")); };
      v.onloadedmetadata = () => {
        const end = Number.isFinite(v.duration) ? v.duration : seconds;
        // Not the very last instant: some browsers have no frame to show there.
        v.currentTime = Math.max(0, Math.min(seconds, Math.max(0, end - 0.05)));
      };
      v.onseeked = () => { clearTimeout(timer); resolve(); };
      v.src = url;
    });
    const { width, height } = coverSize(v.videoWidth, v.videoHeight);
    return await jpegUnder(canvasJpeg(v, width, height));
  } finally {
    v.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}

/** An uploaded picture, as the cover (EXIF rotation applied, resized, JPEG). */
export async function coverFromImage(file: Blob): Promise<Uint8Array> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error(`VID-COVER-004: ${COVER_IMAGE_UNREADABLE}`);
  }
  try {
    const { width, height } = coverSize(bmp.width, bmp.height);
    return await jpegUnder(canvasJpeg(bmp, width, height));
  } finally {
    bmp.close();
  }
}
