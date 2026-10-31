import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/core/useAuth";
import { useLocation } from "react-router-dom";
import { logActivity } from "@/lib/activityLog";

type ActionCategory = "auth" | "navigation" | "content" | "social" | "competition" | "course" | "admin";

interface LogPayload {
  action_type: string;
  action_category: ActionCategory;
  description?: string;
  metadata?: Record<string, unknown>;
  page_path?: string;
}

/** Hook that auto-logs page views and provides a log function */
export const useActivityLog = () => {
  const { user } = useAuth();
  const location = useLocation();
  const prevPath = useRef<string>("");

  const log = useCallback(
    (payload: Omit<LogPayload, "page_path">) => {
      if (!user) return;
      logActivity(user.id, { ...payload, page_path: window.location.pathname });
    },
    [user]
  );

  // Auto-log page views (navigation)
  useEffect(() => {
    if (!user) return;
    if (location.pathname === prevPath.current) return;
    prevPath.current = location.pathname;

    logActivity(user.id, {
      action_type: "page_view",
      action_category: "navigation",
      description: `Visited ${location.pathname}`,
      page_path: location.pathname,
    });
  }, [user, location.pathname]);

  return { log };
};
