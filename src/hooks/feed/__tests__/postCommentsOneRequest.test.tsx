/**
 * BUG 5 — "comments take very long to load" (Owner, 15 Oct 2026).
 *
 * MEASURED FIRST (tools/uishot/comments-load-timing.mjs, a real browser on
 * staging, docs/evidence/d2/comments-one-box/): from the click to the first
 * comment, the post thread made TWO requests IN SERIES — post_comments, and
 * only after it came back, post_comment_reactions for the ids it returned.
 * Each was ~230 ms of network on its own; the staircase was the wait.
 *
 * What this holds down:
 *   1. a thread is ONE read before its first comment — the reactions ride
 *      inside the comments request, embedded — and the like counts and
 *      "my reaction" still come out right;
 *   2. if the embed is refused, the old two-step read runs: never an empty thread;
 *   3. a thread already opened once draws at once on the next open — it never
 *      says "Loading comments…" again while it refreshes behind the list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const POST = "post-1";
const VIEWER = "viewer-1";
const ROWS = [
  { id: "c1", user_id: "u1", content: "hello", created_at: "2026-10-01T00:00:00Z", updated_at: null, parent_id: null, is_pinned: false },
  { id: "c2", user_id: "u2", content: "nice", created_at: "2026-10-02T00:00:00Z", updated_at: null, parent_id: null, is_pinned: false },
];
const REACTIONS = [
  { comment_id: "c2", user_id: VIEWER, reaction_type: "like" },
  { comment_id: "c2", user_id: "u1", reaction_type: "love" },
];

/** Every table read, in order, with the select it asked for. */
const reads: { table: string; select: string }[] = [];
let embedRefused = false;

const builder = (table: string) => {
  let select = "";
  const q: any = {
    select: (s: string) => { select = s; reads.push({ table, select: s }); return q; },
    eq: () => q,
    order: () => q,
    limit: () => q,
    in: () => q,
    then: (resolve: (v: unknown) => void) => {
      if (table === "post_comments" && select.includes("post_comment_reactions(")) {
        if (embedRefused) return resolve({ data: null, error: { message: "Could not find a relationship" } });
        return resolve({
          data: ROWS.map((r) => ({
            ...r,
            post_comment_reactions: REACTIONS.filter((x) => x.comment_id === r.id).map(({ user_id, reaction_type }) => ({ user_id, reaction_type })),
          })),
          error: null,
        });
      }
      if (table === "post_comments") return resolve({ data: ROWS, error: null });
      if (table === "post_comment_reactions") return resolve({ data: REACTIONS, error: null });
      return resolve({ data: [], error: null });
    },
  };
  return q;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => builder(t), rpc: async () => ({ data: [], error: null }) },
}));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: VIEWER }, loading: false }) }));
vi.mock("@/hooks/core/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/core/useIsBanned", () => ({ useIsBanned: () => ({ isBanned: false }) }));
vi.mock("@/hooks/profile/useProfileData", () => ({ useProfileCore: () => ({ data: null }) }));
vi.mock("@/hooks/profile/useProfileMap", () => ({ useProfileMap: () => ({ profileMap: {}, isLoading: false }) }));
vi.mock("@/lib/adminBrand", () => ({
  getAdminIds: async () => new Set<string>(),
  resolveName: (_id: string, name: string | null) => name || "Photographer",
  resolveBadges: (_id: string, badges: string[]) => badges,
}));

import * as hookModule from "@/hooks/feed/usePostComments";
const { usePostComments } = hookModule;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

beforeEach(() => {
  reads.length = 0;
  embedRefused = false;
  (hookModule as { __clearThreadCacheForTests?: () => void }).__clearThreadCacheForTests?.();
});

describe("bug 5 — the post thread is one read, not a staircase", () => {
  it("reads the thread in ONE request, reactions embedded, and counts them right", async () => {
    const { result } = renderHook(() => usePostComments(POST, "owner-1"), { wrapper });
    await waitFor(() => expect(result.current.comments).toHaveLength(2));

    expect(reads.map((r) => r.table), "one request before the first comment — no second read for reactions").toEqual(["post_comments"]);
    const nice = result.current.comments.find((c) => c.id === "c2")!;
    expect(nice.like_count).toBe(2);
    expect(nice.reaction_counts).toEqual({ like: 1, love: 1 });
    expect(nice.is_liked).toBe(true);
    expect(nice.user_reaction).toBe("like");
    expect(result.current.comments.find((c) => c.id === "c1")!.like_count).toBe(0);
  });

  it("falls back to the two-step read if the embed is refused — never an empty thread", async () => {
    embedRefused = true;
    const { result } = renderHook(() => usePostComments(POST, "owner-1"), { wrapper });
    await waitFor(() => expect(result.current.comments).toHaveLength(2));
    expect(result.current.comments.find((c) => c.id === "c2")!.like_count).toBe(2);
  });

  it("a thread opened once draws at once on the next open — no 'Loading comments…' again", async () => {
    const first = renderHook(() => usePostComments(POST, "owner-1"), { wrapper });
    await waitFor(() => expect(first.result.current.comments).toHaveLength(2));
    first.unmount();

    const loadingSeen: boolean[] = [];
    const second = renderHook(
      () => {
        const r = usePostComments(POST, "owner-1");
        loadingSeen.push(r.loading);
        return r;
      },
      { wrapper },
    );
    await waitFor(() => expect(second.result.current.comments).toHaveLength(2));
    await waitFor(() => expect(second.result.current.loaded).toBe(true));
    expect(loadingSeen.includes(true), "the second open of the same thread showed 'Loading comments…'").toBe(false);
  });
});
