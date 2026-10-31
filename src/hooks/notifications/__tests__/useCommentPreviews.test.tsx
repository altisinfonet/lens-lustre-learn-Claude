import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const tables: Record<string, unknown[]> = {};
const calls: Array<{ table: string; ids: string[] }> = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        in: (_col: string, ids: string[]) => {
          calls.push({ table, ids });
          return Promise.resolve({ data: (tables[table] ?? []).filter((r) => ids.includes((r as { id: string }).id)), error: null });
        },
      }),
    }),
  },
}));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));

import { useCommentPreviews } from "@/hooks/notifications/useCommentPreviews";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);
const g = (over: Record<string, unknown>) => ({ group_key: "k", type: "post_comment", notification_ids: ["n1"], reference_id: "p1", ...over });

describe("useCommentPreviews (N7)", () => {
  beforeEach(() => {
    calls.length = 0;
    tables.user_notifications = [
      { id: "n1", dedup_key: `post_comment:${C1}:owner`, created_at: "2026-10-31T10:00:00Z" },
      { id: "n2", dedup_key: `post_comment:${C2}:owner`, created_at: "2026-10-31T11:00:00Z" },
      { id: "n3", dedup_key: null, created_at: "2026-10-31T12:00:00Z" },
    ];
    tables.post_comments = [
      { id: C1, content: "Older comment", post_id: "p1" },
      { id: C2, content: "Lovely light on the river", post_id: "p1" },
    ];
  });

  it("finds the LATEST comment each comment row is about, in two batched reads", async () => {
    const { result } = renderHook(() => useCommentPreviews([g({ group_key: "a", notification_ids: ["n1", "n2"] })] as never, true), { wrapper: wrap });
    await waitFor(() => expect(result.current.get("a")).toEqual({ commentId: C2, content: "Lovely light on the river" }));
    expect(calls.map((c) => c.table)).toEqual(["user_notifications", "post_comments"]);
  });

  it("only comment types, only while the centre screens are on", () => {
    renderHook(() => useCommentPreviews([g({ type: "post_reaction" })] as never, true), { wrapper: wrap });
    renderHook(() => useCommentPreviews([g({})] as never, false), { wrapper: wrap });
    expect(calls).toHaveLength(0);
  });

  it("no dedup key, or a deleted comment → no preview", async () => {
    tables.post_comments = [{ id: C2, content: "Lovely light on the river", post_id: "p1" }];   // C1 deleted
    const { result } = renderHook(
      () => useCommentPreviews([
        g({ group_key: "b", notification_ids: ["n3"], reference_id: "p1" }),
        g({ group_key: "c", notification_ids: ["n1"], reference_id: "p1" }),
        g({ group_key: "d", notification_ids: ["n2"], reference_id: "p1" }),
      ] as never, true),
      { wrapper: wrap },
    );
    await waitFor(() => expect(result.current.get("d")?.commentId).toBe(C2));   // the comments read has happened
    expect(result.current.get("b")).toBeUndefined();   // no dedup key
    expect(result.current.get("c")).toBeUndefined();   // comment deleted
  });

  it("a comment from another post is never shown (the quote must match where Reply goes)", async () => {
    tables.post_comments = [{ id: C2, content: "Elsewhere", post_id: "other-post" }];
    const { result } = renderHook(() => useCommentPreviews([g({ group_key: "e", notification_ids: ["n2"], reference_id: "p1" })] as never, true), { wrapper: wrap });
    await waitFor(() => expect(calls.map((c) => c.table)).toContain("post_comments"));
    expect(result.current.get("e")).toBeUndefined();
  });
});
