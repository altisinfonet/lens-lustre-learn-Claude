import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const inserted: unknown[] = [];
const deleted: unknown[] = [];
let rows: { blocked_id: string; created_at: string }[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }),
      insert: (row: unknown) => { inserted.push(row); return Promise.resolve({ error: null }); },
      delete: () => ({ eq: () => ({ eq: (_c: string, id: string) => { deleted.push(id); return Promise.resolve({ error: null }); } }) }),
    }),
  },
}));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useBlockedUsers } from "@/hooks/core/useBlockedUsers";

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("useBlockedUsers — App Store 1.2 blocking", () => {
  beforeEach(() => { inserted.length = 0; deleted.length = 0; rows = []; });

  it("starts with nobody blocked", async () => {
    const { result } = renderHook(() => useBlockedUsers(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.blockedIds.size).toBe(0);
  });

  it("hides the member INSTANTLY (optimistic) and writes the block row", async () => {
    const { result } = renderHook(() => useBlockedUsers(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.block("abuser"));
    await waitFor(() => expect(result.current.isBlocked("abuser")).toBe(true));
    await waitFor(() => expect(inserted).toEqual([{ blocker_id: "me", blocked_id: "abuser" }]));
  });

  it("refuses to block yourself", async () => {
    const { result } = renderHook(() => useBlockedUsers(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.block("me"));
    await new Promise((r) => setTimeout(r, 20));
    expect(inserted).toEqual([]);
    expect(result.current.isBlocked("me")).toBe(false);
  });

  it("unblock removes the member from the set and deletes the row", async () => {
    rows = [{ blocked_id: "abuser", created_at: "2026-10-03T00:00:00Z" }];
    const { result } = renderHook(() => useBlockedUsers(), { wrapper });
    await waitFor(() => expect(result.current.isBlocked("abuser")).toBe(true));
    act(() => result.current.unblock("abuser"));
    await waitFor(() => expect(result.current.isBlocked("abuser")).toBe(false));
    await waitFor(() => expect(deleted).toEqual(["abuser"]));
  });
});
