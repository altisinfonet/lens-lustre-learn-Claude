// @vitest-environment node
/**
 * CREDIT U3 · THE SERVER DRAWS A NEW PHOTO'S CREDIT — rules and route.
 * The uploader no longer sends a credited file. The worker
 * (tools/media-derivatives/set-credit.mjs) reads the queue through
 * /api/media/photoset/setcredit, draws with the one renderer and PUTs
 * `<photo>-r2048c.webp`; the route stores it and records credit_version.
 */
import { describe, expect, it } from "vitest";
import { handleSetCredit } from "../../../../functions/api/media/photoset/setcredit";
import { creditedSizeOk, photoSetCreditTarget } from "../photoSetCredit";
import { CREDIT_GEOMETRY } from "@/lib/creditGeometry.mjs";

const O = "11111111-1111-4111-8111-111111111111";
const KEY = `post-images/${O}/posts/job-0-w1080h810-l5.webp`;
const CRED = `post-images/${O}/posts/job-0-w1080h810-l5-r2048c.webp`;
const CLEAN = `photo-clean/post-images/${O}/posts/job-0-w1080h810-l5-r2048.webp`;
const ENTRY = `competition-photos/${O}/competitions/e-w3000h2000-l5f.webp`;

function webp(w: number, h: number, pad = 0): Uint8Array {
  const head = [..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBPVP8X"].map((c) => c.charCodeAt(0)),
    [0, 0, 0, 0, 0, 0, 0, 0, (w - 1) & 0xff, ((w - 1) >> 8) & 0xff, 0, (h - 1) & 0xff, ((h - 1) >> 8) & 0xff, 0]);
  return new Uint8Array(head.concat(new Array(pad).fill(0)));
}

describe("the keys of a new photo's credited copy", () => {
  it("a v3 post photo / competition entry → its public credited key and its private clean copy", () => {
    expect(photoSetCreditTarget(KEY)).toMatchObject({ photoKey: KEY, creditedKey: CRED, cleanKey: CLEAN, marker: "-l5", urlWidth: 1080, urlHeight: 810 });
    expect(photoSetCreditTarget(ENTRY)).toMatchObject({ marker: "-l5f", creditedKey: `competition-photos/${O}/competitions/e-w3000h2000-l5f-r2048c.webp` });
  });
  it("refuses anything else: siblings, v2 names, other folders, path tricks", () => {
    for (const k of [CRED, `post-images/${O}/posts/job-0-w1080h810-l4.webp`, `post-images/${O}/posts/old.webp`, `avatars/${O}/posts/x-w10h10-l5.webp`,
      `post-images/${O}/../x-w10h10-l5.webp`, "", `post-images/not-a-uuid/posts/x-w10h10-l5.webp`]) {
      expect(photoSetCreditTarget(k), k).toBeNull();
    }
  });
  it("a credited file is this photo's 2048, or (no clean copy was kept) its public size; never above 2048, never another shape", () => {
    const t = photoSetCreditTarget(KEY)!;
    expect(creditedSizeOk(t, 2048, 1536)).toBe(true);
    expect(creditedSizeOk(t, 1080, 810)).toBe(true);
    expect(creditedSizeOk(t, 2048, 1000)).toBe(false);
    expect(creditedSizeOk(t, 2049, 1537)).toBe(false);
    expect(creditedSizeOk(photoSetCreditTarget(ENTRY)!, 2048, 1365)).toBe(true);
    expect(creditedSizeOk(photoSetCreditTarget(ENTRY)!, 3000, 2000)).toBe(false);
  });
});

interface Opts { named?: boolean; done?: boolean; pub?: Map<string, Uint8Array>; priv?: Map<string, Uint8Array> }
function setup(o: Opts = {}) {
  const calls: string[] = [];
  const puts: string[] = [];
  const pub = o.pub ?? new Map<string, Uint8Array>([[KEY, webp(1080, 810, 64)]]);
  const priv = o.priv ?? new Map<string, Uint8Array>([[CLEAN, webp(2048, 1536, 64)]]);
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: O }), { status: 200 });
    if (u.endsWith("/rpc/photo_set_credit_target")) return new Response(JSON.stringify(o.named === false ? [] : [{ done: !!o.done }]), { status: 200 });
    if (u.endsWith("/rpc/photo_set_credit_queue")) {
      calls.push(`queue ${String(init?.body)}`);
      return new Response(JSON.stringify([{ photo_key: KEY, owner_full_name: "Dipannita Sen", owner_handle: "dipannita", owner_is_admin: false }]), { status: 200 });
    }
    if (u.endsWith("/rpc/photo_credit_parked_count")) return new Response("2", { status: 200 });
    if (u.endsWith("/rpc/photo_credit_failed")) { calls.push(`failed ${String(init?.body)}`); return new Response("3", { status: 200 }); }
    if (u.endsWith("/rpc/photo_set_credit_record")) { calls.push(`record ${String(init?.body)}`); return new Response("null", { status: 200 }); }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const bucket = (store: Map<string, Uint8Array>) => ({
    head: async (k: string) => (store.has(k) ? { size: store.get(k)!.length } : null),
    get: async (k: string, r?: { range?: { offset: number; length: number } }) => {
      const b = store.get(k);
      if (!b) return null;
      const part = r?.range ? b.slice(r.range.offset, r.range.offset + r.range.length) : b;
      return { size: b.length, arrayBuffer: async () => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) };
    },
    put: async (k: string, v: Uint8Array) => { puts.push(k); store.set(k, v); return {}; },
    delete: async () => { throw new Error("never deletes"); },
    list: async () => ({ objects: [], truncated: false }),
  });
  const env = { SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", SUPABASE_ANON_KEY: "anon", PHOTOS: bucket(pub), MEDIA: bucket(priv) };
  const req = (method: string, q: string, body?: BodyInit, json = false) =>
    handleSetCredit(new Request(`https://site.example/api/media/photoset/setcredit${q}`, {
      method, headers: { authorization: "Bearer jwt", ...(json ? { "content-type": "application/json" } : {}) }, body,
    }), env as never, fetchImpl);
  return {
    calls, puts, pub,
    claim: (body: unknown = { op: "claim" }) => req("POST", "", JSON.stringify(body), true),
    source: (key = KEY) => req("POST", "", JSON.stringify({ op: "source", key }), true),
    credited: (b: Uint8Array, q = `?op=credited&key=${encodeURIComponent(KEY)}&version=${CREDIT_GEOMETRY.version}&drawn=1`) => req("PUT", q, b),
  };
}

describe("/api/media/photoset/setcredit", () => {
  it("claim: the queue as the caller, member data only as the finished credit line", async () => {
    const s = setup();
    const r = await s.claim({ op: "claim", limit: 5, after: KEY });
    expect(await r.json()).toEqual({ version: CREDIT_GEOMETRY.version, parked: 2, jobs: [{ key: KEY, credit: "© Dipannita Sen, 50mm Retina World" }] });
    expect(s.calls).toEqual([`queue ${JSON.stringify({ _limit: 5, _after: KEY })}`]);
  });

  it("failed: a photo that could not be drawn is counted, and the route answers how many times", async () => {
    const s = setup();
    const r = await s.claim({ op: "failed", key: KEY, error: "source 500" });
    expect(await r.json()).toEqual({ attempts: 3 });
    expect(s.calls).toEqual([`failed ${JSON.stringify({ _subject: KEY, _error: "source 500" })}`]);
    expect((await setup().claim({ op: "failed", key: CRED, error: "x" })).status).toBe(400);
  });

  it("source: the PRIVATE clean 2048 when kept", async () => {
    const r = await setup().source();
    expect(r.status).toBe(200);
    expect(r.headers.get("x-credit-source")).toBe("clean2048");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await r.arrayBuffer()).length).toBe(webp(2048, 1536, 64).length);
  });

  it("source: no clean copy (it is best effort) → the public clean file the post names", async () => {
    const r = await setup({ priv: new Map() }).source();
    expect(r.headers.get("x-credit-source")).toBe("public");
    expect(new Uint8Array(await r.arrayBuffer()).length).toBe(webp(1080, 810, 64).length);
  });

  it("source: a credited file already stored (an older client's canvas, a rectified photo) is never drawn over — it is recorded as older", async () => {
    const pub = new Map([[KEY, webp(1080, 810, 8)], [CRED, webp(2048, 1536, 8)]]);
    const s = setup({ pub });
    const r = await s.source();
    expect(await r.json()).toEqual({ status: "existing" });
    expect(s.calls).toEqual([`record ${JSON.stringify({ _key: KEY, _version: 4, _drawn: true, _origin: "existing" })}`]);
    expect(s.puts).toEqual([]);
  });

  it("source: already recorded → nothing to do; not named by any row → 404; a bad key → 400 before any database call", async () => {
    expect(await (await setup({ done: true }).source()).json()).toEqual({ status: "already" });
    expect((await setup({ named: false }).source()).status).toBe(404);
    expect((await setup().source(CRED)).status).toBe(400);
  });

  it("credited: stored at the derived key as immutable, HEADed, then recorded with the version", async () => {
    const s = setup();
    const r = await s.credited(webp(2048, 1536, 32));
    expect(r.status).toBe(201);
    expect(s.puts).toEqual([CRED]);
    expect(s.calls).toEqual([`record ${JSON.stringify({ _key: KEY, _version: CREDIT_GEOMETRY.version, _drawn: true, _origin: "server" })}`]);
  });

  it("credited: drawn=0 (a photo too small for the line) is recorded as not drawn", async () => {
    const s = setup();
    await s.credited(webp(1080, 810, 8), `?op=credited&key=${encodeURIComponent(KEY)}&version=${CREDIT_GEOMETRY.version}&drawn=0`);
    expect(s.calls).toEqual([`record ${JSON.stringify({ _key: KEY, _version: CREDIT_GEOMETRY.version, _drawn: false, _origin: "server" })}`]);
  });

  it("credited: refuses a stale version, a wrong size, a non-WebP, and never overwrites", async () => {
    const s = setup();
    expect((await s.credited(webp(2048, 1536), `?op=credited&key=${encodeURIComponent(KEY)}&version=4&drawn=1`)).status).toBe(409);
    expect((await s.credited(webp(2048, 1000))).status).toBe(422);
    expect((await s.credited(new Uint8Array([1, 2, 3]))).status).toBe(415);
    expect(s.puts).toEqual([]);
    const taken = setup({ pub: new Map([[KEY, webp(1080, 810, 8)], [CRED, webp(1080, 810, 8)]]) });
    expect((await taken.credited(webp(2048, 1536))).status).toBe(409);
    expect(taken.puts).toEqual([]);
    const retry = setup({ pub: new Map([[KEY, webp(1080, 810, 8)], [CRED, webp(2048, 1536, 8)]]) });
    expect((await retry.credited(webp(2048, 1536))).status).toBe(201);
    expect(retry.puts).toEqual([]);
  });
});
