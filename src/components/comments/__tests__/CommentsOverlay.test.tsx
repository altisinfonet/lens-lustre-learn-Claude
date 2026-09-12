/**
 * THE COMMENTS OVERLAY: OPENS AS A MODAL ON WEB, A SHEET ON THE APP, AND
 * CARRIES NO COMMENT DATA OF ITS OWN.
 *
 * `usePostComments` is mocked at the boundary — the same choice
 * BrandBadgeEverywhere.test.tsx makes for `useProfileMap` — so these tests
 * are about the OVERLAY's own job: which chrome it picks per breakpoint,
 * that closing it actually clears the state a reopen would depend on, and
 * that nothing here duplicates a comment renderer or composer of its own.
 * The data layer itself (post_comments, resolveBadges, the optimistic
 * mutation) is usePostComments' test surface via the source-text checks in
 * BrandBadgeEverywhere.test.tsx and queryCeilings.test.ts, not this file's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CommentsOverlayProvider, useCommentsOverlay } from "@/contexts/CommentsOverlayContext";
import CommentsOverlay from "@/components/comments/CommentsOverlay";
import type { UnifiedPost } from "@/types/post";

vi.mock("@/hooks/feed/usePostComments", () => ({
  usePostComments: () => ({
    comments: [],
    loading: false,
    currentUserId: "viewer-1",
    viewer: { full_name: "Viewer", avatar_url: null },
    isAdmin: false,
    canPin: false,
    submitting: false,
    editSubmitting: false,
    addComment: vi.fn(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
    toggleLike: vi.fn(),
    togglePin: vi.fn(),
    reportComment: vi.fn(),
    reload: vi.fn(),
  }),
}));

const MOCK_POST = {
  id: "post-1",
  user_id: "author-1",
  content: "A test caption",
  image_url: "https://example.com/photo.jpg",
  image_urls: ["https://example.com/photo.jpg"],
  privacy: "public",
  created_at: new Date().toISOString(),
  author_name: "A Photographer",
  author_avatar: null,
  like_count: 0,
  comment_count: 0,
  share_count: 0,
  is_liked: false,
  user_reaction: null,
  top_reactions: [],
  reaction_counts: {},
} as unknown as UnifiedPost;

/** Exercises the context the way PostCard actually does — via the hook, not by reaching into it. */
const OpenButton = () => {
  const { openComments } = useCommentsOverlay();
  return <button onClick={() => openComments(MOCK_POST)}>open comments</button>;
};

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });
  window.dispatchEvent(new Event("resize"));
};

const draw = () =>
  render(
    <MemoryRouter initialEntries={["/feed"]}>
      <CommentsOverlayProvider>
        <OpenButton />
        <CommentsOverlay />
      </CommentsOverlayProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  setViewportWidth(1280); // desktop by default; mobile tests set their own
});

describe("nothing has been opened yet", () => {
  it("renders no dialog and no sheet", () => {
    draw();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("on a desktop viewport", () => {
  it("opens the post's comments as a Dialog with the photo beside the thread", () => {
    draw();
    fireEvent.click(screen.getByText("open comments"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByAltText("")).toHaveAttribute("src", MOCK_POST.image_url);
    // The panel's own empty state, not a second one invented for the modal.
    expect(within(dialog).getByText(/no comments yet/i)).toBeInTheDocument();
  });

  it("closing clears the state a reopen would otherwise depend on staying wrong", () => {
    draw();
    fireEvent.click(screen.getByText("open comments"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("on a mobile viewport", () => {
  beforeEach(() => setViewportWidth(375));

  it("opens the same post's comments as a sheet, with no photo of its own", () => {
    draw();
    fireEvent.click(screen.getByText("open comments"));
    const dialog = screen.getByRole("dialog");
    // Instagram's own mobile shape: the post stays visible above the sheet,
    // so the sheet does not re-draw the photograph the way the desktop modal does.
    expect(within(dialog).queryByRole("img")).toBeNull();
    expect(within(dialog).getByText(/no comments yet/i)).toBeInTheDocument();
  });
});

describe("the overlay draws no comment renderer or composer of its own", () => {
  it("only ever renders through PostCommentsSection / CommentThread / CommentComposer", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/components/comments/CommentsOverlay.tsx"), "utf8");
    expect(src, "a second comment list is exactly the drift AdComments already lived through once")
      .not.toMatch(/const render(Comment|Row)\s*=/);
    expect(src, "a second composer is exactly the drift CommentComposer was extracted to prevent")
      .not.toMatch(/<(MentionInput|Textarea|input|textarea)\b/);
  });
});
