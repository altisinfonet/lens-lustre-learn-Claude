/**
 * THE ONE HASHTAG RULE on the client (H1, Owner plan 2026-11-09).
 *
 * What counts as a hashtag is decided ONCE, in the database, by
 * public.extract_hashtags (migration 20261112_0100). This file mirrors that
 * rule character for character so that what a member sees underlined as a link
 * is exactly what the server counts and the hashtag page finds:
 *
 *   - letters of every language in HASHTAG_CHAR_CLASS (Latin with accents,
 *     Greek, Cyrillic, Arabic, every Indian script, Thai, Japanese, Chinese,
 *     Korean) plus digits, "_" and the joiners Indian scripts need;
 *   - 1 to 60 characters; at most 30 distinct tags per post, first-seen order;
 *   - punctuation ends a tag — also the danda "।", so "#street।" is #street.
 *
 * hashtagOneRule.test.ts compares HASHTAG_CHAR_CLASS with the migration's text
 * and refuses any other hand-written hashtag pattern in src/.
 *
 * Lower-casing for LOOKUP is the server's job (normalize_hashtag): the client
 * sends the tag as written and never decides whether two tags are the same.
 */

/** Must equal HASHTAG_CHAR_CLASS in supabase/migrations/20261112_0100_h1_hashtag_page.sql. */
export const HASHTAG_CHAR_CLASS =
  "A-Za-z0-9_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF\\u0620-\\u0669\\u066E-\\u06D3\\u06D5-\\u06FF\\u0900-\\u0963\\u0966-\\u0DFF\\u0E01-\\u0E59\\u3040-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uAC00-\\uD7AF\\u200C\\u200D";

export const MAX_TAG_LENGTH = 60;
export const MAX_TAGS_PER_POST = 30;

/** `#tag` anywhere, group 1 = the tag as written. New object per call (it is global/stateful). */
export function hashtagPattern(): RegExp {
  return new RegExp(`#([${HASHTAG_CHAR_CLASS}]{1,${MAX_TAG_LENGTH}})`, "gu");
}

/** The pattern's source, for building a combined token regex (RichContentRenderer). */
export const HASHTAG_TOKEN_SOURCE = `#([${HASHTAG_CHAR_CLASS}]{1,${MAX_TAG_LENGTH}})`;

const ONE_CHAR = new RegExp(`^[${HASHTAG_CHAR_CLASS}]$`, "u");

/** Can this single character be part of a hashtag? */
export function isHashtagChar(ch: string): boolean {
  return ONE_CHAR.test(ch);
}

/** Same as the server's normalize_hashtag, for de-duplicating in the UI only. */
export function sameTagKey(tag: string): string {
  return tag.replace(/^#/, "").toLowerCase().normalize("NFC");
}

/** Tags in a caption, as written, first-seen order, de-duplicated, at most 30. */
export function extractHashtags(text: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of (text ?? "").matchAll(hashtagPattern())) {
    const key = sameTagKey(m[1]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m[1]);
    if (out.length === MAX_TAGS_PER_POST) break;
  }
  return out;
}

/** The hashtag page's address. */
export function hashtagPath(tag: string): string {
  return `/hashtag/${encodeURIComponent(tag.replace(/^#/, ""))}`;
}
