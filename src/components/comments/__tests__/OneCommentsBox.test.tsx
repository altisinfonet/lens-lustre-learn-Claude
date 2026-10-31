/**
 * BUG 3 — ONE COMMENTS BOX (Owner, 15 Oct 2026).
 *
 * "One comments box, the same for posts, ads, video posts and picture posts:
 * same features, same wording, one config." Posts had a search row, the emoji
 * row and "Add a comment for <owner>"; ads had none of the first two and said
 * "Write a comment..." and a different empty line.
 *
 * This draws the post box and the ad box side by side and reads the same
 * SHAPE off each — what a member can see and use — and requires the two to be
 * equal. Only what an ad's TABLES lack may differ (comment reactions, pinning,
 * the report item), and none of that is in the shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ThreadComment } from "@/components/comments/CommentThread";

const CREATIVE = "creative-1";
const AT = "2026-10-01T00:00:00Z";

vi.mock("@/hooks/profile/useProfileData", () => ({
  usePrefetchProfile: () => () => {},
  useProfileCore: () => ({ data: { full_name: "Viewer", avatar_url: null } }),
}));
vi.mock("@/components/UserIdentityBlock", () => ({
  default: ({ name }: { name: string | null }) => <span>{name}</span>,
}));
vi.mock("@/components/MentionInput", () => ({
  default: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "viewer-1" }, loading: false }) }));
vi.mock("@/hooks/core/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/core/useBlockedUsers", () => ({ useBlockedUsers: () => ({ blockedIds: new Set<string>() }) }));
vi.mock("@/hooks/profile/useProfileMap", () => ({
  useProfileMap: () => ({ profileMap: { u1: { full_name: "Asha", avatar_url: null, badges: [] }, u2: { full_name: "Ravi", avatar_url: null, badges: [] } } }),
}));
vi.mock("@/lib/adminBrand", () => ({
  getAdminIds: async () => new Set<string>(),
  resolveName: (_id: string, name: string | null) => name || "Photographer",
  resolveBadges: (_id: string, badges: string[]) => badges,
}));

let adRows: { id: string; creative_id: string; user_id: string; content: string; parent_id: string | null; created_at: string; updated_at: string | null }[] = [];
vi.mock("@/lib/ads/adEngagement", () => ({
  fetchAdComments: async () => adRows,
  addAdComment: vi.fn(async () => ({ error: null })),
  editAdComment: vi.fn(async () => ({ error: null })),
  deleteAdComment: vi.fn(async () => ({ error: null })),
}));

const postComment = (id: string, user: string, content: string): ThreadComment => ({
  id, user_id: user, content, created_at: AT, updated_at: AT, parent_id: null, is_pinned: false,
  author_name: user === "u1" ? "Asha" : "Ravi", author_handle: null, author_avatar: null, author_badges: [],
  author_last_active: null, like_count: 0, is_liked: false, replies: [],
});
const hookState = {
  comments: [] as ThreadComment[],
  loading: false,
  loaded: true,
  currentUserId: "viewer-1" as string | null,
  viewer: { full_name: "Viewer", avatar_url: null },
  isAdmin: false,
  canPin: false,
  submitting: false,
  editSubmitting: false,
  addComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
  toggleLike: vi.fn(),
  setReaction: vi.fn(),
  togglePin: vi.fn(),
  reportComment: vi.fn(),
  reload: vi.fn(),
};
vi.mock("@/hooks/feed/usePostComments", () => ({ usePostComments: () => hookState }));

import PostCommentsSection from "@/components/PostCommentsSection";
import AdComments from "@/components/ads/AdComments";
import { rememberAdThreadSubject } from "@/lib/ads/adThreadSubject";

const wrap = (node: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <div data-testid="box">{node}</div>
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** What a member can see and use in the box — the thing that must not differ. */
const shapeOf = (box: HTMLElement) => {
  const inputs = within(box).getAllByRole("textbox") as HTMLInputElement[];
  const composer = inputs.find((i) => i.placeholder !== "Search comments");
  return {
    searchRow: within(box).queryAllByRole("button", { name: /search/i }).length > 0,
    emojiRow: within(box).queryAllByRole("button", { name: /to your comment$/i }).length,
    // "Add a comment for <whose>" — the words, not the name.
    placeholder: (composer?.placeholder ?? "").replace(/ for .*$/, " for …"),
    sortSelector: within(box).queryAllByText(/Most relevant|Newest first/).length > 0,
    emptyLine: box.textContent?.match(/No comments yet\.[^A-Z]*?(Be the first to comment\.)?/)?.[0] ?? null,
  };
};

beforeEach(() => {
  cleanup();
  hookState.comments = [];
  adRows = [];
  rememberAdThreadSubject(CREATIVE, { owner: "Hideaway Resort and Hotel", headline: "Stay by the lake" });
});

const drawPost = async () => {
  wrap(<PostCommentsSection postId="post-1" postOwnerId="owner-1" postOwnerHandle="villagesquare" subjectLabel="Kathi Holi" />);
  return screen.getByTestId("box");
};
const drawAd = async () => {
  wrap(<AdComments creativeId={CREATIVE} />);
  const box = screen.getByTestId("box");
  await waitFor(() => expect(box.textContent).not.toContain("Loading comments…"));
  return box;
};

describe("bug 3 — the post box and the ad box are ONE box", () => {
  it("an empty thread: same search row, same emoji row, same placeholder words, same empty line", async () => {
    const post = shapeOf(await drawPost());
    cleanup();
    const ad = shapeOf(await drawAd());
    expect(post.searchRow && post.emojiRow > 0, "the post box itself has both rows").toBe(true);
    expect(ad).toEqual(post);
  });

  it("a thread with comments: same again, sort selector included", async () => {
    hookState.comments = [postComment("p1", "u1", "hello"), postComment("p2", "u2", "nice")];
    adRows = [
      { id: "a1", creative_id: CREATIVE, user_id: "u1", content: "hello", parent_id: null, created_at: AT, updated_at: null },
      { id: "a2", creative_id: CREATIVE, user_id: "u2", content: "nice", parent_id: null, created_at: AT, updated_at: null },
    ];
    const post = shapeOf(await drawPost());
    cleanup();
    const adBox = await drawAd();
    await within(adBox).findByText("nice");
    const ad = shapeOf(adBox);
    expect(post.sortSelector).toBe(true);
    expect(ad).toEqual(post);
  });

  it("the ad's placeholder names the ad the way its header does", async () => {
    const box = await drawAd();
    expect(within(box).getByPlaceholderText(/^Add a comment for Hideaway/)).toBeInTheDocument();
    // …and its search row says which ad these comments belong to, as a post's says which post.
    expect(within(box).getByRole("button", { name: /search/i })).toHaveTextContent("Stay by the lake");
  });
});
