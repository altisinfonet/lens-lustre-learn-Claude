/**
 * S7b-4 carry review: profile extras and friend/follow counts are kept on the
 * phone now (OFF-1). Their readers answered a NETWORK failure with blanks as a
 * success ("none", 0 counts, empty lists), and that blank answer was written
 * over the good saved copy — offline the profile then said 0 friends and "Add
 * friend". A network failure now throws: React Query retries/pauses and the
 * saved copy stays.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// fetchUserEntries and fetchProfileMap read through their own modules; here
// they answer, so ONLY the profile-extras reads below are on a dead network.
vi.mock("@/hooks/competition/useUserEntries", async (o) => ({ ...(await o<Record<string, unknown>>()), fetchUserEntries: async () => [] }));
vi.mock("@/lib/profileMapCache", async (o) => ({ ...(await o<Record<string, unknown>>()), fetchProfileMap: async () => new Map() }));
vi.mock("@/integrations/supabase/client", () => {
  const dead = { data: null, error: { message: "TypeError: Failed to fetch", code: "" }, count: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit", "or", "not", "is", "range"]) chain[m] = () => chain;
  chain.maybeSingle = async () => dead;
  chain.single = async () => dead;
  chain.then = (r: (v: unknown) => unknown) => Promise.resolve(dead).then(r);
  return { supabase: { from: () => chain, rpc: async () => dead } };
});
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "me-1" }, loading: false }) }));

const { useFriendFollow } = await import("@/hooks/social/useFriendFollow");
const { fetchProfileExtended } = await import("@/hooks/profile/useProfileData");

describe("profile reads on a dead network", () => {
  it("friend/follow counts: the read fails, it is not 'none, 0'", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    renderHook(() => useFriendFollow("someone"), { wrapper });
    await waitFor(() => expect(qc.getQueryState(["friend-follow", "someone", "me-1"])?.status).toBe("error"));
  });
  it("profile extras: the read fails, it is not empty", async () => {
    await expect(fetchProfileExtended("someone", "me-1")).rejects.toMatchObject({ message: expect.stringMatching(/Failed to fetch/) });
  });
});
