import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";

export interface NotificationPreferences {
  email_reactions: boolean;
  email_comments: boolean;
  email_friend_requests: boolean;
  email_new_followers: boolean;
  email_competition_updates: boolean;
  email_gift_credits: boolean;
  email_certificates: boolean;
  email_course_updates: boolean;
  inapp_reactions: boolean;
  inapp_comments: boolean;
  inapp_social: boolean;
  inapp_competitions: boolean;
  email_weekly_digest: boolean;
  email_reengagement: boolean;
}

const DEFAULTS: NotificationPreferences = {
  email_reactions: true,
  email_comments: true,
  email_friend_requests: true,
  email_new_followers: true,
  email_competition_updates: true,
  email_gift_credits: true,
  email_certificates: true,
  email_course_updates: true,
  inapp_reactions: true,
  inapp_comments: true,
  inapp_social: true,
  inapp_competitions: true,
  email_weekly_digest: true,
  email_reengagement: true,
};

export function useNotificationPreferences() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["notification-preferences", user?.id];

  const query = useQuery({
    queryKey: key,
    queryFn: async (): Promise<NotificationPreferences> => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return DEFAULTS;

      return {
        email_reactions: data.email_reactions,
        email_comments: data.email_comments,
        email_friend_requests: data.email_friend_requests,
        email_new_followers: data.email_new_followers,
        email_competition_updates: data.email_competition_updates,
        email_gift_credits: data.email_gift_credits,
        email_certificates: data.email_certificates,
        email_course_updates: data.email_course_updates,
        inapp_reactions: data.inapp_reactions,
        inapp_comments: data.inapp_comments,
        inapp_social: data.inapp_social,
        inapp_competitions: data.inapp_competitions,
        email_weekly_digest: data.email_weekly_digest,
        email_reengagement: (data as any).email_reengagement ?? true,
      };
    },
    enabled: !!user,
  });

  const mutation = useMutation({
    mutationFn: async (updates: Partial<NotificationPreferences>) => {
      const { data: existing } = await supabase
        .from("notification_preferences")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("notification_preferences")
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq("user_id", user!.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("notification_preferences")
          .insert({ user_id: user!.id, ...updates });
        if (error) throw error;
      }
    },
    onMutate: async (updates) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<NotificationPreferences>(key);
      qc.setQueryData<NotificationPreferences>(key, (old) => ({
        ...(old ?? DEFAULTS),
        ...updates,
      }));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast({ title: "Failed to save preference", variant: "destructive" });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });

  return {
    preferences: query.data ?? DEFAULTS,
    isLoading: query.isLoading,
    updatePreference: (field: keyof NotificationPreferences, value: boolean) => {
      mutation.mutate({ [field]: value });
    },
    isSaving: mutation.isPending,
  };
}
