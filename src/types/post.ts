import type { ReactionType } from "@/components/ReactionPicker";

/**
 * Unified Post type — used by BOTH Feed and Wall.
 * The only difference between the two surfaces is the query, not the shape.
 */
export interface UnifiedPost {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  image_urls: string[];
  /**
   * The 600px thumbnails the uploader stored beside each image, aligned with
   * image_urls by index (posts.thumbnail_urls). Optional: older posts have
   * none, and the feed RPC does not return it (it is batch-fetched after).
   * The feed card shows this small copy when present; NEVER derive a thumbnail
   * address by string rule — that broke many old posts on 2026-08-07, because
   * their originals live on the CDN but their thumbnails live on Supabase
   * storage. Read the note in PostMedia.tsx before changing this.
   */
  thumbnail_urls?: (string | null)[] | null;
  privacy: string;
  created_at: string;
  author_name: string | null;
  author_avatar: string | null;
  author_last_active?: string | null;
  author_badges?: string[];
  like_count: number;
  comment_count: number;
  share_count: number;
  is_liked: boolean;
  user_reaction: ReactionType | null;
  top_reactions: string[];
  reaction_counts: Record<string, number>;
  is_suggested?: boolean;
  /**
   * Friendship state between the viewer and this post's author.
   * "none" = no friendship row exists in either direction (the only state where
   * an "Add friend" button may be shown). Anything else means a row already
   * exists, and inserting another would violate the unique constraint on
   * (requester_id, addressee_id) — the cause of the "duplicate key value"
   * error users hit on 2026-07-31.
   *
   * "unavailable" = this account does not accept friend requests at all
   * (the official/admin account — POLICY: follow only, never friend).
   */
  friend_state?: "none" | "sent" | "received" | "friends" | "unavailable";
  views?: number;
  reach?: number;
  /**
   * True when this row reached the wall through post_shares rather than being
   * authored by the wall's owner. Set ONLY by useUserPostsQuery — the feed does
   * not distinguish reshares. It is what lets the wall offer "Remove from my
   * wall" on a post somebody else wrote: before 2026-08-01 a mis-tapped share
   * could not be undone at all, because the post is not yours to delete and the
   * card offered nothing but "Report content".
   */
  is_reshare?: boolean;
}
