/**
 * S7b-3 review #548 · the feed and a missing network, through the REAL
 * useFeedQuery and the real supabase-js client against a fake PostgREST.
 *
 *  1. Offline with nothing saved: no request, React Query PAUSES the page
 *     (cancellable — nothing is left running); when the network returns,
 *     exactly ONE page-0 deal is made, however many refreshes were asked for
 *     meanwhile. (Before: each waited inside the page function and all of them
 *     dealt when the network came back — several seeds, wrong cursor.)
 *  2. Flight-mode COLD START: the phone says offline at start
 *     (navigator.onLine false) — React Query's online flag starts "online" and
 *     only changes on an event, so it is seeded from the phone
 *     (seedOnlineManager). The saved posts are shown, no request.
 *  3. A network that says "online" but answers nothing (Wi-Fi without
 *     internet): page 0 fails with a network error → the saved posts are
 *     shown, never the error card.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";

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

const { useFeedQuery, useFeedRefresh, usePostPageFeed, __resetSessionSeedRpcProbe } = await import("@/hooks/feed/useFeedQuery");
const { clearFeedSessions } = await import("@/lib/feedSessions");
const { memoryBackend, setBackend } = await import("@/lib/offline/deviceStore");
const { recordFeedPage, resetFeedArchiveMemory } = await import("@/lib/offline/feedArchive");
const { seedOnlineManager } = await import("@/lib/offline/onlineSeed");

const ME = "00000000-0000-4000-8000-0000000000aa";
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POOL = Array.from({ length: 60 }, (_, i) => ({
  id: uuid(i), user_id: `20000000-0000-4000-8000-${String(i % 7).padStart(12, "0")}`, content: `post ${i}`, image_url: null,
  image_urls: [], privacy: "public", created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), likes_count: 0,
  comments_count: 0, shares_count: 0, feed_tier: "unseen", author_name: "A", author_avatar: null, thumbnail_urls: null, categories: [],
}));

let feedCalls: Record<string, unknown>[];
let dead: boolean;
/** get_feed_page requests that reached the (dead) network. */
let deadFeedAttempts: number;
let broadcastSeeds: unknown[];
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let qc: QueryClient;
let onLine: boolean;
beforeEach(async () => {
  localStorage.clear();
  clearFeedSessions();
  __resetSessionSeedRpcProbe();
  resetFeedArchiveMemory();
  setBackend(memoryBackend());
  feedCalls = [];
  dead = false;
  deadFeedAttempts = 0;
  broadcastSeeds = [];
  onLine = true;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => onLine });
  h.fetchImpl = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (dead) {
      if (url.pathname.endsWith("/rpc/get_feed_page")) deadFeedAttempts++;
      throw new TypeError("Failed to fetch");
    }
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/);
    if (m?.[1] === "get_feed_page") {
      feedCalls.push(body);
      const after = Number(body._after);
      return json(200, POOL.slice(after, after + Number(body._limit)).map((p, i) => ({ ...p, source: null, caught_up_after: false, feed_pos: after + i + 1 })));
    }
    if (m?.[1] === "feature_allowed_me") return json(200, false);
    if (m?.[1] === "get_broadcast_feed") { broadcastSeeds.push(body._session_seed); return json(200, POOL.slice(0, 5)); }
    if (url.pathname === "/rest/v1/posts" && url.searchParams.get("select") === "created_at") return json(200, [{ created_at: POOL[0].created_at }]);
    return json(200, []);
  };
  qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
});
afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  qc.clear();
});

const saved = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `saved-${i}`, user_id: "u1", content: `saved ${i}` }));
async function saveTwoPages() {
  await recordFeedPage(ME, 0, saved(10), { warm: false, saveDelayMs: 0 });
  await recordFeedPage(ME, 1, saved(20).slice(10), { warm: false, saveDelayMs: 0 });
}
function mount() {
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => useFeedQuery(ME), { wrapper });
}

describe("review #548 · offline with nothing saved", () => {
  it("pauses with no request; refreshes meanwhile; network back -> ONE deal", async () => {
    onlineManager.setOnline(false);
    const { result } = mount();
    await waitFor(() => expect(result.current.fetchStatus).toBe("paused"), { timeout: 4000 });
    // pull-to-refresh three times while offline
    for (let i = 0; i < 3; i++) {
      await act(async () => { void result.current.refetch(); await new Promise((r) => setTimeout(r, 20)); });
    }
    expect(feedCalls).toEqual([]);
    await act(async () => { onlineManager.setOnline(true); });
    await waitFor(() => expect(result.current.data?.pages?.[0]?.posts?.length).toBe(10), { timeout: 6000 });
    await new Promise((r) => setTimeout(r, 300));
    const pageZero = feedCalls.filter((c) => Number(c._after) === 0);
    expect(pageZero).toHaveLength(1);
    expect(new Set(feedCalls.map((c) => c._session_seed)).size).toBe(1);
  }, 15000);
});

describe("review #548 · flight-mode cold start (the installed app)", () => {
  beforeEach(() => { (window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" }; });
  afterEach(() => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; });

  it("the phone says offline at start: the saved posts, no request", async () => {
    await saveTwoPages();
    onLine = false;
    seedOnlineManager();
    const { result } = mount();
    await waitFor(() => expect(result.current.data?.pages?.[0]?.offline).toBe(true));
    expect(result.current.data!.pages[0].posts[0].id).toBe("saved-0");
    expect(feedCalls).toEqual([]);
  });

  it("the phone's 'online' event brings React Query back online", async () => {
    onLine = false;
    seedOnlineManager();
    expect(onlineManager.isOnline()).toBe(false);
    onLine = true;
    window.dispatchEvent(new Event("online"));
    expect(onlineManager.isOnline()).toBe(true);
  });
});

describe("review #548 · 'online' but nothing answers", () => {
  it("a COLD first page that still fails after its retries: the saved posts, not the error card", async () => {
    await saveTwoPages();
    dead = true;
    const { result } = mount();
    await waitFor(() => expect(result.current.data?.pages?.[0]?.offline).toBe(true), { timeout: 20000 });
    expect(result.current.isError).toBe(false);
    // only after the first try AND its 3 retries failed (re-review #548)
    expect(deadFeedAttempts).toBe(4);
    // the rest of that session comes from the phone too (one session, one source)
    dead = false;
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(result.current.data!.pages[1].posts[0].id).toBe("saved-10");
    expect(feedCalls).toEqual([]);
  }, 30000);

  it("pauses while offline do not use up the network retries (4 real attempts, then the saved posts)", async () => {
    // Offline with nothing saved: the page pauses (one OfflineNoSavedPageError).
    onlineManager.setOnline(false);
    const { result } = mount();
    await waitFor(() => expect(result.current.fetchStatus).toBe("paused"), { timeout: 4000 });
    await saveTwoPages();
    dead = true;
    await act(async () => { onlineManager.setOnline(true); });
    await waitFor(() => expect(result.current.data?.pages?.[0]?.offline).toBe(true), { timeout: 20000 });
    expect(deadFeedAttempts).toBe(4);
  }, 30000);

  it("re-review #548 B1: a pull-to-refresh that fails with posts on screen is NOT swapped for saved posts", async () => {
    await saveTwoPages();
    const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => ({ feed: useFeedQuery(ME), refresh: useFeedRefresh() }), { wrapper });
    await waitFor(() => expect(result.current.feed.data?.pages?.[0]?.posts?.length).toBe(10));
    await act(async () => { await result.current.feed.fetchNextPage(); });
    await act(async () => { await result.current.feed.fetchNextPage(); });
    await waitFor(() => expect(result.current.feed.data?.pages).toHaveLength(3));
    const before = qc.getQueryData<{ pages: Array<{ posts: Array<{ id: string }> }> }>(["feed", null])!.pages.flatMap((p) => p.posts.map((x) => x.id));
    dead = true;
    let dealt: boolean | undefined;
    await act(async () => { dealt = await result.current.refresh(); });
    expect(dealt).toBe(false);
    const after = qc.getQueryData<{ pages: Array<{ offline?: boolean; posts: Array<{ id: string }> }> }>(["feed", null])!.pages;
    expect(after.some((p) => p.offline)).toBe(false);
    expect(after.flatMap((p) => p.posts.map((x) => x.id))).toEqual(before);
  }, 30000);
});

describe("re-review #548 N1 · Back returns to a session read from the phone", () => {
  it("Back (POP) after a post keeps the saved pages: no new deal, same posts", async () => {
    await saveTwoPages();
    onlineManager.setOnline(false);
    const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
    const first = renderHook(() => useFeedQuery(ME), { wrapper });
    await waitFor(() => expect(first.result.current.data?.pages?.[0]?.offline).toBe(true));
    const shown = first.result.current.data!.pages[0].posts.map((p) => p.id);
    first.unmount(); // the member opens a post
    onlineManager.setOnline(true); // the network comes back meanwhile
    const back = renderHook(() => useFeedQuery(ME, null, "POP"), { wrapper });
    await new Promise((r) => setTimeout(r, 300));
    expect(back.result.current.data!.pages[0].posts.map((p) => p.id)).toEqual(shown);
    expect(feedCalls).toEqual([]);
  });

  it("the phone session's seed is never sent to the server (the post page's 'more posts')", async () => {
    await saveTwoPages();
    onlineManager.setOnline(false);
    const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
    const feed = renderHook(() => useFeedQuery(ME), { wrapper });
    await waitFor(() => expect(feed.result.current.data?.pages?.[0]?.offline).toBe(true));
    onlineManager.setOnline(true);
    const more = renderHook(() => usePostPageFeed(ME, "saved-0"), { wrapper });
    await waitFor(() => expect(broadcastSeeds.length).toBeGreaterThan(0));
    expect(String(broadcastSeeds[0]).startsWith("offline:")).toBe(false);
    more.unmount();
  });
});
