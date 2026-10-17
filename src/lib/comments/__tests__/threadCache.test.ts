/**
 * The comment-thread cache (review of #435): keyed by viewer, bounded
 * (least recently used goes first), forgettable per thread, and emptied by
 * one call on sign-out.
 */
import { describe, it, expect } from "vitest";
import { createThreadCache, clearCommentThreadCaches, THREAD_CACHE_MAX } from "@/lib/comments/threadCache";

describe("threadCache", () => {
  it("keys by viewer: B, and a signed-out viewer, never get A's copy", () => {
    const c = createThreadCache<string[]>();
    c.set("a", "t1", ["A's rows"]);
    expect(c.get("a", "t1")).toEqual(["A's rows"]);
    expect(c.get("b", "t1")).toBeUndefined();
    expect(c.get(null, "t1")).toBeUndefined();
    expect(c.has(undefined, "t1")).toBe(false);
  });

  it("is bounded at ~50 threads, least recently used first", () => {
    expect(THREAD_CACHE_MAX).toBe(50);
    const c = createThreadCache<number>();
    for (let i = 0; i < THREAD_CACHE_MAX; i++) c.set("a", `t${i}`, i);
    c.get("a", "t0"); // touched: no longer the oldest
    c.set("a", "t-new", -1);
    expect(c.size).toBe(THREAD_CACHE_MAX);
    expect(c.has("a", "t0")).toBe(true);
    expect(c.has("a", "t1")).toBe(false);
    expect(c.has("a", "t-new")).toBe(true);
  });

  it("forget drops every viewer's copy of that thread only", () => {
    const c = createThreadCache<number>();
    c.set("a", "t1", 1);
    c.set("b", "t1", 2);
    c.set("a", "t2", 3);
    c.forget("t1");
    expect(c.has("a", "t1") || c.has("b", "t1")).toBe(false);
    expect(c.get("a", "t2")).toBe(3);
  });

  it("clearCommentThreadCaches empties every cache at once (sign-out)", () => {
    const posts = createThreadCache<number>();
    const ads = createThreadCache<number>();
    posts.set("a", "p", 1);
    ads.set("a", "ad", 2);
    clearCommentThreadCaches();
    expect(posts.size + ads.size).toBe(0);
  });
});
