/**
 * S7b-4 · A COMMENT THREAD OPENED ONLINE OPENS OFFLINE, WITH ITS NAMES.
 * Before: the thread lived in memory only, so after the app was closed a
 * thread opened with no network read nothing and said there were no comments;
 * its authors' names (a separate profile read) were lost too.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => {
  const fail = { data: null, error: { message: "TypeError: Failed to fetch", code: "" }, count: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit", "lt", "or", "not", "is"]) chain[m] = () => chain;
  chain.maybeSingle = async () => fail;
  chain.single = async () => fail;
  chain.then = (resolve: (v: typeof fail) => unknown) => Promise.resolve(fail).then(resolve);
  return { supabase: { from: () => chain, rpc: async () => fail, channel: () => ({ on: () => ({ subscribe: () => ({}) }) }), removeChannel: () => {} } };
});
const ME = { id: "me-1" };
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: ME, loading: false }) }));
vi.mock("@/hooks/profile/useProfileData", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useProfileCore: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/hooks/core/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));

const { memoryBackend, setBackend } = await import("@/lib/offline/deviceStore");
const { rememberThread } = await import("@/lib/offline/seenContent");
const { usePostComments, __clearThreadCacheForTests } = await import("@/hooks/feed/usePostComments");

beforeEach(() => {
  setBackend(memoryBackend());
  __clearThreadCacheForTests();
  onlineManager.setOnline(false);
});
afterEach(() => onlineManager.setOnline(true));

describe("comments offline", () => {
  it("the saved thread is shown, with the author's real name", async () => {
    await rememberThread(ME.id, "p1", [
      { id: "c1", post_id: "p1", user_id: "u1", content: "Lovely light", parent_id: null, created_at: "2026-10-01T00:00:00Z", post_comment_reactions: [] },
    ], { u1: { full_name: "Asha Rao", avatar_url: null, custom_url: "asha" } });
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => usePostComments("p1", "owner"), { wrapper });
    await waitFor(() => expect(result.current.comments.map((c) => c.content)).toEqual(["Lovely light"]), { timeout: 4000 });
    await waitFor(() => expect(result.current.comments[0].author_name).toBe("Asha Rao"));
  });
});
