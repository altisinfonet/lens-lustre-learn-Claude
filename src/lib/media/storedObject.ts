/**
 * WHAT WAS ACTUALLY STORED, MEASURED FROM THE BYTES THAT WERE ACTUALLY SENT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The media engine's first act is the member's client declaring a fingerprint,
 * and its second is the server re-reading the stored object and checking that
 * the declaration was true. That only works if the client declares the bytes it
 * UPLOADED — not the bytes the member picked.
 *
 * Those are almost never the same file. `uploadImageWithThumbnail` re-encodes
 * to WebP at q=0.92, caps posts at 2560px, and on encode failure falls back to
 * a GPS-scrubbed copy of the original. Hashing `file` instead of the encoded
 * result would declare a fingerprint the stored object cannot possibly match,
 * and EVERY upload would quarantine itself on arrival — a total posting outage
 * that a green unit suite would not notice, because no unit test uploads bytes.
 *
 * So this is measured at the one moment both facts are in hand: after the
 * encoder has produced the file that is about to be sent, and before it is.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The declaration `media_begin_upload` takes, and the server re-derives. */
export interface StoredObjectFacts {
  /** Lowercase hex, 64 chars, of the bytes that were uploaded. */
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  mime: string;
}

export function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Dimensions of an encoded image, read from the encoded image itself.
 *
 * Used only when the compressor could not report them — the encode-failure
 * fallback, where the original file is uploaded as-is. Refusing to guess is the
 * house rule everywhere else in the media path, and a wrong pair here would
 * mis-size the frame and mislabel every srcset candidate for that photograph.
 */
export async function measureImageDims(
  blob: Blob,
): Promise<{ width: number; height: number } | null> {
  // createImageBitmap is the cheap path and exists in every browser this app
  // supports; the <img> route is the fallback for test environments and older
  // webviews, which is where jsdom lands.
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      const dims = { width: bmp.width, height: bmp.height };
      bmp.close?.();
      if (dims.width > 0 && dims.height > 0) return dims;
    } catch {
      /* fall through */
    }
  }
  if (typeof URL === "undefined" || typeof Image === "undefined") return null;
  return await new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dims.width > 0 && dims.height > 0 ? dims : null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Describe the file that is about to be uploaded.
 *
 * Returns null rather than a half-truth when the dimensions cannot be
 * established — the caller then keeps that slide on the legacy path instead of
 * declaring something it does not know. A refused declaration is recoverable;
 * a false one quarantines the member's photograph.
 */
export async function describeStoredObject(
  encoded: Blob,
  knownDims?: { width: number; height: number } | null,
): Promise<StoredObjectFacts | null> {
  const buf = await encoded.arrayBuffer();
  if (buf.byteLength === 0) return null;

  const dims =
    knownDims && knownDims.width > 0 && knownDims.height > 0
      ? knownDims
      : await measureImageDims(encoded);
  if (!dims) return null;

  const mime = encoded.type || "image/webp";
  // media_objects CHECKs this list; declaring anything else is refused by
  // media_begin_upload with a readable error rather than a constraint name.
  if (!["image/webp", "image/jpeg", "image/png", "image/avif"].includes(mime)) return null;

  return {
    sha256: toHex(await crypto.subtle.digest("SHA-256", buf)),
    bytes: buf.byteLength,
    width: dims.width,
    height: dims.height,
    mime,
  };
}
