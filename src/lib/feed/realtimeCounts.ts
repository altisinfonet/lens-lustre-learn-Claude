/**
 * ONE WRITER PER COUNTER. That sentence is the whole design of this file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS FIXES
 *
 * `handleUpdatePost` used to apply a realtime `posts` row with a plain spread:
 *
 *     patchPost(raw.id, (current) => ({ ...current, ...raw }))
 *
 * The `posts` table columns are `likes_count`, `comments_count`,
 * `shares_count`. The feed's own type (`src/types/post.ts`) uses `like_count`,
 * `comment_count`, `share_count` — **singular**. So the server's authoritative
 * numbers landed as three unused keys and the counters on screen were never
 * updated by a post update at all.
 *
 * They were maintained entirely by client-side ±1 deltas from the
 * `post_reactions` / `post_comments` / `post_shares` subscriptions. A delta is
 * fine until one is missed or delivered twice — and then the number is wrong
 * for as long as the member keeps the feed open, because the correct value was
 * arriving on every single update and being thrown away. Nothing ever
 * self-corrected.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ THE TRAP. READ THIS BEFORE CHANGING EITHER CALLER.
 *
 * Every reaction fires **two** realtime events, because `trg_update_post_likes_count`
 * on `post_reactions` writes `posts.likes_count` (verified on production
 * 2026-08-13, along with the equivalent comment and share triggers):
 *
 *     post_reactions INSERT   → a +1 DELTA
 *     posts          UPDATE   → the ABSOLUTE new count
 *
 * Apply both and the count is wrong by one whenever the absolute lands first.
 * Mapping the absolute counts is therefore only safe once the delta handlers
 * have stopped touching those fields. That is not tidying, it is the thing that
 * makes this correct — and it is why `assertNoLikeCountDelta` exists below and
 * why the test suite asserts it against both callers' source.
 *
 * So, after this change:
 *
 *   like_count / comment_count / share_count  ← `posts` UPDATE only (absolute)
 *   reaction_counts / top_reactions           ← `post_reactions` only (delta)
 *
 * The per-type breakdown stays on the delta path because `posts` does not carry
 * it — there is no absolute source to prefer.
 *
 * ⚠ BOTH CALLERS MUST CHANGE TOGETHER. `Feed.tsx` and `WallPosts.tsx` both
 * subscribe through `useFeedRealtime`. Fixing one and not the other leaves the
 * other double-counting, which is exactly the failure a member notices.
 */

/** The three count columns as they exist on `public.posts`. */
export interface ServerCountRow {
  likes_count?: number | null;
  comments_count?: number | null;
  shares_count?: number | null;
}

/** The three count fields as the feed/wall post types spell them. */
export interface ClientCounts {
  like_count?: number;
  comment_count?: number;
  share_count?: number;
}

/**
 * Translate a realtime `posts` row's counters into the names the UI reads.
 *
 * Absent or null columns are OMITTED rather than coerced to 0 — a partial
 * payload must never blank a counter that is currently correct on screen.
 * Negative values are clamped: a count below zero is always a bug somewhere
 * upstream, and showing "-1 likes" turns someone else's bug into ours.
 */
export function mapServerCounts(raw: ServerCountRow | null | undefined): ClientCounts {
  const out: ClientCounts = {};
  if (!raw) return out;
  if (typeof raw.likes_count === "number") out.like_count = Math.max(0, raw.likes_count);
  if (typeof raw.comments_count === "number") out.comment_count = Math.max(0, raw.comments_count);
  if (typeof raw.shares_count === "number") out.share_count = Math.max(0, raw.shares_count);
  return out;
}

/**
 * Recompute the top-3 reaction types from a per-type map.
 *
 * Shared so the feed and the wall cannot disagree about what "top reactions"
 * means — they had two copies of this and they were identical, which is the
 * state right before they stop being identical.
 */
export function topReactionsFrom(counts: Record<string, number>): string[] {
  return Object.entries(counts)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type]) => type);
}

/**
 * Apply one reaction event to the per-type map. Never touches `like_count` —
 * see the trap note at the top of this file.
 */
export function applyReactionDelta(
  counts: Record<string, number> | undefined,
  reactionType: string | undefined,
  event: "INSERT" | "DELETE",
): { reaction_counts: Record<string, number>; top_reactions: string[] } {
  const next = { ...(counts ?? {}) };
  if (reactionType) {
    const delta = event === "INSERT" ? 1 : -1;
    next[reactionType] = Math.max(0, (next[reactionType] || 0) + delta);
  }
  return { reaction_counts: next, top_reactions: topReactionsFrom(next) };
}
