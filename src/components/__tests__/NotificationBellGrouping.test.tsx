/**
 * The bell groups like the page, and the badge tells the truth.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, measured on production 2026-08-02
 *
 * 1. The badge counted `userNotifications.length` against a query that was
 *    `.eq("is_read", false).limit(30)`. So it stopped at 30. On this database:
 *    75 members have unread notifications, 4 of them are over 30, and the worst
 *    has **111 unread showing a badge of 30**. Not approximate — wrong, and
 *    silently so.
 *
 * 2. A day of reactions was one line on /notifications and one line PER EVENT
 *    in the bell. Same events, two different shapes, because the bell read raw
 *    rows while the page read get_my_notifications_grouped().
 *
 * Both are fixed by reading get_my_unread_notifications_grouped(), which
 * applies the same notif_group_key() the history page uses and returns
 * `total_unread` counted over every unread row — independent of how many groups
 * came back.
 *
 * These tests pin the two properties that matter and cannot be checked by
 * looking at the screen: that the badge is NOT the number of visible lines, and
 * that dismissing a line clears every event behind it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NotificationBell from "@/components/NotificationBell";
import { describeNotification } from "@/lib/notifications/describe";
import { subjectFromGroup } from "@/lib/notifications/adapters";

/* ── hermetic mocks ──────────────────────────────────────────────────────── */

vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/hooks/core/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/core/useNotificationSound", () => ({
  useNotificationSound: () => ({ playNotificationSound: () => {} }),
}));
vi.mock("@/hooks/core/useAdminIds", () => ({ useAdminIds: () => new Set<string>() }));
vi.mock("@/components/UserIdentityBlock", () => ({ default: () => <span>actor</span> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
}));

const markGroupRead = vi.fn((_ids: string[]) => Promise.resolve());
vi.mock("@/hooks/notifications/useNotificationHistory", () => ({
  markGroupRead: (ids: string[]) => markGroupRead(ids),
}));

const removeUserGroup = vi.fn();

/** A day's worth of comments from 33 people, collapsed by the database. */
const BIG_GROUP = {
  group_key: "post_comment|2026-08-02",
  type: "post_comment",
  notification_ids: ["n1", "n2", "n3", "n4"],
  actor_ids: ["a1", "a2", "a3"],
  actor_names: ["Partha Dalal", "Tanmay De", "Amit Sen"],
  actor_usernames: ["parthad", "tanmayd", "amits"],
  actor_avatars: ["", "", ""],
  actor_count: 33,
  event_count: 40,
  unread_count: 40,
  reference_id: "post-1",
  thumbnail_url: null,
  title: "New Comment",
  message: "Partha Dalal commented on your post",
  latest_at: new Date().toISOString(),
  total_unread: 47,
};

vi.mock("@/hooks/notifications/useNotificationsQuery", () => ({
  useNotificationsQuery: () => ({
    friendRequests: [],
    giftNotifications: [],
    adminNotifications: [],
    userNotifications: [BIG_GROUP],
    unreadTotal: 47,
    totalCount: 47,
    isLoading: false,
    cache: {
      bumpUnread: vi.fn(),
      insertFriendRequest: vi.fn(),
      removeFriendRequest: vi.fn(),
      insertGift: vi.fn(),
      removeGift: vi.fn(),
      insertAdminNotification: vi.fn(),
      removeAdminNotification: vi.fn(),
      removeUserGroup: (k: string) => removeUserGroup(k),
      clearAll: vi.fn(),
      patch: vi.fn(),
    },
  }),
}));

const openBell = () => fireEvent.click(screen.getByRole("button", { name: /notifications/i }));

beforeEach(() => {
  vi.clearAllMocks();
  render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>,
  );
});

describe("the badge is the server's count, not the number of lines on screen", () => {
  it("renders whatever the badge maths produced", () => {
    expect(screen.getByRole("button", { name: /notifications/i }).textContent).toContain("47");
  });

  it("says how many are not on screen instead of quietly stopping", () => {
    openBell();
    // 47 unread, 40 of them inside the one group shown => 7 unaccounted for.
    expect(screen.getByText(/7 more not shown here/i)).toBeTruthy();
  });
});

describe("one line per group, with the real numbers in it", () => {
  it("renders the aggregated sentence, not 40 rows", () => {
    openBell();
    // Two names then the true remainder from actor_count, and the true event
    // count in the verb — neither invented, both straight from the RPC.
    expect(screen.getByText(/and 31 others/i)).toBeTruthy();
    expect(screen.getByText(/left 40 comments on your photos\./i)).toBeTruthy();
  });

  it("says exactly what the history page would say about the same group", () => {
    openBell();
    const expected = describeNotification(subjectFromGroup(BIG_GROUP as any, new Set())).text;
    expect(screen.getByText(expected)).toBeTruthy();
    expect(expected).toBe(
      "Partha Dalal, Tanmay De and 31 others left 40 comments on your photos.",
    );
  });
});

describe("dismissing a group clears the whole group", () => {
  it("marks every notification id in it read, not just one", async () => {
    openBell();
    fireEvent.click(screen.getByTitle(/dismiss all 40/i));
    await waitFor(() => expect(markGroupRead).toHaveBeenCalledTimes(1));
    // The line said "and 31 others". Clearing one of them and leaving 39 behind
    // is the behaviour a member would call broken.
    expect(markGroupRead).toHaveBeenCalledWith(["n1", "n2", "n3", "n4"]);
    expect(removeUserGroup).toHaveBeenCalledWith("post_comment|2026-08-02");
  });
});
