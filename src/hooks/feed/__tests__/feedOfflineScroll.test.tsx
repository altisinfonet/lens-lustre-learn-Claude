/**
 * S7b-3 · WITH NO NETWORK THE FEED SCROLLS THROUGH THE SAVED POSTS.
 *
 * Owner 2026-10-29: "Instagram with no network … user can see like normally …
 * better than Instagram". Before S7b-3 the feed query paused offline (React
 * Query's default network mode) and only the first saved page existed, so a
 * member in flight mode saw one screen and a spinner.
 *
 * Runs the REAL useFeedQuery with React Query offline: no request is made.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { memoryBackend, setBackend } from "@/lib/offline/deviceStore";
import { recordFeedPage, resetFeedArchiveMemory } from "@/lib/offline/feedArchive";
import { useFeedQuery, waitForNetwork } from "@/hooks/feed/useFeedQuery";

const ME = "00000000-0000-4000-8000-0000000000aa";
const post = (id: string) => ({ id, user_id: "u1", content: `saved ${id}` });

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const W = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return W;
}

beforeEach(async () => {
  localStorage.clear();
  resetFeedArchiveMemory();
  setBackend(memoryBackend());
  // 25 posts seen online earlier: pages of 10, 10, 5.
  for (let p = 0; p < 3; p++) {
    const n = p < 2 ? 10 : 5;
    await recordFeedPage(ME, p, Array.from({ length: n }, (_, i) => post(`s${p}-${i}`)), { warm: false, saveDelayMs: 0 });
  }
  onlineManager.setOnline(false);
});
afterEach(() => { onlineManager.setOnline(true); });

describe("S7b-3 · offline feed scroll", () => {
  it("opens on the saved posts and scrolls to the end of them, with no request", async () => {
    const { result } = renderHook(() => useFeedQuery(ME), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.pages?.[0]?.offline).toBe(true));
    expect(result.current.data!.pages[0].posts.map((p) => p.id)[0]).toBe("s0-0");
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => { await result.current.fetchNextPage(); });
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(3));
    expect(result.current.data!.pages[2].posts).toHaveLength(5);
    expect(result.current.hasNextPage).toBe(false);
    const all = result.current.data!.pages.flatMap((p) => p.posts.map((x) => x.id));
    expect(new Set(all).size).toBe(25);
  });

  it("review #548: when the network comes back mid-scroll, the rest of that session still comes from the phone (no wrong cursor)", async () => {
    const { result } = renderHook(() => useFeedQuery(ME), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.pages?.[0]?.offline).toBe(true));
    onlineManager.setOnline(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(result.current.data!.pages[1].offline).toBe(true);
    expect(result.current.data!.pages[1].posts[0].id).toBe("s1-0");
    // no feed request was made for that page
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes("/rpc/"))).toEqual([]);
    fetchSpy.mockRestore();
  });

  it("with nothing saved for a page it waits for the network (no request), then goes on", async () => {
    let done = false;
    const p = waitForNetwork().then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);
    onlineManager.setOnline(true);
    await p;
    expect(done).toBe(true);
  });

  it("stops waiting when the page is cancelled", async () => {
    const ac = new AbortController();
    const p = waitForNetwork(ac.signal);
    ac.abort();
    await expect(p).rejects.toBeTruthy();
  });
});
