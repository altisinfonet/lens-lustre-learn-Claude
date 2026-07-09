import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";

/**
 * Silently updates the user's last_active_at timestamp every 5 minutes.
 * Lightweight — no WebSocket or Realtime channel needed.
 */
export function useLastActive() {
  const { user } = useAuth();
  const updated = useRef(false);

  useEffect(() => {
    if (!user) return;

    const update = () => {
      supabase
        .from("profiles")
        .update({ last_active_at: new Date().toISOString() } as any)
        .eq("id", user.id)
        .then(() => {});
    };

    // Update immediately on mount (once per session)
    if (!updated.current) {
      update();
      updated.current = true;
    }

    // Then every 5 minutes
    const interval = setInterval(update, 5 * 60 * 1000);
    return () => clearInterval(interval);
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
