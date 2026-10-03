import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Blocking (App Store guideline 1.2 — "a mechanism for users to block abusive
 * users ... should remove it from the user's feed instantly").
 *
 * The set of blocked member ids lives in one cached query. Every surface that
 * shows other members' content (feed, wall, comments, post detail, profile)
 * reads `blockedIds` from here and hides what belongs to those members. `block`
 * updates the cache optimistically BEFORE the network call returns, which is
 * what makes the removal instant. The database trigger on `user_blocks` files a
 * notice for the moderation team (migration 20261003_0001).
 */
interface BlockRow {
  blocked_id: string;
  created_at: string;
}

const EMPTY: ReadonlySet<string> = new Set<string>();

export function useBlockedUsers() {
  const { user } = useAuth();
  const userId = user?.id;
  const qc = useQueryClient();
  const key = queryKeys.blockedUsers(userId ?? "");

  const { data, isLoading } = useQuery({
    queryKey: key,
    enabled: !!userId,
    queryFn: async (): Promise<BlockRow[]> => {
      const { data, error } = await supabase
        .from("user_blocks")
        .select("blocked_id, created_at")
        .eq("blocker_id", userId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as BlockRow[];
    },
  });

  const blockedIds = useMemo<ReadonlySet<string>>(
    () => (data && data.length > 0 ? new Set(data.map((r) => r.blocked_id)) : EMPTY),
    [data],
  );

  const blockMutation = useMutation({
    mutationFn: async (targetId: string) => {
      if (!userId) throw new Error("Sign in to block a member");
      if (targetId === userId) throw new Error("You cannot block yourself");
      const { error } = await supabase
        .from("user_blocks")
        .insert({ blocker_id: userId, blocked_id: targetId });
      // 23505 = already blocked: the end state the member asked for.
      if (error && error.code !== "23505") throw error;
    },
    onMutate: async (targetId: string) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BlockRow[]>(key);
      qc.setQueryData<BlockRow[]>(key, (old) => [
        { blocked_id: targetId, created_at: new Date().toISOString() },
        ...(old ?? []).filter((r) => r.blocked_id !== targetId),
      ]);
      return { previous };
    },
    onError: (err: Error, _id, ctx) => {
      qc.setQueryData(key, ctx?.previous);
      toast.error("Could not block this member", { description: err.message });
    },
    onSuccess: () => {
      toast.success("Member blocked", {
        description: "Their posts and comments are hidden from you. Our moderators have been notified.",
      });
    },
  });

  const unblockMutation = useMutation({
    mutationFn: async (targetId: string) => {
      if (!userId) throw new Error("Sign in to unblock a member");
      const { error } = await supabase
        .from("user_blocks")
        .delete()
        .eq("blocker_id", userId)
        .eq("blocked_id", targetId);
      if (error) throw error;
    },
    onMutate: async (targetId: string) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<BlockRow[]>(key);
      qc.setQueryData<BlockRow[]>(key, (old) => (old ?? []).filter((r) => r.blocked_id !== targetId));
      return { previous };
    },
    onError: (err: Error, _id, ctx) => {
      qc.setQueryData(key, ctx?.previous);
      toast.error("Could not unblock this member", { description: err.message });
    },
    onSuccess: () => {
      toast.success("Member unblocked");
    },
  });

  const isBlocked = useCallback((id: string | null | undefined) => !!id && blockedIds.has(id), [blockedIds]);

  return {
    blockedIds,
    blockedRows: data ?? [],
    isLoading,
    isBlocked,
    block: blockMutation.mutate,
    blocking: blockMutation.isPending,
    unblock: unblockMutation.mutate,
    unblocking: unblockMutation.isPending,
  };
}
