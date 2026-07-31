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
}
