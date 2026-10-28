/**
 * S3-d · photo pass for friends-only / only-me derivatives — the SAME HMAC
 * scheme and key as the video play token (src/lib/video/shared/playToken.ts,
 * D-003 MEDIA_TOKEN_KEY), with its own version tag so a video token can never
 * open a photo and a photo token can never open a video:
 *
 *   payload := "p1" LF "prefix=" photo/<owner>/<media>/ LF "exp=" <s> LF "sub=" <uid> LF "aud=" <cdn host>
 *   token   := b64url(payload) "." b64url(HMAC-SHA256(key, payload))
 *
 * The Pages minter (functions/api/media/photo-token.ts) and the media-authz
 * Worker (cloudflare/media-authz/handler.ts) both import THIS file.
 */
import { b64url, fromB64url, importTokenKey } from "../video/shared/playToken";

export const PHOTO_TOKEN_VERSION = "p1";
/** One hour: a feed page stays scrollable; the client asks again before expiry. */
export const PHOTO_TOKEN_TTL_S = 3600;
export const PHOTO_TOKEN_SKEW_S = 60;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const PHOTO_PREFIX_RE = new RegExp(`^photo/${UUID}/${UUID}/$`);
export const PHOTO_KEY_RE = new RegExp(`^photo/${UUID}/${UUID}/w(600|1080|1440)\\.webp$`);
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const SUB_RE = new RegExp(`^${UUID}$`);

export interface PhotoTokenClaims { prefix: string; exp: number; sub: string; aud: string }

/** `photo/<owner>/<media>/w1080.webp` → `photo/<owner>/<media>/`, or null. */
export function photoPrefixOf(key: string): string | null {
  return PHOTO_KEY_RE.test(key) ? key.slice(0, key.lastIndexOf("/") + 1) : null;
}

function payloadOf(c: PhotoTokenClaims): string {
  return [PHOTO_TOKEN_VERSION, `prefix=${c.prefix}`, `exp=${c.exp}`, `sub=${c.sub}`, `aud=${c.aud}`].join("\n");
}

export async function signPhotoToken(c: PhotoTokenClaims, keyB64: string): Promise<string> {
  if (!PHOTO_PREFIX_RE.test(c.prefix) || !Number.isInteger(c.exp) || c.exp <= 0 || !SUB_RE.test(c.sub) || !HOST_RE.test(c.aud)) {
    throw new Error("PHOTO-TOK-001: bad claim");
  }
  const payload = new TextEncoder().encode(payloadOf(c));
  const key = await importTokenKey(keyB64);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload as BufferSource));
  return `${b64url(payload)}.${b64url(sig)}`;
}

export type PhotoVerify = { ok: true; claims: PhotoTokenClaims } | { ok: false; reason: string };

/** The Worker's whole decision for a `photo/…` request. */
export async function verifyPhotoToken(token: string | null | undefined, objectKey: string, host: string, nowS: number, keyB64: string): Promise<PhotoVerify> {
  if (!token) return { ok: false, reason: "no-token" };
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return { ok: false, reason: "shape" };
  const payload = fromB64url(token.slice(0, dot));
  const sig = fromB64url(token.slice(dot + 1));
  if (!payload || !sig || sig.length !== 32) return { ok: false, reason: "shape" };
  const key = await importTokenKey(keyB64);
  if (!(await crypto.subtle.verify("HMAC", key, sig as BufferSource, payload as BufferSource))) return { ok: false, reason: "signature" };
  const lines = new TextDecoder().decode(payload).split("\n");
  if (lines.length !== 5 || lines[0] !== PHOTO_TOKEN_VERSION) return { ok: false, reason: "payload" };
  const take = (l: string, k: string) => (l.startsWith(`${k}=`) ? l.slice(k.length + 1) : null);
  const prefix = take(lines[1], "prefix"), expS = take(lines[2], "exp"), sub = take(lines[3], "sub"), aud = take(lines[4], "aud");
  if (prefix === null || expS === null || sub === null || aud === null || !/^\d{1,12}$/.test(expS)) return { ok: false, reason: "payload" };
  const exp = Number(expS);
  if (exp <= nowS) return { ok: false, reason: "expired" };
  if (exp > nowS + PHOTO_TOKEN_TTL_S + PHOTO_TOKEN_SKEW_S) return { ok: false, reason: "lifetime" };
  if (aud !== host.toLowerCase()) return { ok: false, reason: "aud" };
  if (!PHOTO_PREFIX_RE.test(prefix) || photoPrefixOf(objectKey) !== prefix) return { ok: false, reason: "prefix" };
  return { ok: true, claims: { prefix, exp, sub, aud } };
}
