/**
 * R-15 · /feed SENDS A SIGNED-OUT VISITOR TO /login, AND THAT IS THE ONLY
 * THING KEEPING THE `anon` REVOKE ON `get_broadcast_feed` SAFE.
 *
 * ⚠ NOT A SOURCE-CODE ASSERTION. It renders the real `Feed` page inside a real
 * router and reads where the router ends up.
 *
 * WHY IT EXISTS. R-15 closed Owner Decision 4 on caller evidence: the only
 * production caller of `get_broadcast_feed` is `useFeedQuery`'s 4-argument
 * overload, and it sits behind a session because `Feed.tsx` redirects a
 * signed-out visitor. Session A had called the overloads "deliberately
 * public"; on the callers that is unsupported, and it was withdrawn.
 *
 * So the whole safety of the revoke rests on one `useEffect` in one page —
 * and `/feed` is registered in `src/App.tsx` as a BARE SIBLING, outside the
 * `RequireAuth` block, so there is no second control behind it. If a refactor
 * moves or drops that effect, the revoke turns a redirect into a blank feed
 * with no error and nothing to notice it by. This is the pin for that.
 *
 * WHAT IT DOES NOT CLAIM. It does not prove the RPC is unreachable without a
 * session — the server is what proves that. It proves the client never asks.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const MEMBER = { id: "6e1a0000-1111-4222-8333-444444444444" };

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  loading: false,
}));

vi.mock("@/hooks/core/useAuth", () => ({
  useAuth: () => ({ ...authState, session: null, signOut: async () => {} }),
}));

/** Nothing here may reach a network; the page under test must not need one. */
vi.mock("@/integrations/supabase/client", () => {
  const thenable = { data: null, error: null };
  const chain: any = new Proxy(() => chain, {
    get: (_t, prop) => {
      if (prop === "then") return (r: (v: unknown) => unknown) => Promise.resolve(thenable).then(r);
      return () => chain;
    },
    apply: () => chain,
  });
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve(thenable),
      channel: () => {
        const ch: any = {};
        ch.on = () => ch;
        ch.subscribe = () => ch;
        ch.unsubscribe = () => ch;
        return ch;
      },
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
  };
});

const { default: Feed } = await import("@/pages/Feed");

const LOGIN_MARKER = "signed-out visitors land here";

function renderFeed() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/feed"]}>
        <Routes>
          <Route path="/feed" element={<Feed />} />
          <Route path="/login" element={<div>{LOGIN_MARKER}</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  authState.user = null;
  authState.loading = false;
});

describe("R-15 · /feed is not reachable without a session", () => {
  it("redirects a signed-out visitor to /login", async () => {
    renderFeed();
    await waitFor(() => expect(screen.getByText(LOGIN_MARKER)).toBeTruthy());
  });

  it("does not redirect while the session is still being resolved", async () => {
    // A member with a valid session must not be bounced to /login during the
    // moment before auth has answered. `authLoading` is what prevents that,
    // and removing it would look like a working redirect in the test above.
    authState.loading = true;

    renderFeed();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(LOGIN_MARKER)).toBeNull();
  });

  it("does not redirect a signed-in member", async () => {
    authState.user = MEMBER;

    renderFeed();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(LOGIN_MARKER)).toBeNull();
  });
});
