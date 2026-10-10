/**
 * media-authz · the `video/` branch of the D-003 Worker on the lane's CDN host
 * (VID-1 DECISION §9.1, §9.3, §9.4; D-003 handover §4). D2 writes it; the Owner
 * deploys it (Auditor ruling 2026-10-10 07:30 UTC).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS WORKER DOES, BY PATH (the decision is made on the DECODED key,
 * because the origin decodes the path too — "%76ideo/…" is video/…):
 *
 *   video/<owner>/<video>/v<n>/<file>   token required (verifyPlayToken from
 *       src/lib/video/shared/playToken.ts — the SAME code the Pages minter uses,
 *       so the two halves cannot drift). Then the revoked list (KV), then R2.
 *       No token / bad token / revoked → 403, zero bytes, R2 never read.
 *   upload/…                            never served: 404, zero bytes (SEC-VID-1).
 *   anything else (photos, avatars …)   passed to the origin AS IS — the request
 *       object itself, untouched, and the origin's response returned untouched.
 *       Attaching this Worker to the CDN host changes NOTHING for photos, and a
 *       video misconfiguration can never take photos down. Photo privacy is
 *       D-003's other branch, not built here (D-002 / PrivacyGapNotice stays).
 *
 * video/ responses:
 *   • Content-Type fixed by extension (contentTypeFor), never R2's stored type;
 *     X-Content-Type-Options: nosniff; Content-Security-Policy: sandbox;
 *     default-src 'none' (SEC condition 2). ETag from R2. The token is never
 *     echoed in any header.
 *   • Playlists are rewritten so every URI (plain lines and URI="…") carries
 *     the request's token; a playlist naming anything but a sibling file is
 *     refused (502), not served.
 *   • Cache: only AFTER the token check, under a token-free key on a host that
 *     is not in the zone (https://media-authz.cache.invalid/<host>/<key>), so no
 *     request can reach a cached video byte except through this check, and no
 *     origin fetch can collide with it. The client gets "private" headers:
 *     segments/init/poster a year immutable, playlists 60 s.
 *   • Range is not honoured on video/ (200 with the whole object): hls.js
 *     fetches whole segment files, and a partial restricted response is one
 *     more path to get wrong (D-003 §4 allows refusing it).
 *   • CORS: hls.js reads segments from the app's origin, so the lane's origins
 *     (ALLOWED_ORIGINS) are echoed with Vary: Origin — never "*". 403s carry it
 *     too, so the player can see the 403 and fetch a fresh token.
 *   • Misconfigured (no/odd MEDIA_TOKEN_KEY, no VIDEO_REVOKED binding) → 503 on
 *     video/ only. Fails closed; photos unaffected.
 *
 * BINDINGS (Owner, per lane — see cloudflare/media-authz/README.md):
 *   MEDIA           R2 bucket binding, the lane's media bucket
 *   MEDIA_TOKEN_KEY secret, base64 of 32 bytes = the Pages MEDIA_TOKEN_KEY
 *   VIDEO_REVOKED   KV namespace; key = video uuid → present means taken down
 *   ALLOWED_ORIGINS plain text, comma-separated origins (the lane's site + the app)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { verifyPlayToken, importTokenKey } from "../../src/lib/video/shared/playToken";
import { contentTypeFor, isAllowedFileName } from "../../src/lib/video/shared/rules";

export interface R2ObjectLike {
  size: number;
  httpEtag: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface MediaAuthzEnv {
  MEDIA: { get(key: string): Promise<R2ObjectLike | null> };
  MEDIA_TOKEN_KEY?: string;
  VIDEO_REVOKED?: { get(key: string): Promise<string | null> };
  ALLOWED_ORIGINS?: string;
}
export interface CacheLike {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
}
export interface MediaAuthzDeps {
  nowMs(): number;
  cache?: CacheLike;
  /** Today's behaviour for every non-video path: the origin (the bucket's custom domain). */
  passthrough(req: Request): Promise<Response>;
  waitUntil(p: Promise<unknown>): void;
}

const CACHE_HOST = "https://media-authz.cache.invalid";
const IMMUTABLE = "private, max-age=31536000, immutable";
const PLAYLIST = "private, max-age=60";

function corsHeaders(req: Request, env: MediaAuthzEnv): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin) ? { "access-control-allow-origin": origin, vary: "Origin" } : {};
}

/** A refusal: zero bytes, never cached, readable by a listed origin. */
function refuse(status: number, req: Request, env: MediaAuthzEnv, extra: Record<string, string> = {}): Response {
  return new Response(null, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...corsHeaders(req, env), ...extra },
  });
}

/** Rewrite every URI in a playlist to carry the token. Null = it names something that is not a sibling file. */
export function rewritePlaylist(text: string, token: string): string | null {
  const t = encodeURIComponent(token);
  const sibling = (u: string) => isAllowedFileName(u);
  let bad = false;
  const out = text.split("\n").map((raw) => {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith("#")) {
      return line.replace(/URI="([^"]*)"/g, (_m, u: string) => {
        if (!sibling(u)) { bad = true; return _m; }
        return `URI="${u}?t=${t}"`;
      });
    }
    if (!sibling(trimmed)) { bad = true; return line; }
    return `${trimmed}?t=${t}`;
  });
  return bad ? null : out.join("\n");
}

export async function handleMediaRequest(req: Request, env: MediaAuthzEnv, deps: MediaAuthzDeps): Promise<Response> {
  const url = new URL(req.url);
  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return refuse(400, req, env);
  }
  if (key.startsWith("/") || key.includes("//") || key.includes("\\") || key.split("/").includes("..")) {
    return refuse(400, req, env);
  }
  // SEC-VID-12: on the restricted prefixes the key must be spelled plainly. An encoded
  // separator (%2F, %5C) or a "." segment names the same object by another spelling, so
  // it is refused rather than normalised. Photos keep today's pass-through untouched.
  if (/^(video|upload)\//.test(key) && (/%2f|%5c/i.test(url.pathname) || key.split("/").includes("."))) {
    return refuse(400, req, env);
  }

  if (key.startsWith("upload/")) return refuse(404, req, env);
  if (!key.startsWith("video/")) return deps.passthrough(req);

  // ── video/ ─────────────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    const cors = corsHeaders(req, env);
    if (!cors["access-control-allow-origin"]) return refuse(403, req, env);
    return new Response(null, {
      status: 204,
      headers: { ...cors, "access-control-allow-methods": "GET, HEAD", "access-control-max-age": "86400", "cache-control": "no-store" },
    });
  }
  if (req.method !== "GET" && req.method !== "HEAD") return refuse(405, req, env, { allow: "GET, HEAD, OPTIONS" });

  const keyB64 = env.MEDIA_TOKEN_KEY;
  if (!keyB64 || !env.VIDEO_REVOKED) return refuse(503, req, env);
  try {
    await importTokenKey(keyB64);
  } catch {
    return refuse(503, req, env);
  }

  const token = url.searchParams.get("t");
  const verdict = await verifyPlayToken(token, key, url.hostname, Math.floor(deps.nowMs() / 1000), keyB64);
  if (!verdict.ok) return refuse(403, req, env);

  const videoId = key.split("/")[2];
  if ((await env.VIDEO_REVOKED.get(videoId)) !== null) return refuse(403, req, env);

  const file = key.slice(verdict.claims.prefix.length);
  const type = contentTypeFor(file);
  if (!type) return refuse(403, req, env);
  const isPlaylist = file.endsWith(".m3u8");

  // Cache only after the check, token-free, off the zone.
  const cacheReq = new Request(`${CACHE_HOST}/${url.hostname}/${key}`);
  let bodyBytes: Uint8Array | null = null;
  let etag = "";
  const hit = deps.cache ? await deps.cache.match(cacheReq) : undefined;
  if (hit) {
    bodyBytes = new Uint8Array(await hit.arrayBuffer());
    etag = hit.headers.get("etag") ?? "";
  } else {
    const obj = await env.MEDIA.get(key);
    if (!obj) return refuse(404, req, env);
    bodyBytes = new Uint8Array(await obj.arrayBuffer());
    etag = obj.httpEtag;
    if (deps.cache && req.method === "GET") {
      // The stored copy is reachable only through this function, after the check above.
      const stored = new Response(bodyBytes.slice(), {
        headers: { etag, "content-type": type, "cache-control": isPlaylist ? "public, max-age=60" : "public, max-age=31536000, immutable" },
      });
      deps.waitUntil(deps.cache.put(cacheReq, stored));
    }
  }

  let out: BodyInit = bodyBytes;
  if (isPlaylist) {
    const rewritten = rewritePlaylist(new TextDecoder().decode(bodyBytes), token ?? "");
    if (rewritten === null) return refuse(502, req, env);
    out = rewritten;
  }

  const headers: Record<string, string> = {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'",
    "cache-control": isPlaylist ? PLAYLIST : IMMUTABLE,
    ...corsHeaders(req, env),
  };
  if (etag && !isPlaylist) headers.etag = etag;
  return new Response(req.method === "HEAD" ? null : out, { status: 200, headers });
}
