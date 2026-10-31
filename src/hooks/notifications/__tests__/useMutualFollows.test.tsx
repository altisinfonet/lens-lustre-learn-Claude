import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));

import { useMutualFollowCounts } from "@/hooks/notifications/useMutualFollows";

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe("useMutualFollowCounts (N7, SQL 0190)", () => {
  beforeEach(() => rpc.mockReset());

  it("asks once for the distinct actors and maps the counts", async () => {
    rpc.mockResolvedValue({ data: [{ actor_id: "a", mutual: 3 }, { actor_id: "b", mutual: 0 }], error: null });
    const { result } = renderHook(() => useMutualFollowCounts(["b", "a", "a"], true), { wrapper: wrap });
    await waitFor(() => expect(result.current.get("a")).toBe(3));
    expect(result.current.get("b")).toBe(0);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("notif_mutual_follow_counts", { _actors: ["a", "b"] });
  });

  it("asks nothing while the centre screens are off, or with no actors", () => {
    renderHook(() => useMutualFollowCounts(["a"], false), { wrapper: wrap });
    renderHook(() => useMutualFollowCounts([], true), { wrapper: wrap });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an error means no counts (the row just shows no extra line)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    const { result } = renderHook(() => useMutualFollowCounts(["a"], true), { wrapper: wrap });
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(result.current.get("a")).toBeUndefined();
  });
});
