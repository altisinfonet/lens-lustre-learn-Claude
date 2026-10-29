/**
 * S7b-4 · a thread read ONLINE is kept on the phone with its authors' names,
 * so it can open with no network next time (commentsOffline.test.tsx).
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ROWS = [{ id: "c1", post_id: "p1", user_id: "u1", content: "Lovely light", parent_id: null, created_at: "2026-10-01T00:00:00Z", post_comment_reactions: [] }];
vi.mock("@/integrations/supabase/client", () => {
  const ok = { data: ROWS, error: null, count: 1 };
  const none = { data: [], error: null, count: 0 };
  const chainFor = (table: string) => {
    const res = table === "post_comments" ? ok : none;
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit", "lt", "or", "not", "is"]) chain[m] = () => chain;
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(res).then(resolve);
    return chain;
  };
  return { supabase: { from: chainFor, rpc: async () => ({ data: [], error: null }) } };
});
const ME = { id: "me-1" };
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: ME, loading: false }) }));
vi.mock("@/hooks/profile/useProfileData", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useProfileCore: () => ({ data: null, isLoading: false }),
}));
vi.mock("@/hooks/core/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));

const { memoryBackend, setBackend } = await import("@/lib/offline/deviceStore");
const { savedThread } = await import("@/lib/offline/seenContent");
const { usePostComments, __clearThreadCacheForTests } = await import("@/hooks/feed/usePostComments");
const { queryKeys } = await import("@/lib/queryKeys");

describe("a thread read online", () => {
  it("is saved on the phone with its authors' names", async () => {
    setBackend(memoryBackend());
    __clearThreadCacheForTests();
    const qc = new QueryClient();
    // the authors' names, as the profile read returns them
    qc.setQueryData(queryKeys.profileMap(["u1"]), new Map([["u1", { id: "u1", full_name: "Asha Rao", avatar_url: null, badges: [], roles: [], last_active_at: null, custom_url: "asha" }]]));
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    renderHook(() => usePostComments("p1", "owner"), { wrapper });
    await waitFor(async () => {
      const saved = await savedThread(ME.id, "p1");
      expect(saved?.rows.map((r: { id: string }) => r.id)).toEqual(["c1"]);
      expect(saved?.authors.u1.full_name).toBe("Asha Rao");
    }, { timeout: 4000 });
  });
});
