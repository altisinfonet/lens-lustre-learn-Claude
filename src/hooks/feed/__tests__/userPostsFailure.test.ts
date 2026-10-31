/**
 * S7b-4 · a wall read that FAILED is not an empty wall. fetchUserPostsPage
 * answered a double failure (and, for "own posts only", any failure) with
 * `{ posts: [] }` as a SUCCESS: the screen said "no posts" and OFF-1 wrote that
 * empty page over the copy saved on the phone. It throws now, so React Query
 * retries / pauses and the saved wall stays.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  const fail = { data: null, error: { message: "TypeError: Failed to fetch", code: "" } };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit", "lt", "or", "not"]) chain[m] = () => chain;
  chain.then = (resolve: (v: typeof fail) => unknown) => Promise.resolve(fail).then(resolve);
  return { supabase: { from: () => chain, rpc: async () => fail } };
});

const { fetchUserPostsPage } = await import("@/hooks/feed/useUserPostsQuery");

describe("a failed wall read", () => {
  it("throws (both reads failed)", async () => {
    await expect(fetchUserPostsPage("someone", "me", null, false)).rejects.toBeTruthy();
  });
  it("throws (own posts only, the one read failed)", async () => {
    await expect(fetchUserPostsPage("someone", "me", null, true)).rejects.toBeTruthy();
  });
});
