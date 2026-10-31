/**
 * MENTIONS IN POST CAPTIONS — the conversion rule.
 *
 * Owner (1053 headline item): "typing @name in a post caption tags a member,
 * like comments do."
 *
 * Comments store mentions as `@[Display Name](userId)` markup (react-mentions)
 * and RichContentRenderer turns that into a profile link. Captions use the
 * SAME markup, so Caption.tsx renders them with zero changes.
 *
 * The composer keeps its plain textarea (the over-limit highlight overlay and
 * auto-grow are owner-approved behavior — "never break what works"), so while
 * typing, a picked mention is inserted as VISIBLE text `@Display Name`, and
 * the picked member's id is remembered in a map. This function converts the
 * visible text to markup at submit time.
 *
 * HONESTY RULE — no guessing:
 *  - ONLY names the member actually picked from the dropdown convert. Typing
 *    "@Partha Dalal" by hand without picking stays plain text, because we do
 *    not know WHICH Partha the author meant, and a wrong tag is worse than no
 *    tag.
 *  - If the author edits a picked name afterwards ("@Partha Dal"), it no
 *    longer matches and stays plain text — degraded, never wrong.
 */

export interface PickedMention {
  /** The full_name exactly as inserted into the caption. */
  display: string;
  /** The picked member's profile id. */
  id: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replace every `@Display Name` the author picked with `@[Display Name](id)`.
 *
 * Longest names first, so "@Partha Dalal Roy" can never be half-eaten by a
 * shorter picked name "@Partha Dalal". A name followed by a letter or digit
 * does not convert (it is a different, longer word), and text already inside
 * mention markup is left alone.
 */
export function applyCaptionMentions(text: string, mentions: PickedMention[]): string {
  if (!text || mentions.length === 0) return text;

  // Dedupe by display (last pick wins) and sort longest-first.
  const byDisplay = new Map<string, string>();
  for (const m of mentions) {
    if (m.display && m.id) byDisplay.set(m.display, m.id);
  }
  const ordered = [...byDisplay.entries()].sort((a, b) => b[0].length - a[0].length);

  let result = text;
  for (const [display, id] of ordered) {
    // Not preceded by "[" (already markup) and not followed by a word char.
    const re = new RegExp(`@${escapeRegExp(display)}(?![\\w])`, "g");
    result = result.replace(re, (match, offset: number) => {
      // Inside existing markup? `@[Name](id)` — the "@" there is followed by
      // "[", which the pattern cannot match, so the only remaining hazard is
      // a display name that itself starts with "[", which profiles cannot
      // have. Safe to convert.
      void offset;
      void match;
      return `@[${display}](${id})`;
    });
  }
  return result;
}

/**
 * The active "@query" being typed, measured from the caret.
 *
 * Looks backwards from the caret for an "@" that starts a mention: at the
 * start of the text or after whitespace / an opening bracket. The query may
 * contain a single space (first + last name) but stops at 40 characters —
 * beyond that nobody is typing a name.
 *
 * Returns null when the author is not in a mention.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  // "@" must start a word: beginning of text or preceded by whitespace/( .
  if (at > 0 && !/[\s(]/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 40) return null;
  // A mention query holds at most one internal space and never a newline.
  if (/\n/.test(query)) return null;
  if ((query.match(/ /g) || []).length > 1) return null;
  // A finished markup mention is not a query.
  if (query.startsWith("[")) return null;
  return { query, start: at };
}
