/**
 * BUG-VID-HOME · a notification about a VIDEO post shows the video's poster
 * (VideoPoster, the shared small-thumbnail component) — not an empty slot,
 * which is what it showed while the thumbnail was only ever the post's photo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NotificationGroup } from "@/lib/notificationText";

const mockHistory = vi.fn();
const mockVideoMap = vi.fn();

vi.mock("@/hooks/notifications/useNotificationHistory", () => ({
  useNotificationHistory: () => mockHistory(),
  useFollowingSet: () => ({ following: new Set<string>(), ready: true }),
  markGroupRead: vi.fn(),
  PAGE_SIZE: 25,
}));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/hooks/social/useFriendshipMutations", () => ({
  useToggleFollow: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/i18n/I18nContext", () => ({ useT: () => (_k: string, f?: string) => f ?? _k }));
vi.mock("@/lib/video/postVideoRead", () => ({ fetchPostVideoMap: (ids: string[]) => mockVideoMap(ids) }));
// The real poster has its own behaviour (play grant, lazy); here the question is only WHICH component draws the slot.
vi.mock("@/components/video/VideoPoster", () => ({
  default: ({ video }: { video: { id: string } }) => <div data-testid="video-poster" data-video={video.id} />,
}));

import Notifications from "@/pages/Notifications";

const VIDEO_POST = "11111111-1111-4111-8111-111111111111";
const PHOTO_POST = "22222222-2222-4222-8222-222222222222";
const HIDDEN_POST = "44444444-4444-4444-8444-444444444444";
const V = { id: "33333333-3333-4333-8333-333333333333", width: 1080, height: 1920, durationS: 12, hasAudio: true };

const group = (over: Partial<NotificationGroup>): NotificationGroup => ({
  group_key: "g", type: "post_reaction", notification_ids: ["n"], actor_ids: ["a"], actor_names: ["Ana"],
  actor_usernames: ["ana"], actor_avatars: [""], actor_count: 1, event_count: 1, unread_count: 0,
  reference_id: null, thumbnail_url: null, title: "t", message: "m", latest_at: new Date().toISOString(), ...over,
});

const renderWith = (groups: NotificationGroup[]) => {
  mockHistory.mockReturnValue({ data: { pages: [groups] }, isLoading: false, isError: false, fetchNextPage: vi.fn(), hasNextPage: false, isFetchingNextPage: false });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><Notifications /></MemoryRouter></QueryClientProvider>);
};

describe("/notifications — post thumbnails know about video", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a video post's notification shows its poster; a photo post's keeps its photo; one batched read", async () => {
    mockVideoMap.mockResolvedValue(new Map<string, typeof V | "hidden">([[VIDEO_POST, V], [HIDDEN_POST, "hidden"]]));
    const { container } = renderWith([
      group({ group_key: "v", reference_id: VIDEO_POST }),
      group({ group_key: "p", reference_id: PHOTO_POST, thumbnail_url: "https://cdn.example/p.jpg" }),
      group({ group_key: "h", reference_id: HIDDEN_POST }),
    ]);
    await waitFor(() => expect(screen.getByTestId("video-poster")).toHaveAttribute("data-video", V.id));
    expect(screen.getAllByTestId("video-poster")).toHaveLength(1); // the hidden video shows nothing
    expect(container.querySelector('img[src="https://cdn.example/p.jpg"]')).not.toBeNull();
    // Only rows WITHOUT a photograph are asked about, all in one call.
    expect(mockVideoMap).toHaveBeenCalledTimes(1);
    expect(mockVideoMap.mock.calls[0][0]).toEqual([VIDEO_POST, HIDDEN_POST].sort());
  });

  it("no lookup at all when every row already has its photograph or no post", () => {
    renderWith([group({ reference_id: PHOTO_POST, thumbnail_url: "https://cdn.example/p.jpg" }), group({ group_key: "x" })]);
    expect(mockVideoMap).not.toHaveBeenCalled();
    expect(screen.queryByTestId("video-poster")).toBeNull();
  });
});
