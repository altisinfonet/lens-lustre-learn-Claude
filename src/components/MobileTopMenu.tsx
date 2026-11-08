import { Suspense, lazy, useCallback, useState } from "react";
import { Menu } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { useNotificationsQuery } from "@/hooks/notifications/useNotificationsQuery";

/** GlobalSearch listens for this and opens its sheet (its own icon is hidden on phones). */
export const OPEN_SEARCH_EVENT = "app:open-search";

// The sheet loads only when ☰ is tapped (P13 entry-bundle ceiling).
const MobileMenuSheet = lazy(() => import("./MobileMenuSheet"));

/**
 * THE PHONE / APP TOP BAR'S THREE-LINE MENU — the trigger.
 *
 * Owner, 8 Nov 2026: the bar is "+ 50mm Retina World and Three lines style";
 * bell and search live under ☰, not in the bar. He approved STYLE 2 · BOTTOM
 * DOCK (MobileMenuSheet). A blue→gold dot on ☰ means something is unread — the
 * bell that used to show it is no longer in the bar.
 */
export default function MobileTopMenu() {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  // the same cached query the bell reads — no second request
  const { unreadTotal } = useNotificationsQuery(user?.id, isAdmin);
  const unread = Math.max(0, unreadTotal || 0);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Menu, ${unread} unread notifications` : "Menu"}
        aria-expanded={open}
        className="relative grid h-11 w-11 place-items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Menu className="h-6 w-6" />
        {unread > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-gradient-to-br from-primary to-amber-400 ring-2 ring-background" />}
      </button>
      {open && (
        <Suspense fallback={null}>
          <MobileMenuSheet
            unread={unread}
            onClose={close}
            onNotifications={() => { close(); navigate("/notifications"); }}
            onSearch={() => { close(); window.setTimeout(() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT)), 0); }}
          />
        </Suspense>
      )}
    </>
  );
}
