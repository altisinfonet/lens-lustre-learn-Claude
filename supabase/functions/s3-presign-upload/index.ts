// supabase/functions/s3-presign-upload/index.ts
// Returns a short-lived presigned PUT URL so the browser can upload directly
// to R2/S3, bypassing the edge function body limits that caused 502s on
// large photos. Auth required; per-user rate limited.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";
import { signedPutHeaders, validateUploadDeclaration } from "../_shared/uploadDeclaration.ts";
import {
  assertStorageLane,
  s3Endpoint,
  storageKeyWithPrefix,
  storageObjectUrl,
  validateStorageKey,
} from "../_shared/s3.ts";

const TTL_SECONDS = 300; // 5 min
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

interface S3Settings {
  enabled: boolean;
  bucket_name: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  endpoint?: string;
  path_prefix?: string;
  public_url?: string;
}

const PRIVATE_BUCKETS = new Set(["national-ids", "support-attachments"]);

// ── Path-ownership gate (SEC-2) ──────────────────────────────────
// Mirrors s3-signed-url. Non-admin callers may write only to:
//   (a) a path containing their own user.id, OR
//   (b) a shared content prefix (inline/journal/gallery/covers).
// Strict prefixes require uid-in-path even for admins skipped only
// when isAdmin (admin upload to KYC is not a real workflow but
// preserved to match s3-signed-url semantics).
const SHARED_PREFIXES = ["inline/", "journal/", "gallery/", "covers/"] as const;
const STRICT_PRIVATE_PREFIXES = ["national-ids/", "support-attachments/"] as const;

async function isAdminUser(adminClient: any, userId: string): Promise<boolean> {
  const { data } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "super_admin"])
    .maybeSingle();
  return !!data;
}

// `key` must already have passed validateStorageKey: these rules read the key
// literally, so they are only meaningful for a key nothing will re-interpret.
function isPathAllowed(key: string, userId: string, isAdmin: boolean): boolean {
  const parts = key.split("/");
  const ownsPath = parts.some((p) => p === userId);
  if (isAdmin) return true;
  if (ownsPath) return true;
  const inStrict = STRICT_PRIVATE_PREFIXES.some((p) => key.startsWith(p));
  if (inStrict) return false;
  return SHARED_PREFIXES.some((p) => key.startsWith(p));
}

const rateBucket = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(userId: string) {
  const now = Date.now();
  const e = rateBucket.get(userId);
  if (!e || e.resetAt < now) {
    rateBucket.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true as const };
  }
  if (e.count >= RATE_LIMIT_MAX) return { ok: false as const, retryAfter: Math.ceil((e.resetAt - now) / 1000) };
  e.count += 1;
  return { ok: true as const };
}

function toHex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmacSha256(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    "raw",
    key instanceof ArrayBuffer ? key : key.buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
}
async function sha256Hex(data: Uint8Array) {
  return toHex(await crypto.subtle.digest("SHA-256", data));
}
async function signingKey(secret: string, dateStamp: string, region: string) {
  const kDate = await hmacSha256(new TextEncoder().encode("AWS4" + secret), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, "s3");
  return hmacSha256(kService, "aws4_request");
}

Deno.serve(async (req) => {
  const corsHeaders = getSecureHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json(401, { error: "Unauthorized" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return json(401, { error: "Unauthorized" });

    const rl = checkRateLimit(user.id);
    if (!rl.ok) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded", retry_after: rl.retryAfter }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(rl.retryAfter ?? 300) },
      });
    }

    let body: { path?: unknown; contentType?: unknown; size?: unknown; private?: unknown; pair?: unknown };
    try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }

    const rawPath = typeof body.path === "string" ? body.path.trim() : "";
    const isPrivate = body.private === true;
    // S11: size and type are validated AND signed (see _shared/uploadDeclaration.ts).
    const decl = validateUploadDeclaration(body.size, body.contentType);
    if (!decl.ok) return json(decl.status, { error: decl.error });
    const contentType = decl.contentType;

    if (!rawPath) return json(400, { error: "Missing path" });
    // Strict storage-key grammar (allow-list; replaces the old ".." / scheme /
    // leading-slash deny-list). The ownership gate and the signed URL below
    // both use this validated key and nothing else.
    const filePath = validateStorageKey(rawPath);
    if (!filePath) return json(400, { error: "Invalid path" });

    // Optional: a paired second file to sign in the same call (halves edge worker pressure)
    let pairPath = "";
    let pairDecl: { size: number; contentType: string } | null = null;
    const pairObj = body.pair && typeof body.pair === "object" ? body.pair as { path?: unknown; contentType?: unknown; size?: unknown } : null;
    if (pairObj) {
      const rawPairPath = typeof pairObj.path === "string" ? pairObj.path.trim() : "";
      const pd = validateUploadDeclaration(pairObj.size, pairObj.contentType, "Pair file");
      if (!pd.ok) return json(pd.status, { error: pd.error });
      pairDecl = pd;
      if (!rawPairPath) return json(400, { error: "Invalid pair.path" });
      const validPairPath = validateStorageKey(rawPairPath);
      if (!validPairPath) return json(400, { error: "Invalid pair.path" });
      pairPath = validPairPath;
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: settingsRow } = await adminClient
      .from("site_settings")
      .select("value")
      .eq("key", "s3_storage_settings")
      .maybeSingle();
    if (!settingsRow?.value) return json(400, { error: "S3 storage not configured" });
    const s3 = settingsRow.value as S3Settings;
    // G9: the lane assertion getS3Settings performs — this function reads the
    // settings row itself and signs its own requests, so it must assert here or
    // not at all. Before anything is signed.
    if (s3?.enabled) assertStorageLane(s3, (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env?.get("SUPABASE_URL"));
    if (!s3.enabled) return json(400, { error: "S3 storage is disabled" });

    // SEC-2 ownership gate (applies to primary + pair)
    const isAdmin = await isAdminUser(adminClient, user.id);
    if (!isPathAllowed(filePath, user.id, isAdmin)) {
      return json(403, { error: "Forbidden: path not owned by caller" });
    }
    if (pairPath && !isPathAllowed(pairPath, user.id, isAdmin)) {
      return json(403, { error: "Forbidden: pair.path not owned by caller" });
    }

    // The keys that will be signed: the configured prefix joined to the
    // validated paths, re-validated as a whole.
    const primaryKey = storageKeyWithPrefix(s3.path_prefix, filePath);
    const pairKey = pairPath ? storageKeyWithPrefix(s3.path_prefix, pairPath) : null;
    if (!primaryKey || (pairPath && !pairKey)) {
      return json(500, { error: "Storage path prefix is misconfigured" });
    }

    const { baseUrl } = s3Endpoint(s3);

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${s3.region}/s3/aws4_request`;
    const derivedKey = await signingKey(s3.secret_access_key, dateStamp, s3.region);

    async function signOne(path: string, s3Key: string, isPriv: boolean, d: { size: number; contentType: string }) {
      // Proven to address exactly "/<bucket>/<s3Key>" before it is signed.
      const objectUrl = storageObjectUrl(s3, s3Key);
      const fullUrl = new URL(objectUrl);
      const { signedHeaders, canonicalHeaders } = signedPutHeaders(fullUrl.host, d);

      const params = new URLSearchParams({
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": `${s3.access_key_id}/${scope}`,
        "X-Amz-Date": amzDate,
        "X-Amz-Expires": String(TTL_SECONDS),
        "X-Amz-SignedHeaders": signedHeaders,
      });
      const sortedParams = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");

      const canonicalRequest = [
        "PUT",
        fullUrl.pathname,
        sortedParams,
        canonicalHeaders,
        signedHeaders,
        "UNSIGNED-PAYLOAD",
      ].join("\n");

      const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        scope,
        await sha256Hex(new TextEncoder().encode(canonicalRequest)),
      ].join("\n");

      const sig = toHex(await hmacSha256(derivedKey, stringToSign));
      const uploadUrl = `${objectUrl}?${sortedParams}&X-Amz-Signature=${sig}`;

      const bucketPrefix = path.split("/")[0];
      const isPrivateBucket = isPriv || PRIVATE_BUCKETS.has(bucketPrefix);
      let publicUrl: string | null = null;
      if (!isPrivateBucket) {
        const cdn = s3.public_url ? s3.public_url.replace(/\/+$/, "") : `${baseUrl}`;
        publicUrl = `${cdn}/${s3Key}`;
      }
      return { uploadUrl, publicUrl, key: s3Key };
    }

    const primary = await signOne(filePath, primaryKey, isPrivate, decl);
    const pair = pairPath && pairKey && pairDecl ? await signOne(pairPath, pairKey, isPrivate, pairDecl) : null;

    return json(200, {
      uploadUrl: primary.uploadUrl,
      publicUrl: primary.publicUrl,
      key: primary.key,
      contentType,
      expiresIn: TTL_SECONDS,
      ...(pair ? { pair: { uploadUrl: pair.uploadUrl, publicUrl: pair.publicUrl, key: pair.key, contentType: pairDecl?.contentType } } : {}),
    });
  } catch (err: any) {
    console.error("[s3-presign-upload] error:", err);
    return json(500, { error: err?.message || "Internal error" });
  }
});
