/**
 * SEARCH WITHIN A LOADED COMMENT THREAD.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A PURE FUNCTION IN lib/ AND NOT A `.filter()` INSIDE THE PANEL
 *
 * The interesting behaviour here is not "does the text match" — it is what
 * happens to a REPLY whose parent does not match, and to a parent whose reply
 * does. Written inline in PostCommentsSection that decision would be three
 * lines nobody could test without mounting a sheet, a drawer and a mocked
 * Supabase client. Written here it is a table of cases, and
 * src/lib/__tests__/commentSearch.test.ts holds each one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO RULES, STATED BECAUSE THEY ARE NOT INTERCHANGEABLE
 *
 *   1. A parent that matches keeps ALL of its replies. The member searched for
 *      that comment; hiding the conversation hanging off it would answer a
 *      different question than the one they asked.
 *   2. A parent that does NOT match is kept only if at least one reply matches,
 *      and then carries ONLY the matching replies. The parent is context — you
 *      cannot read "I agree" without the thing it agrees with — so it is drawn
 *      even though it is not itself a hit.
 *
 * A comment is never promoted out of its thread: a matching reply stays a
 * reply, indented under its parent, because the indent is what says which
 * comment it answers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS SEARCHES WHAT IS LOADED, AND NOTHING ELSE
 *
 * usePostComments reads at most 200 rows (`.limit(200)`) in one query. This
 * filters THAT array in memory — it issues no request of its own and can
 * therefore never find comment 201. That is a deliberate limit, not an
 * oversight: a server-side comment search is a different unit with its own
 * index and its own gate, and a thread deep enough to hit 200 is rare enough
 * that shipping the honest in-memory version now beats shipping nothing.
 * `searchCeiling` below is what the panel uses to say so out loud.
 */
import type { ThreadComment } from "@/components/comments/CommentThread";

/** The row ceiling usePostComments reads; mirrored here only to be stated in the UI. */
export const COMMENT_SEARCH_CEILING = 200;

/**
 * Fold the mention markup out before matching.
 *
 * A mention is stored as `@[Neil Basu](uuid)` — the member sees "Neil Basu"
 * and searching for the uuid would be absurd, while searching "Neil" must
 * still hit. Matching the raw string would also let a query like `](` match
 * every comment that mentions anyone, which is the kind of result that makes
 * a search box feel broken.
 */
const searchableText = (content: string): string =>
  content.replace(/@\[([^\]]+)\]\([^)]*\)/g, "$1");

/** Case- and accent-insensitive "does this text contain that query". */
const contains = (haystack: string | null | undefined, needle: string): boolean => {
  if (!haystack) return false;
  return haystack
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .includes(needle);
};

/** Normalise a raw query the same way the haystack is normalised. */
export const normalizeQuery = (query: string): string =>
  query
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * Does this one comment match, on its own text, its author's display name, or
 * its handle? The handle counts because the thread shows it beside the name —
 * a member searching "@somnath" is searching for what they can see.
 */
export const commentMatches = (comment: ThreadComment, normalizedQuery: string): boolean => {
  if (!normalizedQuery) return true;
  return (
    contains(searchableText(comment.content), normalizedQuery) ||
    contains(comment.author_name, normalizedQuery) ||
    contains(comment.author_handle, normalizedQuery)
  );
};

/**
 * The filtered tree. An empty or whitespace-only query returns the input
 * array UNCHANGED (same reference) — the panel renders the normal thread and
 * pays nothing for a search box nobody is using.
 */
export const filterComments = (comments: ThreadComment[], query: string): ThreadComment[] => {
  const q = normalizeQuery(query);
  if (!q) return comments;

  const out: ThreadComment[] = [];
  for (const comment of comments) {
    if (commentMatches(comment, q)) {
      // Rule 1 — a hit keeps its whole conversation.
      out.push(comment);
      continue;
    }
    // Rule 2 — kept as context only for the replies that actually matched.
    const hits = comment.replies.filter((reply) => commentMatches(reply, q));
    if (hits.length > 0) out.push({ ...comment, replies: hits });
  }
  return out;
};

/** Comments plus replies, so "3 results" counts what the member can see. */
export const countComments = (comments: ThreadComment[]): number =>
  comments.reduce((total, c) => total + 1 + c.replies.length, 0);
