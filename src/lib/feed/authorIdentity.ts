/**
 * THE ONE RULE FOR A POST'S AUTHOR ON SCREEN (name, face, handle, badges).
 *
 * Owner 13 Nov 2026 (screenshot: his own new post showed "Photographer" and a
 * "P" until the feed reloaded): "always name will show not photographer anymore
 * like META". The feed's own read already named every author; the post that
 * arrives LIVE right after Publish was put on screen with author_name null and
 * only named by a reload 5 s later. Both paths now build the author here, so a
 * post can never reach the screen nameless while its author's profile exists.
 *
 *   name   : the post row's own name first (same statement as the post), else
 *            the shared profile cache, through resolveName (the official
 *            account shows as the brand — adminBrand.ts)
 *   face   : row first, else the cache
 */
import { fetchProfileMap, type ProfileMapEntry } from "@/lib/profileMapCache";
import { getAdminIds, resolveBadges, resolveName } from "@/lib/adminBrand";

export interface AuthorIdentity {
  author_name: string | null;
  author_avatar: string | null;
  author_handle: string | null;
  author_last_active: string | null;
  author_badges: string[];
}

export function authorIdentity(
  userId: string,
  entry: ProfileMapEntry | null | undefined,
  adminIds: Set<string>,
  row?: { name?: string | null; avatar?: string | null },
): AuthorIdentity {
  return {
    author_name: resolveName(userId, row?.name ?? entry?.full_name ?? null, adminIds),
    author_avatar: row?.avatar ?? entry?.avatar_url ?? null,
    author_handle: entry?.custom_url ?? null,
    author_last_active: entry?.last_active_at ?? null,
    author_badges: resolveBadges(userId, entry?.badges || [], adminIds),
  };
}

/** For a post that arrived live (no feed read behind it): the same identity, read from the shared cache. */
export async function loadAuthorIdentity(userId: string): Promise<AuthorIdentity> {
  const [map, adminIds] = await Promise.all([fetchProfileMap([userId]), getAdminIds()]);
  return authorIdentity(userId, map.get(userId), adminIds);
}
