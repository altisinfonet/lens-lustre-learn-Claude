/**
 * THE OLD PHOTOS' CREDITED COPY — the web's save target for a photo posted
 * before the New Photos plan (Owner 3 Nov 2026: "credit old all photos from
 * starting: yes"; 20261110_0109).
 *
 * An old photo's URL carries no set marker, so — unlike a new photo, whose
 * credited `-r2048c` sibling follows from its name — its credited copy cannot
 * be derived: it is LOOKED UP. post_photo_credit_for(post ids) answers with the
 * copies of the posts the viewer can see (can_view_post), and only while the
 * post still shows exactly that photo. Nothing is repointed: the screen shows
 * the URL it always showed; "save image as" / "copy image address" (web only,
 * via photoSaveTarget) get the credited file. The app has no save, so the app
 * never asks.
 *
 * READ, BATCHED: every card asking in the same tick shares ONE call (≤ 50 ids
 * per call), exactly like the camera details (photoCameraRead.ts) — so the
 * cost is one request per feed batch, not per card, and only for posts that
 * have an old photo. The answers live in one module store (src URL → credited
 * URL) that the save-target code reads; `useOldPhotoCreditVersion` re-renders
 * a photo when its answer arrives.
 */
import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { photoSetMarker } from "@/lib/imageLadder";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";

export const OLD_CREDIT_BATCH_MAX = 50;

type Rpc = (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc: Rpc = (fn, a) => (supabase.rpc as unknown as Rpc)(fn, a);

/* ── the store ── */
const credited = new Map<string, string>();
const asked = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version++; for (const l of [...listeners]) l(); };

/** The credited copy of an OLD photo shown at `url`, if the lookup found one (null otherwise). */
export function oldPhotoCreditedUrl(url: string | null | undefined): string | null {
  if (!url || photoSetMarker(url)) return null;
  return credited.get(url) ?? null;
}

/** Re-render when a lookup answer arrives (the number itself means nothing). */
export function useOldPhotoCreditVersion(): number {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => version,
    () => version,
  );
}

/** True when a post shows at least one OLD (unmarked) photo — only those are looked up. */
export function hasOldPhoto(urls: readonly (string | null | undefined)[]): boolean {
  return urls.some((u) => !!u && !photoSetMarker(u));
}

/* ── the batched read ── */
let pending = new Set<string>();
let scheduled = false;

async function flush(): Promise<void> {
  const ids = [...pending];
  pending = new Set();
  scheduled = false;
  for (let i = 0; i < ids.length; i += OLD_CREDIT_BATCH_MAX) {
    const chunk = ids.slice(i, i + OLD_CREDIT_BATCH_MAX);
    try {
      const { data, error } = await rpc("post_photo_credit_for", { p_post_ids: chunk });
      if (error) throw new Error(error.message || "post_photo_credit_for refused");
      let added = 0;
      for (const r of Array.isArray(data) ? (data as Record<string, unknown>[]) : []) {
        if (!r || typeof r.src_url !== "string" || typeof r.credited_url !== "string") continue;
        if (!/^https:\/\//.test(r.credited_url) || photoSetMarker(r.src_url)) continue;
        if (credited.get(r.src_url) !== r.credited_url) { credited.set(r.src_url, r.credited_url); added++; }
      }
      if (added) emit();
    } catch {
      // No answer = today's behaviour (the original is saved). Not asked again in
      // this page load: a lane without 20261110_0109 yet must not see a failing
      // call every time a card scrolls back into view.
    }
  }
}

/**
 * Ask once per post (per page load) for its old photos' credited copies. Call
 * from the card that shows the post — web only (the app has no save).
 */
export function requestOldPhotoCredit(postId: string): void {
  if (!postId || asked.has(postId)) return;
  asked.add(postId);
  pending.add(postId);
  if (!scheduled) {
    scheduled = true;
    setTimeout(() => { void flush(); }, 0);
  }
}

/**
 * The card's one line: ask for this post's old photos' credited copies — only
 * on the web (the app has no save), only while `enabled`, and only when the
 * post shows an old photo. Not tied to the viewer's switch answer: like a new
 * photo's credited copy it is decided by the file (Unit A), so a signed-out
 * visitor's save carries the credit too. Until the worker has recorded copies
 * on a lane, every answer is empty and nothing changes.
 */
export function useOldPhotoCreditRead(postId: string | null | undefined, urls: readonly string[], enabled: boolean): void {
  const old = hasOldPhoto(urls);
  useEffect(() => {
    if (!enabled || !old || !postId || isNativeCapacitorApp()) return;
    requestOldPhotoCredit(postId);
  }, [enabled, old, postId]);
}

/** For tests: forget everything. */
export function __resetOldPhotoCredit(): void {
  credited.clear(); asked.clear(); pending = new Set(); scheduled = false; version = 0;
}
