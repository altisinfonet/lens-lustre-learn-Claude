/**
 * F-85 + F-86 · ONE ROOT CAUSE: CustomUrlProfile NAVIGATES WHERE IT SHOULD RENDER.
 *
 * App.tsx:438 declares `<Route path="/:customUrl" element={<CustomUrlOrIdVerification />} />`,
 * which matches EVERY single-segment path. Everything below follows from that
 * one route plus a component that answers it with `navigate()`.
 *
 * F-86 — THE VANITY URL DOES NOT SURVIVE. On the `is_current` branch the
 * component called `navigate("/profile/" + user_id, { replace: true })`. The
 * profile rendered, but the address bar became `/profile/<uuid>`. Three real
 * consequences: the feature is defeated (a member shares /theirname and the
 * recipient sees a UUID); an INTERNAL USER UUID becomes the public identity on
 * every profile visit, with `replace: true` meaning Back does not even return
 * to the vanity URL; and search engines index `/profile/<uuid>` rather than the
 * clean name, so the vanity URL can never rank. Measured on production against
 * /50mmretinaworld, and 96 of 111 production profiles carry a custom_url.
 *
 * F-85 — THE BRANDED 404 IS UNREACHABLE. Because `/:customUrl` is greedy, the
 * catch-all `<Route path="*" element={<NotFound />} />` at :440 only ever fires
 * for MULTI-segment paths. A dead single-segment URL called
 * `navigate("/not-found", { replace: true })`; "/not-found" is itself a single
 * segment and is not a declared route, so it matched `/:customUrl` again, the
 * component re-resolved "not-found", failed, navigated to where it already was,
 * `checking` flipped false and it hit `return null` — a header, a footer, and
 * nothing in between for every mistyped URL, stale bookmark and dead inbound
 * link.
 *
 * WHY THESE ARE ROUTE-LEVEL TESTS. Neither defect is visible inside the
 * component: both are about WHERE THE MEMBER ENDS UP. So this file mounts the
 * real route shape and asserts the resulting location, not just the render. The
 * location assertions are the whole finding for F-86 — a test that only checked
 * "the profile appeared" would have passed on the broken code.
 *
 * WHAT IS MOCKED AND WHY. `PublicProfileInner` is replaced with a marker. These
 * tests are about routing and the address bar; PublicProfile's own rendering has
 * its own tests, and pulling its auth/query stack in here would test that stack
 * instead of this defect. The marker still proves the profile is rendered IN
 * PLACE by CustomUrlProfile rather than reached by a redirect, which is exactly
 * the distinction under test.
 *
 * THE GUARDS ARE NOT PADDING. `/profile/:userId` must keep working — existing
 * links depend on it and it is the fallback for a member with no custom_url —
 * and a fix that rendered NotFound unconditionally would satisfy the headline
 * assertions while breaking every vanity URL on the site.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { I18nProvider } from "@/i18n/I18nContext";
import CustomUrlProfile from "@/pages/CustomUrlProfile";
import NotFound from "@/pages/NotFound";

// ---- mocks ----

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

vi.mock("@/pages/PublicProfile", () => ({
  __esModule: true,
  default: () => <div>PROFILE VIA /profile ROUTE</div>,
  PublicProfileInner: ({ userId }: { userId: string }) => <div>PROFILE IN PLACE: {userId}</div>,
}));

/** The production values from the Auditor's own reading, used verbatim. */
const VANITY = "50mmretinaworld";
const USER_ID = "4c200b33-ae64-46f0-ba5d-1a97152e6a6c";

/** Reports the live address bar so the tests can assert it, not infer it. */
const LocationProbe = () => {
  const { pathname } = useLocation();
  return <div data-testid="path">{pathname}</div>;
};

function renderAt(path: string) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path="/profile/:userId" element={<div>PROFILE VIA /profile ROUTE</div>} />
          <Route path="/:customUrl" element={<CustomUrlProfile />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

const path = () => screen.getByTestId("path").textContent;

beforeEach(() => {
  rpcMock.mockReset();
  maybeSingleMock.mockReset();
  rpcMock.mockResolvedValue({ data: [] });
  maybeSingleMock.mockResolvedValue({ data: null });
});

describe("F-86 · the vanity url must survive", () => {
  it("a current vanity url renders the profile AND keeps /membername in the address bar", async () => {
    rpcMock.mockResolvedValue({ data: [{ user_id: USER_ID, is_current: true }] });

    renderAt(`/${VANITY}`);

    expect(await screen.findByText(`PROFILE IN PLACE: ${USER_ID}`)).toBeTruthy();
    // The whole finding. A redirect would render a profile too — at /profile/<uuid>.
    expect(path()).toBe(`/${VANITY}`);
    expect(path()).not.toContain(USER_ID);
  });

  it("the profiles_public_data FALLBACK path keeps /membername too", async () => {
    // Members who set a custom_url before custom_url_history existed resolve
    // through the ilike fallback, not through the RPC. That is a SECOND success
    // path and it destroyed the vanity URL exactly the same way. Fixing only the
    // history branch would look fixed for whichever accounts happened to be
    // tested and leave every legacy member landing on a UUID.
    rpcMock.mockResolvedValue({ data: [] });
    maybeSingleMock.mockResolvedValue({ data: { id: USER_ID } });

    renderAt(`/${VANITY}`);

    expect(await screen.findByText(`PROFILE IN PLACE: ${USER_ID}`)).toBeTruthy();
    expect(path()).toBe(`/${VANITY}`);
    expect(path()).not.toContain(USER_ID);
  });

  it("a RENAMED vanity url settles on the new VANITY path, never on /profile/<uuid>", async () => {
    rpcMock
      .mockResolvedValueOnce({ data: [{ user_id: USER_ID, is_current: false }] })
      .mockResolvedValue({ data: [{ user_id: USER_ID, is_current: true }] });
    maybeSingleMock.mockResolvedValue({ data: { id: USER_ID, custom_url: "newname" } });

    renderAt("/oldname");

    await waitFor(() => expect(path()).toBe("/newname"));
    expect(path()).not.toContain(USER_ID);
  });
});

describe("F-85 · the branded 404 must be reachable", () => {
  it("an unresolvable single-segment url renders the 404 instead of a blank page", async () => {
    renderAt("/zzz-definitely-not-a-page-98765");
    expect(await screen.findByText("404")).toBeTruthy();
  });

  it("the 404 keeps the typed path, so it echoes the real dead address", async () => {
    renderAt("/zzz-definitely-not-a-page-98765");
    await screen.findByText("404");
    expect(path()).toBe("/zzz-definitely-not-a-page-98765");
    // The 404 page echoes the path itself. Two nodes carry that text — this
    // file's location probe and NotFound's own <span> — so assert on the one
    // that is NOT the probe, or the assertion would pass on the probe alone.
    const echoes = screen.getAllByText("/zzz-definitely-not-a-page-98765");
    expect(echoes.some((el) => el.getAttribute("data-testid") !== "path")).toBe(true);
  });

  it("/not-found itself reaches the 404 rather than looping", async () => {
    renderAt("/not-found");
    expect(await screen.findByText("404")).toBeTruthy();
  });
});

describe("GUARDS · what must not break", () => {
  it("a member with NO custom_url still falls back to /profile/<id>", async () => {
    rpcMock.mockResolvedValue({ data: [{ user_id: USER_ID, is_current: false }] });
    maybeSingleMock.mockResolvedValue({ data: { id: USER_ID, custom_url: null } });

    renderAt("/oldname");

    await waitFor(() => expect(path()).toBe(`/profile/${USER_ID}`));
    expect(await screen.findByText("PROFILE VIA /profile ROUTE")).toBeTruthy();
  });

  it("a dead MULTI-SEGMENT path still reaches the 404", async () => {
    renderAt("/foo/bar/baz-does-not-exist");
    expect(await screen.findByText("404")).toBeTruthy();
  });

  it("a renamed url in flight never flashes the 404 over the new address", async () => {
    // React Router does not remount on a param change — the same instance
    // re-runs the effect — so `checking` must be reset, or the second leg
    // renders with a stale checking===false over a URL still being resolved.
    rpcMock
      .mockResolvedValueOnce({ data: [{ user_id: USER_ID, is_current: false }] })
      .mockReturnValueOnce(new Promise(() => {}));
    maybeSingleMock.mockResolvedValue({ data: { id: USER_ID, custom_url: "newname" } });

    renderAt("/oldname");

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Loading…")).toBeTruthy();
    });
    expect(screen.queryByText("404")).toBeNull();
  });
});
