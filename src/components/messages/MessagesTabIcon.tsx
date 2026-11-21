import { MessageCircle } from "lucide-react";
import { useUnreadCounts } from "@/hooks/messages/useUnreadCounts";

/**
 * The Chat icon of the app's bottom bar (where "Wall" was), with its unread count.
 * Loaded lazily (see MobileBottomNav) so the unread poll code stays out of the first download.
 */
export default function MessagesTabIcon({ active }: { active: boolean }) {
  const { inbox, requests } = useUnreadCounts();
  const total = inbox + requests;
  return (
    <span className="relative inline-flex" data-testid="footer-chat-icon">
      <MessageCircle className={`h-6 w-6 ${active ? "stroke-[2.25]" : "stroke-[1.5]"}`} />
      {total > 0 && (
        <span aria-label={`${total} unread`} className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground">
          {total > 99 ? "99+" : total}
        </span>
      )}
    </span>
  );
}
