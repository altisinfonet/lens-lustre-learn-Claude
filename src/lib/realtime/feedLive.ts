import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { recordRealtime } from "@/lib/telemetry";

/**
 * S6-b · ONE FEED-LIVE CHANNEL PER CLIENT, EVERY HOT BINDING FILTERED.
 *
 * Before: each `useFeedRealtime` caller (the feed, every wall, the composer on
 * /feed) could open "feed-live", and its five bindings had NO server filter —
 * every post, edit, delete and reaction anywhere on the platform was sent to
 * every open client and discarded in JavaScript.
 *
 * Now there is one channel, owned here, shared by every consumer:
 *   posts INSERT           user_id=in.(me + the consumers' authors)   ≤ 100
 *   posts UPDATE           id=in.(the posts the consumers hold)       ≤ 100
 *   post_reactions INSERT  post_id=in.(the same posts)                ≤ 100
 * A binding whose list is empty is not opened at all (never unfiltered).
 *
 * DECISION S6-b-D1 — two bindings are gone, because Supabase cannot filter
 * DELETE events (the old row carries only the key) and an unfiltered binding is
 * exactly what S6 removes:
 *   · posts DELETE — a post deleted by its author stays on screen until the
 *     next refresh (Instagram/Facebook behave the same); own deletes are
 *     already removed locally.
 *   · post_reactions DELETE — the absolute like count still moves (it rides
 *     the posts UPDATE); only the per-type emoji breakdown of someone else's
 *     un-react waits for the next refresh.
 *
 * The filter lists change as the member scrolls: the channel is rebuilt at
 * most once per REBUILD_MS, under a new topic generation, and the old one is
 * removed — so at rest exactly one feed-live channel exists.
 * Subscribe status goes to S2 telemetry (recordRealtime).
 */
export interface FeedLiveConsumer {
  userId: string;
  /** authors whose NEW posts this consumer wants live */
  authorIds: () => string[];
  /** posts this consumer holds (counts, edits, reactions) */
  postIds: () => string[];
  onInsert: (row: any) => void;
  onUpdate: (row: any) => void;
  onReaction: (row: any) => void;
}

const MAX_IN = 100; // Supabase realtime `in` filter limit
const REBUILD_MS = 1500;
/** The old channel is removed when the new one is subscribed, or after this at the latest. */
const PREV_GRACE_MS = 5000;
const consumers = new Set<FeedLiveConsumer>();
let channel: RealtimeChannel | null = null;
let generation = 0;
let signature = "";
let timer: ReturnType<typeof setTimeout> | null = null;

const uuidOnly = (ids: Iterable<string>) => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
      if (out.length >= MAX_IN) break;
    }
  }
  return out;
};

/** Round-robin across consumers, so one long list cannot starve the others of the 100 slots. */
function* interleave(lists: string[][]): Generator<string> {
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) yield l[i];
}

/** The filters the current consumers need. Exported for the tests. */
export function feedLiveFilters(): { userId: string | null; authors: string[]; posts: string[] } {
  const list = [...consumers];
  const userId = list[0]?.userId ?? null;
  const authors = uuidOnly([...(userId ? [userId] : []), ...interleave(list.map((c) => c.authorIds()))]);
  const posts = uuidOnly(interleave(list.map((c) => c.postIds())));
  return { userId, authors, posts };
}

function build() {
  timer = null;
  const f = feedLiveFilters();
  const next = f.userId ? JSON.stringify(f) : "";
  if (next === signature) return;
  signature = next;
  // The previous channel stays until the new one is SUBSCRIBED (no window
  // in which events are lost); at rest exactly one is open.
  const prev = channel;
  channel = null;
  const drop = (old: RealtimeChannel | null) => { if (old) void supabase.removeChannel(old); };
  if (!f.userId) { drop(prev); return; }
  // Every event goes to the consumers registered NOW (a consumer added after
  // this build, with the same filters, must not be deaf).
  const fan = (pick: (c: FeedLiveConsumer) => (row: any) => void) => (payload: { new: any }) => {
    for (const c of [...consumers]) pick(c)(payload.new);
  };
  generation += 1;
  let ch = supabase.channel(`feed-live:${f.userId}:${generation}`);
  if (f.authors.length) {
    ch = ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "posts", filter: `user_id=in.(${f.authors.join(",")})` }, fan((c) => c.onInsert));
  }
  if (f.posts.length) {
    ch = ch
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "posts", filter: `id=in.(${f.posts.join(",")})` }, fan((c) => c.onUpdate))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "post_reactions", filter: `post_id=in.(${f.posts.join(",")})` }, fan((c) => c.onReaction));
  }
  let dropped = false;
  const dropPrev = () => { if (!dropped) { dropped = true; drop(prev); } };
  const mine = ch;
  channel = ch.subscribe((status) => {
    if (channel !== mine) return; // a replaced channel's CLOSED is not a disconnect
    recordRealtime(status);
    if (status === "SUBSCRIBED") dropPrev();
  });
  setTimeout(dropPrev, PREV_GRACE_MS);
}

/** Ask for the channel to match the consumers again (debounced). */
export function refreshFeedLive(immediate = false) {
  if (timer) clearTimeout(timer);
  if (immediate) build();
  else timer = setTimeout(build, REBUILD_MS);
}

export function addFeedLiveConsumer(c: FeedLiveConsumer): () => void {
  // A different member signed in: the previous member's consumers are stale.
  for (const other of consumers) if (other.userId !== c.userId) consumers.delete(other);
  consumers.add(c);
  refreshFeedLive(!channel);
  return () => {
    consumers.delete(c);
    refreshFeedLive(consumers.size === 0);
  };
}

/** Test seam. */
export function __resetFeedLive() {
  // (a pending PREV_GRACE_MS removal only removes an already-replaced channel)
  if (timer) clearTimeout(timer);
  timer = null;
  consumers.clear();
  if (channel) void supabase.removeChannel(channel);
  channel = null;
  signature = "";
}
