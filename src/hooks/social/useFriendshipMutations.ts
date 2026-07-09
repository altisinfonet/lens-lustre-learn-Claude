import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { queryKeys } from "@/lib/queryKeys";

/* ── helpers ── */

const ensureFollow = async (followerId: string, followingId: string) => {
  const { data: existing } = await supabase
    .from("follows")
    .select("id")
    .eq("follower_id", followerId)
    .eq("following_id", followingId)
    .maybeSingle();
  if (!existing) {
    await supabase.from("follows").insert({ follower_id: followerId, following_id: followingId });
  }
};

/* ── Send friend request ── */

export function useSendFriendRequest() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (targetUserId: string) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("friendships").insert({
        requester_id: user.id,
        addressee_id: targetUserId,
        status: "pending",
      });
      if (error) throw error;
      await ensureFollow(user.id, targetUserId);
    },
    onSuccess: () => {
      toast({ title: "Friend request sent!" });
      qc.invalidateQueries({ queryKey: queryKeys.friendships(), exact: false });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send request", description: err.message, variant: "destructive" });
    },
  });
}

/* ── Accept friend request ── */

export function useAcceptFriendRequest() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ friendshipId, targetUserId }: { friendshipId: string; targetUserId: string }) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("friendships")
        .update({ status: "accepted", updated_at: new Date().toISOString() })
        .eq("id", friendshipId);
      if (error) throw error;
      await Promise.all([
        ensureFollow(user.id, targetUserId),
        ensureFollow(targetUserId, user.id),
      ]);
    },
    onSuccess: () => {
      toast({ title: "Friend request accepted!" });
      qc.invalidateQueries({ queryKey: queryKeys.friendships(), exact: false });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to accept", description: err.message, variant: "destructive" });
    },
  });
}

/* ── Remove / decline friendship ── */

export function useRemoveFriendship() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (friendshipId: string) => {
      const { error } = await supabase.from("friendships").delete().eq("id", friendshipId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Friend removed" });
      qc.invalidateQueries({ queryKey: queryKeys.friendships(), exact: false });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove", description: err.message, variant: "destructive" });
    },
  });
}

/* ── Toggle follow ── */

export function useToggleFollow() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ targetUserId, isCurrentlyFollowing }: { targetUserId: string; isCurrentlyFollowing: boolean }) => {
      if (!user) throw new Error("Not authenticated");
      if (isCurrentlyFollowing) {
        await supabase.from("follows").delete().eq("follower_id", user.id).eq("following_id", targetUserId);
        return { followed: false };
      } else {
        const { error } = await supabase.from("follows").insert({ follower_id: user.id, following_id: targetUserId });
        if (error) throw error;
        return { followed: true };
      }
    },
    onSuccess: (result) => {
      toast({ title: result.followed ? "Following!" : "Unfollowed" });
      qc.invalidateQueries({ queryKey: queryKeys.follows(), exact: false });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to follow", description: err.message, variant: "destructive" });
    },
  });
}
