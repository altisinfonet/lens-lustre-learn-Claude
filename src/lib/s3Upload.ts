import { supabase } from "@/integrations/supabase/client";

interface S3UploadResult {
  url: string;
  key: string;
}

/**
 * Check if S3 storage is enabled via site_settings.
 * Caches the result for 60 seconds to avoid repeated queries.
 */
let cachedS3Enabled: boolean | null = null;
let cacheTime = 0;

export async function isS3Enabled(): Promise<boolean> {
  if (cachedS3Enabled !== null && Date.now() - cacheTime < 60_000) {
    return cachedS3Enabled;
  }
  // Use the secure RPC function that returns only the boolean flag
  // (the raw s3_storage_settings row is hidden from non-admin users by RLS)
  const { data, error } = await supabase.rpc("is_s3_storage_enabled" as any);
  cachedS3Enabled = error ? false : !!(data as any);
  cacheTime = Date.now();
  return cachedS3Enabled;
}

/** Clear the S3 enabled cache (call after admin saves settings) */
export function clearS3Cache() {
  cachedS3Enabled = null;
  cacheTime = 0;
}

/**
 * Upload a file to S3 using a presigned PUT URL.
 * The browser uploads DIRECTLY to R2/S3 — no large body passes through the
 * edge function (which previously caused 502 Bad Gateway on multi-MB photos).
 *
 * @param isPrivate - if true, the returned URL will be the storage key (no public URL)
 */
/**
 * Invoke the presign edge function with retry on transient network errors
 * (worker boot/shutdown thrash → CORS preflight 502 → FunctionsFetchError).
 * Does NOT retry application errors (400/401/etc) returned in `data.error`.
 */
async function invokePresignWithRetry(body: Record<string, unknown>) {
  const delays = [300, 800]; // up to 2 retries
  let lastErr: any;
  let didRefresh = false;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke("s3-presign-upload", { body });
      if (error) {
        const msg = (error as any)?.message || "";
        const status = (error as any)?.context?.status ?? (error as any)?.status;
        const isAuth = status === 401 || status === 403 || /unauthorized|jwt|session/i.test(msg);
        const isNetwork =
          (error as any)?.name === "FunctionsFetchError" ||
          /fetch|network|failed to send/i.test(msg);

        // Stale-session recovery: force one refresh + retry on 401/403.
        if (isAuth && !didRefresh) {
          didRefresh = true;
          try { await supabase.auth.refreshSession(); } catch { /* ignore */ }
          continue; // retry immediately, do not consume an attempt
        }

        if (isNetwork && attempt < delays.length) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
          lastErr = error;
          continue;
        }

        // Last resort on persistent auth failure: sign out so the user gets a
        // clean login instead of every subsequent upload silently 401-ing.
        if (isAuth && didRefresh) {
          try { await supabase.auth.signOut(); } catch { /* ignore */ }
          throw new Error("Your session expired. Please sign in again and retry the upload.");
        }

        throw new Error(msg || "Failed to presign upload");
      }
      if (data?.error) throw new Error(data.error);
      return data;
    } catch (err: any) {
      lastErr = err;
      const isNetwork =
        err?.name === "FunctionsFetchError" || /fetch|network|failed to send/i.test(err?.message || "");
      if (isNetwork && attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("Failed to presign upload");
}

/**
 * Upload a file to S3 using a presigned PUT URL.
 * The browser uploads DIRECTLY to R2/S3 — no large body passes through the
 * edge function (which previously caused 502 Bad Gateway on multi-MB photos).
 *
 * @param isPrivate - if true, the returned URL will be the storage key (no public URL)
 */
export async function uploadToS3(
  file: File | Blob,
  path: string,
  fileName?: string,
  isPrivate = false,
): Promise<S3UploadResult> {
  const contentType =
    (file instanceof File && file.type) ||
    (file instanceof Blob && file.type) ||
    "application/octet-stream";
  const size = (file as any).size ?? 0;

  const data = await invokePresignWithRetry({ path, contentType, size, private: isPrivate });

  const uploadUrl: string = data.uploadUrl;
  const publicUrl: string | null = data.publicUrl;
  const key: string = data.key;

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": contentType },
  });

  if (!putRes.ok) {
    const text = await putRes.text().catch(() => "");
    throw new Error(`Storage upload failed (${putRes.status}): ${text.slice(0, 200)}`);
  }

  return { url: isPrivate ? key : (publicUrl || uploadUrl.split("?")[0]), key };
}

/**
 * Upload TWO files (e.g. full-res + thumbnail) using a SINGLE presign call.
 * Halves edge worker pressure vs two parallel uploadToS3 calls — this prevents
 * the s3-presign-upload boot/shutdown thrash that surfaces as FunctionsFetchError.
 */
export async function uploadPairToS3(
  fullFile: File | Blob,
  thumbFile: File | Blob,
  fullPath: string,
  thumbPath: string,
  isPrivate = false,
): Promise<{ full: S3UploadResult; thumb: S3UploadResult }> {
  const fullCT = (fullFile as any).type || "application/octet-stream";
  const thumbCT = (thumbFile as any).type || "application/octet-stream";
  const fullSize = (fullFile as any).size ?? 0;
  const thumbSize = (thumbFile as any).size ?? 0;

  const data = await invokePresignWithRetry({
    path: fullPath,
    contentType: fullCT,
    size: fullSize,
    private: isPrivate,
    pair: { path: thumbPath, contentType: thumbCT, size: thumbSize },
  });

  if (!data?.pair) throw new Error("Presign did not return pair URLs");

  const [fullPut, thumbPut] = await Promise.all([
    fetch(data.uploadUrl, { method: "PUT", body: fullFile, headers: { "Content-Type": fullCT } }),
    fetch(data.pair.uploadUrl, { method: "PUT", body: thumbFile, headers: { "Content-Type": thumbCT } }),
  ]);

  if (!fullPut.ok) {
    const t = await fullPut.text().catch(() => "");
    throw new Error(`Full-res upload failed (${fullPut.status}): ${t.slice(0, 200)}`);
  }
  if (!thumbPut.ok) {
    const t = await thumbPut.text().catch(() => "");
    throw new Error(`Thumbnail upload failed (${thumbPut.status}): ${t.slice(0, 200)}`);
  }

  return {
    full: {
      url: isPrivate ? data.key : (data.publicUrl || data.uploadUrl.split("?")[0]),
      key: data.key,
    },
    thumb: {
      url: isPrivate ? data.pair.key : (data.pair.publicUrl || data.pair.uploadUrl.split("?")[0]),
      key: data.pair.key,
    },
  };
}
