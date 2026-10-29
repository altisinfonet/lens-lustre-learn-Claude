import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { queryKeys } from "@/lib/queryKeys";
import { submit } from "@/lib/offline/outbox";

/* ── helpers ── */

// S7b-5: through the OFF-2 outbox — one row per (follower, following) however
// often it is sent, and kept on the phone when there is no network.
const ensureFollow = async (followerId: string, followingId: string) => {
  await submit(followerId, { kind: "follow", targetId: followingId });
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
    // S7b-5: follow / unfollow go through the OFF-2 outbox. With no network the
    // action is kept on the phone, shown at once (marked "Will send when
    // online") and sent once when the network is back — never "Failed".
    mutationFn: async ({ targetUserId, isCurrentlyFollowing }: { targetUserId: string; isCurrentlyFollowing: boolean }) => {
      if (!user) throw new Error("Not authenticated");
      const r = await submit(user.id, { kind: isCurrentlyFollowing ? "unfollow" : "follow", targetId: targetUserId });
      return { followed: !isCurrentlyFollowing, queued: r.status === "queued", targetUserId };
    },
    networkMode: "always",
    onSuccess: (result) => {
      if (result.queued && user) {
        // Show it now: the profile's follow state and count, as this member sees them.
        qc.setQueryData<{ isFollowing?: boolean; followerCount?: number }>(
          ["friend-follow", result.targetUserId, user.id],
          (d) => (d ? { ...d, isFollowing: result.followed, followerCount: Math.max(0, (d.followerCount ?? 0) + (result.followed ? 1 : -1)) } : d),
        );
        toast({ title: result.followed ? "Following — will send when online" : "Unfollowed — will send when online" });
        return;
      }
      toast({ title: result.followed ? "Following!" : "Unfollowed" });
      qc.invalidateQueries({ queryKey: queryKeys.follows(), exact: false });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to follow", description: err.message, variant: "destructive" });
    },
  });
}
