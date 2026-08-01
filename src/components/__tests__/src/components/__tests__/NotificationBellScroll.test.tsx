/**
 * Regression tests for "the notification list vanishes while you scroll it"
 * (owner-reported 2026-08-01, root-caused the same day).
 *
 * ROOT CAUSE (read from source, then reproduced in real Chromium at 390x844):
 * NotificationBell closed the panel on ANY scroll event, via a listener
 * registered on `window` with `capture: true`:
 *
 *     const onScroll = () => setOpen(false);
 *     window.addEventListener("scroll", onScroll, { passive: true, capture: true });
 *
 * `scroll` does not bubble, but a CAPTURE-phase listener on window still
 * receives scrolls dispatched to any element in the document — and the panel's
 * own list is a scroll container (`max-h-[480px]` + `overflow-y-auto`). So
 * dragging the notification list fired the close handler and the panel
 * disappeared under the user's finger. Measured proof: setting
 * `list.scrollTop = 300` fired the window capture listener once while
 * `document.scrollingElement.scrollTop` stayed 0 — the page never moved.
 *
 * THE FIX: ignore scrolls that originate inside the panel; keep closing on
 * page scroll. `capture: true` must stay, or page-level scroll containers
 * would stop closing it.
 *
 * These two tests pin both halves so the bug cannot silently return.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NotificationBell from "@/components/NotificationBell";

// ---- mocks: hermetic component (no network, no auth, no animation) ----

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

// framer-motion: render plain elements so open/close is synchronous in jsdom.
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => {
          // strip animation-only props jsdom would warn about
          const { initial, animate, exit, transition, ...rest } = props as Record<string, unknown>;
          void initial; void animate; void exit; void transition;
          return <div {...(rest as Record<string, unknown>)}>{children}</div>;
        },
    },
  ),
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

const openPanel = () => {
  const view = render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
  // "Mark all read" only exists inside the open panel — a reliable presence marker.
  expect(screen.getByText(/mark all read/i)).toBeInTheDocument();
  return view;
};

describe("NotificationBell — scrolling the list must not close it", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stays open when the panel's own list is scrolled (the reported bug)", () => {
    const { container } = openPanel();

    const list = container.querySelector(".overflow-y-auto");
    expect(list).not.toBeNull();

    // fireEvent.scroll dispatches a non-bubbling `scroll` Event — exactly how
    // the browser does it — and wraps the resulting React update in act().
    fireEvent.scroll(list!);

    expect(screen.queryByText(/mark all read/i)).toBeInTheDocument();
  });

  it("still closes when the PAGE scrolls behind it (original intent preserved)", () => {
    openPanel();

    fireEvent.scroll(document);

    expect(screen.queryByText(/mark all read/i)).not.toBeInTheDocument();
  });
});
