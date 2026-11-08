import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Bell, ChevronRight, Search } from "lucide-react";
import { motion } from "framer-motion";

/**
 * STYLE 2 · BOTTOM DOCK — the sheet ☰ opens (Owner-approved 8 Nov 2026,
 * _control/out/OWNER/samples-2026-11-08/SAMPLE-3-menu-styles.png, Style 2).
 * Sizes, colours and spacing are that sample's — change them only with a new yes.
 *
 * Loaded only when ☰ is tapped (P13 entry-bundle ceiling); MobileTopMenu is the
 * light trigger that stays in the first download.
 *
 * A dialog (role + data-state="open"), so Android Back and Escape close it
 * (useAndroidBackButton), as does a tap on the blurred backdrop.
 */
const BRAND = "bg-gradient-to-br from-primary to-amber-400";
const hf = { fontFamily: "var(--font-heading)" };

export default function MobileMenuSheet({ unread, onClose, onNotifications, onSearch }: {
  unread: number;
  onClose: () => void;
  onNotifications: () => void;
  onSearch: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return createPortal(
    <div role="dialog" aria-modal="true" data-state="open" aria-label="Menu" className="fixed inset-0 z-[150]">
      <motion.button type="button" aria-label="Close menu" onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-black/45 backdrop-blur-[3px]" />
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} transition={{ type: "spring", stiffness: 380, damping: 36 }}
        className="absolute inset-x-0 bottom-0 rounded-t-[28px] border-t border-white/10 bg-background/95 px-4 pb-8 pt-3 shadow-2xl backdrop-blur-xl">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted-foreground/40" />
        <button type="button" onClick={onSearch} className="flex h-14 w-full items-center gap-3 rounded-[18px] bg-white/[0.07] px-4 text-left ring-1 ring-white/10">
          <Search className="h-5 w-5 text-primary" />
          <span className="flex-1 text-[15px] text-muted-foreground">Search people, competitions…</span>
        </button>
        <button type="button" onClick={onNotifications} className="mt-3 flex w-full items-center gap-4 rounded-[18px] p-3 text-left hover:bg-white/[0.05]">
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
  );
}
