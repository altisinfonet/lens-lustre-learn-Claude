/**
 * S6-a · THE FEED PAGES BY CURSOR (get_feed_page, 20261029_0500).
 *
 * The REAL `useFeedQuery` and the real supabase-js client against a fake
 * PostgREST that keeps a per-session delivery log, as the database does:
 *   * every page is ONE get_feed_page call carrying `_after` (the rows the
 *     session already holds) and the session seed — never `_exclude_ids`;
 *     twelve pages in, nothing has repeated;
 *   * personal switch On: `_personal: true`; a personal page that fails is
 *     served by the broadcast cursor call with the SAME `_after` (one log);
 *   * a lane without get_feed_page (PGRST202): the old get_broadcast_feed call
 *     with `_exclude_ids`, and get_feed_page is not asked again.
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
const POOL = Array.from({ length: 150 }, (_, i) => ({
  id: uuid(i), user_id: author(i % 7), content: `post ${i}`, image_url: null, image_urls: [], privacy: "public",
  created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), likes_count: 0, comments_count: 0, shares_count: 0,
  feed_tier: "unseen", author_name: `Author ${i % 7}`, author_avatar: null, thumbnail_urls: null, categories: [],
}));

interface Call { fn: string; body: Record<string, unknown> }
let calls: Call[];
let flag: boolean;
let personalFails: boolean;
let cursorMissing: boolean;
/** the server's delivery log: session key → ids in delivery order */
let log: Map<string, string[]>;
let dealt: string[];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function pageByCursor(body: Record<string, unknown>) {
  const key = `${body._tab}|${body._session_seed}`;
  const after = Number(body._after);
  const held = (log.get(key) ?? []).slice(0, after); // a retry re-deals: forget what came after
  const rows = POOL.filter((p) => !held.includes(p.id)).slice(0, Number(body._limit));
  log.set(key, [...held, ...rows.map((r) => r.id)]);
  dealt.push(...rows.map((r) => r.id));
  return rows.map((p, i) => ({ ...p, source: body._personal ? "circle" : null, caught_up_after: false, feed_pos: after + i + 1 }));
}

let qc: QueryClient;
beforeEach(() => {
  localStorage.clear();
  clearFeedSessions();
  __resetSessionSeedRpcProbe();
  calls = [];
  flag = false;
  personalFails = false;
  cursorMissing = false;
  log = new Map();
  dealt = [];
  h.fetchImpl = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/);
    if (m) {
      calls.push({ fn: m[1], body });
      if (m[1] === "feature_allowed_me") return json(200, body._feature === "personal_feed" ? flag : false);
      if (m[1] === "get_feed_page") {
        if (cursorMissing) return json(404, { code: "PGRST202", message: "Could not find the function public.get_feed_page" });
        if (body._personal && personalFails) return json(500, { code: "57014", message: "canceling statement due to statement timeout" });
        return json(200, pageByCursor(body));
      }
      if (m[1] === "get_broadcast_feed") {
        const exclude = new Set((body._exclude_ids as string[] | null) ?? []);
        return json(200, POOL.filter((p) => !exclude.has(p.id)).slice(0, Number(body._limit)));
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
async function settled(r: ReturnType<typeof mount>["result"]) {
  await waitFor(() => { expect(r.current.isSuccess).toBe(true); expect(r.current.isPlaceholderData).toBe(false); expect(r.current.isFetching).toBe(false); });
}
const feedCalls = () => calls.filter((c) => /^get_(feed_page|broadcast_feed|personal_feed)$/.test(c.fn));

describe("S6-a feed paging by cursor", () => {
  it("twelve pages: one get_feed_page per page, `_after` only (no _exclude_ids), one seed, no post twice", async () => {
    const { result } = mount();
    await settled(result);
    for (let i = 1; i < 12; i++) {
      await act(async () => { await result.current.fetchNextPage(); });
      await settled(result);
    }
    const fc = feedCalls();
    expect(fc.map((c) => c.fn)).toEqual(Array(12).fill("get_feed_page"));
    expect(fc.map((c) => c.body._after)).toEqual(Array.from({ length: 12 }, (_, i) => i * 10));
    for (const c of fc) {
      expect(c.body).not.toHaveProperty("_exclude_ids");
      expect(c.body).toMatchObject({ _tab: "for_you", _personal: false, _limit: 10, _categories: null });
      expect(c.body._session_seed).toBe(fc[0].body._session_seed);
    }
    expect(fc[0].body._newest_first).toBe(3);
    expect(fc[1].body._newest_first).toBe(0);
    expect(new Set(dealt).size).toBe(dealt.length);
    expect(dealt).toHaveLength(120);
  });

  it("personal switch On: `_personal: true`; a failing personal page is served by the broadcast cursor call at the same `_after`", async () => {
    flag = true;
    const { result } = mount();
    await settled(result);
    personalFails = true;
    await act(async () => { await result.current.fetchNextPage(); });
    await settled(result);
    const fc = feedCalls();
    expect(fc.map((c) => [c.fn, c.body._personal, c.body._after])).toEqual([
      ["get_feed_page", true, 0],
      ["get_feed_page", true, 10],
      ["get_feed_page", false, 10],
    ]);
    expect(new Set(dealt).size).toBe(dealt.length);
  });

  it("a lane without get_feed_page: the old _exclude_ids call, and get_feed_page is not asked again", async () => {
    cursorMissing = true;
    const { result } = mount();
    await settled(result);
    await act(async () => { await result.current.fetchNextPage(); });
    await settled(result);
    const fc = feedCalls();
    expect(fc.map((c) => c.fn)).toEqual(["get_feed_page", "get_broadcast_feed", "get_broadcast_feed"]);
    expect((fc[2].body._exclude_ids as string[]).length).toBe(10);
  });
});
