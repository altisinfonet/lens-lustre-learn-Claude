// supabase/functions/s3-signed-url/index.ts
// Hardened (Step 17) — Forensic spec:
//   • TTL strictly 5 minutes (300 s) — was 15 min.
//   • Bucket allow-list: only `national-ids` and `support-attachments`
//     prefixes may be signed. Public buckets (avatars, post-images, etc.)
//     are explicitly rejected — they are served via direct CDN URLs.
//   • Per-user rate limit: 30 signed URLs / 5-min window (in-memory).
//   • Every issued URL is written to public.activity_logs for audit.
//   • Authentication: verify_jwt = true (default in config.toml) — anon
//     callers never reach this code.
//   • Authorisation: caller must be the file owner (path contains their
//     auth.uid()) OR have role 'admin'.
//
// NOTE: this function only signs reads from the user's external AWS S3
// bucket — it does NOT touch the 7 public Supabase storage buckets, which
// remain public per the decision recorded 2 days ago.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

// ------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------
const TTL_SECONDS = 300; // 5 minutes — Step 17 mandate
const RATE_LIMIT_MAX = 30; // requests
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Only these top-level prefixes are allowed to be signed.
// Anything else (e.g. `avatars/...`, `post-images/...`) is rejected because
// those buckets are public and served via direct CDN URLs.
const ALLOWED_PREFIXES = ["national-ids/", "support-attachments/"] as const;

// ------------------------------------------------------------------
// In-memory per-user rate limiter (per edge instance)
// ------------------------------------------------------------------
const rateBucket = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateBucket.get(userId);
  if (!entry || entry.resetAt < now) {
    rateBucket.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count += 1;
  return { ok: true };
}

// ------------------------------------------------------------------
// AWS SigV4 helpers
// ------------------------------------------------------------------
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

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key instanceof ArrayBuffer ? key : key.buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

async function sha256(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return toHex(hash);
}

async function getSignatureKey(
  key: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(new TextEncoder().encode("AWS4" + key), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

// ------------------------------------------------------------------
// Handler
// ------------------------------------------------------------------
Deno.serve(async (req) => {
  const corsHeaders = getSecureHeaders(req);

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "TRACE") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // --- 1. AuthN -----------------------------------------------
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json(401, { error: "Unauthorized" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json(401, { error: "Unauthorized" });

    // --- 2. Rate limit ------------------------------------------
    const rl = checkRateLimit(user.id);
    if (!rl.ok) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded", retry_after: rl.retryAfter }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": String(rl.retryAfter ?? 300),
          },
        }
      );
    }

    // --- 3. Input validation ------------------------------------
    let body: { path?: unknown };
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }
    const filePath = typeof body.path === "string" ? body.path.trim() : "";
    if (!filePath) return json(400, { error: "Missing path" });

    // Block path traversal & absolute URLs
    if (filePath.includes("..") || /^https?:\/\//i.test(filePath) || filePath.startsWith("/")) {
      return json(400, { error: "Invalid path" });
    }

    // Bucket allow-list — Step 17 hardening
    const isAllowedBucket = ALLOWED_PREFIXES.some((p) => filePath.startsWith(p));
    if (!isAllowedBucket) {
      return json(403, {
        error:
          "This endpoint only signs URLs for private buckets (national-ids, support-attachments). Public buckets are served via direct CDN URLs.",
      });
    }

    // --- 4. AuthZ: ownership or admin ---------------------------
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: isAdmin } = await adminClient.rpc("app_has_role", {
      _user_id: user.id,
      _role: "admin",
    });

    // Path layout for private buckets: `<bucket>/<userId>/<filename>`
    const pathParts = filePath.split("/");
    const ownsFile = pathParts.some((part: string) => part === user.id);
    if (!isAdmin && !ownsFile) {
      return json(403, { error: "Access denied" });
    }

    // --- 5. Load S3 settings ------------------------------------
    const { data: settingsRow } = await adminClient
      .from("site_settings")
      .select("value")
      .eq("key", "s3_storage_settings")
      .maybeSingle();

    if (!settingsRow?.value) return json(400, { error: "S3 storage not configured" });

    const s3: S3Settings = settingsRow.value as any;
    if (!s3.enabled) return json(400, { error: "S3 storage is disabled" });

    // --- 6. Build presigned URL (5-min TTL) ---------------------
    const s3Key = s3.path_prefix
      ? `${s3.path_prefix.replace(/\/+$/, "")}/${filePath}`
      : filePath;

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

    const canonicalUri = new URL(`${baseUrl}/${s3Key}`).pathname;
    const hostHeader = new URL(`${baseUrl}/${s3Key}`).host;

    const queryParams = new URLSearchParams({
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${s3.access_key_id}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(TTL_SECONDS),
      "X-Amz-SignedHeaders": "host",
    });

    const sortedParams = [...queryParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const canonicalHeaders = `host:${hostHeader}\n`;
    const signedHeaders = "host";

    const canonicalRequest = [
      "GET",
      canonicalUri,
      sortedParams,
      canonicalHeaders,
      signedHeaders,
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      await sha256(new TextEncoder().encode(canonicalRequest)),
    ].join("\n");

    const signingKey = await getSignatureKey(s3.secret_access_key, dateStamp, s3.region, "s3");
    const signature = toHex(await hmacSha256(signingKey, stringToSign));

    const presignedUrl = `${baseUrl}/${s3Key}?${sortedParams}&X-Amz-Signature=${signature}`;

    // --- 7. Audit log (fire and forget) -------------------------
    adminClient
      .from("activity_logs")
      .insert({
        user_id: user.id,
        action_category: "storage",
        action_type: "signed_url_issued",
        description: `Signed URL issued for ${filePath}`,
        metadata: {
          path: filePath,
          bucket_prefix: ALLOWED_PREFIXES.find((p) => filePath.startsWith(p)),
          ttl_seconds: TTL_SECONDS,
          accessed_as: isAdmin ? "admin" : "owner",
        },
        ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        user_agent: req.headers.get("user-agent") ?? null,
      })
      .then(({ error }) => {
        if (error) console.error("[s3-signed-url] audit log insert failed:", error.message);
      });

    return json(200, { url: presignedUrl, expires_in: TTL_SECONDS });
  } catch (err: any) {
    console.error("[s3-signed-url] error:", err);
    return json(500, { error: err.message || "Internal error" });
  }
});
