/**
 * THE LAST DOOR GPS CAN WALK THROUGH, GUARDED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every SUCCESSFUL image upload on this platform is re-encoded through a
 * canvas (imageCompression.ts), which strips all metadata — GPS included — as
 * a side effect of redrawing pixels. Competition EXIF is separately extracted
 * with a PICK list that excludes GPS by design (exifExtract.ts, rule B8).
 *
 * The one remaining path was the encode-FAILURE fallback in imageUpload.ts:
 * when the browser cannot decode a file (the realistic case is iPhone HEIC in
 * a browser without HEIC support), the code uploaded the member's ORIGINAL,
 * untouched — EXIF, GPS, camera serial and all — to a PUBLIC CDN. Precisely
 * the uploads that skip the stripper are the ones that keep their metadata.
 *
 * This module closes that door with three outcomes, in order of preference:
 *
 *   1. No GPS present            → the original may upload as-is (unchanged
 *                                  behaviour; most files land here).
 *   2. GPS present, JPEG         → the metadata segments are spliced out of
 *                                  the JPEG byte stream (APPn + COM), pixels
 *                                  untouched, and the strip is VERIFIED by
 *                                  re-reading before the file is released.
 *   3. GPS present, undecodable  → the upload is REFUSED with a clear,
 *                                  member-readable error. We do not leak a
 *                                  member's home location because their
 *                                  browser lacked a codec.
 *
 * Fail-closed on doubt: if the GPS check itself errors on a format we cannot
 * decode, we cannot prove the file is clean, and an unprovable file does not
 * go to a public CDN (outcome 3). A file we CAN prove clean sails through.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import exifr from "exifr";
import { logger } from "@/lib/logger";

const FILE = "src/lib/gpsGuard.ts";

/** Thrown when an upload must be refused rather than leak location. */
export class GpsPrivacyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GpsPrivacyError";
  }
}

/** Member-facing copy, kept here so every surface says the same thing. */
export const GPS_REFUSAL_MESSAGE =
  "This photo contains location (GPS) data and your browser could not convert it to a web format. " +
  "To protect your privacy it was not uploaded. Please export it as JPEG (or remove location data) and try again.";

/** True if the bytes begin with a JPEG SOI marker. */
function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/**
 * Splice metadata segments out of a JPEG without touching pixel data.
 *
 * A JPEG is SOI (FFD8) followed by marker segments until SOS (FFDA), after
 * which entropy-coded image data runs to EOI. Metadata lives in APP0–APP15
 * (FFE0–FFEF: EXIF, XMP, ICC…) and COM (FFFE). Everything else — quantisation
 * tables, Huffman tables, frame headers — is required to decode the image and
 * is kept. From SOS onward the stream is copied verbatim.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) break; // malformed; stop stripping, copy the rest
    const marker = bytes[i + 1];
    if (marker === 0xda) {
      // SOS: image data follows — copy everything from here verbatim.
      for (let j = i; j < bytes.length; j++) out.push(bytes[j]);
      return new Uint8Array(out);
    }
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) {
      for (let j = i; j < i + 2 + segLen; j++) out.push(bytes[j]);
    }
    i += 2 + segLen;
  }
  // Malformed tail: keep whatever remains rather than truncate the image.
  for (let j = i; j < bytes.length; j++) out.push(bytes[j]);
  return new Uint8Array(out);
}

/**
 * Gate an ORIGINAL (non-re-encoded) file before it may be uploaded.
 * Returns the file to upload (original, or a stripped copy).
 * Throws GpsPrivacyError when the file must not be uploaded at all.
 */
export async function guardOriginalUpload(file: File): Promise<File> {
  let hasGps: boolean;
  try {
    const gps = await exifr.gps(file);
    hasGps = !!gps && typeof gps.latitude === "number" && typeof gps.longitude === "number";
  } catch {
    // exifr could not parse the container at all. For JPEG we can still strip
    // structurally (below). For anything else we cannot PROVE the file is
    // clean — and an unprovable file does not go to a public CDN.
    hasGps = true;
  }
  if (!hasGps) return file;

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isJpeg(bytes)) {
    logger.warn({
      code: "FILE-5006",
      event: "GPS_UPLOAD_REFUSED",
      fn: "guardOriginalUpload",
      file: FILE,
      message: "Original upload refused: GPS present (or unprovable) and the format cannot be stripped in the browser.",
      reason: "encode fallback would have published the member's location on the public CDN",
      expected: "A JPEG (strippable) or a GPS-free file",
      actual: `${file.type || "unknown type"}, ${file.size} bytes`,
      nextStep:
        "This is the guard WORKING, not a defect. The member was asked to export as JPEG or remove location data.",
      detail: { fileType: file.type, fileSizeBytes: file.size },
    });
    throw new GpsPrivacyError(GPS_REFUSAL_MESSAGE);
  }

  const stripped = stripJpegMetadata(bytes);
  const cleanFile = new File([stripped as BlobPart], file.name, { type: "image/jpeg" });

  // Verify the strip actually worked before releasing the file. A parser
  // failure on the stripped copy means the metadata container is gone, which
  // is the outcome we wanted — only a POSITIVE GPS read fails the guard.
  try {
    const still = await exifr.gps(cleanFile);
    if (still && typeof still.latitude === "number") {
      logger.error({
        code: "FILE-5007",
        event: "GPS_STRIP_VERIFY_FAILED",
        fn: "guardOriginalUpload",
        file: FILE,
        message: "GPS still readable after the JPEG metadata splice. Refusing the upload.",
        reason: "the splice missed a metadata container; do not upload what we could not clean",
        expected: "No GPS readable from the stripped copy",
        actual: "GPS coordinates still parseable",
        nextStep: "Treat as a gpsGuard bug: capture the file type/structure from the detail and extend stripJpegMetadata.",
        detail: { fileType: file.type, fileSizeBytes: file.size },
      });
      throw new GpsPrivacyError(GPS_REFUSAL_MESSAGE);
    }
  } catch (e) {
    if (e instanceof GpsPrivacyError) throw e;
    // Unparseable after strip = metadata gone. Proceed.
  }

  logger.info({
    code: "FILE-5005",
    event: "GPS_STRIPPED_FROM_FALLBACK_UPLOAD",
    fn: "guardOriginalUpload",
    file: FILE,
    message: "Encode fallback carried GPS; metadata spliced out of the JPEG before upload.",
    detail: { fileType: file.type, beforeBytes: file.size, afterBytes: cleanFile.size },
  });
  return cleanFile;
}

/**
 * The file itself, when it is PROVABLY a WebP with no metadata chunk; null
 * otherwise (not WebP, malformed, or carrying EXIF / XMP). Reads the RIFF chunk
 * list only — no decode. A browser canvas encode (compressImageToFiles) never
 * writes EXIF or XMP, so its output passes; a camera / editor WebP with
 * location data does not.
 *
 * Why not guardOriginalUpload: its parser (exifr) does not read WebP at all
 * ("Unknown file format"), so for a WebP it can only ever refuse.
 */
function readBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer().then((a) => new Uint8Array(a));
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

export async function metadataFreeWebp(file: File): Promise<File | null> {
  try {
    const b = await readBytes(file);
    const tag = (i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    if (b.length < 20 || tag(0) !== "RIFF" || tag(8) !== "WEBP") return null;
    const riffEnd = Math.min(b.length, 8 + (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0);
    let i = 12;
    let sawImage = false;
    while (i + 8 <= riffEnd) {
      const t = tag(i);
      const n = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0;
      if (t === "EXIF" || t === "XMP ") return null;
      if (t === "VP8 " || t === "VP8L" || t === "ANMF") sawImage = true;
      i += 8 + n + (n & 1);
    }
    if (i !== riffEnd && i !== riffEnd + 1) return null; // truncated / overlong chunk list: not provable
    return sawImage ? file : null;
  } catch {
    return null;
  }
}
