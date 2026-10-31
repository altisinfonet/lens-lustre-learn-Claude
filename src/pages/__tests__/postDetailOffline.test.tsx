/**
 * S7b-4 · THE POST PAGE WITH NO NETWORK IS NOT "NOT FOUND". Before: the read
 * failing on the network set notFound, so flight mode said "Post not found or
 * has been removed." about a post that exists. Now it says there is no
 * internet (and shows the saved copy when there is one — postPageLoad.test.ts).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => {
  const dead = { data: null, error: { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" }, count: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => dead;
  chain.single = async () => dead;
  chain.then = (resolve: (v: typeof dead) => unknown) => Promise.resolve(dead).then(resolve);
  return { supabase: { from: () => chain, rpc: async () => dead, auth: { getSession: async () => ({ data: { session: null }, error: null }) } } };
});
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "viewer-1" }, loading: false }) }));
vi.mock("@/hooks/core/useBlockedUsers", () => ({
  useBlockedUsers: () => ({ blockedIds: new Set<string>(), blockedRows: [], isBlocked: () => false, block: () => {}, unblock: () => {}, blocking: false, unblocking: false, isLoading: false }),
}));
vi.mock("@/hooks/feed/usePostReactionMutations", () => ({
  useReactToPost: () => ({ mutate: vi.fn(), isPending: false }),
  useUnreactToPost: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The card and what sits below it have their own tests; here only the page's
// own loading decides what is on screen.
vi.mock("@/components/post/PostCard", () => ({ default: ({ post }: { post: { content: string } }) => <p>{post.content}</p> }));
vi.mock("@/components/post/PostPageMore", () => ({ default: () => null }));
vi.mock("@/contexts/CommentsOverlayContext", () => ({ useCommentsOverlay: () => ({ openPostComments: () => {} }) }));

const { default: PostDetail } = await import("@/pages/PostDetail");
const { memoryBackend, setBackend } = await import("@/lib/offline/deviceStore");
const { rememberPost } = await import("@/lib/offline/seenContent");

afterEach(() => { cleanup(); onlineManager.setOnline(true); });

function open() {
  setBackend(memoryBackend());
  return render(
    <MemoryRouter initialEntries={["/post/00000000-0000-4000-8000-0000000000ab"]}>
      <Routes><Route path="/post/:postId" element={<PostDetail />} /></Routes>
    </MemoryRouter>,
  );
}

describe("post page, no network, nothing saved", () => {
  it("a network failure says 'No internet', not 'Post not found'", async () => {
    open();
    expect(await screen.findByText(/No internet/)).toBeTruthy();
    expect(screen.queryByText(/Post not found/)).toBeNull();
  });
  it("offline: the same, with no request at all", async () => {
    onlineManager.setOnline(false);
    open();
    expect(await screen.findByText(/No internet/)).toBeTruthy();
  });

  it("review #564: going from a saved post A to an unsaved post B never shows A under B", async () => {
    setBackend(memoryBackend());
    const A = "00000000-0000-4000-8000-0000000000a1";
    const B = "00000000-0000-4000-8000-0000000000b2";
    await rememberPost("viewer-1", {
      id: A, user_id: "u1", content: "Saved post A text", image_url: null, image_urls: [], privacy: "public",
      created_at: "2026-10-01T00:00:00Z", author_name: "Asha", author_avatar: null, author_handle: null,
      like_count: 0, comment_count: 0, share_count: 0, user_reaction: null, top_reactions: [], reaction_counts: {},
    });
    const GoB = () => { const n = useNavigate(); return <button onClick={() => n(`/post/${B}`)}>to B</button>; };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[`/post/${A}`]}>
          <GoB />
          <Routes><Route path="/post/:postId" element={<PostDetail />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Saved post A text/)).toBeTruthy();
    fireEvent.click(screen.getByText("to B"));
    expect(await screen.findByText(/No internet/)).toBeTruthy();
    expect(screen.queryByText(/Saved post A text/)).toBeNull();
  });
});

