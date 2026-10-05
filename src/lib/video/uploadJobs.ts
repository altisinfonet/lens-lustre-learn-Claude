/**
 * VID-1 §3 · THE VIDEO UPLOAD, kept on the device until it is posted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A picked video is encoded once; from then on the job and every encoded file
 * live in IndexedDB (`retina-video-uploads`), so a dropped link, an offline
 * hour or a closed app costs nothing: the job resumes where it stopped.
 *
 *   encoded ─begin─▶ begun ─PUTs─▶ (complete) ─▶ checking ─▶ ready ─publish─▶ published (deleted)
 *                                                    └▶ music_blocked (remedy screen, VID-4)
 *   any refusal (4xx with a VID-… code) ─▶ failed (said out loud, never silent)
 *
 * EXACTLY ONCE, the OFF-2 way: every key is made ONCE when the job is created
 * and stored with it — the video's idempotency key (video_begin_upload returns
 * the same row for the same key) and the post's (posts_user_idempotency_key:
 * a repeat insert is a 23505, read back by key). A retry can never make a
 * second video or a second post.
 *
 * WHY NOT THE OFF-2 OUTBOX ITSELF: the outbox sends single table writes from
 * D1's contract (scripts/db-off2-outbox-contract.json) and its guard fails the
 * build on anything else. A video is a multi-step job holding megabytes of
 * files; it gets its own store with the same rules — per member, FIFO, keys
 * made once, back-off, paused offline, wiped on sign-out (OFF-5 G6).
 *
 * The server side decides everything that matters (feature switch, limits,
 * daily count, file checks, music check, publish gate); this file only carries
 * the job through it and reports what the server said.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { backoffMs } from "@/lib/offline/outbox";
import { isNetworkError } from "@/lib/offline/retryPolicy";
import { safeRandomUUID } from "@/lib/safeUuid";
import { renditionBytes, totalBytes, uploadOrder, type VideoManifest, type VideoPurpose } from "./shared/rules";

export const VIDEO_DB = "retina-video-uploads";
export const MAX_ATTEMPTS = 12;

export type JobStep = "encoded" | "begun" | "checking" | "ready" | "published" | "music_blocked" | "failed";

export interface VideoJob {
  id: string;                 // = the video's idempotency key, made once
  userId: string;
  purpose: VideoPurpose;
  createdAt: number;
  step: JobStep;
  manifest: VideoManifest;
  manifestSha256: string;
  videoId?: string;
  versionNo?: number;
  uploaded: string[];         // file names confirmed in R2
  post: { content: string; categories: string[]; privacy: string; idempotencyKey: string };
  postId?: string;
  attempts: number;
  nextAt: number;
  lastError?: string;
}

/* ── storage (jobs + their files) ───────────────────────────────────────── */

export interface JobStore {
  allJobs(): Promise<VideoJob[]>;
  putJob(j: VideoJob): Promise<void>;
  deleteJob(id: string): Promise<void>;
  putFile(jobId: string, name: string, data: Blob): Promise<void>;
  getFile(jobId: string, name: string): Promise<Blob | null>;
  deleteFiles(jobId: string): Promise<void>;
  clear(): Promise<void>;
}

export function memoryJobStore(): JobStore & { jobs: Map<string, VideoJob>; files: Map<string, Blob> } {
  const jobs = new Map<string, VideoJob>();
  const files = new Map<string, Blob>();
  const clone = (j: VideoJob) => JSON.parse(JSON.stringify(j)) as VideoJob;
  return {
    jobs, files,
    allJobs: async () => [...jobs.values()].map(clone),
    putJob: async (j) => { jobs.set(j.id, clone(j)); },
    deleteJob: async (id) => { jobs.delete(id); },
    putFile: async (id, n, d) => { files.set(`${id}/${n}`, d); },
    getFile: async (id, n) => files.get(`${id}/${n}`) ?? null,
    deleteFiles: async (id) => { for (const k of [...files.keys()]) if (k.startsWith(`${id}/`)) files.delete(k); },
    clear: async () => { jobs.clear(); files.clear(); },
  };
}

function idbJobStore(): JobStore | null {
  if (typeof indexedDB === "undefined" || !indexedDB) return null;
  let dbp: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(VIDEO_DB, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("jobs")) db.createObjectStore("jobs", { keyPath: "id" });
          if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      dbp.catch(() => { dbp = null; });
    }
    return dbp;
  };
  const run = async <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction(store, mode).objectStore(store));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  };
  return {
    allJobs: () => run<VideoJob[]>("jobs", "readonly", (s) => s.getAll() as IDBRequest<VideoJob[]>),
    putJob: async (j) => { await run("jobs", "readwrite", (s) => s.put(j)); },
    deleteJob: async (id) => { await run("jobs", "readwrite", (s) => s.delete(id)); },
    putFile: async (id, n, d) => { await run("files", "readwrite", (s) => s.put(d, `${id}/${n}`)); },
    getFile: async (id, n) => (await run<Blob | undefined>("files", "readonly", (s) => s.get(`${id}/${n}`) as IDBRequest<Blob | undefined>)) ?? null,
    deleteFiles: async (id) => { await run("files", "readwrite", (s) => s.delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`))); },
    clear: async () => { await run("jobs", "readwrite", (s) => s.clear()); await run("files", "readwrite", (s) => s.clear()); },
  };
}

let store: JobStore | undefined;
function getStore(): JobStore {
  if (!store) store = idbJobStore() ?? memoryJobStore();
  return store;
}
export function __setJobStore(s: JobStore | undefined) { store = s; }

/* ── what the runner talks to (the app passes the real ones; tests fake them) ─ */

export interface JobDeps {
  /** supabase.rpc, called in call position by the caller */
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
  /** select one video's state through RLS */
  videoState(videoId: string): Promise<string | null>;
  /** insert the post; returns its id, or the 23505 read-back by idempotency key */
  insertPost(row: Record<string, unknown>): Promise<{ id: string | null; error: { message: string; code?: string } | null }>;
  findPostByKey(userId: string, key: string): Promise<string | null>;
  insertPostVideo(postId: string, videoId: string): Promise<{ error: { message: string; code?: string } | null }>;
  /** POST to /api/video/* with the member's JWT */
  api(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }>;
  /** the PUT itself */
  put(url: string, headers: Record<string, string>, data: Blob): Promise<number>;
  online(): boolean;
  now(): number;
}

export type JobEvent = { type: "changed"; job: VideoJob } | { type: "failed"; job: VideoJob } | { type: "published"; job: VideoJob };
const listeners = new Set<(e: JobEvent) => void>();
export function subscribeVideoJobs(fn: (e: JobEvent) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function emit(e: JobEvent) { listeners.forEach((l) => { try { l(e); } catch { /* never break the runner */ } }); }

/** v4 UUID; safeRandomUUID = Web Crypto's when present, never a blank page on an old WebView. */
function newKey(): string {
  return safeRandomUUID();
}

/** Put an encoded video on the device as a job. Both idempotency keys are made HERE, once. */
export async function createJob(input: {
  userId: string; purpose: VideoPurpose; manifest: VideoManifest; manifestSha256: string;
  files: Map<string, Uint8Array>; post: { content: string; categories: string[]; privacy: string };
}, now = Date.now()): Promise<VideoJob> {
  const s = getStore();
  const job: VideoJob = {
    id: newKey(), userId: input.userId, purpose: input.purpose, createdAt: now, step: "encoded",
    manifest: input.manifest, manifestSha256: input.manifestSha256, uploaded: [],
    post: { ...input.post, idempotencyKey: newKey() }, attempts: 0, nextAt: 0,
  };
  for (const [name, bytes] of input.files) await s.putFile(job.id, name, new Blob([bytes]));
  await s.putJob(job);
  emit({ type: "changed", job });
  return job;
}

export async function jobsFor(userId: string): Promise<VideoJob[]> {
  try {
    return (await getStore().allJobs()).filter((j) => j.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

class Refused extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

function codeOf(message: string): string | undefined {
  return /\b(VID-[A-Z]+-\d{3})\b/.exec(message)?.[1];
}

async function save(j: VideoJob) {
  await getStore().putJob(j);
  emit({ type: "changed", job: j });
}

/**
 * Carry one job as far as it can go now. Returns when it is published, waits
 * on the network / the server's check, or is refused. Never throws.
 */
export async function advanceJob(job: VideoJob, d: JobDeps): Promise<VideoJob> {
  const s = getStore();
  let j: VideoJob = { ...job };
  try {
    if (!d.online()) return j;
    if (j.step === "encoded") {
      const m = j.manifest;
      const { data, error } = await d.rpc("video_begin_upload", {
        _purpose: j.purpose, _manifest_sha256: j.manifestSha256, _total_bytes: totalBytes(m),
        _declared_duration_s: m.duration_s, _has_audio: m.has_audio, _idempotency_key: j.id,
        _rendition_bytes: renditionBytes(m),
      });
      if (error) {
        if (isNetworkError(error) || !codeOf(error.message)) throw error;
        throw new Refused(error.message, codeOf(error.message));
      }
      const r = data as { video_id: string; version_no: number };
      j = { ...j, step: "begun", videoId: r.video_id, versionNo: r.version_no, attempts: 0 };
      await save(j);
    }
    if (j.step === "begun") {
      for (let round = 0; round < 3; round++) {
        const urls = await d.api("/api/video/upload-urls", { video_id: j.videoId, version_no: j.versionNo, manifest: j.manifest });
        if (urls.status >= 400) {
          if (urls.status >= 500 || urls.status === 408 || urls.status === 429) throw new Error(`upload-urls ${urls.status}`);
          throw new Refused(String(urls.body.message ?? `upload-urls refused (${urls.status})`), String(urls.body.error ?? ""));
        }
        const list = (urls.body.urls as Array<{ name: string; url: string; headers: Record<string, string> }>) ?? [];
        const done = new Set([...(urls.body.done as string[] ?? []), ...j.uploaded]);
        const byName = new Map(list.map((u) => [u.name, u]));
        for (const name of uploadOrder(list.map((u) => u.name))) {
          if (!d.online()) { j = { ...j, uploaded: [...done] }; await save(j); return j; }
          const u = byName.get(name)!;
          const blob = await s.getFile(j.id, name);
          if (!blob) throw new Refused(`the encoded file ${name} is gone from this device`, "VID-LOCAL-001");
          const status = await d.put(u.url, u.headers, blob);
          if (status < 200 || status >= 300) {
            if (status === 403) continue; // URL expired or refused: the next round asks for a fresh one
            throw new Error(`PUT ${name} ${status}`);
          }
          done.add(name);
          j = { ...j, uploaded: [...done] };
          await save(j);
        }
        const c = await d.api("/api/video/complete", { video_id: j.videoId, version_no: j.versionNo });
        if (c.status === 200) {
          const st = String(c.body.state ?? "checking");
          j = { ...j, step: st === "ready" ? "ready" : "checking", attempts: 0 };
          await save(j);
          break;
        }
        if (c.status === 409 && (Array.isArray(c.body.missing) || Array.isArray(c.body.mismatched))) {
          const redo = new Set([...(c.body.missing as string[] ?? []), ...(c.body.mismatched as string[] ?? [])]);
          j = { ...j, uploaded: j.uploaded.filter((n) => !redo.has(n)) };
          await save(j);
          continue; // next round: fresh URLs for just those
        }
        if (c.status >= 500 || c.status === 408 || c.status === 429) throw new Error(`complete ${c.status}`);
        throw new Refused(String(c.body.message ?? `complete refused (${c.status})`), String(c.body.error ?? ""));
      }
      if (j.step === "begun") throw new Error("the upload did not complete after 3 rounds");
    }
    if (j.step === "checking") {
      const st = await d.videoState(j.videoId!);
      if (st === "ready") { j = { ...j, step: "ready" }; await save(j); }
      else if (st === "music_blocked") { j = { ...j, step: "music_blocked" }; await save(j); return j; }
      else if (st === "failed" || st === "deleted" || st === "taken_down") throw new Refused(`the video is ${st}`, "VID-STATE");
      else { j = { ...j, nextAt: d.now() + 15_000 }; await save(j); return j; } // still checking: look again soon
    }
    if (j.step === "ready") {
      let postId = j.postId ?? null;
      if (!postId) {
        const ins = await d.insertPost({
          user_id: j.userId, content: j.post.content, privacy: j.post.privacy, categories: j.post.categories,
          idempotency_key: j.post.idempotencyKey,
        });
        if (ins.error?.code === "23505") postId = await d.findPostByKey(j.userId, j.post.idempotencyKey);
        else if (ins.error) {
          if (isNetworkError(ins.error)) throw ins.error;
          throw new Refused(ins.error.message, ins.error.code);
        } else postId = ins.id;
        if (!postId) throw new Error("the post was written but could not be read back");
        j = { ...j, postId };
        await save(j);
      }
      const link = await d.insertPostVideo(postId, j.videoId!);
      if (link.error && link.error.code !== "23505") {
        if (isNetworkError(link.error)) throw link.error;
        throw new Refused(link.error.message, link.error.code);
      }
      j = { ...j, step: "published" };
      await s.deleteFiles(j.id);
      await s.deleteJob(j.id);
      emit({ type: "published", job: j });
      return j;
    }
    return j;
  } catch (e) {
    if (e instanceof Refused) {
      j = { ...j, step: "failed", lastError: e.message };
      await save(j);
      emit({ type: "failed", job: j });
      return j;
    }
    const attempts = j.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      j = { ...j, step: "failed", attempts, lastError: (e as Error)?.message ?? String(e) };
      await save(j);
      emit({ type: "failed", job: j });
      return j;
    }
    j = { ...j, attempts, nextAt: d.now() + backoffMs(attempts), lastError: (e as Error)?.message ?? String(e) };
    await save(j);
    return j;
  }
}

let running = false;
/** Advance every due job of this member, oldest first. Single-flight. */
export async function runVideoJobs(userId: string, d: JobDeps): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const j of await jobsFor(userId)) {
      if (j.step === "failed" || j.step === "music_blocked" || j.step === "published") continue;
      if (j.nextAt > d.now()) continue;
      await advanceJob(j, d);
    }
  } finally {
    running = false;
  }
}

/** The member gives up on a job (or a failed one is dismissed). */
export async function discardJob(id: string): Promise<void> {
  const s = getStore();
  await s.deleteFiles(id);
  await s.deleteJob(id);
}

/** Sign-out (OFF-5 G6): every member's jobs and files. Never throws. */
export async function clearVideoUploads(): Promise<boolean> {
  try { await getStore().clear(); return true; } catch { return false; }
}

export function __resetVideoJobs() { running = false; listeners.clear(); }
