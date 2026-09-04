/**
 * P31 · BLOCKER B — a view counter must never be able to break the page it counts,
 * and must never fail invisibly either.
 *
 * THE DEFECT THIS REPRODUCES. ManagedPageView fired:
 *
 *     supabase.rpc("increment_managed_page_view", { _page_id: pageId }).then(() => {});
 *
 * on a PUBLIC page, with no handler of any kind.
 *
 * WHAT ACTUALLY HAPPENS ON A REFUSAL — measured from the installed
 * @supabase/postgrest-js, not assumed. PostgrestBuilder.then() attaches its own
 * .catch() whenever throwOnError() was not called (it is not called here), and
 * that catch RETURNS a resolved `{ data: null, error: {...}, status: 0 }`. So a
 * revoke does NOT produce an unhandled rejection — it produces a RESOLVED
 * response carrying `error.code = "42501"`, which `.then(() => {})` discarded
 * silently. The counter would have stopped working permanently with no signal
 * anywhere. An undetectable outage is the failure mode here, not a crash.
 *
 * Both halves are still covered below, because the rejecting path is reachable
 * if this call site is ever given .throwOnError() or the client throws before
 * the builder is reached, and the cost of covering it is one .catch().
 *
 * The P31 revoke migration is not yet written and is D1's lane; this file names
 * the unit, not a guessed filename (F-75).
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

const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
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

/** The counter's own log line. Asserting on this prefix rather than on a raw
 *  console.warn call count is deliberate: React Router emits two unrelated
 *  future-flag warnings during this render, and a bare count would be measuring
 *  those instead of the control under test. */
const LOG_PREFIX = "[managed-page-view]";

let warnSpy: ReturnType<typeof vi.spyOn>;

/** Only the warnings this component emitted. */
const counterWarnings = () =>
  warnSpy.mock.calls.filter((args) => String(args[0]).startsWith(LOG_PREFIX));

beforeEach(() => {
  rpcMock.mockReset();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe("ManagedPageView view counter — non-fatal, invisible, but not silent", () => {
  it("logs exactly once when the RPC resolves with a refusal (42501)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied for function increment_managed_page_view" },
      status: 403,
    });

    renderPage();
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    await waitFor(() => expect(counterWarnings()).toHaveLength(1));
  });

  it("logs once and does not break the page when the RPC promise rejects", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));

    renderPage();
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    await waitFor(() => expect(counterWarnings()).toHaveLength(1));

    // the visitor still gets the page
    expect(screen.getByText(/the terms body a visitor came to read/i)).toBeTruthy();
  });

  it("GUARD stays silent when the increment succeeds", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null, status: 200 });

    renderPage();
    await waitFor(() => expect(rpcMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/the terms body a visitor came to read/i)).toBeTruthy(),
    );
    expect(counterWarnings()).toHaveLength(0);
  });

  it("GUARD the member never sees the counter failure — page renders regardless", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied" },
      status: 403,
    });

    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/the terms body a visitor came to read/i)).toBeTruthy(),
    );
    // nothing about the failure reaches the DOM
    expect(screen.queryByText(/permission denied/i)).toBeNull();
    expect(screen.queryByText(/42501/)).toBeNull();
  });
});
