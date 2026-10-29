/**
 * S5-b · THE PHOTO POST UPLOAD, kept on the device until it is posted.
 *
 * The photo half of the one upload state machine (video: video/uploadJobs.ts).
 * Both use the shared store (./jobStore), the shared PUT (./transport) and the
 * outbox's back-off. Design: docs/evidence/d2/S5/DESIGN.md.
 *
 *   encoded ─presign+PUT per object (resumable)─▶ uploaded ─publish─▶ published (deleted)
 *   a refusal ─▶ failed (said out loud; the bytes stay until the member discards)
 *
 * WHY EACH KILL POINT IS SAFE:
 *   - the job id is the post's idempotency key, made ONCE when the member taps
 *     Post: one upload id can never make two posts (posts_user_idempotency_key,
 *     and post_publish_with_media returns the post a key already made);
 *   - object keys are DETERMINISTIC (`<uid>/posts/<jobId>-<slot>-w…h….webp`):
 *     a retry, a resume or a re-presign lands on the same address, so a kill
 *     strands nothing;
 *   - the ENCODED BYTES are what is stored (files are written before the job
 *     record, so a job on disk always has its bytes): a resume never
 *     re-encodes, so it re-PUTs exactly the same bytes, media_begin_upload gets
 *     the same sha256 and resolves to the same media row (no duplicate media).
 */
import { compressImageToFiles, compressThumbnail } from "@/lib/imageCompression";
import { describeStoredObject, type StoredObjectFacts } from "@/lib/media/storedObject";
import { LADDER_MARKER, RUNG_QUALITY, rungPath, rungPlan } from "@/lib/imageLadder";
import { dimsSuffix } from "@/lib/imageFrame";
import { backoffMs } from "@/lib/offline/outbox";
import { idbUploadStore, memoryUploadStore, type UploadJobStore } from "./jobStore";

export const PHOTO_DB = "retina-photo-uploads";
export const PHOTO_MAX_ATTEMPTS = 12;
export const PHOTO_BUCKET = "post-images";

export interface PhotoObject {
  /** Full storage key (bucket included) — also the file's name in the store. */
  path: string;
  contentType: string;
  size: number;
  /** Public URL, set once this object's PUT succeeded. */
  url?: string;
  done: boolean;
}
export interface PhotoSlot {
  /** [full, thumb, ...rungs] — the first two are what the post references. */
  objects: PhotoObject[];
  stored: StoredObjectFacts | null;
}
export interface PhotoPost { content: string; privacy: string; categories: string[]; indexingDisabled: boolean }
export type PhotoStep = "encoded" | "uploaded" | "published" | "failed";
export interface PhotoJob {
  id: string;
  userId: string;
  createdAt: number;
  step: PhotoStep;
  slots: PhotoSlot[];
  post: PhotoPost;
  attempts: number;
  nextAt: number;
  postId?: string;
  lastError?: string;
}

/** The server said no: retrying cannot help. */
export class PhotoRefused extends Error {}

export interface PhotoJobDeps {
  /** One or two objects per call (the presign function's pair). */
  presign(objs: { path: string; contentType: string; size: number }[]): Promise<{ uploadUrl: string; publicUrl: string | null }[]>;
  /** The PUT with its own retry/timeout policy; `represign` gives a fresh URL for the SAME key. */
  put(url: string, data: Blob, contentType: string, represign: () => Promise<string>, onProgress: (sent: number) => void): Promise<void>;
  /** Publish with the job id as the idempotency key; returns the post id. Throws PhotoRefused on a refusal. */
  publish(job: PhotoJob): Promise<string>;
  online(): boolean;
  now(): number;
}

/* ── the store ─────────────────────────────────────────────────────────── */

let store: UploadJobStore<PhotoJob> | undefined;
function getStore(): UploadJobStore<PhotoJob> {
  if (!store) store = idbUploadStore<PhotoJob>(PHOTO_DB) ?? memoryUploadStore<PhotoJob>();
  return store;
}
export function __setPhotoStore(s: UploadJobStore<PhotoJob> | undefined) { store = s; }

/* ── events (the bridge refreshes the feed and says a failure out loud) ── */

export type PhotoJobEvent =
  | { type: "changed" | "published" | "failed"; job: PhotoJob }
  | { type: "progress"; job: PhotoJob; sent: number; total: number };
const listeners = new Set<(e: PhotoJobEvent) => void>();
export function subscribePhotoJobs(fn: (e: PhotoJobEvent) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function emit(e: PhotoJobEvent) { listeners.forEach((l) => { try { l(e); } catch { /* never break the runner */ } }); }

/* ── prepare: encode ONCE, keep the bytes ──────────────────────────────── */

export interface EncodedPhoto {
  full: { blob: Blob; width: number; height: number };
  thumb: Blob;
  rungs: { rung: number; blob: Blob }[];
}
export type PhotoEncoder = (file: File) => Promise<EncodedPhoto>;

/** Today's encoder rules (imageUpload.ts): 2560 cap, 600 thumb, 1080/1440 rungs at RUNG_QUALITY. */
export const defaultPhotoEncoder: PhotoEncoder = async (file) => {
  const base = file.name.replace(/\.[^.]+$/, "");
  const { webpFile, width, height } = await compressImageToFiles(file, base, { maxDimension: 2560 });
  const { webpFile: thumb } = await compressThumbnail(file, base);
  const rungs: { rung: number; blob: Blob }[] = [];
  for (const rung of rungPlan(width, height)) {
    try {
      const r = await compressImageToFiles(file, `${base}-r${rung}`, { maxDimension: rung, webpQuality: RUNG_QUALITY });
      rungs.push({ rung, blob: r.webpFile });
    } catch {
      // A rung that cannot be encoded: ship none, and no `-l3` promise (below).
      return { full: { blob: webpFile, width, height }, thumb, rungs: [] };
    }
  }
  return { full: { blob: webpFile, width, height }, thumb, rungs };
};

/** The deterministic key of slot `i` — the same on every retry and every resume. */
export function photoObjectPath(userId: string, jobId: string, i: number, w: number, h: number, ladder: boolean): string {
  return `${PHOTO_BUCKET}/${userId}/posts/${jobId}-${i}${dimsSuffix(w, h)}${ladder ? LADDER_MARKER : ""}.webp`;
}

/**
 * Encode every photo, write the bytes to the device, then the job record.
 * Throws if a photo cannot be encoded (the composer then uses today's path).
 */
export async function createPhotoJob(
  input: { id: string; userId: string; files: File[]; post: PhotoPost },
  enc: PhotoEncoder = defaultPhotoEncoder,
  now: () => number = Date.now,
): Promise<PhotoJob> {
  const s = getStore();
  const slots: PhotoSlot[] = [];
  const blobs: { path: string; blob: Blob }[] = [];
  for (let i = 0; i < input.files.length; i++) {
    const e = await enc(input.files[i]);
    const ladder = e.rungs.length > 0;
    const full = photoObjectPath(input.userId, input.id, i, e.full.width, e.full.height, ladder);
    const parts = [
      { path: full, blob: e.full.blob },
      { path: full.replace(/\.webp$/, "-thumb.webp"), blob: e.thumb },
      ...e.rungs.map((r) => ({ path: rungPath(full, r.rung), blob: r.blob })),
    ];
    blobs.push(...parts);
    slots.push({
      objects: parts.map((p) => ({ path: p.path, contentType: p.blob.type || "image/webp", size: p.blob.size, done: false })),
      stored: await describeStoredObject(e.full.blob, { width: e.full.width, height: e.full.height }),
    });
  }
  for (const b of blobs) await s.putFile(input.id, b.path, b.blob);
  const job: PhotoJob = {
    id: input.id, userId: input.userId, createdAt: now(), step: "encoded", slots, post: input.post, attempts: 0, nextAt: 0,
  };
  await s.putJob(job);
  emit({ type: "changed", job });
  return job;
}

/* ── advance ───────────────────────────────────────────────────────────── */

const busy = new Set<string>();

export async function advancePhotoJob(job: PhotoJob, d: PhotoJobDeps): Promise<PhotoJob> {
  const s = getStore();
  let j: PhotoJob = JSON.parse(JSON.stringify(job));
  const commit = async () => { await s.putJob(j); emit({ type: "changed", job: j }); };
  try {
    if (j.step === "encoded") {
      const all = j.slots.flatMap((sl) => sl.objects);
      const total = all.reduce((n, o) => n + o.size, 0);
      let sent = all.filter((o) => o.done).reduce((n, o) => n + o.size, 0);
      const pending = all.filter((o) => !o.done);
      for (let k = 0; k < pending.length; k += 2) {
        if (!d.online()) return j;
        const group = pending.slice(k, k + 2);
        const signed = await d.presign(group.map((o) => ({ path: o.path, contentType: o.contentType, size: o.size })));
        const live = new Map<PhotoObject, number>();
        await Promise.all(group.map(async (o, gi) => {
          const blob = await s.getFile(j.id, o.path);
          if (!blob) throw new PhotoRefused("A photo of this post is no longer on this device. Please post it again.");
          const represign = async () => (await d.presign([{ path: o.path, contentType: o.contentType, size: o.size }]))[0].uploadUrl;
          await d.put(signed[gi].uploadUrl, blob, o.contentType, represign, (n) => {
            live.set(o, n);
            emit({ type: "progress", job: j, sent: sent + [...live.values()].reduce((a, b) => a + b, 0), total });
          });
          o.url = signed[gi].publicUrl ?? signed[gi].uploadUrl.split("?")[0];
          o.done = true;
        }));
        sent += group.reduce((n, o) => n + o.size, 0);
        await commit();
      }
      j = { ...j, step: "uploaded", attempts: 0 };
      await commit();
    }
    if (j.step === "uploaded") {
      if (!d.online()) return j;
      const postId = await d.publish(j);
      j = { ...j, step: "published", postId };
      await s.deleteJob(j.id);
      await s.deleteFiles(j.id);
      emit({ type: "published", job: j });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const attempts = j.attempts + 1;
    if (e instanceof PhotoRefused || attempts >= PHOTO_MAX_ATTEMPTS) {
      j = { ...j, step: "failed", attempts, lastError: msg };
      await commit();
      emit({ type: "failed", job: j });
    } else {
      j = { ...j, attempts, nextAt: d.now() + backoffMs(attempts), lastError: msg };
      await commit();
    }
  }
  return j;
}

export async function photoJobsFor(userId: string): Promise<PhotoJob[]> {
  try {
    return (await getStore().allJobs()).filter((j) => j.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

/** Advance one job now, if no run of it is going (the composer's call right after createPhotoJob). */
export async function runPhotoJob(id: string, d: PhotoJobDeps): Promise<PhotoJob | undefined> {
  if (busy.has(id)) return undefined;
  busy.add(id);
  try {
    const j = (await getStore().allJobs()).find((x) => x.id === id);
    return j ? await advancePhotoJob(j, d) : undefined;
  } finally {
    busy.delete(id);
  }
}

/** Every due job of this member, oldest first (app start, back online, a tick). */
export async function runPhotoJobs(userId: string, d: PhotoJobDeps): Promise<void> {
  for (const j of await photoJobsFor(userId)) {
    if (j.step === "failed" || j.nextAt > d.now()) continue;
    await runPhotoJob(j.id, d);
  }
}

/** The member gave up on a failed post: drop it and its bytes. */
export async function discardPhotoJob(id: string): Promise<void> {
  await getStore().deleteJob(id);
  await getStore().deleteFiles(id);
}

/** Sign-out wipe (OFF-5 G6). */
export async function clearPhotoUploads(): Promise<boolean> {
  try { await getStore().clear(); return true; } catch { return false; }
}

export function __resetPhotoJobs() { busy.clear(); listeners.clear(); store = undefined; }
