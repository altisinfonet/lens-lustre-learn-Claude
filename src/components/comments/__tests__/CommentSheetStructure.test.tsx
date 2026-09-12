/**
 * THE COMMENT PANEL'S STRUCTURE — the six things the owner's reference
 * screenshots specify, asserted on the assembled panel rather than on any one
 * piece of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY PostCommentsSection AND NOT CommentThread
 *
 * Four of the six are relationships BETWEEN the parts: the search row filters
 * what the thread draws; the emoji row writes into the composer's draft; the
 * composer's placeholder comes from the post whose sheet this is. Mounted
 * separately each piece passes while the panel is still wrong. `usePostComments`
 * is mocked at the boundary — the same choice CommentsOverlay.test.tsx makes —
 * so this is about layout and wiring, never about post_comments.
 *
 * ⚠ EVERY ASSERTION HERE FAILED BEFORE THIS UNIT. Run against the panel as it
 * stood on staging: there was no search row, no emoji row, no heart rail, the
 * placeholder was the generic "Write a comment...", and an old comment was
 * dated "Aug 20" rather than "5w". Recorded in
 * docs/evidence/d2/comments-sheet-redesign/.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ThreadComment } from "@/components/comments/CommentThread";

vi.mock("@/hooks/profile/useProfileData", () => ({
  usePrefetchProfile: () => () => {},
}));
vi.mock("@/components/UserIdentityBlock", () => ({
  default: ({ name }: { name: string | null }) => <span>{name}</span>,
}));
/**
 * A real controlled input, not a stub that throws its value away — the emoji
 * row's whole contract is that the character lands in the DRAFT, and a
 * read-only stub could not tell a working row from a dead one.
 */
vi.mock("@/components/MentionInput", () => ({
  default: ({
    value,
    onChange,
    placeholder,
    disabled,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    disabled?: boolean;
  }) => (
    <input
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const toggleLike = vi.fn();
const hookState = {
  comments: [] as ThreadComment[],
  loading: false,
  currentUserId: "viewer-1" as string | null,
  viewer: { full_name: "Viewer", avatar_url: null },
  isAdmin: false,
  canPin: false,
  submitting: false,
  editSubmitting: false,
  addComment: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
  toggleLike,
  setReaction: vi.fn(),
  togglePin: vi.fn(),
  reportComment: vi.fn(),
  reload: vi.fn(),
};
vi.mock("@/hooks/feed/usePostComments", () => ({
  usePostComments: () => hookState,
}));

import PostCommentsSection from "@/components/PostCommentsSection";

const WEEKS_5_AGO = new Date(Date.now() - 35 * 86_400_000).toISOString();

let seq = 0;
const comment = (over: Partial<ThreadComment> = {}): ThreadComment => ({
  id: `c${++seq}`,
  user_id: `u${seq}`,
  content: "",
  created_at: WEEKS_5_AGO,
  updated_at: WEEKS_5_AGO,
  parent_id: null,
  is_pinned: false,
  author_name: "Neil Basu",
  author_handle: "neilbasu",
  author_avatar: null,
  author_badges: [],
  author_last_active: null,
  like_count: 0,
  is_liked: false,
  replies: [],
  ...over,
});

const draw = (props: Partial<React.ComponentProps<typeof PostCommentsSection>> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <PostCommentsSection postId="post-1" postOwnerId="author-1" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  hookState.comments = [];
  hookState.currentUserId = "viewer-1";
  hookState.submitting = false;
});

/* ─────────────── 2. search within the comments ─────────────── */
describe("the search row", () => {
  it("rests as one row naming what is being searched, and opens into a real box", () => {
    draw({ subjectLabel: "Kathi Holi Nandurbar" });

    const rest = screen.getByRole("button", { name: /search/i });
    expect(rest).toHaveTextContent("Search");
    expect(rest, "the row says WHICH post's comments these are").toHaveTextContent(
      "Kathi Holi Nandurbar",
    );
    expect(screen.queryByLabelText("Search comments")).toBeNull();

    fireEvent.click(rest);
    expect(screen.getByLabelText("Search comments")).toBeInTheDocument();
  });

  it("filters the thread to matches, and keeps a matching reply's parent for context", () => {
    hookState.comments = [
      comment({
        content: "Congratulations",
        author_name: "Neil Basu",
        replies: [comment({ content: "Thank you for all your support", author_name: "Somnath" })],
      }),
      comment({ content: "Lovely colours", author_name: "Framo" }),
    ];
    draw();

    expect(screen.getByText("Lovely colours")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.change(screen.getByLabelText("Search comments"), { target: { value: "support" } });

    expect(screen.getByText("Thank you for all your support")).toBeInTheDocument();
    expect(screen.getByText("Congratulations"), "the parent is kept as context").toBeInTheDocument();
    expect(screen.queryByText("Lovely colours")).toBeNull();
  });

  it("says so when nothing matches, instead of claiming the post has no comments", () => {
    hookState.comments = [comment({ content: "Lovely colours" })];
    draw();

    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.change(screen.getByLabelText("Search comments"), { target: { value: "zzzz" } });

    expect(screen.getByRole("status")).toHaveTextContent(/no comments match/i);
    expect(
      screen.queryByText(/be the first to comment/i),
      "a post with comments must never be described as having none",
    ).toBeNull();
  });

  it("closing the box clears the query, so the whole thread is back", () => {
    hookState.comments = [comment({ content: "Lovely colours" })];
    draw();

    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.change(screen.getByLabelText("Search comments"), { target: { value: "zzzz" } });
    expect(screen.queryByText("Lovely colours")).toBeNull();

    fireEvent.click(screen.getByLabelText("Close comment search"));
    expect(screen.getByText("Lovely colours")).toBeInTheDocument();
  });
});

/* ─────────────── 3. the comment row ─────────────── */
describe("one comment row", () => {
  it("carries name, a relative age in weeks, the text, Reply, and a heart with its count", () => {
    hookState.comments = [comment({ content: "Congratulations", like_count: 12 })];
    draw();

    expect(screen.getByText("Neil Basu")).toBeInTheDocument();
    expect(screen.getByText("5w"), "an absolute date does not answer 'is this still live'")
      .toBeInTheDocument();
    expect(screen.getByText("Congratulations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reply" })).toBeInTheDocument();

    const heart = screen.getByRole("button", { name: /like this comment/i });
    expect(heart).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("12"), "the count belongs to the heart, under it").toBeInTheDocument();
  });

  it("the heart sends the like, and reads as pressed once the viewer has one", () => {
    hookState.comments = [comment({ content: "Congratulations", like_count: 1, user_reaction: "like" })];
    draw();

    const heart = screen.getByRole("button", { name: /remove your reaction/i });
    expect(heart).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(heart);
    expect(toggleLike).toHaveBeenCalledWith(hookState.comments[0].id);
  });

  it("draws the viewer's OWN emoji instead of a heart when they picked another reaction", () => {
    hookState.comments = [comment({ content: "Congratulations", like_count: 3, user_reaction: "sad" })];
    draw();

    const heart = screen.getByRole("button", { name: /remove your reaction/i });
    expect(within(heart).getByText("😢"), "a filled heart would misreport what they sent")
      .toBeInTheDocument();
  });

  it("offers no heart to a signed-out reader to press", () => {
    hookState.currentUserId = null;
    hookState.comments = [comment({ content: "Congratulations", like_count: 4 })];
    draw();

    expect(screen.getByRole("button", { name: /like this comment/i })).toBeDisabled();
  });
});

/* ─────────────── 4. threaded replies ─────────────── */
describe("replies", () => {
  it("are indented under the comment they answer", () => {
    hookState.comments = [
      comment({ content: "Congratulations", replies: [comment({ content: "Thank you" })] }),
    ];
    const { container } = draw();

    const reply = screen.getByText("Thank you").closest("[class*='ml-']");
    expect(reply, "the indent is what says WHICH comment a reply answers").not.toBeNull();
    expect(container.querySelectorAll("[class*='ml-11']").length).toBeGreaterThan(0);
  });

  it("open a reply box, named for the person being answered, under that comment", () => {
    hookState.comments = [comment({ content: "Congratulations", author_name: "Somnath" })];
    draw();

    expect(screen.queryByPlaceholderText(/^Reply to Somnath/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.getByPlaceholderText(/^Reply to Somnath/)).toBeInTheDocument();
  });
});

/* ─────────────── 5. the quick-reaction row ─────────────── */
describe("the quick-reaction row above the box", () => {
  it("offers the eight emoji, each with a name a screen reader can say", () => {
    draw();
    for (const label of [
      "Heart", "Raised hands", "Fire", "Clapping hands",
      "Crying face", "Heart eyes", "Shocked face", "Laughing to tears",
    ]) {
      expect(screen.getByLabelText(`Add ${label} to your comment`)).toBeInTheDocument();
    }
  });

  it("APPENDS to the draft rather than posting — a tap is never an un-undoable write", () => {
    draw({ postOwnerHandle: "villagesquareindia" });
    const box = screen.getByPlaceholderText(/^Add a comment for/) as HTMLInputElement;

    fireEvent.change(box, { target: { value: "Stunning" } });
    fireEvent.click(screen.getByLabelText("Add Fire to your comment"));

    expect(box.value).toBe("Stunning🔥");
    expect(hookState.addComment, "a tap must not post on its own").not.toHaveBeenCalled();
  });

  it("will not push the draft past the length ceiling", () => {
    draw();
    const box = screen.getByPlaceholderText(/comment/i) as HTMLInputElement;
    const atCeiling = "x".repeat(2200);

    fireEvent.change(box, { target: { value: atCeiling } });
    fireEvent.click(screen.getByLabelText("Add Fire to your comment"));

    expect(box.value, "silently truncating the member's sentence is worse than dropping the emoji")
      .toBe(atCeiling);
  });
});

/* ─────────────── 6. the pinned composer ─────────────── */
describe("the composer", () => {
  it("names the post's owner in its placeholder, truncated to stay on one line", () => {
    draw({ postOwnerHandle: "villagesquareindia" });
    // 14 characters then an ellipsis — the reference's own "villagesquarei…".
    expect(screen.getByPlaceholderText("Add a comment for villagesquarei…")).toBeInTheDocument();
  });

  it("falls back to the ONE shared placeholder when the owner has no handle", () => {
    draw({ postOwnerHandle: null });
    expect(screen.getByPlaceholderText("Write a comment...")).toBeInTheDocument();
  });

  it("is not drawn at all for a signed-out reader", () => {
    hookState.currentUserId = null;
    draw({ postOwnerHandle: "villagesquareindia" });

    expect(screen.queryByPlaceholderText(/^Add a comment for/)).toBeNull();
    expect(screen.queryByLabelText("Add Fire to your comment")).toBeNull();
  });
});
