import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  // The RAW curve. Everything below that asserts the shape of the numbers uses
  // this, because the shape has to be provable at ages inside the 24-hour hold
  // as well as outside it. Components must NOT use it — see the gate tests at
  // the bottom of this file, which are the ones that protect the owner's rule.
  engagementFigures as displayEngagement,
  // The gated entry point components actually call.
  displayEngagement as visibleEngagement,
  engagementVisible,
  ENGAGEMENT_HOLD_HOURS,
  formatEngagementCount,
  VIEWS_MIN,
  VIEWS_MAX,
  REACH_MIN,
  REACH_MAX,
} from "@/lib/displayEngagement";

/**
 * Every rule in displayEngagement.ts is pinned here. If one of these fails, the
 * figures have become internally inconsistent — which is the failure mode that
 * actually gets noticed by a member, not the size of the number.
 */

const ids = Array.from({ length: 2000 }, (_, i) => `9f2c${i}-aaaa-bbbb-cccc-${i}0d1e2f3a4b5`);
const T0 = Date.parse("2026-08-01T12:00:00Z");
const HOUR = 3_600_000;

describe("displayEngagement — determinism", () => {
  it("returns the identical figures for the same id on every call", () => {
    for (const id of ids.slice(0, 200)) {
      const a = displayEngagement({ id, createdAt: "2026-07-20T00:00:00Z" }, T0);
      const b = displayEngagement({ id, createdAt: "2026-07-20T00:00:00Z" }, T0);
      expect(b).toEqual(a);
    }
  });

  it("does not drift when called again a millisecond later", () => {
    const id = ids[7];
    const a = displayEngagement({ id, createdAt: "2026-07-20T00:00:00Z" }, T0);
    const b = displayEngagement({ id, createdAt: "2026-07-20T00:00:00Z" }, T0 + 1);
    expect(b.views).toBe(a.views);
    expect(b.reach).toBe(a.reach);
  });

  it("survives a fresh module instance — no hidden per-load seed", async () => {
    // A module-level `Math.random()` seed would pass the two tests above and
    // still change on every page load. Re-importing gives a fresh instance.
    const before = displayEngagement({ id: ids[19], createdAt: "2026-07-20T00:00:00Z" }, T0);
    vi.resetModules();
    const again = await import("@/lib/displayEngagement");
    expect(again.engagementFigures({ id: ids[19], createdAt: "2026-07-20T00:00:00Z" }, T0)).toEqual(before);
  });
});

describe("displayEngagement — bands", () => {
  it("keeps views inside 500–800 and reach inside 800–1200 for every id", () => {
    for (const id of ids) {
      for (const created of ["2026-08-01T11:59:00Z", "2026-07-01T00:00:00Z", "2025-01-01T00:00:00Z"]) {
        const { views, reach } = displayEngagement({ id, createdAt: created }, T0);
        expect(views).toBeGreaterThanOrEqual(VIEWS_MIN);
        expect(views).toBeLessThanOrEqual(VIEWS_MAX);
        expect(reach).toBeGreaterThanOrEqual(REACH_MIN);
        expect(reach).toBeLessThanOrEqual(REACH_MAX);
      }
    }
  });

  it("stays inside the bands however it is called", () => {
    for (const id of ids.slice(0, 500)) {
      const { views, reach } = displayEngagement(
        { id, createdAt: "2025-01-01T00:00:00Z", reactions: 9999, comments: 9999 } as any,
        T0,
      );
      expect(views).toBeLessThanOrEqual(VIEWS_MAX);
      expect(reach).toBeLessThanOrEqual(REACH_MAX);
    }
  });
});

describe("displayEngagement — reach always exceeds views", () => {
  it("holds for every id and age", () => {
    for (const id of ids) {
      for (const reactions of [0, 3, 40, 5000]) {
        for (const age of [0, 1, 30, 24 * 400]) {
          const { views, reach } = displayEngagement(
            { id, createdAt: new Date(T0 - age * HOUR).toISOString(), reactions } as any,
            T0,
          );
          expect(reach).toBeGreaterThan(views);
          expect(reach - views).toBeGreaterThanOrEqual(120);
        }
      }
    }
  });
});

describe("displayEngagement — growth", () => {
  it("never decreases as a post ages", () => {
    for (const id of ids.slice(0, 300)) {
      let lastViews = -1;
      let lastReach = -1;
      for (const age of [0, 1, 3, 6, 12, 24, 48, 96, 24 * 30, 24 * 365]) {
        const { views, reach } = displayEngagement(
          { id, createdAt: new Date(T0 - age * HOUR).toISOString() },
          T0,
        );
        expect(views).toBeGreaterThanOrEqual(lastViews);
        expect(reach).toBeGreaterThanOrEqual(lastReach);
        lastViews = views;
        lastReach = reach;
      }
    }
  });

  it("actually moves — an old post reads higher than the same post when new", () => {
    let moved = 0;
    for (const id of ids.slice(0, 300)) {
      const fresh = displayEngagement({ id, createdAt: new Date(T0).toISOString() }, T0);
      const old = displayEngagement({ id, createdAt: new Date(T0 - 24 * 14 * HOUR).toISOString() }, T0);
      if (old.views > fresh.views) moved++;
    }
    // Not 300/300: an id whose seat is very low has a small band to climb and
    // can round to the same integer. The point is that growth is real for the
    // overwhelming majority, not that it is universal.
    expect(moved).toBeGreaterThan(280);
  });
});

describe("displayEngagement — NOTHING A MEMBER DOES CAN MOVE IT", () => {
  /**
   * Owner report with screenshots, 2026-08-04: tapping Like made the figures
   * jump in the same frame, and un-tapping made them go DOWN. Both came from
   * the engagement lift that used to live in this module. It is deleted; these
   * tests exist so it can never come back.
   */

  it("reaction and comment counts are not inputs at all", () => {
    // Passed through `as any` on purpose: the fields are gone from the type,
    // so this is what a future accidental re-wiring would look like. The
    // figures must be byte-identical regardless.
    for (const id of ids.slice(0, 400)) {
      const base = { id, createdAt: "2026-07-01T00:00:00Z" };
      const plain = displayEngagement(base, T0);
      for (const extra of [
        { reactions: 30, comments: 12 },
        { reactions: 9999, comments: 9999 },
        { reactions: 0, comments: 0 },
        { reactions: -50 },
      ]) {
        expect(displayEngagement({ ...base, ...extra } as any, T0)).toEqual(plain);
      }
    }
  });

  it("liking then un-liking leaves the figure exactly where it was", () => {
    // The precise sequence in the owner's two screenshots.
    for (const id of ids.slice(0, 200)) {
      const at = { id, createdAt: "2026-07-01T00:00:00Z" };
      const before = displayEngagement(at, T0);
      const liked = displayEngagement({ ...at, reactions: 1 } as any, T0);
      const unliked = displayEngagement({ ...at, reactions: 0 } as any, T0);
      expect(liked).toEqual(before);
      expect(unliked).toEqual(before);
    }
  });

  it("the figure can NEVER decrease, at any pair of ages, for any id", () => {
    // The un-like symptom was a decrease. Age is now the only input, so this
    // sweep is the whole guarantee: sample every id across four months of
    // ages and assert the sequence is non-decreasing in both figures.
    const ages = [24, 25, 30, 40, 60, 90, 120, 200, 400, 800, 1600, 24 * 120];
    for (const id of ids.slice(0, 400)) {
      let prevViews = -1;
      let prevReach = -1;
      for (const age of ages) {
        const { views, reach } = displayEngagement(
          { id, createdAt: new Date(T0 - age * HOUR).toISOString() },
          T0,
        );
        expect(views).toBeGreaterThanOrEqual(prevViews);
        expect(reach).toBeGreaterThanOrEqual(prevReach);
        prevViews = views;
        prevReach = reach;
      }
    }
  });

  it("no call site passes a count into it", () => {
    // The module cannot be misused if nothing hands it engagement. This reads
    // the three real call sites rather than trusting the type system, because
    // an `as any` at a call site would slip past tsc.
    const files = [
      "src/components/post/PostCard.tsx",
      "src/pages/PostDetail.tsx",
      "src/components/profile/ProfileStories.tsx",
    ];
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const call = src.indexOf("displayEngagement({");
      if (call === -1) continue;
      const args = src.slice(call, src.indexOf("}", call));
      expect(args, `${f} must not pass counts into displayEngagement`).not.toMatch(/reactions|comments/);
    }
  });

  it("PostCard does not recompute the figure when a count changes", () => {
    // The memo dependency list is what made the number move in the same frame
    // as the tap. It must contain the id and the date, and nothing else.
    const src = readFileSync(join(process.cwd(), "src/components/post/PostCard.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/\[post\.id, post\.created_at\],/);
    expect(src).not.toMatch(/\[post\.id, post\.created_at, post\.like_count/);
  });
});

describe("displayEngagement — spread", () => {
  it("does not cluster: neighbouring ids give well-separated figures", () => {
    // UUIDs minted seconds apart share long prefixes. Without the avalanche
    // mix in hash32 these would come out nearly identical.
    const seq = Array.from({ length: 400 }, (_, i) => `018f5c2a-7d31-7000-8000-0000000${String(i).padStart(5, "0")}`);
    const vals = seq.map((id) => displayEngagement({ id, createdAt: "2026-07-01T00:00:00Z" }, T0).views);
    const distinct = new Set(vals).size;
    expect(distinct).toBeGreaterThan(150);

    // and they should not be monotonic in the id
    let inversions = 0;
    for (let i = 1; i < vals.length; i++) if (vals[i] < vals[i - 1]) inversions++;
    expect(inversions).toBeGreaterThan(120);
  });

  it("uses the whole band, not just the middle", () => {
    const vals = ids.map((id) => displayEngagement({ id, createdAt: "2025-01-01T00:00:00Z" }, T0).views);
    expect(Math.min(...vals)).toBeLessThan(560);
    expect(Math.max(...vals)).toBeGreaterThan(770);
  });
});

describe("displayEngagement — edge cases", () => {
  it("survives a missing id without throwing", () => {
    expect(displayEngagement({ id: "" }, T0)).toEqual({ reach: REACH_MIN, views: VIEWS_MIN });
  });

  it("treats an unparseable or missing date as mature rather than crashing", () => {
    const a = displayEngagement({ id: ids[3], createdAt: "not a date" }, T0);
    const b = displayEngagement({ id: ids[3] }, T0);
    expect(a).toEqual(b);
    expect(a.views).toBeGreaterThanOrEqual(VIEWS_MIN);
  });

  it("does not go negative or NaN on a future date", () => {
    const { views, reach } = displayEngagement(
      { id: ids[4], createdAt: new Date(T0 + 48 * HOUR).toISOString() },
      T0,
    );
    expect(Number.isFinite(views)).toBe(true);
    expect(Number.isFinite(reach)).toBe(true);
    expect(views).toBeGreaterThanOrEqual(VIEWS_MIN);
  });

  it("ignores stray count fields entirely", () => {
    const a = displayEngagement({ id: ids[5], createdAt: "2026-07-01T00:00:00Z", reactions: -50 } as any, T0);
    const b = displayEngagement({ id: ids[5], createdAt: "2026-07-01T00:00:00Z", reactions: 0 } as any, T0);
    expect(a).toEqual(b);
  });
});

describe("formatEngagementCount", () => {
  it("shows exact numbers with separators below 10,000", () => {
    expect(formatEngagementCount(742)).toBe("742");
    expect(formatEngagementCount(1147)).toBe("1,147");
    expect(formatEngagementCount(9999)).toBe("9,999");
  });

  it("abbreviates only above 10,000", () => {
    expect(formatEngagementCount(10_000)).toBe("10K");
    expect(formatEngagementCount(12_400)).toBe("12.4K");
    expect(formatEngagementCount(2_000_000)).toBe("2M");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * THE 24-HOUR HOLD
 *
 * This block is the most important one in the file. On 2026-08-01 a post
 * published one second earlier displayed "962 reached · 661 viewed" — a number
 * that cannot be true and that any member can falsify by posting once. The
 * hold existed as a policy and had no test, so nothing caught its absence.
 *
 * These tests are written against `visibleEngagement` — the function the UI
 * calls — precisely because that is where the guarantee has to live.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("the 24-hour hold", () => {
  const id = ids[42];

  it("shows NOTHING for a post made one second ago", () => {
    expect(visibleEngagement({ id, createdAt: new Date(T0 - 1000).toISOString() }, T0)).toBeNull();
  });

  it("shows nothing at any point inside the first 24 hours", () => {
    for (const h of [0, 0.5, 1, 6, 12, 18, 23, 23.99]) {
      const at = new Date(T0 - h * HOUR).toISOString();
      expect(visibleEngagement({ id, createdAt: at }, T0), `${h}h old`).toBeNull();
    }
  });

  it("shows the figures from exactly 24 hours onwards", () => {
    for (const h of [24, 24.01, 25, 48, 24 * 30]) {
      const at = new Date(T0 - h * HOUR).toISOString();
      const out = visibleEngagement({ id, createdAt: at }, T0);
      expect(out, `${h}h old`).not.toBeNull();
      expect(out!.views).toBeGreaterThanOrEqual(VIEWS_MIN);
      expect(out!.reach).toBeGreaterThan(out!.views);
    }
  });

  it("holds a post dated in the FUTURE — a clock skew must not leak numbers", () => {
    expect(visibleEngagement({ id, createdAt: new Date(T0 + HOUR).toISOString() }, T0)).toBeNull();
  });

  it("uses the exported constant, so the boundary cannot drift from the docs", () => {
    expect(ENGAGEMENT_HOLD_HOURS).toBe(24);
    const justUnder = new Date(T0 - (ENGAGEMENT_HOLD_HOURS * HOUR - 1)).toISOString();
    const justOver = new Date(T0 - ENGAGEMENT_HOLD_HOURS * HOUR).toISOString();
    expect(visibleEngagement({ id, createdAt: justUnder }, T0)).toBeNull();
    expect(visibleEngagement({ id, createdAt: justOver }, T0)).not.toBeNull();
  });

  it("returns the same numbers as the raw curve once it is past the hold", () => {
    const at = new Date(T0 - 72 * HOUR).toISOString();
    expect(visibleEngagement({ id, createdAt: at }, T0)).toEqual(
      displayEngagement({ id, createdAt: at }, T0),
    );
  });

  it("treats an item of unknown age as mature, matching the growth curve", () => {
    expect(visibleEngagement({ id }, T0)).not.toBeNull();
    expect(visibleEngagement({ id, createdAt: "not a date" }, T0)).not.toBeNull();
  });

  it("engagementVisible agrees with what displayEngagement returns", () => {
    for (const h of [0, 5, 23.5, 24, 100]) {
      const at = new Date(T0 - h * HOUR).toISOString();
      expect(engagementVisible(at, T0)).toBe(visibleEngagement({ id, createdAt: at }, T0) !== null);
    }
  });

  it("a story never qualifies: stories expire at 24h, the hold ends at 24h", () => {
    // Documented consequence, asserted so it is a decision and not a surprise.
    for (const h of [0.1, 6, 12, 23.9]) {
      expect(visibleEngagement({ id, createdAt: new Date(T0 - h * HOUR).toISOString() }, T0)).toBeNull();
    }
  });
});
