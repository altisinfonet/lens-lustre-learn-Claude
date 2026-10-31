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
import { adMedia } from "@/lib/posts/subjectMedia";

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

/**
 * The ad thread's own boundary — same choice as usePostComments above. This
 * suite is about the overlay's OWN job (which chrome, which thread it hands
 * the chrome to), not AdComments' data plumbing — that is
 * StoryCardComments.test.tsx's surface.
 */
// PostCommentsSection reads the viewer's block list; this test has no
// QueryClientProvider, and blocking is not what it is about.
vi.mock("@/hooks/core/useBlockedUsers", () => ({
  useBlockedUsers: () => ({
    blockedIds: new Set<string>(),
    blockedRows: [],
    isBlocked: () => false,
    block: () => {},
    unblock: () => {},
    blocking: false,
    unblocking: false,
    isLoading: false,
  }),
}));

// The real card has its own suite (FeedVideoCard.test.tsx); here the question is
// only whether the overlay hands the subject's video to it.
vi.mock("@/components/video/FeedVideoCard", () => ({
  default: ({ video, fillParent }: { video: { id: string }; fillParent?: boolean }) => (
    <div data-testid="feed-video-card" data-fill-parent={String(!!fillParent)}>video {video.id}</div>
  ),
}));

vi.mock("@/components/ads/AdComments", () => ({
  default: ({ creativeId }: { creativeId: string }) => (
    <div data-testid="ad-comments-stub">ad thread for {creativeId}</div>
  ),
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
  const { openPostComments } = useCommentsOverlay();
  return <button onClick={() => openPostComments(MOCK_POST)}>open comments</button>;
};

const AD_CREATIVE_ID = "ad-creative-1";
const AD_IMAGE_URL = "https://example.com/ad.jpg";

/** Exercises the context the way AdEngagementBar actually does. */
const OpenAdButton = () => {
  const { openAdComments } = useCommentsOverlay();
  return <button onClick={() => openAdComments(AD_CREATIVE_ID, adMedia({ image_url: AD_IMAGE_URL }))}>open ad comments</button>;
};

const VIDEO = { id: "33333333-3333-4333-8333-333333333333", width: 1080, height: 1920, durationS: 20, hasAudio: true };
const VIDEO_POST = { ...MOCK_POST, id: "post-video-1", image_url: null, image_urls: [], video: VIDEO } as unknown as UnifiedPost;

/** A video ad: the card plays the video, so the comments box must too (Owner, staging 2026-10-12). */
const OpenVideoAdButton = () => {
  const { openAdComments } = useCommentsOverlay();
  return <button onClick={() => openAdComments(AD_CREATIVE_ID, adMedia({ video: VIDEO, image_url: AD_IMAGE_URL }))}>open video ad comments</button>;
};
const OpenVideoPostButton = () => {
  const { openPostComments } = useCommentsOverlay();
  return <button onClick={() => openPostComments(VIDEO_POST)}>open video post comments</button>;
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
        <OpenAdButton />
        <OpenVideoAdButton />
        <OpenVideoPostButton />
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

/**
 * "In the Ads section same type of commenting not happening exactly like
 * posts" (owner, 2026-09-12) — the sponsored story card still expanded its
 * thread inline while a post's opened in this overlay. These three tests are
 * the ad-side mirror of the post ones above: same modal, same close-clears-
 * state guarantee, same sheet on mobile — proving it is the ONE overlay, not
 * a second implementation for ads.
 */
describe("the same overlay opens an ad's thread", () => {
  it("on desktop, as a Dialog with the ad's own picture beside it", () => {
    draw();
    fireEvent.click(screen.getByText("open ad comments"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByAltText("")).toHaveAttribute("src", AD_IMAGE_URL);
    expect(within(dialog).getByTestId("ad-comments-stub")).toHaveTextContent(AD_CREATIVE_ID);
  });

  it("on mobile, as a sheet with no photo of its own", () => {
    setViewportWidth(375);
    draw();
    fireEvent.click(screen.getByText("open ad comments"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("img")).toBeNull();
    expect(within(dialog).getByTestId("ad-comments-stub")).toBeInTheDocument();
  });

  it("closing clears the state a reopen would otherwise depend on staying wrong", () => {
    draw();
    fireEvent.click(screen.getByText("open ad comments"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never opens a post's thread and an ad's thread as the same subject", () => {
    // Opening the ad after the post replaces the subject rather than merging
    // it — there is one panel open at a time, whichever was tapped last.
    draw();
    fireEvent.click(screen.getByText("open comments"));
    expect(screen.getByRole("dialog")).toHaveTextContent(/no comments yet/i);
    fireEvent.click(screen.getByText("open ad comments"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByTestId("ad-comments-stub")).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/no comments yet/i);
  });
});

describe("the comments box shows what the card shows — a video plays there too", () => {
  it("a video ad: its video beside the thread, never its still picture", async () => {
    draw();
    fireEvent.click(screen.getByText("open video ad comments"));
    const dialog = screen.getByRole("dialog");
    const card = await within(dialog).findByTestId("feed-video-card");
    expect(card).toHaveTextContent(VIDEO.id);
    expect(card).toHaveAttribute("data-fill-parent", "true");
    expect(within(dialog).queryByAltText("")).toBeNull();
    expect(dialog.innerHTML).not.toContain(AD_IMAGE_URL);
    expect(within(dialog).getByTestId("ad-comments-stub")).toBeInTheDocument();
  });

  it("a video post: its video beside the thread (it used to show nothing at all)", async () => {
    draw();
    fireEvent.click(screen.getByText("open video post comments"));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByTestId("feed-video-card")).toHaveTextContent(VIDEO.id);
    expect(within(dialog).getByText(/no comments yet/i)).toBeInTheDocument();
  });

  it("a photo post still shows its photograph, and no video card", () => {
    draw();
    fireEvent.click(screen.getByText("open comments"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByAltText("")).toHaveAttribute("src", MOCK_POST.image_url);
    expect(within(dialog).queryByTestId("feed-video-card")).toBeNull();
  });

  it("on mobile the sheet draws no media of its own — the card stays in view above it", () => {
    setViewportWidth(375);
    draw();
    fireEvent.click(screen.getByText("open video ad comments"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByTestId("feed-video-card")).toBeNull();
    expect(within(dialog).queryByRole("img")).toBeNull();
  });
});

describe("the overlay draws no comment renderer or composer of its own", () => {
  it("only ever renders through PostCommentsSection / AdComments / CommentThread / CommentComposer", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/components/comments/CommentsOverlay.tsx"), "utf8");
    expect(src, "a second comment list is exactly the drift AdComments already lived through once")
      .not.toMatch(/const render(Comment|Row)\s*=/);
    expect(src, "a second composer is exactly the drift CommentComposer was extracted to prevent")
      .not.toMatch(/<(MentionInput|Textarea|input|textarea)\b/);
    // The ad path hands off to AdComments the same way the post path hands
    // off to PostCommentsSection — not a hand-rolled ad thread drawn here.
    expect(src).toMatch(/<AdComments\b/);
  });
});
