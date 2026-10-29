/**
 * S11 · what a presigned PUT may carry (s3-presign-upload). Pure, no Deno.
 *
 * Before 2026-10-29 the photo presign signed only `host` and skipped the size
 * check when the client sent no size: any signed-in member could PUT an object
 * of any size and any Content-Type (text/html included) into their own prefix,
 * served from the public CDN. Video uploads already signed content-length.
 *
 * Now the declared size and type are VALIDATED here and SIGNED into the URL
 * (content-length + content-type), so storage refuses a PUT whose body length
 * or Content-Type differs from what was declared.
 */

export const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

const ALLOWED: RegExp[] = [
  // raster images only — never image/svg+xml (a document that runs script)
  /^image\/(jpeg|jpg|pjpeg|png|webp|gif|avif|heic|heif|bmp|tiff)$/,
  /^video\/[a-z0-9][a-z0-9.+-]{0,60}$/,
  /^audio\/[a-z0-9][a-z0-9.+-]{0,60}$/,
  /^application\/pdf$/,
  /^application\/msword$/,
  /^application\/vnd\.ms-excel$/,
  /^application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)$/,
  // files the browser could not type: stored and served as a download
  /^application\/octet-stream$/,
];

export type Declaration =
  | { ok: true; size: number; contentType: string }
  | { ok: false; status: 400 | 413 | 415; error: string };

export function validateUploadDeclaration(size: unknown, contentType: unknown, label = "File"): Declaration {
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    return { ok: false, status: 400, error: `${label} size must be declared (a whole number of bytes above 0)` };
  }
  if (size > UPLOAD_MAX_BYTES) return { ok: false, status: 413, error: `${label} too large (max 50MB)` };
  const ct = typeof contentType === "string" && contentType.trim() ? contentType.trim().toLowerCase() : "application/octet-stream";
  if (!ALLOWED.some((r) => r.test(ct))) return { ok: false, status: 415, error: `${label} type not allowed` };
  return { ok: true, size, contentType: ct };
}

/** Headers every presigned PUT signs, sorted by name (SigV4). */
export function signedPutHeaders(host: string, d: { size: number; contentType: string }) {
  const headers: [string, string][] = [
    ["content-length", String(d.size)],
    ["content-type", d.contentType],
    ["host", host],
  ];
  return {
    signedHeaders: headers.map(([k]) => k).join(";"),
    canonicalHeaders: headers.map(([k, v]) => `${k}:${v}\n`).join(""),
  };
}
