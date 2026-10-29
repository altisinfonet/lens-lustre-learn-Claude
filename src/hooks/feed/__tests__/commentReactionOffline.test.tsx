/**
 * S7b-5 · a comment reaction can't be queued yet (not in D1's contract), so
 * offline it says so — before, it showed the reaction and silently never sent it.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";

const toastSpy = vi.hoisted(() => vi.fn());
const writes = vi.hoisted(() => ({ tables: [] as string[] }));
vi.mock("@/hooks/core/use-toast", async (o) => ({ ...(await o<Record<string, unknown>>()), toast: toastSpy }));
vi.mock("@/integrations/supabase/client", () => {
  const fail = { data: null, error: { message: "TypeError: Failed to fetch" } };
  const make = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order", "limit"]) chain[m] = () => chain;
    for (const m of ["insert", "delete", "upsert"]) chain[m] = () => { writes.tables.push(table); return chain; };
    chain.then = (r: (v: unknown) => unknown) => Promise.resolve(fail).then(r);
    return chain;
  };
  return { supabase: { from: make, rpc: async () => fail } };
});
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "me-1" }, loading: false }) }));
vi.mock("@/hooks/profile/useProfileData", async (o) => ({ ...(await o<Record<string, unknown>>()), useProfileCore: () => ({ data: null }) }));
vi.mock("@/hooks/core/useIsAdmin", () => ({ useIsAdmin: () => ({ isAdmin: false }) }));
const { usePostComments } = await import("@/hooks/feed/usePostComments");

afterEach(() => onlineManager.setOnline(true));

describe("comment reaction offline", () => {
  it("says it needs a connection and writes nothing", async () => {
    onlineManager.setOnline(false);
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => usePostComments("p1", "owner", undefined, false), { wrapper });
    await act(async () => { await result.current.setReaction("c1", "like"); });
    expect(writes.tables).toEqual([]);
    expect(toastSpy.mock.calls.map((c) => c[0].title)).toContain("No internet — reacting to comments needs a connection");
  });
});
