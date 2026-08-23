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
  /** Public base URL for served objects; read by assertStorageLane. */
  public_url?: string;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified: string; // ISO timestamp as returned by ListObjectsV2
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * STORAGE LANE ASSERTION
 *
 * The object store is the one lane boundary with no undo. A bundle wired to the
 * wrong backend is a bad deploy; member photographs written into the wrong
 * bucket, or deleted from the right one by a staging job, are gone. So this is
 * checked at the moment the credentials are loaded, not left to configuration.
 *
 * The bucket lives in `site_settings.s3_storage_settings`, in the database —
 * NOT in this repository and not in any environment variable. That is precisely
 * why it needs asserting: a staging project restored from a production database
 * dump inherits production's bucket name and production's public_url, and
 * every S3 call it makes then lands on production's objects while every other
 * lane signal says staging.
 *
 * ⚠ EQUALITY, NEVER `includes` OR `endsWith`. "50mm" is a PREFIX of
 * "50mm-staging", so a substring test would classify the staging bucket as
 * production and refuse every legitimate staging write. This is the same trap
 * guard rule R9 exists for on the host side, and the prefix case is pinned as a
 * test rather than left to the reader.
 *
 * The check is symmetric on purpose. Production naming a foreign bucket is
 * caught by rule 3; any other lane naming production's bucket or production's
 * CDN is caught by rule 4. Neither direction is the ambient one.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const PRODUCTION_PROJECT_REF = "jtdtehuqtinjxropkkcn";
export const PRODUCTION_BUCKET = "50mm";
export const PRODUCTION_CDN_HOST = "cdn.50mmretina.com";

export interface StorageLaneSubject {
  bucket_name: string;
  endpoint?: string;
  public_url?: string;
}

/**
 * Throws unless the storage settings belong to the same lane as `supabaseUrl`.
 *
 * Refuses rather than guesses when the lane cannot be determined: an
 * unrecognisable SUPABASE_URL means we do not know which side of the boundary
 * we are on, and "assume production" and "assume staging" are both wrong — one
 * blocks a real deploy, the other waves through the deletion job.
 */
export function assertStorageLane(s3: StorageLaneSubject, supabaseUrl: unknown): void {
  const url = typeof supabaseUrl === "string" ? supabaseUrl : "";
  const ref = url.match(/^https:\/\/([a-z0-9]{15,25})\.supabase\.co/)?.[1];
  if (!ref) {
    throw new Error(
      `storage lane cannot be determined: SUPABASE_URL is not a https://<ref>.supabase.co URL ` +
        `(got: "${url}"). Refusing rather than guessing a lane — guessing production blocks a ` +
        `real deploy, guessing staging waves a deletion job through onto live objects.`,
    );
  }

  const bucket = (s3.bucket_name ?? "").trim();
  if (bucket === "") {
    throw new Error(`storage lane: bucket_name is empty for project ref "${ref}" — a bucketless S3 client signs requests at nothing.`);
  }

  if (ref === PRODUCTION_PROJECT_REF) {
    // Equality, not a prefix test: see the header.
    if (bucket !== PRODUCTION_BUCKET) {
      throw new Error(
        `storage lane mismatch: the PRODUCTION project (${ref}) is configured with bucket ` +
          `"${bucket}", not "${PRODUCTION_BUCKET}". Production would write member photographs ` +
          `into another lane's bucket.`,
      );
    }
    return;
  }

  if (bucket === PRODUCTION_BUCKET) {
    throw new Error(
      `storage lane mismatch: project ref "${ref}" is NOT production but is configured with the ` +
        `production bucket "${PRODUCTION_BUCKET}". A non-production job would read, overwrite or ` +
        `delete live member photographs.`,
    );
  }

  // The CDN host is matched as a substring BECAUSE these two fields hold URLs,
  // not bare identifiers — the host sits inside them. That is the opposite of
  // the bucket rule above, and deliberately so.
  const urls = `${s3.endpoint ?? ""} ${s3.public_url ?? ""}`;
  if (urls.includes(PRODUCTION_CDN_HOST)) {
    throw new Error(
      `storage lane mismatch: project ref "${ref}" is NOT production but its endpoint/public_url ` +
        `names the production CDN "${PRODUCTION_CDN_HOST}". Objects written here would be served ` +
        `from, or served as, production media.`,
    );
  }
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
  if (!s3?.enabled) return null;
  // ⚠ SUPABASE_URL VIA globalThis, NOT AN AMBIENT `Deno` DECLARATION.
  // These functions run on Deno, but this file is pulled into the web
  // TypeScript program by its vitest suite; declaring `Deno` globally would
  // leak a Deno namespace into every src/ file and break tsconfig.app.json.
  const denoEnv = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno;
  assertStorageLane(s3, denoEnv?.env?.get("SUPABASE_URL"));
  return s3;
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

/**
 * Read an object WHOLE. Used by the media backfill, which must hash the real
 * bytes — a fingerprint over the first 64 KiB would collide across every
 * photograph sharing a header, which is most of them.
 *
 * Returns null on 404 (the row points at something the store no longer has —
 * the caller reports that as a skip rather than inventing a hash).
 */
export async function readS3Object(s3: S3Settings, key: string): Promise<Uint8Array | null> {
  const { baseUrl } = s3Endpoint(s3);
  const res = await s3SignedFetch(
    s3, "GET", `${baseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`, new Uint8Array(0),
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`S3 read of ${key} failed: ${res.status} ${await res.text()}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
