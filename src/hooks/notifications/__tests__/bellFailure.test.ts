/**
 * S7b-4 · a bell read that FAILED is not "no notifications". The grouped
 * notifications RPC failing was answered with an empty list as a success, so
 * the bell went blank on a dead link and OFF-1 wrote that empty list over the
 * notifications saved on the phone. It throws now: the saved ones stay.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  const fail = { data: null, error: { message: "TypeError: Failed to fetch", code: "" } };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit", "lt", "or", "not", "is", "gt"]) chain[m] = () => chain;
  chain.then = (resolve: (v: typeof fail) => unknown) => Promise.resolve(fail).then(resolve);
  return { supabase: { from: () => chain, rpc: async () => fail } };
});

const { fetchBellNotifications } = await import("@/hooks/notifications/useNotificationsQuery");

describe("a failed bell read", () => {
  it("throws instead of answering 'nothing'", async () => {
    await expect(fetchBellNotifications("me", false)).rejects.toBeTruthy();
  });
});
