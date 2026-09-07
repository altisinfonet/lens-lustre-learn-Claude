/**
 * A STORY-CARD COMMENT IS THE COMMENT, NOT THE SOURCE OF THE CALL THAT DRAWS IT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT
 *
 * The sponsored story card drew its own comment thread — 405 lines hand-copied
 * from the post thread — and its list said:
 *
 *     <div key={comment.id} className="space-y-2">
 *       renderRow(comment, false)              ← no braces
 *       {replies.map((r) => (
 *         renderRow(r, true)                   ← braces, so this one ran
 *       ))}
 *     </div>
 *
 * Bare text inside JSX is a string. React printed `renderRow(comment, false)`
 * where the comment belonged, so the one real comment on the ad — 'What is the
 * awarding criteria ?' in public.ad_creative_comments — was invisible to every
 * member, replaced by a line of this codebase's own source. The row one line
 * below, inside a `.map()`, was correct, which is how it survived review; and
 * the identifier appears exactly once in assets/index-DsgLaRMm.js, immediately
 * after a double quote, which is how it was confirmed on the deployed bundle.
 *
 * Nothing in TypeScript, ESLint or the type checker objects to it. It is valid
 * JSX. Only a test that RENDERS the card can say the difference.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS TEST HOLDS DOWN
 *
 *   1. the comment's own text reaches the DOM
 *   2. NO part of the rendered output contains the string "renderRow" — the
 *      specific shape of the defect, and of any successor to it
 *   3. the story card draws ONE composer, not two. The shipped bundle carried
 *      two "Add a comment" boxes because the ad thread and the post thread were
 *      separate implementations; there is one thread now and this says so. The
 *      placeholder is one string too, since 2026-08-28 — the ad card used to
 *      say "Add a comment…" and the post cards "Write a comment...".
 *
 * (2) is the assertion that would have caught it. It is deliberately a check on
 * the RENDERED OUTPUT and not on the source: a call rendered as text is
 * indistinguishable from working code until something runs it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROVED BY REINTRODUCING THE BUG
 *
 * On 2026-08-28 the placeholder was put back into the story card's list — the
 * bare `renderRow(comment, false)` between the JSX tags — and this file was run
 * against it. Both of the first two assertions failed: the comment text was
 * absent from the DOM, and the literal string was present in it. It was then
 * removed again. A guard that has never been seen to fail is not a guard.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const CREATIVE_ID = "11111111-2222-3333-4444-555555555555";
const AUTHOR_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
/** The real row in public.ad_creative_comments that the member could not see. */
const COMMENT_TEXT = "What is the awarding criteria ?";

const fetchAdComments = vi.fn();

vi.mock("@/lib/ads/adEngagement", () => ({
  adPath: (id: string) => `/ad/${id}`,
  emptyEngagement: (creativeId: string) => ({
    creativeId,
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    myReaction: null,
    myShared: false,
    reactionCounts: {},
  }),
  fetchAdEngagement: async () =>
    new Map([
      [
        CREATIVE_ID,
        {
          creativeId: CREATIVE_ID,
          likeCount: 0,
          commentCount: 1,
          shareCount: 0,
          myReaction: null,
          myShared: false,
          reactionCounts: {},
        },
      ],
    ]),
  fetchAdComments: (...args: unknown[]) => fetchAdComments(...args),
  addAdComment: vi.fn(async () => ({ error: null })),
  editAdComment: vi.fn(async () => ({ error: null })),
  deleteAdComment: vi.fn(async () => ({ error: null })),
  reactToAd: vi.fn(async () => ({ error: null })),
  unreactToAd: vi.fn(async () => ({ error: null })),
  shareAd: vi.fn(async () => ({ error: null })),
  BLOCKED_COMMENT_MESSAGE: "blocked",
}));

vi.mock("@/hooks/core/useAuth", () => ({
  useAuth: () => ({ user: { id: "viewer-1" }, loading: false }),
}));
vi.mock("@/hooks/core/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/profile/useProfileData", () => ({
  // F-95 — the avatar link is now ProfileLink, which prefetches the profile
  // on hover through this hook. Mocked to a no-op: this suite is about the
  // comment body, not about prefetching.
  usePrefetchProfile: () => () => {},
  useProfileCore: () => ({ data: { full_name: "A Viewer", avatar_url: null } }),
}));
vi.mock("@/hooks/profile/useProfileMap", () => ({
  useProfileMap: () => ({
    profileMap: {
      [AUTHOR_ID]: { full_name: "Asked Member", avatar_url: null, badges: [], last_active_at: null },
    },
  }),
}));
vi.mock("@/lib/adminBrand", () => ({
  getAdminIds: async () => new Set<string>(),
  resolveName: (_id: string, name: string | null) => name,
  resolveBadges: (_id: string, badges: string[]) => badges,
}));

/** react-mentions wants a real layout engine; the composer is not what is under test. */
vi.mock("@/components/MentionInput", () => ({
  default: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <input aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
/** Its badges and roles are their own queries and their own tests. */
vi.mock("@/components/UserIdentityBlock", () => ({
  default: ({ name }: { name: string }) => <span>{name}</span>,
}));

import AdEngagementBar from "@/components/ads/AdEngagementBar";

const oneComment = [
  {
    id: "comment-1",
    creative_id: CREATIVE_ID,
    user_id: AUTHOR_ID,
    content: COMMENT_TEXT,
    parent_id: null,
    created_at: "2026-08-20T10:00:00.000Z",
    updated_at: "2026-08-20T10:00:00.000Z",
  },
];

/** The story card's engagement, with its thread opened the way a member opens it. */
const openStoryCardThread = async () => {
  render(
    // F-95 — ProfileLink's hover prefetch reads the QueryClient, and the
    // real app has always had one at the root (App.tsx). Supplying it here
    // gives the component the environment it actually runs in.
    <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>
      <AdEngagementBar creativeId={CREATIVE_ID} />
    </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Comment" }));
};

beforeEach(() => {
  fetchAdComments.mockReset();
  fetchAdComments.mockResolvedValue(oneComment);
});

describe("the story card shows the comment that is actually there", () => {
  it("renders the comment's text", async () => {
    await openStoryCardThread();
    expect(await screen.findByText(COMMENT_TEXT)).toBeInTheDocument();
  });

  it("renders its author, so the row is a comment and not a bare string", async () => {
    await openStoryCardThread();
    expect(await screen.findByText("Asked Member")).toBeInTheDocument();
  });

  it("prints NO part of the code that draws it", async () => {
    await openStoryCardThread();
    // ⚠ WAIT ON THE THREAD, NOT ON THE COMMENT. Waiting for the comment's text
    // would make this test fail with "could not find the text" the moment the
    // placeholder came back — the same red as the assertion above, for a
    // different reason, and this one would never actually run. It has to be
    // able to fail on its own terms.
    await screen.findByPlaceholderText(/write a comment/i);
    // The whole rendered subtree, not one node: the placeholder sat beside the
    // comment, so an assertion scoped to the comment's own element would have
    // walked straight past it.
    expect(document.body.textContent).not.toContain("renderRow");
    expect(document.body.textContent).not.toContain("renderComment");
    expect(document.body.textContent).not.toMatch(/\bcomment,\s*(false|true)\)/);
  });

  it("draws ONE comment composer, not the two the bundle shipped", async () => {
    await openStoryCardThread();
    const composers = await screen.findAllByPlaceholderText(/write a comment/i);
    expect(composers).toHaveLength(1);
  });
});

describe("an empty thread says so, rather than saying nothing", () => {
  it("shows the empty line and still prints no source", async () => {
    fetchAdComments.mockResolvedValue([]);
    await openStoryCardThread();
    expect(await screen.findByText("No comments yet.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("renderRow");
  });
});
