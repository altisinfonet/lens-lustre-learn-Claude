/**
 * STAGE L2 (F-REV4-8, cause 1) — "SEEN" IS RECORDED, AT THE THRESHOLD AND NOT
 * BELOW IT, ONCE PER SESSION, AND NOTHING IS LOST ON THE WAY OUT.
 *
 * The engine (SeenTracker) is driven with a fake clock; the hook is driven with
 * real DOM events and a fake Capacitor App plugin. The sender is a spy standing
 * in for the OFF-2 outbox (outboxFeedEvents.test.ts covers the outbox itself).
 */
import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  SeenTracker, useFeedEventTracker, VIEW_DWELL_MS, VIEW_VISIBLE_RATIO, VIEW_VIEWPORT_SHARE, MAX_BATCH, FLUSH_INTERVAL_MS,
  type SubmitEvents,
} from "@/hooks/feed/useFeedEventTracker";
import { isVisibleEnough } from "@/hooks/feed/usePostSeenObserver";
import type { FeedEventPayload } from "@/lib/offline/outbox";

const ME = "00000000-0000-4000-8000-0000000000aa";
const AUTHOR = "00000000-0000-4000-8000-0000000000bb";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let sent: { userId: string; events: FeedEventPayload[] }[];
const send: SubmitEvents = async (userId, events) => { sent.push({ userId, events }); };
const all = () => sent.flatMap((s) => s.events);

beforeEach(() => { sent = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("the threshold: ≥ 50 % visible for 1 continuous second", () => {
  it("the constants are the approved ones (named, configurable)", () => {
    expect(VIEW_VISIBLE_RATIO).toBe(0.5);
    expect(VIEW_VIEWPORT_SHARE).toBe(0.5);
    expect(VIEW_DWELL_MS).toBe(1000);
  });

  it("records a view at 1 s and not at 999 ms", async () => {
    const t = new SeenTracker({ userId: ME, send });
    t.report("p1", AUTHOR, true);
    vi.advanceTimersByTime(999);
    expect(t.unsent).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(t.unsent).toHaveLength(1);
    expect(t.unsent[0]).toMatchObject({ post_id: "p1", author_id: AUTHOR, event_type: "view", dwell_ms: 1000 });
    expect(t.unsent[0].id).toMatch(UUID);
  });

  it("the second must be continuous: 600 ms, away, 600 ms is not a view", () => {
    const t = new SeenTracker({ userId: ME, send });
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(600);
    t.report("p1", AUTHOR, false); vi.advanceTimersByTime(5000);
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(600);
    expect(t.unsent).toHaveLength(0);
    vi.advanceTimersByTime(400);
    expect(t.unsent).toHaveLength(1);
  });

  it("isVisibleEnough: 49 % is not, 50 % is; a tall card filling half the screen is", () => {
    const vh = 800;
    const e = (ratio: number, rectH: number) => ({ isIntersecting: ratio > 0, intersectionRatio: ratio, intersectionRect: { height: rectH } as DOMRectReadOnly, rootBounds: null });
    expect(isVisibleEnough(e(0.49, 300), vh)).toBe(false);
    expect(isVisibleEnough(e(0.5, 300), vh)).toBe(true);
    // a 2,000 px card: only 30 % of it fits, but it fills 75 % of the viewport
    expect(isVisibleEnough(e(0.3, 600), vh)).toBe(true);
    expect(isVisibleEnough(e(0.3, 399), vh)).toBe(false);
    expect(isVisibleEnough({ ...e(0.9, 700), isIntersecting: false }, vh)).toBe(false);
  });

  it("a hidden tab or backgrounded app stops the clock; returning restarts the full second", () => {
    const t = new SeenTracker({ userId: ME, send });
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(900);
    t.pause(); vi.advanceTimersByTime(10_000);
    expect(t.unsent).toHaveLength(0);
    t.resume(); vi.advanceTimersByTime(999);
    expect(t.unsent).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(t.unsent).toHaveLength(1);
  });

  it("the member's own posts are never recorded as seen (R-LIVE-5 would unpin their fresh post)", () => {
    const t = new SeenTracker({ userId: ME, send });
    t.report("mine", ME, true); vi.advanceTimersByTime(5000);
    expect(t.unsent).toHaveLength(0);
  });

  it("nor is an action on the member's own post — the database refuses the row (self_like vs its own CHECK) and the whole batch with it", async () => {
    // Proved on production's function bodies in docs/evidence/d1/L2-feed-freshness
    // ("a like on the member's OWN post"). One own-post like would take every
    // view queued beside it down with it.
    const t = new SeenTracker({ userId: ME, send });
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(1000);
    t.action("mine", ME, "like");
    t.action("mine", ME, "share");
    t.action("p1", AUTHOR, "like"); // someone else's post: recorded as before
    expect(t.unsent.map((e) => `${e.post_id}:${e.event_type}`)).toEqual(["p1:view", "p1:like"]);
    await t.flush();
    expect(all().some((e) => e.post_id === "mine")).toBe(false);
  });
});

describe("dedupe: one view per post per feed session", () => {
  it("seen once, scrolled away and back: still one event", () => {
    const t = new SeenTracker({ userId: ME, send });
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(1000);
    t.report("p1", AUTHOR, false);
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(3000);
    expect(t.unsent.filter((e) => e.event_type === "view")).toHaveLength(1);
  });

  it("a refresh is a new session: the same post can be recorded again (moves a recycled post back)", () => {
    const t = new SeenTracker({ userId: ME, send });
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(1000);
    t.newSession();
    vi.advanceTimersByTime(1000); // still on screen after the refresh
    expect(t.unsent.filter((e) => e.post_id === "p1")).toHaveLength(2);
    expect(new Set(t.unsent.map((e) => e.id)).size).toBe(2);
  });
});

describe("flush: batches go to the outbox, nothing is dropped", () => {
  it("flush hands every event over, in batches of at most MAX_BATCH, and empties the batch", async () => {
    const t = new SeenTracker({ userId: ME, send });
    for (let i = 0; i < MAX_BATCH + 5; i++) { t.report(`p${i}`, AUTHOR, true); }
    vi.advanceTimersByTime(1000);
    await t.flush();
    expect(sent.every((s) => s.events.length <= MAX_BATCH && s.userId === ME)).toBe(true);
    expect(all()).toHaveLength(MAX_BATCH + 5);
    expect(t.unsent).toHaveLength(0);
  });

  it("a failing sender never throws into the feed", async () => {
    const t = new SeenTracker({ userId: ME, send: async () => { throw new Error("offline"); } });
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(1000);
    await expect(t.flush()).resolves.toBeUndefined();
  });
});

describe("the hook flushes on every way out", () => {
  function mount() {
    const { result, unmount } = renderHook(() => useFeedEventTracker(ME, send));
    act(() => { result.current.reportVisibility("p1", AUTHOR, true); });
    act(() => { vi.advanceTimersByTime(VIEW_DWELL_MS); });
    return { result, unmount };
  }
  const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

  it("tab hidden (visibilitychange)", async () => {
    mount();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    expect(all().map((e) => e.post_id)).toEqual(["p1"]);
  });

  it("pagehide", async () => {
    mount();
    window.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(all()).toHaveLength(1);
  });

  it("Capacitor App 'pause' and appStateChange { isActive: false }", async () => {
    const listeners: Record<string, ((s?: { isActive?: boolean }) => void)[]> = {};
    (globalThis as any).Capacitor = { Plugins: { App: { addListener: (ev: string, cb: any) => { (listeners[ev] ??= []).push(cb); return { remove: () => {} }; } } } };
    try {
      const { result } = mount();
      listeners.pause?.forEach((cb) => cb());
      await settle();
      expect(all()).toHaveLength(1);
      act(() => { result.current.reportVisibility("p2", AUTHOR, true); });
      listeners.resume?.forEach((cb) => cb());
      act(() => { vi.advanceTimersByTime(VIEW_DWELL_MS); });
      listeners.appStateChange?.forEach((cb) => cb({ isActive: false }));
      await settle();
      expect(all().map((e) => e.post_id)).toEqual(["p1", "p2"]);
    } finally {
      delete (globalThis as any).Capacitor;
    }
  });

  it("every FLUSH_INTERVAL_MS while visible", async () => {
    mount();
    act(() => { vi.advanceTimersByTime(FLUSH_INTERVAL_MS); });
    await settle();
    expect(all()).toHaveLength(1);
  });

  it("flushNow (called right before a refresh) and unmount", async () => {
    const { result, unmount } = mount();
    await act(async () => { await result.current.flushNow(); });
    expect(all()).toHaveLength(1);
    act(() => { result.current.reportVisibility("p2", AUTHOR, true); });
    act(() => { vi.advanceTimersByTime(VIEW_DWELL_MS); });
    unmount();
    await settle();
    expect(all().map((e) => e.post_id)).toEqual(["p1", "p2"]);
  });

  it("and on the way back in: 'resume' sends what was recorded while frozen, without waiting for the next interval", async () => {
    const listeners: Record<string, ((s?: { isActive?: boolean }) => void)[]> = {};
    (globalThis as any).Capacitor = { Plugins: { App: { addListener: (ev: string, cb: any) => { (listeners[ev] ??= []).push(cb); return { remove: () => {} }; } } } };
    try {
      const { result } = mount();
      listeners.pause?.forEach((cb) => cb());
      await settle();
      act(() => { result.current.trackAction("p9", AUTHOR, "like"); }); // recorded after the pause-flush
      expect(all().map((e) => e.post_id)).toEqual(["p1"]);
      listeners.resume?.forEach((cb) => cb());
      await settle();
      expect(all().map((e) => `${e.post_id}:${e.event_type}`)).toEqual(["p1:view", "p9:like"]);
    } finally {
      delete (globalThis as any).Capacitor;
    }
  });

  it("pageshow (a page restored from the back/forward cache) starts the clocks again", async () => {
    const { result } = mount();
    window.dispatchEvent(new Event("pagehide"));
    await settle();
    window.dispatchEvent(new Event("pageshow"));
    act(() => { result.current.reportVisibility("p2", AUTHOR, true); });
    act(() => { vi.advanceTimersByTime(VIEW_DWELL_MS); });
    await act(async () => { await result.current.flushNow(); });
    expect(all().map((e) => e.post_id)).toEqual(["p1", "p2"]);
  });

  it("a feed opened in a hidden tab records nothing until somebody is looking at it", async () => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    try {
      const { result } = renderHook(() => useFeedEventTracker(ME, send));
      act(() => { result.current.reportVisibility("p1", AUTHOR, true); });
      act(() => { vi.advanceTimersByTime(5 * VIEW_DWELL_MS); });
      await act(async () => { await result.current.flushNow(); });
      expect(all()).toHaveLength(0);
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
      act(() => { vi.advanceTimersByTime(VIEW_DWELL_MS - 1); });
      await act(async () => { await result.current.flushNow(); });
      expect(all()).toHaveLength(0);
      act(() => { vi.advanceTimersByTime(1); });
      await act(async () => { await result.current.flushNow(); });
      expect(all().map((e) => e.post_id)).toEqual(["p1"]);
    } finally {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    }
  });

  it("survives React StrictMode's run → clean up → run (the clean-up pauses the tracker; the second run must start it again)", async () => {
    const { result } = renderHook(() => useFeedEventTracker(ME, send), { wrapper: StrictMode });
    act(() => { result.current.reportVisibility("p1", AUTHOR, true); });
    act(() => { vi.advanceTimersByTime(VIEW_DWELL_MS); });
    await act(async () => { await result.current.flushNow(); });
    expect(all().map((e) => e.post_id)).toEqual(["p1"]);
  });

  it("flushNow never keeps a refresh waiting longer than its cap, even if the outbox never answers", async () => {
    const never: SubmitEvents = () => new Promise(() => {});
    const { result } = renderHook(() => useFeedEventTracker(ME, never));
    act(() => { result.current.reportVisibility("p1", AUTHOR, true); });
    act(() => { vi.advanceTimersByTime(VIEW_DWELL_MS); });
    let done = false;
    let p: Promise<void> | undefined;
    act(() => { p = result.current.flushNow(500).then(() => { done = true; }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(done).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); await p; });
    expect(done).toBe(true);
  });
});
