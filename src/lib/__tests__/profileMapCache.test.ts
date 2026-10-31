/**
 * Tests for the per-ID profile cache + micro-batcher (rewritten 2026-08-01).
 *
 * WHAT THIS REPLACED
 *   The cache was keyed on the sorted ID ARRAY, so `[a,b,c]`, `[a]` and `[b,c]`
 *   were three separate entries fetching overlapping data. Measured on the
 *   production feed: 13 calls × 4 queries each = 52 requests, for ~8 distinct
 *   authors. See PERFORMANCE_AUDIT.md.
 *
 * WHAT THESE PIN
 *   Each of these corresponds to a way the old design leaked requests, or a way
 *   a batcher typically breaks. The request COUNT assertions are the point —
 *   correctness of the returned data was never the problem.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── Supabase stub that COUNTS calls ─────────────────────────────────────── */

const calls = { profiles: 0, badges: 0, roles: 0, presence: 0 };
let lastIdsSeen: string[] = [];
let failNext = false;

function resetCalls() {
  calls.profiles = 0; calls.badges = 0; calls.roles = 0; calls.presence = 0;
  lastIdsSeen = [];
  failNext = false;
}

/** A thenable that mimics the PostgREST builder chain. */
function makeSelect(kind: "profiles" | "presence" | "badges") {
  return (cols: string) => ({
    in: (_col: string, ids: string[]) => {
      const which = kind === "profiles" ? (cols.includes("last_active_at") ? "presence" : "profiles") : kind;
      calls[which as keyof typeof calls]++;
      lastIdsSeen = ids;
      if (failNext) return Promise.resolve({ data: null, error: new Error("boom") });
      if (which === "badges") {
        return Promise.resolve({ data: ids.map((id) => ({ user_id: id, badge_type: "verified" })) });
      }
      if (which === "presence") {
        return Promise.resolve({ data: ids.map((id) => ({ id, last_active_at: "2026-08-01T00:00:00Z" })) });
      }
      return Promise.resolve({ data: ids.map((id) => ({ id, full_name: "Name " + id, avatar_url: null })) });
    },
  });
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({ select: makeSelect(table === "user_badges" ? "badges" : "profiles") }),
    rpc: (_fn: string, args: any) => {
      calls.roles++;
      if (failNext) return Promise.resolve({ data: null, error: new Error("boom") });
      return Promise.resolve({ data: (args?._user_ids ?? []).map((id: string) => ({ user_id: id, role: "student" })) });
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  },
}));

vi.mock("@/lib/profilesPublic", () => ({
  profilesPublic: () => ({ select: makeSelect("profiles") }),
}));

import {
  fetchProfileMapDirect,
  fetchProfileMap,
  clearProfileEntityCache,
} from "@/lib/profileMapCache";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeEach(() => {
  clearProfileEntityCache();
  resetCalls();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("one round trip per batch, not per caller", () => {
  it("collapses many overlapping concurrent requests into ONE fetch", async () => {
    // This is the exact shape of the old bug: a feed where every card asks for
    // its own slice of authors.
    const [a, b, c, d] = [ID(1), ID(2), ID(3), ID(4)];
    const results = await Promise.all([
      fetchProfileMapDirect([a, b, c]),
      fetchProfileMapDirect([a]),
      fetchProfileMapDirect([b, c]),
      fetchProfileMapDirect([d]),
      fetchProfileMapDirect([a, d]),
    ]);

    // Four queries total — profiles, badges, roles, presence — ONE of each.
    expect(calls).toEqual({ profiles: 1, badges: 1, roles: 1, presence: 1 });
    // Under the old design this was 5 calls x 4 queries = 20.

    expect(results[0].size).toBe(3);
    expect(results[1].get(a)?.full_name).toBe("Name " + a);
    expect(results[3].get(d)?.full_name).toBe("Name " + d);
  });

  it("sends every requested id exactly once, deduplicated and sorted", async () => {
    const ids = [ID(3), ID(1), ID(2)];
    await Promise.all([
      fetchProfileMapDirect([ids[0], ids[0]]),
      fetchProfileMapDirect([ids[1], ids[2], ids[0]]),
    ]);
    expect(lastIdsSeen).toEqual([ID(1), ID(2), ID(3)]);
  });
});

describe("the cache actually hits", () => {
  it("does not go to the network at all for an id already fetched", async () => {
    await fetchProfileMapDirect([ID(1), ID(2)]);
    expect(calls.profiles).toBe(1);

    await fetchProfileMapDirect([ID(1)]);
    await fetchProfileMapDirect([ID(2), ID(1)]);
    expect(calls.profiles).toBe(1); // still one — this is the whole point
  });

  it("fetches ONLY the ids it is missing", async () => {
    await fetchProfileMapDirect([ID(1), ID(2)]);
    resetCalls();

    const map = await fetchProfileMapDirect([ID(1), ID(2), ID(3)]);
    expect(calls.profiles).toBe(1);
    expect(lastIdsSeen).toEqual([ID(3)]); // not 1 and 2 again
    expect(map.size).toBe(3);
    expect(map.get(ID(1))?.full_name).toBe("Name " + ID(1));
  });

  it("re-fetches after the entity cache is cleared", async () => {
    await fetchProfileMapDirect([ID(1)]);
    clearProfileEntityCache();
    await fetchProfileMapDirect([ID(1)]);
    expect(calls.profiles).toBe(2);
  });

  it("clears a single user without disturbing the others", async () => {
    await fetchProfileMapDirect([ID(1), ID(2)]);
    resetCalls();
    clearProfileEntityCache(ID(1));
    await fetchProfileMapDirect([ID(1), ID(2)]);
    expect(lastIdsSeen).toEqual([ID(1)]);
  });
});

describe("fetchProfileMap and fetchProfileMapDirect share one cache", () => {
  it("does not double-fetch across the two entry points", async () => {
    await fetchProfileMap([ID(1)]);
    await fetchProfileMapDirect([ID(1)]);
    expect(calls.profiles).toBe(1);
  });
});

describe("shape of the returned map", () => {
  it("returns an entry for every requested id, merged from all four queries", async () => {
    const map = await fetchProfileMapDirect([ID(7)]);
    const e = map.get(ID(7))!;
    expect(e.id).toBe(ID(7));
    expect(e.full_name).toBe("Name " + ID(7));
    expect(e.badges).toEqual(["verified"]);
    expect(e.roles).toEqual(["student"]);
    expect(e.last_active_at).toBe("2026-08-01T00:00:00Z");
  });

  it("returns an empty map, and makes no request, for an empty id list", async () => {
    const map = await fetchProfileMapDirect([]);
    expect(map.size).toBe(0);
    expect(calls.profiles).toBe(0);
  });
});

describe("failure handling", () => {
  it("a failed batch does not hang its waiters and does not poison the cache", async () => {
    failNext = true;
    const map = await fetchProfileMapDirect([ID(1)]);
    // Resolves rather than hanging, with a placeholder rather than a crash.
    expect(map.get(ID(1))).toBeTruthy();

    // And the id is NOT cached as a failure — the next call retries it.
    failNext = false;
    resetCalls();
    const ok = await fetchProfileMapDirect([ID(1)]);
    expect(calls.profiles).toBe(1);
    expect(ok.get(ID(1))?.full_name).toBe("Name " + ID(1));
  });
});

describe("ids arriving mid-flight", () => {
  it("start a new batch instead of silently joining one already sent", async () => {
    const first = fetchProfileMapDirect([ID(1)]);
    await new Promise((r) => setTimeout(r, 25)); // let the first batch go out
    const second = fetchProfileMapDirect([ID(2)]);
    await Promise.all([first, second]);
    // Two separate batches, and crucially ID(2) is really present.
    expect(calls.profiles).toBe(2);
    expect((await second).get(ID(2))?.full_name).toBe("Name " + ID(2));
  });
});
