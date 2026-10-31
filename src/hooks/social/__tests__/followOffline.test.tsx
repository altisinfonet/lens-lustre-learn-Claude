/**
 * S7b-5 · FOLLOW WITH NO NETWORK. Before: "Failed to follow" and nothing kept.
 * Now: queued in the outbox, shown at once (Following, count +1), a calm
 * "will send when online" — and no request is made while offline.
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";

const toastSpy = vi.hoisted(() => vi.fn());
const writes = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/hooks/core/use-toast", async (o) => ({ ...(await o<Record<string, unknown>>()), toast: toastSpy }));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" }, loading: false }) }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "insert", "delete", "upsert", "maybeSingle", "update"]) chain[m] = () => { writes.n++; return chain; };
  chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r);
  return { supabase: { from: () => chain } };
});

const { useToggleFollow } = await import("@/hooks/social/useFriendshipMutations");
const { startOutbox, pending, memoryOutboxStore, __setOutboxStore, __setOutboxOnline, __resetOutbox } = await import("@/lib/offline/outbox");
const ME = "11111111-1111-4111-8111-111111111111";
const T = "33333333-3333-4333-8333-333333333333";

let store: ReturnType<typeof memoryOutboxStore>;
beforeEach(() => {
  __resetOutbox(); store = memoryOutboxStore(); __setOutboxStore(store); __setOutboxOnline(() => false);
  startOutbox(ME, async () => ({ ok: true }));
  onlineManager.setOnline(false);
  toastSpy.mockReset(); writes.n = 0;
});
afterEach(() => { __resetOutbox(); __setOutboxOnline(undefined); onlineManager.setOnline(true); });

describe("follow offline", () => {
  it("is queued, shown as Following with the count +1, and says it will send", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["friend-follow", T, ME], { isFollowing: false, followerCount: 4 });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useToggleFollow(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ targetUserId: T, isCurrentlyFollowing: false }); });
    expect((await pending(ME)).map((i) => i.action)).toEqual([{ kind: "follow", targetId: T }]);
    expect(qc.getQueryData(["friend-follow", T, ME])).toMatchObject({ isFollowing: true, followerCount: 5 });
    expect(toastSpy.mock.calls.map((c) => c[0].title)).toEqual(["Following — will send when online"]);
    expect(writes.n).toBe(0);
  });
});

describe("review #574: accepting a friend request", () => {
  it("queues only THIS member's follow — never an action for the other member", async () => {
    // Accepting is an online action (React Query online); the follow it adds
    // is still kept on the device (the outbox's own network is down here).
    onlineManager.setOnline(true);
    const { useAcceptFriendRequest } = await import("@/hooks/social/useFriendshipMutations");
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useAcceptFriendRequest(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ friendshipId: "f1", targetUserId: T }); });
    // every item on the device belongs to the signed-in member
    const all = await store.getAll();
    expect(all.map((i) => i.action)).toEqual([{ kind: "follow", targetId: T }]);
    expect(all.every((i) => i.userId === ME)).toBe(true);
  });
});
