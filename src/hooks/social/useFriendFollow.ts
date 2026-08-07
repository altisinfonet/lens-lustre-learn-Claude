import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import {
  useSendFriendRequest,
  useAcceptFriendRequest,
  useRemoveFriendship,
  useToggleFollow,
} from "@/hooks/social/useFriendshipMutations";

type FriendshipStatus = "none" | "pending_sent" | "pending_received" | "accepted";

/**
 * PERF, 2026-08-07 — the "profile opens after 5 minutes" fix.
 *
 * This hook used to run FIVE independent Supabase calls one after another with
 * `await` (admin check → stats → mutual count → friendship → follow). None of
 * them depends on a previous result, so the serialization was pure dead time.
 * Worse, PublicProfile mounts the hook TWICE (the button block and the stat
 * block), and there was no cache — so opening one profile fired **ten**
 * requests as two five-deep chains. At ~2s round-trip on a slow link that is
 * ~20 seconds of nothing.
 *
 * Now the five calls run in a single `Promise.all` inside one React Query.
 * React Query dedupes the two mounts to one in-flight request, and caches the
 * result — so the ten serial requests become one parallel wave of five, shared.
 * ~20s → ~2s, and instant on a revisit within staleTime.
 *
 * The returned shape is unchanged, so FriendFollowActions needs no edits.
 * Mutations invalidate the query key instead of hand-refetching.
 */

interface FriendFollowData {
  friendStatus: FriendshipStatus;
  isFollowing: boolean;
  friendCount: number;
  followerCount: number;
  followingCount: number;
  mutualFriendsCount: number;
  friendshipId: string | null;
  isTargetAdmin: boolean;
}

const EMPTY: FriendFollowData = {
  friendStatus: "none",
  isFollowing: false,
  friendCount: 0,
  followerCount: 0,
  followingCount: 0,
  mutualFriendsCount: 0,
  friendshipId: null,
  isTargetAdmin: false,
};

export const useFriendFollow = (targetUserId: string | undefined) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isSelf = user?.id === targetUserId;

  const sendMutation = useSendFriendRequest();
  const acceptMutation = useAcceptFriendRequest();
  const removeMutation = useRemoveFriendship();
  const followMutation = useToggleFollow();

  const loading =
    sendMutation.isPending ||
    acceptMutation.isPending ||
    removeMutation.isPending ||
    followMutation.isPending;

  const queryKey = ["friend-follow", targetUserId ?? null, user?.id ?? null] as const;

  const { data = EMPTY } = useQuery({
    queryKey,
    enabled: !!targetUserId,
    // Profile relationship data changes rarely; serve it from cache across the
    // two mounts and across a quick back-and-forth, revalidate in the background.
    staleTime: 60_000,
    queryFn: async (): Promise<FriendFollowData> => {
      if (!targetUserId) return EMPTY;

      const viewerRelevant = !!user && !isSelf;

      // ALL of these are independent — fire them together, not in a chain.
      //  - app_has_role: target is admin? (SECURITY DEFINER RPC; a direct
      //    user_roles SELECT is RLS-blocked for non-admin viewers)
      //  - profile_stats: public counts, one stored row maintained by triggers
      //  - the last three only matter to a logged-in, non-self viewer
      const [adminRes, statsRes, mutualRes, friendshipRes, followRes] = await Promise.all([
        supabase.rpc("app_has_role" as any, { _user_id: targetUserId, _role: "admin" }),
        supabase
          .from("profile_stats" as any)
          .select("followers_count, following_count, friends_count")
          .eq("user_id", targetUserId)
          .maybeSingle(),
        viewerRelevant
          ? supabase.rpc("mutual_friends_count" as any, { _user_a: user!.id, _user_b: targetUserId })
          : Promise.resolve({ data: 0 } as { data: number }),
        viewerRelevant
          ? supabase
              .from("friendships")
              .select("id, status, requester_id")
              .or(
                `and(requester_id.eq.${user!.id},addressee_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},addressee_id.eq.${user!.id})`,
              )
              .maybeSingle()
          : Promise.resolve({ data: null } as { data: null }),
        viewerRelevant
          ? supabase
              .from("follows")
              .select("id")
              .eq("follower_id", user!.id)
              .eq("following_id", targetUserId)
              .maybeSingle()
          : Promise.resolve({ data: null } as { data: null }),
      ]);

      const stats = statsRes.data as
        | { followers_count?: number; following_count?: number; friends_count?: number }
        | null;

      const friendship = friendshipRes.data as
        | { id: string; status: string; requester_id: string }
        | null;

      let friendStatus: FriendshipStatus = "none";
      let friendshipId: string | null = null;
      if (friendship) {
        friendshipId = friendship.id;
        if (friendship.status === "accepted") friendStatus = "accepted";
        else if (friendship.requester_id === user?.id) friendStatus = "pending_sent";
        else friendStatus = "pending_received";
      }

      return {
        friendStatus,
        friendshipId,
        isFollowing: !!(followRes.data as { id: string } | null),
        friendCount: stats?.friends_count ?? 0,
        followerCount: stats?.followers_count ?? 0,
        followingCount: stats?.following_count ?? 0,
        mutualFriendsCount: (mutualRes.data as number) ?? 0,
        isTargetAdmin: !!adminRes.data,
      };
    },
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, targetUserId, user?.id]);

  const sendFriendRequest = async () => {
    if (!user || !targetUserId || isSelf || data.isTargetAdmin) return;
    await sendMutation.mutateAsync(targetUserId);
    refresh();
  };

  const acceptFriendRequest = async () => {
    if (!data.friendshipId || !user || !targetUserId) return;
    await acceptMutation.mutateAsync({ friendshipId: data.friendshipId, targetUserId });
    refresh();
  };

  const removeFriend = async () => {
    if (!data.friendshipId) return;
    await removeMutation.mutateAsync(data.friendshipId);
    refresh();
  };

  const toggleFollow = async () => {
    if (!user || !targetUserId || isSelf) return;
    await followMutation.mutateAsync({ targetUserId, isCurrentlyFollowing: data.isFollowing });
    refresh();
  };

  return {
    friendStatus: data.friendStatus,
    isFollowing: data.isFollowing,
    friendCount: data.friendCount,
    followerCount: data.followerCount,
    followingCount: data.followingCount,
    mutualFriendsCount: data.mutualFriendsCount,
    loading,
    isSelf,
    isLoggedIn: !!user,
    isTargetAdmin: data.isTargetAdmin,
    sendFriendRequest,
    acceptFriendRequest,
    removeFriend,
    toggleFollow,
  };
};
