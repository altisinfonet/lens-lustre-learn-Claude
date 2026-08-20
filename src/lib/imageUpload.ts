import { storageUpload } from "@/lib/storageUpload";
import { isS3Enabled, uploadPairToS3 } from "@/lib/s3Upload";
import { compressThumbnail, compressImageToFiles } from "@/lib/imageCompression";
import { guardOriginalUpload } from "@/lib/gpsGuard";
import { LADDER_MARKER, RUNG_QUALITY, rungPath, rungPlan } from "@/lib/imageLadder";
import { dimsSuffix } from "@/lib/imageFrame";
import { logger } from "@/lib/logger";
import { describeStoredObject, type StoredObjectFacts } from "@/lib/media/storedObject";

const FILE = "src/lib/imageUpload.ts";

const PRIVATE_BUCKETS = new Set(["national-ids", "support-attachments"]);

/** Result from a storage upload operation */
export interface ImageUploadResult {
  url: string;
  path: string;
}

/* ------------------------------------------------------------------ */
/*  PATH GENERATION                                                    */
/* ------------------------------------------------------------------ */

export type ImagePathType =
  | "avatar"
  | "cover"
  | "post"
  | "competition"
  | "gallery"
  | "my-photo"
  | "inline"
  | "journal"
  | "journal-cover"
  | "featured-artist"
  | "featured"
  | "course-cover"
  | "comp-cover"
  | "banner"
  | "potd"
  | "judging-tag"
  | "certificate-template"
  | "ad"
  | "seo"
  | "support"
  | "staff-id";

interface GeneratePathOptions {
  /** Required for user-scoped paths */
  userId?: string;
  /** Image category */
  type: ImagePathType;
  /** File extension without dot (e.g. "webp", "jpg") */
  ext: string;
  /** Optional extra context (e.g. album ID) */
  subPath?: string;
}

/** Deterministic unique segment for content images */
function uniqueSegment(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Generate a storage path for an image upload.
 *
 * PROFILE images → fixed slot (supports upsert/overwrite)
 * CONTENT images → unique timestamp-random (never collides)
 * SYSTEM  images → unique timestamp-random in a shared folder
 */
export function generateImagePath(opts: GeneratePathOptions): string {
  const { userId, type, ext, subPath } = opts;

  switch (type) {
    /* ── Profile (fixed-slot, mutable) ── */
    case "avatar":
      if (!userId) throw new Error("userId required for avatar path");
      return `${userId}/avatar.${ext}`;

    case "cover":
      if (!userId) throw new Error("userId required for cover path");
      return `${userId}/cover.${ext}`;

    /* ── Content (unique, immutable) ── */
    case "post":
      if (!userId) throw new Error("userId required for post path");
      return `${userId}/posts/${uniqueSegment()}.${ext}`;

    case "competition":
      if (!userId) throw new Error("userId required for competition path");
      return `${userId}/competitions/${uniqueSegment()}.${ext}`;

    case "gallery":
      return `gallery/${uniqueSegment()}.${ext}`;

    case "my-photo":
      if (!userId) throw new Error("userId required for my-photo path");
      return `${userId}/my-photos/${subPath ? `${subPath}/` : ""}${uniqueSegment()}.${ext}`;

    case "inline":
      return `inline/${uniqueSegment()}.${ext}`;

    case "journal":
      return `${subPath ? `${subPath}/` : "journal/"}${uniqueSegment()}.${ext}`;

    case "journal-cover":
      return `covers/${uniqueSegment()}.${ext}`;

    case "featured-artist":
      return `featured-artists/${uniqueSegment()}.${ext}`;

    case "featured":
      if (!userId) throw new Error("userId required for featured path");
      return `featured/${userId}/${uniqueSegment()}.${ext}`;

    case "course-cover":
      return `courses/${uniqueSegment()}.${ext}`;

    case "comp-cover":
      return `covers/${uniqueSegment()}.${ext}`;

    case "banner":
      return `banners/${uniqueSegment()}.${ext}`;

    case "potd":
      return `potd/${uniqueSegment()}.${ext}`;

    case "judging-tag":
      return `judging-tags/${uniqueSegment()}.${ext}`;

    case "certificate-template":
      return `certificates/${subPath || uniqueSegment()}.${ext}`;

    /* ── System (unique, shared folder) ── */
    case "ad":
      return `ads/${uniqueSegment()}.${ext}`;

    case "seo":
      return `seo/${uniqueSegment()}.${ext}`;

    case "support":
      if (!userId) throw new Error("userId required for support path");
      return `${userId}/${uniqueSegment()}.${ext}`;

    case "staff-id":
      return `staff-ids/${uniqueSegment()}.${ext}`;

    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown image path type: ${_exhaustive}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  UPSERT POLICY                                                      */
/* ------------------------------------------------------------------ */

/** Types where overwriting the previous file is expected */
const UPSERT_TYPES: ReadonlySet<ImagePathType> = new Set([
  "avatar",
  "cover",
  "certificate-template",
]);

/**
 * Returns true if this image type should overwrite existing files.
 * Content images must NEVER overwrite.
 */
export function shouldUpsert(type: ImagePathType): boolean {
  return UPSERT_TYPES.has(type);
}

/* ------------------------------------------------------------------ */
/*  UPLOAD WRAPPER                                                     */
/* ------------------------------------------------------------------ */

interface UploadImageOptions {
  /** Storage bucket name */
  bucket: string;
  /** File or Blob to upload */
  file: File | Blob;
  /** Pre-generated storage path (use generateImagePath) */
  path: string;
  /** Image path type — used to determine upsert policy */
  type: ImagePathType;
  /** Override upsert decision (use with caution) */
  upsertOverride?: boolean;
  /** Cache-Control header */
  cacheControl?: string;
  /** Original file name for Content-Disposition */
  fileName?: string;
}

/**
 * Upload an image using the centralized storage layer.
 *
 * Automatically applies the correct upsert policy based on image type.
 * Uses `storageUpload` which handles S3 vs Supabase routing.
 */
export async function uploadImage(opts: UploadImageOptions): Promise<ImageUploadResult> {
  const { bucket, file, path, type, upsertOverride, cacheControl, fileName } = opts;
  const upsert = upsertOverride ?? shouldUpsert(type);

  return storageUpload(bucket, path, file, {
    upsert,
    cacheControl,
    fileName,
  });
}

/* ------------------------------------------------------------------ */
/*  THUMBNAIL-AWARE UPLOAD                                             */
/* ------------------------------------------------------------------ */

interface UploadWithThumbnailOptions {
  /** Storage bucket name */
  bucket: string;
  /** Original File to upload */
  file: File;
  /** Image path type — determines upsert policy & path structure */
  type: ImagePathType;
  /** User ID (required for user-scoped paths) */
  userId?: string;
  /** Optional sub-path context (e.g. album ID) */
  subPath?: string;
  /** Cache-Control header */
  cacheControl?: string;
}

interface UploadWithThumbnailResult {
  /** Full-resolution image URL */
  url: string;
  /** Full-resolution storage path */
  path: string;
  /** 600px max-dimension WebP thumbnail URL */
  thumbnailUrl: string;
  /** Thumbnail storage path */
  thumbnailPath: string;
  /**
   * What was ACTUALLY stored — the fingerprint, size and dimensions of the
   * encoded bytes that went to R2, not of the file the member picked. This is
   * the declaration `media_begin_upload` takes and `media-register-upload`
   * re-derives from the stored object.
   *
   * ⚠ null means the encoder could not report dimensions and they could not be
   * measured. The caller must then keep that slide on the legacy path rather
   * than declare something it does not know: a FALSE declaration quarantines
   * the member's photograph, which is terminal. See storedObject.ts.
   */
  stored: StoredObjectFacts | null;
}

/**
 * Upload a full-resolution image AND a 600px thumbnail in parallel.
 *
 * • Full-res: original resolution, WebP at 0.92 quality (zoom/download master).
 * • Rungs (1080/1440, posts): WebP at RUNG_QUALITY 0.82 — the display tier (B3d-4).
 * • Thumbnail: max 600px dimension, WebP at 0.7 quality.
 * • Both paths share the same unique segment to keep them paired.
 * • If thumbnail generation fails, falls back to full-res URL for both
 *   (guarantees no broken images).
 */
export async function uploadImageWithThumbnail(
  opts: UploadWithThumbnailOptions
): Promise<UploadWithThumbnailResult> {
  const { bucket, file, type, userId, subPath, cacheControl } = opts;
  const upsert = shouldUpsert(type);

  const ext = "webp";

  const baseName = file.name.replace(/\.[^.]+$/, "");

  // Encode to WebP (q=0.92), aligned with the platform-wide WebP-only strategy.
  // PERF: wall/feed posts are capped at 2560px — encoding + uploading a full
  // 50MP camera photo made posting take many seconds (worst on mobile webviews).
  // 2560px is sharper than any feed/lightbox render. Competition entries and
  // every other image type keep original resolution.
  const maxDimension = type === "post" ? 2560 : undefined;
  let fullResFile: File;
  let encodedDims: { width: number; height: number } | null = null;
  try {
    const { webpFile, width, height } = await compressImageToFiles(
      file,
      baseName,
      maxDimension ? { maxDimension } : undefined,
    );
    fullResFile = webpFile;
    encodedDims = { width, height };
  } catch (err) {
    logger.warn({
      code: "FILE-5004",
      event: "FULL_RES_ENCODE_FELL_BACK",
      fn: "uploadImage",
      file: FILE,
      message: "WebP encoding of the full-size photograph failed; the original is being uploaded instead.",
      reason: err instanceof Error ? err.message : String(err),
      expected: "A WebP encode of the selected file",
      actual: "The original file, unconverted",
      nextStep:
        "The member's upload still SUCCEEDS — it is only larger. Check the file type in the detail against what the browser's encoder accepts before treating this as a failure.",
      detail: { fileType: file.type, fileSizeBytes: file.size },
    });
    // ⚠ THE ONE DOOR GPS COULD STILL WALK THROUGH. Every successful upload is
    // canvas-re-encoded, which strips metadata as a side effect — so the ONLY
    // files that reach the CDN with their metadata intact are exactly the ones
    // that land in this fallback. Gate them: clean JPEGs pass, strippable ones
    // are spliced, and a GPS-carrying file we cannot clean is REFUSED rather
    // than published with the member's location. Throws GpsPrivacyError with
    // member-readable copy; callers surface it like any upload failure.
    fullResFile = await guardOriginalUpload(file);
  }

  // Measured HERE, from the encoded file, because this is the last moment the
  // bytes that are about to be uploaded exist in one place. Every return below
  // carries it. See storedObject.ts for why hashing `file` instead would
  // quarantine every upload.
  const stored = await describeStoredObject(fullResFile, encodedDims);

  // ── Dimensions in the filename (posts only, 2026-08-01) ──
  // The feed sizes a post's frame BEFORE the image loads; reading naturalWidth
  // on load instead would reflow every card as it decodes. Carrying w×h in the
  // path means no column on `posts` and, more importantly, no change to
  // `get_broadcast_feed` — the riskiest RPC here — for a presentation detail.
  // Scoped to `post` deliberately: competition entries and the gallery have
  // their own display rules and are not part of this change.
  // If encoding failed we have no dimensions; the suffix is omitted and the
  // card falls back to 4:5, exactly as every pre-2026-08-01 post does.
  // Path generation must therefore happen AFTER encoding, not before.
  const basePath = generateImagePath({ userId, type, ext, subPath });
  // B3d-1: which stored rungs this image honestly supports (no upscaling —
  // an image narrower than a rung has no honest derivative at that rung).
  // Rungs are a POST feature: they exist for the feed ladder. Other types
  // keep their existing single-file behaviour.
  const plannedRungs = type === "post" && encodedDims ? rungPlan(encodedDims.width, encodedDims.height) : [];
  const fullPath =
    type === "post" && encodedDims
      ? basePath.replace(
          new RegExp(`\\.${ext}$`),
          // The `-l3` marker is a PROMISE that rung files exist beside this
          // one — the renderer offers rung URLs purely from the name. It is
          // only added when rungs are planned, and the upload code below
          // falls back to an unmarked name if rung upload fails, so the
          // promise is never published unkept.
          `${dimsSuffix(encodedDims.width, encodedDims.height)}${plannedRungs.length > 0 ? LADDER_MARKER : ""}.${ext}`,
        )
      : basePath;
  // Thumbnail path mirrors full path with "-thumb" suffix before extension
  const thumbPath = fullPath.replace(`.${ext}`, `-thumb.${ext}`);

  // Attempt thumbnail compression
  let thumbnailFile: File;
  try {
    const { webpFile } = await compressThumbnail(file, baseName);
    thumbnailFile = webpFile;
  } catch (err) {
    logger.warn({
      code: "FILE-5004",
      event: "THUMBNAIL_FELL_BACK",
      fn: "uploadImage",
      file: FILE,
      message: "Thumbnail generation failed; the full-size photograph will be served in its place.",
      reason: err instanceof Error ? err.message : String(err),
      expected: "A small thumbnail beside the full-size upload",
      actual: "One full-size file used for both",
      nextStep:
        "Nothing is broken for the member, but every grid and feed showing this photo now downloads the full-size file. Repeated hits are a real cost on mobile data.",
      detail: { fileType: file.type, fileSizeBytes: file.size },
    });
    // Upload full-res only, return same URL for both.
    // ⚠ The ladder marker is a promise of rung files; this path uploads NO
    // rungs (thumbnail generation failed, so rung generation is not trusted
    // either). Strip the marker so the published name promises nothing.
    const unmarkedFullPath = fullPath.replace(`${LADDER_MARKER}.${ext}`, `.${ext}`);
    const fullResult = await storageUpload(bucket, unmarkedFullPath, fullResFile, {
      upsert,
      cacheControl,
      fileName: fullResFile.name,
    });
    return {
      url: fullResult.url,
      path: fullResult.path,
      thumbnailUrl: fullResult.url,
      thumbnailPath: fullResult.path,
      stored,
    };
  }

  // ── B3d-1: generate the stored rungs (1080/1440) the plan promised. ──
  // Each is one more canvas export of pixels we already decoded. A rung that
  // fails to ENCODE is dropped from the plan (and if all drop, the marker is
  // removed below); a rung that fails to UPLOAD falls back the same way — the
  // `-l3` name is only ever published with its files actually in the store.
  const rungFiles: { rung: number; file: File }[] = [];
  for (const rung of plannedRungs) {
    try {
      // B3d-4: rungs are display copies — encode at the measured display
      // quality (RUNG_QUALITY), not the 0.92 master default, or each rung
      // ships ~2× the bytes the ladder was sized around.
      const { webpFile } = await compressImageToFiles(file, `${baseName}-r${rung}`, {
        maxDimension: rung,
        webpQuality: RUNG_QUALITY,
      });
      rungFiles.push({ rung, file: webpFile });
    } catch (err) {
      logger.warn({
        code: "FILE-5011",
        event: "RUNG_ENCODE_FELL_BACK",
        fn: "uploadImage",
        file: FILE,
        message: `The ${rung}px rung failed to encode; this photo ships without it.`,
        reason: err instanceof Error ? err.message : String(err),
        expected: `A ${rung}px WebP beside the original`,
        actual: "No rung at this size",
        nextStep:
          "The member's post still succeeds; screens that wanted this size use the next larger file. Investigate only if this fires broadly.",
        detail: { fileType: file.type, rung },
      });
    }
  }
  // Publishing a marker whose files failed would 404 every feed render of
  // this post. Strip the promise instead — the post simply behaves legacy.
  const publishMarker = plannedRungs.length > 0 && rungFiles.length === plannedRungs.length;
  const finalFullPath = publishMarker ? fullPath : fullPath.replace(`${LADDER_MARKER}.${ext}`, `.${ext}`);
  const finalThumbPath = publishMarker ? thumbPath : thumbPath.replace(`${LADDER_MARKER}-thumb.${ext}`, `-thumb.${ext}`);

  // Upload full-res and thumbnail. When S3 is enabled, use a SINGLE presign
  // call for both files (halves edge worker pressure → no FunctionsFetchError).
  // When S3 is disabled, fall back to parallel Supabase storage uploads.
  const useS3 = await isS3Enabled().catch(() => false);

  if (useS3) {
    const isPrivate = PRIVATE_BUCKETS.has(bucket);
    // Rungs go FIRST: if they cannot land, the marker comes off and the
    // full+thumb upload proceeds under the unmarked (legacy) name — a kept
    // promise or no promise, never a broken one. The existing pair-presign is
    // reused (two rungs = one pair), so no edge-function change is needed.
    let s3FullPath = `${bucket}/${publishMarker ? fullPath : finalFullPath}`;
    let s3ThumbPath = `${bucket}/${publishMarker ? thumbPath : finalThumbPath}`;
    let markerKept = publishMarker;
    if (publishMarker && rungFiles.length === 2) {
      try {
        await uploadPairToS3(
          rungFiles[0].file,
          rungFiles[1].file,
          rungPath(s3FullPath, rungFiles[0].rung),
          rungPath(s3FullPath, rungFiles[1].rung),
          isPrivate,
        );
      } catch (err) {
        logger.warn({
          code: "FILE-5012",
          event: "RUNG_UPLOAD_FELL_BACK",
          fn: "uploadImage",
          file: FILE,
          message: "Rung upload failed; publishing under the unmarked name instead.",
          reason: err instanceof Error ? err.message : String(err),
          expected: "Both rungs stored beside the original",
          actual: "No rungs stored; legacy naming used",
          nextStep: "The member's post succeeds without rungs. Broad recurrence means presign or R2 trouble — check s3-presign-upload logs.",
          detail: { fileType: file.type },
        });
        markerKept = false;
        s3FullPath = `${bucket}/${fullPath.replace(`${LADDER_MARKER}.${ext}`, `.${ext}`)}`;
        s3ThumbPath = `${bucket}/${thumbPath.replace(`${LADDER_MARKER}-thumb.${ext}`, `-thumb.${ext}`)}`;
      }
    } else if (publishMarker && rungFiles.length === 1) {
      // One-rung plans (width between 1080 and 1440) still promise via the
      // marker; a single rung uploads alone.
      try {
        const { uploadToS3 } = await import("@/lib/s3Upload");
        await uploadToS3(rungFiles[0].file, rungPath(s3FullPath, rungFiles[0].rung), rungFiles[0].file.name, isPrivate);
      } catch (err) {
        markerKept = false;
        s3FullPath = `${bucket}/${fullPath.replace(`${LADDER_MARKER}.${ext}`, `.${ext}`)}`;
        s3ThumbPath = `${bucket}/${thumbPath.replace(`${LADDER_MARKER}-thumb.${ext}`, `-thumb.${ext}`)}`;
        logger.warn({
          code: "FILE-5012",
          event: "RUNG_UPLOAD_FELL_BACK",
          fn: "uploadImage",
          file: FILE,
          message: "Single-rung upload failed; publishing under the unmarked name instead.",
          reason: err instanceof Error ? err.message : String(err),
          expected: "The rung stored beside the original",
          actual: "No rung stored; legacy naming used",
          nextStep: "See FILE-5012 above.",
          detail: { fileType: file.type },
        });
      }
    }
    const { full, thumb } = await uploadPairToS3(
      fullResFile,
      thumbnailFile,
      s3FullPath,
      s3ThumbPath,
      isPrivate,
    );
    void markerKept;
    return {
      url: isPrivate ? s3FullPath : full.url,
      path: full.key,
      thumbnailUrl: isPrivate ? s3ThumbPath : thumb.url,
      thumbnailPath: thumb.key,
      stored,
    };
  }

  // Supabase-storage path (S3 disabled): same promise rule.
  let fbFullPath = finalFullPath;
  let fbThumbPath = finalThumbPath;
  if (publishMarker) {
    try {
      await Promise.all(
        rungFiles.map(({ rung, file: rf }) =>
          storageUpload(bucket, rungPath(fullPath, rung), rf, { upsert, cacheControl, fileName: rf.name }),
        ),
      );
      fbFullPath = fullPath;
      fbThumbPath = thumbPath;
    } catch {
      fbFullPath = fullPath.replace(`${LADDER_MARKER}.${ext}`, `.${ext}`);
      fbThumbPath = thumbPath.replace(`${LADDER_MARKER}-thumb.${ext}`, `-thumb.${ext}`);
    }
  }
  const [fullResult, thumbResult] = await Promise.all([
    storageUpload(bucket, fbFullPath, fullResFile, {
      upsert,
      cacheControl,
      fileName: fullResFile.name,
    }),
    storageUpload(bucket, fbThumbPath, thumbnailFile, {
      upsert,
      cacheControl,
      fileName: thumbnailFile.name,
    }),
  ]);

  return {
    url: fullResult.url,
    path: fullResult.path,
    thumbnailUrl: thumbResult.url,
    thumbnailPath: thumbResult.path,
    stored,
  };
}

