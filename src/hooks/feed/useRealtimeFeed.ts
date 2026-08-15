import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIsPrimaryInstance } from "@/hooks/core/useIsPrimaryInstance";

/**
 * Realtime for the feed and the wall.
 *
 * Uses refs for all handlers so the channel is stable — only re-subscribes when
 * userId changes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ FOUR BINDINGS WERE REMOVED ON 2026-08-13, AND WHY THAT IS SAFE
 *
 * This channel carried NINE bindings: `posts` INSERT/UPDATE/DELETE, plus
 * INSERT/DELETE on each of `post_reactions`, `post_comments` and `post_shares`
 * — the four busiest tables in the product, with no server-side filter. Every
 * write anywhere on the platform was broadcast to every connected client and
 * then discarded in JavaScript. At 500 concurrent members one reaction became
 * 500 messages so that 499 could `return`.
 *
 * The `post_comments` and `post_shares` bindings existed only to keep two
 * counters moving. They are gone, because those counters already arrive on the
 * `posts` UPDATE — verified against production, not assumed:
 *
 *     post_comments  → trg_update_post_comments_count → posts.comments_count
 *     post_shares    → trg_update_post_shares_count   → posts.shares_count
 *     post_reactions → trg_update_post_likes_count    → posts.likes_count
 *
 * The reason they were load-bearing anyway was a field-name mismatch on the
 * consumer side, described in full in `src/lib/feed/realtimeCounts.ts`.
 *
 * `post_reactions` STAYS. It is the one child table carrying something `posts`
 * does not: the per-reaction-type breakdown behind the emoji cluster. There is
 * no absolute source for that, so it keeps its delta path.
 *
 * ⚠ Do not "finish the job" by removing `post_reactions` too without replacing
 * the breakdown — the emoji cluster on every card is fed by it.
 */
export function useFeedRealtime({
  userId,
  relevantUserIds,
  onNewPost,
  onUpdatePost,
  onDeletePost,
  onReactionChange,
}: {
  userId: string | undefined;
  relevantUserIds: string[];
  onNewPost: (post: any) => void;
  /** `isOwnPost` lets a consumer take the counters but keep its own local content edit. */
  onUpdatePost: (post: any, isOwnPost: boolean) => void;
  onDeletePost: (postId: string) => void;
  onReactionChange: (postId: string, event: "INSERT" | "DELETE", reaction: any) => void;
}) {
  // Store handlers + data in refs so channel callbacks always see latest values
  const handlersRef = useRef({ onNewPost, onUpdatePost, onDeletePost, onReactionChange });
  handlersRef.current = { onNewPost, onUpdatePost, onDeletePost, onReactionChange };

  const relevantIdsRef = useRef(relevantUserIds);
  relevantIdsRef.current = relevantUserIds;

  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  /**
   * ⚠ THE SAME DEFECT THE BELL ALREADY FIXED, ON A SECOND HOOK.
   *
   * `/feed` mounts this hook TWICE: `Feed.tsx:167` directly, and again through
   * `Feed.tsx:298`, which renders `<WallPosts composerOnly>` — and `composerOnly`
   * gates only the JSX at `WallPosts.tsx:1834`, never the hook at
   * `WallPosts.tsx:150`.
   *
   * The channel name is the fixed string "feed-live", so supabase-js created two
   * channel objects on ONE topic. Every `posts` and `post_reactions` event was
   * delivered and processed twice, and — the dangerous half —
   * `removeChannel` on either one tears down the topic the other is still
   * using, so unmounting the composer could silence the live feed.
   *
   * `useIsPrimaryInstance` was written for exactly this and applied to
   * `useNotificationRealtime` below; it was never carried across to this hook.
   * The key is per-user so signing out and in as somebody else starts a new
   * group rather than inheriting a half-torn-down one.
   */
  const isPrimary = useIsPrimaryInstance(userId ? `feed-realtime:${userId}` : "");

  useEffect(() => {
    if (!userId || !isPrimary) return;

    const channel = supabase
      .channel("feed-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        (payload) => {
          const p = payload.new as any;
          // NOTE: own posts are NOT skipped here. The create flow (WallPosts
          // composer) does not write into the feed cache, so this event is the
          // designed path for a user's own post to appear instantly — Feed's
          // handleNewPost has an own-post branch (insert at top + scroll) that
          // was previously dead code because of a skip here.
          if (p.privacy === "public" || p.user_id === userIdRef.current || relevantIdsRef.current.includes(p.user_id)) {
            handlersRef.current.onNewPost(p);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "posts" },
        (payload) => {
          const p = payload.new as any;
          /**
           * ⚠ OWN POSTS ARE NO LONGER DROPPED HERE.
           *
           * This used to `return` outright for your own posts, on the reasoning
           * that an edit you made is already applied locally. True for CONTENT
           * — and it also silently threw away every COUNTER change on your own
           * posts. Somebody liking your photo produced a `posts` UPDATE that
           * this line discarded, so the count only moved because a separate
           * `post_reactions` binding happened to catch it. Remove that binding
           * (as 2026-08-13 did for comments and shares) and the counts on your
           * own posts would quietly stop moving.
           *
           * The flag is passed on instead of decided here: the consumer knows
           * whether it has a local edit worth protecting. See
           * `src/lib/feed/realtimeCounts.ts`.
           */
          const isOwnPost = p.user_id === userIdRef.current;
          if (isOwnPost || p.privacy === "public" || relevantIdsRef.current.includes(p.user_id)) {
            handlersRef.current.onUpdatePost(p, isOwnPost);
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, isPrimary]); // Re-subscribe when the user changes, or when this instance is promoted
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
