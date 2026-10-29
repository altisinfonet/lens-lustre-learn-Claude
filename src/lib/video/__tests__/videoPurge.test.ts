/**
 * S7-a · POST /api/video/purge — the video file deleter, with a fake R2 binding
 * and a fake Supabase. The database decides WHICH rows may go (PROBE
 * 20261030_0700); this proves the route deletes exactly those folders, never
 * a neighbour, is idempotent, and records an error instead of guessing.
 */
import { describe, it, expect } from "vitest";
import { emptyFolder, handlePurge, purgeFolders } from "../../../../functions/api/video/purge";
import type { R2BucketLike, VideoEnv } from "../../../../functions/api/video/_lib";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const VID = "33333333-3333-4333-8333-333333333333";
const VID2 = "44444444-4444-4444-8444-444444444444";

class FakeBucket implements R2BucketLike {
  keys = new Set<string>();
  pageSize = 1000;
  deleteCalls = 0;
  async list(o: { prefix: string; cursor?: string }) {
    const all = [...this.keys].filter((k) => k.startsWith(o.prefix)).sort();
    const from = o.cursor ? Number(o.cursor) : 0;
    const page = all.slice(from, from + this.pageSize);
    const more = from + this.pageSize < all.length;
    return { objects: page.map((key) => ({ key, size: 1 })), truncated: more, cursor: more ? String(from + this.pageSize) : undefined };
  }
  async head() { return null; }
  async get() { return null; }
  async put(k: string) { this.keys.add(k); }
  async delete(k: string | string[]) { this.deleteCalls++; for (const x of Array.isArray(k) ? k : [k]) this.keys.delete(x); }
}

function setup(rows: Array<Record<string, unknown>>, opts: { authOk?: boolean; claimError?: boolean } = {}) {
  const bucket = new FakeBucket();
  const dones: Array<Record<string, unknown>> = [];
  const env: VideoEnv = { SUPABASE_PROJECT_REF: "testref", SUPABASE_ANON_KEY: "anon", MEDIA: bucket };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/auth/v1/user")) {
      return opts.authOk === false ? new Response("{}", { status: 401 }) : new Response(JSON.stringify({ id: OWNER }), { status: 200 });
    }
    if (url.endsWith("/rest/v1/rpc/video_purge_claim")) {
      if (opts.claimError) return new Response(JSON.stringify({ message: "VID-PURGE-001: only an admin or the converter" }), { status: 403 });
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (url.endsWith("/rest/v1/rpc/video_purge_done")) {
      dones.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify("deleted"), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  const call = (body: unknown = {}) =>
    handlePurge(new Request("https://site.test/api/video/purge", { method: "POST", headers: { authorization: "Bearer jwt", "content-type": "application/json" }, body: JSON.stringify(body) }), env, fetchImpl);
  return { bucket, dones, call };
}

const whole = { id: 1, video_id: VID, owner_id: OWNER, prefix: `video/${OWNER}/${VID}/`, whole: true };

describe("S7-a purgeFolders — the only folders a row may empty", () => {
  it("a whole video: its served folder and its upload leftovers", () => {
    expect(purgeFolders(whole)).toEqual([`video/${OWNER}/${VID}/`, `upload/video/${OWNER}/${VID}/`]);
  });
  it("one version: that version's folder only", () => {
    expect(purgeFolders({ ...whole, prefix: `video/${OWNER}/${VID}/v2/`, whole: false })).toEqual([`video/${OWNER}/${VID}/v2/`]);
  });
  it("refuses anything else", () => {
    for (const prefix of ["video/", `video/${OWNER}/`, `photo/${OWNER}/${VID}/`, `video/${OTHER}/${VID}/`, `video/${OWNER}/${VID2}/`,
      `video/${OWNER}/${VID}/v0/`, `video/${OWNER}/${VID}/../`, `video/${OWNER}/${VID}`, `upload/video/${OWNER}/${VID}/`]) {
      expect(purgeFolders({ ...whole, prefix }), prefix).toBeNull();
    }
    expect(purgeFolders({ ...whole, whole: false })).toBeNull();
  });
});

describe("S7-a emptyFolder", () => {
  it("deletes every object under the prefix across pages, and nothing beside it", async () => {
    const b = new FakeBucket();
    b.pageSize = 3;
    for (let i = 0; i < 8; i++) await b.put(`video/${OWNER}/${VID}/v1/seg${i}.m4s`);
    await b.put(`video/${OWNER}/${VID2}/v1/seg0.m4s`);
    await b.put(`video/${OWNER}/${VID}x/keep.m4s`);
    expect(await emptyFolder(b, `video/${OWNER}/${VID}/`)).toBe(8);
    expect([...b.keys].sort()).toEqual([`video/${OWNER}/${VID}x/keep.m4s`, `video/${OWNER}/${VID2}/v1/seg0.m4s`]);
    expect(await emptyFolder(b, `video/${OWNER}/${VID}/`)).toBe(0);
  });
});

describe("S7-a POST /api/video/purge", () => {
  it("QUEUED → DELETED: empties the claimed folder (+ upload leftovers) and records the count", async () => {
    const w = setup([whole]);
    for (const f of ["master.m3u8", "poster.jpg", "v1/seg0.m4s"]) await w.bucket.put(`video/${OWNER}/${VID}/${f}`);
    await w.bucket.put(`upload/video/${OWNER}/${VID}/v1/seg1.m4s`);
    await w.bucket.put(`video/${OWNER}/${VID2}/master.m3u8`); // another video of the same member: referenced, not claimed
    const res = await w.call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: 1, done: [{ id: 1, objects: 4 }], failed: [] });
    expect([...w.bucket.keys]).toEqual([`video/${OWNER}/${VID2}/master.m3u8`]);
    expect(w.dones).toEqual([{ _id: 1, _objects: 4, _error: null }]);
  });

  it("idempotent: the same row again deletes nothing and still closes", async () => {
    const w = setup([whole]);
    const res = await w.call();
    expect(await res.json()).toEqual({ claimed: 1, done: [{ id: 1, objects: 0 }], failed: [] });
  });

  it("a prefix that is not the row's own folder is never touched — recorded as an error", async () => {
    const w = setup([{ ...whole, prefix: `video/${OTHER}/${VID}/` }]);
    await w.bucket.put(`video/${OTHER}/${VID}/master.m3u8`);
    const body = await (await w.call()).json();
    expect(body.done).toEqual([]);
    expect(body.failed[0].id).toBe(1);
    expect(w.bucket.keys.size).toBe(1);
    expect(w.dones[0]).toMatchObject({ _id: 1, _objects: 0 });
    expect(String(w.dones[0]._error)).toMatch(/refused/);
  });

  it("a storage error is recorded (lease released for a retry), not swallowed", async () => {
    const w = setup([whole]);
    w.bucket.list = async () => { throw new Error("R2 list 500"); };
    const body = await (await w.call()).json();
    expect(body.failed).toEqual([{ id: 1, error: "R2 list 500" }]);
    expect(w.dones).toEqual([{ _id: 1, _objects: 0, _error: "R2 list 500" }]);
  });

  it("the database's refusal (not admin / converter) passes through; nothing is deleted", async () => {
    const w = setup([whole], { claimError: true });
    await w.bucket.put(`video/${OWNER}/${VID}/master.m3u8`);
    const res = await w.call();
    expect(res.status).toBe(409);
    expect(w.bucket.keys.size).toBe(1);
  });

  it("signed out → 401, and GET → 405", async () => {
    expect((await setup([whole], { authOk: false }).call()).status).toBe(401);
    const w = setup([whole]);
    const res = await handlePurge(new Request("https://site.test/api/video/purge"), { SUPABASE_PROJECT_REF: "t", SUPABASE_ANON_KEY: "a", MEDIA: w.bucket });
    expect(res.status).toBe(405);
  });
});
