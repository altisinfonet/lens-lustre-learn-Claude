/**
 * THE BADGE MUST NOT SATURATE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, measured on production 2026-08-02
 *
 * The bell fetched `.eq("is_read", false).limit(30)` and the badge counted the
 * LENGTH OF THAT ARRAY:
 *
 *     totalCount: … + data.userNotifications.length
 *
 * So the badge could never exceed 30 however many notifications were waiting.
 * On this database at the time: 75 members with unread notifications, 4 of them
 * over the cap, and the worst holding **111 unread behind a badge reading 30**.
 *
 * The count now comes from `total_unread`, which the RPC computes over every
 * unread row rather than over the page of groups it returns.
 *
 * These two functions are the whole of that fix. They are separate from the
 * hook so they can be tested without react-query, a network, or a browser —
 * and so that reverting the fix fails a test instead of quietly capping a
 * number nobody is looking at.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { badgeCountOf, unreadTotalOf } from "@/hooks/notifications/useNotificationsQuery";

const groups = (n: number, total: number) =>
  Array.from({ length: n }, () => ({ total_unread: total }));

describe("unreadTotalOf", () => {
  it("takes the server's total, not the number of groups it returned", () => {
    // 20 groups came back — the panel's limit — but 111 rows are unread.
    expect(unreadTotalOf(groups(20, 111))).toBe(111);
  });

  it("is zero when nothing came back", () => {
    // No groups means nothing unread, so there is no total to miss.
    expect(unreadTotalOf([])).toBe(0);
  });

  it("does not trip over a missing field", () => {
    expect(unreadTotalOf([{}])).toBe(0);
    expect(unreadTotalOf([{ total_unread: null }])).toBe(0);
  });
});

describe("badgeCountOf", () => {
  it("counts unread EVENTS, not the rows on screen — the 111-vs-30 bug", () => {
    const count = badgeCountOf({
      friendRequests: [],
      giftNotifications: [],
      adminNotifications: [],
      unreadTotal: 111,
    });
    expect(count).toBe(111);
    // The old expression would have produced the length of the group page.
    expect(count).not.toBe(20);
    expect(count).not.toBe(30);
  });

  it("still adds the three lists that are not notifications", () => {
    expect(
      badgeCountOf({
        friendRequests: [1, 2],
        giftNotifications: [1],
        adminNotifications: [1, 2, 3],
        unreadTotal: 5,
      }),
    ).toBe(11);
  });

  it("is zero on an empty inbox", () => {
    expect(
      badgeCountOf({
        friendRequests: [],
        giftNotifications: [],
        adminNotifications: [],
        unreadTotal: 0,
      }),
    ).toBe(0);
  });
});

describe("the hook cannot go back to counting rows", () => {
  /**
   * badgeCountOf can only ever be as right as what is passed to it, so this
   * reads the hook itself. Comments are stripped first — on 2026-08-01 a
   * source-pin test in this repo passed by matching its own explanation.
   */
  const src = readFileSync(join(process.cwd(), "src/hooks/notifications/useNotificationsQuery.ts"), "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  it("computes the badge from the server total", () => {
    expect(src).toMatch(/totalCount:\s*badgeCountOf\(data\)/);
  });

  it("never adds the length of the group page to the badge", () => {
    expect(src).not.toMatch(/userNotifications\.length/);
  });

  it("asks the grouped RPC, not the raw table", () => {
    expect(src).toContain("get_my_unread_notifications_grouped");
    expect(src).not.toMatch(/from\("user_notifications"\)/);
  });

  /**
   * A friend request writes a pending `friendships` row AND a `friend_request`
   * notification. The bell reads both, so every pending request was counted
   * twice in the badge and drawn twice in the panel. Measured on production
   * 2026-08-02: every member with 3 pending requests had exactly 3 unread
   * friend_request rows.
   *
   * The exclusion is sent to the RPC, not applied here, because `total_unread`
   * is counted server-side — filtering in the client would fix the list and
   * leave the number wrong, which is the fault Stage 3c existed to remove.
   */
  it("tells the server not to count friend requests, so the badge counts them once", () => {
    expect(src).toMatch(/BELL_EXCLUDED_TYPES\s*=\s*\[\s*"friend_request"\s*\]/);
    expect(src).toMatch(/_exclude_types:\s*BELL_EXCLUDED_TYPES/);
  });
});
