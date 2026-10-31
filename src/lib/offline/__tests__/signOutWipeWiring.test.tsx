/**
 * OFF-4 wiring — AuthProvider runs the full wipe on SIGNED_OUT (every session
 * end) and not on SIGNED_IN.
 */
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";

const h = vi.hoisted(() => ({ cb: null as null | ((e: string, s: unknown) => void), wipe: vi.fn(async () => ({})) }));
vi.mock("@/lib/offline/signOutWipe", () => ({ wipeMemberDataOnSignOut: () => h.wipe() }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, { on: self, subscribe: self, select: self, eq: self, maybeSingle: async () => ({ data: null, error: null }), insert: async () => ({}) });
  return {
    supabase: {
      auth: {
        onAuthStateChange: (cb: (e: string, s: unknown) => void) => { h.cb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
        getSession: async () => ({ data: { session: null }, error: null }),
        signOut: async () => ({}),
      },
      channel: () => chain, removeChannel: () => {}, from: () => chain, rpc: async () => ({ data: null, error: null }),
    },
  };
});

describe("AuthProvider wipes member data on SIGNED_OUT", () => {
  it("SIGNED_IN -> no wipe; SIGNED_OUT -> one wipe", async () => {
    const { AuthProvider } = await import("@/hooks/core/useAuth");
    render(<AuthProvider><span /></AuthProvider>);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { h.cb!("SIGNED_IN", { user: { id: "u1", user_metadata: {} } }); });
    expect(h.wipe).not.toHaveBeenCalled();
    await act(async () => { h.cb!("SIGNED_OUT", null); });
    expect(h.wipe).toHaveBeenCalledTimes(1);
  });
});
