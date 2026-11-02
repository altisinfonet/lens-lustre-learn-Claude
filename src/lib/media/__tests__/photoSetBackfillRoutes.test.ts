import { describe, expect, it } from "vitest";
import { handlePhotoSetClaim } from "../../../../functions/api/media/photoset/claim";
import { handlePhotoSetPut } from "../../../../functions/api/media/photoset/put";
import { handlePhotoSetDone } from "../../../../functions/api/media/photoset/done";
import { handlePhotoSetSource } from "../../../../functions/api/media/photoset/source";

const O = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const SRC = `post-images/${O}/posts/1793596625316-1tjg4vg9wsa-w2170h1479-l3.webp`;
const MASTER = `post-images/${O}/posts/1793596625316-1tjg4vg9wsa-w2170h1479-l3-w2048h1396-l4.webp`;

function webp(w: number, h: number, pad = 0): Uint8Array {
  const head = [..."RIFF"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBPVP8X"].map((c) => c.charCodeAt(0)),
    [0, 0, 0, 0, 0, 0, 0, 0, (w - 1) & 0xff, ((w - 1) >> 8) & 0xff, 0, (h - 1) & 0xff, ((h - 1) >> 8) & 0xff, 0]);
  return new Uint8Array(head.concat(new Array(pad).fill(0)));
}

interface Opts { source?: string | null; done?: boolean; store?: Map<string, Uint8Array>; queue?: unknown[] }
function setup(opts: Opts = {}) {
  const calls: string[] = [];
  const puts: string[] = [];
  const store = opts.store ?? new Map<string, Uint8Array>([[SRC, webp(2170, 1479, 64)]]);
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: O }), { status: 200 });
    if (u.endsWith("/rpc/photo_set_backfill_target")) {
      calls.push(`target ${String(init?.body)}`);
      const src = opts.source === undefined ? SRC : opts.source;
      return new Response(JSON.stringify(src === null ? [] : [{ source_key: src, done: !!opts.done }]), { status: 200 });
    }
    if (u.endsWith("/rpc/photo_set_backfill_queue")) { calls.push(`queue ${String(init?.body)}`); return new Response(JSON.stringify(opts.queue ?? []), { status: 200 }); }
    if (u.endsWith("/rpc/photo_set_backfill_record")) { calls.push(`record ${String(init?.body)}`); return new Response("true", { status: 200 }); }
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
  const put = (slot: string, body: Uint8Array, q = `post_id=${P}&ord=0&slot=${slot}`) =>
    handlePhotoSetPut(new Request(`https://site.example/api/media/photoset/put?${q}`, { method: "PUT", headers: { authorization: "Bearer jwt" }, body }), env as never, fetchImpl);
  const done = (body: unknown = { post_id: P, ord: 0 }) =>
    handlePhotoSetDone(new Request("https://site.example/api/media/photoset/done", { method: "POST", headers: { authorization: "Bearer jwt", "content-type": "application/json" }, body: JSON.stringify(body) }), env as never, fetchImpl);
  return { calls, puts, store, env, fetchImpl, put, done };
}

describe("U5 photo-set backfill writer (put)", () => {
  it("stores each planned copy BESIDE the old photo at the exact size, never touching the old photo", async () => {
    const s = setup();
    expect((await s.put("master", webp(2048, 1396))).status).toBe(201);
    expect((await s.put("r1080", webp(1080, 736))).status).toBe(201);
    expect((await s.put("thumb", webp(600, 409))).status).toBe(201);
    expect((await s.put("r320", webp(320, 218))).status).toBe(201);
    expect(s.puts).toEqual([MASTER, MASTER.replace("-l4.webp", "-l4-r1080.webp"), MASTER.replace("-l4.webp", "-l4-thumb.webp"), MASTER.replace("-l4.webp", "-l4-r320.webp")]);
    expect(s.puts).not.toContain(SRC);
  });

  it("refuses wrong dimensions, a non-WebP body, an unplanned slot and bad parameters", async () => {
    const s = setup();
    expect((await s.put("master", webp(2047, 1396))).status).toBe(422);
    expect((await s.put("master", new Uint8Array(64))).status).toBe(415);
    expect((await s.put("r2048", webp(2048, 1396))).status).toBe(400);
    expect((await s.put("master", webp(2048, 1396), `post_id=nope&ord=0&slot=master`)).status).toBe(400);
    expect((await s.put("master", webp(2048, 1396), `post_id=${P}&ord=-1&slot=master`)).status).toBe(400);
    const small = setup({ store: new Map([[SRC, webp(1000, 700, 64)]]) });
    expect((await small.put("r1080", webp(1000, 700))).status).toBe(422); // a 1000 px photo has no 1080 copy
    expect(s.puts).toEqual([]);
    expect(small.puts).toEqual([]);
  });

  it("never overwrites: another object at the key is 409; this copy's exact size is taken as a retry", async () => {
    const other = setup({ store: new Map([[SRC, webp(2170, 1479, 64)], [MASTER, webp(2000, 1396, 10)]]) });
    expect((await other.put("master", webp(2048, 1396, 99))).status).toBe(409);
    const junk = setup({ store: new Map([[SRC, webp(2170, 1479, 64)], [MASTER, new Uint8Array(80)]]) });
    expect((await junk.put("master", webp(2048, 1396))).status).toBe(409);
    const retry = setup({ store: new Map([[SRC, webp(2170, 1479, 64)], [MASTER, webp(2048, 1396, 10)]]) });
    expect((await retry.put("master", webp(2048, 1396, 99))).status).toBe(200);
    expect([...other.puts, ...junk.puts, ...retry.puts]).toEqual([]);
    expect(retry.store.get(MASTER)!.length).toBe(webp(2048, 1396, 10).length); // untouched
  });

  it("refuses when the database names a key outside a member's post-images folder, or a v2 photo", async () => {
    for (const bad of [`avatars/${O}/avatar.webp`, `post-images/${O}/posts/a-w2048h1365-l4.webp`, `post-images/${O}/../x.webp`]) {
      const s = setup({ source: bad, store: new Map([[bad, webp(2170, 1479, 64)]]) });
      expect((await s.put("master", webp(2048, 1396))).status).toBe(500);
      expect(s.puts).toEqual([]);
    }
  });

  it("out of scope or already recorded: nothing is written", async () => {
    const none = setup({ source: null });
    expect((await none.put("master", webp(2048, 1396))).status).toBe(404);
    const done = setup({ done: true });
    expect((await done.put("master", webp(2048, 1396))).status).toBe(200);
    expect([...none.puts, ...done.puts]).toEqual([]);
  });
});

describe("U5 photo-set backfill — done records only a COMPLETE set", () => {
  it("records when every planned copy is in the store, naming the 2048 copy", async () => {
    const s = setup();
    for (const [slot, w, h] of [["master", 2048, 1396], ["r1080", 1080, 736], ["thumb", 600, 409], ["r320", 320, 218]] as const) await s.put(slot, webp(w, h));
    const res = await s.done();
    expect(res.status).toBe(201);
    expect(s.calls.at(-1)).toContain(`"_master_key":"${MASTER}"`);
  });

  it("refuses (and records nothing) while any copy is missing", async () => {
    const s = setup();
    await s.put("master", webp(2048, 1396));
    await s.put("thumb", webp(600, 409));
    const res = await s.done();
    expect(res.status).toBe(409);
    expect(s.calls.some((c) => c.startsWith("record"))).toBe(false);
  });
});

describe("U5 photo-set backfill — claim and source", () => {
  it("claim turns the owner into the credit line (brand for an admin) and passes the cursor", async () => {
    const s = setup({ queue: [
      { post_id: P, ord: 0, source_key: SRC, owner_full_name: "Subhadeep Kumar Chattopadhyay", owner_handle: "sk", owner_is_admin: false },
      { post_id: P, ord: 1, source_key: SRC, owner_full_name: "Neil", owner_handle: null, owner_is_admin: true },
      { post_id: P, ord: 2, source_key: SRC, owner_full_name: "", owner_handle: "", owner_is_admin: false },
    ] });
    const res = await handlePhotoSetClaim(new Request("https://site.example/api/media/photoset/claim", { method: "POST", headers: { authorization: "Bearer jwt" }, body: JSON.stringify({ limit: 5, after: P }) }), s.env as never, s.fetchImpl);
    const body = await res.json() as { jobs: Array<{ credit: string; ord: number }> };
    expect(body.jobs.map((j) => j.credit)).toEqual(["© Subhadeep K. Chattopadhyay, 50mm Retina World", "© 50mm Retina World", "© 50mm Retina World"]);
    expect(s.calls[0]).toContain(`"_after":"${P}"`);
    expect(JSON.stringify(body)).not.toContain("owner_handle");
  });

  it("source serves the old photo's bytes through the binding, read-only", async () => {
    const s = setup();
    const res = await handlePhotoSetSource(new Request(`https://site.example/api/media/photoset/source?post_id=${P}&ord=0`, { headers: { authorization: "Bearer jwt" } }), s.env as never, s.fetchImpl);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(webp(2170, 1479, 64).length);
    expect(JSON.parse(res.headers.get("x-photo-set-plan") ?? "[]")).toEqual([
      { slot: "master", width: 2048, height: 1396, quality: 0.85, credit: true },
      { slot: "r1080", width: 1080, height: 736, quality: 0.82, credit: false },
      { slot: "thumb", width: 600, height: 409, quality: 0.78, credit: false },
      { slot: "r320", width: 320, height: 218, quality: 0.75, credit: false },
    ]);
    expect(s.puts).toEqual([]);
  });
});
