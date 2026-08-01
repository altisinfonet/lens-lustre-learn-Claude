/**
 * Paginated notification HISTORY for the /notifications page.
 *
 * Deliberately separate from useNotificationsQuery, which stays exactly as it
 * is: that hook powers the bell and is an UNREAD inbox (`.eq("is_read", false)`,
 * limit 30) feeding the badge count. This one is the full history the owner
 * asked for — read rows included — and it reads through the
 * get_my_notifications_grouped() RPC so the grouping rule lives in one place
 * for web and app alike.
 *
 * Keyset pagination: each page passes the previous page's oldest latest_at as
 * `_before`. No OFFSET, so a notification arriving mid-scroll cannot shift a
 * page boundary and duplicate or skip a row.
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import type { NotificationGroup } from "@/lib/notificationText";

export const PAGE_SIZE = 25;

export function useNotificationHistory() {
  const { user } = useAuth();

  return useInfiniteQuery({
    queryKey: ["notification-history", user?.id ?? ""],
    enabled: !!user?.id,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("get_my_notifications_grouped" as any, {
        _limit: PAGE_SIZE,
        _before: pageParam,
      });
      if (error) throw error;
      return (data ?? []) as NotificationGroup[];
    },
    // A short page means the end; otherwise continue from the oldest row we saw.
    getNextPageParam: (last: NotificationGroup[]) =>
      last.length < PAGE_SIZE ? undefined : last[last.length - 1]?.latest_at ?? undefined,
    staleTime: 30_000,
  });
}

/**
 * "Am I already following these people?" for the whole visible list in ONE
 * query, so a Follow back button never renders for someone already followed.
 *
 * Absence of information must not enable the action (PROJECT_MASTER_RECORD §0):
 * while this is loading, `ready` is false and the caller hides the button
 * rather than guessing.
 */
export function useFollowingSet(actorIds: string[]) {
  const { user } = useAuth();
  const ids = Array.from(new Set(actorIds.filter(Boolean))).sort();

  const query = useQuery({
    queryKey: ["following-set", user?.id ?? "", ids.join(",")],
    enabled: !!user?.id && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", user!.id)
        .in("following_id", ids);
      if (error) throw error;
      return new Set((data ?? []).map((r: { following_id: string }) => r.following_id));
    },
    staleTime: 30_000,
  });

  return {
    following: query.data ?? new Set<string>(),
    ready: ids.length === 0 ? true : query.isSuccess,
  };
}

/**
 * Mark a group's notifications read. RLS already restricts UPDATE to the
 * owner's own rows ("Users can update own notifications"), so this needs no
 * edge function.
 */
export async function markGroupRead(notificationIds: string[]): Promise<void> {
  if (!notificationIds.length) return;
  const { error } = await supabase
    .from("user_notifications")
    .update({ is_read: true })
    .in("id", notificationIds);
  if (error) throw error;
}
