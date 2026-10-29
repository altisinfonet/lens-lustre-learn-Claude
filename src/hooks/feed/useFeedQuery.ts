import { useInfiniteQuery, useQueryClient, onlineManager, type InfiniteData } from "@tanstack/react-query";
import { useMemo, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchPostAttachments, attachmentsFor } from "@/lib/posts/postAttachments";
import { persistFeedPage, getCachedFeed } from "@/lib/feedCache";
import { feedArchiveEpoch, readFeedPage, recordFeedPage } from "@/lib/offline/feedArchive";
import { isNetworkError } from "@/lib/offline/retryPolicy";
import { feedSessionFor, startFeedSessionOver } from "@/lib/feedSessions";
import { fetchProfileMap } from "@/lib/profileMapCache";
import { getAdminIds, resolveName, resolveBadges } from "@/lib/adminBrand";
import { queryKeys } from "@/lib/queryKeys";
import type { ReactionType } from "@/components/ReactionPicker";

import { logger, timedRpc } from "@/lib/logger";
import { fetchFeatureAllowed } from "@/hooks/core/useFeatureAllowed";

const FILE = "src/hooks/feed/useFeedQuery.ts";

const PAGE_SIZE = 10;

import type { UnifiedPost, TaggedPerson } from "@/types/post";

/** S12-F3: which part of the personal mix a post came from. */
export type FeedSource = "circle" | "suggested" | "fair";

export type FeedPost = UnifiedPost & {
  is_suggested: boolean;
  /** S12-F3 (personal feed only): the mix source. */
  feed_source?: FeedSource;
  /** S12-F3 (personal feed only): "You're all caught up" goes after this post. */
  caught_up_after?: boolean;
};

/* ── Helpers ── */

/**
 * Friends + followed users + self. Used ONLY to label posts as
 * `is_suggested` (author outside the user's network) — it no longer
 * restricts what appears in the feed.
 */
async function fetchRelevantUsers(userId: string): Promise<string[]> {
  const [followsRes, friendsRes] = await Promise.all([
    supabase.from("follows").select("following_id").eq("follower_id", userId),
    supabase
      .from("friendships")
      .select("requester_id, addressee_id")
      .eq("status", "accepted")
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
  ]);
  const followedIds = new Set((followsRes.data || []).map((f) => f.following_id));
  const friendIds = new Set<string>();
  (friendsRes.data || []).forEach((f) => {
    if (f.requester_id === userId) friendIds.add(f.addressee_id);
    else friendIds.add(f.requester_id);
  });
  return Array.from(new Set([...followedIds, ...friendIds, userId]));
}

/**
 * BROADCAST + NEVER-REPEAT FEED (owner-approved spec, 2026-07-30).
 *
 * One RPC call per page. The database returns, in order:
 *   Tier 0 "newest"   — the newest posts, pinned to the top of page 1 only.
 *   Tier 1 "unseen"   — every visible post the user has never viewed,
 *                       fewest total viewers first.
 *   Tier 2 "recycled" — when unseen runs out: already-seen posts,
 *                       least-recently-seen first. The feed never runs dry.
 *
 * `excludeIds` = posts already delivered in THIS scroll session, so a
 * post is never repeated while the user keeps scrolling.
 */

/**
 * How many of the newest posts are pinned to the very top of the FIRST page.
 *
 * Owner order, 2026-08-05: "last post will be seen 1st on refresh … on app and
 * web 1st loading always current posts 1st" — and, in the same sentence,
 * "every pic must be maximum interaction try method".
 *
 * Three, not ten: pinning the whole page would turn the feed back into a plain
 * newest-first list and throw away the maximum-visibility deal he asked for in
 * the second half of the sentence. Three answers "what's new" on the opening
 * screen and leaves 7 of the first 10 to the fairness shuffle.
 *
 * Only page 0 gets them. Later pages pass 0, because pinning the newest posts
 * again further down would show them twice.
 *
 * ⚠ R-LIVE-5 (Owner, 13 Oct 2026, "YES"): newest first applies ONLY UNTIL THE
 * MEMBER HAS SEEN THEM. The rule lives in the RPC (20261013_0005): it drops a
 * pinned post the member has already seen. Until Stage L2 nothing was ever
 * recorded as seen, so these three sat on top of every refresh (F-REV4-8).
 */
const NEWEST_PINNED_ON_FIRST_PAGE = 3;

/**
 * Stage L2 · set once per app session when the database does not have the
 * 5-argument get_broadcast_feed yet (20261013_0005 not applied on this lane):
 * every later page goes straight to the 4-argument call instead of failing
 * first. Expand/contract — remove with the contract step.
 */
let sessionSeedRpcMissing = false;
/**
 * S6-a · set once per app session when the lane does not have get_feed_page
 * (20261029_0500 not applied, or rolled back): every later page uses the old
 * `_exclude_ids` calls straight away. Expand/contract, as above.
 */
let feedPageRpcMissing = false;
/**
 * S6-a · sessions (tab|seed) that had a page served by the OLD call. The
 * server's log does not hold that page, so the cursor would be ahead of it
 * (the server refuses that, 22023): the rest of such a session pages the old
 * way, with the full list the device keeps. A refresh is a new seed.
 */
const oldPathSessions = new Set<string>();
/** Test seam. `cursor: false` makes this app session page the old way (tests that pin the `_exclude_ids` calls). */
export function __resetSessionSeedRpcProbe(opts: { cursor?: boolean } = {}) {
  sessionSeedRpcMissing = false;
  feedPageRpcMissing = opts.cursor === false;
  oldPathSessions.clear();
}

/** PostgREST / Postgres: "this function (signature) does not exist". */
function isMissingFunction(error: { code?: string } | null | undefined): boolean {
  return !!error && (error.code === "PGRST202" || error.code === "42883");
}

/** A fresh per-refresh seed: a CSPRNG UUID (never derived from the date or the member). */
export function newFeedSessionSeed(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c?.getRandomValues?.(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

interface BroadcastPage {
  rows: any[];
  /** Served by the DB-3004 chronological fallback, not the feed RPC: show it as stale. */
  degraded: boolean;
  /** S12-F3: served by get_personal_feed (server order and variety are final). */
  personal?: boolean;
}

/**
 * S12-F3 · the personal feed (20261018_0003), for a member whose
 * `personal_feed` switch is on. Same arguments as the session overload of
 * get_broadcast_feed — the viewer is the JWT's, never an argument. Any error
 * (a lane without the function, a timeout) returns null and the caller serves
 * that page from get_broadcast_feed exactly as for everyone else.
 */
async function fetchPersonalPage(
  excludeIds: string[],
  newestFirst: number,
  categories: string[] | null,
  sessionSeed: string | null,
): Promise<any[] | null> {
  try {
    const { data, error } = await timedRpc("rpc.get_personal_feed", FILE, () => supabase.rpc("get_personal_feed" as any, {
      _exclude_ids: excludeIds,
      _limit: PAGE_SIZE,
      _newest_first: newestFirst,
      _categories: categories,
      _session_seed: sessionSeed,
    } as any));
    if (error || !Array.isArray(data)) {
      logger.warn({
        code: "DB-3008",
        event: "FEED_PERSONAL_RPC_FELL_BACK",
        fn: "fetchPersonalPage",
        file: FILE,
        message: "get_personal_feed failed; this page was served by get_broadcast_feed.",
        reason: error ? (error.message ?? error.code ?? String(error)) : "The RPC returned no array",
      });
      return null;
    }
    return data as any[];
  } catch {
    return null;
  }
}

/**
 * S12-F5 · the feed tabs. "For you" is the feed above (personal when the switch
 * is on, else today's); Following and Favourites are time-ordered server lists
 * (20261018_0004) with the same arguments and row shape as get_personal_feed.
 */
export type FeedTab = "for_you" | "following" | "favourites";
type TimelineTab = Exclude<FeedTab, "for_you">;
const TIMELINE_RPC: Record<TimelineTab, string> = { following: "get_following_feed", favourites: "get_favourites_feed" };

/** A time-ordered page. Any error throws: the feed shows "couldn't load" with Retry (never another tab's posts). */
async function fetchTimelinePage(tab: TimelineTab, excludeIds: string[], categories: string[] | null): Promise<any[]> {
  const { data, error } = await supabase.rpc(TIMELINE_RPC[tab] as any, {
    _exclude_ids: excludeIds,
    _limit: PAGE_SIZE,
    _newest_first: 0,
    _categories: categories,
    _session_seed: null,
  } as any);
  if (error || !Array.isArray(data)) {
    logger.warn({
      code: "DB-3010",
      event: "FEED_TAB_RPC_FAILED",
      fn: "fetchTimelinePage",
      file: FILE,
      message: `${TIMELINE_RPC[tab]} failed; the ${tab} tab shows its error state.`,
      reason: error ? (error.message ?? error.code ?? String(error)) : "The RPC returned no array",
    });
    throw new Error(`${TIMELINE_RPC[tab]} failed`);
  }
  return data as any[];
}

/**
 * S6-a · ONE PAGE BY CURSOR (get_feed_page, 20261029_0500).
 *
 * The client used to upload every id it had been dealt this session as
 * `_exclude_ids` — page 100 sent 990 UUIDs. Now it sends `_after`: how many
 * rows of this session it holds (the delivery position of its last row). The
 * server keeps the session's delivery log and evaluates the SAME feed function
 * with exactly the list the client used to send, so the order, the session
 * seed, the seen penalty and the variety rules are today's (PROBE G2–G5 prove
 * it row for row). A refetch of page N sends page N's `_after` again and is
 * re-dealt exactly as before.
 *
 * Returns null when the lane has no get_feed_page (then — and for the rest of
 * this app session — the old calls are used) or on any other failure (the
 * caller then tries the next way to serve the page, as it always did).
 */
async function fetchPageByCursor(
  tab: FeedTab,
  personal: boolean,
  sessionSeed: string,
  after: number,
  newestFirst: number,
  categories: string[] | null,
): Promise<any[] | null> {
  if (feedPageRpcMissing) return null;
  try {
    const res = await timedRpc("rpc.get_feed_page", FILE, () => supabase.rpc("get_feed_page" as any, {
      _tab: tab,
      _personal: personal,
      _session_seed: sessionSeed,
      _after: after,
      _limit: PAGE_SIZE,
      _newest_first: newestFirst,
      _categories: categories,
    } as any));
    const error = res?.error as { code?: string; message?: string } | null | undefined;
    if (isMissingFunction(error)) {
      feedPageRpcMissing = true;
      logger.warn({
        code: "DB-3011",
        event: "FEED_PAGE_CURSOR_RPC_MISSING",
        fn: "fetchPageByCursor",
        file: FILE,
        message: "get_feed_page is not deployed; the feed pages with the old _exclude_ids calls.",
        reason: error?.message ?? error?.code ?? "missing function",
      });
      return null;
    }
    if (error || !Array.isArray(res?.data)) {
      logger.warn({
        code: "DB-3011",
        event: "FEED_PAGE_CURSOR_RPC_FAILED",
        fn: "fetchPageByCursor",
        file: FILE,
        message: "get_feed_page failed; this page was served the next way (the broadcast cursor call, else the old _exclude_ids call).",
        reason: error ? (error.message ?? error.code ?? String(error)) : "The RPC returned no array",
      });
      return null;
    }
    return res.data as any[];
  } catch (e) {
    logger.warn({
      code: "DB-3011",
      event: "FEED_PAGE_CURSOR_RPC_FAILED",
      fn: "fetchPageByCursor",
      file: FILE,
      message: "get_feed_page threw; this page was served the next way.",
      reason: String((e as Error)?.message ?? e).slice(0, 200),
    });
    return null;
  }
}

async function fetchBroadcastPage(
  excludeIds: string[],
  newestFirst: number,
  categories: string[] | null,
  sessionSeed: string | null,
  personal = false,
): Promise<BroadcastPage> {
  if (personal) {
    const rows = await fetchPersonalPage(excludeIds, newestFirst, categories, sessionSeed);
    if (rows) return { rows, degraded: false, personal: true };
  }
  /**
   * `_categories: null` is "All" — the RPC then applies no category predicate
   * at all, which is exactly what keeps posts created before this feature
   * visible. A category filter uses `&&`, which an empty array never matches.
   *
   * Stage L2: the 5-argument overload is called by name with this refresh's
   * `_session_seed`, kept for every page of the session (stable pages;
   * `_exclude_ids` keeps them duplicate-free). If the database does not have it
   * yet, the 4-argument call — the hourly order — is used instead, so this
   * bundle and the migration can ship in either order. The 2- and 3-argument
   * overloads still exist for installed Android builds.
   */
  const args = {
    _exclude_ids: excludeIds,
    _limit: PAGE_SIZE,
    _newest_first: newestFirst,
    _categories: categories,
  };
  let res: { data: unknown; error: { code?: string; message?: string } | null } | null = null;
  if (sessionSeed && !sessionSeedRpcMissing) {
    res = await timedRpc("rpc.get_broadcast_feed", FILE, () => supabase.rpc("get_broadcast_feed" as any, { ...args, _session_seed: sessionSeed } as any));
    if (isMissingFunction(res.error)) {
      sessionSeedRpcMissing = true;
      logger.warn({
        code: "DB-3007",
        event: "FEED_SESSION_SEED_RPC_MISSING",
        fn: "fetchBroadcastPage",
        file: FILE,
        message: "The 5-argument get_broadcast_feed is not deployed; the feed used the 4-argument call (hourly order).",
        reason: res.error?.message ?? res.error?.code ?? "missing function",
      });
      res = null;
    }
  }
  if (!res) res = await timedRpc("rpc.get_broadcast_feed", FILE, () => supabase.rpc("get_broadcast_feed" as any, args));
  const { data, error } = res;
  if (error || !data) {
    logger.error({
      code: "DB-3004",
      event: "FEED_RPC_FELL_BACK_TO_CHRONOLOGICAL",
      fn: "fetchBroadcastPage",
      file: FILE,
      message: "The broadcast feed RPC failed; the feed fell back to plain newest-first.",
      reason: error ? (error.message ?? String(error)) : "The RPC returned no data",
      expected: "Fair ordering: unseen first, fewest viewers first, then newest",
      actual: "Plain chronological order",
      nextStep:
        "MEMBERS STILL SEE POSTS, so nobody reports this — but the fairness ordering that equalises reach is gone until it is fixed. Confirm get_broadcast_feed is still deployed.",
      detail: { excludedCount: excludeIds.length, pageSize: PAGE_SIZE },
    });
    // Explicit fallback (used only if the DB function is not deployed yet):
    // plain newest-first public posts. RLS still enforces privacy.
    let query = supabase
      .from("posts")
      .select("id, user_id, content, image_url, image_urls, thumbnail_urls, privacy, created_at, likes_count, comments_count, shares_count")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (excludeIds.length > 0) {
      query = query.not("id", "in", `(${excludeIds.join(",")})`);
    }
    // The fallback must respect the filter as well. Without this, an RPC
    // failure while a category is selected would quietly serve posts from
    // every category under that category's heading — the fallback is already
    // invisible to members, so a wrong-content version of it would be too.
    if (categories && categories.length > 0) {
      query = query.overlaps("categories", categories);
    }
    const { data: fallback, error: fallbackError } = await query;

    /**
     * ⚠ IF THE FALLBACK FAILS TOO, THROW. DO NOT RETURN [].
     *
     * Owner, 2026-08-12: *"when a bit slow network Facebook opening, reel
     * playing from youtube but 50mm retina posts not showing"*. This line was
     * the cause and it was mine.
     *
     * On a weak signal BOTH the RPC and this fallback time out. The old
     * `return fallback || []` turned that double failure into a perfectly
     * ordinary empty page — so the query resolved SUCCESSFULLY with zero posts
     * and the feed rendered "No posts yet. Be the first to share something."
     * The app told the member the platform was empty when the truth was that
     * one request had dropped. Nothing retried, because nothing had failed as
     * far as React Query could tell.
     *
     * Throwing is what makes the difference visible: React Query retries with
     * backoff, the cached first page stays on screen meanwhile, and if it still
     * cannot load, Feed.tsx shows "couldn't load — Try again" instead of a lie
     * about the content.
     *
     * An empty array is still returned when the query SUCCEEDS and there is
     * genuinely nothing there. "No posts" and "no answer" are different facts
     * and this is the line that stopped confusing them.
     */
    if (fallbackError) throw fallbackError;
    return { rows: fallback || [], degraded: true };
  }
  return { rows: data as any[], degraded: false };
}

/**
 * Stage L2 · the newest created_at this member can see, excluding their own
 * posts, read when a session starts — BEFORE the page is dealt, so nothing
 * created in between can be missed. useNewPostsCount counts what appears after
 * it (ids already in the feed are subtracted). RLS decides "can see"; private
 * posts are left out because an admin can READ everyone's and the feed never
 * deals them — the pill must not promise what a refresh will not bring. null
 * when the read fails: the session simply shows no "new posts" pill.
 */
async function fetchWatermark(userId: string, categories: string[] | null): Promise<string | null> {
  try {
    let q = supabase.from("posts").select("created_at").neq("user_id", userId).neq("privacy", "private").order("created_at", { ascending: false }).limit(1);
    if (categories && categories.length > 0) q = q.overlaps("categories", categories);
    const { data, error } = await q;
    if (error) return null;
    return (data as { created_at: string }[] | null)?.[0]?.created_at ?? new Date(0).toISOString();
  } catch {
    return null;
  }
}

/** Reduced enrichment — uses precomputed counts, fewer queries */
async function enrichPosts(
  postsData: any[],
  networkIds: string[],
  currentUserId: string,
): Promise<FeedPost[]> {
  if (postsData.length === 0) return [];

  const authorIds = [...new Set(postsData.map((p) => p.user_id))];
  const postIds = postsData.map((p) => p.id);

  /**
   * ⚠ DOES THIS PAYLOAD CARRY THE AUTHOR'S IDENTITY?
   *
   * Owner, 2026-08-13: *"Why we cant show the names like FB and Insta ??"*
   *
   * Migration 20260813171159 made `get_broadcast_feed` return `author_name`,
   * `author_avatar`, `thumbnail_urls` and `categories`, so identity now arrives
   * WELDED to the post. Instagram and Facebook have always worked this way, and
   * it is the reason a post can never appear there without a name: there is no
   * second request to fail.
   *
   * Detected from the SHAPE of the row, not from a version constant. `"key" in
   * obj` is true when the column came back NULL, and false only when the
   * column does not exist — which is exactly the distinction needed. That makes
   * this file correct against the old RPC and the new one simultaneously, so
   * the migration and the bundle can ship in either order with no flag day.
   *
   * The fallback below is not decoration: `fetchBroadcastPage` has a
   * chronological fallback query that does NOT select these columns, so a page
   * served by it still resolves names the old way.
   */
  const first = postsData[0] ?? {};
  const rpcHasIdentity = "author_name" in first;
  const rpcHasThumbs = "thumbnail_urls" in first;

  // 3 queries instead of 4: merge reaction queries into ONE, filter user reactions client-side
  // Plus one small query for friendship state, so the "Add friend" button is
  // never offered for someone a friendship row already exists with.
  const [profileMapRes, allReactionsRes, adminIds, friendshipsRes, viewCountsRes, thumbsRes, tagsRes, attachments] =
    await Promise.all([
      fetchProfileMap(authorIds),
      supabase.from("post_reactions").select("post_id, reaction_type, user_id").in("post_id", postIds),
      getAdminIds(),
      supabase
        .from("friendships")
        .select("requester_id, addressee_id, status")
        .or(`requester_id.eq.${currentUserId},addressee_id.eq.${currentUserId}`),
      // REAL view counts (distinct viewers from feed_events, author excluded).
      // Replaces the simulated 2K-100K figures removed on 2026-07-31.
      timedRpc("rpc.get_post_view_counts", FILE, () => supabase.rpc("get_post_view_counts" as never, { _post_ids: postIds } as never)),
      // STORED thumbnails (posts.thumbnail_urls). The broadcast-feed RPC does
      // not return this column and is flagged do-not-touch, so it is
      // batch-fetched here — one query per page, rides the same Promise.all.
      // RLS applies as normal; a post the RPC returned is a post this member
      // can read. If this query fails the feed simply shows originals.
      /**
       * ⚠ SKIPPED ENTIRELY once the RPC returns `thumbnail_urls` itself.
       *
       * As of migration 20260813171159 the feed RPC returns the column, so
       * asking `posts` for the same ten rows we were just handed is a wasted
       * round trip. `rpcHasThumbs` is decided from the payload rather than from
       * a version flag, so this works against BOTH definitions with no
       * coordination: an installed APK on the old bundle keeps making this
       * query, a new one never does, and neither knows about the other.
       */
      rpcHasThumbs
        ? Promise.resolve({ data: [] as { id: string; thumbnail_urls: (string | null)[] | null }[] })
        : supabase.from("posts").select("id, thumbnail_urls").in("id", postIds),
      // Owner ruling, 2026-08-10 (his second, final answer): "Show immediately
      // to public, but tagged person only can remove my Tag anytime." So a
      // pending tag is public the moment it is made, and the tagged member has
      // a Remove control on the post itself — see PostCard's menu.
      // `declined` and `removed` are refusals and are NEVER selected, by anyone.
      // One query per page, rides the same Promise.all.
      supabase
        .from("post_tags")
        .select("post_id, tagged_user_id, status")
        .in("post_id", postIds)
        .in("status", ["pending", "approved"]),
      /**
       * ITEM E — THE SANCTIONED MEDIA READ PATH.
       *
       * ONE call for the whole page, riding the same Promise.all as everything
       * else, so the switch costs no extra round trip and cannot become an N+1.
       * A feed page is 10 posts; the RPC's cap is 50.
       *
       * `post_media_for` is SECURITY DEFINER and filters by `can_view_post`, so
       * a post whose media this viewer may not see simply returns no rows and
       * the card renders without it. The client holds no privilege on
       * `post_media` or `media_objects` and must never be given any.
       *
       * Posts outside the migrated population get nothing back and fall through
       * to `posts.image_urls` below — 57 posts / 84 photographs, measured.
       *
       * VID-1 §4.4 — and which of these posts are VIDEO posts, in the same
       * call (postAttachments.ts: the one place every surface reads both).
       */
      fetchPostAttachments(postIds),
    ]);

  /**
   * post_id -> approved tags, name-resolved.
   *
   * The tagged people are usually NOT the post authors, so their names are not
   * in `profileMap` (which was built from authorIds). One extra profile fetch
   * is made, and ONLY when at least one approved tag exists on the page — a
   * feed with no tags costs nothing extra. fetchProfileMap is the same
   * entity-cached path the rest of the app uses, so names already on screen
   * elsewhere are served from cache rather than refetched.
   */
  const tagRows =
    ((tagsRes as { data?: { post_id: string; tagged_user_id: string; status: string }[] })?.data) || [];
  const taggedMap = new Map<string, TaggedPerson[]>();
  if (tagRows.length > 0) {
    const taggedIds = [...new Set(tagRows.map((r) => r.tagged_user_id))];
    const tagProfiles = await fetchProfileMap(taggedIds);
    for (const r of tagRows) {
      const list = taggedMap.get(r.post_id) || [];
      list.push({
        id: r.tagged_user_id,
        // Same rule as the author line: an admin is the brand, never a real name.
        name: resolveName(
          r.tagged_user_id,
          tagProfiles.get(r.tagged_user_id)?.full_name ?? null,
          adminIds,
        ),
        // Same reasoning as `badges` below and as the author line: the handle
        // is already in `tagProfiles`, so carrying it costs nothing and stops
        // "name visible, no name-URL" being a reachable state.
        handle: tagProfiles.get(r.tagged_user_id)?.custom_url ?? null,
        pending: r.status === "pending",
        // Already in `tagProfiles` — it used to be dropped here and re-fetched
        // per name at render time, which is how a verified tagged member ended
        // up with no tick. Carried now, same as the author line.
        badges: resolveBadges(
          r.tagged_user_id,
          tagProfiles.get(r.tagged_user_id)?.badges || [],
          adminIds,
        ),
      });
      taggedMap.set(r.post_id, list);
    }
  }

  const thumbsMap = new Map<string, (string | null)[] | null>();
  ((thumbsRes as { data?: { id: string; thumbnail_urls: (string | null)[] | null }[] })?.data || [])
    .forEach((r) => thumbsMap.set(r.id, r.thumbnail_urls ?? null));

    const viewCountMap = new Map<string, number>();
    ((viewCountsRes as { data?: { post_id: string; views: number }[] })?.data || [])
      .forEach((r) => viewCountMap.set(r.post_id, r.views ?? 0));

  // authorId -> friendship state with the current viewer
  const friendStateMap = new Map<string, "sent" | "received" | "friends">();
  (friendshipsRes.data || []).forEach((f: any) => {
    const other = f.requester_id === currentUserId ? f.addressee_id : f.requester_id;
    if (f.status === "accepted") friendStateMap.set(other, "friends");
    else if (f.requester_id === currentUserId) friendStateMap.set(other, "sent");
    else friendStateMap.set(other, "received");
  });

  const profileMap = profileMapRes;

  const reactionTypeCounts: Record<string, Record<string, number>> = {};
  const userReactionMap = new Map<string, string>();
  (allReactionsRes.data || []).forEach((r: any) => {
    if (!reactionTypeCounts[r.post_id]) reactionTypeCounts[r.post_id] = {};
    reactionTypeCounts[r.post_id][r.reaction_type] =
      (reactionTypeCounts[r.post_id][r.reaction_type] || 0) + 1;
    // Extract current user's reaction from the same result set
    if (r.user_id === currentUserId) {
      userReactionMap.set(r.post_id, r.reaction_type);
    }
  });

  // MEDIA GRAPH FIRST, legacy column as the fallback. Per post, never per
  // slide: a post is migrated whole or not at all (MIG-2004), so a carousel
  // is never half one representation and half the other. A post linked to a
  // video that is not visible and `ready` is dropped (null): it must never
  // fall through as a text post.
  const attachedById = new Map(postsData.map((p) => [p.id, attachmentsFor(
    attachments, p.id, p.image_urls?.length > 0 ? p.image_urls : p.image_url ? [p.image_url] : [],
  )]));
  return postsData.filter((p) => attachedById.get(p.id) !== null).map((p) => {
    const userRx = userReactionMap.get(p.id) as ReactionType | undefined;
    const typeCounts = reactionTypeCounts[p.id] || {};
    const topReactions = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type]) => type);
    const { image_urls: imageUrls, video } = attachedById.get(p.id)!;
    return {
      ...p,
      // S12-F3: only rows from get_personal_feed carry these; get_broadcast_feed
      // rows are left exactly as they were.
      ...(typeof p.caught_up_after === "boolean"
        ? { feed_source: p.source as FeedSource, caught_up_after: p.caught_up_after as boolean }
        : {}),
      image_urls: imageUrls,
      video,
      thumbnail_urls: p.thumbnail_urls ?? thumbsMap.get(p.id) ?? null,
      /**
       * THE NAME COMES FROM THE POST'S OWN ROW FIRST.
       *
       * `p.author_name` was fetched in the same statement as the post, so it
       * cannot be missing while the post exists. The `profileMap` lookup is
       * kept only as the fallback for the chronological-fallback path and for
       * any installed build still on the 11-column RPC.
       *
       * `resolveName` still wraps it, and must: the rule that the official
       * account renders as the brand rather than a person's name lives in
       * adminBrand.ts and is deliberately NOT in SQL — the database would have
       * to know who the admins are, which is a second lookup and a second place
       * for that policy to drift.
       */
      author_name: resolveName(
        p.user_id,
        (rpcHasIdentity ? p.author_name : null) ??
          profileMap.get(p.user_id)?.full_name ??
          null,
        adminIds,
      ),
      author_avatar:
        (rpcHasIdentity ? p.author_avatar : null) ??
        profileMap.get(p.user_id)?.avatar_url ??
        null,
      author_handle: profileMap.get(p.user_id)?.custom_url ?? null,
      author_last_active: profileMap.get(p.user_id)?.last_active_at ?? null,
      author_badges: resolveBadges(
        p.user_id,
        profileMap.get(p.user_id)?.badges || [],
        adminIds,
      ),
      like_count: p.likes_count || 0,
      comment_count: p.comments_count || 0,
      share_count: p.shares_count || 0,
      is_liked: !!userRx,
      user_reaction: userRx || null,
      top_reactions: topReactions,
      reaction_counts: typeCounts,
      is_suggested: !networkIds.includes(p.user_id),
      // POLICY: the official/admin account can be FOLLOWED but never friended.
      // useFriendFollow already enforced this on profiles; the feed's Add-friend
      // button bypassed it (owner report 2026-07-31), so it is enforced here too.
      friend_state: adminIds.has(p.user_id)
        ? ("unavailable" as const)
        : (friendStateMap.get(p.user_id) ?? "none"),
      views: viewCountMap.get(p.id) ?? 0,
      tagged_people: taggedMap.get(p.id) ?? [],
    };
  });
}

/**
 * Diversity rule kept from the previous ranking engine: no same author
 * back-to-back. Reorders WITHIN the page only; `prevAuthor` carries the
 * last author of the previous page so the rule also holds across the
 * page boundary. If every remaining post is by the same author the rule
 * is unavoidable and posts are emitted as-is.
 */
function reorderNoBackToBack<T extends { user_id: string }>(
  posts: T[],
  prevAuthor: string | null,
): T[] {
  const result: T[] = [];
  const pool = [...posts];
  let last = prevAuthor;
  while (pool.length > 0) {
    let idx = pool.findIndex((p) => p.user_id !== last);
    if (idx === -1) idx = 0; // all remaining posts share one author — unavoidable
    const [p] = pool.splice(idx, 1);
    result.push(p);
    last = p.user_id;
  }
  return result;
}

/* ── The hook ── */

/** Stage L2: see `refetchOnWindowFocus` in useFeedQuery. */
export const refetchOnlyAfterFailure = (query: { state: { status: string } }): boolean => query.state.status === "error";

/**
 * L1 · B1: see `refetchOnMount` in useFeedQuery. True only when the router
 * arrived by a traversal (POP — Back/Forward) AND every page in the cache
 * belongs to the deal this running app committed (`liveSeed`). Pages restored
 * from the device (OFF-1) or left by a previous member carry another seed, and
 * a cold start is also a POP — so neither is ever mistaken for a return.
 */
export function isReturnToTheDealOnScreen(
  navigationType: string | undefined,
  state: { status: string; data?: unknown },
  liveSeed: string | null,
): boolean {
  if (navigationType !== "POP" || state.status !== "success" || !liveSeed) return false;
  const pages = (state.data as { pages?: Array<{ sessionSeed?: string }> } | undefined)?.pages;
  return !!pages && pages.length > 0 && pages.every((p) => p.sessionSeed === liveSeed);
}

/**
 * S7b-3: feed sessions whose pages came from the phone (see the queryFn). A
 * WeakSet on the session object, so a signed-out member's sessions go with
 * clearFeedSessions().
 */
const offlineSessions = new WeakSet<object>();

/**
 * S7b-3 (review #548): no network and nothing saved for this page. The page
 * function THROWS it instead of waiting inside itself: React Query's retry then
 * PAUSES the page until the device is online (networkMode "offlineFirst"), and
 * a paused page that is cancelled or refreshed leaves nothing running — so the
 * network coming back makes exactly one request, never one per refresh.
 */
export class OfflineNoSavedPageError extends Error {
  constructor() {
    super("No network and no saved posts for this page");
    this.name = "OfflineNoSavedPageError";
  }
}

export interface FeedPage {
  posts: FeedPost[];
  nextCursor: number | null;
  networkIds: string[];
  /** Stage L2: this page came from the DB-3004 chronological fallback — show "Couldn't refresh". */
  degraded?: boolean;
  /** Stage L2: the refresh this page belongs to (same seed for every page of one session). */
  sessionSeed?: string;
  /** Stage L2 (page 0 only): see fetchWatermark. */
  watermark?: string | null;
  /** S7b-3: this page was read from the posts saved on the phone (no network). */
  offline?: boolean;
}

/**
 * @param categories  Selected category slugs, or null/undefined for "All".
 *                    Phase B always passes null — the category strip that will
 *                    supply this is Phase D. It is threaded through now so the
 *                    cache key is correct from the first day rather than
 *                    retro-fitted onto a live cache.
 * @param navigationType  How the router arrived on the feed (react-router's
 *                    `useNavigationType()`, passed by Feed.tsx). "POP" — Back or
 *                    Forward — returns to the deal on screen; anything else, or
 *                    nothing, is a fresh visit and deals a new hand (B1, below).
 */
export function useFeedQuery(userId: string | undefined, categories?: string[] | null, navigationType?: string, tab: FeedTab = "for_you") {
  // Normalised once: sorted, empty treated as null, so the key and the RPC
  // argument can never disagree about what "no filter" means.
  const cats = categories && categories.length ? [...categories].sort() : null;
  // S12-F5: Following / Favourites — their own cache entry and their own session.
  const timeline: TimelineTab | null = tab === "following" || tab === "favourites" ? tab : null;
  const feedKey = queryKeys.feed(cats, timeline);
  // S7b-3: the saved-on-the-phone feed is the main "For you" feed (no category filter).
  const archivedFeed = !timeline && !cats;
  /**
   * L1 · B1 — the session lives in feedSessions.ts, not in this component's
   * refs: Back from a post REMOUNTS the feed (sibling routes), and a session
   * that died with the screen made the first "load more" after Back a new deal
   * with an empty exclude list. Same objects, same `.current` shape as the refs
   * they replace, so every line below reads exactly as it did.
   */
  const session = feedSessionFor(userId, (cats ? cats.join(",") : "") + (timeline ? `|${timeline}` : ""));
  /**
   * Decided ONCE, when this screen mounts: is it a return (Back/Forward) to the
   * deal still in the cache? Anything else is a fresh visit, and a fresh visit
   * starts its session from nothing — exactly what the per-mount refs did
   * before B1. That matters for the member who has scrolled more than five
   * pages: `maxPages` has dropped page 0, so the refetch on mount re-reads the
   * pages still held, and with the old session kept it would re-read them with
   * the OLD seed and exclude lists — a fresh visit that deals nothing new.
   */
  const qc = useQueryClient();
  const [returning] = useState(() => {
    const back = isReturnToTheDealOnScreen(navigationType, qc.getQueryState(feedKey) ?? { status: "pending" }, session.seed.current);
    if (!back) startFeedSessionOver(session);
    return back;
  });
  const networkIdsRef = session.networkIds;
  // Snapshot of delivered post ids BEFORE each page, keyed by page index.
  // Makes React Query page refetches deterministic (a refetch of page N
  // re-uses exactly the exclude list page N was originally fetched with).
  const excludeByPageRef = session.excludeByPage;
  // Last author of the previous page — lets the no-back-to-back rule
  // hold across page boundaries.
  const lastAuthorByPageRef = session.lastAuthorByPage;
  // Stage L2: this refresh's seed. Made when page 0 is fetched (pull-to-refresh,
  // the "new posts" pill, a fresh visit to the feed) and kept for every later page.
  const sessionSeedRef = session.seed;
  // Stage L2: this session's watermark (fetchWatermark), handed to EVERY page —
  // `maxPages` drops page 0 once a member has scrolled six pages down, and the
  // "new posts" pill must not stop working for exactly the member who has been
  // reading longest.
  const sessionWatermarkRef = session.watermark;
  // S12-F3: this session is served by get_personal_feed (switch on at page 0).
  const personalRef = session.personal;

  // Build placeholderData from localStorage cache for instant render
  const placeholderData = useMemo(() => {
    // The device copy is the For you feed only.
    if (!userId || timeline) return undefined;
    const cached = getCachedFeed(userId);
    if (!cached) return undefined;
    return {
      pages: [{
        posts: cached.posts as FeedPost[],
        nextCursor: 1 as number | null,
        networkIds: cached.networkIds,
      }],
      pageParams: [0],
    };
  }, [userId, timeline]);

  return useInfiniteQuery<FeedPage, Error>({
    queryKey: feedKey,
    enabled: !!userId,
    placeholderData,

    /**
     * THE FEED IS NEVER FRESH. Owner spec, restated 2026-08-05:
     * "on every refresh changing is must to ensure maximum visibility of all
     *  posts, not newer one."
     *
     * MEASURED ON PRODUCTION, 2026-08-05, and the split matters:
     *
     *   * The DATABASE half works. `get_broadcast_feed` is VOLATILE and
     *     re-deals on every call — three consecutive calls as the same member
     *     returned 10 posts each and shared only 1, then 0. The 2026-08-04
     *     reshuffle migration is intact.
     *   * The CLIENT half was throwing that away. `App.tsx` sets a global
     *     `staleTime: 5 * 60 * 1000`, and this query never overrode it. So for
     *     five minutes React Query considered the feed fresh and would not
     *     refetch — leave /feed for a profile, come back, and you are handed
     *     the identical deal from cache. The database had already shuffled;
     *     nobody asked it.
     *
     * `staleTime: 0` + `refetchOnMount: "always"` makes returning to the feed
     * deal a new hand, which is what the owner asked for. Pull-to-refresh
     * already worked (it calls `refetch()` explicitly) — this fixes every OTHER
     * way a member arrives at the feed.
     *
     * Cost, stated plainly: one extra RPC + enrichment per feed mount. That is
     * the price of the requirement; the 5-minute cache was buying staleness,
     * not speed, because `placeholderData` above already gives an instant
     * first paint from localStorage.
     *
     * ⚠ L1 · B1 (PR #434 review) — EXCEPT ON BACK. "always" also re-dealt the
     * feed when the member came BACK to it from a post: /feed and /post/:id are
     * sibling routes, so Back remounts the feed, the remount refetched page 0
     * with a new seed, the new deal replaced every page, and the scroll restore
     * put the member at the right height over posts they had never seen. A Back
     * is not a refresh (R-LIVE-5: newest first on a refresh only). So a mount
     * that arrives by POP over THIS session's deal asks for nothing and shows
     * exactly the pages it left; every other mount — a fresh visit (PUSH /
     * REPLACE: Home, the Feed tab, a link), a cold start, pages restored from
     * the device, a failed query, a different member — still deals new, as
     * above. Pull-to-refresh, the pill and the refresh after posting go through
     * useFeedRefresh and are untouched. Behaviour pinned by feedFreshness.test.ts
     * ("a fresh visit deals a new hand; Back keeps the hand on screen") and the
     * nav-harness scroll journeys (same post at the top after Back).
     */
    staleTime: 0,
    refetchOnMount: (query) =>
      returning && isReturnToTheDealOnScreen(navigationType, query.state, sessionSeedRef.current) ? false : "always",

    /**
     * Stage L2 · NO RE-DEAL BEHIND THE MEMBER'S BACK.
     *
     * App.tsx turns `refetchOnWindowFocus` on for every query, and with
     * `staleTime: 0` that meant the feed refetched every time the tab or the
     * app came back to the front. Until L2 that was invisible: nothing was ever
     * recorded as seen and the order was fixed for the clock hour, so the
     * refetch returned the same list. Now every page-0 fetch is a NEW deal (new
     * session seed, and what was seen has moved to the back) — so answering a
     * message and coming back would replace the list under the member's thumb
     * and lose their place. The plan says the opposite: "the reading position
     * is kept; new posts are applied only when the member pulls to refresh or
     * taps the pill."
     *
     * So focus and reconnect refetch ONLY when the last attempt failed — the
     * signal came back, try again (the same recovery as before). A feed that is
     * on screen stays as it is; the "N new posts" pill (useNewPostsCount, which
     * does check on resume) is how the member learns there is more. A fresh
     * visit to /feed still deals a new hand; Back does not (`refetchOnMount`).
     */
    // S7b-3 keeps this rule for saved pages too: when the network comes back,
    // the saved posts on screen stay; pull-to-refresh or the "N new posts"
    // pill brings the live feed (Instagram does the same).
    refetchOnWindowFocus: refetchOnlyAfterFailure,
    refetchOnReconnect: refetchOnlyAfterFailure,

    /**
     * S7b-3 · run the page function even with no network, so a page can be
     * read from the posts saved on the phone (`feedArchive`). With nothing
     * saved for a page, it makes NO request and waits for the network
     * (`waitForNetwork`), the same as React Query's own offline pause.
     */
    networkMode: "offlineFirst",

    /**
     * THREE ATTEMPTS, BACKING OFF — because the failure being recovered from is
     * a weak mobile signal, not a broken endpoint.
     *
     * `App.tsx` sets a global `retry: 1`, which on a bad connection means one
     * immediate re-attempt over the same dead radio and then giving up. That is
     * barely a retry at all. The delays here (2s, 4s, 8s) are long enough for a
     * phone to actually reacquire a signal, which is the scenario the owner
     * reported.
     *
     * Still bounded. A genuinely dead RPC must fail and be SEEN, not hammered
     * forever behind a spinner.
     */
    // S7b-3: "no network, nothing saved" retries with no delay — React Query
    // pauses it until the device is online — and is never counted out.
    retry: (failureCount, error) => error instanceof OfflineNoSavedPageError || failureCount < 3,
    retryDelay: (attempt, error) => (error instanceof OfflineNoSavedPageError ? 0 : Math.min(1000 * 2 ** attempt, 8000)),

    // `signal` is deliberately NOT read: reading it makes React Query cancel and
    // revert an in-flight page on unmount (Back), which this feed never did.
    queryFn: async ({ pageParam }): Promise<FeedPage> => {
      const pageIndex = (pageParam as number | undefined) ?? 0;
      const isFirstPage = pageIndex === 0;

      // Review #548: asked when the request STARTS, handed back when the page
      // is saved — a member who signed out meanwhile gets nothing saved.
      const archiveEpoch = feedArchiveEpoch();
      /** Saved page `pageIndex` from the phone; marks this session as served from it. */
      const fromPhone = async (): Promise<FeedPage | null> => {
        const saved = await readFeedPage(userId!, pageIndex, PAGE_SIZE);
        if (saved.posts.length === 0) return null;
        offlineSessions.add(session);
        return {
          posts: saved.posts as FeedPost[],
          nextCursor: saved.more ? pageIndex + 1 : null,
          networkIds: networkIdsRef.current ?? [],
          offline: true,
        };
      };

      // S7b-3 · ONE SESSION, ONE SOURCE. Once any page of this session was read
      // from the phone, every later page of it is too — even if the network is
      // back. Its exclude lists / server delivery log never saw those pages, so
      // asking the server for "the next page" would send a wrong cursor (the
      // server would re-deal from 0 and wipe the session's log). The saved
      // posts run out → end of feed; pull-to-refresh starts a live session.
      if (archivedFeed && !isFirstPage && offlineSessions.has(session)) {
        return (await fromPhone()) ?? { posts: [], nextCursor: null, networkIds: networkIdsRef.current ?? [], offline: true };
      }

      // S7b-3 · NO NETWORK: the "For you" feed scrolls through the posts saved
      // on the phone (up to ~200, in the order they were seen). Nothing saved
      // for this page: no request — React Query pauses it until the network is
      // back (OfflineNoSavedPageError, above).
      if (!onlineManager.isOnline()) {
        const saved = archivedFeed ? await fromPhone() : null;
        if (saved) return saved;
        throw new OfflineNoSavedPageError();
      }

      try {
        return await livePage();
      } catch (error) {
        // Review #548: "online" but nothing answers (Wi-Fi without internet, a
        // dead signal): a FIRST page that fails on the network shows the saved
        // posts instead of the error card. Later pages of a live session keep
        // retrying (a saved page there would not continue what is on screen).
        if (archivedFeed && isFirstPage && isNetworkError(error)) {
          const saved = await fromPhone();
          if (saved) return saved;
        }
        throw error;
      }

      async function livePage(): Promise<FeedPage> {
        /**
         * Stage L2 · A NEW SESSION IS PREPARED HERE AND COMMITTED ONLY WHEN ITS
         * FIRST PAGE HAS ARRIVED (commitSession below).
         *
         * Page 0 used to reset the refs first and ask second. A refresh that then
         * failed left the OLD posts on screen with a NEW seed and EMPTY exclude
         * lists behind them, so the next "load more" dealt from a session the
         * member had never seen (and could repeat what was already on screen). A
         * failed refresh must change nothing.
         *
         * The network list is fetched ONLY to label `is_suggested`. The watermark
         * rides the same round trip, and is read BEFORE the page is dealt.
         */
        const fresh = isFirstPage
          ? await Promise.all([fetchRelevantUsers(userId!), fetchWatermark(userId!, cats), timeline ? Promise.resolve(false) : fetchFeatureAllowed("personal_feed")])
              .then(([ids, wm, personal]) => ({ networkIds: ids, watermark: wm, seed: newFeedSessionSeed(), personal }))
          : null;
        const commitSession = () => {
          if (!fresh) return;
          // A live page 0 starts a live session: later pages come from the server.
          offlineSessions.delete(session);
          networkIdsRef.current = fresh.networkIds;
          sessionWatermarkRef.current = fresh.watermark;
          sessionSeedRef.current = fresh.seed;
          excludeByPageRef.current = new Map([[0, []]]);
          lastAuthorByPageRef.current = new Map([[0, null]]);
          personalRef.current = fresh.personal;
        };

        const networkIds = fresh ? fresh.networkIds : networkIdsRef.current;
        const excludeIds = fresh ? [] : excludeByPageRef.current.get(pageIndex) ?? [];
        const sessionSeed = fresh ? fresh.seed : sessionSeedRef.current ?? (sessionSeedRef.current = newFeedSessionSeed());
        const watermark = fresh ? fresh.watermark : sessionWatermarkRef.current;
        // S12-F3: decided once per session (page 0), so every page of one deal
        // comes from the same function.
        const personal = fresh ? fresh.personal : personalRef.current;

        const newestFirst = timeline ? 0 : isFirstPage ? NEWEST_PINNED_ON_FIRST_PAGE : 0;
        // S6-a: by cursor first — `_after` is how many rows this session holds
        // before this page (the old exclude list's length; the list itself stays
        // on the device only for the fallbacks below). Personal → broadcast on
        // failure, exactly as before; both share the server's session log.
        const after = excludeIds.length;
        const cursorKey = `${timeline ?? "for_you"}|${sessionSeed}`;
        const cursorOk = !oldPathSessions.has(cursorKey);
        let served: BroadcastPage | null = null;
        if (!cursorOk) {
          // this session already left the cursor (see oldPathSessions)
        } else if (timeline) {
          const rows = await fetchPageByCursor(timeline, false, sessionSeed, after, 0, cats);
          if (rows) served = { rows, degraded: false, personal: false };
        } else {
          if (personal) {
            const rows = await fetchPageByCursor("for_you", true, sessionSeed, after, newestFirst, cats);
            if (rows) served = { rows, degraded: false, personal: true };
          }
          if (!served) {
            const rows = await fetchPageByCursor("for_you", false, sessionSeed, after, newestFirst, cats);
            if (rows) served = { rows, degraded: false, personal: false };
          }
        }
        if (!served) oldPathSessions.add(cursorKey);
        const { rows: rawPosts, degraded, personal: servedPersonal } = served ?? (timeline
          ? { rows: await fetchTimelinePage(timeline, excludeIds, cats), degraded: false, personal: false }
          : await fetchBroadcastPage(excludeIds, newestFirst, cats, sessionSeed, personal));

        if (rawPosts.length === 0) {
          // Everything visible has been delivered this session — feed end.
          // (Tier 2 recycling already happened server-side, so reaching here
          // means the user scrolled through literally every visible post twice.)
          commitSession();
          return { posts: [], nextCursor: null, networkIds, degraded, sessionSeed, watermark };
        }

        const enriched = await enrichPosts(rawPosts, networkIds, userId!);
        commitSession();

        // Keep server order (tier + fairness), then apply the one client-side
        // rule: no same author back-to-back.
        const prevAuthor = lastAuthorByPageRef.current.get(pageIndex) ?? null;
        // S12-F3: the personal feed already applied max 2 per author and max 3
        // per category in a row (and placed "caught up"); its order is final.
        // S12-F5: Following / Favourites are time order — never reordered.
        const ordered = servedPersonal || timeline ? enriched : reorderNoBackToBack(enriched, prevAuthor);

        // Record state snapshots for the NEXT page.
        excludeByPageRef.current.set(
          pageIndex + 1,
          [...excludeIds, ...ordered.map((p) => p.id)],
        );
        lastAuthorByPageRef.current.set(
          pageIndex + 1,
          ordered.length > 0 ? ordered[ordered.length - 1].user_id : prevAuthor,
        );

        // Persist first page to localStorage for instant load next visit
        if (isFirstPage && ordered.length > 0 && !timeline) {
          persistFeedPage(ordered, networkIds, userId!);
        }
        // S7b-3: every "For you" page served online is saved for no-network use.
        if (archivedFeed && ordered.length > 0) {
          void recordFeedPage(userId!, pageIndex, ordered, { epoch: archiveEpoch });
        }

        return {
          posts: ordered,
          nextCursor: pageIndex + 1,
          networkIds,
          degraded,
          sessionSeed,
          watermark,
        };
      }
    },

    /**
     * ⚠ THE FEED KEEPS FIVE PAGES. IT USED TO KEEP ALL OF THEM, FOREVER.
     *
     * Without `maxPages`, React Query retains every page it has ever fetched
     * for the life of the cache entry, and `flattenFeedPages` concatenates all
     * of them into one array on every render. Ten scroll-loads meant **100 live
     * PostCards** in the DOM — each with two or three `<img>`, a Radix dropdown
     * menu, an IntersectionObserver and framer-motion nodes — and not one of
     * them was ever released. Combined with the decoded bitmaps those images
     * hold, that is the out-of-memory crash on a mid-range Android phone.
     *
     * Five pages is 50 posts: comfortably more than fits on any screen, so
     * nothing a member can see is ever dropped, and scrolling back up re-reads
     * from cache without a request in the overwhelming majority of cases.
     *
     * ⚠ THIS IS NOT VIRTUALIZATION AND MUST NOT BE MISTAKEN FOR IT. It bounds
     * how many pages are RETAINED; it does not stop the 50 that remain from all
     * being mounted at once. Windowing the rendered list is still the real fix
     * and is still outstanding. This is the one-line half that can ship today
     * without touching how the feed renders.
     *
     * ⚠ It also bounds nothing on the SERVER. `excludeByPageRef` still grows
     * without limit and still uploads every delivered id with each request —
     * page 20 sends 200 UUIDs. That is a separate defect with a separate fix
     * (keyset pagination), and dropping pages here does not touch it: the refs
     * are keyed by page index and are deliberately never trimmed, because a
     * dropped page that is re-fetched must be handed exactly the exclude list
     * it was originally fetched with or the feed would repeat posts.
     */
    maxPages: 5,

    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: 0,
  });
}

/**
 * S4-a · THE FEED BENEATH A POST (Instagram: open a post, keep scrolling, the
 * feed carries on under it).
 *
 * The same read path as the feed — get_broadcast_feed, then enrichPosts — so
 * nothing new is readable and privacy is the RPC's, exactly as on /feed. What
 * it deliberately does NOT share is the feed's cache entry or its session
 * object: the feed's B1 promise ("Back returns to the deal you left, at the
 * same post") depends on nothing else re-dealing or re-paging it. So:
 *
 *   · its own query key (one per post), never under `queryKeys.feedAll()`;
 *   · the feed's CURRENT seed is read, never written — the posts beneath are
 *     the deal the member is already on (and the server is not asked for a
 *     new one); with no deal yet (a cold link to the post) a local seed is
 *     made and kept by this query alone;
 *   · the post on screen is excluded from the first page, and every page
 *     excludes everything dealt above it, so no post repeats.
 *
 * Signed-in only, as /feed is. Five pages retained, as the feed.
 */
export function usePostPageFeed(userId: string | undefined, postId: string | undefined, enabled = true) {
  const client = useQueryClient();
  return useInfiniteQuery<{ posts: FeedPost[]; nextCursor: number | null; seen: string[] }, Error>({
    queryKey: ["post-page-feed", userId ?? "", postId ?? ""],
    enabled: !!userId && !!postId && enabled,
    staleTime: Infinity,
    initialPageParam: 0,
    queryFn: async ({ pageParam, queryKey }) => {
      const session = feedSessionFor(userId, "");
      const pageIndex = Number(pageParam) || 0;
      // The page before this one, found by its page PARAM — `maxPages` drops
      // the oldest pages, so an array index would point at the wrong one.
      const held = client.getQueryData<InfiniteData<{ seen: string[] }, number>>(queryKey);
      const prev = held ? held.pageParams.indexOf(pageIndex - 1) : -1;
      const before = pageIndex === 0 || !held || prev < 0 ? [postId!] : held.pages[prev].seen;
      const seed = session.seed.current ?? (postPageSeeds.get(postId!) ?? postPageSeeds.set(postId!, newFeedSessionSeed()).get(postId!)!);
      const networkIds = session.networkIds.current.length ? session.networkIds.current : await fetchRelevantUsers(userId!);
      const { rows } = await fetchBroadcastPage(before, 0, null, seed, session.personal.current);
      const fresh = rows.filter((r: { id: string }) => !before.includes(r.id));
      if (fresh.length === 0) return { posts: [], nextCursor: null, seen: before };
      const posts = await enrichPosts(fresh, networkIds, userId!);
      return { posts, nextCursor: pageIndex + 1, seen: [...before, ...fresh.map((r: { id: string }) => r.id)] };
    },
    getNextPageParam: (last) => last.nextCursor,
    maxPages: 5,
  });
}
/** A cold link's own seed per post — kept so a refetch of a held page asks for the same deal. */
const postPageSeeds = new Map<string, string>();

export function flattenFeedPages(pages: FeedPage[] | undefined): FeedPost[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const result: FeedPost[] = [];
  for (const page of pages) {
    for (const post of page.posts) {
      if (!seen.has(post.id)) {
        seen.add(post.id);
        result.push(post);
      }
    }
  }
  return result;
}

export function getNetworkIds(pages: FeedPage[] | undefined): string[] {
  return pages?.[0]?.networkIds ?? [];
}

/**
 * Stage L2 · THE ONE WAY TO ASK FOR A NEW DEAL: pull-to-refresh, the "N new
 * posts" pill, "Couldn't refresh — tap to retry", and the refresh after the
 * member's own post.
 *
 * It restarts the feed from its FIRST page, and that is not a nicety:
 *   · `refetch()` on an infinite query refetches the pages it still HOLDS, in
 *     order. With `maxPages: 5`, a member who has scrolled six pages down no
 *     longer holds page 0 — so a plain refetch never fetched page 0, never made
 *     a new session seed, and re-read pages 1–5 with the old seed and the old
 *     exclude lists. The refresh the Owner asked for did nothing for exactly
 *     the member who had scrolled the most.
 *   · and when page 0 IS held, refetching all five pages was five RPCs and five
 *     enrichments to show the ten posts at the top.
 * One page, one new seed; the rest load as the member scrolls, as always.
 *
 * Resolves true when the new deal arrived, false when it did not — and then
 * NOTHING the member had on screen is lost:
 *   · with no network it does not start at all (a paused request would hold
 *     the pull-to-refresh spinner until the signal came back);
 *   · if the request fails after its retries, every page that was loaded is put
 *     back exactly as it was. Restarting from the first page means the other
 *     pages are let go first, and on the weak signal this app is used on, a
 *     refresh that failed must not cost the member the posts they had.
 * Feed.tsx shows "Couldn't refresh — tap to retry" on false.
 */
export function useFeedRefresh(categories?: string[] | null, tab: FeedTab = "for_you"): () => Promise<boolean> {
  const qc = useQueryClient();
  const catsKey = categories && categories.length ? [...categories].sort().join(",") : "";
  const timeline: TimelineTab | null = tab === "following" || tab === "favourites" ? tab : null;
  return useCallback(async () => {
    const queryKey = queryKeys.feed(catsKey ? catsKey.split(",") : null, timeline);
    if (!onlineManager.isOnline()) return false;
    const onScreen = qc.getQueryData<InfiniteData<FeedPage, number>>(queryKey);
    qc.setQueryData<InfiniteData<FeedPage, number>>(queryKey, (d) =>
      d && d.pages.length > 0 ? { pages: d.pages.slice(0, 1), pageParams: [0] } : d);
    await qc.refetchQueries({ queryKey, exact: true, type: "active" });
    const dealt = qc.getQueryState(queryKey)?.status === "success";
    if (!dealt && onScreen && onScreen.pages.length > 1) qc.setQueryData(queryKey, onScreen);
    return dealt;
  }, [qc, catsKey, timeline]);
}
