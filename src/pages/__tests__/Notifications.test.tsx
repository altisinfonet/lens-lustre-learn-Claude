/**
 * Tests for the /notifications screen.
 *
 * The one that matters most is the Follow back guard. PROJECT_MASTER_RECORD §0:
 * "absence of information must disable the action, never enable it." The Add
 * friend regression on 2026-07-31 happened precisely because unknown friendship
 * state was treated as "no friendship" and the button rendered anyway. The same
 * mistake here would show Follow back for someone the user already follows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

describe("/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFollowingSet.mockReturnValue({ following: new Set<string>(), ready: true });
  });

  it("renders the aggregated sentence with the real counts", () => {
    withGroups([
      group({
        type: "new_post_from_following",
        actor_ids: ["a1", "a2", "a3"],
        actor_usernames: ["aninditahidayat", "vickyroy87", "somnath"],
        actor_count: 5,
        event_count: 33,
      }),
    ]);
    renderPage();
    expect(screen.getByText(/aninditahidayat, vickyroy87/)).toBeInTheDocument();
    expect(screen.getByText(/shared 33 photos\./)).toBeInTheDocument();
  });

  it("shows Follow back for a new follower we are NOT following", () => {
    withGroups([group({ type: "new_follower", actor_usernames: ["kasprzwoo"] })]);
    renderPage();
    expect(screen.getByRole("button", { name: /follow back/i })).toBeInTheDocument();
  });

  it("hides Follow back for someone already followed", () => {
    mockFollowingSet.mockReturnValue({ following: new Set(["actor-1"]), ready: true });
    withGroups([group({ type: "new_follower" })]);
    renderPage();
    expect(screen.queryByRole("button", { name: /follow back/i })).not.toBeInTheDocument();
  });

  it("hides Follow back while follow state is still UNKNOWN (§0: unknown must disable)", () => {
    mockFollowingSet.mockReturnValue({ following: new Set<string>(), ready: false });
    withGroups([group({ type: "new_follower" })]);
    renderPage();
    expect(screen.queryByRole("button", { name: /follow back/i })).not.toBeInTheDocument();
  });

  it("never shows Follow back on a passive row", () => {
    withGroups([group({ type: "post_reaction" })]);
    renderPage();
    expect(screen.queryByRole("button", { name: /follow back/i })).not.toBeInTheDocument();
  });

  it("separates unread from read into New and Last 30 days", () => {
    const older = new Date(Date.now() - 5 * 86_400_000).toISOString();
    withGroups([
      group({ group_key: "unread", unread_count: 1 }),
      group({ group_key: "read", unread_count: 0, latest_at: older }),
    ]);
    renderPage();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Last 30 days")).toBeInTheDocument();
  });

  it("renders a thumbnail only when the RPC supplied one", () => {
    withGroups([
      group({ group_key: "with", thumbnail_url: "https://cdn.example/p.jpg" }),
      group({ group_key: "without", thumbnail_url: null }),
    ]);
    const { container } = renderPage();
    const imgs = [...container.querySelectorAll("img")].filter((i) =>
      (i.getAttribute("src") || "").includes("p.jpg"),
    );
    expect(imgs).toHaveLength(1);
  });

  it("shows an empty state rather than a blank screen", () => {
    withGroups([]);
    renderPage();
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });
});
