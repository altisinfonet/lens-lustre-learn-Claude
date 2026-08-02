/**
 * Regression tests for "the notification panel will not go away"
 * (owner-reported 2026-08-01, root-caused the same day on PRODUCTION).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS MEASURED, not guessed
 *
 * On the live site (build 2026-08-01-17), desktop Chrome:
 *
 *   1. open the bell
 *   2. click "See All"  ->  URL becomes /notifications, page renders behind
 *   3. read the panel node back out of the DOM:
 *
 *        panelsInDom : 1
 *        isConnected : true
 *        opacity     : "0"
 *        transform   : "matrix(0.95, 0, 0, 0.95, 0, 8)"
 *        display     : "flex"      height: 456px
 *
 * That transform and that opacity ARE framer-motion's
 * `exit={{ opacity: 0, y: 8, scale: 0.95 }}` at its final frame. So the close
 * ran, the exit animation ran to completion, and then AnimatePresence never
 * unmounted the element. It stays in the layout for the rest of the session.
 *
 * `document.elementFromPoint()` at the middle of that box returned a node
 * INSIDE the panel, with `pointer-events: auto` — a 304x456 invisible rectangle
 * parked over the top-right of every page, eating every click inside it until
 * a full reload. On Android the exit animation cannot run at all (the webview
 * suspends it), so there the same node stays at opacity 1 and the panel is
 * simply visible on top of the new page — which is what the owner screenshotted.
 *
 * THE RULE THESE TESTS EXIST TO ENFORCE
 *
 *   Removing the panel must never depend on an animation completing, and must
 *   never depend on a single click handler being delivered.
 *
 * Four independent layers implement that; each one is pinned below. The
 * existing NotificationBellScroll.test.tsx could not have caught any of this,
 * because it mocks framer-motion away entirely — so this file deliberately
 * does NOT mock it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { readFileSync } from "node:fs";
import NotificationBell from "@/components/NotificationBell";

/* ── hermetic mocks: no network, no auth, no sound ───────────────────────────
   NOTE the omission: framer-motion is NOT mocked. That is the point of this
   file. Mocking it is what made the original bug invisible to the test suite. */

vi.mock("@/hooks/core/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/hooks/core/useIsAdmin", () => ({
  useIsAdmin: () => ({ isAdmin: false }),
}));

vi.mock("@/hooks/core/useNotificationSound", () => ({
  useNotificationSound: () => ({ playNotificationSound: () => {} }),
}));

vi.mock("@/lib/notificationLinks", () => ({
  getNotifLink: () => "/",
}));

vi.mock("@/components/UserIdentityBlock", () => ({
  default: () => <span>actor</span>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
}));

const NOTIF = {
  id: "n1",
  type: "post_comment",
  title: "New comment",
  message: "Someone commented on your photo",
  reference_id: "post-1",
  actor_id: "actor-1",
  created_at: new Date().toISOString(),
};

vi.mock("@/hooks/notifications/useNotificationsQuery", () => ({
  useNotificationsQuery: () => ({
    friendRequests: [],
    giftNotifications: [],
    adminNotifications: [],
    userNotifications: [NOTIF],
    totalCount: 1,
    isLoading: false,
    cache: {
      insertUserNotification: vi.fn(),
      insertFriendRequest: vi.fn(),
      removeFriendRequest: vi.fn(),
      insertGift: vi.fn(),
      removeGift: vi.fn(),
      insertAdminNotification: vi.fn(),
      removeAdminNotification: vi.fn(),
      removeUserNotification: vi.fn(),
      clearAll: vi.fn(),
      patch: vi.fn(),
    },
  }),
}));

/** "Mark all read" exists only inside the open panel — a reliable presence marker. */
const panelIsOpen = () => screen.queryByText(/mark all read/i) !== null;
const openBell = () => fireEvent.click(screen.getByRole("button", { name: /notifications/i }));

/**
 * A button that navigates, rendered OUTSIDE the bell. This is the crux: it
 * models every way the app can change route without the bell's own onClick
 * running — a swallowed tap in the Android webview, the browser back button,
 * a push-notification deep link, a redirect from anywhere else.
 */
const NavigateAway = () => {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/notifications")}>go elsewhere</button>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the panel cannot survive a route change", () => {
  it("closes when something OUTSIDE the bell navigates", () => {
    // RED before the fix: nothing in NotificationBell watched the location, so
    // the panel simply stayed open on the new route. This is the owner's bug
    // expressed as a unit test.
    render(
      <MemoryRouter>
        <NotificationBell />
        <NavigateAway />
      </MemoryRouter>,
    );

    openBell();
    expect(panelIsOpen()).toBe(true);

    fireEvent.click(screen.getByText("go elsewhere"));

    expect(panelIsOpen()).toBe(false);
  });

  it("closes when the footer link navigates, with framer-motion REAL", () => {
    // The same click the owner made. With the real animation library in play,
    // this is the case that used to leave a node behind at opacity 0.
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    openBell();
    expect(panelIsOpen()).toBe(true);

    fireEvent.click(screen.getByText(/see all/i));

    // No waitFor, no timer advance: removal must be synchronous with the state
    // change. If it needs an animation frame to finish, this fails — correctly.
    expect(panelIsOpen()).toBe(false);
  });
});

describe("the panel can always be dismissed", () => {
  it("closes on Escape", () => {
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    openBell();
    expect(panelIsOpen()).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(panelIsOpen()).toBe(false);
  });

  it("renders a backdrop, and pointerdown on it closes the panel", () => {
    // RED before the fix: the JSX had an EMPTY fragment where a backdrop used
    // to be, so on a phone there was nothing to tap to dismiss.
    render(
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>,
    );

    openBell();

    const scrim = document.querySelector('[data-testid="notif-scrim"]');
    expect(scrim, "an open panel must render a backdrop").not.toBeNull();

    // pointerdown, not click: Android webviews drop the click on an element
    // that disappears under the finger. GlobalSearch already learned this.
    fireEvent.pointerDown(scrim!);

    expect(panelIsOpen()).toBe(false);
  });
});

describe("the architectural decision is pinned, not just the behaviour", () => {
  it("does not gate removal on an exit animation", () => {
    // Behaviour tests can pass for the wrong reason once jsdom or the animation
    // library changes. This reads the source and fails the build if the exact
    // construct that caused the production bug comes back.
    const raw = readFileSync("src/components/NotificationBell.tsx", "utf-8");
    // Strip comments before asserting. The file explains at length WHY these
    // constructs are gone, and that explanation must not be what trips the
    // assertion — a test that fails because of its own documentation is worse
    // than no test.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(
      src.includes("AnimatePresence"),
      "AnimatePresence keeps an exiting child MOUNTED until its animation reports " +
        "completion. On 2026-08-01 that completion never came and a 304x456 invisible " +
        "click-eating box was left over every page. Removal must be plain React " +
        "reconciliation — see the header of this file.",
    ).toBe(false);

    expect(
      /\bexit\s*=\s*\{/.test(src),
      "An `exit` prop puts an animation back in the unmount path.",
    ).toBe(false);

    expect(
      src.includes("useDismissOnRouteChange"),
      "The route-change dismissal is the layer that holds when a click is never " +
        "delivered at all. It must stay wired up.",
    ).toBe(true);
  });
});
