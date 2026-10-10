/**
 * VID-1 §9 · THE VIDEO PLAY TOKEN — one contract, two readers.
 *
 * Minted by `functions/api/video/play-token.ts` (Pages, as the viewer, only
 * after RLS said the video is visible and ready). Verified by the `video/`
 * branch of the D-003 `media-authz` Worker on the lane's CDN host. Both import
 * THIS file, so the two halves cannot drift apart.
 *
 * Why a PREFIX token and not D-003's per-object token (§5 of the D-003 spec):
 * an HLS stream is ~100 small objects named by the playlist, not by the app.
 * The Worker rewrites each playlist so every segment URL carries the same
 * token; the token opens exactly one video version's folder and nothing else.
 *
 *   payload := "v1" LF "prefix=" video/<owner>/<id>/v<n>/ LF "exp=" <epoch s>
 *              LF "sub=" <viewer uid | "anon"> LF "aud=" <cdn host>
 *   token   := b64url(payload) "." b64url(HMAC-SHA256(MEDIA_TOKEN_KEY, payload))
 *   key     := MEDIA_TOKEN_KEY, base64 of exactly 32 random bytes (D-003 §3)
 *
 * Lifetime 15 min (SEC N1). The verifier refuses any token whose exp is more
 * than 15 min + 60 s skew in the future, so a mis-set minter cannot hand out a
 * long-lived URL. A token is a bearer credential for one video version for at
 * most 15 minutes — the honest limit of the scheme (D-003 case 13).
 *
 * The key never reaches a client, a URL or a log line. A token the client
 * could compute would not be a token (D-003 §9).
 */
import { isAllowedFileName } from "./rules";

export const PLAY_TOKEN_TTL_S = 900;
export const PLAY_TOKEN_SKEW_S = 60;
export const PLAY_TOKEN_VERSION = "v1";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PREFIX_RE = new RegExp(`^video/${UUID}/${UUID}/v[1-9]\\d{0,5}/$`);
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const SUB_RE = new RegExp(`^(${UUID}|anon)$`);

export interface PlayTokenClaims {
  prefix: string;
  exp: number;
  sub: string;
  aud: string;
}

export function playPrefix(owner: string, video: string, version: number): string {
  const p = `video/${owner}/${video}/v${version}/`;
  if (!PREFIX_RE.test(p)) throw new Error("VID-TOK-001: owner/video must be lowercase uuids and version ≥ 1");
  return p;
}

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** The 32-byte key from its base64 form. Anything else is a configuration error, never a guess. */
export async function importTokenKey(keyB64: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    const bin = atob(keyB64.trim());
    raw = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  } catch {
    throw new Error("VID-TOK-002: MEDIA_TOKEN_KEY is not base64");
  }
  if (raw.length !== 32) throw new Error("VID-TOK-002: MEDIA_TOKEN_KEY must be 32 bytes");
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export function canonicalPayload(c: PlayTokenClaims): string {
  return [PLAY_TOKEN_VERSION, `prefix=${c.prefix}`, `exp=${c.exp}`, `sub=${c.sub}`, `aud=${c.aud}`].join("\n");
}

function claimsProblem(c: PlayTokenClaims): string | null {
  if (!PREFIX_RE.test(c.prefix)) return "prefix";
  if (!Number.isInteger(c.exp) || c.exp <= 0) return "exp";
  if (!SUB_RE.test(c.sub)) return "sub";
  if (!HOST_RE.test(c.aud)) return "aud";
  return null;
}

export async function signPlayToken(c: PlayTokenClaims, keyB64: string): Promise<string> {
  const bad = claimsProblem(c);
  if (bad) throw new Error(`VID-TOK-003: bad claim ${bad}`);
  const payload = new TextEncoder().encode(canonicalPayload(c));
  const key = await importTokenKey(keyB64);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload as BufferSource));
  return `${b64url(payload)}.${b64url(sig)}`;
}

export function parsePayload(text: string): PlayTokenClaims | null {
  const lines = text.split("\n");
  if (lines.length !== 5 || lines[0] !== PLAY_TOKEN_VERSION) return null;
  const take = (line: string, name: string) => (line.startsWith(`${name}=`) ? line.slice(name.length + 1) : null);
  const prefix = take(lines[1], "prefix");
  const expS = take(lines[2], "exp");
  const sub = take(lines[3], "sub");
  const aud = take(lines[4], "aud");
  if (prefix === null || expS === null || sub === null || aud === null || !/^\d{1,12}$/.test(expS)) return null;
  const c = { prefix, exp: Number(expS), sub, aud };
  return claimsProblem(c) ? null : c;
}

export type VerifyResult = { ok: true; claims: PlayTokenClaims } | { ok: false; reason: string };

/**
 * The Worker's whole decision for a `video/…` request. Any "no" is a 403 with
 * no bytes. `objectKey` is the R2 key requested (no leading slash, no query).
 */
export async function verifyPlayToken(
  token: string | null | undefined, objectKey: string, host: string, nowS: number, keyB64: string,
): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: "no-token" };
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return { ok: false, reason: "shape" };
  const payload = fromB64url(token.slice(0, dot));
  const sig = fromB64url(token.slice(dot + 1));
  if (!payload || !sig || sig.length !== 32) return { ok: false, reason: "shape" };
  const key = await importTokenKey(keyB64);
  // crypto.subtle.verify compares in constant time (D-003 §4.1).
  const good = await crypto.subtle.verify("HMAC", key, sig as BufferSource, payload as BufferSource);
  if (!good) return { ok: false, reason: "signature" };
  const claims = parsePayload(new TextDecoder().decode(payload));
  if (!claims) return { ok: false, reason: "payload" };
  if (claims.exp <= nowS) return { ok: false, reason: "expired" };
  if (claims.exp > nowS + PLAY_TOKEN_TTL_S + PLAY_TOKEN_SKEW_S) return { ok: false, reason: "lifetime" };
  if (claims.aud !== host.toLowerCase()) return { ok: false, reason: "aud" };
  if (!objectKey.startsWith(claims.prefix)) return { ok: false, reason: "prefix" };
  const rest = objectKey.slice(claims.prefix.length);
  if (rest.includes("/") || !isAllowedFileName(rest)) return { ok: false, reason: "file" };
  return { ok: true, claims };
}
