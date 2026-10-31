import { supabase } from "@/integrations/supabase/client";

export const BRAND_NAME = "50mm Retina World";

// Cache admin IDs in memory for the session
let adminIdsCache: Set<string> | null = null;
let cachePromise: Promise<Set<string>> | null = null;

export function invalidateAdminIdsCache() {
  adminIdsCache = null;
  cachePromise = null;
}

/** Pre-seed admin IDs from dashboard-init (avoids independent DB query) */
export function seedAdminIds(roles: Record<string, string[]>) {
  if (adminIdsCache) return;
  const ids = new Set<string>();
  for (const [userId, userRoles] of Object.entries(roles)) {
    if (userRoles.includes("admin")) ids.add(userId);
  }
  adminIdsCache = ids;
}

/**
 * Fetch and cache admin user IDs. Uses a singleton promise to avoid duplicate requests.
 */
export async function getAdminIds(): Promise<Set<string>> {
  if (adminIdsCache) return adminIdsCache;
  if (cachePromise) return cachePromise;

  cachePromise = (async () => {
    // Use SECURITY DEFINER RPC: non-admins cannot SELECT admin rows from user_roles
    // directly (RLS restricts to own rows), which would silently return an empty set
    // and revert the admin's brand name + verified badge for every non-admin viewer.
    const { data } = await supabase.rpc("get_public_role_user_ids" as any, { _role: "admin" });
    const ids = new Set<string>((data as any[] | null || []).map((r: any) => (typeof r === "string" ? r : r.user_id ?? r)));
    adminIdsCache = ids;
    return ids;
  })();

  return cachePromise;
}

/**
 * Returns brand name if the user is an admin, otherwise the original name.
 */
export function resolveName(
  userId: string,
  originalName: string | null,
  adminIds: Set<string>
): string {
  if (adminIds.has(userId)) return BRAND_NAME;
  return originalName || "Photographer";
}

/**
 * Ensures admin users always have a "verified" badge in their badge list.
 */
export function resolveBadges(
  userId: string,
  originalBadges: string[],
  adminIds: Set<string>
): string[] {
  if (adminIds.has(userId)) {
    return originalBadges.includes("verified") ? originalBadges : ["verified", ...originalBadges];
  }
  return originalBadges;
}

/**
 * Check if a single user ID is admin (uses cached set).
 */
export function isAdminUser(userId: string, adminIds: Set<string>): boolean {
  return adminIds.has(userId);
}
