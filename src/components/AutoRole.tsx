import React, { useMemo } from "react";
import { useProfileMap } from "@/hooks/profile/useProfileMap";
import UserRoleInline from "@/components/UserRoleInline";
import { invalidateProfileMap } from "@/lib/profileMapCache";

/**
 * Invalidate the unified profile-map cache for a user (or all users).
 * Backwards-compatible shim — AutoRole now reads roles from useProfileMap,
 * so cache invalidation is delegated to the unified profile-map cache.
 *
 * Consumers: src/lib/liveAdminSync.ts, src/components/admin/AdminUsers.tsx,
 * src/components/admin/AdminRoleApplications.tsx
 */
export const invalidateRoleCache = (userId?: string) => {
  invalidateProfileMap(userId);
};

/** @deprecated No longer needed — roles come from useProfileMap cache */
export const seedRoleCache = (_userId: string, _roles: string[]) => {};

interface AutoRoleProps {
  userId: string | undefined | null;
  size?: "compact" | "full";
}

/**
 * Drop-in component: place next to any username and it automatically
 * fetches + displays role pills via the unified profileMap cache.
 */
const AutoRole = ({ userId, size = "compact" }: AutoRoleProps) => {
  // Stabilise the array passed to useProfileMap so the query key reference
  // is stable across renders when userId hasn't changed.
  const ids = useMemo(() => (userId ? [userId] : []), [userId]);
  const { profileMap } = useProfileMap(ids);

  if (!userId) return null;

  const roles = profileMap[userId]?.roles || [];
  if (roles.length === 0) return null;
  return <UserRoleInline roles={roles} size={size} />;
};

export default React.memo(AutoRole);
