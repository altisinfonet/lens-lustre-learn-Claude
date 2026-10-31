/**
 * S11 runtime · contributor scores were fetched again on every card mount.
 * The feed window remounts cards while scrolling, so the same twenty members
 * were re-requested over and over. Answers are now kept for 5 minutes (the app's
 * staleTime); a failed request is never cached.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { fetchContributorScores, __resetContributorScoreCache } from "@/lib/contributorScore";

const rows = (o: Record<string, number>) => ({ data: Object.entries(o).map(([user_id, contributor_score]) => ({ user_id, contributor_score })), error: null });

describe("contributor score cache", () => {
  beforeEach(() => { rpc.mockReset(); __resetContributorScoreCache(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-30T00:00:00Z")); });
  afterEach(() => vi.useRealTimers());

  it("a remount within 5 minutes asks nothing; the answer is the same", async () => {
    rpc.mockResolvedValue(rows({ a: 10, b: 20 }));
    const first = await fetchContributorScores(["a", "b", "c"]);
    expect([...first]).toEqual([["a", 10], ["b", 20]]);
    const again = await fetchContributorScores(["a", "b", "c"]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect([...again]).toEqual([["a", 10], ["b", 20]]); // c had no score: cached as "none", not re-asked
  });

  it("only the ids not yet known are requested", async () => {
    rpc.mockResolvedValueOnce(rows({ a: 10 })).mockResolvedValueOnce(rows({ d: 4 }));
    await fetchContributorScores(["a"]);
    const m = await fetchContributorScores(["a", "d"]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1]).toEqual({ _user_ids: ["d"] });
    expect([...m].sort()).toEqual([["a", 10], ["d", 4]]);
  });

  it("after 5 minutes the score is asked again (it rises and falls with work)", async () => {
    rpc.mockResolvedValueOnce(rows({ a: 10 })).mockResolvedValueOnce(rows({ a: 12 }));
    await fetchContributorScores(["a"]);
    vi.setSystemTime(new Date("2026-10-30T00:05:01Z"));
    const m = await fetchContributorScores(["a"]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(m.get("a")).toBe(12);
  });

  it("a failed request is not cached", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } }).mockResolvedValueOnce(rows({ a: 10 }));
    expect((await fetchContributorScores(["a"])).size).toBe(0);
    expect((await fetchContributorScores(["a"])).get("a")).toBe(10);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("cards in the same render still share ONE request", async () => {
    rpc.mockResolvedValue(rows({ a: 1, b: 2 }));
    const [x, y] = await Promise.all([fetchContributorScores(["a"]), fetchContributorScores(["b"])]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(x.get("a")).toBe(1);
    expect(y.get("b")).toBe(2);
  });
});
