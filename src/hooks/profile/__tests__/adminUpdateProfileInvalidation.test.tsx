import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
    channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch; },
    removeChannel: () => {},
  },
}));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "admin" } }) }));
vi.mock("@/hooks/core/use-toast", () => ({ toast: vi.fn() }));

import { useAdminUpdateProfile } from "@/hooks/profile/useProfileMutations";
import { setProfileMapQueryClient } from "@/lib/profileMapCache";
import { queryKeys } from "@/lib/queryKeys";

describe("S11 — an admin's edit to a member refreshes that member everywhere they are shown", () => {
  it("every cached profile map that CONTAINS the member is invalidated, not only one keyed by [member]", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    setProfileMapQueryClient(qc);
    // Real keys are SORTED id lists of whoever is on screen: the member is rarely first or alone.
    const maps = [queryKeys.profileMap(["aaa", "u1", "zzz"]), queryKeys.profileDetailMap(["aaa", "u1"]), queryKeys.profileMap(["u1"])];
    for (const k of maps) qc.setQueryData(k, new Map());
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useAdminUpdateProfile(), { wrapper });
    result.current.mutate({ userId: "u1", fields: { full_name: "New Name" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    for (const k of maps) expect(qc.getQueryState(k)?.isInvalidated, JSON.stringify(k)).toBe(true);
  });
});
