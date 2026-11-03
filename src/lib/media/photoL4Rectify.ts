/**
 * PHOTO PLAN · RECTIFY THE `-l4` POSTS — pure key rules, shared by the Pages
 * route (functions/api/media/photoset/rectify.ts), its worker
 * (tools/media-derivatives/rectify-l4.mjs) and the tests.
 *
 * Owner-approved (3 Nov 2026): photos uploaded while the switch was on (2 → 3
 * Nov) were stored ONLY as a `-l4` set whose URL IS the credited 2048 with the
 * first, big credit. Each such photo gets a v3 (`-l5`) set made from its CLEAN
 * 1080 (`-l4-r1080`), and its post is repointed (20261110_0107, reversible):
 *
 *   `<stem>-w{W}h{H}-l4-r1080.webp`  → `<stem>-w{w}h{h}-l5.webp`        server-side COPY (clean 1080 = the URL)
 *   `<stem>-w{W}h{H}-l4-thumb.webp`  → `<stem>-w{w}h{h}-l5-thumb.webp`  server-side COPY
 *   `<stem>-w{W}h{H}-l4-r320.webp`   → `<stem>-w{w}h{h}-l5-r320.webp`   server-side COPY
 *   the clean 1080 + the small credit → `<stem>-w{w}h{h}-l5-r2048c.webp` drawn by the worker (only file it sends)
 *
 * (w, h) = the real size of the `-l4-r1080` file (its WebP header). The old
 * files are not touched, overwritten or deleted (they stay unreferenced; they
 * go only through the held delete path).
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SOURCE_RE = new RegExp(`^(post-images/${UUID}/posts/[A-Za-z0-9_.-]+?)-w(\\d{1,4})h(\\d{1,4})-l4\\.webp$`);

export interface RectifyKeys {
  /** the `-l4` key (the credited 2048 the post names today) */
  source: string;
  /** the clean copies that already exist */
  from: { r1080: string; thumb: string; r320: string };
  /** the v3 keys this rectify writes, at (w, h) */
  to: { url: string; credited: string; thumb: string; r320: string };
}

/** The `-l4` master's long and short sides from its name, or null when the key is not a rectify source. */
export function rectifySource(key: string): { stem: string; w: number; h: number } | null {
  if (typeof key !== "string" || key.length > 400 || key.includes("..")) return null;
  const m = SOURCE_RE.exec(key);
  if (!m) return null;
  const w = Number(m[2]);
  const h = Number(m[3]);
  if (!(w > 0 && h > 0) || Math.max(w, h) <= 1080) return null; // a small -l4 photo has no clean 1080 to start from
  return { stem: m[1], w, h };
}

/** The encoder's rounding (photoSetEncode.fitInside). */
export function fit1080(w: number, h: number): { width: number; height: number } {
  if (w <= 1080 && h <= 1080) return { width: w, height: h };
  const r = Math.min(1080 / w, 1080 / h);
  return { width: Math.round(w * r), height: Math.round(h * r) };
}

/** Is `w × h` (the real `-l4-r1080` header) the honest 1080 of a `W × H` master (±1 px)? */
export function is1080Of(W: number, H: number, w: number, h: number): boolean {
  const want = fit1080(W, H);
  return Math.abs(want.width - w) <= 1 && Math.abs(want.height - h) <= 1 && Math.max(w, h) <= 1080;
}

/** Every key, from the source key and the real size of its clean 1080. Null = not a rectify source. */
export function rectifyKeys(sourceKey: string, w1080: number, h1080: number): RectifyKeys | null {
  const s = rectifySource(sourceKey);
  if (!s || !is1080Of(s.w, s.h, w1080, h1080)) return null;
  const old = `${s.stem}-w${s.w}h${s.h}-l4`;
  const neu = `${s.stem}-w${w1080}h${h1080}-l5`;
  return {
    source: sourceKey,
    from: { r1080: `${old}-r1080.webp`, thumb: `${old}-thumb.webp`, r320: `${old}-r320.webp` },
    to: { url: `${neu}.webp`, credited: `${neu}-r2048c.webp`, thumb: `${neu}-thumb.webp`, r320: `${neu}-r320.webp` },
  };
}

/** The `-l4-r1080` key of a source (what the worker reads to draw the credit). */
export function rectifyCleanKey(sourceKey: string): string | null {
  const s = rectifySource(sourceKey);
  return s ? `${s.stem}-w${s.w}h${s.h}-l4-r1080.webp` : null;
}
