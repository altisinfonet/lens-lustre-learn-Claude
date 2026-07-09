import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

// ── Path-ownership gate (SEC-2) — mirrors s3-presign-upload ──────
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

interface S3Settings {
  enabled: boolean;
  bucket_name: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  endpoint?: string; // For S3-compatible services like DigitalOcean Spaces, MinIO
  path_prefix?: string;
  public_url?: string; // Public/CDN URL for serving files (e.g. R2.dev or custom domain)
}

// AWS Signature V4 helpers
function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const keyData = (key instanceof ArrayBuffer ? key : key.buffer) as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData as any,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message)) as Promise<ArrayBuffer>;
}

async function sha256(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data as any);
  return toHex(hash);
}

async function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(new TextEncoder().encode("AWS4" + key), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

Deno.serve(async (req) => {
  const corsHeaders = getSecureHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method === "TRACE") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  try {
    // Verify auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get S3 settings from site_settings (using service role to bypass RLS)
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: settingsRow } = await adminClient
      .from("site_settings")
      .select("value")
      .eq("key", "s3_storage_settings")
      .maybeSingle();

    if (!settingsRow?.value) {
      return new Response(JSON.stringify({ error: "S3 storage not configured" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const s3: S3Settings = settingsRow.value as any;
    if (!s3.enabled) {
      return new Response(JSON.stringify({ error: "S3 storage is disabled" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const filePath = formData.get("path") as string | null;
    const isPrivate = formData.get("private") === "true";

    if (!file || !filePath) {
      return new Response(JSON.stringify({ error: "Missing file or path" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // SEC-2 ownership gate
    const callerId = claimsData.claims.sub as string;
    const callerIsAdmin = await isAdminUser(adminClient, callerId);
    if (!isPathAllowed(filePath, callerId, callerIsAdmin)) {
      return new Response(JSON.stringify({ error: "Forbidden: path not owned by caller" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const s3Key = s3.path_prefix ? `${s3.path_prefix.replace(/\/+$/, "")}/${filePath}` : filePath;

    // Build the S3 endpoint
    const host = s3.endpoint
      ? s3.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "")
      : `${s3.bucket_name}.s3.${s3.region}.amazonaws.com`;
    const baseUrl = s3.endpoint
      ? `${s3.endpoint.replace(/\/+$/, "")}/${s3.bucket_name}`
      : `https://${host}`;
    const url = `${baseUrl}/${s3Key}`;

    // AWS Signature V4
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const contentHash = await sha256(fileBytes);
    const scope = `${dateStamp}/${s3.region}/s3/aws4_request`;

    const canonicalHeaders = [
      `content-type:${file.type || "application/octet-stream"}`,
      `host:${new URL(url).host}`,
      `x-amz-content-sha256:${contentHash}`,
      `x-amz-date:${amzDate}`,
    ].join("\n") + "\n";

    const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

    const canonicalUri = new URL(url).pathname;
    const canonicalRequest = [
      "PUT",
      canonicalUri,
      "",
      canonicalHeaders,
      signedHeaders,
      contentHash,
    ].join("\n");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      await sha256(new TextEncoder().encode(canonicalRequest)),
    ].join("\n");

    const signingKey = await getSignatureKey(s3.secret_access_key, dateStamp, s3.region, "s3");
    const signature = toHex(await hmacSha256(signingKey, stringToSign));

    const authorization = `AWS4-HMAC-SHA256 Credential=${s3.access_key_id}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    // Upload to S3
    const s3Response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "x-amz-content-sha256": contentHash,
        "x-amz-date": amzDate,
        Authorization: authorization,
      },
      body: fileBytes,
    });

    if (!s3Response.ok) {
      const errText = await s3Response.text();
      console.error("S3 upload error:", errText);
      return new Response(JSON.stringify({ error: "S3 upload failed", detail: errText }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // For private files, return only the key (no public URL)
    if (isPrivate) {
      return new Response(
        JSON.stringify({ success: true, url: null, key: s3Key, private: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build public URL - use public_url if configured, otherwise use the upload URL
    let publicUrl = url;
    if (s3.public_url) {
      const cleanPublicUrl = s3.public_url.replace(/\/+$/, "");
      publicUrl = `${cleanPublicUrl}/${s3Key}`;
    }

    return new Response(
      JSON.stringify({ success: true, url: publicUrl, key: s3Key }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("S3 upload error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
