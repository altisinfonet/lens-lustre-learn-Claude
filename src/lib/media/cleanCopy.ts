/**
 * PHOTO PLAN UNIT A · the PRIVATE clean 2048 — pure rules shared by the
 * uploader (src/lib/photoSetUpload.ts, src/lib/upload/photoJobs.ts) and the
 * Pages route that stores it (functions/api/media/clean-copy.ts).
 *
 * Every v3 photo (`-l5` post, `-l5f` competition entry) keeps one clean 2048
 * copy that NOBODY can load: it lives in the lane's MEDIA bucket (the video
 * bucket, no public host) under `photo-clean/`, written only by the route
 * below. Its one job: the credit can be redrawn later (a name change, a new
 * wording) without the member uploading again, and without ever publishing
 * a clean large copy.
 *
 * The uploader names it by the PUBLIC key plus `-r2048`
 * (`post-images/<uid>/posts/x-w1080h720-l5-r2048.webp`); the route turns that
 * into `photo-clean/post-images/<uid>/posts/x-w1080h720-l5-r2048.webp`.
 */
import { CLEAN_2048_SUFFIX, CLEAN_PREFIX } from "../imageLadder";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_RE = new RegExp(
  `^(post-images/(${UUID})/posts|competition-photos/(${UUID})/competitions)/[A-Za-z0-9_.-]+-w(\\d{1,5})h(\\d{1,5})(-l5f?)${CLEAN_2048_SUFFIX}\\.webp$`,
);

export interface CleanCopyTarget {
  /** Owner uuid (the folder) — must be the caller. */
  owner: string;
  /** The key in the MEDIA bucket. */
  privateKey: string;
  marker: "-l5" | "-l5f";
  /** Dimensions of the PUBLIC file the photo's URL names. */
  urlWidth: number;
  urlHeight: number;
}

/** The uploader's key for a photo's clean 2048 (public key + `-r2048`). */
export function cleanCopyUploadKey(publicKey: string): string {
  return publicKey.replace(/\.webp$/, `${CLEAN_2048_SUFFIX}.webp`);
}

/** Null when `key` is not exactly a v3 clean-copy key (no path tricks, no other folder). */
export function cleanCopyTarget(key: string): CleanCopyTarget | null {
  if (typeof key !== "string" || key.length > 400 || key.includes("..")) return null;
  const m = KEY_RE.exec(key);
  if (!m) return null;
  return {
    owner: m[2] ?? m[3],
    privateKey: `${CLEAN_PREFIX}${key}`,
    marker: m[6] as "-l5" | "-l5f",
    urlWidth: Number(m[4]),
    urlHeight: Number(m[5]),
  };
}

/** The encoder's rounding (photoSetEncode.fitInside). */
export function fitInside(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= max && height <= max) return { width, height };
  const ratio = Math.min(max / width, max / height);
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1;

/**
 * Is a clean copy of `w × h` the honest 2048 of this photo?
 *   `-l5f`  the URL is the full size: the copy is fit(full, 2048) (±1 px rounding).
 *   `-l5`   the URL is the 1080 copy: a photo smaller than 1080 is its own 2048
 *           (same size as the URL); otherwise the copy's long edge is 1080–2048
 *           and it shrinks to the URL's size (±1 px).
 */
export function cleanCopySizeOk(t: CleanCopyTarget, w: number, h: number): boolean {
  if (!(w > 0 && h > 0) || Math.max(w, h) > 2048) return false;
  if (t.marker === "-l5f") {
    const want = fitInside(t.urlWidth, t.urlHeight, 2048);
    return near(w, want.width) && near(h, want.height);
  }
  const urlLong = Math.max(t.urlWidth, t.urlHeight);
  if (urlLong < 1080) return w === t.urlWidth && h === t.urlHeight;
  if (Math.max(w, h) < 1080) return false;
  const down = fitInside(w, h, 1080);
  return near(down.width, t.urlWidth) && near(down.height, t.urlHeight);
}
