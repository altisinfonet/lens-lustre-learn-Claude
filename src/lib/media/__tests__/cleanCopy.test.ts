import { describe, expect, it } from "vitest";
import { handleCleanCopy } from "../../../../functions/api/media/clean-copy";
import { cleanCopySizeOk, cleanCopyTarget, cleanCopyUploadKey } from "../cleanCopy";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const POST = `post-images/${ME}/posts/1762160000000-job-0-w1080h720-l5.webp`;
const COMP = `competition-photos/${ME}/competitions/1762160000000-x-w6000h4000-l5f.webp`;

function webp(w: number, h: number, pad = 0): Uint8Array {
  // VP8X header: canvas width-1 / height-1 as 24-bit little endian at 24 / 27.
  const b = new Uint8Array(30 + pad);
  b.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  b.set([..."WEBPVP8X"].map((c) => c.charCodeAt(0)), 8);
  const put24 = (o: number, v: number) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; b[o + 2] = (v >> 16) & 255; };
  put24(24, w - 1);
  put24(27, h - 1);
  return b;
}

/** The public credited sibling both upload paths store BEFORE sending the clean copy. */
const CREDITED = POST.replace(/\.webp$/, "-r2048c.webp");
function setup(uid = ME, store = new Map<string, Uint8Array>([[CREDITED, webp(2048, 1365)]])) {
  const writes: string[] = [];
  const bucket = {
    head: async (k: string) => (store.has(k) ? { size: store.get(k)!.length } : null),
    get: async (k: string, o?: { range?: { offset: number; length: number } }) => {
      const b = store.get(k);
      if (!b) return null;
      const part = o?.range ? b.slice(o.range.offset, o.range.offset + o.range.length) : b;
      return { arrayBuffer: async () => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength), size: b.length };
    },
    put: async (k: string, v: Uint8Array) => { writes.push(k); store.set(k, v); },
  };
  const fetchImpl = (async (url: string) => {
    if (String(url).endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: uid }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const env = { SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", SUPABASE_ANON_KEY: "anon", MEDIA: bucket, PHOTOS: bucket };
  const send = (key: string, body: Uint8Array, method = "POST") =>
    handleCleanCopy(new Request(`https://site.test/api/media/clean-copy?key=${encodeURIComponent(key)}`, {
      method, body: method === "POST" ? body : undefined, headers: { authorization: "Bearer jwt" },
    }), env as never, fetchImpl);
  return { send, writes, store };
}

describe("clean-copy keys — only a v3 photo's own clean 2048", () => {
  it("maps the uploader's key into photo-clean/ in the MEDIA bucket", () => {
    expect(cleanCopyUploadKey(POST)).toBe(POST.replace(/\.webp$/, "-r2048.webp"));
    expect(cleanCopyTarget(cleanCopyUploadKey(POST))).toMatchObject({
      owner: ME, marker: "-l5", urlWidth: 1080, urlHeight: 720, privateKey: `photo-clean/${cleanCopyUploadKey(POST)}`,
    });
    expect(cleanCopyTarget(cleanCopyUploadKey(COMP))?.marker).toBe("-l5f");
  });
  it("refuses every other name", () => {
    for (const k of [
      POST, // the public file itself
      POST.replace("-l5.webp", "-l4-r2048.webp"), // a v2 name
      POST.replace("-l5.webp", "-l5-r2048c.webp"), // the credited copy
      `avatars/${ME}/x-w100h100-l5-r2048.webp`,
      `post-images/${ME}/posts/../x-w100h100-l5-r2048.webp`,
      `post-images/not-a-uuid/posts/x-w100h100-l5-r2048.webp`,
    ]) expect(cleanCopyTarget(k)).toBeNull();
  });
  it("knows the honest 2048 size of each kind of photo", () => {
    const post = cleanCopyTarget(cleanCopyUploadKey(POST))!;
    expect(cleanCopySizeOk(post, 2048, 1365)).toBe(true);
    expect(cleanCopySizeOk(post, 1620, 1080)).toBe(true);
    expect(cleanCopySizeOk(post, 2048, 2048)).toBe(false);
    expect(cleanCopySizeOk(post, 4000, 2667)).toBe(false);
    const small = cleanCopyTarget(`post-images/${ME}/posts/s-w1000h667-l5-r2048.webp`)!;
    expect(cleanCopySizeOk(small, 1000, 667)).toBe(true);
    expect(cleanCopySizeOk(small, 2048, 1366)).toBe(false);
    const comp = cleanCopyTarget(cleanCopyUploadKey(COMP))!;
    expect(cleanCopySizeOk(comp, 2048, 1365)).toBe(true);
    expect(cleanCopySizeOk(comp, 1080, 720)).toBe(false);
  });
});

describe("POST /api/media/clean-copy", () => {
  const key = cleanCopyUploadKey(POST);
  it("stores the caller's own clean 2048 in photo-clean/ and never overwrites", async () => {
    const s = setup();
    const r = await s.send(key, webp(2048, 1365, 100));
    expect(r.status).toBe(201);
    expect(s.writes).toEqual([`photo-clean/${key}`]);
    const again = await s.send(key, webp(2048, 1365, 100));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: "exists" });
    expect(s.writes).toHaveLength(1);
  });
  it("409 when a different object sits at the key", async () => {
    const s = setup(ME, new Map([[CREDITED, webp(2048, 1365)], [`photo-clean/${key}`, webp(1620, 1080)]]));
    expect((await s.send(key, webp(2048, 1365))).status).toBe(409);
    expect(s.writes).toHaveLength(0);
  });
  it("credit U3: the stored photo itself is the proof (the browser sends no credited copy any more)", async () => {
    const s = setup(ME, new Map([[POST, webp(1080, 720)]]));
    expect((await s.send(key, webp(2048, 1365))).status).toBe(201);
  });
  it("Unit B: 409 PHOTO-CLEAN-006 when neither the photo nor its credited copy is stored (no parking files under made-up names)", async () => {
    const s = setup(ME, new Map());
    const r = await s.send(key, webp(2048, 1365));
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error?: string }).error).toBe("PHOTO-CLEAN-006");
    expect(s.writes).toHaveLength(0);
  });
  it("403 for somebody else's photo, 400 for a bad key, 415 / 422 for bad bytes, 405 for GET", async () => {
    expect((await setup(OTHER).send(key, webp(2048, 1365))).status).toBe(403);
    expect((await setup().send(POST, webp(2048, 1365))).status).toBe(400);
    expect((await setup().send(key, new Uint8Array([1, 2, 3, 4]))).status).toBe(415);
    expect((await setup().send(key, webp(600, 400))).status).toBe(422);
    expect((await setup().send(key, webp(2048, 1365), "GET")).status).toBe(405);
  });
});
