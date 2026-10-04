/**
 * F-D3-6 wiring — AuthProvider purges the image SW cache on SIGNED_OUT (every
 * way a session ends passes through that branch) and not on SIGNED_IN.
 * Behavioural: a mocked Supabase client fires the auth events.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

// ── AuthProvider wiring ──────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  cb: null as null | ((event: string, session: unknown) => void),
  purge: vi.fn(async () => [] as string[]),
}));
vi.mock("@/lib/imageCachePurge", () => ({ GALLERY_CACHE_PREFIX: "gallery-images-", purgeImageCache: () => h.purge() }));
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
      channel: () => chain,
      removeChannel: () => {},
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
    },
  };
});

describe("AuthProvider purges on SIGNED_OUT", () => {
  beforeEach(() => { h.purge.mockClear(); h.cb = null; });

  it("SIGNED_OUT -> purge once; SIGNED_IN -> no purge", async () => {
    const { AuthProvider } = await import("@/hooks/core/useAuth");
    render(<AuthProvider><span /></AuthProvider>);
    await act(async () => { await Promise.resolve(); });
    expect(h.cb).toBeTypeOf("function");

    await act(async () => { h.cb!("SIGNED_IN", { user: { id: "u1", user_metadata: {} } }); });
    expect(h.purge).not.toHaveBeenCalled();

    await act(async () => { h.cb!("SIGNED_OUT", null); });
    expect(h.purge).toHaveBeenCalledTimes(1);
  });
});
