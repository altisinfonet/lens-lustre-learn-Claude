/**
 * S3-d · friends-only / only-me derivatives: the photo pass, the Worker's
 * photo/ branch, and the client's all-or-nothing pass step.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { handleMediaRequest, type MediaAuthzEnv, type MediaAuthzDeps } from "../../../../cloudflare/media-authz/handler";
import { PHOTO_TOKEN_TTL_S, photoPrefixOf, signPhotoToken, verifyPhotoToken } from "../photoToken";
import { signPlayToken, playPrefix } from "../../video/shared/playToken";

const KEY_B64 = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));
const HOST = "cdn-staging.example.test";
const OWNER = "11111111-1111-4111-8111-111111111111";
const MEDIA_A = "33333333-3333-4333-8333-333333333333";
const MEDIA_B = "44444444-4444-4444-8444-444444444444";
const VIEWER = "22222222-2222-4222-8222-222222222222";
const NOW_S = 1_760_000_000;
const PA = `photo/${OWNER}/${MEDIA_A}/`;
const PB = `photo/${OWNER}/${MEDIA_B}/`;

const pass = (prefix: string, exp = NOW_S + PHOTO_TOKEN_TTL_S, aud = HOST) => signPhotoToken({ prefix, exp, sub: VIEWER, aud }, KEY_B64);

class FakeR2 {
  map = new Map<string, Uint8Array>();
  reads: string[] = [];
  async get(key: string) {
    this.reads.push(key);
    const v = this.map.get(key);
    return v ? { size: v.length, httpEtag: `"e${v.length}"`, arrayBuffer: async () => v.slice().buffer } : null;
  }
}

let r2: FakeR2, env: MediaAuthzEnv, deps: MediaAuthzDeps, passed: number;
beforeEach(() => {
  r2 = new FakeR2(); passed = 0;
  r2.map.set(`${PA}w1080.webp`, new Uint8Array([1, 2, 3]));
  r2.map.set(`${PB}w1080.webp`, new Uint8Array([4, 5]));
  env = { MEDIA: r2, MEDIA_TOKEN_KEY: KEY_B64, VIDEO_REVOKED: { get: async () => null }, ALLOWED_ORIGINS: "https://localhost" };
  deps = { nowMs: () => NOW_S * 1000, passthrough: async () => { passed++; return new Response("origin"); }, waitUntil: () => {} };
});
const get = (path: string) => new Request(`https://${HOST}/${path}`);

describe("photo pass", () => {
  it("verifies for its own prefix, host and lifetime only", async () => {
    const t = await pass(PA);
    expect((await verifyPhotoToken(t, `${PA}w600.webp`, HOST, NOW_S, KEY_B64)).ok).toBe(true);
    expect((await verifyPhotoToken(t, `${PB}w600.webp`, HOST, NOW_S, KEY_B64)).ok).toBe(false);
    expect((await verifyPhotoToken(t, `${PA}w600.webp`, "cdn.other.test", NOW_S, KEY_B64)).ok).toBe(false);
    expect((await verifyPhotoToken(t, `${PA}w600.webp`, HOST, NOW_S + PHOTO_TOKEN_TTL_S + 1, KEY_B64)).ok).toBe(false);
    expect((await verifyPhotoToken(t, `${PA}original.jpg`, HOST, NOW_S, KEY_B64)).ok).toBe(false);
    expect(photoPrefixOf(`${PA}w1440.webp`)).toBe(PA);
    expect(photoPrefixOf(`post-images/${OWNER}/posts/x.webp`)).toBeNull();
  });

  it("a VIDEO play token never opens a photo", async () => {
    const vt = await signPlayToken({ prefix: playPrefix(OWNER, MEDIA_A, 1), exp: NOW_S + 600, sub: VIEWER, aud: HOST }, KEY_B64);
    expect((await verifyPhotoToken(vt, `${PA}w600.webp`, HOST, NOW_S, KEY_B64)).ok).toBe(false);
  });
});

describe("media-authz photo/ branch", () => {
  it("anonymous fetch (no pass) is 403 with zero bytes and R2 is never read", async () => {
    const r = await handleMediaRequest(get(`${PA}w1080.webp`), env, deps);
    expect(r.status).toBe(403);
    expect(await r.text()).toBe("");
    expect(r2.reads).toEqual([]);
    expect(passed).toBe(0);
  });

  it("a valid pass serves the WebP privately; a pass for another media is 403", async () => {
    const ok = await handleMediaRequest(get(`${PA}w1080.webp?t=${encodeURIComponent(await pass(PA))}`), env, deps);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect(ok.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const other = await handleMediaRequest(get(`${PB}w1080.webp?t=${encodeURIComponent(await pass(PA))}`), env, deps);
    expect(other.status).toBe(403);
  });

  it("unknown photo key shapes are 404; encoded spellings 400; misconfigured 503", async () => {
    expect((await handleMediaRequest(get(`${PA}original.jpg`), env, deps)).status).toBe(404);
    expect((await handleMediaRequest(get(`photo/${OWNER}%2F${MEDIA_A}/w1080.webp`), env, deps)).status).toBe(400);
    const bad = { ...env, MEDIA_TOKEN_KEY: undefined };
    expect((await handleMediaRequest(get(`${PA}w1080.webp?t=x`), bad, deps)).status).toBe(503);
  });
});

describe("client: photo passes", () => {
  const row = (post: string, media: string, path: string) =>
    ({ post_id: post, ord: 0, media_id: media, width: 600, height: 400, mime: "image/webp", url: `https://${HOST}/${path}` });
  const rows = () => [
    row("p1", MEDIA_A, `${PA}w600.webp`),
    row("p2", MEDIA_B, `${PB}w600.webp`),
    row("p3", "m3", `post-images/${OWNER}/d/m3/w600.webp`),
  ];

  it("appends a pass to private rows and drops a whole post whose pass is missing", async () => {
    const { withPhotoPasses, __resetResolvedMediaForTests } = await import("../resolvedMedia");
    __resetResolvedMediaForTests();
    const out = await withPhotoPasses(rows(), NOW_S, async () => [[MEDIA_A, "aaa.bbb", NOW_S + 3600]]);
    expect(out.map((r) => r.post_id)).toEqual(["p1", "p3"]);
    expect(out[0].url).toBe(`https://${HOST}/${PA}w600.webp?t=aaa.bbb`);
    expect(out[1].url).not.toContain("?t=");
  });

  it("until the minter is wired (S3-d2), every private post falls back whole; public rows are untouched", async () => {
    const { withPhotoPasses, __resetResolvedMediaForTests } = await import("../resolvedMedia");
    __resetResolvedMediaForTests();
    const out = await withPhotoPasses(rows(), NOW_S);
    expect(out.map((r) => r.post_id)).toEqual(["p3"]);
  });
});
