/**
 * The 46 master photography categories, read from the database.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE FETCH PER SESSION, SHARED BY EVERY SURFACE
 *
 * Owner, 2026-08-12: "Optimize the publish flow so category selection adds no
 * unnecessary network round trips."
 *
 * The categories themselves are a fixed list that changes only when an admin
 * edits it, so this is cached with an effectively infinite `staleTime`. The
 * Create picker, the feed category strip and the registration interest chips
 * all subscribe to the SAME query key, so they cost **one** request between
 * them for the life of the tab — not one each, and never one per post.
 *
 * Publishing itself costs zero extra round trips: `posts.categories` is a
 * column on the row already being inserted, so the chosen slugs travel inside
 * the existing INSERT. There is no second statement, which is also why a post
 * can never exist without its categories.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `is_active` IS FILTERED HERE AND NOT BY THE CALLER
 *
 * A deactivated category must vanish from the strip and from the picker, but
 * posts already carrying its slug keep it — the slug stays valid in storage,
 * it simply stops being offered. Filtering in one place is what stops a
 * half-retired category reappearing on some surface that forgot to check.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Category } from "@/lib/categories";

/**
 * The generated Supabase types have not been regenerated since `categories`
 * was created, so the typed `from()` overload does not know the table exists.
 * One documented narrowing through `unknown`, in a single place, rather than
 * an `as any` at the call site — which would also silence a real mistake in a
 * column name.
 */
type UntypedFrom = (table: string) => {
  select: (cols: string) => {
    eq: (col: string, val: unknown) => {
      order: (col: string, opts: { ascending: boolean }) => PromiseLike<{
        data: unknown;
        error: unknown;
      }>;
    };
  };
};

export const CATEGORIES_QUERY_KEY = ["categories"] as const;

export function useCategories() {
  return useQuery<Category[]>({
    queryKey: CATEGORIES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await (supabase.from as unknown as UntypedFrom)(
        "categories",
      )
        .select("slug, name, icon_name, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      /**
       * ⚠ A FAILED FETCH MUST THROW, NOT RETURN AN EMPTY LIST.
       *
       * Owner, 2026-08-12: "on a bit slow network … top categories are not
       * visible, only All is showing". This was the cause, and it was mine.
       *
       * Returning `[]` here reports the failure to React Query as a SUCCESS
       * whose value happens to be empty. Combined with `staleTime: Infinity`
       * below, that empty list is then treated as fresh, correct data for the
       * rest of the session — so one dropped request on a weak signal removed
       * all 46 categories until the app was restarted. "All" survived only
       * because it is hard-coded in the strip, never fetched.
       *
       * Throwing lets React Query see a real error: it retries, it does not
       * cache the failure as truth, and the strip fills in as soon as the
       * network recovers.
       */
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("categories: unexpected payload shape");
      return data as Category[];
    },
    // The taxonomy is a fixed admin-managed list. Refetching it on every mount
    // would be pure waste; an admin edit reaches members on their next load.
    // Infinity is safe ONLY because a failure now throws instead of being
    // cached as an empty success (see the queryFn). A cached ERROR is retried;
    // a cached empty SUCCESS never is — that was the bug.
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    // Three attempts with backoff, because the failure this recovers from is a
    // weak mobile signal, not a broken endpoint. Still bounded so a genuinely
    // dead table cannot spin forever.
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
}
