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
  async head(k: string) { const v = this.map.get(k); return v ? { size: v.length } : null; }
  async get(k: string) { const v = this.map.get(k); return v ? { size: v.length, arrayBuffer: async () => v.slice().buffer } : null; }
  async put(k: string, v: ArrayBuffer | Uint8Array | string) { this.map.set(k, typeof v === "string" ? new TextEncoder().encode(v) : new Uint8Array(v as ArrayBuffer).slice()); }
  async delete(k: string | string[]) { for (const x of Array.isArray(k) ? k : [k]) this.map.delete(x); }
}

/** A tiny server: the video row, its version, posts, post_videos — with D1's uniqueness rules. */
function server(pkg: HlsPackage) {
  const db = {
    videos: new Map<string, { id: string; key: string; state: string; manifest_sha256: string }>(),
    posts: new Map<string, { id: string; key: string; categories: string[] }>(),
    postVideos: new Map<string, string>(),
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
    if (url.includes("/rest/v1/video_versions?")) return ok(v ? [{ manifest_sha256: v.manifest_sha256, total_bytes: totalBytes(pkg.manifest), declared_duration_s: pkg.manifest.duration_s, has_audio: pkg.manifest.has_audio }] : []);
    if (url.endsWith("/rpc/video_mark_uploaded")) { v!.state = "checking"; return ok({ state: "checking" }); }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  let online = true;
  let failPutAfter = Infinity;
  const deps: JobDeps = {
    rpc: async (fn, args) => {
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
    insertPost: async (row) => {
      const dup = [...db.posts.values()].find((p) => p.key === row.idempotency_key);
      if (dup) return { id: null, error: { message: "duplicate key value violates unique constraint \"posts_user_idempotency_key\"", code: "23505" } };
      const id = `post-${db.posts.size + 1}`;
      db.posts.set(id, { id, key: String(row.idempotency_key), categories: row.categories as string[] });
      return { id, error: null };
    },
    findPostByKey: async (_u, key) => [...db.posts.values()].find((p) => p.key === key)?.id ?? null,
    insertPostVideo: async (postId, videoId) => {
      if (db.videos.get(videoId)?.state !== "ready") return { error: { message: "VID-LINK-001: post_videos needs a ready post video", code: "23514" } };
      if (db.postVideos.has(postId)) return { error: { message: "dup", code: "23505" } };
      db.postVideos.set(postId, videoId);
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

  it("the post key is made once: a publish retried after a lost answer is still ONE post", async () => {
    const s = server(pkg);
    let j = await advanceJob(await newJob(), s.deps);
    s.musicCheckPasses();
    const realLink = s.deps.insertPostVideo;
    s.deps.insertPostVideo = async () => { throw new TypeError("Failed to fetch"); }; // post written, link lost
    j = await advanceJob(j, s.deps);
    expect(j.step).toBe("ready");
    expect(s.db.posts.size).toBe(1);
    s.deps.insertPostVideo = realLink;
    j = await advanceJob({ ...j, postId: undefined, nextAt: 0 }, s.deps); // even if the read-back id was lost too
    expect(j.step).toBe("published");
    expect(s.db.posts.size).toBe(1);
    expect(s.db.postVideos.size).toBe(1);
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

  it("only the member's own jobs run; sign-out wipes every job and file", async () => {
    const s = server(pkg);
    await createJob({ userId: "99999999-9999-4999-8999-999999999999", purpose: "post", manifest: pkg.manifest, manifestSha256: pkg.manifestSha256, files: pkg.files, post: { content: "", categories: ["x"], privacy: "public" } });
    await runVideoJobs(OWNER, s.deps);
    expect(s.db.beginCalls).toBe(0);
    expect(await clearVideoUploads()).toBe(true);
    expect(await jobsFor("99999999-9999-4999-8999-999999999999")).toEqual([]);
  });
});
