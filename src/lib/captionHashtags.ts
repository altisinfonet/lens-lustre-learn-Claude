/**
 * HASHTAGS IN POST CAPTIONS — the trigger rule.
 *
 * Owner, 2026-08-16: typing "#" in a post caption offers existing hashtags,
 * ranked by how many PEOPLE use them, so members converge on the same tags
 * instead of inventing a new spelling every time.
 *
 * Scope, confirmed by him twice: "Post Section Only" — the composer on Feed and
 * My Wall (one component), the app's caption screen, inline post edit, and
 * scheduled-post edit. Nowhere else. Comments, bios, messages and search keep
 * behaving exactly as they do today.
 *
 * ── WHY THERE IS NO "CONVERT AT SUBMIT" STEP ──────────────────────────────
 * Unlike @mentions, a hashtag needs no markup: "#street" IS the stored form.
 * `RichContentRenderer` already links it and `sync_post_hashtags` already
 * counts it. Picking from the list only saves typing and settles the spelling —
 * it never changes what gets stored, so a hand-typed tag and a picked tag are
 * the same thing. (Contrast src/lib/captionMentions.ts, where only a PICKED
 * name may convert, because guessing a person is dangerous. Guessing a hashtag
 * is not possible: the text is the tag.)
 */

/** Characters PostgreSQL's `#([A-Za-z0-9_]{1,60})` accepts inside a tag. */
const TAG_CHAR = /[A-Za-z0-9_]/;

/** The database refuses anything longer; stop offering before that. */
export const MAX_TAG_LENGTH = 60;

/**
 * The active "#query" being typed, measured from the caret.
 *
 * ⚠ DELIBERATELY NOT word-boundary anchored, and this is the one place worth
 * reading twice. `RichContentRenderer` matches `#(\w+)` ANYWHERE in the text,
 * and the database trigger matches `#([A-Za-z0-9_]{1,60})` anywhere too. So in
 * "C#sharp" the platform already treats "#sharp" as a real, clickable, counted
 * hashtag. If this function required whitespace before the "#", the suggestion
 * list would stay silent for a tag that is nonetheless about to be created and
 * linked — a tag that exists everywhere except in the box where it was typed.
 *
 * Three definitions of "a hashtag" would be worse than one slightly eager one,
 * so this follows the renderer exactly. The visible cost: typing "C#s" opens
 * the list. Pressing Escape or carrying on typing dismisses it, and nothing is
 * inserted unless the member picks.
 *
 * Returns null when the caret is not inside a hashtag.
 */
export function activeHashtagQuery(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const at = before.lastIndexOf("#");
  if (at === -1) return null;

  const query = before.slice(at + 1);

  // A hashtag has no spaces and no line breaks. This is also what keeps the
  // "#" and "@" lists mutually exclusive without either knowing about the
  // other: in "#street @par" the hashtag query would contain a space, so it
  // closes on its own the moment the member moves on to a mention.
  if (query.length > MAX_TAG_LENGTH) return null;
  for (const ch of query) {
    if (!TAG_CHAR.test(ch)) return null;
  }

  return { query, start: at };
}

/**
 * Replace the "#query" under the caret with the chosen tag, plus one space.
 *
 * Returns the new text and where the caret belongs afterwards, so the caller
 * does not have to recompute a length that is easy to get wrong by one.
 */
export function applyHashtagPick(
  text: string,
  start: number,
  caret: number,
  tag: string,
): { next: string; caret: number } {
  const inserted = `#${tag} `;
  const before = text.slice(0, start);
  const after = text.slice(caret);
  return { next: before + inserted + after, caret: (before + inserted).length };
}
