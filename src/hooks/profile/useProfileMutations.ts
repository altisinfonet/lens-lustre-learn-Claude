import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { queryKeys } from "@/lib/queryKeys";
import type { ProfileCoreData } from "@/hooks/profile/useProfileData";
import { storageRemove } from "@/lib/storageUpload";

/* ── helper: optimistically patch profile-core + profile-map caches ── */

function patchProfileCore(
  qc: ReturnType<typeof useQueryClient>,
  userId: string,
  patch: Partial<ProfileCoreData>,
) {
  const key = queryKeys.profileCore(userId);
  const prev = qc.getQueryData<ProfileCoreData | null>(key);
  if (prev) {
    qc.setQueryData(key, { ...prev, ...patch });
  }

  // Also patch any cached profileMap / profileDetailMap entries containing this user
  if (patch.full_name !== undefined) {
    qc.setQueriesData<Map<string, string | null>>(
      { queryKey: queryKeys.profileMapPrefix() },
      (old) => {
        if (!old || !old.has(userId)) return old;
        const next = new Map(old);
        next.set(userId, patch.full_name ?? null);
        return next;
      },
    );
  }
  if (patch.full_name !== undefined || patch.avatar_url !== undefined) {
    qc.setQueriesData<Map<string, { full_name: string | null; avatar_url: string | null }>>(
      { queryKey: queryKeys.profileDetailMapPrefix() },
      (old) => {
        if (!old || !old.has(userId)) return old;
        const next = new Map(old);
        const prev = next.get(userId)!;
        next.set(userId, {
          full_name: patch.full_name !== undefined ? (patch.full_name ?? null) : prev.full_name,
          avatar_url: patch.avatar_url !== undefined ? (patch.avatar_url ?? null) : prev.avatar_url,
        });
        return next;
      },
    );
  }

  return prev; // snapshot for rollback
}

/* ── Update profile fields (general save) ── */

export function useUpdateProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (fields: Record<string, any>) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("profiles")
        .update({ ...fields, updated_at: new Date().toISOString() } as any)
        .eq("id", user.id);
      if (error) throw error;
      return fields;
    },
    onMutate: async (fields) => {
      if (!user) return;
      await qc.cancelQueries({ queryKey: queryKeys.profileCore(user.id) });
      const snapshot = patchProfileCore(qc, user.id, fields as Partial<ProfileCoreData>);
      return { snapshot };
    },
    onError: (err: Error, _vars, context) => {
      // Rollback
      if (user && context?.snapshot !== undefined) {
        qc.setQueryData(queryKeys.profileCore(user.id), context.snapshot);
      }
      toast({ title: "Failed to save profile", description: err.message, variant: "destructive" });
    },
    // No onSuccess invalidation needed — cache is already up-to-date
  });
}

/* ── Update avatar URL (atomic: upload already done, DB update here) ── */

export function useUpdateAvatar() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ avatarUrl, storagePath }: { avatarUrl: string; storagePath?: string }) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl } as any)
        .eq("id", user.id);
      if (error) {
        // DB failed — rollback uploaded file
        if (storagePath) {
          try { await storageRemove("avatars", [storagePath]); } catch { /* best-effort */ }
        }
        throw error;
      }
      return avatarUrl;
    },
    onMutate: async ({ avatarUrl }) => {
      if (!user) return;
      await qc.cancelQueries({ queryKey: queryKeys.profileCore(user.id) });
      const snapshot = patchProfileCore(qc, user.id, { avatar_url: avatarUrl });
      return { snapshot };
    },
    onError: (err: Error, _vars, context) => {
      if (user && context?.snapshot !== undefined) {
        qc.setQueryData(queryKeys.profileCore(user.id), context.snapshot);
      }
      toast({ title: "Failed to update avatar", description: err.message, variant: "destructive" });
    },
  });
}

/* ── Admin: update any user's profile (keep invalidate — complex) ── */

export function useAdminUpdateProfile() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, fields }: { userId: string; fields: Record<string, any> }) => {
      const { error } = await supabase
        .from("profiles")
        .update(fields as any)
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: queryKeys.profileCore(variables.userId) });
      void qc.invalidateQueries({ queryKey: queryKeys.profileMap([variables.userId]) });
      void qc.invalidateQueries({ queryKey: queryKeys.profileDetailMap([variables.userId]) });
    },
    onError: (err: Error) => {
      toast({ title: "Profile update failed", description: err.message, variant: "destructive" });
    },
  });
}
