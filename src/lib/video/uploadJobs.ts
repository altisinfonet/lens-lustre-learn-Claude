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
 * the same row for the same key) and the post's (video_publish_post returns
 * the post that key already made). A retry can never make a second video or a
 * second post.
 *
 * ONE STEP TO PUBLISH (20261011_0003): the post and its video link are written
 * by one database call in one transaction, so there is never a post without
 * its video — the old two-request publish left an empty post on the wall when
 * the second request failed, and the duplicate guard could not see the video.
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
 *
 * SERVER CONVERSION (CONVERTER-DESIGN.md v2 §3, §8 — site setting
 * video_conversion = "server"): nothing is encoded here. The ORIGINAL goes up
 * once, our converter makes the package through the same gates, and the job
 * carries it there and back:
 *
 *   source ─begin→PUT→complete─▶ converting ─(row done)─▶ checking ─▶ review ─Post─▶ ready ─▶ published
 *                                    └▶ failed (the row's own fixed text) · cancelled
 *
 * The member PUBLISHES (design §3.9): a ready video waits in `review` until
 * they have watched it and tapped Post — the control against a converter that
 * substitutes content. From `ready` on it is the device path's own publish.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { backoffMs } from "@/lib/offline/outbox";
import { isNetworkError } from "@/lib/offline/retryPolicy";

/** Postgres says "try again", not "no": statement/lock timeout, serialisation, deadlock. */
const RETRYABLE_DB_CODES = new Set(["57014", "55P03", "40001", "40P01"]);
import { safeRandomUUID } from "@/lib/safeUuid";
import { renditionBytes, totalBytes, uploadOrder, type VideoManifest, type VideoPurpose } from "./shared/rules";

export const VIDEO_DB = "retina-video-uploads";
export const MAX_ATTEMPTS = 12;

export type JobStep = "encoded" | "begun" | "checking" | "ready" | "published" | "music_blocked" | "failed"
  // server conversion only
  | "source" | "converting" | "review";

export interface VideoJob {
  id: string;                 // = the video's (or the source's) idempotency key, made once
  userId: string;
  purpose: VideoPurpose;
  createdAt: number;
  step: JobStep;
  /** The encoded package — device jobs only (a server job has none until the converter makes it). */
  manifest?: VideoManifest;
  manifestSha256?: string;
  /** "server": prepared by our converter, not this device. Absent = this device (as before). */
  mode?: "server";
  /** Server jobs: the original's size and name, and the source row once video_source_begin made it. */
  source?: { id?: string; bytes: number; name: string };
  /** Server jobs: the VID code a refusal carried (VID-SRC-001 = server mode was switched off). */
  errorCode?: string;
  videoId?: string;
  versionNo?: number;
  uploaded: string[];         // file names confirmed in R2
  post: { content: string; categories: string[]; privacy: string; idempotencyKey: string };
  /** VID-5 · an AD video: the creative it is for. The ready step links it there instead of posting. */
  ad?: { creativeId: string };
  postId?: string;
  /** /complete's progress for a long video (it finishes in rounds): files copied of total. */
  serverProgress?: { copied: number; total: number };
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
  /** VID-5 · put a ready ad video on its creative (ad_videos, admin + video_ads only — RLS + link guard). */
  linkAdVideo(creativeId: string, videoId: string, categories: string[]): Promise<{ error: { message: string; code?: string } | null }>;
  /** POST to /api/video/* with the member's JWT */
  api(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }>;
  /** the PUT itself */
  put(url: string, headers: Record<string, string>, data: Blob): Promise<number>;
  /** Server conversion: the original's PUT, with upload progress; the signal stops it (Cancel). */
  upload?(url: string, headers: Record<string, string>, data: Blob, onProgress: (sent: number, total: number) => void, signal: AbortSignal): Promise<number>;
  /** Server conversion: the member's own video_sources row (RLS owner read), null when there is none. */
  sourceRow?(sourceId: string): Promise<{ status: string; video_id: string | null; error: string | null } | null>;
  online(): boolean;
  now(): number;
}

export type JobEvent = { type: "changed"; job: VideoJob } | { type: "failed"; job: VideoJob } | { type: "published"; job: VideoJob }
  /** A server job's original going up — not saved (it changes many times a second). */
  | { type: "progress"; job: VideoJob; sent: number; total: number }
  /** A server job the member cancelled or dismissed. */
  | { type: "removed"; job: VideoJob };
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
  ad?: { creativeId: string };
}, now = Date.now()): Promise<VideoJob> {
  const s = getStore();
  const job: VideoJob = {
    id: newKey(), userId: input.userId, purpose: input.purpose, createdAt: now, step: "encoded",
    manifest: input.manifest, manifestSha256: input.manifestSha256, uploaded: [],
    post: { ...input.post, idempotencyKey: newKey() }, attempts: 0, nextAt: 0,
    ...(input.ad ? { ad: input.ad } : {}),
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
  if (isDropped(j)) return; // cancelled while a step was in flight: never bring it back
  await getStore().putJob(j);
  emit({ type: "changed", job: j });
}

/**
 * Carry one job as far as it can go now. Returns when it is published, waits
 * on the network / the server's check, or is refused. Never throws.
 */
export async function advanceJob(job: VideoJob, d: JobDeps, opts: { beginOnly?: boolean } = {}): Promise<VideoJob> {
  const s = getStore();
  let j: VideoJob = { ...job };
  try {
    if (!d.online()) return j;
    if (j.mode === "server") {
      j = await advanceSource(j, d, opts.beginOnly === true);
      if (opts.beginOnly || j.step === "source" || j.step === "converting") return j;
    }
    if (j.step === "encoded") {
      const m = j.manifest;
      if (!m || !j.manifestSha256) throw new Refused("this video has no prepared package on this device", "VID-LOCAL-002");
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
        let c = await d.api("/api/video/complete", { video_id: j.videoId, version_no: j.versionNo });
        // A long video is finished in rounds (Cloudflare's per-request limit): 202 = "more
        // to copy" — ask again at once; each round only moves forward, nothing is redone.
        for (let more = 0; c.status === 202 && more < 1000; more++) {
          const copied = Number(c.body.copied) || 0;
          // A round that moved nothing would repeat for ever (and cost storage calls): stop, retry later.
          if (j.serverProgress && copied <= j.serverProgress.copied) throw new Error("complete made no progress this round");
          j = { ...j, serverProgress: { copied, total: Number(c.body.total) || 0 } };
          await save(j);
          if (!d.online()) return j;
          c = await d.api("/api/video/complete", { video_id: j.videoId, version_no: j.versionNo });
        }
        if (c.status === 202) throw new Error("complete still copying after 1000 rounds");
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
      // A server-made video waits for the member to watch it and tap Post (design §3.9).
      if (st === "ready") { j = { ...j, step: j.mode === "server" ? "review" : "ready" }; await save(j); }
      else if (st === "music_blocked") { j = { ...j, step: "music_blocked" }; await save(j); return j; }
      else if (st === "failed" || st === "deleted" || st === "taken_down") throw new Refused(`the video is ${st}`, "VID-STATE");
      else { j = { ...j, nextAt: d.now() + 15_000 }; await save(j); return j; } // still checking: look again soon
    }
    if (j.step === "review") return j;
    if (j.step === "ready" && j.purpose === "ad") {
      // VID-5: an ad video is not a post — it goes on its creative. Upsert by
      // creative, so a retry (or a replacement video) is safe.
      if (!j.ad?.creativeId) throw new Refused("this ad video has no ad to go on", "VID-AD-001");
      const link = await d.linkAdVideo(j.ad.creativeId, j.videoId!, j.post.categories);
      if (link.error) {
        if (isNetworkError(link.error) || RETRYABLE_DB_CODES.has(link.error.code ?? "")) throw link.error;
        throw new Refused(link.error.message, link.error.code ?? codeOf(link.error.message));
      }
      j = { ...j, step: "published" };
      await s.deleteFiles(j.id);
      await s.deleteJob(j.id);
      emit({ type: "published", job: j });
      return j;
    }
    if (j.step === "ready") {
      // The post AND its video link, one transaction; the same key returns the
      // same post, so a retry after a lost answer is safe.
      const { data, error } = await d.rpc("video_publish_post", {
        _video_id: j.videoId, _content: j.post.content, _privacy: j.post.privacy,
        _categories: j.post.categories, _idempotency_key: j.post.idempotencyKey,
      });
      if (error) {
        if (isNetworkError(error) || RETRYABLE_DB_CODES.has(error.code ?? "")) throw error;
        throw new Refused(error.message, error.code ?? codeOf(error.message));
      }
      if (typeof data !== "string" || !data) throw new Error("the post was published but its id did not come back");
      j = { ...j, postId: data, step: "published" };
      await s.deleteFiles(j.id);
      await s.deleteJob(j.id);
      emit({ type: "published", job: j });
      return j;
    }
    return j;
  } catch (e) {
    if (j.mode === "server") clearProgress(j.id);
    if (e instanceof Refused) {
      j = { ...j, step: "failed", lastError: e.message, ...(j.mode === "server" ? { errorCode: e.code || "VID-REFUSED" } : {}) };
      await save(j);
      if (!isDropped(j)) emit({ type: "failed", job: j });
      return j;
    }
    const attempts = j.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      j = { ...j, step: "failed", attempts, lastError: (e as Error)?.message ?? String(e), ...(j.mode === "server" ? { errorCode: "VID-RETRIES" } : {}) };
      await save(j);
      if (!isDropped(j)) emit({ type: "failed", job: j });
      return j;
    }
    j = { ...j, attempts, nextAt: d.now() + backoffMs(attempts), lastError: (e as Error)?.message ?? String(e) };
    await save(j);
    return j;
  }
}

/* ── server conversion (CONVERTER-DESIGN.md v2 §3, §8) ──────────────────── */

/** How often a converting job reads its row: modest — one small read, and only while the app is in front (P10). */
export const SOURCE_POLL_MS = 30_000;
/** The original's name in the job's file store. */
export const SOURCE_FILE = "source";

/** Steps that wait for the member (or are over): nothing for the runner to do. */
const AT_REST: ReadonlySet<JobStep> = new Set<JobStep>(["failed", "music_blocked", "published", "review"]);

/** The picked file, held for this session: the upload reads it directly (and it is the copy when the device store is full). */
const originals = new Map<string, Blob>();
/** The background copy of each original into the device store, so a reload can resume the upload. */
const persisting = new Map<string, Promise<void>>();
/** The original's PUT in flight, per job — Cancel stops it. */
const uploads = new Map<string, AbortController>();
/** The last progress reported per job, for a screen that opens mid-upload. */
const progress = new Map<string, { sent: number; total: number }>();
/** Server jobs being advanced right now — never two runs of one job. */
const busy = new Set<string>();
/** Server jobs the member cancelled or dismissed: a step still in flight must not save them again. */
const dropped = new Set<string>();

function isDropped(j: VideoJob): boolean {
  return j.mode === "server" && dropped.has(j.id);
}

function clearProgress(id: string) {
  progress.delete(id);
}

/** The original's upload so far, or undefined when it is not going up right now. */
export function uploadProgress(jobId: string): { sent: number; total: number } | undefined {
  return progress.get(jobId);
}

const retryable = (status: number) => status >= 500 || status === 408 || status === 429;

async function originalOf(j: VideoJob): Promise<Blob | null> {
  return originals.get(j.id) ?? (await getStore().getFile(j.id, SOURCE_FILE));
}

/** The original is on our server now (or the job is over): free the device. */
async function dropOriginal(id: string): Promise<void> {
  originals.delete(id);
  await persisting.get(id)?.catch(() => {});
  persisting.delete(id);
  await getStore().deleteFiles(id);
}

async function jobById(id: string): Promise<VideoJob | undefined> {
  try {
    return (await getStore().allJobs()).find((j) => j.id === id);
  } catch {
    return undefined;
  }
}

/**
 * Put a picked video on the device as a SERVER job. Both keys are made here,
 * once: the source's (video_source_begin returns the same row for the same
 * key) and the post's. Nothing is encoded.
 */
export async function createServerJob(input: {
  userId: string; purpose: VideoPurpose; file: Blob; name: string;
  post: { content: string; categories: string[]; privacy: string };
  ad?: { creativeId: string };
}, now = Date.now()): Promise<VideoJob> {
  const s = getStore();
  const job: VideoJob = {
    id: newKey(), userId: input.userId, purpose: input.purpose, createdAt: now, step: "source", mode: "server",
    source: { bytes: input.file.size, name: input.name }, uploaded: [],
    post: { ...input.post, idempotencyKey: newKey() }, attempts: 0, nextAt: 0,
    ...(input.ad ? { ad: input.ad } : {}),
  };
  originals.set(job.id, input.file);
  await s.putJob(job);
  // Copied in the background: the upload starts at once from the picked file,
  // and a reload or a lost link resumes from the copy. Best effort — a full
  // device store leaves this session's file, which an unbroken upload needs.
  persisting.set(job.id, s.putFile(job.id, SOURCE_FILE, input.file).catch(() => {}));
  emit({ type: "changed", job });
  return job;
}

/**
 * The server half of advanceJob: begin → PUT the original → complete → poll
 * the row until the converter is done. Throws Refused / Error to advanceJob's
 * own catch, so a server job fails, backs off and retries by the same rules.
 */
async function advanceSource(job: VideoJob, d: JobDeps, beginOnly: boolean): Promise<VideoJob> {
  let j = job;
  if (!j.source) throw new Refused("this video has no original to upload", "VID-LOCAL-002");
  if (j.step === "source" && !j.source.id) {
    const { data, error } = await d.rpc("video_source_begin", {
      _purpose: j.purpose, _source_bytes: j.source.bytes, _idempotency_key: j.id,
    });
    if (error) {
      if (isNetworkError(error) || !codeOf(error.message)) throw error;
      throw new Refused(error.message, codeOf(error.message));
    }
    const r = data as { source_id: string; status: string };
    j = { ...j, source: { ...j.source, id: r.source_id }, attempts: 0 };
    // A replay of a job that already went further (lost answer, crash): the poll reads where it is.
    if (r.status !== "awaiting_upload") j = { ...j, step: "converting" };
    await save(j);
  }
  if (beginOnly) return j;
  // Just uploaded (or still waiting to): nothing to ask yet — the converter
  // cannot be done this instant. The first look is SOURCE_POLL_MS later.
  if (j.step === "source") return uploadSource(j, d);
  if (j.step === "converting") {
    if (!d.sourceRow) throw new Error("this app cannot read its server videos");
    const row = await d.sourceRow(j.source!.id!);
    if (!row) throw new Refused("We can't find this video on our server any more. Please post it again.", "VID-SRC-004");
    if (row.status === "done" && row.video_id) {
      j = { ...j, step: "checking", videoId: row.video_id, attempts: 0 };
      await save(j);
    } else if (row.status === "failed") {
      // The database's own fixed, member-safe text (video_source_reason_text) — said as it is.
      throw new Refused(row.error || "Converting this video failed. Please try again.", "VID-SRC-FAILED");
    } else if (row.status === "cancelled") {
      throw new Refused("This video was cancelled.", "VID-SRC-CANCELLED");
    } else if (row.status === "awaiting_upload") {
      j = { ...j, step: "source" }; // the original never arrived whole: send it again
      await save(j);
    } else {
      j = { ...j, nextAt: d.now() + SOURCE_POLL_MS, attempts: 0 }; // queued or converting: look again later
      await save(j);
    }
  }
  return j;
}

/** One presigned PUT for the whole original (design §3.2), then source-complete (§3.3). */
async function uploadSource(job: VideoJob, d: JobDeps): Promise<VideoJob> {
  let j = job;
  const sourceId = j.source!.id!;
  for (let round = 0; round < 3; round++) {
    const u = await d.api("/api/video/source-url", { source_id: sourceId });
    // Already past its upload (an answer lost after complete): the poll reads where it is.
    if (u.status === 409 && u.body.error === "VID-SRC-008") {
      j = { ...j, step: "converting" };
      await save(j);
      return j;
    }
    if (u.status >= 400) {
      if (retryable(u.status)) throw new Error(`source-url ${u.status}`);
      throw new Refused(String(u.body.message ?? `source-url refused (${u.status})`), String(u.body.error ?? ""));
    }
    const blob = await originalOf(j);
    if (!blob) throw new Refused("The video file is no longer on this device. Please post it again.", "VID-LOCAL-001");
    if (blob.size !== Number(u.body.bytes)) throw new Refused("The video file on this device changed size. Please post it again.", "VID-LOCAL-003");
    if (!d.online()) return j;
    if (!d.upload) throw new Error("this app cannot upload an original");
    const ctl = new AbortController();
    uploads.set(j.id, ctl);
    const total = blob.size;
    let shown = -1;
    const report = (sent: number) => {
      const pct = Math.floor((sent / Math.max(1, total)) * 100);
      if (pct === shown) return; // one event per percent, not one per network packet
      shown = pct;
      progress.set(j.id, { sent, total });
      emit({ type: "progress", job: j, sent, total });
    };
    let status: number;
    try {
      report(0);
      // Exactly the headers the URL was signed with (content-type application/octet-stream).
      status = await d.upload(String(u.body.url), (u.body.headers as Record<string, string>) ?? {}, blob, report, ctl.signal);
    } finally {
      uploads.delete(j.id);
    }
    if (status === 403) { clearProgress(j.id); continue; } // the hour ran out or was refused: a fresh URL
    if (status < 200 || status >= 300) throw new Error(`PUT source ${status}`);
    report(total);
    const c = await d.api("/api/video/source-complete", { source_id: sourceId });
    if (c.status === 200) {
      clearProgress(j.id);
      // The device's copy goes FIRST: closed between the two, the job retries,
      // hears VID-SRC-008 and polls — never a 500 MB original orphaned on the device.
      await dropOriginal(j.id);
      j = { ...j, step: "converting", nextAt: d.now() + SOURCE_POLL_MS, attempts: 0 };
      await save(j);
      return j;
    }
    // Not there yet, or the wrong size (the server deleted it): send it again.
    if (c.status === 409 && (c.body.error === "VID-SRC-006" || c.body.error === "VID-SRC-010")) { clearProgress(j.id); continue; }
    if (retryable(c.status)) throw new Error(`source-complete ${c.status}`);
    throw new Refused(String(c.body.message ?? `source-complete refused (${c.status})`), String(c.body.error ?? ""));
  }
  throw new Error("the original did not arrive after 3 rounds");
}

/**
 * Advance one server job, if no run of it is already going. Reads it fresh
 * from the store. `onlyIfDue`: the runner's call — the fresh row's own nextAt
 * decides, so a poll another run just made is not made again.
 */
export async function runServerJob(id: string, d: JobDeps, onlyIfDue = false): Promise<void> {
  if (busy.has(id) || dropped.has(id)) return;
  busy.add(id);
  try {
    const j = await jobById(id);
    if (!j || j.mode !== "server" || AT_REST.has(j.step)) return;
    if (onlyIfDue && j.nextAt > d.now()) return;
    await advanceJob(j, d);
  } finally {
    busy.delete(id);
  }
}

/**
 * The composer's first step: video_source_begin only, so a refusal — above
 * all VID-SRC-001, server mode switched off meanwhile — is answered on the
 * screen the member is looking at. The upload then runs on its own.
 */
export async function startServerJob(job: VideoJob, d: JobDeps): Promise<VideoJob> {
  busy.add(job.id);
  try {
    return await advanceJob(job, d, { beginOnly: true });
  } finally {
    busy.delete(job.id);
  }
}

/** The member watched the ready video and tapped Post: publish it the device path's way. */
export async function approveServerJob(id: string, d: JobDeps): Promise<void> {
  const j = await jobById(id);
  if (!j || j.mode !== "server" || j.step !== "review") return;
  await save({ ...j, step: "ready", attempts: 0, nextAt: 0 });
  await runServerJob(id, d);
}

async function removeServerJob(j: VideoJob): Promise<void> {
  dropped.add(j.id);
  uploads.get(j.id)?.abort();
  clearProgress(j.id);
  await dropOriginal(j.id);
  await getStore().deleteJob(j.id);
  emit({ type: "removed", job: j });
}

/**
 * Cancel (or discard) a server job. While the original is going up or being
 * converted: POST /api/video/source-cancel — the database stops it and drops
 * any half-made video, and Pages deletes the original. A video already made
 * but not posted is deleted (nobody will post it). Returns false when the
 * server could not be told; the job is then kept, so nothing is left behind.
 */
export async function cancelServerJob(id: string, d: JobDeps): Promise<boolean> {
  const j = await jobById(id);
  if (!j || j.mode !== "server") return true;
  try {
    const sourceId = j.source?.id;
    if (sourceId && (j.step === "source" || j.step === "converting")) {
      const r = await d.api("/api/video/source-cancel", { source_id: sourceId });
      if (r.status >= 400 && r.status !== 404) return false;
      // It finished a moment ago: the video exists, and the member asked for it gone.
      if (r.body.status === "done") {
        const row = await d.sourceRow?.(sourceId).catch(() => null);
        if (row?.video_id) await d.rpc("video_delete", { _video_id: row.video_id });
      }
    } else if (j.videoId && (j.step === "checking" || j.step === "review")) {
      await d.rpc("video_delete", { _video_id: j.videoId });
    }
  } catch {
    return false;
  }
  await removeServerJob(j);
  return true;
}

/** A failed (or music-blocked) server job, read and put away. Nothing on the server changes. */
export async function dismissServerJob(id: string): Promise<void> {
  const j = await jobById(id);
  if (j && j.mode === "server") await removeServerJob(j);
}

let running = false;
/** Advance every due job of this member, oldest first. Single-flight. */
export async function runVideoJobs(userId: string, d: JobDeps): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const j of await jobsFor(userId)) {
      if (j.step === "failed" || j.step === "music_blocked" || j.step === "published" || j.step === "review") continue;
      if (j.nextAt > d.now()) continue;
      if (j.mode === "server") { await runServerJob(j.id, d, true); continue; }
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
  for (const c of uploads.values()) c.abort();
  originals.clear();
  progress.clear();
  try { await getStore().clear(); return true; } catch { return false; }
}

export function __resetVideoJobs() {
  running = false; listeners.clear();
  originals.clear(); persisting.clear(); uploads.clear(); progress.clear(); busy.clear(); dropped.clear();
}
