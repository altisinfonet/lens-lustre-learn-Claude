/**
 * Owner 2026-10-29, app 1.2.29 on a poor / no network: the account sheet said
 * "Photographer" instead of the member's name. The profile request failed, and
 * fetchProfileCore read the failure as "no profile" (null) — a SUCCESS that
 * replaced the name on screen and on the phone. A failed request must be an
 * error, so React Query keeps the last good name.
 */
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const result: { data: unknown; error: unknown } = { data: null, error: null };
vi.mock("@/lib/profilesPublic", () => ({
  profilesPublic: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
}));
vi.mock("@/lib/adminBrand", () => ({
  getAdminIds: async () => [],
  resolveName: (_id: string, name: string) => name,
  resolveBadges: () => [],
  isAdminUser: () => false,
}));

import { useProfileCore } from "@/hooks/profile/useProfileData";
import { queryKeys } from "@/lib/queryKeys";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

describe("own profile on a poor network", () => {
  it("a failed request keeps the last good name (it is an error, not 'no profile')", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(queryKeys.profileCore("me"), { full_name: "Neil" }, { updatedAt: Date.now() - 60_000 });
    result.data = null;
    result.error = { message: "TypeError: Failed to fetch" };
    const { result: hook } = renderHook(() => useProfileCore("me"), { wrapper });
    await waitFor(() => expect(hook.current.isError).toBe(true));
    expect(hook.current.data).toEqual({ full_name: "Neil" });
  });

  it("a member who truly has no profile row still reads as null (unchanged)", async () => {
    const { wrapper } = setup();
    result.data = null;
    result.error = null;
    const { result: hook } = renderHook(() => useProfileCore("nobody"), { wrapper });
    await waitFor(() => expect(hook.current.isSuccess).toBe(true));
    expect(hook.current.data).toBeNull();
  });
});
