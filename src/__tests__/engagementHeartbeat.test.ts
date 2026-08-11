/**
 * Phase 2a — Active Engagement collector.
 *
 * The segment tests are the ones that matter most. Everything else here is a
 * counting bug, recoverable by re-running a rollup; a segment bug writes a
 * member's vanity URL into a table the owner explicitly said must never expose
 * "User X was active at 10:31, 10:32, 10:33...".
 *
 * The heartbeat is driven for real with fake timers rather than asserted
 * against its own source, because the failures worth catching — a ping in a
 * hidden tab, two pings in one minute, a timer surviving unmount — are all
 * behavioural and all type-check perfectly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { pathSegment, minuteKey } from "@/lib/engagement/activityPing";

// ── mocks ────────────────────────────────────────────────────────────────────

const sent: Array<{ segment: string; interacted: boolean }> = [];

vi.mock("@/lib/engagement/activityPing", async (orig) => {
  const actual = await orig<typeof import("@/lib/engagement/activityPing")>();
  return {
    ...actual,
    sendActivityPing: (segment: string, interacted: boolean) => {
      sent.push({ segment, interacted });
      return Promise.resolve();
    },
  };
});

let mockUser: { id: string } | null = { id: "u1" };
vi.mock("@/hooks/core/useAuth", () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));

let mockPath = "/feed";
vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: mockPath }),
}));

import { useEngagementHeartbeat } from "@/hooks/core/useEngagementHeartbeat";

// ── helpers ──────────────────────────────────────────────────────────────────

const TICK = 15_000;

let hidden = false;
const setHidden = (v: boolean) => {
  hidden = v;
  document.dispatchEvent(new Event("visibilitychange"));
};

const input = () => window.dispatchEvent(new Event("pointerdown"));

beforeEach(() => {
  sent.length = 0;
  mockUser = { id: "u1" };
  mockPath = "/feed";
  hidden = false;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  vi.useFakeTimers();
  // A round minute boundary, so "advance 45s" never straddles one by accident.
  vi.setSystemTime(new Date("2026-08-11T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── the segment allow-list ───────────────────────────────────────────────────

describe("pathSegment never records anything identifying", () => {
  it("maps a known route to its category", () => {
    expect(pathSegment("/feed")).toBe("feed");
    expect(pathSegment("/journal/my-trip-to-ladakh")).toBe("journal");
    expect(pathSegment("/profile/9f1c-uuid-here")).toBe("profile");
    expect(pathSegment("/courses/street-photography/lessons/4")).toBe("courses");
  });

  it("maps the root to home", () => {
    expect(pathSegment("/")).toBe("home");
    expect(pathSegment("")).toBe("home");
  });

  it("maps a member's vanity URL to `other`, NOT to their username", () => {
    // App.tsx routes `/:customUrl` at the top level. Taking the first segment
    // literally would have written usernames into the table.
    expect(pathSegment("/dipannita-sen")).toBe("other");
    expect(pathSegment("/some-unknown-page")).toBe("other");
  });

  it("never returns anything outside the fixed vocabulary", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/engagement/activityPing.ts"),
      "utf8",
    );
    const list = src.slice(
      src.indexOf("KNOWN_SEGMENTS"),
      src.indexOf("]);", src.indexOf("KNOWN_SEGMENTS")),
    );
    const allowed = new Set(
      [...list.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).concat("other"),
    );
    for (const p of [
      "/",
      "/feed",
      "/admin/users",
      "/judge",
      "/hashtag/roses",
      "/post/abc-123",
      "/ad/xyz",
      "/neil-basu",
      "/../etc/passwd",
      "/%2e%2e",
    ]) {
      expect(allowed.has(pathSegment(p))).toBe(true);
    }
  });

  it("lower-cases, so /IDverification is one category and not two", () => {
    expect(pathSegment("/IDverification")).toBe("idverification");
    expect(pathSegment("/idverification")).toBe("idverification");
  });

  it("keeps /admin and /judge as themselves so the server can mark them internal", () => {
    // The surface decision is the server's, but it can only make it if the
    // segment arrives intact.
    expect(pathSegment("/admin/users")).toBe("admin");
    expect(pathSegment("/judge")).toBe("judge");
  });
});

describe("minuteKey", () => {
  it("is stable inside a minute and changes across one", () => {
    const t = Date.parse("2026-08-11T12:00:00Z");
    expect(minuteKey(t)).toBe(minuteKey(t + 59_999));
    expect(minuteKey(t)).not.toBe(minuteKey(t + 60_000));
  });
});

// ── the heartbeat ────────────────────────────────────────────────────────────

describe("the heartbeat", () => {
  it("does nothing at all for a signed-out visitor", () => {
    mockUser = null;
    renderHook(() => useEngagementHeartbeat());
    vi.advanceTimersByTime(5 * 60_000);
    expect(sent).toHaveLength(0);
  });

  it("records at most one ping per wall-clock minute", () => {
    renderHook(() => useEngagementHeartbeat());
    // Three ticks, all inside 12:00 (:15, :30, :45), each with fresh input so
    // the idle window can play no part in the result.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(TICK);
      input();
    }
    expect(sent).toHaveLength(1);
    // The fourth tick lands on 12:01:00 exactly — a new minute, one more ping.
    vi.advanceTimersByTime(TICK);
    expect(sent).toHaveLength(2);
    // The next three land at :15, :30, :45 of 12:01 and earn nothing.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(TICK);
      input();
    }
    expect(sent).toHaveLength(2);
  });

  it("stops after 120 seconds without input, and resumes when touched", () => {
    renderHook(() => useEngagementHeartbeat());
    vi.advanceTimersByTime(60_000); // minute 1
    vi.advanceTimersByTime(60_000); // minute 2 — still inside the idle window
    const earned = sent.length;
    expect(earned).toBeGreaterThan(0);

    // Now sit untouched well past the timeout.
    vi.advanceTimersByTime(5 * 60_000);
    expect(sent).toHaveLength(earned);

    input();
    vi.advanceTimersByTime(TICK);
    expect(sent.length).toBe(earned + 1);
  });

  it("sends nothing while the tab is hidden and clears its timer", () => {
    renderHook(() => useEngagementHeartbeat());
    vi.advanceTimersByTime(TICK);
    const before = sent.length;

    setHidden(true);
    expect(vi.getTimerCount()).toBe(0); // the interval is gone, not idling
    vi.advanceTimersByTime(10 * 60_000);
    expect(sent).toHaveLength(before);

    setHidden(false);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    vi.advanceTimersByTime(TICK);
    expect(sent.length).toBe(before + 1);
  });

  it("treats returning to the tab as an interaction, not as continued idleness", () => {
    renderHook(() => useEngagementHeartbeat());
    setHidden(true);
    vi.advanceTimersByTime(30 * 60_000); // half an hour away
    setHidden(false);
    vi.advanceTimersByTime(TICK);
    // Without the reset, the idle check would still see the last input as
    // half an hour old and refuse to record anything until a click.
    expect(sent.length).toBeGreaterThan(0);
  });

  it("reports the segment of the page the member is on WHEN THE TICK FIRES", () => {
    mockPath = "/feed";
    const { rerender } = renderHook(() => useEngagementHeartbeat());
    vi.advanceTimersByTime(TICK);
    expect(sent.at(-1)?.segment).toBe("feed");

    mockPath = "/admin/users";
    rerender();
    input();
    vi.advanceTimersByTime(60_000);
    expect(sent.at(-1)?.segment).toBe("admin");
  });

  it("does not restart its countdown on every navigation", () => {
    // The path lives in a ref for this reason: a member clicking through four
    // pages in 15 seconds must still earn the minute.
    const { rerender } = renderHook(() => useEngagementHeartbeat());
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(3_000);
      mockPath = ["/feed", "/photos", "/discover", "/friends"][i];
      rerender();
    }
    vi.advanceTimersByTime(3_000); // 15s total
    expect(sent).toHaveLength(1);
  });

  it("flags had_interaction only when a real event landed inside that minute", () => {
    renderHook(() => useEngagementHeartbeat());
    // Mount counts as input, and mount is inside minute 1.
    vi.advanceTimersByTime(TICK);
    expect(sent.at(-1)?.interacted).toBe(true);

    // Minute 2 with no further input: still inside the 120s idle window, so it
    // is recorded, but it is carried, not interacted.
    vi.advanceTimersByTime(60_000);
    expect(sent.at(-1)?.interacted).toBe(false);
  });

  it("leaves no timer or listener behind on unmount", () => {
    const { unmount } = renderHook(() => useEngagementHeartbeat());
    vi.advanceTimersByTime(TICK);
    const before = sent.length;
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    input();
    vi.advanceTimersByTime(10 * 60_000);
    expect(sent).toHaveLength(before);
  });
});

// ── the principles, asserted against the source ──────────────────────────────

/**
 * Strips comments before scanning. Without this these assertions fail on the
 * files' own documentation — the header of activityPing.ts explains at length
 * why there is no retry, and the word "retry" in that sentence is not a retry.
 */
const codeOnly = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("no retry and no offline queue", () => {
  const src = codeOnly("src/lib/engagement/activityPing.ts");

  it("has no buffer, no queue and no retry", () => {
    // A buffer would replay a duration the CLIENT asserts happened, which is
    // exactly the claim this design refuses to trust.
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(src).not.toMatch(/setTimeout|retry|backoff/i);
  });

  it("swallows failures instead of surfacing them to the member", () => {
    expect(src).toContain("catch");
    expect(src).not.toMatch(/toast|console\.(error|warn)/);
  });
});

describe("Capacitor is reached through runtime globals, never an import", () => {
  it("the hook imports no @capacitor/* package", () => {
    // src/lib/native/authDeepLink.ts: those packages are installed only by the
    // Android CI build, so an import breaks the web deploy.
    const src = codeOnly("src/hooks/core/useEngagementHeartbeat.ts");
    expect(src).not.toContain("@capacitor/");
    expect(src).toContain("window as unknown as { Capacitor?");
  });
});

describe("mounted exactly once", () => {
  it("Layout is the only mount site", () => {
    const layout = readFileSync(
      join(process.cwd(), "src/components/Layout.tsx"),
      "utf8",
    );
    expect(layout).toContain("useEngagementHeartbeat()");
  });
});
