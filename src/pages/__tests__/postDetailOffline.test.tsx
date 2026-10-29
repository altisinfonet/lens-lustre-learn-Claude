/**
 * S7b-4 · THE POST PAGE WITH NO NETWORK IS NOT "NOT FOUND". Before: the read
 * failing on the network set notFound, so flight mode said "Post not found or
 * has been removed." about a post that exists. Now it says there is no
 * internet (and shows the saved copy when there is one — postPageLoad.test.ts).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { onlineManager } from "@tanstack/react-query";

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

const { default: PostDetail } = await import("@/pages/PostDetail");
const { memoryBackend, setBackend } = await import("@/lib/offline/deviceStore");

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
});
