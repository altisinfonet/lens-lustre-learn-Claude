import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bell, ChevronRight, Menu, Search } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { useNotificationsQuery } from "@/hooks/notifications/useNotificationsQuery";

/** GlobalSearch listens for this and opens its sheet (its own icon is hidden on phones). */
export const OPEN_SEARCH_EVENT = "app:open-search";

/**
 * THE PHONE / APP TOP BAR'S THREE-LINE MENU.
 *
 * Owner, 8 Nov 2026: the bar is "+ 50mm Retina World and Three lines style";
 * bell and search live under ☰, not in the bar. Of five real-render styles he
 * approved STYLE 2 · BOTTOM DOCK ("needs to be matched as output"): a sheet
 * rises from the bottom with a large search field first, then Notifications
 * with its unread count. Approved sample:
 * _control/out/OWNER/samples-2026-11-08/SAMPLE-3-menu-styles.png (Style 2).
 * Sizes, colours and spacing below are that sample's — change them only with a
 * new yes.
 *
 * The sheet is a dialog (role + data-state="open"), so Android Back and Escape
 * close it (useAndroidBackButton), as does a tap on the blurred backdrop.
 */

/** brand blue → gold, the story ring's colours */
const BRAND = "bg-gradient-to-br from-primary to-amber-400";
const hf = { fontFamily: "var(--font-heading)" };

export default function MobileTopMenu() {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  // the same cached query the bell reads — no second request
  const { unreadTotal } = useNotificationsQuery(user?.id, isAdmin);
  const unread = Math.max(0, unreadTotal || 0);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const goNotifications = () => { close(); navigate("/notifications"); };
  const goSearch = () => { close(); window.setTimeout(() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT)), 0); };

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  const sheet: ReactNode = open ? createPortal(
    <div role="dialog" aria-modal="true" data-state="open" aria-label="Menu" className="fixed inset-0 z-[150]">
      <motion.button type="button" aria-label="Close menu" onClick={close}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-black/45 backdrop-blur-[3px]" />
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 36 }}
        className="absolute inset-x-0 bottom-0 rounded-t-[28px] border-t border-white/10 bg-background/95 px-4 pb-8 pt-3 shadow-2xl backdrop-blur-xl">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted-foreground/40" />
        <button type="button" onClick={goSearch} className="flex h-14 w-full items-center gap-3 rounded-[18px] bg-white/[0.07] px-4 text-left ring-1 ring-white/10">
          <Search className="h-5 w-5 text-primary" />
          <span className="flex-1 text-[15px] text-muted-foreground">Search people, competitions…</span>
        </button>
        <button type="button" onClick={goNotifications} className="mt-3 flex w-full items-center gap-4 rounded-[18px] p-3 text-left hover:bg-white/[0.05]">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[14px] ${BRAND} text-white shadow-lg shadow-primary/30`}><Bell className="h-5 w-5" /></span>
          <span className="flex-1">
            <span className="block text-[15px] font-semibold" style={hf}>Notifications</span>
            <span className="block text-xs text-muted-foreground">{unread > 0 ? `${unread} new` : "You're all caught up"}</span>
          </span>
          {unread > 0 && (
            <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold leading-none text-destructive-foreground">{unread > 99 ? "99+" : unread}</span>
          )}
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>
      </motion.div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Menu, ${unread} unread notifications` : "Menu"}
        aria-expanded={open}
        className="relative grid h-11 w-11 place-items-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
      >
        <Menu className="h-6 w-6" />
        {unread > 0 && <span className={`absolute right-2 top-2 h-2.5 w-2.5 rounded-full ${BRAND} ring-2 ring-background`} />}
      </button>
      {sheet}
    </>
  );
}
