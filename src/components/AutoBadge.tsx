import React, { useMemo } from "react";
import { useProfileMap } from "@/hooks/profile/useProfileMap";
import UserBadgeInline from "@/components/UserBadgeInline";

/**
 * Invalidate the unified profile-map cache for a user (or all users).
 * Used by AdminUsers after badge CRUD operations.
 */
export const invalidateBadgeCache = (userId?: string) => {};

/** @deprecated No longer needed — badges come from useProfileMap cache */
export const seedBadgeCache = (_userId: string, _badges: string[]) => {};

interface AutoBadgeProps {
  userId: string | undefined | null;
  size?: "compact" | "full";
}

/**
 * Drop-in component: place next to any username and it automatically
 * fetches + displays verified badges via the unified profileMap cache.
 */
const AutoBadge = ({ userId, size = "compact" }: AutoBadgeProps) => {
  // Stabilise the array passed to useProfileMap — must be the same reference
  // when userId hasn't changed, otherwise the hook creates a new query key.
  const ids = useMemo(() => (userId ? [userId] : []), [userId]);
  const { profileMap } = useProfileMap(ids);

  if (!userId) return null;

  const entry = profileMap[userId];
  const badges = entry?.badges || [];

  if (badges.length === 0) return null;
  return <UserBadgeInline badges={badges} size={size} />;
};

export default React.memo(AutoBadge);
