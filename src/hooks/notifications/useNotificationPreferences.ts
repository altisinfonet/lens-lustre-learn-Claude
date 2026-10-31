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
  /**
   * PUSH. These six columns are not new and they are not decoration: the
   * database trigger `push_on_notification()` has read them since 2026-08-01.
   * They had simply never been exposed anywhere in the app, so the 12 members
   * with a registered device had no way to stop receiving pushes.
   *
   * `push_new_posts` was deliberately absent when this shipped, because the
   * trigger did not read it. Migration 20260802230000 added the one line that
   * reads it — proven on production, rolled back: on -> 1 push queued, off -> 0
   * — so the switch is real and is now here.
   */
  push_enabled: boolean;
  push_reactions: boolean;
  push_comments: boolean;
  push_friend_requests: boolean;
  push_new_followers: boolean;
  push_competition_updates: boolean;
  push_new_posts: boolean;
  /**
   * ADDED 2026-08-15. `journal_published` and `course_published` are the two
   * platform broadcasts: one notification row per member. Both are deliberately
   * barred from EMAIL under BUG-038 ("mass broadcast types never email the
   * whole base") and both used to fall through `push_on_notification`'s CASE to
   * `ELSE true`, so they reached every registered device with no way out short
   * of `push_enabled: false`. Migration 20260815999999 added the branch that
   * reads this column. Defaults ON: the reach is wanted, the opt-out was what
   * was missing.
   */
  push_announcements: boolean;
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
  // Same defaults the columns carry (NOT NULL DEFAULT true), so a member with
  // no preferences row sees exactly what the server will do for them.
  push_enabled: true,
  push_reactions: true,
  push_comments: true,
  push_friend_requests: true,
  push_new_followers: true,
  push_competition_updates: true,
  push_new_posts: true,
  push_announcements: true,
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
        // `?? true` matches the column default, so a row written before these
        // columns existed reads as "on" rather than silently as "off".
        push_enabled: (data as any).push_enabled ?? true,
        push_reactions: (data as any).push_reactions ?? true,
        push_comments: (data as any).push_comments ?? true,
        push_friend_requests: (data as any).push_friend_requests ?? true,
        push_new_followers: (data as any).push_new_followers ?? true,
        push_competition_updates: (data as any).push_competition_updates ?? true,
        push_new_posts: (data as any).push_new_posts ?? true,
        push_announcements: (data as any).push_announcements ?? true,
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
