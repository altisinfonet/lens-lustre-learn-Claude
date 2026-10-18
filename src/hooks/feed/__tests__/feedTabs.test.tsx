/**
 * S12-F5 · THE FEED TABS — For you · Following · Favourites.
 *
 *   * switch personal_feed Off → no tabs, and the feed is For you whatever was
 *     remembered (members see no change until the rollout reaches them);
 *   * switch On → three tabs; choosing one is remembered across a remount
 *     (Back remounts the feed);
 *   * the REAL useFeedQuery on the Following / Favourites tab calls
 *     get_following_feed / get_favourites_feed with get_personal_feed's
 *     contract, keeps the server's time order (no client reshuffle) and keeps
 *     its own cache entry, apart from For you's.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  allowed: false,
  fetchImpl: null as null | ((i: RequestInfo | URL, init?: RequestInit) => Promise<Response>),
}));

vi.mock("@/hooks/core/useFeatureAllowed", async (orig) => ({
  ...(await orig<typeof import("@/hooks/core/useFeatureAllowed")>()),
  useFeatureAllowed: () => h.allowed,
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

const { default: FeedTabs, useFeedTab, FEED_TAB_STORAGE_KEY } = await import("@/components/feed/FeedTabs");
const { useFeedQuery } = await import("@/hooks/feed/useFeedQuery");
const { clearFeedSessions } = await import("@/lib/feedSessions");
const { queryKeys } = await import("@/lib/queryKeys");

const ME = "00000000-0000-4000-8000-0000000000aa";
const AUTHOR = "20000000-0000-4000-8000-000000000001";
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Newest first, ONE author: a client "no back-to-back" reshuffle would reorder these.
const ROWS = Array.from({ length: 10 }, (_, i) => ({
  id: uuid(i), user_id: AUTHOR, content: `post ${i}`, image_url: null, image_urls: [], privacy: "public",
  created_at: new Date(Date.UTC(2026, 9, 18, 12, 59 - i)).toISOString(), likes_count: 0, comments_count: 0, shares_count: 0,
  feed_tier: "chronological", author_name: "Followed One", author_avatar: null, thumbnail_urls: null, categories: [],
  source: "following", caught_up_after: false,
}));

function Harness() {
  const { tab, setTab, showTabs } = useFeedTab();
  return (
    <div>
      {showTabs && <FeedTabs value={tab} onChange={setTab} />}
      <span data-testid="current-tab">{tab}</span>
    </div>
  );
}

interface Call { fn: string; body: Record<string, unknown> }
let calls: Call[];
const FEED_FNS = new Set(["get_following_feed", "get_favourites_feed", "get_broadcast_feed", "get_personal_feed"]);
const feedCalls = () => calls.filter((c) => FEED_FNS.has(c.fn));
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let qc: QueryClient;
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  clearFeedSessions();
  h.allowed = false;
  calls = [];
  h.fetchImpl = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/);
    if (m) {
      calls.push({ fn: m[1], body });
      if (m[1] === "get_following_feed" || m[1] === "get_favourites_feed") return json(200, ROWS.map((r) => ({ ...r, source: m[1] === "get_following_feed" ? "following" : "favourites" })));
      if (m[1] === "feature_allowed_me") return json(200, false);
      if (m[1] === "get_broadcast_feed") return json(200, []);
    }
    return json(200, []);
  };
  qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
});
afterEach(() => {
  vi.restoreAllMocks();
  qc.clear();
});

describe("S12-F5 feed tabs — visibility follows the personal_feed switch", () => {
  it("switch Off: no tabs, and For you even if Following was remembered", () => {
    sessionStorage.setItem(FEED_TAB_STORAGE_KEY, "following");
    render(<Harness />);
    expect(screen.queryByTestId("feed-tabs")).toBeNull();
    expect(screen.getByTestId("current-tab").textContent).toBe("for_you");
  });

  it("switch On: three tabs; choosing Following is remembered across a remount (Back)", () => {
    h.allowed = true;
    const first = render(<Harness />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["For you", "Following", "★ Favourites"]);
    expect(screen.getByTestId("feed-tab-for_you").getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByTestId("feed-tab-following"));
    expect(screen.getByTestId("current-tab").textContent).toBe("following");
    expect(screen.getByTestId("feed-tab-following").getAttribute("aria-selected")).toBe("true");
    first.unmount();
    render(<Harness />);
    expect(screen.getByTestId("current-tab").textContent).toBe("following");
    fireEvent.click(screen.getByTestId("feed-tab-favourites"));
    expect(screen.getByTestId("current-tab").textContent).toBe("favourites");
  });
});

describe("S12-F5 feed tabs — the Following / Favourites lists", () => {
  function mount(tab: "following" | "favourites") {
    const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: qc }, children);
    return renderHook(() => useFeedQuery(ME, null, "PUSH", tab), { wrapper });
  }

  it("Following calls get_following_feed with the personal feed's contract and keeps time order", async () => {
    const { result } = mount("following");
    await waitFor(() => { expect(result.current.isSuccess).toBe(true); expect(result.current.isFetching).toBe(false); });
    const fc = feedCalls();
    expect(fc.map((c) => c.fn)).toEqual(["get_following_feed"]);
    expect(fc[0].body).toMatchObject({ _exclude_ids: [], _limit: 10, _newest_first: 0, _categories: null, _session_seed: null });
    // never asks the switch / the ranked feed for this tab
    expect(calls.some((c) => c.fn === "get_broadcast_feed" || c.fn === "get_personal_feed")).toBe(false);
    const posts = result.current.data!.pages[0].posts;
    expect(posts.map((p) => p.id)).toEqual(ROWS.map((r) => r.id));
    // its own cache entry, apart from For you's
    expect(qc.getQueryData(queryKeys.feed(null, "following"))).toBeTruthy();
    expect(qc.getQueryData(queryKeys.feed(null))).toBeUndefined();
    // page 2 excludes page 1 (same paging contract)
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(calls.filter((c) => c.fn === "get_following_feed")).toHaveLength(2));
    expect(calls.filter((c) => c.fn === "get_following_feed")[1].body._exclude_ids).toEqual(ROWS.map((r) => r.id));
  });

  it("Favourites calls get_favourites_feed", async () => {
    const { result } = mount("favourites");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(feedCalls().map((c) => c.fn)).toEqual(["get_favourites_feed"]);
    expect(qc.getQueryData(queryKeys.feed(null, "favourites"))).toBeTruthy();
  });
});
