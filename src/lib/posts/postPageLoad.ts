/**
 * S7b-4 · THE POST PAGE, ONLINE AND OFF. What PostDetail shows for /post/:id.
 *
 * Before: every failed read set "not found", so a member in flight mode who
 * tapped a post they had just seen was told "Post not found or has been
 * removed." Now:
 *   · the server answers and there is no row  → "gone" (the post really is not
 *     there for this member: deleted, hidden, or never theirs to see);
 *   · no network, or the read fails on the network → the copy saved when this
 *     member last opened it online, else the post as saved in their feed
 *     (S7b-3), else "offline" — a plain "no internet" note, never "not found";
 *   · any other refusal (permission) → "gone", as before;
 *   · opened online → shown, and saved on the phone for next time.
 * No network = no request at all.
 */
import { isNetworkError } from "@/lib/offline/retryPolicy";
import { findSavedFeedPost } from "@/lib/offline/feedArchive";
import { rememberPost, savedPost } from "@/lib/offline/seenContent";

/** The fields PostDetail renders (it owns the full type). */
export interface PostPageData {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  image_urls: string[];
  privacy: string;
  created_at: string;
  author_name: string | null;
  author_avatar: string | null;
  author_handle: string | null;
  like_count: number;
  comment_count: number;
  share_count: number;
  user_reaction: string | null;
  top_reactions: string[];
  reaction_counts: Record<string, number>;
  video?: unknown;
}

export type PostRow = { id: string; user_id: string; content?: string | null; image_url?: string | null; image_urls?: string[] | null; privacy?: string | null; created_at: string };

export interface PostPageDeps {
  /** Is there a network (React Query's online flag)? */
  online(): boolean;
  /** The post row; `error` set when the read failed. */
  readPost(postId: string): Promise<{ data: PostRow | null; error: unknown }>;
  /** Everything else the page shows (author, counts, media). null = not viewable (e.g. a hidden video). */
  readDetails(row: PostRow): Promise<PostPageData | null>;
}

export type PostPageResult =
  | { kind: "post"; post: PostPageData; saved: boolean }
  | { kind: "gone" }
  | { kind: "offline" };

/** A post as saved in the feed, in the page's shape. */
function fromFeedPost(p: Record<string, unknown>): PostPageData {
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    id: String(p.id),
    user_id: String(p.user_id ?? ""),
    content: typeof p.content === "string" ? p.content : "",
    image_url: (p.image_url as string | null) ?? null,
    image_urls: Array.isArray(p.image_urls) ? (p.image_urls as string[]) : [],
    privacy: typeof p.privacy === "string" ? p.privacy : "public",
    created_at: String(p.created_at ?? ""),
    author_name: (p.author_name as string | null) ?? null,
    author_avatar: (p.author_avatar as string | null) ?? null,
    author_handle: (p.author_handle as string | null) ?? null,
    like_count: n(p.like_count),
    comment_count: n(p.comment_count),
    share_count: n(p.share_count),
    user_reaction: (p.user_reaction as string | null) ?? null,
    top_reactions: Array.isArray(p.top_reactions) ? (p.top_reactions as string[]) : [],
    reaction_counts: (p.reaction_counts as Record<string, number>) ?? {},
    video: p.video ?? null,
  };
}

async function fromPhone(postId: string, viewerId: string | null | undefined): Promise<PostPageResult> {
  if (viewerId) {
    const page = await savedPost<PostPageData>(viewerId, postId);
    if (page) return { kind: "post", post: page, saved: true };
    const feedPost = await findSavedFeedPost(viewerId, postId).catch(() => null);
    if (feedPost) return { kind: "post", post: fromFeedPost(feedPost as Record<string, unknown>), saved: true };
  }
  return { kind: "offline" };
}

export async function loadPostPage(
  postId: string,
  viewerId: string | null | undefined,
  deps: PostPageDeps,
): Promise<PostPageResult> {
  if (!deps.online()) return fromPhone(postId, viewerId);
  let read: { data: PostRow | null; error: unknown };
  try {
    read = await deps.readPost(postId);
  } catch (e) {
    read = { data: null, error: e };
  }
  if (read.error) return isNetworkError(read.error) ? fromPhone(postId, viewerId) : { kind: "gone" };
  if (!read.data) return { kind: "gone" };
  let post: PostPageData | null;
  try {
    post = await deps.readDetails(read.data);
  } catch (e) {
    if (isNetworkError(e)) return fromPhone(postId, viewerId);
    throw e;
  }
  if (!post) return { kind: "gone" };
  void rememberPost(viewerId, post);
  return { kind: "post", post, saved: false };
}
