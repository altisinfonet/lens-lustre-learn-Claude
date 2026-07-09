import { supabase } from "@/integrations/supabase/client";
import { isS3Enabled, uploadToS3 } from "@/lib/s3Upload";

interface StorageUploadResult {
  url: string;
  path: string;
}

/** Buckets that contain sensitive/private files */
const PRIVATE_BUCKETS = ["national-ids", "support-attachments"];

let _s3Enabled: boolean | null = null;
let _s3CheckTime = 0;

/** Cached check for S3 enabled status */
async function checkS3(): Promise<boolean> {
  if (_s3Enabled !== null && Date.now() - _s3CheckTime < 60_000) return _s3Enabled;
  _s3Enabled = await isS3Enabled();
  _s3CheckTime = Date.now();
  return _s3Enabled;
}

/**
 * Upload a file to external S3 (if enabled) or default Supabase storage.
 * Returns { url, path } where path is the storage key.
 * For private buckets, url will be the storage path (not a public URL).
 */
export async function storageUpload(
  bucket: string,
  path: string,
  file: File | Blob,
  options?: { upsert?: boolean; cacheControl?: string; fileName?: string }
): Promise<StorageUploadResult> {
  const useS3 = await checkS3();
  const isPrivate = PRIVATE_BUCKETS.includes(bucket);

  if (useS3) {
    const s3Path = `${bucket}/${path}`;
    const fileName = options?.fileName || (file instanceof File ? file.name : path.split("/").pop() || "file");
    const result = await uploadToS3(file, s3Path, fileName, isPrivate);
    // For private files, store path instead of URL
    return { url: isPrivate ? s3Path : result.url, path: s3Path };
  }

  // Default Supabase storage
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: options?.upsert,
    cacheControl: options?.cacheControl,
  });
  if (error) throw error;

  if (isPrivate) {
    // Don't return public URL for private buckets - return the path
    return { url: path, path };
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { url: data.publicUrl, path };
}


/**
 * Delete file(s) from storage.
 * Routes through S3 edge function when S3 is enabled, otherwise uses Supabase storage.
 */
export async function storageRemove(bucket: string, paths: string[]): Promise<void> {
  const useS3 = await checkS3();

  if (useS3) {
    // Build full S3 keys: bucket/path
    const s3Paths = paths.map((p) => `${bucket}/${p}`);
    const { error, data } = await supabase.functions.invoke("s3-delete", {
      body: { paths: s3Paths },
    });
    if (error) {
      console.error("S3 delete failed:", error);
      // Don't throw — deletion is best-effort cleanup
    }
    if (data?.error) {
      console.error("S3 delete error:", data.error);
    }
    return;
  }

  await supabase.storage.from(bucket).remove(paths);
}

/**
 * Get public URL for a file in storage (public buckets only).
 * When S3 is enabled, returns the stored URL directly (already a full R2/S3 URL).
 * When using Supabase storage, generates the public URL from the bucket.
 */
export function storageGetPublicUrl(bucket: string, path: string): string {
  // If the path is already a full URL (S3/R2), return it directly
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * List files in a storage bucket/folder.
 * When S3 is enabled, returns null (gallery browsing not supported).
 * Components should hide the gallery button when this returns null.
 */
export async function storageList(
  bucket: string,
  folder: string,
  options?: { limit?: number; sortBy?: { column: string; order: string } }
): Promise<{ name: string; id?: string; metadata?: Record<string, any>; created_at?: string }[] | null> {
  const useS3 = await checkS3();

  if (useS3) {
    // S3 listing requires a dedicated edge function — not yet implemented.
    // Return null to signal callers to disable the gallery UI.
    return null;
  }

  const { data, error } = await supabase.storage.from(bucket).list(folder, {
    limit: options?.limit ?? 60,
    sortBy: options?.sortBy as any,
  });

  if (error) {
    console.error("Storage list error:", error);
    return [];
  }

  return (data || []).map((f) => ({
    name: f.name,
    id: f.id,
    metadata: f.metadata as Record<string, any> | undefined,
    created_at: f.created_at,
  }));
}

/**
 * Get a signed/temporary URL for a private file.
 * Works for both Supabase storage and S3 (via edge function).
 * @param bucket - storage bucket name
 * @param path - file path within the bucket (or full S3 key for S3)
 * @param expiresIn - seconds until URL expires (default 900 = 15 min)
 */
export async function storageGetSignedUrl(
  bucket: string,
  path: string,
  expiresIn = 900
): Promise<string> {
  const useS3 = await checkS3();

  if (useS3) {
    // Use edge function to generate presigned S3 URL
    const s3Path = path.startsWith(`${bucket}/`) ? path : `${bucket}/${path}`;
    const { data, error } = await supabase.functions.invoke("s3-signed-url", {
      body: { path: s3Path },
    });
    if (error) throw new Error(error.message || "Failed to get signed URL");
    if (data?.error) throw new Error(data.error);
    return data.url;
  }

  // Default Supabase storage signed URL
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}
