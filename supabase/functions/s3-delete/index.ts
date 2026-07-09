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
  endpoint?: string;
  path_prefix?: string;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const rawKey = key instanceof Uint8Array ? new Uint8Array(key) : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

async function sha256(data: Uint8Array): Promise<string> {
  const bytes = new Uint8Array(data);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
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

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      return new Response(JSON.stringify({ error: "S3 storage not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const s3: S3Settings = settingsRow.value as any;
    if (!s3.enabled) {
      return new Response(JSON.stringify({ error: "S3 storage is disabled" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { paths } = await req.json();
    if (!Array.isArray(paths) || paths.length === 0) {
      return new Response(JSON.stringify({ error: "Missing paths array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: { path: string; success: boolean; error?: string }[] = [];

    // SEC-2 ownership gate (per-path; foreign paths return {success:false, error:"forbidden"})
    const callerIsAdmin = await isAdminUser(adminClient, userData.user.id);

    for (const filePath of paths) {
      if (!isPathAllowed(filePath, userData.user.id, callerIsAdmin)) {
        results.push({ path: filePath, success: false, error: "forbidden" });
        continue;
      }
      try {
        const s3Key = s3.path_prefix
          ? `${s3.path_prefix.replace(/\/+$/, "")}/${filePath}`
          : filePath;

        const host = s3.endpoint
          ? s3.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "")
          : `${s3.bucket_name}.s3.${s3.region}.amazonaws.com`;
        const baseUrl = s3.endpoint
          ? `${s3.endpoint.replace(/\/+$/, "")}/${s3.bucket_name}`
          : `https://${host}`;
        const url = `${baseUrl}/${s3Key}`;

        const now = new Date();
        const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
        const dateStamp = amzDate.slice(0, 8);
        const emptyHash = await sha256(new Uint8Array(0));
        const scope = `${dateStamp}/${s3.region}/s3/aws4_request`;

        const canonicalHeaders =
          `host:${new URL(url).host}\nx-amz-content-sha256:${emptyHash}\nx-amz-date:${amzDate}\n`;
        const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

        const canonicalRequest = [
          "DELETE",
          new URL(url).pathname,
          "",
          canonicalHeaders,
          signedHeaders,
          emptyHash,
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

        const s3Response = await fetch(url, {
          method: "DELETE",
          headers: {
            "x-amz-content-sha256": emptyHash,
            "x-amz-date": amzDate,
            Authorization: authorization,
          },
        });

        // S3 returns 204 on successful delete (even if key doesn't exist)
        results.push({ path: filePath, success: s3Response.ok || s3Response.status === 204 });
      } catch (err: any) {
        results.push({ path: filePath, success: false, error: err.message });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("S3 delete error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
