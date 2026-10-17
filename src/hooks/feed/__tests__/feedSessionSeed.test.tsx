/**
 * STAGE L2 (F-REV4-8, cause 2) — ONE SEED PER REFRESH, KEPT FOR EVERY PAGE OF
 * THAT SESSION; A REFRESH ALWAYS DEALS PAGE 0 AGAIN; NOTHING ELSE RE-DEALS.
 *
 * The REAL `useFeedQuery` / `useFeedRefresh` and the real supabase-js client,
 * pointed at a fake PostgREST that records every request. The fake RPC deals by
 * seed and honours `_exclude_ids`, so "same session → no duplicates across
 * pages" is observed on the wire, not assumed.
 *
 * What the database does with the seed is proven on PGlite against production's
 * own function bodies (docs/evidence/d1/L2-feed-freshness, PR A).
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from "@tanstack/react-query";

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

const { useFeedQuery, useFeedRefresh, refetchOnlyAfterFailure, __resetSessionSeedRpcProbe } = await import("@/hooks/feed/useFeedQuery");
const { logger } = await import("@/lib/logger");

const ME = "00000000-0000-4000-8000-0000000000aa";
const WATERMARK = "2026-10-13T09:00:00.123456+00:00";
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const author = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** 80 posts by 7 authors, so no page is ever one author. */
const POOL = Array.from({ length: 80 }, (_, i) => ({
  id: uuid(i), user_id: author(i % 7), content: `post ${i}`, image_url: null, image_urls: [], privacy: "public",
  created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), likes_count: 0, comments_count: 0, shares_count: 0,
  feed_tier: "unseen", author_name: `Author ${i % 7}`, author_avatar: null, thumbnail_urls: null, categories: [],
}));

interface FeedCall { seed: string | undefined; exclude: string[]; newest: number; hasSeedArg: boolean }
let feedCalls: FeedCall[];
/** What the fake database does with get_broadcast_feed. Replaced per test. */
let rpc: (body: Record<string, unknown>) => { status: number; body: unknown };
/** What the fake database answers for the chronological fallback (`posts?select=id,…`). */
let fallback: () => { status: number; body: unknown };

/** A deal that depends on the seed and never returns an excluded post. */
function deal(body: Record<string, unknown>) {
  const exclude = new Set((body._exclude_ids as string[] | null) ?? []);
  const seed = String(body._session_seed ?? "hour");
  const shift = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % POOL.length;
  const rotated = [...POOL.slice(shift), ...POOL.slice(0, shift)];
  return rotated.filter((p) => !exclude.has(p.id)).slice(0, Number(body._limit));
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let uuidCounter = 0;
let qc: QueryClient;

beforeEach(() => {
  localStorage.clear();
  __resetSessionSeedRpcProbe();
  feedCalls = [];
  rpc = (body) => ({ status: 200, body: deal(body) });
  fallback = () => ({ status: 200, body: POOL.slice(0, 10).map(({ feed_tier: _t, author_name: _n, author_avatar: _a, categories: _c, ...row }) => row) });
  uuidCounter = 0;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
    () => `30000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`,
  );
  h.fetchImpl = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    if (url.pathname === "/rest/v1/rpc/get_broadcast_feed") {
      feedCalls.push({
        seed: body._session_seed as string | undefined,
        exclude: (body._exclude_ids as string[]) ?? [],
        newest: Number(body._newest_first),
        hasSeedArg: "_session_seed" in body,
      });
      const r = rpc(body);
      return json(r.status, r.body);
    }
    if (url.pathname === "/rest/v1/posts" && url.searchParams.get("select") === "created_at") return json(200, [{ created_at: WATERMARK }]);
    if (url.pathname === "/rest/v1/posts" && (url.searchParams.get("select") ?? "").startsWith("id,user_id,content")) {
      const r = fallback();
      return json(r.status, r.body);
    }
    return json(200, []);
  };
  // The app's own defaults for the two options this file is about (src/App.tsx).
  qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, gcTime: Infinity } } });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  qc.clear();
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
});

function mount() {
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => ({ q: useFeedQuery(ME), refresh: useFeedRefresh(null) }), { wrapper });
}
const pagesOf = (r: ReturnType<typeof mount>["result"]) => r.current.q.data?.pages ?? [];
const idsOf = (r: ReturnType<typeof mount>["result"]) => pagesOf(r).flatMap((p) => p.posts.map((x) => x.id));
async function loaded(r: ReturnType<typeof mount>["result"], pages: number) {
  await waitFor(() => { expect(r.current.q.isSuccess).toBe(true); expect(r.current.q.isPlaceholderData).toBe(false); expect(pagesOf(r)).toHaveLength(pages); expect(r.current.q.isFetching).toBe(false); });
}
async function next(r: ReturnType<typeof mount>["result"]) {
  await act(async () => { await r.current.q.fetchNextPage(); });
}

describe("one session: one seed for every page, and no post twice", () => {
  it("page 0 and page 1 carry the SAME _session_seed; page 1 excludes exactly what page 0 delivered", async () => {
    const { result } = mount();
    await loaded(result, 1);
    await next(result);
    await loaded(result, 2);

    expect(feedCalls).toHaveLength(2);
    expect(feedCalls[0].seed).toMatch(/^30000000-/);
    expect(feedCalls[1].seed).toBe(feedCalls[0].seed);
    expect(feedCalls[0]).toMatchObject({ exclude: [], newest: 3 });
    expect(feedCalls[1].newest).toBe(0);
    // in delivery order — the database carries its 2-in-a-row rule across pages from the tail of this list
    expect(feedCalls[1].exclude).toEqual(pagesOf(result)[0].posts.map((p) => p.id));
    const all = idsOf(result);
    expect(all).toHaveLength(20);
    expect(new Set(all).size).toBe(20);
    // every page says which session it belongs to
    expect(pagesOf(result).map((p) => p.sessionSeed)).toEqual([feedCalls[0].seed, feedCalls[0].seed]);
  });

  it("the session's watermark rides on every page (maxPages drops page 0; the pill must keep working)", async () => {
    const { result } = mount();
    await loaded(result, 1);
    await next(result);
    await loaded(result, 2);
    expect(pagesOf(result).map((p) => p.watermark)).toEqual([WATERMARK, WATERMARK]);
  });
});

describe("a refresh is a new session", () => {
  it("sends a NEW seed, deals a different first screen, and restarts from the first page (one request, not one per loaded page)", async () => {
    const { result } = mount();
    await loaded(result, 1);
    await next(result);
    await loaded(result, 2);
    const firstScreen = pagesOf(result)[0].posts.map((p) => p.id);
    const before = feedCalls.length;

    let dealt: boolean | undefined;
    await act(async () => { dealt = await result.current.refresh(); });
    await loaded(result, 1);

    expect(dealt).toBe(true);
    expect(feedCalls.length - before).toBe(1);
    const call = feedCalls[feedCalls.length - 1];
    expect(call).toMatchObject({ exclude: [], newest: 3 });
    expect(call.seed).not.toBe(feedCalls[0].seed);
    expect(pagesOf(result)[0].posts.map((p) => p.id)).not.toEqual(firstScreen);
    expect(result.current.q.data?.pageParams).toEqual([0]);
  });

  it("after six pages — page 0 dropped by maxPages — a refresh STILL deals page 0 with a new seed", async () => {
    // The defect: refetch() re-reads the pages still held, so with page 0 gone
    // it re-read pages 1–5 with the old seed and never asked for a new deal.
    const { result } = mount();
    await loaded(result, 1);
    for (let i = 2; i <= 5; i++) { await next(result); await loaded(result, i); }
    await next(result);
    await loaded(result, 5);
    expect(result.current.q.data?.pageParams).toEqual([1, 2, 3, 4, 5]);
    const oldSeed = feedCalls[0].seed;
    expect(new Set(feedCalls.map((c) => c.seed)).size).toBe(1);
    const before = feedCalls.length;

    await act(async () => { await result.current.refresh(); });
    await loaded(result, 1);

    const after = feedCalls.slice(before);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ exclude: [], newest: 3 });
    expect(after[0].seed).not.toBe(oldSeed);
    expect(result.current.q.data?.pageParams).toEqual([0]);

    // and the next page of the new session continues from it, duplicate-free
    await next(result);
    await loaded(result, 2);
    const last = feedCalls[feedCalls.length - 1];
    expect(last.seed).toBe(after[0].seed);
    expect(last.exclude).toEqual(pagesOf(result)[0].posts.map((p) => p.id));
    expect(new Set(idsOf(result)).size).toBe(20);
  });

  it("a refresh that FAILS changes nothing: the next page still belongs to the session on screen", async () => {
    const { result } = mount();
    await loaded(result, 1);
    const seed = feedCalls[0].seed;
    const onScreen = pagesOf(result)[0].posts.map((p) => p.id);

    // the RPC and the chronological fallback both fail, through all three retries
    rpc = () => ({ status: 500, body: { code: "XX000", message: "boom" } });
    fallback = () => ({ status: 500, body: { code: "XX000", message: "boom" } });
    vi.useFakeTimers();
    let dealt: boolean | undefined;
    await act(async () => {
      const p = result.current.refresh().then((v) => { dealt = v; });
      await vi.advanceTimersByTimeAsync(20_000);
      await p;
    });
    vi.useRealTimers();
    expect(dealt).toBe(false);
    expect(result.current.q.isError).toBe(true);
    expect(pagesOf(result)[0].posts.map((p) => p.id)).toEqual(onScreen); // the posts stay

    rpc = (body) => ({ status: 200, body: deal(body) });
    await next(result);
    await waitFor(() => expect(pagesOf(result)).toHaveLength(2));
    const last = feedCalls[feedCalls.length - 1];
    expect(last.seed).toBe(seed);          // not the seed of the refresh that never arrived
    expect(last.exclude).toEqual(onScreen); // not an empty list that would repeat what is on screen
  });

  it("a refresh that FAILS with several pages loaded puts every page back — a weak signal must not cost the member their posts", async () => {
    const { result } = mount();
    await loaded(result, 1);
    await next(result);
    await loaded(result, 2);
    await next(result);
    await loaded(result, 3);
    const seed = feedCalls[0].seed;
    const onScreen = idsOf(result);
    expect(onScreen).toHaveLength(30);

    rpc = () => ({ status: 500, body: { code: "XX000", message: "boom" } });
    fallback = () => ({ status: 500, body: { code: "XX000", message: "boom" } });
    vi.useFakeTimers();
    let dealt: boolean | undefined;
    await act(async () => {
      const p = result.current.refresh().then((v) => { dealt = v; });
      await vi.advanceTimersByTimeAsync(20_000);
      await p;
    });
    vi.useRealTimers();
    expect(dealt).toBe(false);
    expect(idsOf(result)).toEqual(onScreen);                       // all three pages, in order
    expect(result.current.q.data?.pageParams).toEqual([0, 1, 2]);

    rpc = (body) => ({ status: 200, body: deal(body) });
    await next(result);
    await waitFor(() => expect(pagesOf(result)).toHaveLength(4));
    const last = feedCalls[feedCalls.length - 1];
    expect(last.seed).toBe(seed);
    expect(last.exclude).toEqual(onScreen);
    expect(new Set(idsOf(result)).size).toBe(40);
  });

  it("with no network a refresh does not start: it says so at once and leaves every page alone", async () => {
    const { result } = mount();
    await loaded(result, 1);
    await next(result);
    await loaded(result, 2);
    const onScreen = idsOf(result);
    const before = feedCalls.length;

    onlineManager.setOnline(false);
    let dealt: boolean | undefined;
    await act(async () => { dealt = await result.current.refresh(); });

    expect(dealt).toBe(false);
    expect(feedCalls.length).toBe(before);
    expect(idsOf(result)).toEqual(onScreen);
  });
});

describe("the database does not have the 5-argument function yet (bundle before migration)", () => {
  it("falls back to the 4-argument call, says so once (DB-3007), and does not ask again", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    rpc = (body) => "_session_seed" in body
      ? { status: 404, body: { code: "PGRST202", message: "Could not find the function public.get_broadcast_feed(_categories, _exclude_ids, _limit, _newest_first, _session_seed) in the schema cache" } }
      : { status: 200, body: deal(body) };
    const { result } = mount();
    await loaded(result, 1);
    await next(result);
    await loaded(result, 2);

    expect(feedCalls.map((c) => c.hasSeedArg)).toEqual([true, false, false]);
    expect(idsOf(result)).toHaveLength(20);
    expect(pagesOf(result).every((p) => p.degraded === false)).toBe(true);
    const codes = warn.mock.calls.map((c) => (c[0] as { code?: string }).code);
    expect(codes.filter((c) => c === "DB-3007")).toHaveLength(1);
  });
});

describe("honest errors", () => {
  it("a page served by the DB-3004 chronological fallback is flagged, so the screen can say it is stale", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    rpc = () => ({ status: 500, body: { code: "XX000", message: "function raised" } });
    const { result } = mount();
    await loaded(result, 1);
    expect(pagesOf(result)[0].degraded).toBe(true);
    expect(pagesOf(result)[0].posts).toHaveLength(10);
  });
});

describe("nothing re-deals the feed behind the member's back", () => {
  it("refetchOnlyAfterFailure: a feed on screen is left alone; a failed one is retried", () => {
    expect(refetchOnlyAfterFailure({ state: { status: "success" } })).toBe(false);
    expect(refetchOnlyAfterFailure({ state: { status: "pending" } })).toBe(false);
    expect(refetchOnlyAfterFailure({ state: { status: "error" } })).toBe(true);
  });

  it("the window regaining focus, or the network coming back, does NOT ask for a new deal", async () => {
    const { result } = mount();
    await loaded(result, 1);
    const before = feedCalls.length;
    const onScreen = idsOf(result);

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(feedCalls.length).toBe(before);
    expect(idsOf(result)).toEqual(onScreen);
  });
});
