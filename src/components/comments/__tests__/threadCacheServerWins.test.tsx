/**
 * THE COMMENT-THREAD CACHE, THE WAY META DOES IT (review of #435, 17 Oct 2026).
 *
 * Bug 5 made a second open of a thread draw at once from a session cache. The
 * review found two ways that cache could show what it must not:
 *
 *   1. STALE: the fresh read came back EMPTY (every comment deleted or
 *      moderated elsewhere) and the post thread kept the cached rows on screen,
 *      because its tree effect returned early for zero rows.
 *   2. PRIVACY: neither cache (post THREAD_CACHE, ad AD_THREAD_CACHE) was
 *      wiped on sign-out or keyed by viewer, so on a shared phone the next
 *      viewer, signed out or another member, was drawn the previous member's
 *      thread until their own read landed.
 *
 * The rule now (Facebook / Instagram): a cached thread shows at once, a fresh
 * read ALWAYS runs, and its answer replaces the screen, an empty one included.
 * The cache is keyed by viewer, bounded, and wiped on every sign-out.
 *
 * "Never, not even for a moment" is checked on EVERY render: while the next
 * viewer's own read is held in flight, no render may contain the previous
 * viewer's rows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const POST = "post-1";
const CREATIVE = "creative-1";
const A = "member-a";
const B = "member-b";
const AT = "2026-10-01T00:00:00Z";

/** Who is signed in right now; null = signed out. */
let viewer: string | null = A;
vi.mock("@/hooks/core/useAuth", () => ({
  useAuth: () => ({ user: viewer ? { id: viewer } : null, loading: false }),
}));
vi.mock("@/hooks/core/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/core/useIsBanned", () => ({ useIsBanned: () => ({ isBanned: false }) }));
vi.mock("@/hooks/profile/useProfileData", () => ({ useProfileCore: () => ({ data: null }) }));
// One stable map: a new {} per render would re-run the tree effect forever.
vi.mock("@/hooks/profile/useProfileMap", () => {
  const profileMap = {};
  return { useProfileMap: () => ({ profileMap, isLoading: false }) };
});
vi.mock("@/lib/adminBrand", () => ({
  getAdminIds: async () => new Set<string>(),
  resolveName: (_id: string, name: string | null) => name || "Photographer",
  resolveBadges: (_id: string, badges: string[]) => badges,
}));

// ── the server ───────────────────────────────────────────────────────────────
/** What the next read of the thread returns. */
let postRows: { id: string; user_id: string; content: string; created_at: string; updated_at: null; parent_id: null; is_pinned: boolean }[] = [];
let adRows: { id: string; creative_id: string; user_id: string; content: string; parent_id: null; created_at: string; updated_at: null }[] = [];
/** While set, every read waits on it: "the next viewer's read is still in flight". */
let hold: Promise<void> | null = null;
let release: () => void = () => {};
const holdReads = () => { hold = new Promise<void>((r) => { release = r; }); };

const builder = () => {
  const q: any = {
    select: () => q, eq: () => q, order: () => q, limit: () => q, in: () => q,
    then: (resolve: (v: unknown) => void) => {
      const wait = hold ?? Promise.resolve();
      return wait.then(() => resolve({ data: postRows.map((r) => ({ ...r, post_comment_reactions: [] })), error: null }));
    },
  };
  return q;
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => builder(), rpc: async () => ({ data: [], error: null }) },
}));
vi.mock("@/lib/ads/adEngagement", () => ({
  fetchAdComments: async () => { if (hold) await hold; return adRows.map((r) => ({ ...r })); },
  addAdComment: vi.fn(async () => ({ error: null })),
  editAdComment: vi.fn(async () => ({ error: null })),
  deleteAdComment: vi.fn(async () => ({ error: null })),
}));

// The ad box's drawing is not under test here, only what it is handed.
const adRenders: { loading: boolean; contents: string[] }[] = [];
vi.mock("@/components/PostCommentsSection", () => ({
  CommentsBox: ({ source }: { source: { loading: boolean; comments: { content: string }[] } }) => {
    adRenders.push({ loading: source.loading, contents: source.comments.map((c) => c.content) });
    return <ul>{source.comments.map((c) => <li key={c.content}>{c.content}</li>)}</ul>;
  },
}));

import { usePostComments } from "@/hooks/feed/usePostComments";
import AdComments from "@/components/ads/AdComments";
import { wipeMemberDataOnSignOut } from "@/lib/offline/signOutWipe";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const A_POST_ROWS = () => [
  { id: "c1", user_id: A, content: "A's private note", created_at: AT, updated_at: null, parent_id: null, is_pinned: false },
  { id: "c2", user_id: "u2", content: "second", created_at: AT, updated_at: null, parent_id: null, is_pinned: false },
];
const A_AD_ROWS = () => [
  { id: "ac1", creative_id: CREATIVE, user_id: A, content: "A on the ad", parent_id: null, created_at: AT, updated_at: null },
  { id: "ac2", creative_id: CREATIVE, user_id: "u2", content: "another", parent_id: null, created_at: AT, updated_at: null },
];

/** Every render's comment ids, so "not even for a moment" can be checked. */
const postRenders: string[][] = [];
const openPost = () =>
  renderHook(() => {
    const r = usePostComments(POST, "owner-1");
    postRenders.push(r.comments.map((c) => c.id));
    return r;
  }, { wrapper });

beforeEach(async () => {
  viewer = A;
  hold = null;
  postRows = A_POST_ROWS();
  adRows = A_AD_ROWS();
  postRenders.length = 0;
  adRenders.length = 0;
  // Start with nothing remembered: the real sign-out path empties every
  // cache after the fix. (Before the fix it cleared neither, so each test
  // also opens a fresh post/creative id where it matters; see below.)
  await wipeMemberDataOnSignOut();
});
afterEach(() => { release(); hold = null; cleanup(); });

describe("post thread — the server always wins", () => {
  it("a cached thread whose comments were deleted on the server opens EMPTY", async () => {
    const first = openPost();
    await waitFor(() => expect(first.result.current.comments.map((c) => c.id)).toEqual(["c1", "c2"]));
    first.unmount();

    postRows = []; // deleted / moderated elsewhere
    const second = openPost();
    await waitFor(() => expect(second.result.current.loaded).toBe(true));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(second.result.current.comments, "the deleted comments are still on screen").toEqual([]);
  });
});

describe("post thread — privacy on a shared device", () => {
  it("member A → member B (new open): B is never drawn A's cached thread", async () => {
    const first = openPost();
    await waitFor(() => expect(first.result.current.comments).toHaveLength(2));
    first.unmount();

    viewer = B;
    holdReads();
    postRenders.length = 0;
    const second = openPost();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(postRenders.flat(), "B was shown A's thread while B's own read was in flight").toEqual([]);
    release();
    await waitFor(() => expect(second.result.current.loaded).toBe(true));
  });

  it("member A → member B with the screen still open: A's thread is gone on B's first render", async () => {
    const h = openPost();
    await waitFor(() => expect(h.result.current.comments).toHaveLength(2));

    viewer = B;
    holdReads();
    postRenders.length = 0;
    h.rerender();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(postRenders.flat(), "B was shown A's thread after the member changed").toEqual([]);
    release();
    await waitFor(() => expect(h.result.current.comments).toHaveLength(2));
  });

  it("sign-out wipes the post cache: the next open shows nothing until the server answers", async () => {
    const first = openPost();
    await waitFor(() => expect(first.result.current.comments).toHaveLength(2));
    first.unmount();

    await wipeMemberDataOnSignOut();
    holdReads();
    postRenders.length = 0;
    const second = openPost();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(postRenders.flat(), "a thread cached before the sign-out was drawn after it").toEqual([]);
    expect(second.result.current.loading).toBe(true);
  });
});

const openAd = () =>
  render(<QueryClientProvider client={new QueryClient()}><AdComments creativeId={CREATIVE} /></QueryClientProvider>);

describe("ad thread — the server always wins", () => {
  it("a cached ad thread whose comments were deleted on the server opens EMPTY", async () => {
    const first = openAd();
    await waitFor(() => expect(adRenders.at(-1)?.contents).toEqual(["A on the ad", "another"]));
    first.unmount();

    adRows = [];
    openAd();
    await waitFor(() => expect(adRenders.at(-1)?.loading).toBe(false));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(adRenders.at(-1)?.contents).toEqual([]);
  });
});

describe("ad thread — privacy on a shared device", () => {
  it("member A signs out: a signed-out viewer never sees A's cached ad comments", async () => {
    const first = openAd();
    await waitFor(() => expect(adRenders.at(-1)?.contents).toHaveLength(2));
    first.unmount();

    viewer = null; // signed out from the menu; the page does not reload
    await wipeMemberDataOnSignOut();
    holdReads();
    adRenders.length = 0;
    openAd();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(adRenders.flatMap((r) => r.contents), "a signed-out viewer was shown A's ad comments").toEqual([]);
  });

  it("sign-out wipes the ad cache: the same viewer's next open waits for the server", async () => {
    const first = openAd();
    await waitFor(() => expect(adRenders.at(-1)?.contents).toHaveLength(2));
    first.unmount();

    await wipeMemberDataOnSignOut();
    holdReads();
    adRenders.length = 0;
    openAd();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(adRenders.flatMap((r) => r.contents), "an ad thread cached before the sign-out was drawn after it").toEqual([]);
    expect(adRenders.at(-1)?.loading).toBe(true);
  });

  it("member A → member B: B is never drawn A's cached ad thread", async () => {
    const first = openAd();
    await waitFor(() => expect(adRenders.at(-1)?.contents).toHaveLength(2));
    first.unmount();

    viewer = B;
    holdReads();
    adRenders.length = 0;
    openAd();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(adRenders.flatMap((r) => r.contents), "B was shown A's ad thread").toEqual([]);
    release();
    await waitFor(() => expect(adRenders.at(-1)?.contents).toHaveLength(2));
  });
});
