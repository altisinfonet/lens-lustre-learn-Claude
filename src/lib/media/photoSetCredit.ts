/**
 * CREDIT U3 · a new photo's credited copy — pure key and size rules, shared by
 * the route (functions/api/media/photoset/setcredit.ts) and its tests.
 *
 * The uploader sends clean files only. The server draws `<photo>-r2048c.webp`
 * once a post or entry names the photo. A v3 photo's clean copy has its own
 * rules (./cleanCopy.ts), so the shape check is that one, not a second regex.
 */
import { CREDITED_SUFFIX } from "../imageLadder";
import { cleanCopySizeOk, cleanCopyTarget, cleanCopyUploadKey, type CleanCopyTarget } from "./cleanCopy";

export interface PhotoSetCreditTarget extends CleanCopyTarget {
  /** The public key of the photo: what the post or entry names. */
  photoKey: string;
  /** Where the credited copy goes, in the photo bucket. */
  creditedKey: string;
  /** The private clean 2048, in the MEDIA bucket. */
  cleanKey: string;
}

/** Null when `key` is not exactly a v3 photo (`-l5` post, `-l5f` entry): no sibling, no other folder, no path trick. */
export function photoSetCreditTarget(key: unknown): PhotoSetCreditTarget | null {
  if (typeof key !== "string" || !key.endsWith(".webp")) return null;
  const t = cleanCopyTarget(cleanCopyUploadKey(key));
  if (!t) return null;
  return { ...t, photoKey: key, creditedKey: key.replace(/\.webp$/, `${CREDITED_SUFFIX}.webp`), cleanKey: t.privateKey };
}

/**
 * A credited copy is this photo's 2048, or, when no clean copy was kept (it is
 * best effort), the size of the public file it was drawn on (a `-l5f` full size
 * above 2048 is scaled to the 2048 first, so that case is the 2048 rule).
 */
export function creditedSizeOk(t: PhotoSetCreditTarget, w: number, h: number): boolean {
  if (cleanCopySizeOk(t, w, h)) return true;
  return w === t.urlWidth && h === t.urlHeight && Math.max(w, h) <= 2048;
}
