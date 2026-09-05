/**
 * F-92 · landing on /profile/<uuid> must end up showing /<custom_url>.
 *
 * THE FALLBACK BRANCH IS THE ONE THAT MATTERS MOST. On production 15 members
 * still have no handle and D1's backfill has not run, so /profile/<id> has to
 * keep working for them. "Does nothing when custom_url is null" is not a tidy
 * edge case — it is 15 live members' profile pages.
 *
 * ON THE BACK-BUTTON ASSERTION, STATED PLAINLY. jsdom implements
 * history.replaceState and pushState but does not give a test a real back
 * button, so this file does NOT claim to prove back-button behaviour. It
 * asserts the thing an instrument here can actually see: replaceState was
 * called and pushState was NOT, and the history length did not grow. The
 * genuine article — press back, land somewhere sane — belongs in a browser
 * check, and that is said here rather than dressed up.
 */
import { render, renderHook, screen } from "@testing-library/react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useVanityUrlAddress } from "@/pages/useVanityUrlAddress";

const UUID = "b2285cae-1111-4222-8333-444444444444";
const ID_PATH = `/profile/${UUID}`;

let replaceSpy: ReturnType<typeof vi.spyOn>;
let pushSpy: ReturnType<typeof vi.spyOn>;

function atPath(path: string) {
  window.history.replaceState({}, "", path);
  replaceSpy.mockClear();
  pushSpy.mockClear();
}

beforeEach(() => {
  replaceSpy = vi.spyOn(window.history, "replaceState");
  pushSpy = vi.spyOn(window.history, "pushState");
  atPath(ID_PATH);
});
afterEach(() => {
  replaceSpy.mockRestore();
  pushSpy.mockRestore();
});

describe("F-92 · the vanity url replaces the id in the address bar", () => {
  it("rewrites /profile/<uuid> to /<custom_url> once the profile has loaded", () => {
    renderHook(() => useVanityUrlAddress(UUID, "meeraokafor"));
    expect(window.location.pathname).toBe("/meeraokafor");
  });

  it("uses replaceState and never pushState, and does not grow history", () => {
    const before = window.history.length;
    renderHook(() => useVanityUrlAddress(UUID, "meeraokafor"));
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalled();
    expect(window.history.length).toBe(before);
  });

  it("preserves the query string and hash", () => {
    atPath(`${ID_PATH}?section=about#works`);
    renderHook(() => useVanityUrlAddress(UUID, "meeraokafor"));
    expect(window.location.pathname + window.location.search + window.location.hash)
      .toBe("/meeraokafor?section=about#works");
  });

  it("rewrites only ONCE across re-renders", () => {
    const { rerender } = renderHook(() => useVanityUrlAddress(UUID, "meeraokafor"));
    rerender(); rerender();
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });
});

describe("F-92 GUARDS · what must not break", () => {
  it("changes NOTHING when custom_url is null — the id url keeps working", () => {
    renderHook(() => useVanityUrlAddress(UUID, null));
    expect(window.location.pathname).toBe(ID_PATH);
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("changes NOTHING when custom_url is an empty or whitespace string", () => {
    renderHook(() => useVanityUrlAddress(UUID, "   "));
    expect(window.location.pathname).toBe(ID_PATH);
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it("does NOT touch an address that is already the vanity url (F-86's in-place render)", () => {
    atPath("/meeraokafor");
    renderHook(() => useVanityUrlAddress(UUID, "meeraokafor"));
    expect(window.location.pathname).toBe("/meeraokafor");
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it("does NOT touch a non-profile address", () => {
    atPath("/feed");
    renderHook(() => useVanityUrlAddress(UUID, "meeraokafor"));
    expect(window.location.pathname).toBe("/feed");
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});

/**
 * ── WHAT A MEMBER SEES, WHICH A URL ASSERTION MISSES ────────────────────────
 *
 * Every test above is structural: it checks the address bar. All of them would
 * pass while the member watched the profile blank out and redraw — because the
 * URL is correct either way. That is the same class of blindness that let a 404
 * ship at 57% opacity with every structural check green.
 *
 * The visible symptom of an address-bar correction going wrong is a REMOUNT:
 * the page flashes and the queries re-run. That risk is real and specific —
 * `/profile/:userId` and `/:customUrl` are two different routes, so a
 * `navigate()` would make the router re-match and swap this page for
 * CustomUrlProfile. It therefore has to be tested WITH A ROUTER, or the
 * assertion is vacuous: in isolation nothing can remount and the test would
 * pass no matter what the hook did.
 *
 * STATED LIMIT: this proves the route does not change and the page is not
 * remounted. It does not photograph pixels, and it is not a substitute for
 * looking at the deployed page.
 */
describe("F-92 · what a member sees", () => {
  let mounts = 0;

  const Profile = () => {
    useVanityUrlAddress(UUID, "meeraokafor");
    useEffect(() => { mounts += 1; }, []);
    return <div data-testid="profile">Meera Okafor</div>;
  };
  /** Standing in for CustomUrlProfile: if the router re-matches, this appears. */
  const VanityRoute = () => <div data-testid="vanity-route">RESOLVER TOOK OVER</div>;

  const renderApp = () =>
    render(
      <BrowserRouter>
        <Routes>
          <Route path="/profile/:userId" element={<Profile />} />
          <Route path="/:customUrl" element={<VanityRoute />} />
        </Routes>
      </BrowserRouter>,
    );

  beforeEach(() => { mounts = 0; atPath(ID_PATH); });

  it("the address becomes /membername and the PAGE IS NOT SWAPPED for the resolver", () => {
    renderApp();
    expect(window.location.pathname).toBe("/meeraokafor");
    // The router must NOT have re-matched: replaceState does not notify it.
    expect(screen.getByTestId("profile")).toBeTruthy();
    expect(screen.queryByTestId("vanity-route")).toBeNull();
  });

  it("the profile mounts exactly once — no flash, no refetch", () => {
    renderApp();
    expect(window.location.pathname).toBe("/meeraokafor");
    expect(mounts).toBe(1);
  });

  it("the rewrite does not move the reader — scroll position is untouched", () => {
    Object.defineProperty(window, "scrollY", { value: 420, writable: true, configurable: true });
    renderApp();
    expect(window.location.pathname).toBe("/meeraokafor");
    expect(window.scrollY).toBe(420);
  });
});
