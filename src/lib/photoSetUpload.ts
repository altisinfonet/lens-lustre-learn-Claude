/**
 * PHOTO SET V2 UPLOAD — photo plan U1b, behind switch `photo_set_v2` (OFF on live).
 *
 * Reached only through uploadImageWithThumbnail when the caller passes
 * `photoSet` (switch on for the uploading member). Names and copies are defined
 * in imageLadder.ts (PHOTO SET V2); the canvas work is photoSetEncode.ts.
 *
 *   POST         encode the ORIGINAL once → credited 2048 master + 1080 / 600 / 320
 *                `<uid>/posts/<seg>-w{W}h{H}-l4.webp` (+ -r1080, -thumb, -r320)
 *   COMPETITION  the full-size file exactly as today (a caller-encoded WebP that
 *                metadataFreeWebp proves clean is uploaded as is; anything else is
 *                encoded at full size, q0.92, as today) → plus credited -r2048 and
 *                1080 / 600 / 320 at submission
 *                `<uid>/competitions/<seg>-w{W}h{H}-l4f.webp` (+ -r2048, -r1080, -thumb, -r320)
 *
 * THE MARKER IS A PROMISE (same rule as `-l3`): the siblings go up FIRST; if any
 * fails, the full file and thumb are published under the UNMARKED name, so no
 * reader is ever sent to a copy that is not there.
 *
 * Returns null — "use today's path" — when the new encoder cannot run (decode,
 * canvas or WebP encode failure) BEFORE anything was uploaded: the member's
 * post or entry is never lost to the new code (FILE-5014).
 *
 * Recording: like the rungs today, the siblings appear in no column and are
 * not media_objects derivatives; the full/master is what the media path
 * registers. detect-orphan-files derives the siblings from the marker.
 */
import { storageUpload } from "@/lib/storageUpload";
import { isS3Enabled, uploadPairToS3, uploadToS3 } from "@/lib/s3Upload";
import { compressImageToFiles } from "@/lib/imageCompression";
import { metadataFreeWebp } from "@/lib/gpsGuard";
import { PHOTO_SET_FULL_MARKER, PHOTO_SET_MARKER, rungPath } from "@/lib/imageLadder";
import { dimsSuffix } from "@/lib/imageFrame";
import { logger } from "@/lib/logger";
import { describeStoredObject } from "@/lib/media/storedObject";
import { encodePhotoSet, type EncodedPhotoSet, type EncodedSetCopy } from "@/lib/photoSetEncode";
import { creditOwnerName, creditText } from "@/lib/photoCredit";
import {
  generateImagePath, isPrivateBucket, shouldUpsert,
  type UploadWithThumbnailOptions, type UploadWithThumbnailResult,
} from "@/lib/imageUpload";
import type { EncodedPhoto, PhotoEncoder } from "@/lib/upload/photoJobs";

const FILE = "src/lib/photoSetUpload.ts";

/**
 * The ONE way a caller turns the switch answer into upload options:
 * `{ ...photoSetOption(allowed, profile) }` adds NO key when the switch is off,
 * so the switch-off call is literally today's call.
 */
export function photoSetOption(
  allowed: boolean,
  profile: { full_name?: string | null; custom_url?: string | null } | null | undefined,
): { photoSet?: { creditText: string } } {
  return allowed ? { photoSet: { creditText: creditText(creditOwnerName(profile)) } } : {};
}

const rungOf = (c: EncodedSetCopy) => Number(c.slot.slice(1));

/** encodePhotoSet's null (no real WebP encoder, U2) becomes the same "use today's path" throw as any refusal. */
function needWebp(set: EncodedPhotoSet | null): EncodedPhotoSet {
  if (!set) throw new Error("this browser has no WebP encoder (toBlob returned another type)");
  return set;
}

function fellBack(err: unknown, type: string, file: File): null {
  logger.warn({
    code: "FILE-5014",
    event: "PHOTO_SET_V2_FELL_BACK",
    fn: "uploadPhotoSet",
    file: FILE,
    message: "The new photo set (2048/1080/600/320) could not be made; today's set is uploaded instead.",
    reason: err instanceof Error ? err.message : String(err),
    expected: "Four WebP copies from one decode",
    actual: "Today's encoder path",
    nextStep: "The member's upload still SUCCEEDS. Many of these on one platform means its canvas / WebP encoder refuses the new path — compare with FILE-5004 on the same device.",
    detail: { type, fileType: file.type, fileSizeBytes: file.size },
  });
  return null;
}

export async function uploadPhotoSet(
  opts: UploadWithThumbnailOptions & { photoSet: { creditText: string } },
): Promise<UploadWithThumbnailResult | null> {
  const { bucket, file, type, userId, subPath, cacheControl, encoded, photoSet } = opts;
  const keepFull = type === "competition";
  const upsert = shouldUpsert(type);
  const baseName = file.name.replace(/\.[^.]+$/, "");

  // ── 1. encode (nothing is uploaded yet: any failure here is "use today's path") ──
  let fullFile: File;
  let fullDims: { width: number; height: number };
  let set: EncodedSetCopy[];
  try {
    if (keepFull) {
      // The full size exactly as today's competition path makes it.
      const proven = encoded && file.type === "image/webp" ? await metadataFreeWebp(file) : null;
      if (proven && encoded && proven.width === encoded.width && proven.height === encoded.height) {
        fullFile = proven.file;
        fullDims = { width: proven.width, height: proven.height };
      } else {
        const r = await compressImageToFiles(file, baseName, undefined);
        fullFile = r.webpFile;
        fullDims = { width: r.width, height: r.height };
      }
      set = needWebp(await encodePhotoSet(fullFile, true, photoSet.creditText)).copies;
    } else {
      set = needWebp(await encodePhotoSet(file, false, photoSet.creditText)).copies;
      const master = set.find((c) => c.slot === "master");
      if (!master) throw new Error("photo set has no 2048 master");
      fullFile = master.file;
      fullDims = { width: master.width, height: master.height };
    }
    if (!set.some((c) => c.slot === "thumb")) throw new Error("photo set has no 600 copy");
  } catch (err) {
    return fellBack(err, type, file);
  }

  const stored = await describeStoredObject(fullFile, fullDims);
  const thumbFile = set.find((c) => c.slot === "thumb")!.file;
  const siblings = set.filter((c) => c.slot !== "master" && c.slot !== "thumb");

  // ── 2. names: the marker only if every sibling lands ──
  const basePath = generateImagePath({ userId, type, ext: "webp", subPath });
  const dims = dimsSuffix(fullDims.width, fullDims.height);
  const marked = basePath.replace(/\.webp$/, `${dims}${keepFull ? PHOTO_SET_FULL_MARKER : PHOTO_SET_MARKER}.webp`);
  const unmarked = basePath.replace(/\.webp$/, `${dims}.webp`);
  const siblingParts = siblings.map((c) => ({ path: rungPath(marked, rungOf(c)), file: c.file }));

  const useS3 = await isS3Enabled().catch(() => false);
  const isPrivate = isPrivateBucket(bucket);

  let markerKept = true;
  try {
    if (useS3) {
      for (let i = 0; i < siblingParts.length; i += 2) {
        const [a, b] = siblingParts.slice(i, i + 2);
        if (b) await uploadPairToS3(a.file, b.file, `${bucket}/${a.path}`, `${bucket}/${b.path}`, isPrivate);
        else await uploadToS3(a.file, `${bucket}/${a.path}`, a.file.name, isPrivate);
      }
    } else {
      await Promise.all(
        siblingParts.map((p) => storageUpload(bucket, p.path, p.file, { upsert, cacheControl, fileName: p.file.name })),
      );
    }
  } catch (err) {
    markerKept = false;
    logger.warn({
      code: "FILE-5012",
      event: "RUNG_UPLOAD_FELL_BACK",
      fn: "uploadPhotoSet",
      file: FILE,
      message: "A copy of the new photo set failed to upload; publishing under the unmarked name instead.",
      reason: err instanceof Error ? err.message : String(err),
      expected: "Every planned copy stored beside the photo",
      actual: "The -l4 / -l4f promise is not published",
      nextStep: "The member's upload succeeds without the extra copies (U5 backfill can add them later). Broad recurrence means presign or R2 trouble — check s3-presign-upload logs.",
      detail: { type, copies: siblingParts.length },
    });
  }

  const fullPath = markerKept ? marked : unmarked;
  const thumbPath = fullPath.replace(/\.webp$/, "-thumb.webp");

  // ── 3. the full (or 2048 master) + the 600 thumb: what the row references ──
  if (useS3) {
    const s3Full = `${bucket}/${fullPath}`;
    const s3Thumb = `${bucket}/${thumbPath}`;
    const { full, thumb } = await uploadPairToS3(fullFile, thumbFile, s3Full, s3Thumb, isPrivate);
    return {
      url: isPrivate ? s3Full : full.url,
      path: full.key,
      thumbnailUrl: isPrivate ? s3Thumb : thumb.url,
      thumbnailPath: thumb.key,
      stored,
    };
  }
  const [fullResult, thumbResult] = await Promise.all([
    storageUpload(bucket, fullPath, fullFile, { upsert, cacheControl, fileName: fullFile.name }),
    storageUpload(bucket, thumbPath, thumbFile, { upsert, cacheControl, fileName: thumbFile.name }),
  ]);
  return {
    url: fullResult.url,
    path: fullResult.path,
    thumbnailUrl: thumbResult.url,
    thumbnailPath: thumbResult.path,
    stored,
  };
}

/**
 * The resumable photo job's encoder for the new set (photoJobs.createPhotoJob):
 * full = credited 2048, thumb = 600, rungs = 1080 / 320 (as planned), marker `-l4`.
 * Throws when the new encoder cannot run; the composer then takes the
 * non-resumable path, which falls back to today's set by itself.
 */
export function photoSetPhotoEncoder(creditTextLine: string): PhotoEncoder {
  return async (file: File): Promise<EncodedPhoto> => {
    const { copies } = needWebp(await encodePhotoSet(file, false, creditTextLine));
    const master = copies.find((c) => c.slot === "master");
    const thumb = copies.find((c) => c.slot === "thumb");
    if (!master || !thumb) throw new Error("photo set is incomplete");
    return {
      full: { blob: master.file, width: master.width, height: master.height },
      thumb: thumb.file,
      rungs: copies.filter((c) => c.slot === "r1080" || c.slot === "r320").map((c) => ({ rung: rungOf(c), blob: c.file })),
      marker: PHOTO_SET_MARKER,
    };
  };
}
