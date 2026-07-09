/**
 * Centralized admin action & error logger.
 * All admin operations should use this instead of raw supabase inserts.
 */
import { supabase } from "@/integrations/supabase/client";

export type LogSeverity = "info" | "warn" | "error" | "critical";

interface AdminLogEntry {
  action: string;
  category: "admin" | "finance" | "moderation" | "content" | "system" | "auth";
  severity?: LogSeverity;
  metadata?: Record<string, unknown>;
  targetTable?: string;
  targetRowId?: string;
}

/**
 * Log an admin action to db_audit_logs with structured metadata.
 * Fire-and-forget — never blocks UI.
 */
export async function logAdminAction(
  adminId: string,
  entry: AdminLogEntry
): Promise<void> {
  try {
    await supabase.from("db_audit_logs").insert({
      table_name: entry.targetTable || "admin_actions",
      operation: entry.action,
      row_id: entry.targetRowId || null,
      new_data: {
        category: entry.category,
        severity: entry.severity || "info",
        ...entry.metadata,
        timestamp: new Date().toISOString(),
      },
      changed_by: adminId,
    });
  } catch {
    // Never break admin UX for logging failures
    console.error("[AdminLogger] Failed to log:", entry.action);
  }
}

/**
 * Log a client-side error with context for observability.
 */
export async function logClientError(
  userId: string | undefined,
  error: unknown,
  context: string
): Promise<void> {
  try {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack?.slice(0, 500) : undefined;

    await supabase.from("activity_logs" as any).insert({
      user_id: userId || "00000000-0000-0000-0000-000000000000",
      action_type: "client_error",
      action_category: "admin",
      description: `[${context}] ${message}`,
      metadata: { stack, context, url: window.location.pathname },
      page_path: window.location.pathname,
      user_agent: navigator.userAgent,
    } as any);
  } catch {
    // Silent — logging should never cascade
  }
}

/**
 * Wrap an async admin operation with automatic audit logging.
 */
export async function withAdminAudit<T>(
  adminId: string,
  entry: Omit<AdminLogEntry, "severity">,
  fn: () => Promise<T>
): Promise<T> {
  try {
    const result = await fn();
    await logAdminAction(adminId, { ...entry, severity: "info" });
    return result;
  } catch (err) {
    await logAdminAction(adminId, {
      ...entry,
      severity: "error",
      metadata: {
        ...entry.metadata,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}
