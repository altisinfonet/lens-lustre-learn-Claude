import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import {
  useSendFriendRequest,
  useAcceptFriendRequest,
  useRemoveFriendship,
  useToggleFollow,
} from "@/hooks/social/useFriendshipMutations";

type FriendshipStatus = "none" | "pending_sent" | "pending_received" | "accepted";

export const useFriendFollow = (targetUserId: string | undefined) => {
  const { user } = useAuth();
  const [friendStatus, setFriendStatus] = useState<FriendshipStatus>("none");
  const [isFollowing, setIsFollowing] = useState(false);
  const [friendCount, setFriendCount] = useState(0);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [mutualFriendsCount, setMutualFriendsCount] = useState(0);
  const [friendshipId, setFriendshipId] = useState<string | null>(null);
  const [isTargetAdmin, setIsTargetAdmin] = useState(false);

  const isSelf = user?.id === targetUserId;

  const sendMutation = useSendFriendRequest();
  const acceptMutation = useAcceptFriendRequest();
  const removeMutation = useRemoveFriendship();
  const followMutation = useToggleFollow();

  const loading = sendMutation.isPending || acceptMutation.isPending || removeMutation.isPending || followMutation.isPending;

  const fetchData = useCallback(async () => {
    if (!targetUserId) return;

    // Check if target user is admin (block friend requests).
    // Must use SECURITY DEFINER RPC â direct user_roles SELECT is blocked by RLS
    // for non-admin viewers (they can only see their own role row).
    const { data: targetIsAdmin } = await supabase.rpc("app_has_role" as any, {
      _user_id: targetUserId,
      _role: "admin",
    });
    setIsTargetAdmin(!!targetIsAdmin);

    // Fetch public counts
    const [friendCountRes, followerRes, followingRes] = await Promise.all([
      supabase.rpc("friend_count", { _user_id: targetUserId }),
      supabase.from("follows").select("id", { count: "exact", head: true }).eq("following_id", targetUserId),
      supabase.from("follows").select("id", { count: "exact", head: true }).eq("follower_id", targetUserId),
    ]);

    setFriendCount((friendCountRes.data as number) ?? 0);
    setFollowerCount(followerRes.count ?? 0);
    setFollowingCount(followingRes.count ?? 0);

    if (!user || isSelf) return;

    // Mutual friends count
    const { data: mutualCount } = await supabase.rpc("mutual_friends_count" as any, {
      _user_a: user.id,
      _user_b: targetUserId,
    });
    setMutualFriendsCount((mutualCount as number) ?? 0);

    // Check friendship status
    const { data: friendship } = await supabase
      .from("friendships")
      .select("id, status, requester_id")
      .or(`and(requester_id.eq.${user.id},addressee_id.eq.${targetUserId}),and(requester_id.eq.${targetUserId},addressee_id.eq.${user.id})`)
      .maybeSingle();

    if (friendship) {
      setFriendshipId(friendship.id);
      if (friendship.status === "accepted") setFriendStatus("accepted");
      else if (friendship.requester_id === user.id) setFriendStatus("pending_sent");
      else setFriendStatus("pending_received");
    } else {
      setFriendStatus("none");
      setFriendshipId(null);
    }

    // Check follow status
    const { data: follow } = await supabase
      .from("follows")
      .select("id")
      .eq("follower_id", user.id)
      .eq("following_id", targetUserId)
      .maybeSingle();

    setIsFollowing(!!follow);
  }, [targetUserId, user, isSelf]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const sendFriendRequest = async () => {
    if (!user || !targetUserId || isSelf || isTargetAdmin) return;
    await sendMutation.mutateAsync(targetUserId);
    await fetchData();
  };

  const acceptFriendRequest = async () => {
    if (!friendshipId || !user || !targetUserId) return;
    await acceptMutation.mutateAsync({ friendshipId, targetUserId });
    await fetchData();
  };

  const removeFriend = async () => {
    if (!friendshipId) return;
    await removeMutation.mutateAsync(friendshipId);
    await fetchData();
  };

  const toggleFollow = async () => {
    if (!user || !targetUserId || isSelf) return;
    await followMutation.mutateAsync({ targetUserId, isCurrentlyFollowing: isFollowing });
    await fetchData();
  };

  return {
    friendStatus,
    isFollowing,
    friendCount,
    followerCount,
    followingCount,
    mutualFriendsCount,
    loading,
    isSelf,
    isLoggedIn: !!user,
    isTargetAdmin,
    sendFriendRequest,
    acceptFriendRequest,
    removeFriend,
    toggleFollow,
  };
};
