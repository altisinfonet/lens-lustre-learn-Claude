/**
 * THE FEED MUST DEAL A NEW HAND — AND THE APP MUST ACTUALLY ASK.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner spec, 2026-07-30 and restated 2026-08-05:
 *   "on every refresh changing is must to ensure maximum visibility of all
 *    posts, not newer one."
 *
 * MEASURED ON PRODUCTION 2026-08-05, and the split is the whole point:
 *
 *   * DATABASE — working. `get_broadcast_feed` is VOLATILE and re-deals every
 *     call: three consecutive calls as one member returned 10 posts each and
 *     shared only 1, then 0. The 2026-08-04 migration is intact.
 *   * CLIENT — throwing it away. `App.tsx` sets a global `staleTime` of 5
 *     minutes and this query never overrode it, so React Query served the
 *     identical cached deal for five minutes. Leave /feed, come back, same
 *     posts. The database had shuffled; nobody asked it.
 *
 * A test that only checked the SQL would have passed all along while members
 * kept seeing the same feed — which is exactly what happened.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useNavigate, useNavigationType, type NavigateFunction } from "react-router-dom";
import { readFileSync } from "node:fs";
import { migrationsInSequence } from "@/test-utils/migrations";
import { join } from "node:path";

/* ── The behaviour half (PR #434 review, B1): the REAL useFeedQuery and the real
 *    supabase-js client against a fake PostgREST that records every request and
 *    DEALS BY SEED, as get_broadcast_feed does in production. ── */
const h = vi.hoisted(() => ({
  fetchImpl: null as null | ((i: RequestInfo | URL, init?: RequestInit) => Promise<Response>),
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabase: createClient("https://testprojectref0000x.supabase.co", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: ((i: RequestInfo | URL, init?: RequestInit) => h.fetchImpl!(i, init)) as typeof fetch },
    }),
  };
});
const { useFeedQuery, useFeedRefresh } = await import("@/hooks/feed/useFeedQuery");
const { wipeMemberDataOnSignOut } = await import("@/lib/offline/signOutWipe");
const { queryKeys } = await import("@/lib/queryKeys");

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const hook = read("src/hooks/feed/useFeedQuery.ts");
const app = read("src/App.tsx");
/**
 * ⚠ THE LATEST DEFINITION, FOUND AT RUN TIME. NEVER A HARDCODED PATH.
 *
 * This line used to read `20260805040000_broadcast_feed_null_exclude_guard.sql`
 * by name. That file is the one that ADDED the COALESCE guard, so the assertion
 * below passed forever — while BOTH later definitions of the function
 * (`20260805100000_feed_newest_first.sql` and `20260812070000_post_categories.sql`)
 * silently reverted to a bare `ANY(_exclude_ids)`.
 *
 * The guard was therefore absent from production from 2026-08-05 to 2026-08-13
 * with this test green the whole time. A test pinned to a superseded file is
 * not a weak test, it is a FALSE one: it reports on a definition nobody runs.
 *
 * Now it sorts the migrations directory and reads whichever file most recently
 * defines the function. A future migration that reverts the guard again fails
 * here on the day it is written.
 */
const migrationsDir = "supabase/migrations";
const latestFeedMigration = migrationsInSequence(join(process.cwd(), migrationsDir))
  .filter((f) =>
    readFileSync(join(process.cwd(), migrationsDir, f), "utf8").includes(
      "CREATE FUNCTION public.get_broadcast_feed",
    ) ||
    readFileSync(join(process.cwd(), migrationsDir, f), "utf8").includes(
      "CREATE OR REPLACE FUNCTION public.get_broadcast_feed",
    ),
  )
  .pop();

const sql = read(`${migrationsDir}/${latestFeedMigration}`).replace(/^\s*--.*$/gm, "");

describe("the client asks again every time it mounts", () => {
  it("the feed query is never considered fresh", () => {
    expect(hook).toMatch(/staleTime:\s*0/);
  });

  // ⚠ "and refetches on mount even so" — `expect(hook).toMatch(/refetchOnMount:
  // \s*"always"/)` — USED TO BE HERE. It was a text pin standing in for a
  // behaviour, and the behaviour it pinned had a hole in it (PR #434 review,
  // B1): "always" also re-dealt the feed on Back, so the scroll restore put the
  // member at the right height over posts they had never seen. It is replaced,
  // not dropped, by the describe block "a fresh visit deals a new hand; Back
  // keeps the hand on screen" at the end of this file, which RUNS the hook:
  // (a) keeps this test's guarantee — every fresh visit asks the database
  // again, with a new seed — at the same strength, observed on the wire instead
  // of read from the source; (b) and (c) are the half a text pin cannot check.

  it("the global default it is overriding really is 5 minutes", () => {
    // Not assumed — read. If this ever drops to 0 globally, the override above
    // becomes redundant rather than wrong, and this test says so out loud.
    expect(app).toMatch(/staleTime:\s*5\s*\*\s*60\s*\*\s*1000/);
  });

  it("pull-to-refresh still explicitly refetches — after sending what was seen (Stage L2)", () => {
    // This path always worked; the fix is for every OTHER way in. Stage L2
    // keeps the wiring (and this file's pre-L2 assertion, unchanged) — what
    // changed is what Feed.tsx's `refetch` does: it is now the feed's one
    // refresh. Flush the seen-events first, so the new deal already knows what
    // not to lead with; then ask for the deal (useFeedRefresh restarts the feed
    // from its first page — React Query's own refetch never reached page 0 once
    // `maxPages` had dropped it); and only when it has arrived start a new
    // seen-session.
    const feed = read("src/pages/Feed.tsx");
    expect(read("src/pages/Feed.tsx")).toMatch(/onRefresh=\{async \(\) => \{ await refetch\(\); \}\}/);
    const start = feed.indexOf("const refetch = useCallback(");
    const end = feed.indexOf("}, [tracker, flushBuffer, refreshFeed]);");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = feed.slice(start, end);
    expect(body).toMatch(/await tracker\.flushNow\(\);\s+const dealt = await refreshFeed\(\);\s+setRefreshFailed\(!dealt\);\s+if \(dealt\) \{\s+flushBuffer\(\);\s+tracker\.newSession\(\);/);
    // and a refresh that did not arrive is said on screen, beside the two older reasons
    expect(feed).toMatch(/\{\(isError \|\| servedStale \|\| refreshFailed\) && \(/);
    expect(feed).toMatch(/const refreshFeed = useFeedRefresh\(feedCategories\);/);
  });

  it("a refresh restarts from the first page, so it always deals page 0 with a new seed (Stage L2)", () => {
    const from = hook.indexOf("export function useFeedRefresh(");
    expect(from).toBeGreaterThan(-1);
    const body = hook.slice(from);
    expect(body).toMatch(/pages: d\.pages\.slice\(0, 1\), pageParams: \[0\]/);
    expect(body).toMatch(/refetchQueries\(\{ queryKey, exact: true, type: "active" \}\)/);
  });

  it("nothing re-deals the feed behind the member's back: focus and reconnect refetch only after a failure (Stage L2)", () => {
    // App.tsx turns refetchOnWindowFocus on globally and this query is never
    // fresh — so until L2 every return to the tab refetched the feed. Harmless
    // then (same order for the hour, nothing seen); a new deal under the thumb now.
    expect(app).toMatch(/refetchOnWindowFocus:\s*true/);
    expect(hook).toMatch(/refetchOnWindowFocus:\s*refetchOnlyAfterFailure/);
    expect(hook).toMatch(/refetchOnReconnect:\s*refetchOnlyAfterFailure/);
    expect(hook).toMatch(/export const refetchOnlyAfterFailure = \(query: \{ state: \{ status: string \} \}\): boolean => query\.state\.status === "error";/);
  });
});

describe("the database half must stay volatile", () => {
  it("is VOLATILE, which is what lets random() re-deal per call", () => {
    // STABLE would let Postgres reuse one result and the feed would freeze.
    expect(sql).toMatch(/\bVOLATILE\b/);
    expect(sql).not.toMatch(/\bSTABLE\b/);
  });

  /**
   * ⚠ THESE TWO ASSERTIONS WERE RE-POINTED ON 2026-08-14, NOT RELAXED.
   *
   * They used to match the literal `random() * 6.0 ASC`. That expression is
   * gone: 20260814080000 replaced the per-call `random()` with
   * `feed_rank_score(id, bucket, seed)` — a deterministic hash of the post and a
   * session seed — because non-deterministic ordering makes a keyset cursor
   * impossible, forces the unbounded `_exclude_ids` array, and forecloses
   * caching, read replicas and fan-out permanently.
   *
   * The guard fired on that change, which is exactly what it is for. It is
   * updated because the ranking change is deliberate and was measured, not
   * because it was inconvenient:
   *
   *   Spearman(viewer_bucket, rank position), 1M-post harness
   *     old  random() * 6.0        +0.9231
   *     new  feed_rank_score(...)  +0.9192      delta 0.0039
   *
   * Low-viewer posts still surface first, to within 0.4%. The property these
   * tests protect — jitter, no recency term in the unseen tier, oldest-seen-day
   * first in the recycled tier — is unchanged, so they now assert the property
   * AND pin the new expression, which is strictly more than they asserted
   * before.
   */
  it("still ranks with jitter and no recency term", () => {
    // Jitter is now deterministic-per-seed rather than per-call.
    expect(sql).toMatch(/feed_rank_score\(v\.id, v\.bucket, \(SELECT s FROM seed\)\) ASC/);
    // The jitter must still be seeded, or every viewer sees one global order.
    expect(sql).toMatch(/to_char\(now\(\), 'YYYYMMDDHH24'\) \|\| coalesce\(auth\.uid\(\)::text, 'anon'\)/);
    // No recency term may creep into the unseen tier — that is what makes new
    // posts crowd out everything else.
    //
    // ⚠ The slice end is `,\n  seen_ranked AS`, NOT `seen_ranked AS`.
    // `indexOf("seen_ranked AS")` matches inside `unseen_ranked AS`, so the
    // slice came back empty and the assertion passed against nothing. Caught by
    // mutating the ORDER BY and watching this test stay green — trap #14 again,
    // this time in the guard itself.
    const from = sql.indexOf("unseen_ranked AS");
    const to = sql.indexOf("seen_ranked AS", from + "unseen_ranked AS".length);
    expect(from, "unseen_ranked CTE not found").toBeGreaterThan(-1);
    expect(to, "seen_ranked CTE not found after unseen_ranked").toBeGreaterThan(from);
    const unseen = sql.slice(from, to);
    expect(unseen.length, "the unseen_ranked slice is empty, so this asserts nothing")
      .toBeGreaterThan(100);
    expect(unseen).not.toMatch(/created_at/);
  });

  it("recycles seen posts oldest-seen-day first, shuffled within the day", () => {
    expect(sql).toMatch(/86400\.0\) DESC,\s*[\s\S]{0,80}?feed_rank_score/);
  });

  it("ranks over a BOUNDED candidate pool, not every visible post", () => {
    // The reason this migration exists. Measured at 1M posts: 4,836,645 buffers
    // and 9,489 ms scanning everything, against 1,656 buffers and 8 ms here.
    expect(sql).toMatch(/feed_candidates\(/);
    // The count(DISTINCT) LATERAL was 97% of the cost. It must not come back.
    expect(sql).not.toMatch(/count\(DISTINCT fe\.user_id\)/);
  });
});

describe("a NULL exclusion list must not empty the feed", () => {
  it("guards with COALESCE", () => {
    // Measured before the fix: get_broadcast_feed(NULL, 10) returned 0 rows
    // against 150 posts, because NOT (id = ANY(NULL)) is NULL, not TRUE.
    // After: 10 rows. The app never sent NULL, so this closes a class rather
    // than a live outage.
    expect(sql).toMatch(/ANY\(COALESCE\(_exclude_ids, '\{\}'::uuid\[\]\)\)/);
    expect(sql).not.toMatch(/ANY\(_exclude_ids\)/);
  });

  it("the app still sends an array, so nothing about the live call changes", () => {
    expect(hook).toMatch(/excludeByPageRef\.current\.get\(pageIndex\) \?\? \[\]/);
  });

  it("is the deployed function with ONE clause changed, not a rewrite", () => {
    // Re-deriving a live feed function from a partial read would be guesswork
    // on production. This migration was generated from
    // 20260804090000_feed_reshuffle_on_refresh.sql; `diff` showed exactly one
    // differing line. These anchors fail if someone "tidies" it into a rewrite.
    expect(sql).toMatch(/feed_tier text/);
    expect(sql).toMatch(/'unseen'::text AS feed_tier, 1 AS tier_order/);
    expect(sql).toMatch(/'recycled'::text AS feed_tier, 2 AS tier_order/);
    expect(sql).toMatch(/e\.skips = 1 AND e\.last_seen_at > now\(\) - interval '12 hours'/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * B1 (PR #434 review) — "Feed scroll position restored exactly when returning"
 * (REV4 §6 L1) means THE SAME POSTS, not only the same pixel offset.
 * /feed and /post/:id are sibling routes, so Back unmounts and remounts the
 * feed: what the remount does with the pages in cache is the whole question.
 * ─────────────────────────────────────────────────────────────────────────── */
const ME = "00000000-0000-4000-8000-0000000000aa";
const WATERMARK = "2026-10-13T09:00:00.123456+00:00";
const pid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POOL = Array.from({ length: 60 }, (_, i) => ({
  id: pid(i), user_id: `20000000-0000-4000-8000-${String(i % 7).padStart(12, "0")}`, content: `post ${i}`,
  image_url: null, image_urls: [], privacy: "public", created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
  likes_count: 0, comments_count: 0, shares_count: 0, feed_tier: "unseen", author_name: `Author ${i % 7}`,
  author_avatar: null, thumbnail_urls: null, categories: [],
}));
/** As production: each seed is its own deal, and an excluded post is never dealt. */
function deal(body: Record<string, unknown>) {
  const exclude = new Set((body._exclude_ids as string[] | null) ?? []);
  const seed = String(body._session_seed ?? "hour");
  const shift = [...seed].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % POOL.length;
  return [...POOL.slice(shift), ...POOL.slice(0, shift)].filter((p) => !exclude.has(p.id)).slice(0, Number(body._limit));
}
interface FeedCall { seed: string | undefined; exclude: string[]; newest: number }
let feedCalls: FeedCall[] = [];
let uuidCounter = 0;
let qc: QueryClient;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The feed screen as far as this file cares: the router's navigation type, handed to the hook as Feed.tsx does. */
let feed: ReturnType<typeof useFeedQuery> | null = null;
let refresh: (() => Promise<boolean>) | null = null;
let go: NavigateFunction | null = null;
/** Who is signed in. */
let who = ME;
function FeedScreen() {
  const navigationType = useNavigationType();
  feed = useFeedQuery(who, null, navigationType);
  refresh = useFeedRefresh(null);
  return null;
}
function Elsewhere() { return null; }
function Nav() { go = useNavigate(); return null; }
function mountApp(start: string) {
  return render(React.createElement(QueryClientProvider, { client: qc },
    React.createElement(MemoryRouter, { initialEntries: [start] },
      React.createElement(Nav),
      React.createElement(Routes, null,
        React.createElement(Route, { path: "/below", element: React.createElement(Elsewhere) }),
        React.createElement(Route, { path: "/feed", element: React.createElement(FeedScreen) }),
        React.createElement(Route, { path: "/post/:postId", element: React.createElement(Elsewhere) })))));
}
const ids = () => (feed?.data?.pages ?? []).flatMap((p) => p.posts.map((x) => x.id));
async function navigate(to: string | number) {
  await act(async () => { if (typeof to === "number") go!(to); else go!(to); });
}
async function settled(pages: number) {
  await waitFor(() => {
    expect(feed?.isSuccess).toBe(true);
    expect(feed?.isPlaceholderData).toBe(false);
    expect(feed?.data?.pages).toHaveLength(pages);
    expect(feed?.isFetching).toBe(false);
  });
}
/** Long enough for any request a mount started to have reached the fake server and come back. */
const quiet = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });
async function loadMore(pages: number) {
  await act(async () => { await feed!.fetchNextPage(); });
  await settled(pages);
}
/** /below → tap Feed (PUSH) → two pages → open a post. The feed is now unmounted, its pages in cache. */
async function readTwoPagesThenOpenAPost() {
  mountApp("/below");
  await navigate("/feed");
  await settled(1);
  await loadMore(2);
  const onScreen = ids();
  expect(onScreen).toHaveLength(20);
  const seed = feedCalls[0].seed;
  await navigate(`/post/${onScreen[3]}`);
  feed = null; // unmounted: the next value can only come from a remount
  return { onScreen, seed, calls: feedCalls.length };
}

describe("a fresh visit deals a new hand; Back keeps the hand on screen (B1)", () => {
  beforeEach(() => {
    localStorage.clear();
    feedCalls = [];
    feed = null; refresh = null; go = null; who = ME;
    uuidCounter = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
      () => `30000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`,
    );
    h.fetchImpl = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      if (url.pathname === "/rest/v1/rpc/get_broadcast_feed") {
        feedCalls.push({ seed: body._session_seed as string | undefined, exclude: (body._exclude_ids as string[]) ?? [], newest: Number(body._newest_first) });
        return json(200, deal(body));
      }
      if (url.pathname === "/rest/v1/posts" && url.searchParams.get("select") === "created_at") return json(200, [{ created_at: WATERMARK }]);
      return json(200, []);
    };
    // App.tsx's own defaults (5-minute staleTime, focus refetch on, 10-minute gcTime).
    qc = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60 * 1000, gcTime: 10 * 60 * 1000, refetchOnWindowFocus: true } } });
  });
  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    qc.clear();
    await wipeMemberDataOnSignOut(); // a sign-out between tests: no session survives into the next
  });

  it("(a) a fresh visit (PUSH — tapping Home/Feed) asks the database again, page 0, with a NEW seed — the 2026-08-05 guarantee", async () => {
    const { onScreen, seed, calls } = await readTwoPagesThenOpenAPost();
    await navigate("/below");
    await navigate("/feed"); // PUSH
    await waitFor(() => expect(feedCalls.length).toBeGreaterThan(calls));
    await settled(2);
    const fresh = feedCalls[calls];
    expect(fresh).toMatchObject({ exclude: [], newest: 3 });
    expect(fresh.seed).not.toBe(seed);
    expect(ids()).not.toEqual(onScreen);
  });

  it("(a, deep) a fresh visit after six pages — page 0 dropped by maxPages — is STILL a new deal, not a re-read of the old session (control)", async () => {
    // Found by the browser harness's fresh-visit control while B1 was being
    // fixed: with the session kept across mounts, the refetch on mount re-read
    // pages 1–5 with the old seed and exclude lists. A fresh visit starts over.
    mountApp("/below");
    await navigate("/feed");
    await settled(1);
    for (let i = 2; i <= 5; i++) await loadMore(i);
    await act(async () => { await feed!.fetchNextPage(); });
    await settled(5);
    expect(feed?.data?.pageParams).toEqual([1, 2, 3, 4, 5]);
    const seed = feedCalls[0].seed;
    const calls = feedCalls.length;
    await navigate("/below");
    feed = null;
    await navigate("/feed"); // PUSH
    await waitFor(() => expect(feedCalls.length).toBeGreaterThan(calls));
    await settled(5);
    expect(feedCalls.slice(calls).every((c) => c.seed !== seed)).toBe(true);
  });

  it("(b) Back (POP) to the feed with its pages in cache makes NO request and shows the same posts in the same order", async () => {
    const { onScreen, calls } = await readTwoPagesThenOpenAPost();
    await navigate(-1); // the browser's / the phone's Back
    await settled(2);
    await quiet();
    expect(feedCalls.length).toBe(calls);
    expect(ids()).toEqual(onScreen);
    expect(feed?.isFetching).toBe(false);
  });

  it("(c) \"load more\" after Back carries on the SAME session: the seed on screen, and every post on screen excluded", async () => {
    const { onScreen, seed, calls } = await readTwoPagesThenOpenAPost();
    await navigate(-1);
    await settled(2);
    await quiet();
    await loadMore(3);
    const after = feedCalls.slice(calls);
    expect(after).toHaveLength(1);
    expect(after[0].seed).toBe(seed);
    expect(after[0].newest).toBe(0);
    expect(after[0].exclude).toEqual(onScreen);
    expect(ids().slice(0, 20)).toEqual(onScreen);
    expect(new Set(ids()).size).toBe(30);
  });

  it("(control) pull-to-refresh / the pill after a Back return is still a new deal", async () => {
    const { seed, calls } = await readTwoPagesThenOpenAPost();
    await navigate(-1);
    await settled(2);
    await quiet();
    let dealt: boolean | undefined;
    await act(async () => { dealt = await refresh!(); });
    await settled(1);
    expect(dealt).toBe(true);
    expect(feedCalls.length).toBeGreaterThan(calls);
    const last = feedCalls[feedCalls.length - 1];
    expect(last).toMatchObject({ exclude: [], newest: 3 });
    expect(last.seed).not.toBe(seed);
  });

  it("(control) a cold start — also a POP — over pages restored from the device still deals new: they are not this session's deal", async () => {
    const stored = deal({ _session_seed: "a-previous-run", _limit: 10 }).map((p) => ({ ...p, is_suggested: false }));
    qc.setQueryData(queryKeys.feed(null), { pages: [{ posts: stored, nextCursor: 1, networkIds: [], sessionSeed: "a-previous-run", watermark: WATERMARK }], pageParams: [0] }, { updatedAt: Date.now() - 60_000 });
    mountApp("/feed"); // the first entry of a document arrives as a POP
    await waitFor(() => expect(feedCalls.length).toBeGreaterThan(0));
    await settled(1);
    expect(feedCalls[0]).toMatchObject({ exclude: [], newest: 3 });
    expect(feedCalls[0].seed).not.toBe("a-previous-run");
  });

  it("(control) after a sign-out the next Back is not handed the old session", async () => {
    const { calls } = await readTwoPagesThenOpenAPost();
    await act(async () => { await wipeMemberDataOnSignOut(); });
    await navigate(-1);
    await waitFor(() => expect(feedCalls.length).toBeGreaterThan(calls));
    expect(feedCalls[calls]).toMatchObject({ exclude: [], newest: 3 });
  });

  it("(control) a different member on this device is never handed the previous member's session on Back", async () => {
    const { seed, calls } = await readTwoPagesThenOpenAPost();
    who = "00000000-0000-4000-8000-0000000000bb";
    await navigate(-1);
    await waitFor(() => expect(feedCalls.length).toBeGreaterThan(calls));
    expect(feedCalls[calls]).toMatchObject({ exclude: [], newest: 3 });
    expect(feedCalls[calls].seed).not.toBe(seed);
  });
});
