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

/**
 * B4 slice 1 — the PUT itself retries. (Documented defect F3, first half.)
 *
 * Until 2026-08-14 the presign call retried but the UPLOAD did not: one
 * dropped packet on a phone leaving wifi threw immediately, and because the
 * platform's object keys are Date.now()+random, the member's next attempt
 * re-uploaded EVERYTHING under new names — stranding the previous bytes as
 * unreclaimable orphans (F3 + F2 compounding).
 *
 * Retrying the SAME presigned URL is exactly idempotent: same key, same
 * bytes — success after a retry is indistinguishable from success on the
 * first try, and creates nothing extra. Three shapes are retried:
 *   - network failure (fetch TypeError): the classic mid-transfer drop;
 *   - 5xx / 429: R2's problem, not the member's;
 *   - 403 ONCE via `onExpired`: the presign is 300s and a slow photo on slow
 *     cellular can outlive it — the caller re-presigns the SAME path and the
 *     retry PUTs to the same key.
 * 4xx other than 403/429 are NOT retried: the request itself is wrong, and
 * repeating it just repeats the mistake.
 */
async function putWithRetry(
  uploadUrl: string,
  file: File | Blob,
  contentType: string,
  label: string,
  onExpired?: () => Promise<string>,
): Promise<void> {
  let url = uploadUrl;
  let refreshed = false;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt === 1 ? 400 : 1200));
    try {
      const res = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": contentType } });
      if (res.ok) return;
      if (res.status === 403 && onExpired && !refreshed) {
        // Presign likely outlived by the transfer. One fresh URL, same path.
        refreshed = true;
        url = await onExpired();
        lastErr = new Error(`${label} upload got 403; re-presigned and retrying`);
        continue;
      }
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`${label} upload failed (${res.status}); retrying`);
        continue;
      }
      const text = await res.text().catch(() => "");
      throw new Error(`${label} upload failed (${res.status}): ${text.slice(0, 200)}`);
    } catch (e) {
      if (e instanceof TypeError) {
        // Network drop mid-transfer — the retryable case this exists for.
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error(`${label} upload failed after retries`);
}

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

  await putWithRetry(uploadUrl, file, contentType, "Storage", async () => {
    const fresh = await invokePresignWithRetry({ path, contentType, size, private: isPrivate });
    return fresh.uploadUrl as string;
  });

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

  // Each side retries independently; a re-presign refreshes BOTH URLs but
  // each retry PUTs only its own file to its own unchanged key.
  const represign = async () => {
    const fresh = await invokePresignWithRetry({
      path: fullPath, contentType: fullCT, size: fullSize, private: isPrivate,
      pair: { path: thumbPath, contentType: thumbCT, size: thumbSize },
    });
    return fresh as typeof data;
  };
  let freshData: typeof data | null = null;
  await Promise.all([
    putWithRetry(data.uploadUrl, fullFile, fullCT, "Full-res", async () => {
      freshData = freshData ?? (await represign());
      return freshData.uploadUrl as string;
    }),
    putWithRetry(data.pair.uploadUrl, thumbFile, thumbCT, "Thumbnail", async () => {
      freshData = freshData ?? (await represign());
      return freshData.pair.uploadUrl as string;
    }),
  ]);

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
