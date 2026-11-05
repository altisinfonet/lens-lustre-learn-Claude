/**
 * THE OLD PHOTOS' FEED COPIES — so an old photo never loads its full original
 * in the feed (Owner, 5 Nov 2026: "photo must come in App less than 1 sec").
 *
 * An OLD feed photo (posted before the photo plan: no set marker, no `-l3`
 * ladder, on this site's CDN) names no phone-size copy, so the feed used to
 * download the original — 0.45–4.4 MB measured on live, 5–45 s on a slow
 * phone link. The backfill (20261110_0101) stored a CLEAN 1080 (`-l4-r1080`,
 * only when the long edge is over 1080) and a 600 (`-l4-thumb`) beside most of
 * them; post_photo_feed_copies (20261110_0112) names those for the posts the
 * viewer can see. Nothing is repointed or written.
 *
 * READ, BATCHED: every card asking in the same tick shares ONE call (≤ 50 ids),
 * like photoOldCredit.ts — but on the web AND in the app (both show photos).
 * Until a photo's answer is in, `feedCopyFor` says `undefined` and the card
 * shows its small preview only; the sharp layer waits (≤ FEED_COPY_WAIT_MS)
 * so it never starts the multi-MB original for a photo that has a 1080.
 */
import { useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { hasLadderMarker, photoSetMarker } from "@/lib/imageLadder";

export const FEED_COPY_BATCH_MAX = 50;
/** The longest a card waits for the lookup before it loads the original anyway. */
export const FEED_COPY_WAIT_MS = 1200;

type Rpc = (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc: Rpc = (fn, a) => (supabase.rpc as unknown as Rpc)(fn, a);

export interface FeedCopy {
  /** The clean 1080 (null when the original is itself ≤ 1080 or none is stored). */
  feed: string | null;
  /** The clean 600 stored beside it (null when none). */
  thumb: string | null;
}

/* ── the store: src URL → answer (null = answered, nothing stored) ── */
const answers = new Map<string, FeedCopy | null>();
const asked = new Set<string>();
const urlsOf = new Map<string, string[]>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version++; for (const l of [...listeners]) l(); };

/** An OLD photo on this site's CDN: no set marker, no `-l3` ladder, not a Supabase-storage URL (those are resized by Supabase). */
export function needsFeedCopy(url: string | null | undefined): boolean {
  return !!url && /^https:\/\//.test(url) && !photoSetMarker(url) && !hasLadderMarker(url) && !/\/storage\/v1\/(object|render)\//.test(url);
}

const requested = new Set<string>();

/**
 * undefined = asked, answer not in yet · null = nothing to wait for (answered
 * with no copy, or never asked — a surface without the card's lookup) · FeedCopy
 * = the stored clean copies.
 */
export function feedCopyFor(url: string | null | undefined): FeedCopy | null | undefined {
  if (!url || !needsFeedCopy(url)) return null;
  if (answers.has(url)) return answers.get(url);
  return requested.has(url) ? undefined : null;
}

/** Re-render when lookup answers arrive (the number itself means nothing). */
export function useFeedCopiesVersion(): number {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => version,
    () => version,
  );
}

const clean = (u: unknown, re: RegExp): string | null => (typeof u === "string" && /^https:\/\//.test(u) && re.test(u) ? u : null);

let pending = new Set<string>();
let scheduled = false;

async function flush(): Promise<void> {
  const ids = [...pending];
  pending = new Set();
  scheduled = false;
  for (let i = 0; i < ids.length; i += FEED_COPY_BATCH_MAX) {
    const chunk = ids.slice(i, i + FEED_COPY_BATCH_MAX);
    const found = new Map<string, FeedCopy>();
    try {
      const { data, error } = await rpc("post_photo_feed_copies", { p_post_ids: chunk });
      if (error) throw new Error(error.message || "post_photo_feed_copies refused");
      for (const r of Array.isArray(data) ? (data as Record<string, unknown>[]) : []) {
        if (!r || typeof r.src_url !== "string") continue;
        // Only the CLEAN siblings — never the `-l4` master (it carries the retired credit).
        found.set(r.src_url, { feed: clean(r.feed_url, /-l4-r1080\.webp$/), thumb: clean(r.thumb_url, /-l4-thumb\.webp$/) });
      }
    } catch {
      // No answer = the original, as before. Not asked again in this page load.
    }
    for (const id of chunk) for (const u of urlsOf.get(id) ?? []) if (!answers.has(u)) answers.set(u, found.get(u) ?? null);
    emit();
  }
}

/** Ask once per post (per page load) for its old photos' feed copies. */
export function requestFeedCopies(postId: string, urls: readonly string[]): void {
  const old = urls.filter(needsFeedCopy);
  if (!postId || !old.length || asked.has(postId)) return;
  asked.add(postId);
  urlsOf.set(postId, old);
  for (const u of old) requested.add(u);
  pending.add(postId);
  if (!scheduled) {
    scheduled = true;
    setTimeout(() => { void flush(); }, 0);
  }
}

/**
 * The card's one line (web and app): ask for this post's old photos' feed
 * copies. Asked DURING the card's render (idempotent: once per post per page
 * load), so the photo below it already knows to wait — an effect would run
 * after the photo had started downloading its original.
 */
export function useFeedCopiesRead(postId: string | null | undefined, urls: readonly string[]): void {
  if (postId) requestFeedCopies(postId, urls);
}

/** For tests: forget everything. */
export function __resetFeedCopies(): void {
  answers.clear(); asked.clear(); urlsOf.clear(); requested.clear(); pending = new Set(); scheduled = false; version = 0;
}
