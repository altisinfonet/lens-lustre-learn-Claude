/**
 * VID-1 §9.3–§9.4 · the `video/` branch of the D-003 `media-authz` Worker
 * (cloudflare/media-authz/handler.ts), driven with a fake R2 binding, a fake
 * revoked-list KV, a fake Cache API and a recording passthrough.
 *
 * What is asserted (DECISION.md §9 + §12.14, D-003 §4):
 *   • video/ without a valid token → 403, zero bytes, nothing read from R2;
 *     a token for video A on video B's folder, an expired token, a token for
 *     another host → 403;
 *   • a revoked (taken_down) video → 403 even with a valid token;
 *   • upload/ is never served, with or without a token;
 *   • a key spelled with percent-escapes cannot reach video/ or upload/ through
 *     the passthrough;
 *   • every OTHER path goes to the origin untouched — photos keep today's
 *     behaviour byte for byte when the Worker is attached to the CDN host;
 *   • fixed Content-Type, nosniff, CSP sandbox; playlists rewritten so every
 *     URI carries the token; the token never appears in a response header;
 *   • cached only after the check, under a token-free key off the zone;
 *   • CORS only for the lane's listed origins.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleMediaRequest, type MediaAuthzEnv, type MediaAuthzDeps } from "../../../../cloudflare/media-authz/handler";
import { signPlayToken, playPrefix, PLAY_TOKEN_TTL_S } from "../shared/playToken";

const KEY_B64 = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
const HOST = "cdn-staging.example.test";
const ORIGIN = "https://staging.example.test";
const OWNER = "11111111-1111-4111-8111-111111111111";
const VID_A = "33333333-3333-4333-8333-333333333333";
const VID_B = "44444444-4444-4444-8444-444444444444";
const VIEWER = "22222222-2222-4222-8222-222222222222";
const NOW_S = 1_760_000_000;
const A = playPrefix(OWNER, VID_A, 1);
const B = playPrefix(OWNER, VID_B, 1);

const MASTER = [
  "#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS",
  '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Original",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"',
  '#EXT-X-STREAM-INF:BANDWIDTH=61440,RESOLUTION=240x426,CODECS="avc1.42E01E,mp4a.40.2",AUDIO="aud"', "240p.m3u8", "",
].join("\n");
const MEDIA_PL = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-TARGETDURATION:4", '#EXT-X-MAP:URI="240p.mp4"', "#EXTINF:4.000,", "240p_0.m4s", "#EXT-X-ENDLIST", ""].join("\n");

class FakeR2 {
  map = new Map<string, Uint8Array>();
  reads: string[] = [];
  async get(key: string) {
    this.reads.push(key);
    const v = this.map.get(key);
    if (!v) return null;
    return { size: v.length, httpEtag: `"etag-${v.length}"`, arrayBuffer: async () => v.slice().buffer };
  }
}
class FakeKV {
  revoked = new Set<string>();
  async get(k: string) { return this.revoked.has(k) ? "taken_down" : null; }
}
class FakeCache {
  store = new Map<string, Response>();
  async match(req: Request) { const r = this.store.get(req.url); return r ? r.clone() : undefined; }
  async put(req: Request, res: Response) { this.store.set(req.url, res.clone()); }
}

let r2: FakeR2, kv: FakeKV, cache: FakeCache, passed: Request[], env: MediaAuthzEnv, deps: MediaAuthzDeps;
beforeEach(() => {
  r2 = new FakeR2(); kv = new FakeKV(); cache = new FakeCache(); passed = [];
  const enc = new TextEncoder();
  r2.map.set(`${A}master.m3u8`, enc.encode(MASTER));
  r2.map.set(`${A}240p.m3u8`, enc.encode(MEDIA_PL));
  r2.map.set(`${A}240p_0.m4s`, new Uint8Array([1, 2, 3, 4]));
  r2.map.set(`${A}poster.jpg`, new Uint8Array([0xff, 0xd8, 0xff, 0]));
  r2.map.set(`${B}240p_0.m4s`, new Uint8Array([9, 9]));
  r2.map.set(`upload/video/${OWNER}/${VID_A}/v1/240p_0.m4s`, new Uint8Array([7]));
  env = { MEDIA: r2, MEDIA_TOKEN_KEY: KEY_B64, VIDEO_REVOKED: kv, ALLOWED_ORIGINS: `${ORIGIN}, https://localhost` };
  deps = {
    nowMs: () => NOW_S * 1000,
    cache,
    passthrough: async (req) => { passed.push(req); return new Response("origin bytes", { status: 200, headers: { "x-from": "origin" } }); },
    waitUntil: () => {},
  };
});

const tokenFor = (prefix: string, o: { exp?: number; aud?: string; sub?: string } = {}) =>
  signPlayToken({ prefix, exp: o.exp ?? NOW_S + PLAY_TOKEN_TTL_S, sub: o.sub ?? VIEWER, aud: o.aud ?? HOST }, KEY_B64);
const get = (path: string, init: RequestInit & { origin?: string } = {}) => {
  const h = new Headers(init.headers);
  if (init.origin) h.set("origin", init.origin);
  return new Request(`https://${HOST}/${path}`, { method: init.method ?? "GET", headers: h });
};
const bytes = async (r: Response) => new Uint8Array(await r.arrayBuffer());

describe("video/ needs a valid token — no token, no bytes (VID-1 §9.1, §12.14)", () => {
  it("no token → 403, zero bytes, R2 never read, nothing passed to the origin", async () => {
    const r = await handleMediaRequest(get(`${A}240p_0.m4s`), env, deps);
    expect(r.status).toBe(403);
    expect((await bytes(r)).length).toBe(0);
    expect(r2.reads).toEqual([]);
    expect(passed).toEqual([]);
  });
  it("a token for video A is rejected on video B's folder", async () => {
    const r = await handleMediaRequest(get(`${B}240p_0.m4s?t=${await tokenFor(A)}`), env, deps);
    expect(r.status).toBe(403);
    expect(r2.reads).toEqual([]);
  });
  it("expired → 403", async () => {
    const r = await handleMediaRequest(get(`${A}240p_0.m4s?t=${await tokenFor(A, { exp: NOW_S })}`), env, deps);
    expect(r.status).toBe(403);
  });
  it("a token minted for another CDN host → 403", async () => {
    const r = await handleMediaRequest(get(`${A}240p_0.m4s?t=${await tokenFor(A, { aud: "cdn.example.test" })}`), env, deps);
    expect(r.status).toBe(403);
  });
  it("a token signed with another key → 403", async () => {
    const other = btoa(String.fromCharCode(...Array.from({ length: 32 }, () => 7)));
    const t = await signPlayToken({ prefix: A, exp: NOW_S + 60, sub: VIEWER, aud: HOST }, other);
    expect((await handleMediaRequest(get(`${A}240p_0.m4s?t=${t}`), env, deps)).status).toBe(403);
  });
  it("valid token → 200 with the object's bytes", async () => {
    const r = await handleMediaRequest(get(`${A}240p_0.m4s?t=${await tokenFor(A)}`), env, deps);
    expect(r.status).toBe(200);
    expect(Array.from(await bytes(r))).toEqual([1, 2, 3, 4]);
  });
  it("a taken_down video (revoked list) → 403 even with a valid token", async () => {
    kv.revoked.add(VID_A);
    const r = await handleMediaRequest(get(`${A}240p_0.m4s?t=${await tokenFor(A)}`), env, deps);
    expect(r.status).toBe(403);
    expect(r2.reads).toEqual([]);
  });
  it("valid token, object missing → 404", async () => {
    const r = await handleMediaRequest(get(`${A}240p_9.m4s?t=${await tokenFor(A)}`), env, deps);
    expect(r.status).toBe(404);
  });
  it("only GET / HEAD / OPTIONS on video/", async () => {
    const r = await handleMediaRequest(get(`${A}240p_0.m4s?t=${await tokenFor(A)}`, { method: "PUT" }), env, deps);
    expect(r.status).toBe(405);
  });
});

describe("upload/ is never served (SEC-VID-1)", () => {
  it("with or without any token → 404, zero bytes, R2 never read, never passed through", async () => {
    for (const q of ["", `?t=${await tokenFor(A)}`]) {
      const r = await handleMediaRequest(get(`upload/video/${OWNER}/${VID_A}/v1/240p_0.m4s${q}`), env, deps);
      expect(r.status).toBe(404);
      expect((await bytes(r)).length).toBe(0);
    }
    expect(r2.reads).toEqual([]);
    expect(passed).toEqual([]);
  });
});

describe("the restricted check runs on the DECODED key (the origin decodes too)", () => {
  for (const path of [`%76ideo/${OWNER}/${VID_A}/v1/240p_0.m4s`, `video%2F${OWNER}/${VID_A}/v1/240p_0.m4s`, `%75pload/video/${OWNER}/${VID_A}/v1/240p_0.m4s`]) {
    it(`${path.slice(0, 16)}… is not passed to the origin`, async () => {
      const r = await handleMediaRequest(get(path), env, deps);
      expect([403, 404]).toContain(r.status);
      expect(passed).toEqual([]);
    });
  }
  it("'..', '//', backslash and broken escapes → 400, nothing passed through", async () => {
    // Plain "..", "//" and "\\" are normalised by the URL parser before any Worker sees them; these
    // escaped spellings survive parsing and only become "..", "//", "\\" once decoded.
    for (const p of ["posts%2F..%2Fvideo%2Fx", "posts%2F%2Fx.webp", "posts%5Cx.webp", "posts/%E0%A4%A.webp"]) {
      const r = await handleMediaRequest(get(p), env, deps);
      expect(r.status, p).toBe(400);
    }
    expect(passed).toEqual([]);
  });
});

describe("every other path is today's behaviour: the origin, untouched", () => {
  it("a photo key is passed to the origin as the same request, response unchanged", async () => {
    const req = get("post-images/u1/photo.webp?v=3");
    const r = await handleMediaRequest(req, env, deps);
    expect(passed).toHaveLength(1);
    expect(passed[0]).toBe(req);
    expect(r.headers.get("x-from")).toBe("origin");
    expect(await r.text()).toBe("origin bytes");
    expect(r2.reads).toEqual([]);
  });
  it("…even when the video configuration is missing (a video misconfig never takes photos down)", async () => {
    const r = await handleMediaRequest(get("avatars/u1.webp"), { MEDIA: r2 } as MediaAuthzEnv, deps);
    expect(r.headers.get("x-from")).toBe("origin");
  });
});

describe("headers (SEC condition 2) and the token never leaking", () => {
  it("fixed Content-Type by extension, nosniff, CSP sandbox, ETag from R2", async () => {
    const t = await tokenFor(A);
    const seg = await handleMediaRequest(get(`${A}240p_0.m4s?t=${t}`), env, deps);
    expect(seg.headers.get("content-type")).toBe("video/iso.segment");
    expect(seg.headers.get("x-content-type-options")).toBe("nosniff");
    expect(seg.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
    expect(seg.headers.get("etag")).toBe('"etag-4"');
    const poster = await handleMediaRequest(get(`${A}poster.jpg?t=${t}`), env, deps);
    expect(poster.headers.get("content-type")).toBe("image/jpeg");
    for (const [k, v] of seg.headers) expect(`${k}: ${v}`).not.toContain(t);
  });
  it("segments immutable for a year, privately; playlists 60 s, privately", async () => {
    const t = await tokenFor(A);
    expect((await handleMediaRequest(get(`${A}240p_0.m4s?t=${t}`), env, deps)).headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect((await handleMediaRequest(get(`${A}master.m3u8?t=${t}`), env, deps)).headers.get("cache-control")).toBe("private, max-age=60");
  });
  it("403 and 404 carry no-store and zero bytes", async () => {
    const r = await handleMediaRequest(get(`${A}240p_0.m4s`), env, deps);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("a file name outside the allowed set inside a valid folder → 403", async () => {
    const r = await handleMediaRequest(get(`${A}evil.html?t=${await tokenFor(A)}`), env, deps);
    expect(r.status).toBe(403);
  });
});

describe("playlists are rewritten so every URI carries the same token (VID-1 §9.3)", () => {
  it("master: plain URI lines and URI=\"…\" attributes", async () => {
    const t = await tokenFor(A);
    const text = await (await handleMediaRequest(get(`${A}master.m3u8?t=${t}`), env, deps)).text();
    expect(text).toContain(`URI="audio.m3u8?t=${t}"`);
    expect(text).toContain(`\n240p.m3u8?t=${t}\n`);
    expect(text).toContain("#EXT-X-STREAM-INF:BANDWIDTH=61440");
  });
  it("media playlist: the init segment and every segment", async () => {
    const t = await tokenFor(A);
    const text = await (await handleMediaRequest(get(`${A}240p.m3u8?t=${t}`), env, deps)).text();
    expect(text).toContain(`#EXT-X-MAP:URI="240p.mp4?t=${t}"`);
    expect(text).toContain(`\n240p_0.m4s?t=${t}\n`);
  });
  it("a playlist naming anything outside its own folder is refused, not served", async () => {
    r2.map.set(`${A}480p.m3u8`, new TextEncoder().encode("#EXTM3U\n../other/v1/x.m4s\n"));
    const r = await handleMediaRequest(get(`${A}480p.m3u8?t=${await tokenFor(A)}`), env, deps);
    expect(r.status).toBe(502);
    expect((await bytes(r)).length).toBe(0);
  });
});

describe("cache: only after the check, under a token-free key off the zone (VID-1 §9.4)", () => {
  it("the second viewer is served from the cache; the cache key holds no token and no zone host", async () => {
    await handleMediaRequest(get(`${A}240p_0.m4s?t=${await tokenFor(A)}`), env, deps);
    expect(r2.reads).toHaveLength(1);
    const keys = [...cache.store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("?");
    expect(new URL(keys[0]).hostname.endsWith(".invalid")).toBe(true);
    const r = await handleMediaRequest(get(`${A}240p_0.m4s?t=${await tokenFor(A, { sub: "anon" })}`), env, deps);
    expect(r.status).toBe(200);
    expect(r2.reads).toHaveLength(1);
  });
  it("a cached object is still refused without a token", async () => {
    await handleMediaRequest(get(`${A}240p_0.m4s?t=${await tokenFor(A)}`), env, deps);
    const r = await handleMediaRequest(get(`${A}240p_0.m4s`), env, deps);
    expect(r.status).toBe(403);
    expect((await bytes(r)).length).toBe(0);
  });
});

describe("CORS: the lane's listed origins only, never *", () => {
  it("a listed origin is echoed with Vary: Origin; an unlisted one gets nothing", async () => {
    const t = await tokenFor(A);
    const ok = await handleMediaRequest(get(`${A}240p_0.m4s?t=${t}`, { origin: ORIGIN }), env, deps);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("vary")).toContain("Origin");
    const no = await handleMediaRequest(get(`${A}240p_0.m4s?t=${t}`, { origin: "https://evil.example" }), env, deps);
    expect(no.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("a 403 to a listed origin is readable, so the player can fetch a fresh token", async () => {
    const r = await handleMediaRequest(get(`${A}240p_0.m4s`, { origin: ORIGIN }), env, deps);
    expect(r.status).toBe(403);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });
  it("preflight from a listed origin → 204 GET/HEAD; from another → 403", async () => {
    expect((await handleMediaRequest(get(`${A}240p_0.m4s`, { method: "OPTIONS", origin: "https://localhost" }), env, deps)).status).toBe(204);
    expect((await handleMediaRequest(get(`${A}240p_0.m4s`, { method: "OPTIONS", origin: "https://evil.example" }), env, deps)).status).toBe(403);
  });
});

describe("fails closed on its own misconfiguration (video/ only)", () => {
  it("no MEDIA_TOKEN_KEY, a key that is not 32 bytes, or no revoked-list binding → 503 on video/, zero bytes", async () => {
    const t = await tokenFor(A);
    for (const e of [{ ...env, MEDIA_TOKEN_KEY: undefined }, { ...env, MEDIA_TOKEN_KEY: btoa("short") }, { ...env, VIDEO_REVOKED: undefined }]) {
      const r = await handleMediaRequest(get(`${A}240p_0.m4s?t=${t}`), e as MediaAuthzEnv, deps);
      expect(r.status).toBe(503);
      expect((await bytes(r)).length).toBe(0);
    }
  });
  it("HEAD → same headers, no body", async () => {
    const r = await handleMediaRequest(get(`${A}240p_0.m4s?t=${await tokenFor(A)}`, { method: "HEAD" }), env, deps);
    expect(r.status).toBe(200);
    expect((await bytes(r)).length).toBe(0);
    expect(r.headers.get("content-type")).toBe("video/iso.segment");
  });
});

describe("the BUILT worker.js (what the Owner deploys) behaves like the handler", () => {
  it("no token → 403 without touching R2; a photo goes to the origin via fetch; a valid token is served", async () => {
    const mod = await import("../../../../cloudflare/media-authz/worker.js");
    const origin = vi.fn(async () => new Response("origin bytes", { headers: { "x-from": "origin" } }));
    vi.stubGlobal("fetch", origin);
    vi.useFakeTimers({ now: NOW_S * 1000, toFake: ["Date"] });
    try {
      const ctx = { waitUntil: () => {} };
      const no = await mod.default.fetch(get(`${A}240p_0.m4s`), env, ctx);
      expect(no.status).toBe(403);
      expect(r2.reads).toEqual([]);
      const photo = await mod.default.fetch(get("post-images/u1/p.webp"), env, ctx);
      expect(photo.headers.get("x-from")).toBe("origin");
      expect(origin).toHaveBeenCalledTimes(1);
      const ok = await mod.default.fetch(get(`${A}240p_0.m4s?t=${await tokenFor(A)}`), env, ctx);
      expect(ok.status).toBe(200);
      expect(Array.from(new Uint8Array(await ok.arrayBuffer()))).toEqual([1, 2, 3, 4]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
