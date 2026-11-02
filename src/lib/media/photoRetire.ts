/**
 * PHOTO PLAN U6 / U7 · which object keys the retire route may EVER delete —
 * pure, so the tests exercise the code the Pages Function runs. The SQL
 * (20261110_0103 photo_retire, its CHECK and the mark functions) decides WHAT is
 * due; this is the route's second, independent refusal, so no bug in a mark
 * can aim the deleter at a copy that must stay.
 *
 *   comp_full  a v2 competition FULL-SIZE file  competition-photos/<uuid>/competitions/<name>-w{W}h{H}-l4f.webp
 *              (never its -r2048 / -r1080 / -thumb / -r320 copies, never an old entry photo)
 *   post_old   an OLD post photo or one of its old copies (-thumb, -l3 rungs) in a
 *              member's post-images folder — never a `-l4` / `-l4f` copy, never the
 *              S3 derivative folder (/d/)
 */
export type RetireKind = "comp_full" | "post_old";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const COMP_FULL_RE = new RegExp(`^competition-photos/${UUID}/competitions/[A-Za-z0-9_.-]+-w\\d{1,5}h\\d{1,5}-l4f\\.webp$`);
const POST_RE = new RegExp(`^post-images/${UUID}/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]+\\.webp$`);
const V2_COPY_RE = /-l4f?(?:-thumb|-r\d{3,4})?\.webp$/i;

export function isRetireKey(kind: RetireKind, key: string): boolean {
  if (typeof key !== "string" || key.includes("..")) return false;
  if (kind === "comp_full") return COMP_FULL_RE.test(key);
  if (kind === "post_old") return POST_RE.test(key) && !V2_COPY_RE.test(key) && key.split("/")[2] !== "d";
  return false;
}
