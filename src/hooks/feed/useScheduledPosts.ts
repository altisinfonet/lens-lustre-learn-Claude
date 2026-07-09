// Phase 3B — Scheduled Posts hooks (list + mutations).
// All CRUD paths are RLS-gated by policies from Phase 1 migration:
//   sp_select_own, sp_insert_own, sp_update_own_pending, sp_delete_own_pending.
// UI never bypasses RLS; the service_role publisher (Phase 2 edge fn) is
// the ONLY other writer.

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";

export type ScheduledPostStatus =
  | "pending"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export interface ScheduledPost {
  id: string;
  user_id: string;
  content: string | null;
  image_urls: string[];
  image_url: string | null;
  tagged_user_ids: string[];
  scheduled_for: string;
  original_scheduled_for: string;
  status: ScheduledPostStatus;
  attempt_count: number;
  shifted_count: number;
  last_shift_reason: string | null;
  last_error: string | null;
  published_post_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useScheduledPosts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["scheduled-posts", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<ScheduledPost[]> => {
      const { data, error } = await supabase
        .from("scheduled_posts")
        .select("*")
        .order("scheduled_for", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ScheduledPost[];
    },
  });
}

export interface CreateScheduledPostInput {
  content: string;
  image_urls: string[];
  image_url: string | null;
  tagged_user_ids?: string[];
  scheduled_for: string; // ISO UTC
}

export function useCreateScheduledPost() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: CreateScheduledPostInput) => {
      if (!user?.id) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("scheduled_posts")
        .insert({
          user_id: user.id,
          content: input.content,
          image_urls: input.image_urls,
          image_url: input.image_url,
          tagged_user_ids: input.tagged_user_ids ?? [],
          scheduled_for: input.scheduled_for,
          original_scheduled_for: input.scheduled_for,
        } as any)
        .select("*")
        .single();
      if (error) throw error;
      return data as ScheduledPost;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-posts", user?.id] });
    },
  });
}

export function useRescheduleScheduledPost() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (args: { id: string; scheduled_for: string }) => {
      const { data, error } = await supabase
        .from("scheduled_posts")
        .update({ scheduled_for: args.scheduled_for } as any)
        .eq("id", args.id)
        .eq("status", "pending") // client guard; RLS enforces server-side
        .select("*")
        .single();
      if (error) throw error;
      return data as ScheduledPost;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-posts", user?.id] });
    },
  });
}

export function useCancelScheduledPost() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      // Hard delete (status=pending only, enforced by RLS sp_delete_own_pending).
      const { error } = await supabase
        .from("scheduled_posts")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-posts", user?.id] });
    },
  });
}

// Phase 5 — Combined update mutation (content and/or scheduled_for).
// RLS `sp_update_own_pending` enforces server-side that only owner + status='pending' rows can be updated.
export interface UpdateScheduledPostInput {
  id: string;
  content?: string;
  scheduled_for?: string; // ISO UTC
}

export function useUpdateScheduledPost() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: UpdateScheduledPostInput) => {
      const patch: Record<string, unknown> = {};
      if (typeof input.content === "string") patch.content = input.content;
      if (typeof input.scheduled_for === "string") patch.scheduled_for = input.scheduled_for;
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update");
      const { data, error } = await supabase
        .from("scheduled_posts")
        .update(patch as any)
        .eq("id", input.id)
        .eq("status", "pending") // client guard; RLS enforces server-side
        .select("*")
        .single();
      if (error) throw error;
      return data as ScheduledPost;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-posts", user?.id] });
    },
  });
}

// Phase 5 — Realtime subscription hook (filtered server-side by user_id).
// Invalidates the scheduled-posts query on any change so status flips, shifts,
// and publisher writes reflect live without refresh.
export function useScheduledPostsRealtime() {
  const qc = useQueryClient();
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`scheduled_posts:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scheduled_posts",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["scheduled-posts", user.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, qc]);
}

