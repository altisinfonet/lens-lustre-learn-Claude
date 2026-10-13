/**
 * STAGE L2 — "N NEW POSTS": A LIGHT COUNT EVERY 60 SECONDS, A PILL THAT FLOATS,
 * AND A LIST THAT DOES NOT MOVE UNTIL THE MEMBER ASKS.
 *
 * The count (`useNewPostsCount`) runs against the real supabase-js client and a
 * fake PostgREST that records what was asked. The pill (`NewPostsPill`) is
 * rendered for real. jsdom lays nothing out, so "the list does not move" is
 * asserted here as STRUCTURE (the pill takes no place in the flow and sits in
 * the sticky strip, not above the first post) and measured as PIXELS in real
 * browsers by tools/uishot/feed-seen-harness.mjs.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, renderHook, act, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

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

const { useNewPostsCount, NEW_POSTS_POLL_MS, NEW_POSTS_CAP } = await import("@/hooks/feed/useNewPostsCount");
const { default: NewPostsPill } = await import("@/components/feed/NewPostsPill");

const ME = "00000000-0000-4000-8000-0000000000aa";
const WM = "2026-10-13T09:00:00.123456+00:00";
let asked: URLSearchParams[];
let newer: { id: string; user_id: string }[];

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  asked = [];
  newer = [];
  h.fetchImpl = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/rest/v1/posts") asked.push(url.searchParams);
    return new Response(JSON.stringify(newer), { status: 200, headers: { "content-type": "application/json" } });
  };
  vi.useFakeTimers();
});
afterEach(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  vi.useRealTimers();
});

const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe("the light count", () => {
  it("the cadence is the approved one: once a minute, at most 50 rows", () => {
    expect(NEW_POSTS_POLL_MS).toBe(60_000);
    expect(NEW_POSTS_CAP).toBe(50);
  });

  it("asks nothing for 59.9 s, then asks ONCE for what is newer than the session's watermark — ids and authors only, not the member's own, not private", async () => {
    newer = [{ id: "n1", user_id: "u1" }, { id: "n2", user_id: "u2" }];
    const { result } = renderHook(() => useNewPostsCount({ userId: ME, categories: null, watermark: WM, sessionKey: "s1" }));
    await tick(NEW_POSTS_POLL_MS - 100);
    expect(asked).toHaveLength(0);
    expect(result.current).toEqual([]);
    await tick(100);
    expect(asked).toHaveLength(1);
    const q = asked[0];
    expect(q.get("select")).toBe("id,user_id");
    expect(q.get("created_at")).toBe(`gt.${WM}`);
    expect(q.get("user_id")).toBe(`neq.${ME}`);
    expect(q.get("privacy")).toBe("neq.private");
    expect(q.get("limit")).toBe(String(NEW_POSTS_CAP));
    expect(result.current).toEqual(newer);
  });

  it("a category filter is carried into the count, so the pill counts what that feed would show", async () => {
    renderHook(() => useNewPostsCount({ userId: ME, categories: ["portrait"], watermark: WM, sessionKey: "s1" }));
    await tick(NEW_POSTS_POLL_MS);
    expect(asked[0].get("categories")).toBe("ov.{portrait}");
  });

  it("stops while the page is hidden (no request, however long), and checks once on the way back", async () => {
    renderHook(() => useNewPostsCount({ userId: ME, categories: null, watermark: WM, sessionKey: "s1" }));
    act(() => setHidden(true));
    await tick(10 * NEW_POSTS_POLL_MS);
    expect(asked).toHaveLength(0);
    act(() => setHidden(false));
    await tick(50);
    expect(asked).toHaveLength(1);
  });

  it("a refresh (new session) starts the count again from zero", async () => {
    newer = [{ id: "n1", user_id: "u1" }];
    const { result, rerender } = renderHook(
      (p: { key: string; wm: string }) => useNewPostsCount({ userId: ME, categories: null, watermark: p.wm, sessionKey: p.key }),
      { initialProps: { key: "s1", wm: WM } },
    );
    await tick(NEW_POSTS_POLL_MS);
    expect(result.current).toHaveLength(1);
    newer = [];
    rerender({ key: "s2", wm: "2026-10-13T09:05:00+00:00" });
    expect(result.current).toEqual([]);
    await tick(NEW_POSTS_POLL_MS);
    expect(asked[asked.length - 1].get("created_at")).toBe("gt.2026-10-13T09:05:00+00:00");
    expect(result.current).toEqual([]);
  });

  it("without a watermark (the read failed) there is no count and no request", async () => {
    const { result } = renderHook(() => useNewPostsCount({ userId: ME, categories: null, watermark: null, sessionKey: "s1" }));
    await tick(3 * NEW_POSTS_POLL_MS);
    expect(asked).toHaveLength(0);
    expect(result.current).toEqual([]);
  });

  it("a failed count shows nothing and tries again on the next tick", async () => {
    let fail = true;
    const inner = h.fetchImpl!;
    h.fetchImpl = async (i, init) => { if (fail) throw new TypeError("Failed to fetch"); return inner(i, init); };
    newer = [{ id: "n1", user_id: "u1" }];
    const { result } = renderHook(() => useNewPostsCount({ userId: ME, categories: null, watermark: WM, sessionKey: "s1" }));
    await tick(NEW_POSTS_POLL_MS);
    expect(result.current).toEqual([]);
    fail = false;
    await tick(NEW_POSTS_POLL_MS);
    expect(result.current).toEqual(newer);
  });
});

describe("the pill", () => {
  const label = (n: number) => (n === 1 ? "1 new post" : `${n} new posts`);

  it("shows nothing when there is nothing new", () => {
    const { container } = render(<NewPostsPill count={0} onClick={() => {}} label={label} />);
    expect(container.firstChild).toBeNull();
  });

  it("says how many, and a tap asks for them", () => {
    const onClick = vi.fn();
    render(<NewPostsPill count={3} onClick={onClick} label={label} />);
    const pill = screen.getByTestId("new-posts-pill");
    expect(pill.textContent).toBe("3 new posts");
    fireEvent.click(pill);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("FLOATS: its box is out of the flow, spans the strip, and lets taps through everywhere but the button", () => {
    render(
      <div data-testid="strip">
        <NewPostsPill count={1} onClick={() => {}} label={label} />
      </div>,
    );
    const anchor = screen.getByTestId("new-posts-pill-anchor");
    // inline, so no stylesheet order can put it back in the flow
    expect(anchor.style.position).toBe("absolute");
    expect(anchor.className).toMatch(/\bpointer-events-none\b/);
    expect(anchor.className).toMatch(/\btop-full\b/);
    const pill = screen.getByTestId("new-posts-pill");
    expect(pill.className).toMatch(/\bpointer-events-auto\b/);
    // a 44 px target, like every other floating control (tap-target gate)
    expect(pill.className).toMatch(/\bmin-h-11\b/);
    // centred by the flex row, never by a translate framer-motion would overwrite
    expect(pill.className).not.toMatch(/translate-x/);
  });
});

describe("where the feed puts it", () => {
  const feed = stripComments(readFileSync(join(process.cwd(), "src/pages/Feed.tsx"), "utf8")).replace(/\r\n/g, "\n");

  it("inside the sticky category strip — its containing block — and not in the list", () => {
    const strip = feed.indexOf('<div className="sticky top-0 z-20 -mx-4 mb-3">');
    const stories = feed.indexOf("<FeedStoriesBar />");
    const pill = feed.indexOf("<NewPostsPill");
    const list = feed.indexOf("{posts.map((post, i) => (");
    expect(strip).toBeGreaterThan(-1);
    expect(pill).toBeGreaterThan(strip);
    expect(pill).toBeLessThan(stories);
    expect(stories).toBeLessThan(list);
    expect(feed.match(/<NewPostsPill/g)).toHaveLength(1);
  });

  it("the in-flow banner that pushed every post down is gone", () => {
    expect(feed).not.toMatch(/bufferedCount/);
    expect(feed).not.toMatch(/new posts? available/);
  });

  it("the posts arrive only when the member asks: the pill and pull-to-refresh both go through handleRefresh", () => {
    expect(feed).toMatch(/const handleShowNewPosts = useCallback\(async \(\) => \{\s+window\.scrollTo\(\{ top: 0 \}\);\s+await handleRefresh\(\);/);
    expect(feed).toMatch(/onClick=\{\(\) => void handleShowNewPosts\(\)\}/);
    // nothing splices arriving posts into the list any more
    expect(feed).not.toMatch(/flushBuffer\(\)\.forEach|attachLive\(posts\)\)\.forEach/);
  });

  it("a blocked member's new post is not counted", () => {
    expect(feed).toMatch(/polledNew\.filter\(\(p\) => !blockedIds\.has\(p\.user_id\)\)/);
  });
});
