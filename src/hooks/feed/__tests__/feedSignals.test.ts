/**
 * S12-F1 · SIGNALS — time on post, fast skips, video watch %, share clicks and
 * profile visits are recorded ONCE, only for the member's own activity, only
 * while the page is on screen, and handed to the OFF-2 outbox in batches.
 *
 * The engine (SeenTracker, the one feed-telemetry engine — no second tracker)
 * is driven with fake timers; Date.now is faked with them, so the dwell
 * stopwatch is exact. outboxFeedSignals.test.ts covers the outbox half
 * (exactly once on the wire); PROBE_20261018_0001 covers privacy in the DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  SeenTracker, useFeedEventTracker, VIEW_DWELL_MS, MAX_BATCH, FLUSH_INTERVAL_MS,
  SKIP_MIN_MS, MAX_DWELL_EVENT_MS, type SubmitEvents, type SubmitSignals,
} from "@/hooks/feed/useFeedEventTracker";
import { recordProfileVisit, PROFILE_VISIT_DEDUPE_MS, __resetProfileVisits, playedStep, watchPercent } from "@/lib/feed/feedSignals";
import type { FeedSignalPayload } from "@/lib/offline/outbox";

const ME = "00000000-0000-4000-8000-0000000000aa";
const AUTHOR = "00000000-0000-4000-8000-0000000000bb";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let sentSignals: { userId: string; signals: FeedSignalPayload[] }[];
const send: SubmitEvents = async () => {};
const sendSignals: SubmitSignals = async (userId, signals) => { sentSignals.push({ userId, signals }); };
const all = () => sentSignals.flatMap((s) => s.signals);
const make = () => new SeenTracker({ userId: ME, send, sendSignals });

beforeEach(() => { sentSignals = []; vi.useFakeTimers(); __resetProfileVisits(); });
afterEach(() => { vi.useRealTimers(); });

describe("time on post (dwell)", () => {
  it("a card on screen for 3.2 s, then scrolled away, is ONE dwell signal of 3,200 ms", async () => {
    const t = make();
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(3200);
    t.report("p1", AUTHOR, false);
    await t.flush();
    expect(all()).toHaveLength(1);
    expect(all()[0]).toMatchObject({ kind: "dwell", post_id: "p1", subject_id: AUTHOR, value: 3200 });
    expect(all()[0].id).toMatch(UUID);
    expect(sentSignals[0].userId).toBe(ME);
  });

  it("a hidden tab stops the stopwatch: 2 s + (10 s hidden) + 1 s = 3,000 ms", async () => {
    const t = make();
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(2000);
    t.pause(); vi.advanceTimersByTime(10_000);
    t.resume(); vi.advanceTimersByTime(1000);
    t.report("p1", AUTHOR, false);
    await t.flush();
    const dwell = all().filter((s) => s.kind === "dwell").reduce((n, s) => n + s.value, 0);
    expect(dwell).toBe(3000);
  });

  it("a card that stays on screen is checkpointed at each flush (no dwell waits for the scroll)", async () => {
    const t = make();
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(FLUSH_INTERVAL_MS);
    await t.flush();
    expect(all().filter((s) => s.kind === "dwell").map((s) => s.value)).toEqual([FLUSH_INTERVAL_MS]);
    vi.advanceTimersByTime(400); // the remainder is under a second — still dwell, never a skip
    t.report("p1", AUTHOR, false);
    await t.flush();
    expect(all().map((s) => [s.kind, s.value])).toEqual([["dwell", FLUSH_INTERVAL_MS], ["dwell", 400]]);
  });

  it("one dwell signal is capped at MAX_DWELL_EVENT_MS (the database CHECK's bound)", async () => {
    const t = make();
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(MAX_DWELL_EVENT_MS + 60_000);
    t.report("p1", AUTHOR, false);
    await t.flush();
    expect(all()[0].value).toBe(MAX_DWELL_EVENT_MS);
  });

  it("nothing is sent when nothing was recorded", async () => {
    const t = make();
    await t.flush();
    expect(sentSignals).toHaveLength(0);
  });
});

describe("fast skip", () => {
  it(`on screen ≥ ${SKIP_MIN_MS} ms and < ${VIEW_DWELL_MS} ms, then scrolled away, is ONE skip`, async () => {
    const t = make();
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(500);
    t.report("p1", AUTHOR, false);
    await t.flush();
    expect(all()).toEqual([expect.objectContaining({ kind: "skip", post_id: "p1", subject_id: AUTHOR, value: 0 })]);
  });

  it("a fling under SKIP_MIN_MS is nothing; a second fast pass in the same session is not a second skip", async () => {
    const t = make();
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(SKIP_MIN_MS - 1); t.report("p1", AUTHOR, false);
    t.report("p2", AUTHOR, true); vi.advanceTimersByTime(600); t.report("p2", AUTHOR, false);
    t.report("p2", AUTHOR, true); vi.advanceTimersByTime(600); t.report("p2", AUTHOR, false);
    await t.flush();
    expect(all().map((s) => [s.kind, s.post_id])).toEqual([["skip", "p2"]]);
  });

  it("the tab going hidden is not a skip; a post already seen this session is not a skip", async () => {
    const t = make();
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(600); t.pause();
    t.resume();
    t.report("p2", AUTHOR, true); vi.advanceTimersByTime(1500); t.report("p2", AUTHOR, false); // seen + dwell
    t.report("p2", AUTHOR, true); vi.advanceTimersByTime(500); t.report("p2", AUTHOR, false); // back again, briefly
    await t.flush();
    expect(all().filter((s) => s.kind === "skip")).toHaveLength(0);
  });

  it("a refresh (new session) lets the same post be skipped again", async () => {
    const t = make();
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(500); t.report("p1", AUTHOR, false);
    t.newSession();
    t.report("p1", AUTHOR, true); vi.advanceTimersByTime(500); t.report("p1", AUTHOR, false);
    await t.flush();
    expect(all().filter((s) => s.kind === "skip")).toHaveLength(2);
  });
});

describe("video watch %", () => {
  it("keeps the highest %, sends it once, and sends again only when it grows", async () => {
    const t = make();
    t.watch("p1", AUTHOR, 30); t.watch("p1", AUTHOR, 20); t.watch("p1", AUTHOR, 75);
    await t.flush();
    await t.flush();
    t.watch("p1", AUTHOR, 60);
    await t.flush();
    t.watch("p1", AUTHOR, 90);
    await t.flush();
    expect(all().map((s) => [s.kind, s.value])).toEqual([["watch", 75], ["watch", 90]]);
  });

  it("is clamped to 0–100 and whole numbers; ignored while the page is hidden", async () => {
    const t = make();
    t.watch("p1", AUTHOR, 150.7);
    t.pause();
    t.watch("p2", AUTHOR, 50);
    t.resume();
    t.watch("p3", AUTHOR, Number.NaN);
    await t.flush();
    expect(all().map((s) => [s.post_id, s.value])).toEqual([["p1", 100]]);
  });
});

describe("share click", () => {
  it("one per post per session", async () => {
    const t = make();
    t.shareClick("p1", AUTHOR); t.shareClick("p1", AUTHOR);
    await t.flush();
    expect(all().map((s) => [s.kind, s.post_id, s.value])).toEqual([["share_click", "p1", 0]]);
  });
});

describe("own-member data only", () => {
  it("nothing about the member's OWN post is recorded: no dwell, skip, watch or share click", async () => {
    const t = make();
    t.report("mine", ME, true); vi.advanceTimersByTime(5000); t.report("mine", ME, false);
    t.report("mine2", ME, true); vi.advanceTimersByTime(500); t.report("mine2", ME, false);
    t.watch("mine", ME, 80); t.shareClick("mine", ME);
    await t.flush();
    expect(sentSignals).toHaveLength(0);
  });
});

describe("batching", () => {
  it(`60 cards' dwell goes out in batches of ≤ ${MAX_BATCH}, not one request per card`, async () => {
    const t = make();
    for (let i = 0; i < 60; i++) { t.report(`p${i}`, AUTHOR, true); }
    vi.advanceTimersByTime(2000);
    for (let i = 0; i < 60; i++) { t.report(`p${i}`, AUTHOR, false); }
    await t.flush();
    // (the seen-batch filling up at 1 s flushes too, which checkpoints each card's
    // first second — so each card's 2 s may arrive as 1 s + 1 s; the total is exact)
    const dwell = all().filter((s) => s.kind === "dwell");
    expect(new Set(dwell.map((s) => s.post_id)).size).toBe(60);
    expect(dwell.reduce((n, s) => n + s.value, 0)).toBe(60 * 2000);
    expect(sentSignals.length).toBeLessThanOrEqual(2 * Math.ceil(60 / MAX_BATCH)); // two flushes, not 60 requests
    expect(sentSignals.every((s) => s.signals.length <= MAX_BATCH)).toBe(true);
  });

  it("every signal id is made once and is unique", async () => {
    const t = make();
    for (let i = 0; i < 10; i++) { t.report(`p${i}`, AUTHOR, true); vi.advanceTimersByTime(500); t.report(`p${i}`, AUTHOR, false); }
    await t.flush();
    const ids = all().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => UUID.test(id))).toBe(true);
  });
});

describe("the hook: visibility discipline", () => {
  it("tab hidden → the dwell so far is flushed, and nothing more is measured until it is visible again", async () => {
    const signals: FeedSignalPayload[] = [];
    const { result } = renderHook(() => useFeedEventTracker(ME, async () => {}, async (_u, s) => { signals.push(...s); }));
    act(() => { result.current.reportVisibility("p1", AUTHOR, true); });
    act(() => { vi.advanceTimersByTime(2500); });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(signals.map((s) => [s.kind, s.value])).toEqual([["dwell", 2500]]);
    act(() => { vi.advanceTimersByTime(60_000); });
    act(() => { result.current.trackWatch("p1", AUTHOR, 50); });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(signals.map((s) => [s.kind, s.value])).toEqual([["dwell", 2500]]);
  });
});

describe("video watch % is what was PLAYED (FeedVideoCard's arithmetic)", () => {
  it("a normal step counts; a seek forward, backwards or a stall counts nothing; capped at 100", () => {
    expect(playedStep(10, 10.25)).toBeCloseTo(0.25);
    expect(playedStep(10, 55)).toBe(0); // seek to the end is not watching it
    expect(playedStep(10, 3)).toBe(0); // seek back / loop
    expect(playedStep(10, 10)).toBe(0);
    expect(watchPercent(15, 60)).toBe(25);
    expect(watchPercent(130, 60)).toBe(100);
    expect(watchPercent(5, 0)).toBe(0);
    expect(watchPercent(Number.NaN, 60)).toBe(0);
  });
});

describe("profile visit", () => {
  it("recorded once per profile per PROFILE_VISIT_DEDUPE_MS; never the member's own profile; never from a hidden tab", async () => {
    const got: FeedSignalPayload[][] = [];
    const sink: SubmitSignals = async (_u, s) => { got.push(s); };
    const t0 = 1_000_000;
    expect(recordProfileVisit(ME, AUTHOR, sink, t0)).toBe(true);
    expect(recordProfileVisit(ME, AUTHOR, sink, t0 + 1000)).toBe(false); // StrictMode double effect, a quick back-and-forth
    expect(recordProfileVisit(ME, ME, sink, t0)).toBe(false);
    expect(recordProfileVisit(ME, AUTHOR, sink, t0 + PROFILE_VISIT_DEDUPE_MS + 1)).toBe(true);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    expect(recordProfileVisit(ME, "00000000-0000-4000-8000-0000000000cc", sink, t0)).toBe(false);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    expect(got).toHaveLength(2);
    expect(got[0]).toEqual([expect.objectContaining({ kind: "profile_visit", post_id: null, subject_id: AUTHOR, value: 0 })]);
    expect(got[0][0].id).toMatch(UUID);
    expect(got[0][0].id).not.toBe(got[1][0].id);
  });
});
