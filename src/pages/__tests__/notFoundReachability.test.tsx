/**
 * F-85 · THE BRANDED 404 IS UNREACHABLE FOR EVERY SINGLE-SEGMENT DEAD URL.
 *
 * THE DEFECT THIS REPRODUCES. App.tsx declares
 *
 *     <Route path="/:customUrl" element={<CustomUrlOrIdVerification />} />   (:438)
 *     <Route path="*"          element={<NotFound />} />                     (:440)
 *
 * `/:customUrl` matches EVERY single-segment path, so the catch-all only ever
 * fires for MULTI-segment ones. A member who mistypes a URL, follows a stale
 * bookmark, or clicks a dead external link therefore lands on CustomUrlProfile,
 * which resolves nothing and calls `navigate("/not-found", { replace: true })`.
 *
 * `/not-found` is ITSELF a single segment and is not a declared route, so it
 * matches `/:customUrl` again. CustomUrlProfile remounts with
 * customUrl="not-found", fails to resolve that too, navigates to where it
 * already is, `checking` flips false, and the component reaches `return null`.
 *
 * The member sees the header, the footer, and NOTHING BETWEEN THEM. No 404, no
 * message, no way back — on a path that should have been the one page in the
 * app whose entire job is to help someone who is lost.
 *
 * WHY THIS IS A ROUTE-LEVEL TEST AND NOT A COMPONENT ONE. The bug is not inside
 * CustomUrlProfile; it is in the interaction between that component's redirect
 * and the route table's greedy `/:customUrl`. Rendering the component alone
 * would show it calling `navigate` and prove nothing about where a member ends
 * up. So this file mounts the real route shape and lets the redirect loop
 * actually happen, exactly as it does in the browser.
 *
 * THE TWO GUARD TESTS ARE NOT PADDING. "a resolvable vanity URL still reaches
 * the profile" and "a multi-segment dead path still reaches the 404" pass BOTH
 * before and after the fix, deliberately. A fix that rendered NotFound
 * unconditionally would satisfy the headline assertions and break every vanity
 * URL on the site — a far worse bug than the one it replaced. These two are the
 * only thing standing in the way of that.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { I18nProvider } from "@/i18n/I18nContext";
import CustomUrlProfile from "@/pages/CustomUrlProfile";
import NotFound from "@/pages/NotFound";

// ---- mocks: keep the resolver hermetic (no network) ----

const rpcMock = vi.fn();
const maybeSingleMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: () => ({
      select: () => ({
        ilike: () => ({ maybeSingle: () => maybeSingleMock() }),
        eq: () => ({ maybeSingle: () => maybeSingleMock() }),
      }),
    }),
  },
}));

/** The dead path a member actually types. Distinctive so the echo assertion
 *  cannot pass by accident on some other piece of copy. */
const DEAD_URL = "/zzz-definitely-not-a-page-98765";

/**
 * The route shape from App.tsx, reduced to the three routes this defect lives
 * in. `/:customUrl` before `*` is the ordering the real table uses; changing it
 * here would test a route table that does not exist.
 */
function renderAt(path: string) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/profile/:id" element={<div>PROFILE PAGE</div>} />
          <Route path="/:customUrl" element={<CustomUrlProfile />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  maybeSingleMock.mockReset();
  // Default: nothing resolves — the dead-URL case.
  rpcMock.mockResolvedValue({ data: [] });
  maybeSingleMock.mockResolvedValue({ data: null });
});

describe("F-85 · the branded 404 must be reachable", () => {
  it("a dead SINGLE-SEGMENT url reaches the 404 instead of a blank page", async () => {
    renderAt(DEAD_URL);
    expect(await screen.findByText("404")).toBeTruthy();
  });

  it("the 404 echoes the url the member actually asked for, not /not-found", async () => {
    renderAt(DEAD_URL);
    await screen.findByText("404");
    expect(screen.getByText(DEAD_URL)).toBeTruthy();
    expect(screen.queryByText("/not-found")).toBeNull();
  });

  it("/not-found itself reaches the 404 rather than looping", async () => {
    renderAt("/not-found");
    expect(await screen.findByText("404")).toBeTruthy();
  });

  it("GUARD a resolvable vanity url still reaches the profile, with no 404 shown", async () => {
    rpcMock.mockResolvedValue({ data: [{ user_id: "user-1", is_current: true }] });
    renderAt("/a-real-member");
    expect(await screen.findByText("PROFILE PAGE")).toBeTruthy();
    // A fix that rendered NotFound on the way through would break every vanity
    // URL on the site while still satisfying the three tests above.
    expect(screen.queryByText("404")).toBeNull();
  });

  it("GUARD an old vanity url redirecting to a live one never flashes the 404", async () => {
    // The component is NOT remounted when only the route param changes — the
    // effect re-runs on the same instance. So `checking` must be reset when
    // customUrl changes, or the second leg renders with a stale checking=false
    // and shows a 404 over a URL that is still being resolved.
    rpcMock
      .mockResolvedValueOnce({ data: [{ user_id: "user-1", is_current: false }] })
      // Second leg: still in flight. A never-settling promise holds the
      // component in exactly the window the flash would appear in.
      .mockReturnValueOnce(new Promise(() => {}));
    maybeSingleMock.mockResolvedValue({ data: { id: "user-1", custom_url: "new-url" } });

    renderAt("/old-url");

    // Wait until the SECOND leg has actually begun — a bare findByText would
    // race, matching the first leg's spinner before the redirect even happens
    // and asserting nothing about the window this guard exists for.
    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Loading…")).toBeTruthy();
    });
    expect(screen.queryByText("404")).toBeNull();
  });

  it("GUARD a dead MULTI-SEGMENT path still reaches the 404", async () => {
    renderAt("/foo/bar/baz-does-not-exist");
    expect(await screen.findByText("404")).toBeTruthy();
  });
});
