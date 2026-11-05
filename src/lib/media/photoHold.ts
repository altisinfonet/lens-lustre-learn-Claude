/**
 * PHOTO CLEAN-UP (Owner, 5 Nov 2026: "GO MOVE") · which object keys the hold
 * route may EVER move to the private holding folder — pure, so the tests
 * exercise the code the Pages Function runs. The SQL (20261110_0113
 * photo_extra_mark + its reference scan) decides WHAT is queued; this is the
 * route's second, independent refusal.
 *
 *   an old credit copy        post-images/<member>/posts/credit/<post>-<ord>-<hash12>.webp
 *   a never-shown -l4 master  post-images/<member>/…-w{W}h{H}-l4.webp
 *   its 320                   post-images/<member>/…-w{W}h{H}-l4-r320.webp
 * NEVER `-l4-r1080` / `-l4-thumb` (post_photo_feed_copies serves them), never
 * any other file.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CREDIT_COPY_RE = new RegExp(`^post-images/${UUID}/posts/credit/${UUID}-\\d{1,2}-[0-9a-f]{12}\\.webp$`);
const L4_EXTRA_RE = new RegExp(`^post-images/${UUID}/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+-w\\d{1,4}h\\d{1,4}-l4(?:-r320)?\\.webp$`);

/** Where a held file waits in the lane's private MEDIA bucket. */
export const HOLD_PREFIX = "photo-holding/";

export function isHoldKey(key: string): boolean {
  if (typeof key !== "string" || key.includes("..")) return false;
  return CREDIT_COPY_RE.test(key) || L4_EXTRA_RE.test(key);
}

export function holdKeyFor(key: string): string {
  return HOLD_PREFIX + key;
}
