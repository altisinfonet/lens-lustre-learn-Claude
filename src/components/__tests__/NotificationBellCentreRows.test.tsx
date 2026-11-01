/**
 * The bell with the notification centre switch ON (site_settings
 * notif_centre_ui). N7b: the bell's panel renders the SAME list as
 * /notifications (CentreNotificationList, fed by the same history query) —
 * one row = one button that opens the target, avatar/sentence/time/thumbnail
 * inside it, an unread dot, and its own actions beside it. Identity with the
 * page is pinned by notifications/__tests__/BellAndPageSameRows.test.tsx;
 * this file pins what the bell itself does with those rows.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NotificationBell from "@/components/NotificationBell";
import { describeNotification } from "@/lib/notifications/describe";
import { subjectFromGroup } from "@/lib/notifications/adapters";

/* ── hermetic mocks ──────────────────────────────────────────────────────── */

vi.mock("@/lib/notifications/centreUi", () => ({ useCentreUi: () => true }));
vi.mock("@/i18n/I18nContext", () => ({ useT: () => (_k: string, fb?: string) => fb ?? _k }));
let groups: Record<string, unknown>[] = [];
let historyLoading = false;
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/hooks/core/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/core/useNotificationSound", () => ({
  useNotificationSound: () => ({ playNotificationSound: () => {} }),
}));
vi.mock("@/hooks/core/useAdminIds", () => ({ useAdminIds: () => new Set<string>() }));
vi.mock("@/hooks/profile/useMemberHandles", () => ({ useMemberHandles: () => new Map<string, string>() }));
vi.mock("@/lib/video/postVideoRead", () => ({ fetchPostVideoMap: () => Promise.resolve(new Map()) }));
vi.mock("@/hooks/social/useFriendshipMutations", () => ({ useToggleFollow: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock("@/hooks/notifications/useMutualFollows", () => ({ useMutualFollowCounts: () => new Map() }));
vi.mock("@/hooks/notifications/useCommentPreviews", () => ({ useCommentPreviews: () => new Map() }));
const updatePreference = vi.fn();
vi.mock("@/hooks/notifications/useNotificationPreferences", () => ({
  useNotificationPreferences: () => ({ updatePreference: (f: string, v: boolean) => updatePreference(f, v) }),
}));
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => mockNavigate }));
const tagUpdate = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "in", "order", "limit"]) chain[m] = () => chain;
      chain.update = (v: unknown) => { tagUpdate(v); return chain; };
      chain.eq = () => chain;
      (chain as { then: unknown }).then = (r: (v: unknown) => void) => r({ data: [], error: null });
      return chain;
    },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
}));

const markGroupRead = vi.fn((_ids: string[]) => Promise.resolve());
const deleteGroup = vi.fn((_ids: string[]) => Promise.resolve());
vi.mock("@/hooks/notifications/useNotificationHistory", () => ({
  markGroupRead: (ids: string[]) => markGroupRead(ids),
  deleteGroup: (ids: string[]) => deleteGroup(ids),
  useFollowingSet: () => ({ following: new Set<string>(), ready: true }),
  useNotificationHistory: () => ({ data: historyLoading ? undefined : { pages: [groups] }, isLoading: historyLoading }),
  PAGE_SIZE: 25,
}));

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
};

let unreadInbox: Record<string, unknown>[] = [];
vi.mock("@/hooks/notifications/useNotificationsQuery", () => ({
  useNotificationsQuery: () => ({
    friendRequests: [],
    giftNotifications: [],
    adminNotifications: [],
    userNotifications: unreadInbox,
    unreadTotal: unreadInbox.length,
    totalCount: unreadInbox.length,
    isLoading: false,
    cache: {
      bumpUnread: vi.fn(), insertFriendRequest: vi.fn(), removeFriendRequest: vi.fn(), insertGift: vi.fn(),
      removeGift: vi.fn(), insertAdminNotification: vi.fn(), removeAdminNotification: vi.fn(),
      removeUserGroup: vi.fn(), clearAll: vi.fn(), patch: vi.fn(),
    },
  }),
}));

const openBell = () => fireEvent.click(screen.getByRole("button", { name: /^notifications$/i }));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const READ_FOLLOWER = { ...BIG_GROUP, group_key: "read-one", type: "new_follower", unread_count: 0, event_count: 1,
  actor_ids: ["r1"], actor_names: ["Read Person"], actor_usernames: ["readp"], actor_avatars: [""], actor_count: 1,
  reference_id: "r1", message: "Read Person started following you" };
const FINALIST = { ...BIG_GROUP, group_key: "fin", type: "entry_finalist", unread_count: 0, event_count: 1, actor_ids: [], actor_names: [],
  actor_usernames: [], actor_avatars: [], actor_count: 0, title: "You are a finalist!",
  message: 'Your entry in "Golden Hour" is a finalist.' };
const TAG = { ...BIG_GROUP, group_key: "tag", type: "post_tag", unread_count: 1, event_count: 1, actor_ids: ["t1"],
  actor_names: ["Tagger"], actor_usernames: ["tagger"], actor_avatars: [""], actor_count: 1, reference_id: "post-7" };

const renderBell = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  historyLoading = false;
  groups = [BIG_GROUP, READ_FOLLOWER, FINALIST, TAG];
  unreadInbox = [BIG_GROUP, TAG];
});

describe("bell — centre rows (switch on)", () => {
  it("shows the history (read rows too), not only the unread inbox", async () => {
    renderBell();
    openBell();
    const open = await screen.findByRole("button", { name: /Read Person started following you/ });
    expect(open.getAttribute("data-notif-row-open")).toBe("true");
    expect(open.querySelector('[data-notif-unread-dot="true"]')).toBeNull();
    expect(open.textContent?.startsWith("Unread")).toBe(false);
  });

  it("one button per row, holding the avatar and the sentence, with no control nested inside", async () => {
    renderBell();
    openBell();
    const { action } = describeNotification(subjectFromGroup(BIG_GROUP as never, new Set()));
    const open = await screen.findByRole("button", { name: new RegExp("^Unread, Partha Dalal.* " + esc(action)) });
    expect(open.querySelectorAll("a, button").length).toBe(0);
    expect(open.querySelector('[data-notif-unread-dot="true"]')).not.toBeNull();
  });

  it("opening a row marks the whole group read and goes to the post", async () => {
    renderBell();
    openBell();
    fireEvent.click(await screen.findByRole("button", { name: /^Unread, Partha Dalal/ }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(markGroupRead).toHaveBeenCalledWith(["n1", "n2", "n3", "n4"]);
  });

  it("Remove sits in the row's own ⋯ menu (no X on the row) and removes the group", async () => {
    renderBell();
    openBell();
    const row = (await screen.findByRole("button", { name: /Read Person started following you/ })).closest("[data-notif-row]")!;
    expect(row.querySelector('button[aria-label="Delete"]')).toBeNull();
    const more = row.querySelector('button[aria-label="More options"]') as HTMLButtonElement;
    expect(more.closest('[data-notif-row-open="true"]')).toBeNull();
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(deleteGroup).toHaveBeenCalledWith(["n1", "n2", "n3", "n4"]));
  });

  it("⋯ Turn off this kind writes the bell setting for that kind", async () => {
    renderBell();
    openBell();
    const row = (await screen.findByRole("button", { name: /Read Person started following you/ })).closest("[data-notif-row]")!;
    fireEvent.click(row.querySelector('button[aria-label="More options"]') as HTMLButtonElement);
    fireEvent.click(screen.getByRole("button", { name: "Turn off this kind" }));
    expect(updatePreference).toHaveBeenCalledWith("inapp_social", false);
  });

  it("a waiting photo tag can still be approved from the bell", async () => {
    renderBell();
    openBell();
    fireEvent.click(await screen.findByRole("button", { name: "Approve tag" }));
    await waitFor(() => expect(tagUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "approved" })));
  });

  it("an impersonal type leads with the app headline and keeps the server detail; a big moment is a card", async () => {
    renderBell();
    openBell();
    const open = await screen.findByRole("button", { name: /^You're a finalist Your entry in "Golden Hour" is a finalist\./ });
    expect(open.querySelector("strong")?.textContent).toBe("You're a finalist");
    expect(open.closest('[data-notif-big="true"]')).not.toBeNull();
  });

  it("a people type keeps its sentence and is not a card", async () => {
    renderBell();
    openBell();
    const open = await screen.findByRole("button", { name: /Read Person started following you/ });
    expect(open.closest('[data-notif-big="true"]')).toBeNull();
  });

  it("with no unread at all, read history still shows (no 'No new notifications')", async () => {
    unreadInbox = [];
    renderBell();
    openBell();
    expect(await screen.findByRole("button", { name: /Read Person started following you/ })).toBeTruthy();
    expect(screen.queryByText("No new notifications")).toBeNull();
  });

  it("N7b · on a phone-width screen (and the app) the bell opens the full /notifications page, not a dropdown", () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("max-width"), media: q, addEventListener: () => {}, removeEventListener: () => {} })) as never;
    try {
      renderBell();
      openBell();
      expect(mockNavigate).toHaveBeenCalledWith("/notifications");
      expect(document.getElementById("notification-panel")).toBeNull();
    } finally {
      window.matchMedia = mm;
    }
  });

  it("N7b · on a wide screen the dropdown keeps the same tabs as the page", async () => {
    renderBell();
    openBell();
    const tabs = await screen.findByRole("group", { name: "Filter notifications" });
    expect([...tabs.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["All", "Comments & mentions", "Follows", "Competitions"]);
    fireEvent.click(screen.getByRole("button", { name: "Follows" }));
    expect(screen.queryByRole("button", { name: /^Unread, Partha Dalal/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Read Person started following you/ })).toBeTruthy();
  });

  it("says Loading while the history is first read", () => {
    historyLoading = true;
    renderBell();
    openBell();
    expect(screen.getByText("Loading...")).toBeTruthy();
  });
});
