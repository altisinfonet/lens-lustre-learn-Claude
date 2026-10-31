/**
 * S12-F3 · THE PERSONAL-FEED SWITCH (Admin → Feed → Personal Feed, VID-7 modes).
 *
 * The REAL `useFeedQuery` and the real supabase-js client against a fake
 * PostgREST that records every request:
 *   * switch Off (feature_allowed_me → false): get_broadcast_feed, exactly as
 *     before — get_personal_feed is never called;
 *   * switch On: get_personal_feed with the SAME arguments (exclude list in
 *     delivery order, page size, newest-first, categories, session seed) for
 *     every page of the session, server order kept, `source` and
 *     `caught_up_after` carried onto the posts;
 *   * get_personal_feed failing (e.g. a lane without 20261018_0003) falls back
 *     to get_broadcast_feed for that page — the member still gets a feed.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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

const { useFeedQuery, __resetSessionSeedRpcProbe } = await import("@/hooks/feed/useFeedQuery");
const { clearFeedSessions } = await import("@/lib/feedSessions");

const ME = "00000000-0000-4000-8000-0000000000aa";
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const author = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POOL = Array.from({ length: 40 }, (_, i) => ({
  id: uuid(i), user_id: author(i % 5), content: `post ${i}`, image_url: null, image_urls: [], privacy: "public",
  created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), likes_count: 0, comments_count: 0, shares_count: 0,
  feed_tier: "unseen", author_name: `Author ${i % 5}`, author_avatar: null, thumbnail_urls: null, categories: [],
}));

interface Call { fn: string; body: Record<string, unknown> }
let calls: Call[];
let flag: boolean;
let personalFails: boolean;

function deal(body: Record<string, unknown>) {
  const exclude = new Set((body._exclude_ids as string[] | null) ?? []);
  return POOL.filter((p) => !exclude.has(p.id)).slice(0, Number(body._limit));
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let qc: QueryClient;
beforeEach(() => {
  localStorage.clear();
  clearFeedSessions();
  __resetSessionSeedRpcProbe({ cursor: false }); // S6-a: these pin the _exclude_ids calls (feedPageCursor.test.tsx pins the cursor)
  calls = [];
  flag = false;
  personalFails = false;
  h.fetchImpl = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/);
    if (m) {
      calls.push({ fn: m[1], body });
      if (m[1] === "feature_allowed_me") return json(200, body._feature === "personal_feed" ? flag : false);
      if (m[1] === "get_broadcast_feed") return json(200, deal(body));
      if (m[1] === "get_personal_feed") {
        if (personalFails) return json(404, { code: "PGRST202", message: "Could not find the function public.get_personal_feed" });
        // a page in server order; the 2nd row closes the circle ("caught up")
        return json(200, deal(body).map((p, i) => ({ ...p, source: i % 5 === 3 ? "suggested" : i % 5 === 4 ? "fair" : "circle", caught_up_after: i === 1 })));
      }
    }
    if (url.pathname === "/rest/v1/posts" && url.searchParams.get("select") === "created_at") return json(200, [{ created_at: POOL[0].created_at }]);
    return json(200, []);
  };
  qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
});
afterEach(() => {
  vi.restoreAllMocks();
  qc.clear();
});

function mount() {
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => useFeedQuery(ME), { wrapper });
}
async function loaded(r: ReturnType<typeof mount>["result"], pages: number) {
  await waitFor(() => { expect(r.current.isSuccess).toBe(true); expect(r.current.isPlaceholderData).toBe(false); expect(r.current.data?.pages ?? []).toHaveLength(pages); expect(r.current.isFetching).toBe(false); });
}
const feedCalls = () => calls.filter((c) => c.fn === "get_broadcast_feed" || c.fn === "get_personal_feed");

describe("S12-F3 personal feed switch", () => {
  it("switch Off: the feed calls get_broadcast_feed and never get_personal_feed", async () => {
    const { result } = mount();
    await loaded(result, 1);
    await act(async () => { await result.current.fetchNextPage(); });
    await loaded(result, 2);
    expect(feedCalls().map((c) => c.fn)).toEqual(["get_broadcast_feed", "get_broadcast_feed"]);
  });

  it("switch On: every page of the session calls get_personal_feed with the same contract, server order and marker kept", async () => {
    flag = true;
    const { result } = mount();
    await loaded(result, 1);
    await act(async () => { await result.current.fetchNextPage(); });
    await loaded(result, 2);
    const fc = feedCalls();
    expect(fc.map((c) => c.fn)).toEqual(["get_personal_feed", "get_personal_feed"]);
    expect(fc[0].body).toMatchObject({ _exclude_ids: [], _limit: 10, _newest_first: 3, _categories: null });
    expect(typeof fc[0].body._session_seed).toBe("string");
    expect(fc[1].body._session_seed).toBe(fc[0].body._session_seed);
    const page0 = result.current.data!.pages[0].posts;
    // server order kept (authors 0,1,2,… — no client re-shuffle), marker on the 2nd row
    expect(page0.map((p) => p.id)).toEqual(POOL.slice(0, 10).map((p) => p.id));
    expect(page0.map((p) => p.caught_up_after)).toEqual([false, true, false, false, false, false, false, false, false, false]);
    expect(page0[3].feed_source).toBe("suggested");
    expect(fc[1].body._exclude_ids).toEqual(page0.map((p) => p.id));
  });

  it("switch On but get_personal_feed is missing: that page falls back to get_broadcast_feed", async () => {
    flag = true;
    personalFails = true;
    const { result } = mount();
    await loaded(result, 1);
    expect(feedCalls().map((c) => c.fn)).toEqual(["get_personal_feed", "get_broadcast_feed"]);
    expect(result.current.data!.pages[0].posts).toHaveLength(10);
  });
});
