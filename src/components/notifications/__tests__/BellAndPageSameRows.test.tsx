/**
 * N7b · ONE notification view. The Owner, 2026-11-01, with every switch on:
 * the bell dropdown still showed the old layout (category headers such as
 * "Followers", a plain sentence, a grey X, no thumbnail, no Follow back) while
 * "See all" showed the new rows — "made from a single control system, why two
 * views?". The cause was two render paths: NotificationBell.tsx had its own
 * centre-row branch, /notifications had another.
 *
 * This renders the SAME notifications through the bell (opened) and through
 * /notifications, both with notif_centre_ui on, and asserts the sections and
 * every row come out byte-for-byte identical. It fails if either surface ever
 * grows its own row again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NotificationGroup } from "@/lib/notificationText";

let groups: NotificationGroup[] = [];

vi.mock("@/lib/notifications/centreUi", () => ({ useCentreUi: () => true }));
vi.mock("@/i18n/I18nContext", () => ({ useT: () => (_k: string, fb?: string) => fb ?? _k }));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/hooks/core/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/core/useNotificationSound", () => ({ useNotificationSound: () => ({ playNotificationSound: () => {} }) }));
vi.mock("@/hooks/core/useAdminIds", () => ({ useAdminIds: () => new Set<string>() }));
vi.mock("@/hooks/profile/useMemberHandles", () => ({ useMemberHandles: () => new Map<string, string>() }));
vi.mock("@/hooks/core/useNetworkQuality", () => ({ useNetworkQuality: () => ({ online: true }) }));
vi.mock("@/lib/video/postVideoRead", () => ({ fetchPostVideoMap: () => Promise.resolve(new Map()) }));
vi.mock("@/hooks/social/useFriendshipMutations", () => ({ useToggleFollow: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock("@/hooks/notifications/useMutualFollows", () => ({ useMutualFollowCounts: () => new Map([["f1", 2]]) }));
vi.mock("@/hooks/notifications/useCommentPreviews", () => ({
  useCommentPreviews: () => new Map([["c1", { commentId: "cm-1", content: "Lovely light on this one" }]]),
}));
vi.mock("@/hooks/notifications/useNotificationHistory", () => ({
  useNotificationHistory: () => ({
    data: { pages: [groups] },
    isLoading: false,
    isError: false,
    error: null,
    fetchStatus: "idle",
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
  useFollowingSet: () => ({ following: new Set<string>(), ready: true }),
  markGroupRead: vi.fn(() => Promise.resolve()),
  deleteGroup: vi.fn(() => Promise.resolve()),
  PAGE_SIZE: 25,
}));
vi.mock("@/hooks/notifications/useNotificationsQuery", () => ({
  useNotificationsQuery: () => ({
    friendRequests: [],
    giftNotifications: [],
    adminNotifications: [],
    userNotifications: groups.map((g) => ({ ...g, total_unread: 3 })),
    unreadTotal: 3,
    totalCount: 3,
    isLoading: false,
    cache: {
      bumpUnread: vi.fn(), insertFriendRequest: vi.fn(), removeFriendRequest: vi.fn(), insertGift: vi.fn(),
      removeGift: vi.fn(), insertAdminNotification: vi.fn(), removeAdminNotification: vi.fn(),
      removeUserGroup: vi.fn(), clearAll: vi.fn(), patch: vi.fn(),
    },
  }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "update", "delete", "order", "limit"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (r: (v: unknown) => void) => r({ data: [], error: null });
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve({ data: [], error: null }),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
      removeChannel: () => {},
    },
  };
});

import NotificationBell from "@/components/NotificationBell";
import Notifications from "@/pages/Notifications";

const now = Date.now();
const g = (over: Partial<NotificationGroup>): NotificationGroup => ({
  group_key: "k",
  type: "post_reaction",
  notification_ids: ["n"],
  actor_ids: ["a"],
  actor_names: ["Anindita Hidayat"],
  actor_usernames: ["anindita"],
  actor_avatars: ["https://example.test/a.jpg"],
  actor_count: 1,
  event_count: 1,
  unread_count: 1,
  reference_id: "post-1",
  thumbnail_url: "https://example.test/p.jpg",
  title: "t",
  message: "m",
  latest_at: new Date(now - 60_000).toISOString(),
  ...over,
});

const FIXTURE: NotificationGroup[] = [
  g({ group_key: "r1", actor_ids: ["a1", "a2"], actor_names: ["Anindita Hidayat", "Vicky Roy"], actor_usernames: ["anindita", "vicky"], actor_count: 2, event_count: 2 }),
  g({ group_key: "c1", type: "post_comment", actor_ids: ["c"], actor_names: ["Somnath Pal"], actor_usernames: ["somnath"] }),
  g({ group_key: "f1", type: "new_follower", actor_ids: ["f1"], actor_names: ["Rita Sen"], actor_usernames: ["rita"], reference_id: "f1", thumbnail_url: null }),
  g({ group_key: "w1", type: "entry_finalist", actor_ids: [], actor_names: [], actor_usernames: [], actor_avatars: [], actor_count: 0,
    title: "You are a finalist!", message: 'Your entry in "Golden Hour" is a finalist.', unread_count: 0,
    latest_at: new Date(now - 3 * 86_400_000).toISOString() }),
  g({ group_key: "o1", unread_count: 0, latest_at: new Date(now - 60 * 86_400_000).toISOString() }),
];

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
};

/** What a member sees: the section headings and each row's full markup, in order. */
function read(root: HTMLElement) {
  const sections = Array.from(root.querySelectorAll("[data-notif-section]")).map((s) => ({
    key: s.getAttribute("data-notif-section"),
    heading: s.querySelector("h2, h3")?.textContent ?? "",
    rows: Array.from(s.querySelectorAll('[data-notif-row-open="true"]')).map((o) => o.parentElement!.outerHTML),
  }));
  const rows = Array.from(root.querySelectorAll('[data-notif-row-open="true"]')).map((o) => o.parentElement!.outerHTML);
  return { sections, rows };
}

beforeEach(() => {
  cleanup();
  groups = FIXTURE;
});

describe("N7b · the bell and /notifications show one view", () => {
  it("the same notifications render the same sections and the same rows in both places", () => {
    const bell = wrap(<NotificationBell />);
    fireEvent.click(bell.getByRole("button", { name: /notifications/i }));
    const fromBell = read(bell.container);
    cleanup();

    const page = wrap(<Notifications />);
    const fromPage = read(page.container);

    expect(fromPage.rows.length).toBe(FIXTURE.length);
    expect(fromBell.rows).toEqual(fromPage.rows);
    expect(fromPage.sections.length).toBeGreaterThan(0);
    expect(fromBell.sections).toEqual(fromPage.sections);
  });

  it("the bell has no category headers of its own (no 'Reactions', 'Followers', 'Comments')", () => {
    const bell = wrap(<NotificationBell />);
    fireEvent.click(bell.getByRole("button", { name: /notifications/i }));
    const headings = Array.from(bell.container.querySelectorAll("#notification-panel span, #notification-panel h2, #notification-panel h3"))
      .map((e) => e.textContent?.trim());
    for (const old of ["Reactions", "Followers", "Comments", "Competition Updates"]) expect(headings).not.toContain(old);
  });
});
