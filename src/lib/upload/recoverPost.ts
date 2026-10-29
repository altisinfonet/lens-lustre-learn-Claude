import { supabase } from "@/integrations/supabase/client";

/**
 * S5 · ONE UPLOAD ID, ONE POST — on the legacy fallback too.
 *
 * The legacy insert carries the composition's idempotency key, so the partial
 * unique index `posts_user_idempotency_key` refuses a second post for it. That
 * matters in exactly the case the fallback exists for: `post_publish_with_media`
 * COMMITTED and its answer was lost (kill point 8), so the client fell back.
 * Before S5 the fallback had no key and made a second post. Now the insert
 * fails (23505, or the duplicate-post trigger, which fires first), and this
 * looks the post up by its key: the post that exists IS the answer.
 */
export async function recoverPostByKey<E extends { message: string; code?: string }>(
  res: { data: { id: string } | null; error: E | null },
  userId: string,
  idempotencyKey: string,
): Promise<{ data: { id: string } | null; error: E | null }> {
  if (!res.error) return res;
  const { data } = await supabase
    .from("posts")
    .select("id")
    .eq("user_id", userId)
    .eq("idempotency_key" as never, idempotencyKey as never)
    .maybeSingle();
  return data ? { data: data as { id: string }, error: null } : res;
}
