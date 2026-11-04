/**
 * PHOTO PLAN U5 · the backfill's key rules — pure, so the tests exercise the
 * same code the Pages Functions (functions/api/media/photoset/*) run.
 *
 * An OLD post photo (unmarked or `-l3`, in the lane's photo bucket) gets the
 * v2 set written BESIDE it, in the same folder, never over it:
 *
 *   <old name without .webp>-w{W}h{H}-l4.webp          credited 2048 (the URL)
 *   <old name without .webp>-w{W}h{H}-l4-r1080.webp    when the long edge > 1080
 *   <old name without .webp>-w{W}h{H}-l4-thumb.webp    600 (always)
 *   <old name without .webp>-w{W}h{H}-l4-r320.webp     when the long edge > 320
 *
 * WHY THE WHOLE OLD NAME is the stem (dimensions and `-l3` kept): two old
 * photos in one folder may differ only in a suffix (`x.webp` and
 * `x-w1080h719.webp`); stripping it would give both the same new key, and the
 * never-overwrite writer would then take one photo's copy for the other. The
 * full name is unique in its folder, so the new key is too. imageLadder's
 * SET_RE reads the LAST `-w..h..-l4`, so the display code and the orphan scan
 * understand these names unchanged (locked in photoSetBackfill.test.ts).
 *
 * The SQL (`photo_set_backfill_*`, 20261110_0101) spells the same names; the
 * fixture checks the same examples on both lane shapes.
 */
import { PHOTO_SET_QUALITY } from "../imageLadder";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** post-images/<owner uuid>/[folders/]<name>.webp — nothing else is a backfill source. */
const SOURCE_RE = new RegExp(`^post-images/(${UUID})/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\\.webp$`);

export const BACKFILL_SLOTS = ["master", "r1080", "thumb", "r320"] as const;
export type BackfillSlot = (typeof BACKFILL_SLOTS)[number];

export function isBackfillSlot(s: unknown): s is BackfillSlot {
  return typeof s === "string" && (BACKFILL_SLOTS as readonly string[]).includes(s);
}

/** True only for an old (not v2) post photo in a member's post-images folder. */
export function isBackfillSource(key: string): boolean {
  if (!SOURCE_RE.test(key) || key.includes("..")) return false;
  if (key.split("/")[2] === "d") return false; // the S3 derivative folder
  if (/-l(?:[45]f?|6)(?:-thumb|-r\d{3,4}c?)?\.webp$/i.test(key)) return false; // already a set (v2, v3 from Unit A, or the -l6 feed set)
  if (/-thumb\.webp$/i.test(key) || /-l3-r\d{3,4}\.webp$/i.test(key)) return false; // a copy, not a photo
  return true;
}

/** Owner uuid of a source key (its folder). */
export function backfillOwner(key: string): string | null {
  const m = SOURCE_RE.exec(key);
  return m ? m[1] : null;
}

/** The credited 2048 copy's key (the new URL) for a source and the copy's own size. */
export function backfillMasterKey(sourceKey: string, width: number, height: number): string {
  return sourceKey.replace(/\.webp$/, `-w${width}h${height}-l4.webp`);
}

/** One copy's key, from the master key. */
export function backfillSlotKey(masterKey: string, slot: BackfillSlot): string {
  if (slot === "master") return masterKey;
  return masterKey.replace(/-l4\.webp$/, `-l4-${slot}.webp`);
}

/** The uploader's rounding: fit the long edge inside `max`, never upscale (photoSetEncode.fitInside). */
function fit(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= max && height <= max) return { width, height };
  const ratio = Math.min(max / width, max / height);
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

export interface BackfillCopy {
  slot: BackfillSlot;
  maxDimension: number;
  quality: number;
  credit: boolean;
  width: number;
  height: number;
}

/**
 * The v2 (`-l4`) plan this backfill writes, FROZEN here: the uploader moved to
 * the v3 set in photo plan Unit A (imageLadder.photoSetPlan), and this writer,
 * its SQL (20261110_0101) and its census still speak `-l4`. Its replacement
 * (v3 copies from the originals, the l4 rectification) is Unit A's second
 * step; until then this keeps the routes exactly as audited.
 */
function v2Plan(width: number, height: number): Array<{ slot: BackfillSlot; maxDimension: number; quality: number; credit: boolean }> {
  const longEdge = Math.max(width, height);
  const plan: Array<{ slot: BackfillSlot; maxDimension: number; quality: number; credit: boolean }> = [
    { slot: "master", maxDimension: 2048, quality: PHOTO_SET_QUALITY[2048], credit: true },
  ];
  if (longEdge > 1080) plan.push({ slot: "r1080", maxDimension: 1080, quality: PHOTO_SET_QUALITY[1080], credit: false });
  plan.push({ slot: "thumb", maxDimension: 600, quality: PHOTO_SET_QUALITY[600], credit: false });
  if (longEdge > 320) plan.push({ slot: "r320", maxDimension: 320, quality: PHOTO_SET_QUALITY[320], credit: false });
  return plan;
}

/** The copies a source of `width × height` gets (the frozen v2 plan above). */
export function backfillSlots(width: number, height: number): BackfillCopy[] {
  if (!(width > 0 && height > 0)) return [];
  return v2Plan(width, height).map((c) => ({ ...c, ...fit(width, height, c.maxDimension) }));
}
