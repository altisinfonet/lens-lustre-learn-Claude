/**
 * /notifications with the notification centre switch ON (site_settings
 * notif_centre_ui). N7: one row = one control; names are plain bold text, so
 * a screen reader meets no link nested inside the row's button (video-runner
 * Owner item 7). With the switch OFF, Notifications.test.tsx covers today's rows.
 *
 * (Original header of the sibling file follows.)
 * Tests for the /notifications screen.
 *
 * The one that matters most is the Follow back guard. PROJECT_MASTER_RECORD §0:
 * "absence of information must disable the action, never enable it." The Add
 * friend regression on 2026-07-31 happened precisely because unknown friendship
 * state was treated as "no friendship" and the button rendered anyway. The same
 * mistake here would show Follow back for someone the user already follows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NotificationGroup } from "@/lib/notificationText";

const mockHistory = vi.fn();
const mockFollowingSet = vi.fn();

vi.mock("@/hooks/notifications/useNotificationHistory", () => ({
  useNotificationHistory: () => mockHistory(),
  useFollowingSet: () => mockFollowingSet(),
  markGroupRead: vi.fn(),
  PAGE_SIZE: 25,
}));

vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/hooks/social/useFriendshipMutations", () => ({
  useToggleFollow: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/notifications/centreUi", () => ({ useCentreUi: () => true }));
vi.mock("@/i18n/I18nContext", () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}));

import Notifications from "@/pages/Notifications";

const group = (over: Partial<NotificationGroup> = {}): NotificationGroup => ({
  group_key: "g1",
  type: "post_reaction",
  notification_ids: ["n1"],
  actor_ids: ["actor-1"],
  actor_names: ["Anindita"],
  actor_usernames: ["aninditahidayat"],
  actor_avatars: [""],
  actor_count: 1,
  event_count: 1,
  unread_count: 1,
  reference_id: null,
  thumbnail_url: null,
  title: "t",
  message: "m",
  latest_at: new Date().toISOString(),
  ...over,
});

const withGroups = (groups: NotificationGroup[]) => {
  mockHistory.mockReturnValue({
    data: { pages: [groups] },
    isLoading: false,
    isError: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  });
};

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("/notifications — centre rows (switch on)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFollowingSet.mockReturnValue({ following: new Set<string>(), ready: true });
  });

  it("puts no link inside the row's open button; names are bold text", () => {
    withGroups([
      group({
        type: "new_post_from_following",
        actor_ids: ["a1", "a2", "a3"],
        actor_names: ["Anindita Hidayat", "Vicky Roy", "Somnath Pal"],
        actor_usernames: ["aninditahidayat", "vickyroy87", "somnath"],
        actor_count: 5,
        event_count: 33,
      }),
    ]);
    const { container } = renderPage();
    const open = container.querySelector('[data-notif-row-open="true"]');
    expect(open).not.toBeNull();
    expect(open!.querySelectorAll("a, button").length).toBe(0);
    expect(container.querySelectorAll("a[href='/aninditahidayat']").length).toBe(0);
    const name = screen.getByText("Anindita Hidayat");
    expect(name.tagName).toBe("STRONG");
  });

  it("names the whole sentence once, as the row button's accessible name", () => {
    withGroups([group({ type: "post_reaction", actor_names: ["Anindita"], actor_usernames: ["aninditahidayat"] })]);
    renderPage();
    const btn = screen.getByRole("button", { name: /^Unread, Anindita reacted to your photo\./ });
    expect(btn).toHaveAttribute("data-notif-row-open", "true");
  });

  it("shows an unread dot only on unread rows", () => {
    withGroups([
      group({ group_key: "u", unread_count: 1, actor_names: ["Unread Person"] }),
      group({ group_key: "r", unread_count: 0, actor_names: ["Read Person"] }),
    ]);
    const { container } = renderPage();
    const dots = container.querySelectorAll('[data-notif-unread-dot="true"]');
    expect(dots.length).toBe(1);
    expect(dots[0].closest('[data-notif-row-open="true"]')).toHaveTextContent("Unread Person");
  });

  it("the picture is part of the one row control, not a second tab stop", () => {
    withGroups([group({ thumbnail_url: "https://cdn.example/p.jpg" })]);
    const { container } = renderPage();
    const img = container.querySelector('img[src="https://cdn.example/p.jpg"]');
    expect(img).not.toBeNull();
    expect(img!.closest('[data-notif-row-open="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-notif-row-open="true"]').length).toBe(1);
  });

  it("keeps Follow back and Delete as their own buttons beside the row", () => {
    withGroups([group({ type: "new_follower", actor_usernames: ["kasprzwoo"] })]);
    renderPage();
    const follow = screen.getByRole("button", { name: /follow back/i });
    expect(follow.closest('[data-notif-row-open="true"]')).toBeNull();
    const del = screen.getByRole("button", { name: /^delete$/i });
    expect(del.closest('[data-notif-row-open="true"]')).toBeNull();
  });
});

describe("/notifications — tabs (switch on)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFollowingSet.mockReturnValue({ following: new Set<string>(), ready: true });
  });

  const three = () => withGroups([
    group({ group_key: "c", type: "post_comment", actor_names: ["Commenter"] }),
    group({ group_key: "f", type: "new_follower", actor_names: ["Follower"] }),
    group({ group_key: "r", type: "post_reaction", actor_names: ["Reactor"] }),
  ]);

  it("shows four tab buttons, All pressed, every row visible", () => {
    three();
    renderPage();
    const tabs = screen.getByRole("group", { name: "Filter notifications" });
    const pressed = Array.from(tabs.querySelectorAll("button")).map((b) => [b.textContent, b.getAttribute("aria-pressed")]);
    expect(pressed).toEqual([["All", "true"], ["Comments & mentions", "false"], ["Follows", "false"], ["Competitions", "false"]]);
    expect(screen.getByText("Commenter")).toBeInTheDocument();
    expect(screen.getByText("Follower")).toBeInTheDocument();
    expect(screen.getByText("Reactor")).toBeInTheDocument();
  });

  it("a tab shows only its rows, and an empty tab says so", async () => {
    three();
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Comments & mentions" }));
    expect(screen.getByRole("button", { name: "Comments & mentions" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Commenter")).toBeInTheDocument();
    expect(screen.queryByText("Follower")).toBeNull();
    expect(screen.queryByText("Reactor")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Competitions" }));
    expect(screen.getByText("Nothing in this tab yet.")).toBeInTheDocument();
  });

  it("an empty tab with older pages still to load says older ones may have some", () => {
    mockHistory.mockReturnValue({
      data: { pages: [[group({ type: "post_reaction" })]] },
      isLoading: false, isError: false, fetchNextPage: vi.fn(), hasNextPage: true, isFetchingNextPage: false,
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Follows" }));
    expect(screen.getByText("Nothing in this tab yet. Older notifications may have some.")).toBeInTheDocument();
    expect(screen.queryByText("Nothing here yet.")).toBeNull();
    expect(screen.getByRole("button", { name: "Load older notifications" })).toBeInTheDocument();
  });
});

describe("/notifications — app headlines (switch on)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFollowingSet.mockReturnValue({ following: new Set<string>(), ready: true });
  });

  it("an impersonal type leads with the app headline and keeps the server detail", () => {
    withGroups([group({ type: "entry_shortlisted", actor_ids: [], actor_names: [], actor_usernames: [], actor_avatars: [],
      actor_count: 0, unread_count: 0, message: 'Your entry in "Golden Hour" has been shortlisted.' })]);
    renderPage();
    const btn = screen.getByRole("button", { name: /^Entry shortlisted Your entry in "Golden Hour" has been shortlisted\./ });
    expect(btn.querySelector("strong")?.textContent).toBe("Entry shortlisted");
    expect(btn.closest('[data-notif-big="true"]')).toBeNull();
  });

  it("a big moment is a highlighted card", () => {
    withGroups([group({ type: "competition_winner", actor_ids: [], actor_names: [], actor_usernames: [], actor_avatars: [],
      actor_count: 0, message: 'Your entry in "Golden Hour" received: top_100.' })]);
    const { container } = renderPage();
    expect(container.querySelector('[data-notif-big="true"]')).not.toBeNull();
    expect(screen.getByText("Your entry won an award").tagName).toBe("STRONG");
  });

  it("an unread big-moment card still says Unread and shows the dot", () => {
    withGroups([group({ type: "entry_finalist", unread_count: 1, actor_ids: [], actor_names: [], actor_usernames: [],
      actor_avatars: [], actor_count: 0, message: 'Your entry in "Golden Hour" is a finalist.' })]);
    renderPage();
    const btn = screen.getByRole("button", { name: /^Unread, You're a finalist Your entry/ });
    expect(btn.querySelector('[data-notif-unread-dot="true"]')).not.toBeNull();
    expect(btn.closest('[data-notif-big="true"]')).not.toBeNull();
  });
});
