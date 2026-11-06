/**
 * THE BLUR CODE — every feed photo's blurred fill, drawn at once, no download.
 *
 * Owner, 6 Nov 2026: "blur is not showing in many photos, sometimes the blur
 * takes time … like FB does" → "go blur", old AND new photos. The fill beside
 * a photo shown whole used to be a second download (its 600 copy, LOW
 * priority, after the photo) blurred by the phone — and photos without a small
 * copy got none. Like Facebook / Instagram, each photo now has a ~30-character
 * ThumbHash (src/lib/media/thumbhash.mjs), made once by the server job
 * (tools/media-derivatives/blur.mjs, 20261110_0115). The card turns it into a
 * 32 px picture in memory — no request, no CSS blur on the phone — and paints
 * it under the photo straight away, also as the placeholder while it loads.
 *
 * READ, BATCHED like photoFeedCopies.ts: every card asking in the same tick
 * shares ONE call (≤ 50 posts). `photoBlurFor` says `undefined` until the
 * answer is in, `null` when the photo has no code (yet) — the card then keeps
 * its old 600-copy fill, so nothing is ever worse than before.
 */
import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { rgbaToDataURL, thumbHashToRGBA } from "@/lib/media/thumbhash.mjs";

export const PHOTO_BLUR_BATCH_MAX = 50;
/** Baked into the pixels (no CSS filter): the photo's own edge stays readable beside the fill (was brightness-[0.8]). */
export const PHOTO_BLUR_DIM = 0.8;
const HASH_RE = /^[A-Za-z0-9+/]{6,48}={0,2}$/;

type Rpc = (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc: Rpc = (fn, a) => (supabase.rpc as unknown as Rpc)(fn, a);

/* ── the store: photo URL → data URL (null = answered, no code) ── */
const answers = new Map<string, string | null>();
const requested = new Set<string>();
const asked = new Set<string>();
const urlsOf = new Map<string, string[]>();
const pictures = new Map<string, string | null>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version++; for (const l of [...listeners]) l(); };

const isPhotoUrl = (u: unknown): u is string => typeof u === "string" && /^https:\/\//.test(u);

/** A stored code → the dimmed 32 px PNG data URL (cached per code). Null when the code is unreadable. */
export function blurPicture(hash: string): string | null {
  if (pictures.has(hash)) return pictures.get(hash)!;
  let out: string | null = null;
  try {
    if (HASH_RE.test(hash)) {
      const bytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0));
      const { w, h, rgba } = thumbHashToRGBA(bytes);
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = Math.round(rgba[i] * PHOTO_BLUR_DIM);
        rgba[i + 1] = Math.round(rgba[i + 1] * PHOTO_BLUR_DIM);
        rgba[i + 2] = Math.round(rgba[i + 2] * PHOTO_BLUR_DIM);
      }
      out = rgbaToDataURL(w, h, rgba);
    }
  } catch {
    out = null;
  }
  pictures.set(hash, out);
  return out;
}

/**
 * undefined = asked, answer not in yet · null = no code (answered without one,
 * or never asked — a surface without the card's lookup) · string = the picture.
 */
export function photoBlurFor(url: string | null | undefined): string | null | undefined {
  if (!isPhotoUrl(url)) return null;
  if (answers.has(url)) return answers.get(url);
  return requested.has(url) ? undefined : null;
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => version;

/** Re-render when answers arrive (the number itself means nothing). Stable subscribe: no churn per render. */
export function usePhotoBlurVersion(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

let pending = new Set<string>();
let scheduled = false;

async function flush(): Promise<void> {
  const ids = [...pending];
  pending = new Set();
  scheduled = false;
  for (let i = 0; i < ids.length; i += PHOTO_BLUR_BATCH_MAX) {
    const chunk = ids.slice(i, i + PHOTO_BLUR_BATCH_MAX);
    const found = new Map<string, string>();
    try {
      const { data, error } = await rpc("post_photo_blurs", { p_post_ids: chunk });
      if (error) throw new Error(error.message || "post_photo_blurs refused");
      for (const r of Array.isArray(data) ? (data as Record<string, unknown>[]) : []) {
        if (!r || !isPhotoUrl(r.url) || typeof r.hash !== "string") continue;
        const pic = blurPicture(r.hash);
        if (pic) found.set(r.url, pic);
      }
    } catch {
      // No answer = the old 600-copy fill, as before. Not asked again in this page load.
    }
    for (const id of chunk) for (const u of urlsOf.get(id) ?? []) if (!answers.has(u)) answers.set(u, found.get(u) ?? null);
    emit();
  }
}

/** Ask once per post (per page load) for its photos' blur codes. */
export function requestPhotoBlurs(postId: string, urls: readonly string[]): void {
  const photos = urls.filter(isPhotoUrl);
  if (!postId || !photos.length || asked.has(postId)) return;
  asked.add(postId);
  urlsOf.set(postId, photos);
  for (const u of photos) requested.add(u);
  pending.add(postId);
  if (!scheduled) {
    scheduled = true;
    setTimeout(() => { void flush(); }, 0);
  }
}

/** The card's one line (web and app). Asked during render (idempotent), like useFeedCopiesRead. */
export function usePhotoBlursRead(postId: string | null | undefined, urls: readonly string[]): void {
  if (postId) requestPhotoBlurs(postId, urls);
}

/** For tests: forget everything. */
export function __resetPhotoBlurs(): void {
  answers.clear(); requested.clear(); asked.clear(); urlsOf.clear(); pictures.clear();
  pending = new Set(); scheduled = false; version = 0;
}
