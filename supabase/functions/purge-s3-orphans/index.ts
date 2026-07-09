/**
 * One-time admin sweep: deletes S3 objects under `competition-photos/` whose
 * top-level prefix (the competition_id or entry_id folder) no longer exists in
 * the database. Use after `hard-delete-competition` is hardened to clean up
 * residue from older deletions.
 *
 * POST { dry_run: boolean } — defaults to dry_run=true.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

async function sha256(data: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

async function getSignatureKey(key: string, dateStamp: string, region: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(new TextEncoder().encode("AWS4" + key), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, "s3");
  return hmacSha256(kService, "aws4_request");
}

function s3Endpoint(s3: S3Settings) {
  const host = s3.endpoint
    ? s3.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "")
    : `${s3.bucket_name}.s3.${s3.region}.amazonaws.com`;
  const baseUrl = s3.endpoint
    ? `${s3.endpoint.replace(/\/+$/, "")}/${s3.bucket_name}`
    : `https://${host}`;
  return { host, baseUrl };
}

async function s3SignedFetch(
  s3: S3Settings,
  method: "GET" | "DELETE" | "POST",
  url: string,
  body: Uint8Array = new Uint8Array(0),
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const u = new URL(url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256(body);
  const scope = `${dateStamp}/${s3.region}/s3/aws4_request`;

  const baseHeaders: Record<string, string> = {
    host: u.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])),
  };

  const sortedKeys = Object.keys(baseHeaders).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${baseHeaders[k]}\n`).join("");
  const signedHeaders = sortedKeys.join(";");

  const params = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQuery = params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const canonicalRequest = [method, u.pathname, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(new TextEncoder().encode(canonicalRequest))].join("\n");
  const signature = toHex(await hmacSha256(await getSignatureKey(s3.secret_access_key, dateStamp, s3.region), stringToSign));

  const headers: Record<string, string> = { ...baseHeaders };
  delete headers.host;
  headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${s3.access_key_id}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, { method, headers, body: method === "GET" || method === "DELETE" ? undefined : body });
}

async function listAllS3Keys(s3: S3Settings, prefix: string): Promise<string[]> {
  const { baseUrl } = s3Endpoint(s3);
  const out: string[] = [];
  let continuationToken: string | null = null;
  do {
    const url = new URL(baseUrl + "/");
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("max-keys", "1000");
    if (continuationToken) url.searchParams.set("continuation-token", continuationToken);
    const res = await s3SignedFetch(s3, "GET", url.toString());
    if (!res.ok) throw new Error(`S3 list failed: ${res.status} ${await res.text()}`);
    const xml = await res.text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
    out.push(...keys);
    const nextMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    continuationToken = truncated && nextMatch ? nextMatch[1] : null;
  } while (continuationToken);
  return out;
}

async function deleteS3Keys(s3: S3Settings, keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const { baseUrl } = s3Endpoint(s3);
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const xmlBody =
      `<?xml version="1.0" encoding="UTF-8"?><Delete>${batch
        .map((k) => `<Object><Key>${k.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</Key></Object>`)
        .join("")}<Quiet>true</Quiet></Delete>`;
    const body = new TextEncoder().encode(xmlBody);
    const url = `${baseUrl}/?delete=`;
    const res = await s3SignedFetch(s3, "POST", url, body, { "Content-Type": "application/xml" });
    if (!res.ok) {
      console.error("S3 batch delete failed", res.status, await res.text());
    } else {
      deleted += batch.length;
    }
  }
  return deleted;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: adminRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!adminRole) {
      return new Response(JSON.stringify({ error: "Admin only" }), { status: 403, headers: corsHeaders });
    }

    let dryRun = true;
    try {
      const body = await req.json();
      if (typeof body?.dry_run === "boolean") dryRun = body.dry_run;
    } catch (_) {
      // empty body — keep default dry_run=true
    }

    const { data: s3Row } = await adminClient.from("site_settings").select("value").eq("key", "s3_storage_settings").maybeSingle();
    const s3 = (s3Row?.value as S3Settings | null) ?? null;
    if (!s3?.enabled) {
      return new Response(JSON.stringify({ error: "S3 storage not configured/enabled" }), { status: 400, headers: corsHeaders });
    }

    // Live competition + entry id sets
    const { data: comps } = await adminClient.from("competitions").select("id");
    const { data: entries } = await adminClient.from("competition_entries").select("id");
    const liveIds = new Set<string>([
      ...(comps || []).map((r: { id: string }) => r.id),
      ...(entries || []).map((r: { id: string }) => r.id),
    ]);

    // List every key under competition-photos/
    const basePrefix = (s3.path_prefix ? `${s3.path_prefix.replace(/\/+$/, "")}/` : "") + "competition-photos/";
    const allKeys = await listAllS3Keys(s3, basePrefix);

    const orphanKeys: string[] = [];
    for (const key of allKeys) {
      // Strip the basePrefix and take first path segment as id-folder
      const rest = key.startsWith(basePrefix) ? key.slice(basePrefix.length) : key;
      const segs = rest.split("/").filter(Boolean);
      if (segs.length === 0) continue;
      const idFolder = segs[0];
      // UUIDs only — anything else (e.g. "covers/") we leave alone for safety
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idFolder)) continue;
      if (!liveIds.has(idFolder)) orphanKeys.push(key);
    }

    let deleted = 0;
    if (!dryRun && orphanKeys.length > 0) {
      deleted = await deleteS3Keys(s3, orphanKeys);
    }

    return new Response(
      JSON.stringify({
        dry_run: dryRun,
        total_listed: allKeys.length,
        live_ids: liveIds.size,
        orphan_keys_found: orphanKeys.length,
        deleted,
        sample_orphans: orphanKeys.slice(0, 10),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("purge-s3-orphans error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
