/**
 * The bell with the notification centre switch ON (site_settings
 * notif_centre_ui). N7: one row = one link that opens the target; avatar,
 * sentence and time sit inside it (today: two links to the same place, the
 * avatar one with no accessible name); an unread dot; Dismiss stays separate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NotificationBell from "@/components/NotificationBell";
import { describeNotification } from "@/lib/notifications/describe";
import { subjectFromGroup } from "@/lib/notifications/adapters";

/* ── hermetic mocks ──────────────────────────────────────────────────────── */

vi.mock("@/lib/notifications/centreUi", () => ({ useCentreUi: () => true }));
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
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

beforeEach(() => {
  vi.clearAllMocks();
  render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>,
  );
});

describe("bell — centre rows (switch on)", () => {
  it("one link per row, holding the avatar and the sentence", async () => {
    openBell();
    const sentence = describeNotification(subjectFromGroup(BIG_GROUP as never, new Set())).text;
    const link = await screen.findByRole("link", { name: new RegExp("^Unread, " + esc(sentence)) });
    expect(link).toHaveAttribute("data-notif-row-open", "true");
    const row = link.parentElement!;
    const toTarget = [...row.querySelectorAll("a")].filter((a) => a.getAttribute("href") === link.getAttribute("href"));
    expect(toTarget).toHaveLength(1);
    expect(link.querySelectorAll("a, button").length).toBe(0);
  });

  it("shows the unread dot inside the row link", async () => {
    openBell();
    const link = await screen.findByRole("link", { name: /^Unread, / });
    expect(link.querySelector('[data-notif-unread-dot="true"]')).not.toBeNull();
  });

  it("keeps Dismiss as its own button outside the link", async () => {
    openBell();
    const dismiss = await screen.findByTitle(/Dismiss all 40/);
    expect(dismiss.closest('[data-notif-row-open="true"]')).toBeNull();
  });
});
