import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to realtime changes on posts, post_reactions, and post_comments.
 * Uses refs for all handlers so the channel is stable — only re-subscribes when userId changes.
 */
export function useFeedRealtime({
  userId,
  relevantUserIds,
  onNewPost,
  onUpdatePost,
  onDeletePost,
  onReactionChange,
  onCommentChange,
  onShareChange,
}: {
  userId: string | undefined;
  relevantUserIds: string[];
  onNewPost: (post: any) => void;
  onUpdatePost: (post: any) => void;
  onDeletePost: (postId: string) => void;
  onReactionChange: (postId: string, event: "INSERT" | "DELETE", reaction: any) => void;
  onCommentChange: (postId: string, event: "INSERT" | "DELETE", comment: any) => void;
  onShareChange?: (postId: string, event: "INSERT" | "DELETE") => void;
}) {
  // Store handlers + data in refs so channel callbacks always see latest values
  const handlersRef = useRef({ onNewPost, onUpdatePost, onDeletePost, onReactionChange, onCommentChange, onShareChange });
  handlersRef.current = { onNewPost, onUpdatePost, onDeletePost, onReactionChange, onCommentChange, onShareChange };

  const relevantIdsRef = useRef(relevantUserIds);
  relevantIdsRef.current = relevantUserIds;

  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel("feed-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        (payload) => {
          const p = payload.new as any;
          // Skip own posts — already added optimistically by the create flow
          if (p.user_id === userIdRef.current) return;
          if (p.privacy === "public" || relevantIdsRef.current.includes(p.user_id)) {
            handlersRef.current.onNewPost(p);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "posts" },
        (payload) => {
          const p = payload.new as any;
          // Skip own post edits — already applied locally
          if (p.user_id === userIdRef.current) return;
          if (p.privacy === "public" || relevantIdsRef.current.includes(p.user_id)) {
            handlersRef.current.onUpdatePost(p);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "posts" },
        (payload) => {
          const old = payload.old as any;
          // Skip own post deletes — already removed locally
          if (old?.user_id === userIdRef.current) return;
          if (old?.id) handlersRef.current.onDeletePost(old.id);
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "post_reactions" },
        (payload) => {
          const r = payload.new as any;
          // Skip own reactions — already handled optimistically
          if (r.user_id === userIdRef.current) return;
          handlersRef.current.onReactionChange(r.post_id, "INSERT", r);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "post_reactions" },
        (payload) => {
          const r = payload.old as any;
          // Skip own reaction removals — already handled optimistically
          if (r.user_id === userIdRef.current) return;
          handlersRef.current.onReactionChange(r.post_id, "DELETE", r);
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "post_comments" },
        (payload) => {
          const c = payload.new as any;
          // Skip own comments — already counted locally
          if (c.user_id === userIdRef.current) return;
          handlersRef.current.onCommentChange(c.post_id, "INSERT", c);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "post_comments" },
        (payload) => {
          const c = payload.old as any;
          // Skip own comment deletions — already counted locally
          if (c.user_id === userIdRef.current) return;
          handlersRef.current.onCommentChange(c.post_id, "DELETE", c);
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "post_shares" },
        (payload) => {
          const s = payload.new as any;
          if (s.user_id === userIdRef.current) return;
          handlersRef.current.onShareChange?.(s.post_id, "INSERT");
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "post_shares" },
        (payload) => {
          const s = payload.old as any;
          if (s.user_id === userIdRef.current) return;
          handlersRef.current.onShareChange?.(s.post_id, "DELETE");
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]); // Only re-subscribe when userId changes
}

/**
 * Subscribes to realtime notification events and calls scoped handlers
 * with the actual payload — never triggers a full refetch.
 * Uses refs for handlers so the channel only re-subscribes when userId changes.
 */
export function useNotificationRealtime(
  userId: string | undefined,
  handlers: {
    onUserNotification: (notif: any) => void;
    onFriendRequest: (friendship: any) => void;
    onFriendshipUpdate: (friendship: any) => void;
    onGift: (gift: any) => void;
    onAdminNotification?: (notif: any) => void;
    onFollowChange?: (follow: any, event: "INSERT" | "DELETE") => void;
  }
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel("notif-live")
      // User notifications
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const n = payload.new as any;
          // Skip notifications triggered by own actions (actor_id === self)
          if (n.actor_id === userId) return;
          handlersRef.current.onUserNotification(n);
        }
      )
      // Friend requests (new pending) — filter already ensures addressee_id=userId,
      // so requester is always someone else; skip own-initiated requests echoed back
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "friendships",
          filter: `addressee_id=eq.${userId}`,
        },
        (payload) => {
          const f = payload.new as any;
          if (f.requester_id === userId) return; // own action
          handlersRef.current.onFriendRequest(f);
        }
      )
      // Friendship status changes (accept/decline) — client-side filter required
      // because DELETE events lack old-row data without REPLICA IDENTITY FULL
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "friendships",
        },
        (payload) => {
          const f = payload.new as any;
          if (f.requester_id === userId || f.addressee_id === userId) {
            handlersRef.current.onFriendshipUpdate(f);
          }
        }
      )
      // Friendship deletion
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "friendships",
        },
        (payload) => {
          const f = payload.old as any;
          if (f?.requester_id === userId || f?.addressee_id === userId) {
            handlersRef.current.onFriendshipUpdate(f);
          }
        }
      )
      // Gift announcements
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "gift_announcements",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => handlersRef.current.onGift(payload.new)
      )
      // Admin notifications
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "admin_notifications",
        },
        (payload) => handlersRef.current.onAdminNotification?.(payload.new)
      )
      // Follows
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "follows",
        },
        (payload) => {
          const f = payload.new as any;
          // Skip own follow actions — already applied locally
          if (f.follower_id === userId) return;
          // Only handle if the current user is the target of the follow
          if (f.following_id === userId) {
            handlersRef.current.onFollowChange?.(f, "INSERT");
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "follows",
        },
        (payload) => {
          const f = payload.old as any;
          if (f.follower_id === userId || f.following_id === userId) {
            handlersRef.current.onFollowChange?.(f, "DELETE");
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]); // Only re-subscribe when userId changes
}
