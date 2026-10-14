/**
 * VID-1 §3 · the device-side upload job, end to end against the REAL Pages
 * Function handlers (fake R2 binding, fake Supabase), with the link dropping
 * in the middle and the app "restarting" between runs.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { fakePackage } from "./fixtures";
import {
  __resetVideoJobs, __setJobStore, advanceJob, clearVideoUploads, createJob, jobsFor, memoryJobStore, runVideoJobs,
  type JobDeps, type VideoJob,
} from "../uploadJobs";
import { handleUploadUrls } from "../../../../functions/api/video/upload-urls";
import { handleComplete } from "../../../../functions/api/video/complete";
import type { R2BucketLike, VideoEnv } from "../../../../functions/api/video/_lib";
import type { AttestEnv } from "../../../../functions/api/video/attest";
import { SERVED_PREFIX, totalBytes } from "../shared/rules";
import type { HlsPackage } from "../hlsPackager";

const OWNER = "11111111-1111-4111-8111-111111111111";
const VID = "33333333-3333-4333-8333-333333333333";

class Bucket implements R2BucketLike {
  map = new Map<string, Uint8Array>();
  meta = new Map<string, Record<string, string>>();
  /** R2 returns at most 1,000 keys per list call; tests lower this to exercise the cursor. */
  pageSize = 1000;
  listCalls = 0;
  async list(o: { prefix: string; cursor?: string; include?: string[] }) {
    this.listCalls++;
    const keys = [...this.map.keys()].filter((k) => k.startsWith(o.prefix)).sort();
    const from = o.cursor ? Number(o.cursor) : 0;
    const page = keys.slice(from, from + this.pageSize);
    return {
      objects: page.map((key) => ({
        key, size: this.map.get(key)!.length,
        ...(o.include?.includes("customMetadata") ? { customMetadata: this.meta.get(key) ?? {} } : {}),
      })),
      truncated: from + this.pageSize < keys.length,
      cursor: from + this.pageSize < keys.length ? String(from + this.pageSize) : undefined,
    };
  }

  async head(k: string) { const v = this.map.get(k); return v ? { size: v.length } : null; }
  async get(k: string) { const v = this.map.get(k); return v ? { size: v.length, arrayBuffer: async () => v.slice().buffer } : null; }
  async put(k: string, v: ArrayBuffer | Uint8Array | string, o?: { customMetadata?: Record<string, string> }) {
    this.map.set(k, typeof v === "string" ? new TextEncoder().encode(v) : new Uint8Array(v as ArrayBuffer).slice());
    if (o?.customMetadata) this.meta.set(k, o.customMetadata); else this.meta.delete(k);
  }
  async delete(k: string | string[]) { for (const x of Array.isArray(k) ? k : [k]) { this.map.delete(x); this.meta.delete(x); } }
}

/** A tiny server: the video row, its version, posts, post_videos — with D1's uniqueness rules. */
function server(pkg: HlsPackage) {
  const db = {
    videos: new Map<string, { id: string; key: string; state: string; manifest_sha256: string }>(),
    posts: new Map<string, { id: string; key: string; categories: string[] }>(),
    postVideos: new Map<string, string>(),
    adVideos: new Map<string, { video: string; categories: string[] }>(),
    beginCalls: 0, puts: [] as string[],
  };
  const bucket = new Bucket();
  // F-D1-4: a configured lane carries its attest key + lane word, or complete answers 503 (by design).
  const env: VideoEnv & AttestEnv = {
    VIDEO_COMPLETE_ATTEST_KEY: "upload-job-test-attest-key-0123456789", VIDEO_ATTEST_LANE: "staging",
    SUPABASE_PROJECT_REF: "ref", SUPABASE_ANON_KEY: "anon", MEDIA: bucket,
    R2_ACCOUNT_ID: "acct", R2_BUCKET: "b", R2_UPLOAD_KEY_ID: "k", R2_UPLOAD_KEY_SECRET: "s", VIDEO_DELIVERY_PRIVATE: "1",
  };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    const v = db.videos.get(VID);
    if (url.endsWith("/auth/v1/user")) return ok({ id: OWNER });
    if (url.includes("/rest/v1/videos?")) return ok(v ? [{ id: VID, owner_id: OWNER, state: v.state, current_version: 1, purpose: "post" }] : []);
    // Like the real database: manifest_sha256 / total_bytes are not readable directly (0005);
    // they come from the owner-only RPC (20261011_0001).
    if (url.includes("/rest/v1/video_versions?") && /manifest_sha256|total_bytes/.test(url)) return new Response(JSON.stringify({ message: "permission denied for table video_versions" }), { status: 403 });
    if (url.endsWith("/rest/v1/rpc/video_upload_info")) return ok(v ? [{ manifest_sha256: v.manifest_sha256, total_bytes: totalBytes(pkg.manifest), declared_duration_s: pkg.manifest.duration_s, has_audio: pkg.manifest.has_audio }] : []);
    if (url.endsWith("/rpc/video_mark_uploaded")) { v!.state = "checking"; return ok({ state: "checking" }); }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  let online = true;
  let failPutAfter = Infinity;
  /**
   * video_publish_post (20261011_0003), as the database does it: one
   * transaction — the post and its link are written together or not at all —
   * and the same key returns the post that key already made.
   */
  const publish = (args: Record<string, unknown>) => {
    const key = String(args._idempotency_key);
    const videoId = String(args._video_id);
    const prior = [...db.posts.values()].find((p) => p.key === key);
    if (prior) {
      const linked = db.postVideos.get(prior.id);
      if (linked && linked !== videoId) return { data: null, error: { message: "VID-PUB-003: this publish key already belongs to another video", code: "23505" } };
      if (!linked) db.postVideos.set(prior.id, videoId);
      return { data: prior.id, error: null };
    }
    const cats = (args._categories as string[] | null) ?? [];
    if (db.videos.get(videoId)?.state !== "ready") return { data: null, error: { message: "VID-LINK-001: post_videos needs a ready post video", code: "23514" } };
    if (cats.length < 1 || cats.length > 5) return { data: null, error: { message: "VID-CAT-001: a video post needs between 1 and 5 categories", code: "23514" } };
    if ([...db.postVideos.values()].includes(videoId)) return { data: null, error: { message: "duplicate key value violates unique constraint \"post_videos_video_id_key\"", code: "23505" } };
    const id = `post-${db.posts.size + 1}`;
    db.posts.set(id, { id, key, categories: cats });
    db.postVideos.set(id, videoId);
    return { data: id, error: null };
  };
  const deps: JobDeps = {
    rpc: async (fn, args) => {
      if (fn === "video_publish_post") return publish(args);
      if (fn !== "video_begin_upload") return { data: null, error: { message: "no such rpc" } };
      db.beginCalls++;
      const existing = [...db.videos.values()].find((x) => x.key === args._idempotency_key);
      if (existing) return { data: { video_id: existing.id, version_no: 1, replayed: true }, error: null };
      // a NEW key is a NEW video (as D1's videos_owner_idempotency_key makes it)
      const id = db.videos.size === 0 ? VID : `44444444-4444-4444-8444-${String(db.videos.size).padStart(12, "0")}`;
      db.videos.set(id, { id, key: String(args._idempotency_key), state: "uploading", manifest_sha256: String(args._manifest_sha256) });
      return { data: { video_id: id, version_no: 1, replayed: false }, error: null };
    },
    videoState: async (id) => db.videos.get(id)?.state ?? null,
    // ad_videos as the database has it: PK ad_creative_id (upsert), the video READY (link guard), 1–5 categories.
    linkAdVideo: async (creativeId, videoId, categories) => {
      if (db.videos.get(videoId)?.state !== "ready") return { error: { message: "VID-LINK-001: ad_videos needs a ready ad video", code: "23514" } };
      if (categories.length < 1 || categories.length > 5) return { error: { message: "ad_videos_categories_1_5", code: "23514" } };
      db.adVideos.set(creativeId, { video: videoId, categories });
      return { error: null };
    },
    api: async (path, body) => {
      const req = new Request(`https://app.test${path}`, { method: "POST", headers: { authorization: "Bearer jwt" }, body: JSON.stringify(body) });
      const res = path.endsWith("upload-urls") ? await handleUploadUrls(req, env, new Date(), fetchImpl) : await handleComplete(req, env, fetchImpl);
      return { status: res.status, body: await res.json() as Record<string, unknown> };
    },
    put: async (url, _headers, data) => {
      if (db.puts.length >= failPutAfter) throw new TypeError("Failed to fetch");
      const key = decodeURIComponent(new URL(url).pathname.split("/").slice(2).join("/"));
      db.puts.push(key);
      bucket.map.set(key, await blobBytes(data));
      return 200;
    },
    online: () => online,
    now: () => Date.now(),
  };
  return {
    db, bucket, deps,
    setOnline: (v: boolean) => { online = v; },
    dropAfterPuts: (n: number) => { failPutAfter = n; },
    heal: () => { failPutAfter = Infinity; },
    musicCheckPasses: () => { db.videos.get(VID)!.state = "ready"; },
  };
}

/** jsdom's Blob has no arrayBuffer(); FileReader works. */
function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(b);
  });
}

let pkg: HlsPackage;
beforeEach(async () => {
  __resetVideoJobs();
  __setJobStore(memoryJobStore());
  pkg = await fakePackage({ seconds: 10 });
});

async function newJob(): Promise<VideoJob> {
  return createJob({
    userId: OWNER, purpose: "post", manifest: pkg.manifest, manifestSha256: pkg.manifestSha256, files: pkg.files,
    post: { content: "first video", categories: ["street"], privacy: "public" },
  });
}

describe("VID-1 · the device upload job", () => {
  it("encoded → uploaded → checking → ready → ONE post linked to the video", async () => {
    const s = server(pkg);
    let j = await newJob();
    j = await advanceJob(j, s.deps);
    expect(j.lastError).toBeUndefined();
    expect(j.step).toBe("checking");
    expect([...s.bucket.map.keys()].filter((k) => k.startsWith(SERVED_PREFIX)).length).toBe(pkg.files.size);
    s.musicCheckPasses();
    j = await advanceJob(j, s.deps);
    expect(j.step).toBe("published");
    expect(s.db.posts.size).toBe(1);
    expect([...s.db.postVideos.values()]).toEqual([VID]);
    expect(await jobsFor(OWNER)).toEqual([]); // job and files gone from the device
  });

  it("the link drops mid-upload: the job keeps what was sent and resumes with only the missing files", async () => {
    const s = server(pkg);
    s.dropAfterPuts(5);
    let j = await newJob();
    j = await advanceJob(j, s.deps);
    expect(j.step).toBe("begun");
    expect(j.uploaded.length).toBe(5);
    expect(j.attempts).toBe(1);
    s.heal();
    j = await advanceJob({ ...j, nextAt: 0 }, s.deps); // "restart": same job record, from the store
    expect(j.step).toBe("checking");
    expect(s.db.puts.length).toBe(pkg.files.size); // nothing uploaded twice
    expect(new Set(s.db.puts).size).toBe(pkg.files.size);
  });

  it("offline: nothing is sent and nothing is lost", async () => {
    const s = server(pkg);
    s.setOnline(false);
    const j = await advanceJob(await newJob(), s.deps);
    expect(j.step).toBe("encoded");
    expect(s.db.beginCalls).toBe(0);
    expect((await jobsFor(OWNER)).length).toBe(1);
  });

  it("the video key is made once: a replayed begin returns the same video, never a second", async () => {
    const s = server(pkg);
    const j = await newJob();
    await advanceJob(j, s.deps);
    await advanceJob(j, s.deps); // the same "encoded" record again, as after a crash before the save
    expect(s.db.beginCalls).toBe(2);
    expect(s.db.videos.size).toBe(1);
  });

  it("the post key is made once: a publish retried after a lost answer is still ONE post, with its video", async () => {
    const s = server(pkg);
    let j = await advanceJob(await newJob(), s.deps);
    s.musicCheckPasses();
    const realRpc = s.deps.rpc;
    s.deps.rpc = async (fn, args) => {
      if (fn !== "video_publish_post") return realRpc(fn, args);
      await realRpc(fn, args); // the database published it…
      throw new TypeError("Failed to fetch"); // …and the answer was lost
    };
    j = await advanceJob(j, s.deps);
    expect(j.step).toBe("ready"); // kept, to retry
    expect(s.db.posts.size).toBe(1);
    expect(s.db.postVideos.size).toBe(1); // never a post without its video
    s.deps.rpc = realRpc;
    j = await advanceJob({ ...j, nextAt: 0 }, s.deps);
    expect(j.step).toBe("published");
    expect(s.db.posts.size).toBe(1);
    expect(s.db.postVideos.size).toBe(1);
  });

  it("a refused publish leaves NO post behind (one transaction) and is said out loud", async () => {
    const s = server(pkg);
    let j = await newJob();
    j = { ...j, post: { ...j.post, categories: [] } }; // the database refuses: VID-CAT-001
    j = await advanceJob(j, s.deps);
    s.musicCheckPasses();
    j = await advanceJob(j, s.deps);
    expect(j.step).toBe("failed");
    expect(j.lastError).toMatch(/VID-CAT-001/);
    expect(s.db.posts.size).toBe(0);
    expect(s.db.postVideos.size).toBe(0);
  });

  it("a refusal from the server is final and said out loud (never retried for ever)", async () => {
    const s = server(pkg);
    s.deps.rpc = async () => ({ data: null, error: { message: "VID-UP-003: video posts are not enabled for this member" } });
    const j = await advanceJob(await newJob(), s.deps);
    expect(j.step).toBe("failed");
    expect(j.lastError).toMatch(/VID-UP-003/);
  });

  it("a music match parks the job for the remedy screen; nothing is posted", async () => {
    const s = server(pkg);
    let j = await advanceJob(await newJob(), s.deps);
    s.db.videos.get(VID)!.state = "music_blocked";
    j = await advanceJob(j, s.deps);
    expect(j.step).toBe("music_blocked");
    expect(s.db.posts.size).toBe(0);
  });

  it("review #423 (1): sign-out during a run — the PUT in flight never writes the job back, and the run does not carry the member's other jobs on", async () => {
    const s = server(pkg);
    const store = memoryJobStore();
    __setJobStore(store);
    await newJob();
    await newJob();
    let wiped: Promise<boolean> | undefined;
    // Sign-out lands while the first file is going up; the link drops with it.
    s.deps.put = async () => { wiped ??= clearVideoUploads(); await wiped; throw new TypeError("Failed to fetch"); };
    await runVideoJobs(OWNER, s.deps);
    expect(await wiped).toBe(true);
    expect(s.db.beginCalls).toBe(1); // the second job was never begun for a member who has left
    expect([...store.jobs.values()]).toEqual([]);
    expect([...store.files.keys()]).toEqual([]);
  });

  it("only the member's own jobs run; sign-out wipes every job and file", async () => {
    const s = server(pkg);
    await createJob({ userId: "99999999-9999-4999-8999-999999999999", purpose: "post", manifest: pkg.manifest, manifestSha256: pkg.manifestSha256, files: pkg.files, post: { content: "", categories: ["x"], privacy: "public" } });
    await runVideoJobs(OWNER, s.deps);
    expect(s.db.beginCalls).toBe(0);
    expect(await clearVideoUploads()).toBe(true);
    expect(await jobsFor("99999999-9999-4999-8999-999999999999")).toEqual([]);
  });
});

describe("VID-1 · a long video: complete answers in rounds", () => {
  it("202 + progress → the job asks again at once and reaches checking; progress only grows", async () => {
    const s = server(pkg);
    const realApi = s.deps.api;
    let rounds = 0;
    s.deps.api = async (path, body) => {
      if (path.endsWith("/complete") && rounds < 3) {
        rounds++;
        return { status: 202, body: { state: "uploading", copied: rounds * 10, total: 40 } };
      }
      return realApi(path, body);
    };
    let j = await advanceJob(await newJob(), s.deps);
    expect(rounds).toBe(3);
    expect(j.step).toBe("checking");
    expect(j.serverProgress).toEqual({ copied: 30, total: 40 });
  });
});

describe("VID-5 · an AD video goes on its creative, never into a post", () => {
  it("the ready step links the video to the ad creative (no post is made) and the job is done", async () => {
    const s = server(pkg);
    const base = await newJob();
    let j: VideoJob = { ...base, purpose: "ad", ad: { creativeId: "creative-1" } };
    j = await advanceJob(j, s.deps);
    s.musicCheckPasses();
    j = await advanceJob(j, s.deps);
    expect(j.step).toBe("published");
    expect(s.db.posts.size).toBe(0);
    expect(s.db.adVideos.get("creative-1")?.video).toBe(j.videoId);
  });

  it("an ad job without its creative is refused out loud, nothing linked", async () => {
    const s = server(pkg);
    let j: VideoJob = { ...(await newJob()), purpose: "ad" };
    j = await advanceJob(j, s.deps);
    s.musicCheckPasses();
    j = await advanceJob(j, s.deps);
    expect(j.step).toBe("failed");
    expect(j.lastError).toMatch(/no ad to go on/);
    expect(s.db.adVideos.size).toBe(0);
  });
});
