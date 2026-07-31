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
      // POLICY (owner, standing): the official/admin account can be FOLLOWED but
      // never friended. `useFriendFollow` enforced this for profile buttons, but
      // the feed's Add-friend button called this mutation directly and bypassed
      // it (owner report 2026-07-31 — a request reached the official account).
      // The rule now lives at the mutation, so no future caller can skip it.
      // A DB trigger backs it up as the final authority.
      const { data: targetIsAdmin } = await supabase.rpc("has_role" as never, {
        _user_id: targetUserId,
        _role: "admin",
      } as never);
      if (targetIsAdmin) {
        throw new Error("FOLLOW_ONLY_ACCOUNT");
      }
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
      // 23505 = unique violation on (requester_id, addressee_id): a request to
      // this person already exists. That is not an error worth alarming anyone
      // with — and the raw Postgres text must never reach a user.
      if ((err as { code?: string })?.code === "23505"
          || /duplicate key value|already exists/i.test(err.message || "")) {
        toast({ title: "Friend request already sent" });
        return;
      }
      // Official account: follow-only by policy (also blocked in the DB).
      if (err.message === "FOLLOW_ONLY_ACCOUNT"
          || /follow[- ]only|does not accept friend requests/i.test(err.message || "")) {
        toast({
          title: "This account can only be followed",
          description: "Use Follow to see their photography.",
        });
        return;
      }
      toast({ title: "Couldn't send friend request", description: err.message, variant: "destructive" });
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
