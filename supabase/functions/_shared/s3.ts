/**
 * ONE SigV4 client for R2/S3, shared by every function that touches the object
 * store.
 *
 * This file exists because the alternative already failed once: two functions
 * each carrying their own copy of the S3 code (and two copies of safety
 * lists) is exactly how `detect-orphan-files` ended up with a dead reference
 * list on 2026-08-14 — parallel copies diverge, and the divergent one is
 * always the one that runs.
 *
 * ⚠ `deleteS3Objects` here is FAIL-LOUD, unlike the inline version it
 * replaces, which logged a failed batch to console.error and kept counting.
 * A deletion job that half-succeeds silently leaves the caller believing the
 * post-delete state is known when it is not. Callers get the real outcome and
 * decide; they do not get a comfortable number.
 */

export interface S3Settings {
  enabled: boolean;
  bucket_name: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  endpoint?: string;
  path_prefix?: string;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified: string; // ISO timestamp as returned by ListObjectsV2
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

async function sha256Hex(data: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

async function getSignatureKey(key: string, dateStamp: string, region: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(new TextEncoder().encode("AWS4" + key), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, "s3");
  return hmacSha256(kService, "aws4_request");
}

export function s3Endpoint(s3: S3Settings) {
  const host = s3.endpoint
    ? s3.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "")
    : `${s3.bucket_name}.s3.${s3.region}.amazonaws.com`;
  const baseUrl = s3.endpoint
    ? `${s3.endpoint.replace(/\/+$/, "")}/${s3.bucket_name}`
    : `https://${host}`;
  return { host, baseUrl };
}

export async function s3SignedFetch(
  s3: S3Settings,
  method: "GET" | "DELETE" | "POST" | "PUT",
  url: string,
  body: Uint8Array = new Uint8Array(0),
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const u = new URL(url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(body);
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
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(new TextEncoder().encode(canonicalRequest))].join("\n");
  const signature = toHex(await hmacSha256(await getSignatureKey(s3.secret_access_key, dateStamp, s3.region), stringToSign));

  const headers: Record<string, string> = { ...baseHeaders };
  delete headers.host;
  headers["Authorization"] =
    `AWS4-HMAC-SHA256 Credential=${s3.access_key_id}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, { method, headers, body: method === "GET" || method === "DELETE" || body.length === 0 ? undefined : body });
}

/**
 * Full ListObjectsV2 pagination, returning key + size + lastModified.
 * Throws on any non-OK page: a partial listing looks exactly like a small
 * bucket, and both cleanup and orphan detection make decisions off the total.
 */
export async function listAllS3Objects(s3: S3Settings, prefix: string): Promise<S3Object[]> {
  const { baseUrl } = s3Endpoint(s3);
  const out: S3Object[] = [];
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
    // <Contents><Key>k</Key><LastModified>t</LastModified>...<Size>n</Size>...</Contents>
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const c = m[1];
      const key = c.match(/<Key>([^<]+)<\/Key>/)?.[1];
      if (!key) continue;
      out.push({
        key,
        size: Number(c.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
        lastModified: c.match(/<LastModified>([^<]+)<\/LastModified>/)?.[1] ?? "",
      });
    }
    const nextMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    continuationToken = truncated && nextMatch ? nextMatch[1] : null;
  } while (continuationToken);
  return out;
}

/**
 * Batch delete. FAIL-LOUD: any failed batch throws, carrying how many keys had
 * already been deleted, so the caller can report a known partial state instead
 * of a fabricated total.
 */
export async function deleteS3Objects(s3: S3Settings, keys: string[]): Promise<number> {
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
      throw new Error(
        `S3 batch delete failed at offset ${i} (${deleted} keys already deleted): ` +
          `${res.status} ${await res.text()}`,
      );
    }
    deleted += batch.length;
  }
  return deleted;
}

/** site_settings loader shared by callers, so the shape is parsed in one place. */
export async function getS3Settings(
  adminClient: { from: (t: string) => any },
): Promise<S3Settings | null> {
  const { data, error } = await adminClient
    .from("site_settings")
    .select("value")
    .eq("key", "s3_storage_settings")
    .maybeSingle();
  if (error) throw new Error(`could not read s3_storage_settings: ${error.message}`);
  const s3 = (data?.value as S3Settings | null) ?? null;
  return s3?.enabled ? s3 : null;
}

/**
 * Server-side copy (PUT + x-amz-copy-source): bytes never leave the store.
 * Used by the dims backfill to place a `-wXhY`-named copy beside a legacy
 * object. Throws on failure — and on the "200 with error body" case S3 copy
 * is famous for, where the status lies and the XML tells the truth.
 */
export async function copyS3Object(s3: S3Settings, fromKey: string, toKey: string): Promise<void> {
  const { baseUrl } = s3Endpoint(s3);
  const source = `/${s3.bucket_name}/${fromKey.split("/").map(encodeURIComponent).join("/")}`;
  const res = await s3SignedFetch(s3, "PUT", `${baseUrl}/${toKey.split("/").map(encodeURIComponent).join("/")}`,
    new Uint8Array(0), { "x-amz-copy-source": source });
  const text = await res.text();
  if (!res.ok || /<Error>/.test(text)) {
    throw new Error(`S3 copy ${fromKey} -> ${toKey} failed: ${res.status} ${text.slice(0, 300)}`);
  }
}

/** Ranged read of an object's first bytes. null on 404, throws on other errors. */
export async function readS3ObjectHead(
  s3: S3Settings, key: string, bytes = 65536,
): Promise<Uint8Array | null> {
  const { baseUrl } = s3Endpoint(s3);
  const res = await s3SignedFetch(s3, "GET", `${baseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`,
    new Uint8Array(0), { Range: `bytes=0-${bytes - 1}` });
  if (res.status === 404) return null;
  if (!res.ok && res.status !== 206) {
    throw new Error(`S3 head-read of ${key} failed: ${res.status} ${await res.text()}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
