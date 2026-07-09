// supabase/functions/s3-presign-upload/index.ts
// Returns a short-lived presigned PUT URL so the browser can upload directly
// to R2/S3, bypassing the edge function body limits that caused 502s on
// large photos. Auth required; per-user rate limited.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

const TTL_SECONDS = 300; // 5 min
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

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

function isPathAllowed(rawPath: string, userId: string, isAdmin: boolean): boolean {
  const parts = rawPath.split("/");
  const ownsPath = parts.some((p) => p === userId);
  if (isAdmin) return true;
  if (ownsPath) return true;
  const inStrict = STRICT_PRIVATE_PREFIXES.some((p) => rawPath.startsWith(p));
  if (inStrict) return false;
  return SHARED_PREFIXES.some((p) => rawPath.startsWith(p));
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

    const filePath = typeof body.path === "string" ? body.path.trim() : "";
    const contentType = typeof body.contentType === "string" && body.contentType ? body.contentType : "application/octet-stream";
    const size = typeof body.size === "number" ? body.size : 0;
    const isPrivate = body.private === true;

    if (!filePath) return json(400, { error: "Missing path" });
    if (filePath.includes("..") || /^https?:\/\//i.test(filePath) || filePath.startsWith("/")) {
      return json(400, { error: "Invalid path" });
    }
    if (size > 0 && size > MAX_BYTES) return json(413, { error: "File too large (max 50MB)" });

    // Optional: a paired second file to sign in the same call (halves edge worker pressure)
    let pairPath = "";
    let pairContentType = "application/octet-stream";
    let pairSize = 0;
    const pairObj = body.pair && typeof body.pair === "object" ? body.pair as { path?: unknown; contentType?: unknown; size?: unknown } : null;
    if (pairObj) {
      pairPath = typeof pairObj.path === "string" ? pairObj.path.trim() : "";
      pairContentType = typeof pairObj.contentType === "string" && pairObj.contentType ? pairObj.contentType : "application/octet-stream";
      pairSize = typeof pairObj.size === "number" ? pairObj.size : 0;
      if (!pairPath) return json(400, { error: "Invalid pair.path" });
      if (pairPath.includes("..") || /^https?:\/\//i.test(pairPath) || pairPath.startsWith("/")) {
        return json(400, { error: "Invalid pair.path" });
      }
      if (pairSize > 0 && pairSize > MAX_BYTES) return json(413, { error: "Pair file too large (max 50MB)" });
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
    if (!s3.enabled) return json(400, { error: "S3 storage is disabled" });

    // SEC-2 ownership gate (applies to primary + pair)
    const isAdmin = await isAdminUser(adminClient, user.id);
    if (!isPathAllowed(filePath, user.id, isAdmin)) {
      return json(403, { error: "Forbidden: path not owned by caller" });
    }
    if (pairPath && !isPathAllowed(pairPath, user.id, isAdmin)) {
      return json(403, { error: "Forbidden: pair.path not owned by caller" });
    }



    const host = s3.endpoint
      ? s3.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "")
      : `${s3.bucket_name}.s3.${s3.region}.amazonaws.com`;
    const baseUrl = s3.endpoint
      ? `${s3.endpoint.replace(/\/+$/, "")}/${s3.bucket_name}`
      : `https://${host}`;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${s3.region}/s3/aws4_request`;
    const derivedKey = await signingKey(s3.secret_access_key, dateStamp, s3.region);

    async function signOne(rawPath: string, isPriv: boolean) {
      const s3Key = s3.path_prefix
        ? `${s3.path_prefix.replace(/\/+$/, "")}/${rawPath}`
        : rawPath;
      const fullUrl = new URL(`${baseUrl}/${s3Key}`);

      const params = new URLSearchParams({
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": `${s3.access_key_id}/${scope}`,
        "X-Amz-Date": amzDate,
        "X-Amz-Expires": String(TTL_SECONDS),
        "X-Amz-SignedHeaders": "host",
      });
      const sortedParams = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");

      const canonicalRequest = [
        "PUT",
        fullUrl.pathname,
        sortedParams,
        `host:${fullUrl.host}\n`,
        "host",
        "UNSIGNED-PAYLOAD",
      ].join("\n");

      const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        scope,
        await sha256Hex(new TextEncoder().encode(canonicalRequest)),
      ].join("\n");

      const sig = toHex(await hmacSha256(derivedKey, stringToSign));
      const uploadUrl = `${baseUrl}/${s3Key}?${sortedParams}&X-Amz-Signature=${sig}`;

      const bucketPrefix = rawPath.split("/")[0];
      const isPrivateBucket = isPriv || PRIVATE_BUCKETS.has(bucketPrefix);
      let publicUrl: string | null = null;
      if (!isPrivateBucket) {
        const cdn = s3.public_url ? s3.public_url.replace(/\/+$/, "") : `${baseUrl}`;
        publicUrl = `${cdn}/${s3Key}`;
      }
      return { uploadUrl, publicUrl, key: s3Key };
    }

    const primary = await signOne(filePath, isPrivate);
    const pair = pairPath ? await signOne(pairPath, isPrivate) : null;

    return json(200, {
      uploadUrl: primary.uploadUrl,
      publicUrl: primary.publicUrl,
      key: primary.key,
      contentType,
      expiresIn: TTL_SECONDS,
      ...(pair ? { pair: { uploadUrl: pair.uploadUrl, publicUrl: pair.publicUrl, key: pair.key, contentType: pairContentType } } : {}),
    });
  } catch (err: any) {
    console.error("[s3-presign-upload] error:", err);
    return json(500, { error: err?.message || "Internal error" });
  }
});
