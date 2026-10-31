import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PERF regression pin, 2026-08-07 — the "profile opens after 5 minutes" fix.
 *
 * useFriendFollow used to run five independent Supabase calls one after another
 * with `await`, and PublicProfile mounts the hook twice with no cache — ten
 * requests as two five-deep chains, ~20s on a slow link. It was rewritten to
 * fire all five in one Promise.all inside a React Query, so the two mounts
 * dedupe to one parallel wave.
 *
 * This reads the source (the repo's established test style) and fails if anyone
 * reverts to the slow shape. It does not test React Query's internals — it pins
 * the two properties that make the fix a fix: parallel, and cached.
 */
const SRC = fs.readFileSync(
  path.resolve(process.cwd(), "src/hooks/social/useFriendFollow.ts"),
  "utf8",
);

describe("useFriendFollow stays fast", () => {
  it("fires the independent calls in parallel, not as a chain", () => {
    expect(SRC).toContain("Promise.all");
  });

  it("is a cached React Query so the two profile mounts dedupe", () => {
    expect(SRC).toContain("useQuery");
    expect(SRC).toMatch(/queryKey\s*[:=]\s*\[\s*["']friend-follow["']/);
  });

  it("does not reintroduce a chain of awaited Supabase reads", () => {
    // The old shape was: await supabase...; <use it>; await supabase...; ...
    // A single Promise.all await is fine; more than one sequential `await
    // supabase.` in the fetch path is the regression.
    const awaitedSupabaseReads = SRC.match(/await\s+supabase\s*\./g) ?? [];
    expect(awaitedSupabaseReads.length).toBe(0);
  });

  it("mutations invalidate the cache instead of hand-refetching", () => {
    expect(SRC).toContain("invalidateQueries");
  });
});
