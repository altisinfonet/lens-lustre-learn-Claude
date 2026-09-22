/**
 * R-16 · THE CLIENT NO LONGER COUNTS, AND MUST NOT START AGAIN.
 *
 * ── WHAT THIS FILE USED TO ASSERT, AND WHY THREE OF ITS FOUR ASSERTIONS ARE
 *    GONE RATHER THAN WEAKENED ────────────────────────────────────────────────
 *
 * Until R-16 this file held four assertions about a call that `ManagedPageView`
 * made itself:
 *
 *   1. "logs exactly once when the RPC resolves with a refusal (42501)"
 *   2. "logs once and does not break the page when the RPC promise rejects"
 *   3. "GUARD stays silent when the increment succeeds"
 *   4. "GUARD the member never sees the counter failure - page renders regardless"
 *
 * 1-3 were assertions about `supabase.rpc("increment_managed_page_view", …)`
 * and the `console.warn` beside it, both inside this component. R-16 moved the
 * increment to `functions/page/[slug].ts`, where it runs with `service_role`,
 * and DELETED the client call — that deletion is the entire point, because the
 * client call is the only reason the grant had to be open to `anon`. Their
 * subject no longer exists, so they could not be satisfied by any amount of
 * work on this component. Keeping them would have meant restoring the call.
 *
 * THE INTENT THEY CARRIED IS NOT GONE. It was "a view counter must never break
 * the page it counts, and must never fail invisibly either", and it now lives
 * where the counter lives:
 *
 *   · resolved refusal (the revoke-day 42501) ─┐
 *   · outright failure (dead network)          ├─ src/__tests__/managedPageEdgeViewCount.test.ts
 *   · missing service-role key, loudly         ┘
 *
 * Each of those is mutation-verified there. 4 is a CLIENT-side guard and is
 * kept below, unchanged in intent.
 *
 * ── WHAT THIS FILE ASSERTS NOW ───────────────────────────────────────────────
 *
 * The client's half of R-16 is a NEGATIVE contract, and it is the load-bearing
 * one: this page must not call `increment_managed_page_view` at all. If it ever
 * does again — a "fallback", a retry, a well-meaning restoration — the `anon`
 * grant becomes load-bearing again and D1's revoke turns a public page's
 * counter into a permanent silent failure. That is stronger than the three
 * assertions it replaces, not weaker: those checked how a failure was reported,
 * this one checks that the call cannot happen.
 *
 * Both new assertions are shown RED against the pre-R-16 component
 * (`247a47b`) — see docs/evidence/d2/phase1/unit2-c34-red.txt.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import ManagedPageView from "@/pages/ManagedPageView";

const PAGE = {
  id: "page-1",
  title: "Terms of Service",
  slug: "terms",
  content: "<p>The terms body a visitor came to read.</p>",
  meta_title: "Terms",
  meta_description: "Terms",
  og_image: "",
  noindex: false,
  is_published: true,
  view_count: 7,
  json_ld: "",
  translations: {},
};

/** Every RPC the component attempts, by name. It must attempt none. */
const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      rpcMock(...args);
      return Promise.resolve({ data: null, error: null, status: 200 });
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { value: [PAGE] }, error: null }),
        }),
      }),
    }),
  },
}));

vi.mock("@/components/PageSEO", () => ({ default: () => null }));

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/page/terms"]}>
        <Routes>
          <Route path="/page/:slug" element={<ManagedPageView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const BODY = /the terms body a visitor came to read/i;

/** The counter's old log prefix. Nothing should emit it from here any more. */
const LOG_PREFIX = "[managed-page-view]";

let warnSpy: ReturnType<typeof vi.spyOn>;
const counterWarnings = () =>
  warnSpy.mock.calls.filter((args) => String(args[0]).startsWith(LOG_PREFIX));

beforeEach(() => {
  rpcMock.mockReset();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("ManagedPageView — the client does not count, and must not start again", () => {
  it("never calls increment_managed_page_view — the anon grant must stay withdrawable", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(BODY)).toBeTruthy());

    const names = rpcMock.mock.calls.map((args) => String(args[0]));
    expect(
      names,
      "the client called the RPC that R-16 moved to the edge; D1's anon revoke " +
        "would turn this page's counter into a permanent silent failure",
    ).not.toContain("increment_managed_page_view");
  });

  it("makes no RPC call at all while rendering a managed page", async () => {
    // Broader than the assertion above on purpose: a counter reintroduced
    // under a different function name would slip past a name check.
    renderPage();
    await waitFor(() => expect(screen.getByText(BODY)).toBeTruthy());

    expect(
      rpcMock.mock.calls.map((args) => String(args[0])),
      "this route reads site_settings and renders; it performs no RPC",
    ).toEqual([]);
  });

  it("GUARD still renders the page body after the counter was removed", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(BODY)).toBeTruthy());
  });

  it("GUARD nothing about view counting reaches the member", async () => {
    // Kept from the pre-R-16 file. It was the member-facing half of "a view
    // counter must never break the page it counts", and it still is.
    renderPage();
    await waitFor(() => expect(screen.getByText(BODY)).toBeTruthy());

    expect(counterWarnings()).toHaveLength(0);
    expect(screen.queryByText(/permission denied/i)).toBeNull();
    expect(screen.queryByText(/42501/)).toBeNull();
  });
});
