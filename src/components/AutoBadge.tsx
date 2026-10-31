import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useProfileMap } from "@/hooks/profile/useProfileMap";
import UserBadgeInline from "@/components/UserBadgeInline";
import { getAdminIds, resolveBadges } from "@/lib/adminBrand";
import { queryKeys } from "@/lib/queryKeys";

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
  /** See UserBadgeInline: "verified" = blue tick only, "pills" = award pills only. */
  only?: "all" | "verified" | "pills";
}

/** Stable empty set — a new Set() per render would re-run the memo every time. */
const NO_ADMINS: Set<string> = new Set();

/**
 * Drop-in component: place next to any username and it automatically
 * fetches + displays verified badges via the unified profileMap cache.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ IT RESOLVES THE BRAND TICK, LIKE EVERY DATA PATH DOES. (Fixed 2026-08-28.)
 *
 * Owner: *"Rule was Blue badge will show with name everywhere, where the name
 * is showing... Now Badge is not coming in comment, profile section but some
 * section is showing"*.
 *
 * The admin account has NO ROW AT ALL in public.user_badges — verified in
 * staging, zero rows. Its blue tick has always been INJECTED by
 * `resolveBadges()`, which adds "verified" for any id in the admin set. Every
 * data path does that: the feed query, the profile query, competition detail,
 * the comment adapters. This component — the render-time fallback used wherever
 * a caller has no badges to hand — did not. It read the raw user_badges rows
 * and found none.
 *
 * So the tick appeared exactly where a caller passed pre-resolved badges (the
 * post header, since 2026-08-14) and nowhere else: not in a comment, not in the
 * user menu, not on the profile sheet, not in the sidebars. "Some section is
 * showing" was the whole diagnosis — one rule, applied in nine places and
 * missing from the tenth, which happened to be the one that serves the rest.
 *
 * Applying it here means the owner's standing rule — name and badge together,
 * everywhere a name shows — holds by construction rather than by every future
 * call site remembering to pass `badges`.
 *
 * Carrying the badges is STILL better where the caller already has them: it
 * costs no lookup and the tick cannot arrive a frame late. UserIdentityBlock
 * prefers them and only falls back to this.
 */
const AutoBadge = ({ userId, size = "compact", only = "all" }: AutoBadgeProps) => {
  // Stabilise the array passed to useProfileMap — must be the same reference
  // when userId hasn't changed, otherwise the hook creates a new query key.
  const ids = useMemo(() => (userId ? [userId] : []), [userId]);
  const { profileMap } = useProfileMap(ids);

  // One shared key for the whole app, and `getAdminIds` is itself memoised for
  // the session — so this is a cache read after the first caller anywhere.
  const { data: adminIds } = useQuery({
    queryKey: queryKeys.adminIds(),
    queryFn: getAdminIds,
    staleTime: 5 * 60_000,
  });

  const entry = userId ? profileMap[userId] : undefined;
  const badges = useMemo(
    () => (userId ? resolveBadges(userId, entry?.badges || [], adminIds ?? NO_ADMINS) : []),
    [userId, entry?.badges, adminIds],
  );

  if (!userId) return null;
  if (badges.length === 0) return null;
  return <UserBadgeInline badges={badges} size={size} only={only} />;
};

export default React.memo(AutoBadge);
