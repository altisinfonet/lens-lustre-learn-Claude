/**
 * PHOTO PLAN · rectify the `-l4` posts — key rules + the Pages route
 * (functions/api/media/photoset/rectify.ts). Fixture shaped like PRODUCTION's
 * three posts (an uploaded `-l4` set: credited 2048 + clean -r1080 / -thumb /
 * -r320). The credited copy is the only body the worker sends; the clean
 * copies are copied server-side; nothing is overwritten or deleted.
 */
import { describe, expect, it } from "vitest";
import { fit1080, rectifyCleanKey, rectifyKeys, rectifySource } from "@/lib/media/photoL4Rectify";
import { handleRectify } from "../../../../functions/api/media/photoset/rectify";
import { photoSetUrl, isCreditedPhotoUrl } from "@/lib/imageLadder";
import { CREDIT_GEOMETRY } from "@/lib/creditGeometry.mjs";

const O = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const STEM = `post-images/${O}/posts/1762135715123-0`;
const SRC = `${STEM}-w2048h1536-l4.webp`;
const R1080 = `${STEM}-w2048h1536-l4-r1080.webp`;
const NEW = `${STEM}-w1080h810-l5.webp`;

function webp(w: number, h: number, pad = 0): Uint8Array {
  const head = [..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBPVP8X"].map((c) => c.charCodeAt(0)),
    [0, 0, 0, 0, 0, 0, 0, 0, (w - 1) & 0xff, ((w - 1) >> 8) & 0xff, 0, (h - 1) & 0xff, ((h - 1) >> 8) & 0xff, 0]);
  return new Uint8Array(head.concat(new Array(pad).fill(0)));
}

describe("rectify key rules", () => {
  it("a large -l4 post photo → its clean copies and the -l5 names at the clean 1080's real size", () => {
    expect(rectifySource(SRC)).toEqual({ stem: STEM, w: 2048, h: 1536 });
    expect(rectifyCleanKey(SRC)).toBe(R1080);
    expect(fit1080(2048, 1536)).toEqual({ width: 1080, height: 810 });
    const k = rectifyKeys(SRC, 1080, 810)!;
    expect(k.from).toEqual({ r1080: R1080, thumb: `${STEM}-w2048h1536-l4-thumb.webp`, r320: `${STEM}-w2048h1536-l4-r320.webp` });
    expect(k.to).toEqual({ url: NEW, credited: `${STEM}-w1080h810-l5-r2048c.webp`, thumb: `${STEM}-w1080h810-l5-thumb.webp`, r320: `${STEM}-w1080h810-l5-r320.webp` });
    // the new URL is a v3 set the display layer reads: clean itself, credited only for full screen
    const url = `https://cdn.50mmretina.com/${NEW}`;
    expect(isCreditedPhotoUrl(url)).toBe(false);
    expect(photoSetUrl(url, 1080)).toBe(url);
    expect(photoSetUrl(url, 2048)).toBe(`https://cdn.50mmretina.com/${k.to.credited}`);
    expect(photoSetUrl(url, 600)).toBe(`https://cdn.50mmretina.com/${k.to.thumb}`);
    expect(photoSetUrl(url, 320)).toBe(`https://cdn.50mmretina.com/${k.to.r320}`);
  });

  it("refuses anything else: small -l4, siblings, -l5, other folders, path tricks, a 1080 of the wrong size", () => {
    for (const k of [
      `${STEM}-w1000h667-l4.webp`, R1080, `${STEM}-w2048h1536-l4-thumb.webp`, NEW, `${STEM}-w2048h1536-l4f.webp`,
      `avatars/${O}/posts/x-w2048h1536-l4.webp`, `post-images/${O}/../x-w2048h1536-l4.webp`, `post-images/not-a-uuid/posts/x-w2048h1536-l4.webp`,
    ]) expect(rectifySource(k), k).toBeNull();
    expect(rectifyKeys(SRC, 1080, 700)).toBeNull();
    expect(rectifyKeys(SRC, 2048, 1536)).toBeNull();
    expect(rectifyKeys(SRC, 1079, 809)).not.toBeNull(); // ±1 px rounding
    expect(rectifyKeys(SRC, 1081, 811)).toBeNull(); // never above 1080
  });
});

interface Opts { source?: string | null; done?: boolean; store?: Map<string, Uint8Array>; redrawKey?: string | null; redrawVersion?: number }
function setup(opts: Opts = {}) {
  const calls: string[] = [];
  const puts: string[] = [];
  const store = opts.store ?? new Map<string, Uint8Array>([
    [SRC, webp(2048, 1536, 64)], [R1080, webp(1080, 810, 64)],
    [`${STEM}-w2048h1536-l4-thumb.webp`, webp(600, 450, 32)], [`${STEM}-w2048h1536-l4-r320.webp`, webp(320, 240, 16)],
  ]);
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: O }), { status: 200 });
    if (u.endsWith("/rpc/photo_l4_rectify_target")) {
      const src = opts.source === undefined ? SRC : opts.source;
      return new Response(JSON.stringify(src === null ? [] : [{ source_key: src, done: !!opts.done }]), { status: 200 });
    }
    if (u.endsWith("/rpc/photo_l4_rectify_queue")) {
      return new Response(JSON.stringify([{ post_id: P, ord: 0, owner_full_name: "Dipannita Sen", owner_handle: "dipannita", owner_is_admin: false }]), { status: 200 });
    }
    if (u.endsWith("/rpc/photo_l4_rectify_record")) { calls.push(`record ${String(init?.body)}`); return new Response(JSON.stringify("ok"), { status: 200 }); }
    if (u.endsWith("/rpc/photo_credit_redraw_target")) {
      return new Response(JSON.stringify(opts.redrawKey === null ? [] : [{ url_key: opts.redrawKey ?? NEW, credit_version: opts.redrawVersion ?? 2 }]), { status: 200 });
    }
    if (u.endsWith("/rpc/photo_credit_redraw_queue")) {
      calls.push(`redraw-queue ${String(init?.body)}`);
      return new Response(JSON.stringify([{ post_id: P, ord: 0, owner_full_name: "Dipannita Sen", owner_handle: "dipannita", owner_is_admin: false }]), { status: 200 });
    }
    if (u.endsWith("/rpc/photo_credit_redraw_record")) { calls.push(`redraw-record ${String(init?.body)}`); return new Response("1", { status: 200 }); }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const bucket = {
    head: async (k: string) => (store.has(k) ? { size: store.get(k)!.length } : null),
    get: async (k: string, o?: { range?: { offset: number; length: number } }) => {
      const b = store.get(k);
      if (!b) return null;
      const part = o?.range ? b.slice(o.range.offset, o.range.offset + o.range.length) : b;
      return { size: b.length, arrayBuffer: async () => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) };
    },
    put: async (k: string, v: Uint8Array) => { puts.push(k); store.set(k, v); return {}; },
    delete: async () => { throw new Error("never deletes"); },
    list: async () => ({ objects: [], truncated: false }),
  };
  const env = { SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", SUPABASE_ANON_KEY: "anon", PHOTOS: bucket, MEDIA: bucket };
  const req = (method: string, q: string, body?: BodyInit, json = false) =>
    handleRectify(new Request(`https://site.example/api/media/photoset/rectify${q}`, {
      method, headers: { authorization: "Bearer jwt", ...(json ? { "content-type": "application/json" } : {}) }, body,
    }), env as never, fetchImpl);
  return {
    calls, puts, store,
    claim: () => req("POST", "", JSON.stringify({ op: "claim" }), true),
    source: (q = `?op=source&post_id=${P}&ord=0`) => req("GET", q),
    credited: (b: Uint8Array, q = `?op=credited&post_id=${P}&ord=0`) => req("PUT", q, b),
    done: (body: unknown = { op: "done", post_id: P, ord: 0 }) => req("POST", "", JSON.stringify(body), true),
    redrawClaim: () => req("POST", "", JSON.stringify({ op: "redraw-claim" }), true),
    redrawSource: () => req("GET", `?op=redraw-source&post_id=${P}&ord=0`),
    redraw: (b: Uint8Array, version: number = CREDIT_GEOMETRY.version) => req("PUT", `?op=redraw&post_id=${P}&ord=0&version=${version}`, b),
  };
}

describe("redraw (v3 credit, 20261110_0108)", () => {
  const CRED = `${STEM}-w1080h810-l5-r2048c.webp`;
  const rectified = () => new Map<string, Uint8Array>([[NEW, webp(1080, 810, 40)], [CRED, webp(1080, 810, 5)]]);

  it("claims with the CURRENT geometry version and hands out the credit line", async () => {
    const s = setup({ store: rectified() });
    const r = await s.redrawClaim();
    expect(await r.json()).toEqual({ version: CREDIT_GEOMETRY.version, jobs: [{ post_id: P, ord: 0, credit: "© Dipannita Sen, 50mm Retina World" }] });
    expect(s.calls).toEqual([`redraw-queue ${JSON.stringify({ _version: CREDIT_GEOMETRY.version })}`]);
  });

  it("source = the photo's clean copy, sized as its credited copy is now", async () => {
    const r = await setup({ store: rectified() }).redrawSource();
    expect(r.status).toBe(200);
    expect(r.headers.get("x-rectify-size")).toBe("1080x810");
    expect(new Uint8Array(await r.arrayBuffer()).length).toBe(webp(1080, 810, 40).length);
  });

  it("overwrites ONLY the recorded photo's credited key, at its exact size, and records the version; the clean copy is untouched", async () => {
    const s = setup({ store: rectified() });
    const clean = s.store.get(NEW);
    const r = await s.redraw(webp(1080, 810, 77));
    expect(r.status).toBe(201);
    expect(s.puts).toEqual([CRED]);
    expect(s.store.get(CRED)!.length).toBe(webp(1080, 810, 77).length);
    expect(s.store.get(NEW)).toBe(clean);
    expect(s.calls).toEqual([`redraw-record ${JSON.stringify({ _post_id: P, _ord: 0, _version: CREDIT_GEOMETRY.version })}`]);
  });

  it("refuses: another version, another size, not a WebP, not a recorded photo, a bad database key, no credited copy; already at v3 → nothing", async () => {
    expect((await setup({ store: rectified() }).redraw(webp(1080, 810), 2)).status).toBe(409);
    expect((await setup({ store: rectified() }).redraw(webp(1080, 809))).status).toBe(422);
    expect((await setup({ store: rectified() }).redraw(new Uint8Array(64))).status).toBe(415);
    expect((await setup({ store: rectified(), redrawKey: null }).redraw(webp(1080, 810))).status).toBe(404);
    expect((await setup({ store: rectified(), redrawKey: `avatars/${O}/x-w1080h810-l5.webp` }).redraw(webp(1080, 810))).status).toBe(500);
    expect((await setup({ store: new Map([[NEW, webp(1080, 810)]]) }).redraw(webp(1080, 810))).status).toBe(404);
    const done = setup({ store: rectified(), redrawVersion: CREDIT_GEOMETRY.version });
    expect((await done.redraw(webp(1080, 810))).status).toBe(200);
    expect(done.puts).toEqual([]);
  });
});

describe("rectify route", () => {
  it("claim hands out the credit line only (no member data beyond it)", async () => {
    const r = await setup().claim();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ jobs: [{ post_id: P, ord: 0, credit: "© Dipannita Sen, 50mm Retina World" }] });
  });

  it("source gives the CLEAN 1080 and its size, never the credited 2048", async () => {
    const r = await setup().source();
    expect(r.status).toBe(200);
    expect(r.headers.get("x-rectify-size")).toBe("1080x810");
    expect(new Uint8Array(await r.arrayBuffer()).length).toBe(webp(1080, 810, 64).length);
  });

  it("credited + done: one body from the worker, three server-side copies, then the record; old files untouched", async () => {
    const s = setup();
    const before = new Map(s.store);
    expect((await s.credited(webp(1080, 810, 8))).status).toBe(201);
    const d = await s.done();
    expect(d.status).toBe(201);
    expect(s.puts).toEqual([`${STEM}-w1080h810-l5-r2048c.webp`, NEW, `${STEM}-w1080h810-l5-thumb.webp`, `${STEM}-w1080h810-l5-r320.webp`]);
    for (const [k, v] of before) expect(s.store.get(k)).toBe(v); // nothing old overwritten
    expect(s.store.get(NEW)!.length).toBe(webp(1080, 810, 64).length); // the clean 1080's own bytes
    expect(s.calls).toEqual([`record ${JSON.stringify({ _post_id: P, _ord: 0, _new_key: NEW })}`]);
  });

  it("refuses: wrong size, not a WebP, done before the credited copy, not rectify work, a bad database key", async () => {
    const s = setup();
    expect((await s.credited(webp(1080, 811))).status).toBe(422);
    expect((await s.credited(new Uint8Array(64))).status).toBe(415);
    expect((await s.done()).status).toBe(409);
    expect((await setup({ source: null }).source()).status).toBe(404);
    expect((await setup({ source: `avatars/${O}/x-w2048h1536-l4.webp` }).source()).status).toBe(500);
    expect((await s.source(`?op=source&post_id=nope&ord=0`)).status).toBe(400);
    expect((await s.done({ op: "other" })).status).toBe(400);
    expect(s.puts).toEqual([]);
  });

  it("never overwrites: a different object at a target key is 409; the same size is a retry", async () => {
    const credKey = `${STEM}-w1080h810-l5-r2048c.webp`;
    const other = setup();
    other.store.set(credKey, webp(1000, 750));
    expect((await other.credited(webp(1080, 810))).status).toBe(409);
    const retry = setup();
    retry.store.set(credKey, webp(1080, 810, 3));
    expect((await retry.credited(webp(1080, 810, 9))).status).toBe(200);
    expect(retry.store.get(credKey)!.length).toBe(webp(1080, 810, 3).length);
    const urlTaken = setup();
    urlTaken.store.set(credKey, webp(1080, 810));
    urlTaken.store.set(NEW, webp(999, 700));
    expect((await urlTaken.done()).status).toBe(409);
    expect(urlTaken.calls).toEqual([]);
  });

  it("already recorded → nothing touched", async () => {
    const s = setup({ done: true });
    expect((await s.credited(webp(1080, 810))).status).toBe(200);
    expect((await s.done()).status).toBe(200);
    expect(s.puts).toEqual([]);
  });
});
