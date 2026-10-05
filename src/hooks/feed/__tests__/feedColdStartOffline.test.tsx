/**
 * F-D3-13 · A COLD START OFFLINE SHOWS THE SAVED FEED, HOWEVER OLD IT IS.
 *
 * OFF-5 rule G2 (docs/evidence/d2/phase5/OFF-5/DECISION.md): "Saved first, then
 * fresh … Age is a LABEL ('Saved 2 h ago'), never a reason to hide what is
 * saved. The current 30-minute expiry in src/lib/feedCache.ts is removed."
 *
 * `feedCache` is the feed's first paint: `useFeedQuery` builds its
 * `placeholderData` from it synchronously, before OFF-1's device store has
 * hydrated anything, and it is the ONLY saved feed when that store is not
 * available (IndexedDB blocked or evicted — `deviceStore` then degrades to
 * nothing, by design). It used to delete itself 30 minutes after it was
 * written, so a member who opened the app on a train an hour later, with no
 * signal, got the error card instead of the posts already on their phone.
 *
 * These tests run the REAL `useFeedQuery` with React Query offline (so no
 * request is made at all) and fail on the 30-minute implementation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { persistFeedPage, getCachedFeed } from "@/lib/feedCache";
import { useFeedQuery } from "@/hooks/feed/useFeedQuery";

const ME = "00000000-0000-4000-8000-0000000000aa";
const posts = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}`, content: `saved post ${i}` }));
const T0 = new Date("2026-10-05T06:00:00Z").getTime();
const MIN = 60_000;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
  onlineManager.setOnline(true);
});

describe("F-D3-13 · feedCache keeps what it saved (OFF-5 G2)", () => {
  it.each([31, 3 * 60, 3 * 24 * 60])("still returns the saved first page %i minutes later", (mins) => {
    persistFeedPage(posts, ["u1"], ME);
    vi.setSystemTime(T0 + mins * MIN);
    const got = getCachedFeed(ME);
    expect(got?.posts).toHaveLength(10);
    expect(localStorage.getItem("feed_cache_v1")).not.toBeNull();
  });

  it("hands back WHEN it was saved, so the screen can label the age instead of hiding it", () => {
    persistFeedPage(posts, [], ME);
    vi.setSystemTime(T0 + 2 * 60 * MIN);
    expect(getCachedFeed(ME)?.savedAt).toBe(T0);
  });

  it("is still never shown to a different member (G6 is not relaxed)", () => {
    persistFeedPage(posts, [], ME);
    expect(getCachedFeed("someone-else")).toBeNull();
    expect(localStorage.getItem("feed_cache_v1")).toBeNull();
  });

  it("an unreadable record is treated as nothing saved, never thrown", () => {
    localStorage.setItem("feed_cache_v1", "{not json");
    expect(getCachedFeed(ME)).toBeNull();
  });
});

describe("F-D3-13 · the real feed hook, cold start, no network", () => {
  // 10 min is the CONTROL: it passed on the 30-minute implementation too, which
  // proves this harness can see the saved feed at all. 3 h is the finding.
  it.each([10, 3 * 60])("shows the 10 saved posts from a cache saved %i minutes earlier, and makes no request", (mins) => {
    persistFeedPage(posts, [], ME);
    vi.setSystemTime(T0 + mins * MIN);
    onlineManager.setOnline(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useFeedQuery(ME), { wrapper });

    expect(result.current.data?.pages[0].posts.map((p) => p.id)).toEqual(posts.map((p) => p.id));
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.fetchStatus).toBe("paused");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
