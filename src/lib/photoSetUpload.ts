/**
 * PHOTO SET UPLOAD — photo plan U1b + Unit A, behind switch `photo_set_v2`.
 *
 * Reached only through uploadImageWithThumbnail when the caller passes
 * `photoSet` (switch on for the uploading member). Names and copies are defined
 * in imageLadder.ts (PHOTO SETS, v3); the canvas work is photoSetEncode.ts.
 *
 *   POST         (Owner order, 4 Nov 2026 — EVERY feed post, no switch) encode
 *                the ORIGINAL once → the FEED SET, exactly 3 WebP files:
 *                `<uid>/posts/<seg>-w{W}h{H}-l6.webp` (2048, the URL) + `-r1080`
 *                + `-thumb` (600). No credit, no private copy, no 320: the
 *                credit is drawn in the browser on save (photoCreditSave.ts).
 *   COMPETITION  the full-size file exactly as today (a caller-encoded WebP that
 *                metadataFreeWebp proves clean is uploaded as is; anything else is
 *                encoded at full size, q0.92, as today) → plus
 *                clean -r1080 (always), 600 / 320 and the private clean 2048
 *                `<uid>/competitions/<seg>-w{W}h{H}-l5f.webp`
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
import { FEED_PHOTO_MARKER, PHOTO_SET_V3_FULL_MARKER, photoSetSuffix } from "@/lib/imageLadder";
import { dimsSuffix } from "@/lib/imageFrame";
import { logger } from "@/lib/logger";
import { describeStoredObject } from "@/lib/media/storedObject";
import { encodeFeedPhotoSet, encodePhotoSet, type EncodedPhotoSet, type EncodedSetCopy } from "@/lib/photoSetEncode";
import { feedPhotoEncoder } from "@/lib/feedPhotoEncoder";
import {
  generateImagePath, isPrivateBucket, shouldUpsert,
  type UploadWithThumbnailOptions, type UploadWithThumbnailResult,
} from "@/lib/imageUpload";
import type { PhotoEncoder } from "@/lib/upload/photoJobs";

const FILE = "src/lib/photoSetUpload.ts";

/**
 * The ONE way a caller turns the switch answer into upload options:
 * `{ ...photoSetOption(allowed) }` adds NO key when the switch is off,
 * so the switch-off call is literally today's call.
 */
export function photoSetOption(allowed: boolean): { photoSet?: true } {
  return allowed ? { photoSet: true } : {};
}

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
  opts: UploadWithThumbnailOptions,
): Promise<UploadWithThumbnailResult | null> {
  const { bucket, file, type, userId, subPath, cacheControl, encoded } = opts;
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
      set = needWebp(await encodePhotoSet(fullFile, true)).copies;
    } else {
      set = needWebp(await encodeFeedPhotoSet(file)).copies;
      const master = set.find((c) => c.slot === "master");
      if (!master) throw new Error("feed photo set has no 2048 master");
      fullFile = master.file;
      fullDims = { width: master.width, height: master.height };
    }
    if (!set.some((c) => c.slot === "thumb")) throw new Error("photo set has no 600 copy");
  } catch (err) {
    return fellBack(err, type, file);
  }

  const stored = await describeStoredObject(fullFile, fullDims);
  const thumbFile = set.find((c) => c.slot === "thumb")!.file;
  const clean2048 = set.find((c) => c.slot === "clean2048")?.file ?? null;
  const siblings = set.filter((c) => c.slot !== "master" && c.slot !== "thumb" && !c.private);

  // ── 2. names: the marker only if every PUBLIC sibling lands ──
  const basePath = generateImagePath({ userId, type, ext: "webp", subPath });
  const dims = dimsSuffix(fullDims.width, fullDims.height);
  const marked = basePath.replace(/\.webp$/, `${dims}${keepFull ? PHOTO_SET_V3_FULL_MARKER : FEED_PHOTO_MARKER}.webp`);
  const unmarked = basePath.replace(/\.webp$/, `${dims}.webp`);
  const siblingParts = siblings.map((c) => ({ path: marked.replace(/\.webp$/, `${photoSetSuffix(c.slot)}.webp`), file: c.file }));

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
      actual: "The -l5 / -l5f promise is not published",
      nextStep: "The member's upload succeeds without the extra copies (U5 backfill can add them later). Broad recurrence means presign or R2 trouble — check s3-presign-upload logs.",
      detail: { type, copies: siblingParts.length },
    });
  }

  const fullPath = markerKept ? marked : unmarked;
  const thumbPath = fullPath.replace(/\.webp$/, "-thumb.webp");

  // Unit A: the private clean 2048 (the source of the server's credit, and of any
  // later redraw; never public). Only a marked set promises one. It goes AFTER
  // the public files: the route keeps a clean copy only for a stored photo. Best
  // effort: a refusal or a lost connection never costs the member the post (the
  // server then draws the credit on the public clean file).
  const keepCleanCopy = async () => {
    if (!markerKept || !clean2048) return;
    try {
      const { storeCleanCopy } = await import("@/lib/media/cleanCopyClient");
      await storeCleanCopy(`${bucket}/${marked}`, clean2048);
    } catch (err) {
      logger.warn({
        code: "FILE-5015",
        event: "PHOTO_CLEAN_COPY_REFUSED",
        fn: "uploadPhotoSet",
        file: FILE,
        message: "The private clean 2048 of a new photo could not be sent; the post itself is fine.",
        reason: err instanceof Error ? err.message : String(err),
        expected: "201 stored from /api/media/clean-copy",
        actual: "network failure",
        nextStep: "Nothing a member sees changes. Recurring: check the lane's Pages MEDIA binding and the route.",
        detail: { type },
      });
    }
  };

  // ── 3. the full (or the clean 1080 master) + the 600 thumb: what the row references ──
  if (useS3) {
    const s3Full = `${bucket}/${fullPath}`;
    const s3Thumb = `${bucket}/${thumbPath}`;
    const { full, thumb } = await uploadPairToS3(fullFile, thumbFile, s3Full, s3Thumb, isPrivate);
    await keepCleanCopy();
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
  await keepCleanCopy();
  return {
    url: fullResult.url,
    path: fullResult.path,
    thumbnailUrl: thumbResult.url,
    thumbnailPath: thumbResult.path,
    stored,
  };
}

/**
 * The resumable photo job's encoder — since the Owner's order of 4 Nov 2026 the
 * SAME feed set as every other feed post (photoSetEncode.feedPhotoEncoder:
 * 2048 + 1080 + 600 under `-l6`, nothing credited, nothing private), whatever
 * the switch answer. Kept as a function so existing callers stay as they are.
 */
export function photoSetPhotoEncoder(): PhotoEncoder {
  return feedPhotoEncoder;
}
