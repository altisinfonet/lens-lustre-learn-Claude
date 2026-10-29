/**
 * AuthProvider's deferred sign-in work never runs after the provider is gone.
 *
 * Android Build run 40943931632 (2026-10-29, 1.2.31) failed its unit-test gate
 * with "ReferenceError: sessionStorage is not defined" from linkReferral
 * (useAuth.tsx), fired by a setTimeout scheduled on SIGNED_IN and never cleared
 * when the provider unmounted — it ran after the test environment was torn
 * down (signOutWipeWiring.test.tsx). Six deferred tasks are scheduled this way
 * (profile name, referral link, auth/device log); none may outlive the provider.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

const h = vi.hoisted(() => ({ cb: null as null | ((e: string, s: unknown) => void), referralReads: 0 }));
vi.mock("@/lib/offline/signOutWipe", () => ({ wipeMemberDataOnSignOut: async () => ({}) }));
vi.mock("@/hooks/notifications/useReferral", () => ({
  getStoredReferralCode: () => { h.referralReads++; return null; },
  clearStoredReferralCode: () => {},
}));
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

beforeEach(() => { h.referralReads = 0; vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
afterEach(() => { vi.useRealTimers(); });

describe("AuthProvider deferred sign-in work", () => {
  it("runs while the provider is mounted", async () => {
    const { AuthProvider } = await import("@/hooks/core/useAuth");
    render(<AuthProvider><span /></AuthProvider>);
    await act(async () => { h.cb!("SIGNED_IN", { user: { id: "u1", user_metadata: {} } }); });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(h.referralReads).toBe(1);
  });

  it("is cancelled when the provider unmounts (never fires after teardown)", async () => {
    const { AuthProvider } = await import("@/hooks/core/useAuth");
    const view = render(<AuthProvider><span /></AuthProvider>);
    await act(async () => { h.cb!("SIGNED_IN", { user: { id: "u1", user_metadata: {} } }); });
    view.unmount();
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(h.referralReads, "linkReferral ran after the provider unmounted").toBe(0);
  });
});
