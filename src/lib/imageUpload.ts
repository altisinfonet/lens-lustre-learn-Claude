import { storageUpload } from "@/lib/storageUpload";
import { isS3Enabled, uploadPairToS3 } from "@/lib/s3Upload";
import { compressThumbnail, compressImageToFiles } from "@/lib/imageCompression";

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
}

/**
 * Upload a full-resolution image AND a 600px thumbnail in parallel.
 *
 * • Full-res: original resolution, WebP at 0.92 quality.
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

  const fullPath = generateImagePath({ userId, type, ext, subPath });
  // Thumbnail path mirrors full path with "-thumb" suffix before extension
  const thumbPath = fullPath.replace(`.${ext}`, `-thumb.${ext}`);

  const baseName = file.name.replace(/\.[^.]+$/, "");

  // Encode to WebP (q=0.92), aligned with the platform-wide WebP-only strategy.
  // PERF: wall/feed posts are capped at 2560px — encoding + uploading a full
  // 50MP camera photo made posting take many seconds (worst on mobile webviews).
  // 2560px is sharper than any feed/lightbox render. Competition entries and
  // every other image type keep original resolution.
  const maxDimension = type === "post" ? 2560 : undefined;
  let fullResFile: File;
  try {
    const { webpFile } = await compressImageToFiles(
      file,
      baseName,
      maxDimension ? { maxDimension } : undefined,
    );
    fullResFile = webpFile;
  } catch (err) {
    console.warn("Full-res WebP encoding failed, uploading original:", err);
    fullResFile = file;
  }

  // Attempt thumbnail compression
  let thumbnailFile: File;
  try {
    const { webpFile } = await compressThumbnail(file, baseName);
    thumbnailFile = webpFile;
  } catch (err) {
    console.warn("Thumbnail generation failed, using full-res as fallback:", err);
    // Upload full-res only, return same URL for both
    const fullResult = await storageUpload(bucket, fullPath, fullResFile, {
      upsert,
      cacheControl,
      fileName: fullResFile.name,
    });
    return {
      url: fullResult.url,
      path: fullResult.path,
      thumbnailUrl: fullResult.url,
      thumbnailPath: fullResult.path,
    };
  }

  // Upload full-res and thumbnail. When S3 is enabled, use a SINGLE presign
  // call for both files (halves edge worker pressure → no FunctionsFetchError).
  // When S3 is disabled, fall back to parallel Supabase storage uploads.
  const useS3 = await isS3Enabled().catch(() => false);

  if (useS3) {
    const isPrivate = PRIVATE_BUCKETS.has(bucket);
    const s3FullPath = `${bucket}/${fullPath}`;
    const s3ThumbPath = `${bucket}/${thumbPath}`;
    const { full, thumb } = await uploadPairToS3(
      fullResFile,
      thumbnailFile,
      s3FullPath,
      s3ThumbPath,
      isPrivate,
    );
    return {
      url: isPrivate ? s3FullPath : full.url,
      path: full.key,
      thumbnailUrl: isPrivate ? s3ThumbPath : thumb.url,
      thumbnailPath: thumb.key,
    };
  }

  const [fullResult, thumbResult] = await Promise.all([
    storageUpload(bucket, fullPath, fullResFile, {
      upsert,
      cacheControl,
      fileName: fullResFile.name,
    }),
    storageUpload(bucket, thumbPath, thumbnailFile, {
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
  };
}

