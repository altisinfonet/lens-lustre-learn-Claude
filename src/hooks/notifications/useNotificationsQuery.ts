/**
 * The bell's data: an UNREAD inbox, grouped the same way the history page
 * groups, with a badge count that comes from the server.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED 2026-08-02 (Stage 3c) AND WHY
 *
 * This hook used to read raw rows — `.eq("is_read", false).limit(30)` — and the
 * badge counted the LENGTH OF THAT ARRAY. Two consequences, both measured on
 * production before this was touched:
 *
 *   1. 40 reactions in a day were 40 lines in the panel and ONE line on
 *      /notifications. Same events, two different shapes.
 *   2. The badge stopped counting at 30. 4 members were over it; the worst had
 *      **111 unread and a badge reading 30**. Silently wrong is the worst kind.
 *
 * Both are gone: the rows come from `get_my_unread_notifications_grouped()`,
 * which applies the same `notif_group_key()` the history page uses, and the
 * badge uses that function's `total_unread` — counted over every unread row,
 * not over the page of groups that came back.
 *
 * The actor profile lookup that used to live here is gone too: the RPC returns
 * names, handles and avatars already, so the bell now costs one query instead
 * of two.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { profilesPublic } from "@/lib/profilesPublic";
import { getAdminIds, resolveName } from "@/lib/adminBrand";
import { queryKeys } from "@/lib/queryKeys";
import { useNotificationRealtime } from "@/hooks/feed/useRealtimeFeed";
import { queueCacheUpdate } from "@/lib/batchedCacheUpdate";
import type { NotificationGroup } from "@/lib/notificationText";

/* ── Types ── */

export interface FriendRequest {
  id: string;
  requester_id: string;
  created_at: string;
  requester_name: string | null;
  requester_avatar: string | null;
}

export interface GiftNotification {
  id: string;
  amount: number;
  reason: string;
  created_at: string;
  expires_at: string | null;
}

export interface AdminNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  reference_id: string | null;
  created_at: string;
}

/**
 * One unread group, exactly the shape /notifications receives, plus the true
 * unread total. Sharing the type is deliberate: a shape that differs by one
 * field between two surfaces is a shape somebody will get wrong.
 */
export interface UserNotificationGroup extends NotificationGroup {
  /**
   * Every unread row this member has, NOT the number of groups returned and
   * not the number of events inside them. This is the badge.
   */
  total_unread: number;
}

interface NotificationsData {
  friendRequests: FriendRequest[];
  giftNotifications: GiftNotification[];
  adminNotifications: AdminNotification[];
  userNotifications: UserNotificationGroup[];
  /** Server truth. Survives the group list being capped. */
  unreadTotal: number;
}

const EMPTY: NotificationsData = {
  friendRequests: [],
  giftNotifications: [],
  adminNotifications: [],
  userNotifications: [],
  unreadTotal: 0,
};

/**
 * How many groups the panel asks for. The BADGE is not limited by this — that
 * is the whole reason the RPC returns total_unread separately. A member with
 * 83 unread groups sees the newest 20 here and all of them under "See All".
 */
const PANEL_GROUP_LIMIT = 20;

/**
 * Types the bell must NOT take from the notifications table, because it already
 * renders them from somewhere else.
 *
 * A friend request produces a pending `friendships` row AND a `friend_request`
 * notification. The bell fetches both, so until 2026-08-02 every pending request
 * was **counted twice in the badge and drawn twice in the panel** — once with
 * Accept/Decline, once as a line that did nothing. Measured on production: every
 * member with 3 pending requests had exactly 3 unread friend_request rows.
 *
 * The friendships row wins because it is the one that can be acted on. The
 * notification still exists and still appears on /notifications, which is a
 * history and should show it.
 *
 * This is passed to the RPC rather than filtered here on purpose: the badge is
 * counted server-side, so filtering client-side would leave the number wrong —
 * exactly the fault Stage 3c was about.
 */
const BELL_EXCLUDED_TYPES = ["friend_request"];

/**
 * The unread total, taken from the rows the RPC returned.
 *
 * Every row carries the same figure because a set-returning function has
 * nowhere else to put it. No rows means nothing unread, so 0 is right.
 *
 * Pulled out as a named function so it can be tested: this one line is what
 * used to be `.length` of a capped array.
 */
export function unreadTotalOf(groups: { total_unread?: number | null }[]): number {
  return groups[0]?.total_unread ?? 0;
}

/**
 * The number on the bell.
 *
 * The user-notification part comes from `unreadTotal` — the server's count of
 * every unread row — and NOT from `userNotifications.length`, which is a page
 * of at most 20 groups. That substitution is the whole of the badge fix; if it
 * is ever reverted, a member with 111 unread sees 20 again.
 */
export function badgeCountOf(d: {
  friendRequests: unknown[];
  giftNotifications: unknown[];
  adminNotifications: unknown[];
  unreadTotal: number;
}): number {
  return (
    d.friendRequests.length +
    d.giftNotifications.length +
    d.adminNotifications.length +
    d.unreadTotal
  );
}

const sortDesc = <T extends { created_at: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

/* ── Query fetcher ── */

async function fetchNotifications(
  userId: string,
  isAdmin: boolean,
): Promise<NotificationsData> {
  const [friendsRes, giftsRes, groupsRes] = await Promise.all([
    supabase
      .from("friendships")
      .select("id, requester_id, created_at")
      .eq("addressee_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("gift_announcements")
      .select("id, amount, reason, created_at, expires_at")
      .eq("user_id", userId)
      .eq("is_read", false)
      .eq("is_expired", false)
      .order("created_at", { ascending: false })
      .limit(10),
    // Grouped by the database, by the same rule /notifications uses. The old
    // call here was a raw row read capped at 30, which is what made the badge
    // stop counting at 30.
    supabase.rpc("get_my_unread_notifications_grouped" as any, {
      _limit: PANEL_GROUP_LIMIT,
      _exclude_types: BELL_EXCLUDED_TYPES,
    }),
  ]);

  let adminNotifications: AdminNotification[] = [];
  if (isAdmin) {
    const { data: adminData } = await supabase
      .from("admin_notifications")
      .select("*")
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(10);
    adminNotifications = (adminData as AdminNotification[]) || [];
  }

  const requesterIds = (friendsRes.data || []).map((f) => f.requester_id);
  let profileMap = new Map<string, { full_name: string | null; avatar_url: string | null }>();
  const adminIds = await getAdminIds();
  if (requesterIds.length > 0) {
    const { data: profiles } = await profilesPublic()
      .select("id, full_name, avatar_url")
      .in("id", requesterIds);
    profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  }

  // No actor lookup here any more. The RPC returns actor names, handles and
  // avatars with the group, so the second round trip this used to make is gone.
  const groups = (groupsRes.data ?? []) as UserNotificationGroup[];

  return {
    friendRequests: (friendsRes.data || []).map((f) => ({
      ...f,
      requester_name: resolveName(
        f.requester_id,
        profileMap.get(f.requester_id)?.full_name ?? null,
        adminIds,
      ),
      requester_avatar: profileMap.get(f.requester_id)?.avatar_url || null,
    })),
    giftNotifications: giftsRes.data || [],
    adminNotifications,
    userNotifications: groups,
    unreadTotal: unreadTotalOf(groups),
  };
}

/* ── Cache updaters ── */

function useNotifCacheUpdaters(userId: string | undefined) {
  const queryClient = useQueryClient();
  const key = queryKeys.notifications(userId ?? "");

  /** Batched patch — queues updates within a 150ms window. */
  const patch = useCallback(
    (updater: (prev: NotificationsData) => NotificationsData) => {
      queueCacheUpdate<NotificationsData>(queryClient, key, (old) =>
        updater(old ?? EMPTY),
      );
    },
    [queryClient, key],
  );

  /**
   * A notification just arrived over realtime.
   *
   * It cannot simply be spliced into the list any more: the list holds GROUPS,
   * and only the database knows whether this event joins an existing group or
   * starts a new one. So the badge moves immediately — that is what the member
   * sees, and what the arrival sound keys off — and the grouped list is
   * refetched a moment later by the caller. Guessing the grouping client-side
   * would put a number on screen that the next refetch contradicts.
   */
  const bumpUnread = useCallback(
    (by = 1) => {
      patch((prev) => ({ ...prev, unreadTotal: Math.max(0, prev.unreadTotal + by) }));
    },
    [patch],
  );

  const insertFriendRequest = useCallback(
    (fr: FriendRequest) => {
      patch((prev) => {
        if (prev.friendRequests.some((f) => f.id === fr.id)) return prev;
        return {
          ...prev,
          friendRequests: sortDesc([...prev.friendRequests, fr]),
        };
      });
    },
    [patch],
  );

  const removeFriendRequest = useCallback(
    (id: string) => {
      patch((prev) => ({
        ...prev,
        friendRequests: prev.friendRequests.filter((f) => f.id !== id),
      }));
    },
    [patch],
  );

  const insertGift = useCallback(
    (gift: GiftNotification) => {
      patch((prev) => {
        if (prev.giftNotifications.some((g) => g.id === gift.id)) return prev;
        return {
          ...prev,
          giftNotifications: sortDesc([...prev.giftNotifications, gift]),
        };
      });
    },
    [patch],
  );

  const removeGift = useCallback(
    (id: string) => {
      patch((prev) => ({
        ...prev,
        giftNotifications: prev.giftNotifications.filter((g) => g.id !== id),
      }));
    },
    [patch],
  );

  const insertAdminNotification = useCallback(
    (notif: AdminNotification) => {
      patch((prev) => {
        if (prev.adminNotifications.some((n) => n.id === notif.id)) return prev;
        return {
          ...prev,
          adminNotifications: sortDesc([...prev.adminNotifications, notif]),
        };
      });
    },
    [patch],
  );

  const removeAdminNotification = useCallback(
    (id: string) => {
      patch((prev) => ({
        ...prev,
        adminNotifications: prev.adminNotifications.filter((n) => n.id !== id),
      }));
    },
    [patch],
  );

  /**
   * Dismissing a line in the panel dismisses the whole group behind it — the
   * member is told how many events that is ("… and 31 others"), so removing
   * one row of it and leaving 30 behind would be the surprising behaviour.
   * The badge drops by the group's real event count, not by one.
   */
  const removeUserGroup = useCallback(
    (groupKey: string) => {
      patch((prev) => {
        const gone = prev.userNotifications.find((g) => g.group_key === groupKey);
        if (!gone) return prev;
        return {
          ...prev,
          userNotifications: prev.userNotifications.filter((g) => g.group_key !== groupKey),
          unreadTotal: Math.max(0, prev.unreadTotal - (gone.event_count ?? 1)),
        };
      });
    },
    [patch],
  );

  const clearAll = useCallback(() => {
    patch(() => EMPTY);
  }, [patch]);

  return {
    bumpUnread,
    insertFriendRequest,
    removeFriendRequest,
    insertGift,
    removeGift,
    insertAdminNotification,
    removeAdminNotification,
    removeUserGroup,
    clearAll,
    patch,
  };
}

/* ── Main hook ── */

export function useNotificationsQuery(
  userId: string | undefined,
  isAdmin: boolean,
) {
  const query = useQuery<NotificationsData>({
    queryKey: queryKeys.notifications(userId ?? ""),
    queryFn: () => fetchNotifications(userId!, isAdmin),
    enabled: !!userId,
    refetchInterval: 60_000,
  });

  const cache = useNotifCacheUpdaters(userId);
  const queryClient = useQueryClient();

  /**
   * Refetch the grouped list, at most once per second.
   *
   * Grouping is the database's answer, so a new event means asking again. A
   * busy photo can draw dozens of reactions inside a few seconds, and one
   * refetch per reaction would be pointless traffic — the previous code had a
   * 150ms batching window on its cache writes for exactly this reason.
   */
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRegroup = useCallback(() => {
    if (refetchTimer.current) return;
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications(userId ?? "") });
    }, 1000);
  }, [queryClient, userId]);

  useEffect(
    () => () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    },
    [],
  );

  // Realtime handlers — write directly to React Query cache
  const realtimeHandlers = useMemo(
    () => ({
      onUserNotification: (_notif: any) => {
        // Badge first (instant, and it is what the arrival sound watches),
        // regrouped list a beat later.
        cache.bumpUnread(1);
        scheduleRegroup();
      },
      onFriendRequest: async (friendship: any) => {
        if (friendship.status !== "pending") return;
        const { data: profile } = await profilesPublic()
          .select("id, full_name, avatar_url")
          .eq("id", friendship.requester_id)
          .single();
        const adminIds = await getAdminIds();
        cache.insertFriendRequest({
          id: friendship.id,
          requester_id: friendship.requester_id,
          created_at: friendship.created_at,
          requester_name: resolveName(
            friendship.requester_id,
            profile?.full_name ?? null,
            adminIds,
          ),
          requester_avatar: profile?.avatar_url || null,
        });
      },
      onFriendshipUpdate: (friendship: any) => {
        cache.removeFriendRequest(friendship.id);
      },
      onGift: (gift: any) => {
        cache.insertGift({
          id: gift.id,
          amount: gift.amount,
          reason: gift.reason,
          created_at: gift.created_at,
          expires_at: gift.expires_at,
        });
      },
      onAdminNotification: isAdmin
        ? (notif: any) => {
            cache.insertAdminNotification(notif);
          }
        : undefined,
    }),
    [cache, isAdmin, scheduleRegroup],
  );

  useNotificationRealtime(userId, realtimeHandlers);

  const data = query.data ?? EMPTY;

  return {
    ...data,
    totalCount: badgeCountOf(data),
    isLoading: query.isLoading,
    cache,
  };
}
