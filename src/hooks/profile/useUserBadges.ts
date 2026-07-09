/**
 * @deprecated — Use useProfileMap instead. Badges are included in the unified profile cache.
 * These hooks are kept temporarily for backward compatibility but will be removed.
 */
import { useProfileMap } from "@/hooks/profile/useProfileMap";

/** @deprecated Use useProfileMap([...userIds]) instead */
export const useUserBadgesBatch = (userIds: string[]) => {
  const { profileMap } = useProfileMap(userIds);
  const badgeMap = new Map<string, string[]>();
  for (const uid of userIds) {
    badgeMap.set(uid, profileMap[uid]?.badges || []);
  }
  return badgeMap;
};

/** @deprecated Use useProfileMap([userId]) instead */
export const useUserBadges = (userId: string | undefined) => {
  const { profileMap } = useProfileMap(userId ? [userId] : []);
  return userId ? profileMap[userId]?.badges || [] : [];
};
