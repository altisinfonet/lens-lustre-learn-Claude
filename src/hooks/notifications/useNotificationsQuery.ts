import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { profilesPublic } from "@/lib/profilesPublic";
import { getAdminIds, resolveName } from "@/lib/adminBrand";
import { queryKeys } from "@/lib/queryKeys";
import { useNotificationRealtime } from "@/hooks/feed/useRealtimeFeed";
import { queueCacheUpdate } from "@/lib/batchedCacheUpdate";

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

export interface UserNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  reference_id: string | null;
  actor_id: string | null;
  created_at: string;
}

interface NotificationsData {
  friendRequests: FriendRequest[];
  giftNotifications: GiftNotification[];
  adminNotifications: AdminNotification[];
  userNotifications: UserNotification[];
}

const EMPTY: NotificationsData = {
  friendRequests: [],
  giftNotifications: [],
  adminNotifications: [],
  userNotifications: [],
};

const sortDesc = <T extends { created_at: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

/* ── Query fetcher ── */

async function fetchNotifications(
  userId: string,
  isAdmin: boolean,
): Promise<NotificationsData> {
  const [friendsRes, giftsRes, userNotifsRes] = await Promise.all([
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
    supabase
      .from("user_notifications")
      .select("*")
      .eq("user_id", userId)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(30),
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

  const actorIds = ((userNotifsRes.data || []) as any[])
    .map((n: any) => n.actor_id)
    .filter(Boolean);
  let actorMap = new Map<string, { full_name: string | null; avatar_url: string | null }>();
  if (actorIds.length > 0) {
    const { data: actorProfiles } = await profilesPublic()
      .select("id, full_name, avatar_url")
      .in("id", actorIds);
    actorMap = new Map((actorProfiles || []).map((p) => [p.id, p]));
  }

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
    userNotifications: ((userNotifsRes.data || []) as any[]).map((n: any) => ({
      ...n,
      actor_avatar: n.actor_id ? actorMap.get(n.actor_id)?.avatar_url : null,
    })),
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

  const insertUserNotification = useCallback(
    (notif: UserNotification) => {
      patch((prev) => {
        if (prev.userNotifications.some((n) => n.id === notif.id)) return prev;
        return {
          ...prev,
          userNotifications: sortDesc([...prev.userNotifications, notif]),
        };
      });
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

  const removeUserNotification = useCallback(
    (id: string) => {
      patch((prev) => ({
        ...prev,
        userNotifications: prev.userNotifications.filter((n) => n.id !== id),
      }));
    },
    [patch],
  );

  const clearAll = useCallback(() => {
    patch(() => EMPTY);
  }, [patch]);

  return {
    insertUserNotification,
    insertFriendRequest,
    removeFriendRequest,
    insertGift,
    removeGift,
    insertAdminNotification,
    removeAdminNotification,
    removeUserNotification,
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

  // Realtime handlers — write directly to React Query cache
  const realtimeHandlers = useMemo(
    () => ({
      onUserNotification: (notif: any) => {
        cache.insertUserNotification(notif);
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
    [cache, isAdmin],
  );

  useNotificationRealtime(userId, realtimeHandlers);

  const data = query.data ?? EMPTY;

  return {
    ...data,
    totalCount:
      data.friendRequests.length +
      data.giftNotifications.length +
      data.adminNotifications.length +
      data.userNotifications.length,
    isLoading: query.isLoading,
    cache,
  };
}
