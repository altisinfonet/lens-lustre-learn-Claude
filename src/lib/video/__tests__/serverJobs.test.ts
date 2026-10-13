/**
 * Server conversion (CONVERTER-DESIGN.md v2 §3, §8) · the member's side of a
 * server job, end to end against the REAL member Pages Functions
 * (/source-url, /source-complete, /source-cancel — fake R2 binding, fake
 * Supabase), with the database's member RPCs and the owner's row faked the
 * way 20261012_0002 behaves:
 *   begin → the ORIGINAL goes up with progress (exactly the signed headers)
 *   → complete → the row is polled until the converter is done → READY →
 *   the member watches it and taps Post → video_publish_post with what they
 *   chose (ads: linkAdVideo). A failed row says the database's own words; a
 *   cancel reaches /source-cancel; VID-SRC-001 sends the member back to the
 *   device; a reload resumes from the device's copy.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const invalidated: string[] = [];
vi.mock("@/lib/siteSettingsCache", () => ({
  invalidateSiteSetting: (k: string) => { invalidated.push(k); },
  getSiteSetting: async () => null,
}));

import {
  __resetVideoJobs, __setJobStore, approveServerJob, cancelServerJob, createServerJob, jobsFor, memoryJobStore,
  runServerJob, runVideoJobs, startServerJob, subscribeVideoJobs, uploadProgress, SOURCE_POLL_MS,
  type JobDeps, type JobEvent,
} from "../uploadJobs";
import { startOnServer } from "../startOnServer";
import { handleSourceUrl } from "../../../../functions/api/video/source-url";
import { handleSourceComplete } from "../../../../functions/api/video/source-complete";
import { handleSourceCancel } from "../../../../functions/api/video/source-cancel";
import { sourceKey, type R2BucketLike, type VideoEnv } from "../../../../functions/api/video/_lib";

const OWNER = "11111111-1111-4111-8111-111111111111";
const SRC = "55555555-5555-4555-8555-555555555555";
const VID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-12T12:00:00Z");
const BYTES = 4096;
const DB_TEXT = "This file's format can't be converted. Try exporting it as MP4 and upload again.";

class FakeBucket implements R2BucketLike {
  map = new Map<string, { size: number; etag: string }>();
  deleted: string[] = [];
  async head(k: string) { return this.map.get(k) ?? null; }
  async get() { return null; }
  async put() { /* not used */ }
  async delete(k: string | string[]) { for (const x of Array.isArray(k) ? k : [k]) { this.map.delete(x); this.deleted.push(x); } }
  async list() { return { objects: [], truncated: false }; }
}

type Row = { id: string; status: string; video_id: string | null; error: string | null; bytes: number; key: string };

function server() {
  const bucket = new FakeBucket();
  const db = {
    source: null as Row | null,
    videoState: "checking",
    beginRefusal: null as string | null,
    begins: [] as Record<string, unknown>[],
    publishes: [] as Record<string, unknown>[],
    links: [] as Array<{ creative: string; video: string; categories: string[] }>,
    deleted: [] as string[],
    uploads: [] as Array<{ url: string; headers: Record<string, string>; size: number }>,
    rowReads: 0,
  };
  const env: VideoEnv = {
    SUPABASE_PROJECT_REF: "testref", SUPABASE_ANON_KEY: "anon", MEDIA: bucket,
    R2_ACCOUNT_ID: "acct123", R2_BUCKET: "media-staging", R2_UPLOAD_KEY_ID: "AKIDTEST", R2_UPLOAD_KEY_SECRET: "secret", VIDEO_DELIVERY_PRIVATE: "1",
  };
  // Supabase as the Functions see it: the member's JWT, their own row through RLS, the two member RPCs.
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.endsWith("/auth/v1/user")) return ok({ id: OWNER });
    if (url.includes("/rest/v1/video_sources?")) return ok(db.source ? [{ id: db.source.id, owner_id: OWNER, status: db.source.status, source_bytes: db.source.bytes }] : []);
    if (url.endsWith("/rpc/video_source_uploaded")) {
      const body = JSON.parse(String(init?.body));
      if (db.source!.status === "awaiting_upload") db.source!.status = "queued";
      return ok({ status: db.source!.status, etag: body._etag });
    }
    if (url.endsWith("/rpc/video_source_cancel")) {
      if (["done", "failed", "cancelled"].includes(db.source!.status)) return ok(db.source!.status);
      db.source!.status = "cancelled";
      return ok("cancelled");
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  let clock = NOW.getTime();
  let putAnswers: number[] = [];
  let hold: Promise<void> | null = null;
  const deps: JobDeps = {
    rpc: async (fn, args) => {
      if (fn === "video_source_begin") {
        db.begins.push(args);
        if (db.beginRefusal) return { data: null, error: { message: db.beginRefusal, code: "42501" } };
        if (!db.source) db.source = { id: SRC, status: "awaiting_upload", video_id: null, error: null, bytes: Number(args._source_bytes), key: String(args._idempotency_key) };
        return { data: { source_id: db.source.id, status: db.source.status, video_id: db.source.video_id, replayed: db.begins.length > 1 }, error: null };
      }
      if (fn === "video_publish_post") {
        if (db.videoState !== "ready") return { data: null, error: { message: "VID-LINK-001: post_videos needs a ready post video", code: "23514" } };
        db.publishes.push(args);
        return { data: "post-1", error: null };
      }
      if (fn === "video_delete") { db.deleted.push(String(args._video_id)); return { data: "deleted", error: null }; }
      return { data: null, error: { message: `no such rpc ${fn}` } };
    },
    videoState: async () => db.videoState,
    linkAdVideo: async (creative, video, categories) => { db.links.push({ creative, video, categories }); return { error: null }; },
    api: async (path, body) => {
      const req = new Request(`https://app.test${path}`, { method: "POST", headers: { authorization: "Bearer owner-jwt" }, body: JSON.stringify(body) });
      const res = path.endsWith("/source-url") ? await handleSourceUrl(req, env, NOW, fetchImpl)
        : path.endsWith("/source-complete") ? await handleSourceComplete(req, env, fetchImpl)
        : path.endsWith("/source-cancel") ? await handleSourceCancel(req, env, fetchImpl)
        : new Response("{}", { status: 404 });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    put: async () => { throw new Error("a server job never uses the device PUT"); },
    upload: async (url, headers, data, onProgress, signal) => {
      db.uploads.push({ url, headers: { ...headers }, size: data.size });
      for (const f of [0.25, 0.5, 0.75]) onProgress(Math.floor(data.size * f), data.size);
      if (hold) {
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("The upload was cancelled", "AbortError")));
          void hold!.then(resolve);
        });
      }
      const status = putAnswers.shift() ?? 200;
      if (status === 200) {
        const key = decodeURIComponent(new URL(url).pathname.split("/").slice(2).join("/"));
        bucket.map.set(key, { size: data.size, etag: `etag${data.size}` });
        onProgress(data.size, data.size);
      }
      return status;
    },
    sourceRow: async (id) => {
      db.rowReads++;
      return db.source && db.source.id === id ? { status: db.source.status, video_id: db.source.video_id, error: db.source.error } : null;
    },
    online: () => true,
    now: () => clock,
  };
  return {
    db, bucket, deps,
    tick: (ms: number) => { clock += ms; },
    answerPutsWith: (...s: number[]) => { putAnswers = s; },
    holdUpload: () => { let release!: () => void; hold = new Promise<void>((r) => { release = r; }); return () => { hold = null; release(); }; },
    converterFinishes: () => { db.source!.status = "done"; db.source!.video_id = VID; },
  };
}

const file = () => new Blob([new Uint8Array(BYTES)], { type: "video/quicktime" });
const POST = { content: "Sunset over the Hooghly", categories: ["street", "travel"], privacy: "friends" };
const only = async () => (await jobsFor(OWNER))[0];

/** startOnServer, then wait for its first run to stop — deterministic, unlike watching the store. */
async function start(s: ReturnType<typeof server>, over: Partial<Parameters<typeof startOnServer>[0]> = {}) {
  const r = await startOnServer({ userId: OWNER, purpose: "post", file: file(), name: "clip.mov", post: POST, ...over }, s.deps);
  if (r.kind === "started") await r.running;
  return r;
}

let store: ReturnType<typeof memoryJobStore>;
let events: JobEvent[];
beforeEach(() => {
  __resetVideoJobs();
  store = memoryJobStore();
  __setJobStore(store);
  events = [];
  subscribeVideoJobs((e) => events.push(e));
  invalidated.length = 0;
});

describe("server conversion · the member's job", () => {
  it("begin → the original goes up with progress, exactly the signed headers → complete → queued", async () => {
    const s = server();
    const r = await start(s);
    expect(r.kind).toBe("started");
    expect(s.db.rowReads).toBe(0); // nothing to ask the instant it is queued: the first look is SOURCE_POLL_MS later

    expect(s.db.begins).toEqual([{ _purpose: "post", _source_bytes: BYTES, _idempotency_key: (await only()).id }]);
    expect(s.db.uploads).toHaveLength(1);
    const put = s.db.uploads[0];
    expect(new URL(put.url).pathname).toBe(`/media-staging/upload/source/${SRC}/source`);
    expect(put.headers).toEqual({ "content-type": "application/octet-stream" }); // nothing more, nothing less
    expect(put.size).toBe(BYTES);
    expect(s.bucket.map.has(sourceKey(SRC))).toBe(true);
    expect(s.db.source!.status).toBe("queued");

    const pct = events.filter((e) => e.type === "progress").map((e) => e.type === "progress" ? Math.floor((e.sent / e.total) * 100) : -1);
    expect(pct[0]).toBe(0);
    expect(pct.at(-1)).toBe(100);
    expect([...pct].sort((a, b) => a - b)).toEqual(pct); // only ever forward
    expect(uploadProgress((await only()).id)).toBeUndefined(); // done: nothing "going up" any more
    // The original is on our server now: the device's copy is gone.
    expect([...store.files.keys()]).toEqual([]);
    const j = await only();
    expect(j.mode).toBe("server");
    expect(j.post).toMatchObject(POST);
    expect(j.nextAt).toBe(NOW.getTime() + SOURCE_POLL_MS);
  });

  it("the runner goes by the job's FRESH nextAt: a poll another run just made is not made again", async () => {
    const s = server();
    await start(s);
    const id = (await only()).id;
    const reads = s.db.rowReads;
    await runServerJob(id, s.deps, true); // the runner's call: not due yet
    expect(s.db.rowReads).toBe(reads);
    await runServerJob(id, s.deps); // a member's own action (Post, the composer) goes at once
    expect(s.db.rowReads).toBe(reads + 1);
  });

  it("polls its own row (no sooner than SOURCE_POLL_MS) until done, waits for READY, then waits for the member", async () => {
    const s = server();
    await start(s);

    const reads = s.db.rowReads;
    await runVideoJobs(OWNER, s.deps);
    expect(s.db.rowReads).toBe(reads); // not due yet: no request

    s.tick(SOURCE_POLL_MS);
    s.db.source!.status = "converting";
    await runVideoJobs(OWNER, s.deps);
    expect(s.db.rowReads).toBe(reads + 1);
    expect((await only()).step).toBe("converting");

    s.tick(SOURCE_POLL_MS);
    s.converterFinishes();
    await runVideoJobs(OWNER, s.deps); // done → its video, still checking (the music check)
    expect(await only()).toMatchObject({ step: "checking", videoId: VID });

    s.tick(15_000);
    s.db.videoState = "ready";
    await runVideoJobs(OWNER, s.deps);
    expect((await only()).step).toBe("review"); // never published by the server (design §3.9)
    expect(s.db.publishes).toEqual([]);

    s.tick(60_000);
    await runVideoJobs(OWNER, s.deps);
    expect(s.db.publishes).toEqual([]);
    expect((await only()).step).toBe("review");
  });

  it("the member taps Post → video_publish_post with the caption, categories and audience they chose; the job is done", async () => {
    const s = server();
    await start(s);
    s.converterFinishes();
    s.db.videoState = "ready";
    const j = await only();
    await runServerJob(j.id, s.deps);
    expect((await only()).step).toBe("review");

    await approveServerJob(j.id, s.deps);
    expect(s.db.publishes).toEqual([{
      _video_id: VID, _content: POST.content, _privacy: POST.privacy, _categories: POST.categories, _idempotency_key: j.post.idempotencyKey,
    }]);
    expect(await jobsFor(OWNER)).toEqual([]);
    expect(events.some((e) => e.type === "published" && e.job.postId === "post-1")).toBe(true);
  });

  it("an AD video goes on its creative (linkAdVideo) after the admin's look, never into a post", async () => {
    const s = server();
    await start(s, { purpose: "ad", name: "ad.mp4", post: { content: "", categories: ["travel"], privacy: "public" }, ad: { creativeId: "creative-9" } });
    expect(s.db.begins[0]._purpose).toBe("ad");
    s.converterFinishes();
    s.db.videoState = "ready";
    const j = await only();
    await runServerJob(j.id, s.deps);
    await approveServerJob(j.id, s.deps);
    expect(s.db.links).toEqual([{ creative: "creative-9", video: VID, categories: ["travel"] }]);
    expect(s.db.publishes).toEqual([]);
    expect(await jobsFor(OWNER)).toEqual([]);
  });

  it("a failed conversion says the database's own text, word for word, and stops", async () => {
    const s = server();
    await start(s, { name: "clip.avi" });
    s.db.source!.status = "failed";
    s.db.source!.error = DB_TEXT;
    s.tick(SOURCE_POLL_MS);
    await runVideoJobs(OWNER, s.deps);
    const j = await only();
    expect(j).toMatchObject({ step: "failed", lastError: DB_TEXT, errorCode: "VID-SRC-FAILED" });
    expect(events.filter((e) => e.type === "failed")).toHaveLength(1);
    s.tick(10 * SOURCE_POLL_MS);
    const reads = s.db.rowReads;
    await runVideoJobs(OWNER, s.deps);
    expect(s.db.rowReads).toBe(reads); // final: never asked again
  });

  it("Cancel while it is being prepared → POST /api/video/source-cancel; the original is deleted and the job is gone", async () => {
    const s = server();
    await start(s);
    const j = await only();
    expect(await cancelServerJob(j.id, s.deps)).toBe(true);
    expect(s.db.source!.status).toBe("cancelled");
    expect(s.bucket.deleted).toContain(sourceKey(SRC));
    expect(await jobsFor(OWNER)).toEqual([]);
    expect(events.some((e) => e.type === "removed" && e.job.id === j.id)).toBe(true);
  });

  it("Cancel DURING the upload stops the PUT, and the stopped run never brings the job back", async () => {
    const s = server();
    const release = s.holdUpload();
    const job = await createServerJob({ userId: OWNER, purpose: "post", file: file(), name: "clip.mov", post: POST });
    await startServerJob(job, s.deps);
    const run = runServerJob(job.id, s.deps);
    await vi.waitFor(() => expect(s.db.uploads).toHaveLength(1));
    expect(uploadProgress(job.id)).toBeDefined();
    expect(await cancelServerJob(job.id, s.deps)).toBe(true);
    await run;
    release();
    expect(await jobsFor(OWNER)).toEqual([]);
    expect(events.some((e) => e.type === "failed")).toBe(false);
    expect(s.db.source!.status).toBe("cancelled");
  });

  it("a Cancel the server could not hear keeps the job (nothing is left behind unseen)", async () => {
    const s = server();
    await start(s);
    const realApi = s.deps.api;
    s.deps.api = async (path, body) => (path.endsWith("/source-cancel") ? { status: 503, body: {} } : realApi(path, body));
    expect(await cancelServerJob((await only()).id, s.deps)).toBe(false);
    expect((await only()).step).toBe("converting");
  });

  it("Discard of a READY video the member decided not to post deletes it (nobody else would post it)", async () => {
    const s = server();
    await start(s);
    s.converterFinishes();
    s.db.videoState = "ready";
    const j = await only();
    await runServerJob(j.id, s.deps);
    expect(await cancelServerJob(j.id, s.deps)).toBe(true);
    expect(s.db.deleted).toEqual([VID]);
    expect(s.db.publishes).toEqual([]);
  });

  it("VID-SRC-001 (server mode switched off meanwhile): nothing is kept, the setting is read again, the caller offers the device", async () => {
    const s = server();
    s.db.beginRefusal = "VID-SRC-001: server conversion is switched off on this site";
    const r = await startOnServer({ userId: OWNER, purpose: "post", file: file(), name: "clip.mov", post: POST }, s.deps);
    expect(r).toEqual({ kind: "switched_off" });
    expect(await jobsFor(OWNER)).toEqual([]);
    expect(s.db.uploads).toEqual([]);
    expect(invalidated).toEqual(["video_conversion"]);
  });

  it("any other refusal is said in plain words (no code), and nothing is kept", async () => {
    const s = server();
    s.db.beginRefusal = "VID-SRC-003: two videos are already waiting to be converted — wait for one to finish";
    const r = await startOnServer({ userId: OWNER, purpose: "post", file: file(), name: "clip.mov", post: POST }, s.deps);
    expect(r).toEqual({ kind: "refused", message: "two videos are already waiting to be converted — wait for one to finish" });
    expect(await jobsFor(OWNER)).toEqual([]);
  });

  it("an expired URL (403) gets a fresh one; the same headers again", async () => {
    const s = server();
    s.answerPutsWith(403, 200);
    await start(s);
    expect(s.db.uploads).toHaveLength(2);
    expect(s.db.uploads.map((u) => u.headers)).toEqual([{ "content-type": "application/octet-stream" }, { "content-type": "application/octet-stream" }]);
  });

  it("an answer lost after complete: begin replays the same source and the job goes straight to the poll (no second upload)", async () => {
    const s = server();
    const job = await createServerJob({ userId: OWNER, purpose: "post", file: file(), name: "clip.mov", post: POST });
    await startServerJob(job, s.deps);
    s.db.source!.status = "queued"; // uploaded and queued by an earlier run whose answers never arrived
    await runServerJob(job.id, s.deps);
    expect(s.db.uploads).toEqual([]);
    expect((await only()).step).toBe("converting");
  });

  it("a reload mid-upload resumes from the device's own copy of the original", async () => {
    const s = server();
    const job = await createServerJob({ userId: OWNER, purpose: "post", file: file(), name: "clip.mov", post: POST });
    await startServerJob(job, s.deps);
    // "Reload": this session's memory is gone; the job and its copy are still on the device.
    __resetVideoJobs();
    __setJobStore(store);
    expect([...store.files.keys()]).toEqual([`${job.id}/source`]);
    await runVideoJobs(OWNER, s.deps);
    expect(s.db.uploads.map((u) => u.size)).toEqual([BYTES]);
    expect((await only()).step).toBe("converting");
  });
});
