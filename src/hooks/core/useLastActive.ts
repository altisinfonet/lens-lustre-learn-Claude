import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";
import { startVisibilityInterval } from "@/lib/timers/visibilityInterval";

/**
 * Silently updates the user's last_active_at timestamp every 5 minutes.
 * Lightweight — no WebSocket or Realtime channel needed.
 *
 * Also records WHERE the member is signed in from (profiles.last_platform,
 * "app" | "web") — the admin users list shows both. Owner, 2026-08-05:
 * "show last activated time and login from app or website on the same list
 * nicely show". The column only fills from 2026-08-05 onward; earlier logins
 * were never recorded anywhere trustworthy (client_errors.platform only
 * exists for members who hit an error) and are shown as blank, not guessed.
 */
export function useLastActive() {
  const { user } = useAuth();
  const updated = useRef(false);

  useEffect(() => {
    if (!user) return;

    const update = () => {
      supabase
        .from("profiles")
        .update({
          last_active_at: new Date().toISOString(),
          last_platform: isNativeCapacitorApp() ? "app" : "web",
        } as any)
        .eq("id", user.id)
        .then(() => {});
    };

    // Update immediately on mount (once per session)
    if (!updated.current) {
      update();
      updated.current = true;
    }

    /* Then every 5 minutes.
     *
     * P10: stopped while the tab is hidden. A background tab writing
     * `last_active_at` every five minutes is telling the presence system the
     * member is here when they are not — a wrong answer as well as a wasted
     * write.
     *
     * ⚠ THIS WHOLE WRITE IS SCHEDULED FOR DELETION by 2-D2-03 (P1 client
     * half), which replaces `last_active_at` polling with a Realtime Presence
     * channel. It is made P10-compliant here rather than left as the one raw
     * timer in the client, and the unit that removes it will remove this
     * comment with it. */
    return startVisibilityInterval(update, 5 * 60 * 1000);
  }, [user]);
}

/** Format last_active_at into human-readable "Last seen X ago" */
export function formatLastSeen(lastActiveAt: string | null | undefined): string {
  if (!lastActiveAt) return "";
  const diff = Date.now() - new Date(lastActiveAt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "Active now";
  if (mins < 60) return `Last seen ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Last seen ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `Last seen ${days}d ago`;
  return `Last seen ${Math.floor(days / 7)}w ago`;
}

/** Check if the user was active within the last 5 minutes */
export function isActiveNow(lastActiveAt: string | null | undefined): boolean {
  if (!lastActiveAt) return false;
  return Date.now() - new Date(lastActiveAt).getTime() < 5 * 60 * 1000;
}
