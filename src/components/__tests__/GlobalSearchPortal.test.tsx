/**
 * Regression tests for the 1017 mobile search-sheet clipping bug (2026-07-28).
 *
 * ROOT CAUSE (measured, not assumed): the <nav> carries backdrop-filter,
 * which in Chromium makes it the containing block for position:fixed
 * descendants — so the sheet's `fixed inset-0` collapsed to the navbar box
 * and everything below the tab chips was clipped (live probe: 1695×88 inside
 * nav vs 1695×710 on document.body).
 *
 * THE FIX (4281fae): below the `md` breakpoint the panel is rendered through
 * createPortal(document.body); on md+ it stays in place as the anchored
 * dropdown. The click-outside handler must treat the portaled panel as
 * "inside" (panelRef), or any tap in the sheet would dismiss it.
 *
 * These tests pin all four behaviors so the bug cannot silently return.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import GlobalSearch from "@/components/GlobalSearch";

// ---- mocks: hermetic component (no network, no auth) ----

vi.mock("@/hooks/core/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

const makeQueryStub = () => {
  const stub: Record<string, unknown> = {};
  const chain = () => stub;
  for (const m of [
    "select", "eq", "ilike", "gte", "lte", "in", "or", "order", "limit",
  ]) {
    stub[m] = chain;
  }
  stub.then = (resolve: (v: { data: never[] }) => void) =>
    resolve({ data: [] });
  return stub;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => makeQueryStub(),
    rpc: () => Promise.resolve({ data: {}, error: null }),
  },
}));

vi.mock("@/lib/profilesPublic", () => ({
  profilesPublic: () => makeQueryStub(),
}));

const setViewport = (desktop: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: desktop,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
};

const renderHarness = () =>
  render(
    <MemoryRouter initialEntries={["/feed"]}>
      <GlobalSearch />
      <Routes>
        <Route path="/feed" element={<div>feed-page</div>} />
      </Routes>
    </MemoryRouter>,
  );

const openPanel = async () => {
  fireEvent.click(screen.getByLabelText("Search"));
  return await screen.findByPlaceholderText(/Search/);
};

/** The navbar-side wrapper div that holds the trigger button. */
const getWrapper = () =>
  screen.getByLabelText("Search").parentElement as HTMLElement;

describe("GlobalSearch — mobile sheet portal (1017 clipping-bug regression)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("MOBILE: panel is portaled to document.body, escaping the navbar", async () => {
    setViewport(false);
    renderHarness();
    const input = await openPanel();

    // Must NOT live inside the navbar-side wrapper (that is what put it
    // under the backdrop-filter containing block and clipped it).
    expect(getWrapper().contains(input)).toBe(false);

    // Its panel root must be a DIRECT child of document.body with the
    // full-screen fixed classes.
    let node: HTMLElement = input;
    while (node.parentElement && node.parentElement !== document.body) {
      node = node.parentElement;
    }
    expect(node.parentElement).toBe(document.body);
    expect(node.className).toContain("fixed");
    expect(node.className).toContain("inset-0");
  });

  it("MOBILE: tapping inside the portaled sheet does NOT close it", async () => {
    setViewport(false);
    renderHarness();
    const input = await openPanel();

    fireEvent.mouseDown(input); // tap inside the sheet
    // Still open:
    expect(screen.getByPlaceholderText(/Search/)).toBeInTheDocument();
  });

  it("MOBILE: clicking outside the sheet closes it", async () => {
    setViewport(false);
    renderHarness();
    await openPanel();

    fireEvent.mouseDown(document.body); // outside both wrapper and panel
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Search/)).not.toBeInTheDocument();
    });
  });

  it("DESKTOP (md+): panel stays anchored inside the wrapper — no portal", async () => {
    setViewport(true);
    renderHarness();
    const input = await openPanel();

    // The proven desktop dropdown path must be untouched by the fix.
    expect(getWrapper().contains(input)).toBe(true);
  });
});
