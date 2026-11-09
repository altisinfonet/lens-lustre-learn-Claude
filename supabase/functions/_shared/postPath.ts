/**
 * THE POST ADDRESS — Deno copy of src/lib/posts/postPath.ts (Owner order
 * 2026-11-07, SEO plan A3). Edge functions cannot import from src/, so the rule
 * is repeated here; src/__tests__/postPathOneRule.test.ts holds both equal.
 *
 *   postPath(id, "neil.basu") → /neil.basu/post/<id>
 *   postPath(id)              → /post/<id>
 */
const HANDLE = /^[a-z0-9_][a-z0-9._]{1,28}[a-z0-9_]$/;

export function isPostHandle(handle: string | null | undefined): handle is string {
  return typeof handle === "string" && HANDLE.test(handle) && !handle.includes("..");
}

export function postPath(postId: string, handle?: string | null): string {
  const id = encodeURIComponent(postId);
  return isPostHandle(handle) ? `/${handle}/post/${id}` : `/post/${id}`;
}
