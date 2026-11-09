/**
 * N7b · what tapping a notification row DOES — one set of actions for the bell
 * panel and for /notifications, so the same row behaves the same in both.
 *
 * Moved verbatim from src/pages/Notifications.tsx (open, reply, remove, follow
 * back). Both caches are refreshed after every write: the history list and the
 * bell's unread inbox (which feeds the badge).
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useToggleFollow } from "@/hooks/social/useFriendshipMutations";
import { getNotifLink } from "@/lib/notificationLinks";
import { notificationEntryState } from "@/lib/navigationContract";
import { queryKeys } from "@/lib/queryKeys";
import { markGroupRead, deleteGroup } from "@/hooks/notifications/useNotificationHistory";
import type { NotificationGroup } from "@/lib/notificationText";
import { postPath } from "@/lib/posts/postPath";

export function useNotificationActions(handles: Map<string, string>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const followMutation = useToggleFollow();
  const [busyActor, setBusyActor] = useState<string | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["notification-history", user?.id ?? ""] });
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications(user?.id ?? "") });
  };

  const markRead = async (group: NotificationGroup) => {
    if ((group.unread_count ?? 0) > 0) {
      try {
        await markGroupRead(group.notification_ids ?? []);
        refresh();
      } catch {
        // Never block navigation on the read-marking write.
      }
    }
  };

  // A read row navigates at once (no await at all), as the page always did.
  const isUnread = (group: NotificationGroup) => (group.unread_count ?? 0) > 0;

  const openGroup = async (group: NotificationGroup) => {
    if (isUnread(group)) await markRead(group);
    // F-95 — a person-destination notification opens their NAME url.
    // S4-b: the row's type rides along, so a comment notification opens the
    // post on that comment.
    navigate(getNotifLink({
      type: group.type,
      reference_id: group.reference_id,
      handle: handles.get(group.reference_id || ""),
    }), { state: notificationEntryState(group.type) });
  };

  const replyTo = async (group: NotificationGroup, commentId: string) => {
    if (isUnread(group)) await markRead(group);
    navigate(`${postPath(group.reference_id)}?comment=${commentId}`, { state: notificationEntryState(group.type) });
  };

  /**
   * Delete, not dismiss. There is no undo, so the row goes and the caches are
   * refetched from the server rather than patched optimistically — a list that
   * disagrees with the database is worse than a moment's delay.
   */
  const removeGroup = async (group: NotificationGroup) => {
    try {
      await deleteGroup(group.notification_ids ?? []);
    } catch {
      // Leave the row on screen. A delete that silently "worked" and then came
      // back on the next refetch is the worst of both.
      return;
    }
    refresh();
  };

  /**
   * A photo tag waiting for this member's answer (post_tag). Moved from the
   * bell, so the same row answers it on both surfaces. Offered only while the
   * row is unread — an answered tag has nothing pending to update.
   */
  const respondToTag = async (group: NotificationGroup, decision: "approved" | "declined") => {
    if (!user || !group.reference_id) return;
    const { error } = await supabase
      .from("post_tags")
      .update({ status: decision, responded_at: new Date().toISOString() })
      .eq("post_id", group.reference_id)
      .eq("tagged_user_id", user.id)
      .eq("status", "pending");
    if (error) {
      toast({ title: "Couldn't update tag", description: error.message, variant: "destructive" });
      return;
    }
    await markRead(group);
    toast({
      title: decision === "approved" ? "Tag approved" : "Tag declined",
      description: decision === "approved" ? "Now visible on your Photos of You." : "This person can no longer tag you on this post.",
    });
  };

  const followBack = async (actorId: string) => {
    setBusyActor(actorId);
    try {
      await followMutation.mutateAsync({ targetUserId: actorId, isCurrentlyFollowing: false });
      queryClient.invalidateQueries({ queryKey: ["following-set"], exact: false });
    } finally {
      setBusyActor(null);
    }
  };

  return { openGroup, replyTo, removeGroup, followBack, respondToTag, busyActor };
}
