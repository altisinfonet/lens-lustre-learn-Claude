/**
 * S3-c · THE DERIVATIVE LADDER ON THE CLIENT, behind `media_ladder_feed`.
 * Design: docs/evidence/d2/S3/DESIGN.md §4.
 *
 * When the switch is on for the signed-in member, the one attachment path
 * (src/lib/posts/postAttachments.ts) also asks `post_media_resolved_for` for a
 * page's posts. For every post it returns (all or nothing per post, server
 * rule), the post's image URLs become its LARGEST stored derivative (≤ 1440 px
 * WebP) — so every surface that renders `image_urls`, with or without a
 * srcset, shows a derivative and never the original. The full 600/1080/1440
 * srcset and the 600 px thumb are kept in a small registry keyed by that URL,
 * so `PostMedia` can offer them without a new prop through twelve components.
 * The ORIGINAL is remembered beside it for the two places that need it: zoom
 * and download (`originalFor`).
 *
 * Switch off, signed out, RPC missing or failing → nothing here runs and every
 * surface behaves exactly as today. Old app builds never load this code.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchFeatureAllowed } from "@/hooks/core/useFeatureAllowed";
import { SITE_API, siteFetch } from "@/lib/net/siteApi";

export interface ResolvedRow {
  post_id: string;
  ord: number;
  media_id: string;
  width: number;
  height: number;
  mime: string;
  url: string;
}

export interface ResolvedSlide {
  ord: number;
  /** smallest first */
  rungs: Array<{ url: string; width: number; height: number }>;
}
export type ResolvedMap = Map<string, ResolvedSlide[]>;

export interface LadderEntry {
  srcSet: string;
  thumb: string;
  original: string | null;
  width: number;
  height: number;
}

const BATCH = 50; // the RPC refuses more (MEDIA-1001)
const REGISTRY_MAX = 10000; // ~1–2 MB of strings; eviction would only cost zoom its original
const registry = new Map<string, LadderEntry>();

/** The srcset / thumb / original for a URL this module handed out, if any. */
export function ladderFor(url: string | null | undefined): LadderEntry | undefined {
  return url ? registry.get(url) : undefined;
}

/** Zoom and download: the original behind a derivative URL; any other URL unchanged. */
export function originalFor(url: string): string {
  return registry.get(url)?.original ?? url;
}

function remember(url: string, e: LadderEntry): void {
  if (registry.has(url)) registry.delete(url);
  registry.set(url, e);
  while (registry.size > REGISTRY_MAX) registry.delete(registry.keys().next().value as string);
}

let switchCache: { at: number; uid: string; on: Promise<boolean> } | null = null;
const SWITCH_TTL_MS = 60_000;

/**
 * `media_ladder_feed` for the signed-in member, asked at most once a minute per
 * member. Signed out: false without asking (anon cannot execute the RPC). False
 * on any error.
 */
export async function ladderSwitchOn(now: number = Date.now()): Promise<boolean> {
  let uid = "";
  try { uid = (await supabase.auth.getSession()).data.session?.user?.id ?? ""; } catch { uid = ""; }
  if (!uid) return false;
  if (!switchCache || switchCache.uid !== uid || now - switchCache.at > SWITCH_TTL_MS) {
    switchCache = { at: now, uid, on: fetchFeatureAllowed("media_ladder_feed").catch(() => false) };
  }
  return switchCache.on;
}

/** Test seam. */
export function __resetResolvedMediaForTests(): void {
  switchCache = null;
  registry.clear();
  passes.clear();
}

/** Rows → per-post slides. Exported for tests. */
export function groupResolved(rows: readonly ResolvedRow[]): ResolvedMap {
  const map: ResolvedMap = new Map();
  for (const r of rows) {
    if (!r?.post_id || typeof r.url !== "string" || !/^https:\/\//.test(r.url)) continue;
    const slides = map.get(r.post_id) ?? [];
    let s = slides.find((x) => x.ord === r.ord);
    if (!s) { s = { ord: r.ord, rungs: [] }; slides.push(s); }
    // Small photos have rungs of the same size: keep one per width (no duplicate srcset widths).
    if (!s.rungs.some((x) => x.url === r.url || x.width === r.width)) s.rungs.push({ url: r.url, width: r.width, height: r.height });
    map.set(r.post_id, slides);
  }
  for (const slides of map.values()) {
    slides.sort((a, b) => a.ord - b.ord);
    for (const s of slides) s.rungs.sort((a, b) => a.width - b.width);
  }
  return map;
}

/** One page's resolved media. Any failure → an empty map (today's path for every post). */
export async function fetchResolvedMediaMap(postIds: readonly string[]): Promise<ResolvedMap> {
  const ids = [...new Set(postIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  try {
    const rows: ResolvedRow[] = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const { data, error } = await (supabase.rpc as unknown as (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)(
        "post_media_resolved_for", { _post_ids: ids.slice(i, i + BATCH) },
      );
      if (error) return new Map();
      if (Array.isArray(data)) rows.push(...(data as ResolvedRow[]));
    }
    return groupResolved(await withPhotoPasses(rows));
  } catch {
    return new Map();
  }
}

// ── S3-d: friends-only / only-me derivatives need a photo pass ──────────────
const PASS_MARGIN_S = 300;
const passes = new Map<string, { token: string; exp: number }>();

export function isPrivatePhotoUrl(url: string): boolean {
  try { return new URL(url).pathname.startsWith("/photo/"); } catch { return false; }
}

/** Fetches passes for these posts into `passes`. */
export type PassFetcher = (postIds: string[]) => Promise<Array<[mediaId: string, token: string, exp: number]>>;

/**
 * S3-d2: passes from /api/media/photo-token (this lane's Pages origin), asked AS
 * the signed-in member. Signed out, refused (e.g. 503 until PHOTO_DELIVERY_PRIVATE
 * is set) or offline → no passes, and every private post falls back whole.
 */
export const fetchPassesFromMinter: PassFetcher = async (postIds) => {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) return [];
  const res = await siteFetch(SITE_API.mediaPhotoToken, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ post_ids: postIds }),
  });
  if (!res.ok) return [];
  const b = (await res.json()) as { tokens?: Record<string, string>; expires_at?: number };
  if (!b.tokens || typeof b.expires_at !== "number") return [];
  const exp = b.expires_at;
  return Object.entries(b.tokens).filter(([, t]) => typeof t === "string").map(([m, t]) => [m, t, exp]);
};

/**
 * Private rows get `?t=<pass>`. A post with ANY private row that has no pass is
 * dropped whole (it falls back to today's path) — never shown half-broken.
 * Exported for tests.
 */
export async function withPhotoPasses(rows: ResolvedRow[], nowS: number = Math.floor(Date.now() / 1000), fetchPasses: PassFetcher = fetchPassesFromMinter): Promise<ResolvedRow[]> {
  const priv = rows.filter((r) => isPrivatePhotoUrl(r.url));
  if (priv.length === 0) return rows;
  const fresh = (id: string) => { const p = passes.get(id); return p && p.exp - nowS > PASS_MARGIN_S ? p.token : null; };
  const need = [...new Set(priv.filter((r) => !fresh(r.media_id)).map((r) => r.post_id))];
  for (let i = 0; i < need.length; i += BATCH) {
    try {
      for (const [mediaId, token, exp] of await fetchPasses(need.slice(i, i + BATCH))) {
        if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) && Number.isFinite(exp)) passes.set(mediaId, { token, exp });
      }
    } catch { /* fall back below */ }
  }
  const dropped = new Set<string>();
  const out: ResolvedRow[] = [];
  for (const r of rows) {
    if (!isPrivatePhotoUrl(r.url)) { out.push(r); continue; }
    const t = fresh(r.media_id);
    if (!t) { dropped.add(r.post_id); continue; }
    out.push({ ...r, url: `${r.url}?t=${encodeURIComponent(t)}` });
  }
  return dropped.size ? out.filter((r) => !dropped.has(r.post_id)) : out;
}

/**
 * The post's display URLs from the ladder (largest derivative per slide), or
 * null when the post has no resolved media (the caller keeps today's path).
 * `originals` are today's URLs for the same slides, in the same order, used
 * only for zoom and download.
 */
export function resolvedImageUrls(map: ResolvedMap | undefined, postId: string, originals: readonly string[] | undefined): string[] | null {
  const slides = map?.get(postId);
  if (!slides || slides.length === 0) return null;
  const aligned = originals && originals.length === slides.length ? originals : null;
  const out: string[] = [];
  slides.forEach((s, i) => {
    const big = s.rungs[s.rungs.length - 1];
    if (!big) return;
    remember(big.url, {
      srcSet: s.rungs.map((r) => `${r.url} ${r.width}w`).join(", "),
      thumb: s.rungs[0].url,
      original: aligned ? aligned[i] : null,
      width: big.width,
      height: big.height,
    });
    out.push(big.url);
  });
  return out.length === slides.length ? out : null;
}
