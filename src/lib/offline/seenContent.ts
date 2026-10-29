/**
 * S7b-4 · WHAT THE MEMBER OPENED ONLINE OPENS AGAIN WITH NO NETWORK.
 *
 * A post page and a comment thread are not React Query data (PostDetail and
 * usePostComments read directly), so OFF-1's persistence never kept them:
 * after the app was closed, a post the member had just read said "Post not
 * found" in flight mode, and its comments said there were none.
 *
 * Kept in OFF-1's device store (IndexedDB, per member, every read filtered by
 * member, wiped on sign-out — OFF-5 G6), one record per post / thread, bounded
 * by the store's own caps (oldest first). A thread keeps its authors' names and
 * pictures with it, so the names are right offline too (never "Photographer").
 */
import { deleteRecord, putRecord, readAll } from "./deviceStore";

/**
 * Review #564: bumped by the sign-out wipe. A page that started loading before
 * a sign-out hands back the epoch it started with, and is not saved after it.
 */
let epoch = 0;
export const seenContentEpoch = () => epoch;
export function resetSeenContent(): void { epoch++; }

const POST = "seen-post";
const THREAD = "seen-thread";

export interface SavedAuthor { full_name: string | null; avatar_url: string | null; custom_url?: string | null; badges?: string[] }

async function readOne<T>(userId: string, key: unknown[]): Promise<T | null> {
  if (!userId) return null;
  const want = JSON.stringify(key);
  for (const r of await readAll(userId)) {
    if (JSON.stringify(r.key) === want) return (r.data ?? null) as T | null;
  }
  return null;
}

/** Keep the post page the member just opened online. Never throws. */
export function rememberPost<T extends { id: string }>(userId: string | null | undefined, post: T, opts: { epoch?: number } = {}): Promise<boolean> {
  if (!userId || !post?.id) return Promise.resolve(false);
  if (opts.epoch !== undefined && opts.epoch !== epoch) return Promise.resolve(false);
  return putRecord(userId, [POST, post.id], post).catch(() => false);
}

/** The post page as it was last opened online by this member, or null. */
export function savedPost<T = unknown>(userId: string | null | undefined, postId: string): Promise<T | null> {
  return userId ? readOne<T>(userId, [POST, postId]).catch(() => null) : Promise.resolve(null);
}

/** Keep a comment thread read online, with the names and pictures of its authors. */
export function rememberThread(
  userId: string | null | undefined,
  postId: string,
  rows: unknown[],
  authors: Record<string, SavedAuthor>,
  opts: { epoch?: number } = {},
): Promise<boolean> {
  if (!userId || !postId || !Array.isArray(rows)) return Promise.resolve(false);
  if (opts.epoch !== undefined && opts.epoch !== epoch) return Promise.resolve(false);
  return putRecord(userId, [THREAD, postId], { rows, authors }).catch(() => false);
}

/** The thread as it was last read online by this member, or null. */
export function savedThread<R = unknown>(
  userId: string | null | undefined,
  postId: string,
): Promise<{ rows: R[]; authors: Record<string, SavedAuthor> } | null> {
  return userId ? readOne<{ rows: R[]; authors: Record<string, SavedAuthor> }>(userId, [THREAD, postId]).catch(() => null) : Promise.resolve(null);
}

/** Review #564: the server says this post is gone for this member — drop the saved copy and thread. */
export async function forgetPost(userId: string | null | undefined, postId: string): Promise<void> {
  if (!userId) return;
  await deleteRecord(userId, [POST, postId]);
  await deleteRecord(userId, [THREAD, postId]);
}
