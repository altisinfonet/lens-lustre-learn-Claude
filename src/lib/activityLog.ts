import { supabase } from "@/integrations/supabase/client";

type ActionCategory = "auth" | "navigation" | "content" | "social" | "competition" | "course" | "admin";

interface LogPayload {
  action_type: string;
  action_category: ActionCategory;
  description?: string;
  metadata?: Record<string, unknown>;
  page_path?: string;
}

/** Fire-and-forget activity logger */
export const logActivity = async (userId: string, payload: LogPayload) => {
  try {
    await (supabase.from("activity_logs" as any).insert({
      user_id: userId,
      action_type: payload.action_type,
      action_category: payload.action_category,
      description: payload.description || null,
      metadata: payload.metadata || {},
      page_path: payload.page_path || window.location.pathname,
      user_agent: navigator.userAgent,
    } as any) as any);
  } catch {
    // Silent fail – logging should never break UX
  }
};

/**
 * ONE ROW PER REAL SIGN-IN, NOT ONE PER `SIGNED_IN` EVENT.
 *
 * MEASURED ON PRODUCTION, 2026-08-15: 5,702 `login` rows for 90 members over 37
 * days. Grouped into bursts more than 30 minutes apart, that is **685 real
 * sign-ins with 8.3 rows written for each**, and one sign-in that wrote **233
 * rows**. The audit trail was unusable — a real sign-in could not be told from
 * noise — which is precisely why it could not be used to investigate the
 * owner's random-sign-out reports the same day.
 *
 * THE CAUSE: Supabase's `SIGNED_IN` event fires far more often than a person
 * signs in — on tab focus, on resume, on token refresh, on every remount of the
 * provider. The old code wrote a row every single time.
 *
 * TWO GUARDS, and they do different jobs:
 *
 *  1. `sign_in_at` (below) is the IDENTITY of a sign-in — `last_sign_in_at`
 *     from the auth user, which changes only when somebody actually
 *     authenticates. A unique index in the database
 *     (`activity_logs_one_row_per_sign_in`, migration 20260815124734) makes a
 *     second row for the same sign-in **unrepresentable**. That is the
 *     guarantee, and it holds for every client, every version, every retry.
 *
 *  2. The in-memory check in the caller stops the request being SENT at all.
 *     The index would already reject the row, but 233 rejected requests still
 *     cost the member 233 round-trips of mobile data. The index protects the
 *     data; the caller protects the member.
 *
 * A duplicate that does slip through fails with a unique violation, which
 * `logActivity` already swallows — the member never sees anything.
 */
export const logAuthEvent = (
  userId: string,
  event: string,
  /** `user.last_sign_in_at`. Omitted for events that are not sign-ins. */
  signInAt?: string | null,
) => {
  logActivity(userId, {
    action_type: event,
    action_category: "auth",
    description: `Auth event: ${event}`,
    // Only present for sign-ins: the partial index keys on this, and a row
    // WITHOUT it is deliberately not deduped (that is what keeps the 5,702
    // historical rows valid and untouched).
    metadata: signInAt ? { sign_in_at: signInAt } : {},
  });
};
