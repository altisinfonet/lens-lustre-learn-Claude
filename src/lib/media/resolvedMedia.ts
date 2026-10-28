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
const REGISTRY_MAX = 3000;
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

let switchCache: { at: number; on: Promise<boolean> } | null = null;
const SWITCH_TTL_MS = 60_000;

/** `media_ladder_feed` for the signed-in member, asked at most once a minute. False on any error. */
export function ladderSwitchOn(now: number = Date.now()): Promise<boolean> {
  if (!switchCache || now - switchCache.at > SWITCH_TTL_MS) {
    switchCache = { at: now, on: fetchFeatureAllowed("media_ladder_feed").catch(() => false) };
  }
  return switchCache.on;
}

/** Test seam. */
export function __resetResolvedMediaForTests(): void {
  switchCache = null;
  registry.clear();
}

/** Rows → per-post slides. Exported for tests. */
export function groupResolved(rows: readonly ResolvedRow[]): ResolvedMap {
  const map: ResolvedMap = new Map();
  for (const r of rows) {
    if (!r?.post_id || typeof r.url !== "string" || !/^https:\/\//.test(r.url)) continue;
    const slides = map.get(r.post_id) ?? [];
    let s = slides.find((x) => x.ord === r.ord);
    if (!s) { s = { ord: r.ord, rungs: [] }; slides.push(s); }
    if (!s.rungs.some((x) => x.url === r.url)) s.rungs.push({ url: r.url, width: r.width, height: r.height });
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
    return groupResolved(rows);
  } catch {
    return new Map();
  }
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
