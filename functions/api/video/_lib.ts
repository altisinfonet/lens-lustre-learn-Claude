/**
 * VID-1 · what /api/video/upload-urls and /api/video/complete share.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ENVIRONMENT (Pages project, per lane; none of it in the repo, none in the app):
 *   SUPABASE_PROJECT_REF, SUPABASE_ANON_KEY   — as every Function (functions/_seo.ts)
 *   MEDIA                                     — R2 bucket BINDING, the lane's media bucket
 *   R2_ACCOUNT_ID, R2_BUCKET                  — for the presigned S3 host/path
 *   R2_UPLOAD_KEY_ID, R2_UPLOAD_KEY_SECRET    — an R2 API token scoped to that one
 *                                               bucket, Object Read & Write. Used ONLY
 *                                               to sign PUT URLs under upload/video/.
 *   VIDEO_DELIVERY_PRIVATE = "1"              — set ONLY once the lane's media host no
 *                                               longer serves upload/ and video/ without a
 *                                               token (the D-003 media-authz Worker, VID-1
 *                                               §9.1; F-D3-18). Until then both endpoints
 *                                               answer 503: no video byte is written to a
 *                                               bucket a public custom domain serves.
 * No service role. Every database call is made AS THE MEMBER, with the member's
 * own JWT, so RLS and the SECURITY DEFINER RPCs' `auth.uid()` decide.
 * A missing variable is a 500 that names it — never a guessed default.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { supabaseUrl, supabaseAnon } from "../../_seo";
import { hex } from "../../../src/lib/video/shared/rules";

/** As much of the R2 binding as these Functions use. */
export interface R2ObjectLike {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface R2BucketLike {
  head(key: string): Promise<{ size: number } | null>;
  get(key: string): Promise<R2ObjectLike | null>;
  put(key: string, value: ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
}

export interface VideoEnv {
  SUPABASE_PROJECT_REF?: string;
  SUPABASE_ANON_KEY?: string;
  MEDIA?: R2BucketLike;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET?: string;
  R2_UPLOAD_KEY_ID?: string;
  R2_UPLOAD_KEY_SECRET?: string;
  VIDEO_DELIVERY_PRIVATE?: string;
}

/**
 * F-D3-18 (curl, 2026-10-05 12:16 UTC): cdn-staging / cdn hosts answer an
 * unknown `video/…` key with R2's plain 404 page — no media-authz Worker in
 * front. A bucket behind a public custom domain serves every key it holds, so
 * writing video there before the Worker is live would publish every upload
 * (including friends-only and private ones) to anyone holding the URL.
 */
export function requirePrivateDelivery(env: VideoEnv): void {
  if (env.VIDEO_DELIVERY_PRIVATE !== "1") {
    throw new HttpError(503, "VID-ENV-002",
      "video delivery is not private on this lane yet (the media-authz Worker is not live, F-D3-18) — uploads are off");
  }
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

export function needEnv<K extends keyof VideoEnv>(env: VideoEnv, k: K): NonNullable<VideoEnv[K]> {
  const v = env[k];
  if (v === undefined || v === null || v === "") throw new HttpError(500, "VID-ENV-001", `${String(k)} is not set for this lane`);
  return v as NonNullable<VideoEnv[K]>;
}

/** The member behind the request, from their own JWT. 401 when there is none. */
export async function member(request: Request, env: VideoEnv, fetchImpl: typeof fetch = fetch): Promise<{ uid: string; jwt: string }> {
  const auth = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) throw new HttpError(401, "VID-AUTH-001", "sign in first");
  const res = await fetchImpl(`${supabaseUrl(env)}/auth/v1/user`, {
    headers: { apikey: supabaseAnon(env), authorization: `Bearer ${m[1]}` },
  });
  if (!res.ok) throw new HttpError(401, "VID-AUTH-001", "sign in first");
  const user = (await res.json()) as { id?: string };
  if (!user?.id) throw new HttpError(401, "VID-AUTH-001", "sign in first");
  return { uid: user.id, jwt: m[1] };
}

/** PostgREST as the member. */
export async function asMember<T>(env: VideoEnv, jwt: string, path: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const res = await fetchImpl(`${supabaseUrl(env)}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: supabaseAnon(env),
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
      accept: "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
    throw new HttpError(res.status === 401 ? 401 : res.status >= 500 ? 502 : 409, "VID-DB-001", msg);
  }
  return body as T;
}

export interface VersionRow {
  video_id: string;
  owner_id: string;
  state: string;
  current_version: number;
  purpose: "post" | "ad";
  manifest_sha256: string;
  total_bytes: number;
  declared_duration_s: number;
  has_audio: boolean;
}

/** The video + its version, read through RLS. Only the owner, only while uploading. */
export async function loadUploadingVersion(env: VideoEnv, who: { uid: string; jwt: string }, videoId: string, versionNo: number,
  fetchImpl: typeof fetch = fetch): Promise<VersionRow> {
  if (!/^[0-9a-f-]{36}$/.test(videoId) || !Number.isInteger(versionNo) || versionNo < 1) {
    throw new HttpError(400, "VID-REQ-001", "video_id and version_no are required");
  }
  const vids = await asMember<Array<{ id: string; owner_id: string; state: string; current_version: number; purpose: "post" | "ad" }>>(
    env, who.jwt, `videos?id=eq.${videoId}&select=id,owner_id,state,current_version,purpose`, {}, fetchImpl);
  const v = vids?.[0];
  // 404, never 403: a stranger learns nothing about someone else's video.
  if (!v || v.owner_id !== who.uid) throw new HttpError(404, "VID-REQ-002", "no such video of yours");
  if (v.current_version !== versionNo) throw new HttpError(409, "VID-REQ-003", `version ${versionNo} is not the current version`);
  const vers = await asMember<Array<{ manifest_sha256: string; total_bytes: number; declared_duration_s: number; has_audio: boolean }>>(
    env, who.jwt, `video_versions?video_id=eq.${videoId}&version_no=eq.${versionNo}&select=manifest_sha256,total_bytes,declared_duration_s,has_audio`, {}, fetchImpl);
  const ver = vers?.[0];
  if (!ver) throw new HttpError(404, "VID-REQ-002", "no such video of yours");
  return {
    video_id: v.id, owner_id: v.owner_id, state: v.state, current_version: v.current_version, purpose: v.purpose,
    manifest_sha256: ver.manifest_sha256, total_bytes: Number(ver.total_bytes),
    declared_duration_s: Number(ver.declared_duration_s), has_audio: ver.has_audio,
  };
}

/* ── AWS SigV4 query presigning (R2's S3 endpoint) ───────────────────────── */

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

async function sha256HexText(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/** RFC 3986 encoding, as SigV4 wants it ("/" kept in paths). */
export function awsEncode(s: string, keepSlash = false): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(keepSlash ? /%2F/g : /$^/, "/");
}

export interface PresignInput {
  method: "GET" | "PUT";
  host: string;
  /** path WITHOUT encoding, starting with "/" */
  path: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** e.g. 20130524T000000Z */
  amzDate: string;
  expires: number;
  /** extra headers the request MUST carry with exactly these values (lower-case names) */
  headers?: Record<string, string>;
}

/** A presigned URL. Every header in `headers` is signed, so a different value is a 403. */
export async function presign(i: PresignInput): Promise<string> {
  const date = i.amzDate.slice(0, 8);
  const scope = `${date}/${i.region}/${i.service}/aws4_request`;
  const headers: Record<string, string> = { ...(i.headers ?? {}), host: i.host };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const signedHeaders = names.join(";");
  const q: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${i.accessKeyId}/${scope}`,
    "X-Amz-Date": i.amzDate,
    "X-Amz-Expires": String(i.expires),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const query = Object.keys(q).sort().map((k) => `${awsEncode(k)}=${awsEncode(q[k])}`).join("&");
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = String(v).trim();
  const canonical = [
    i.method,
    awsEncode(i.path, true),
    query,
    names.map((n) => `${n}:${lower[n]}\n`).join(""),
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", i.amzDate, scope, await sha256HexText(canonical)].join("\n");
  let k = await hmac(enc.encode(`AWS4${i.secretAccessKey}`), date);
  k = await hmac(k, i.region);
  k = await hmac(k, i.service);
  k = await hmac(k, "aws4_request");
  const sig = hex(await hmac(k, toSign));
  return `https://${i.host}${awsEncode(i.path, true)}?${query}&X-Amz-Signature=${sig}`;
}

export function amzDateOf(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** hex sha256 → the base64 form S3's x-amz-checksum-sha256 header carries. */
export function hexToBase64(h: string): string {
  let s = "";
  for (let i = 0; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
  return btoa(s);
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "VID-REQ-001", "the body must be JSON");
  }
}

export function handleError(e: unknown): Response {
  if (e instanceof HttpError) {
    const { status: httpStatus, code, message, extra } = e;
    return json(httpStatus, { error: code, message, ...(extra ?? {}) });
  }
  return json(500, { error: "VID-500", message: "unexpected error" });
}
