/**
 * THE POST ADDRESS — one rule for the whole app (Owner order 2026-11-07:
 * "every post address carries the member's name", SEO plan step A3).
 *
 *   postPath(id, "neil.basu")  → /neil.basu/post/<id>
 *   postPath(id)               → /post/<id>   (short form: notifications, push,
 *                                 anything that only knows the post id)
 *
 * The short form keeps working for ever: PostDetail loads the post, learns the
 * author's handle and REPLACES the address with the long form, so old links,
 * bookmarks and shares never break. A handle that does not match the profile
 * rule (profiles_custom_url_format) is never put in an address — the short form
 * is used instead, and never the member's user id.
 *
 * Ratchet: src/__tests__/postPathOneRule.test.ts fails on any hand-built
 * `/post/${…}` outside this file.
 */

/** profiles_custom_url_format: 3–30 of a-z 0-9 . _ , no leading/trailing dot, no "..". */
const HANDLE = /^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$/;

export function isPostHandle(handle: string | null | undefined): handle is string {
  return typeof handle === "string" && HANDLE.test(handle) && !handle.includes("..");
}

/** The address of a post. Pass the author's handle whenever it is known. */
export function postPath(postId: string, handle?: string | null): string {
  const id = encodeURIComponent(postId);
  return isPostHandle(handle) ? `/${handle}/post/${id}` : `/post/${id}`;
}

/** Any post-shaped object that carries its author's handle under a common name. */
export function postPathOf(post: {
  id: string;
  author_handle?: string | null;
  custom_url?: string | null;
  profiles?: { custom_url?: string | null } | null;
}): string {
  return postPath(post.id, post.author_handle ?? post.profiles?.custom_url ?? post.custom_url ?? null);
}
