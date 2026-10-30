import { supabase } from "@/integrations/supabase/client";

/**
 * My Photos → "Tagged in": one page of photos the member is tagged in, newest
 * tag first.
 *
 * S11 (2026-10-29): a failed read used to return [] — the tab then said "No
 * tagged photos yet" during an outage or a permission error, with nothing
 * logged — and the next page was asked for only when a page kept PAGE_SIZE
 * photos, so one deleted or text-only post in a page ended the list early.
 * Now a failed read THROWS (React Query retries it; the tab says it could not
 * load), and paging follows the tags read, not the photos kept.
 */
export interface TaggedPhoto { id: string; image_url: string; user_id: string; created_at: string }
export interface TaggedPage { photos: TaggedPhoto[]; tagCount: number }

export async function fetchTaggedPhotosPage(userId: string, page: number, pageSize: number): Promise<TaggedPage> {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const { data: tags, error } = await (supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from("post_tags" as any)
    .select("post_id, created_at")
    .eq("tagged_user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, to) as unknown as Promise<{ data: { post_id: string }[] | null; error: unknown }>);
  if (error) throw error;
  if (!tags?.length) return { photos: [], tagCount: 0 };
  const postIds = tags.map((t) => t.post_id);
  const { data: posts, error: postsError } = await supabase
    .from("posts")
    .select("id, image_url, user_id, created_at")
    .in("id", postIds)
    .not("image_url", "is", null);
  if (postsError) throw postsError;
  const byId = new Map((posts ?? []).map((p) => [p.id, p as TaggedPhoto]));
  const photos = postIds.map((id) => byId.get(id)).filter((p): p is TaggedPhoto => !!p && !!p.image_url);
  return { photos, tagCount: tags.length };
}

/** The next page index while the last page read a FULL page of tags. */
export function nextTaggedPage(last: TaggedPage, pagesSoFar: number, pageSize: number): number | undefined {
  return last.tagCount === pageSize ? pagesSoFar : undefined;
}
