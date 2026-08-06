import { toast } from "@/hooks/core/use-toast";

import { logger } from "@/lib/logger";

const FILE = "src/lib/safeAdminExecute.ts";

/**
 * Safe execution wrapper for admin actions.
 * Prevents silent failures and ensures proper error reporting.
 * 
 * Usage:
 *   await safeAdminExecute("Credit wallet", async () => { ... });
 */
export async function safeAdminExecute<T>(
  actionLabel: string,
  fn: () => Promise<T>,
  options?: {
    successMessage?: string;
    onSuccess?: (result: T) => void;
    onError?: (error: unknown) => void;
    silent?: boolean; // skip success toast
  }
): Promise<T | null> {
  try {
    const result = await fn();
    if (!options?.silent) {
      toast({ title: options?.successMessage ?? `${actionLabel} completed` });
    }
    options?.onSuccess?.(result);
    return result;
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Unknown error";

    logger.error({
      code: "ADMIN-8106",
      event: "ADMIN_ACTION_THREW",
      fn: "safeAdminExecute",
      file: FILE,
      message: "An admin action threw part-way through.",
      reason: message,
      expected: `${actionLabel} to complete`,
      actual: "It threw",
      nextStep:
        "The action may be HALF-APPLIED. Confirm the current stored state before retrying — a blind retry can double-apply whatever did succeed.",
      detail: { action: actionLabel },
    });

    toast({
      title: `${actionLabel} failed`,
      description: message,
      variant: "destructive",
    });

    options?.onError?.(err);
    return null;
  }
}

/**
 * Validates that a Supabase response didn't error.
 * Throws if error is present so safeAdminExecute can catch it.
 */
export function assertSupabaseResult<T extends { error: { message: string } | null }>(
  result: T,
  context?: string
): asserts result is T & { error: null } {
  if (result.error) {
    throw new Error(
      context
        ? `${context}: ${result.error.message}`
        : result.error.message
    );
  }
}
