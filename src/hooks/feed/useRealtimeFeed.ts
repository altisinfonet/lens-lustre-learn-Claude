import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIsPrimaryInstance } from "@/hooks/core/useIsPrimaryInstance";
import { addFeedLiveConsumer, refreshFeedLive } from "@/lib/realtime/feedLive";

/**
 * Realtime for the feed and the wall.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * S6-b (2026-10-29): this hook no longer opens a channel. It registers with
 * the ONE shared "feed-live" channel in `src/lib/realtime/feedLive.ts`, whose
 * every binding carries a server-side filter (the posts this consumer holds,
 * the authors it follows). Every mounted consumer — the feed, a wall, the
 * composer on /feed — receives the events it asked for, so the old
 * "primary instance" election (which could leave the feed deaf while the
 * composer held the channel) is gone for this hook.
 *
 * History kept for the next reader:
 *   · 2026-08-13 removed the post_comments / post_shares bindings — those
 *     counters ride the `posts` UPDATE (trg_update_post_comments_count,
 *     trg_update_post_shares_count, trg_update_post_likes_count); see
 *     `src/lib/feed/realtimeCounts.ts` for the field-name mismatch that made
 *     them look load-bearing.
 *   · `post_reactions` INSERT STAYS: it is the only source of the per-type
 *     breakdown behind the emoji cluster.
 *   · S6-b removed the posts DELETE and post_reactions DELETE bindings:
 *     Supabase cannot filter DELETE events, and an unfiltered binding sends
 *     every delete on the platform to every client (decision S6-b-D1 in
 *     feedLive.ts).
 */
export function useFeedRealtime({
  userId,
  relevantUserIds,
  watchPostIds,
  onNewPost,
  onUpdatePost,
  onReactionChange,
}: {
  userId: string | undefined;
  relevantUserIds: string[];
  /** The posts this screen holds: their edits, counts and reactions arrive live (≤ 100 used). */
  watchPostIds: string[];
  onNewPost: (post: any) => void;
  /** `isOwnPost` lets a consumer take the counters but keep its own local content edit. */
  onUpdatePost: (post: any, isOwnPost: boolean) => void;
  onReactionChange: (postId: string, event: "INSERT" | "DELETE", reaction: any) => void;
}) {
  // Handlers + data in refs: the consumer is registered once per member.
  const handlersRef = useRef({ onNewPost, onUpdatePost, onReactionChange });
  handlersRef.current = { onNewPost, onUpdatePost, onReactionChange };
  const relevantIdsRef = useRef(relevantUserIds);
  relevantIdsRef.current = relevantUserIds;
  const postIdsRef = useRef(watchPostIds);
  postIdsRef.current = watchPostIds;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  useEffect(() => {
    if (!userId) return;
    return addFeedLiveConsumer({
      userId,
      authorIds: () => relevantIdsRef.current,
      postIds: () => postIdsRef.current,
      onInsert: (p) => {
        // Own posts are NOT skipped: this event is the designed path for a
        // member's own new post to appear at the top instantly (Feed's
        // handleNewPost own-post branch).
        if (p.privacy === "public" || p.user_id === userIdRef.current || relevantIdsRef.current.includes(p.user_id)) {
          handlersRef.current.onNewPost(p);
        }
      },
      onUpdate: (p) => {
        /**
         * ⚠ OWN POSTS ARE NOT DROPPED HERE: a like on your photo is a `posts`
         * UPDATE, and dropping it froze the counts on your own posts. The
         * consumer decides whether a local content edit wins.
         */
        const isOwnPost = p.user_id === userIdRef.current;
        if (isOwnPost || p.privacy === "public" || relevantIdsRef.current.includes(p.user_id)) {
          handlersRef.current.onUpdatePost(p, isOwnPost);
        }
      },
      onReaction: (r) => {
        // Own reactions are already applied optimistically.
        if (r.user_id === userIdRef.current) return;
        handlersRef.current.onReactionChange(r.post_id, "INSERT", r);
      },
    });
  }, [userId]);

  // The filter lists follow what is on screen (debounced rebuild in feedLive).
  const filterKey = `${relevantUserIds.join(",")}|${watchPostIds.slice(0, 100).join(",")}`;
  useEffect(() => {
    if (userId) refreshFeedLive();
  }, [userId, filterKey]);
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

  // The notification bell is mounted TWICE — a desktop copy and a mobile copy,
  // one hidden by CSS. CSS hides; it does not unmount. So without this guard
  // both copies subscribed, and because the channel name was a fixed string
  // both created a channel object on the SAME topic: unmounting the hidden bell
  // could tear the topic out from under the visible one. Only the primary
  // instance subscribes. See useIsPrimaryInstance.
  const isPrimary = useIsPrimaryInstance(userId ? `notif-realtime:${userId}` : "");

  useEffect(() => {
    if (!userId || !isPrimary) return;

    // Per-user topic. A fixed "notif-live" is shared across every session in the
    // process, so signing out and back in as somebody else could collide with a
    // channel that had not finished tearing down.
    const channel = supabase
      .channel(`notif-live:${userId}`)
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
  }, [userId, isPrimary]); // Re-subscribe when the user changes, or when this instance becomes the primary one
}
