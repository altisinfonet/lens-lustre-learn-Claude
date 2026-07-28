/**
 * Regression test for the Android/WebView search bug (reported 2026-07-28
 * with screenshots): tapping a person in the search results navigated to
 * their profile, but the search panel SURVIVED the navigation with its
 * stale query still showing — because the result row's click handler was
 * not delivered in the WebView even though navigation happened.
 *
 * The fix is a route-change effect in GlobalSearch: ANY pathname change
 * dismisses and fully resets the panel (Instagram behavior — search never
 * stays open on top of the destination page).
 *
 * This test navigates WITHOUT going through the result row's onClick,
 * which is exactly the failure mode observed on the device.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import GlobalSearch from "@/components/GlobalSearch";

// ---- mocks: keep the component hermetic (no network, no auth) ----

vi.mock("@/hooks/core/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

// Chainable query stub: every builder method returns itself; awaiting it
// resolves to an empty result set.
const makeQueryStub = () => {
  const stub: Record<string, unknown> = {};
  const chain = () => stub;
  for (const m of [
    "select", "eq", "ilike", "gte", "lte", "in", "order", "limit",
  ]) {
    stub[m] = chain;
  }
  stub.then = (resolve: (v: { data: never[] }) => void) =>
    resolve({ data: [] });
  return stub;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => makeQueryStub() },
}));

vi.mock("@/lib/profilesPublic", () => ({
  profilesPublic: () => makeQueryStub(),
}));

// ---- harness: GlobalSearch mounted persistently (like Navbar in Layout),
// with a button that navigates the way the WebView did — NOT via the
// result row's onClick. ----

const NavigateButton = () => {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate("/profile/someone")}>go-to-profile</button>
  );
};

const renderHarness = () =>
  render(
    <MemoryRouter initialEntries={["/feed"]}>
      <GlobalSearch />
      <NavigateButton />
      <Routes>
        <Route path="/feed" element={<div>feed-page</div>} />
        <Route path="/profile/:id" element={<div>profile-page</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe("GlobalSearch — dismisses on navigation (Instagram behavior)", () => {
  it("closes the panel and clears the query when the route changes", async () => {
    renderHarness();

    // Open the panel via the trigger and type a query.
    fireEvent.click(screen.getByLabelText("Search"));
    const input = await screen.findByPlaceholderText(/Search/);
    fireEvent.change(input, { target: { value: "Sa" } });
    expect((input as HTMLInputElement).value).toBe("Sa");

    // Navigate WITHOUT touching the panel (the observed device behavior).
    fireEvent.click(screen.getByText("go-to-profile"));
    expect(await screen.findByText("profile-page")).toBeInTheDocument();

    // The panel must be gone — no lingering search input on the new page.
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Search/)).not.toBeInTheDocument();
    });

    // Reopening must start fresh: empty query, not the stale "Sa".
    fireEvent.click(screen.getByLabelText("Search"));
    const reopened = await screen.findByPlaceholderText(/Search/);
    expect((reopened as HTMLInputElement).value).toBe("");
  });
});
