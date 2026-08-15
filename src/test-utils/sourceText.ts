/**
 * STRIPPING COMMENTS OUT OF SOURCE, WITHOUT EATING THE SOURCE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Dozens of tests in this repository read a component's own source and assert
 * on it. Nearly all of them strip comments first, with some version of
 *
 *     src.replace(/\/\*[\s\S]*?\*\//g, "")
 *
 * and that regex has a trap in it that cost an afternoon on 2026-08-15.
 *
 * `WallPosts.tsx` contains `accept="image/*"`. Inside a STRING, but the regex
 * cannot see strings — so `/*` there opens a "comment" that runs until the next
 * `*​/` anywhere in the file. Everything between the two disappears. On that day
 * the next `*​/` happened to be a comment ~400 lines further down, so 400 lines
 * of real code — including the character-limit gate two different tests assert
 * on — were silently deleted before the assertions ran.
 *
 * The tests had been GREEN for weeks. They went red the moment an unrelated
 * comment was added elsewhere in the file, because that changed which `*​/`
 * closed the fake comment. Which means they had been passing, or failing, for
 * reasons that had nothing to do with what they claimed to check.
 *
 * THE RULE HERE: a real block comment's `/*` is preceded by the start of the
 * file, whitespace, or one of `{ ( , ; =` — never by a letter, which is what
 * `image/*` and `text/*` and a bare url path all look like. That single
 * condition removes the whole class of failure and keeps the helper a regex
 * rather than a parser.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Remove block comments (including JSX `{​/* … *​/}`) and whole-line `//`
 * comments, leaving every line of actual code in place.
 *
 * Line comments are matched only when they START a line — a trailing `// …`
 * after code would take `https://` with it, which is the same trap wearing a
 * different hat.
 */
export function stripComments(src: string): string {
  return src
    .replace(/(^|[\s{(,;=>])\/\*[\s\S]*?\*\//g, "$1")
    .replace(/^\s*\/\/.*$/gm, "");
}
