import type { ThreadComment } from "@/components/comments/CommentThread";

/** One `image_comments` row with its author, as ImageEngagement reads it. */
export interface ImageComment {
  id: string;
  user_id: string;
  content: string;
  parent_id: string | null;
  created_at: string;
  profile_name: string | null;
  avatar_url: string | null;
  /** F-95 — the name-URL handle, carried beside the name it belongs to. */
  author_handle: string | null;
  badges: string[];
  is_pinned?: boolean;
  is_admin_seed?: boolean;
  replies?: ImageComment[];
}

/**
 * This table's row → the one shared thread's shape. `image_comments` has no
 * updated_at and no per-comment likes, so a row never reads "Edited" and never
 * carries a count.
 */
export const toThread = (c: ImageComment): ThreadComment => ({
  id: c.id,
  user_id: c.user_id,
  content: c.content,
  created_at: c.created_at,
  updated_at: c.created_at,
  parent_id: c.parent_id,
  is_pinned: c.is_pinned ?? false,
  is_admin_seed: c.is_admin_seed ?? false,
  author_name: c.profile_name,
  author_handle: c.author_handle,
  author_avatar: c.avatar_url,
  author_badges: c.badges,
  author_last_active: null,
  like_count: 0,
  is_liked: false,
  replies: (c.replies ?? []).map(toThread),
});
