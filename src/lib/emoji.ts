/**
 * EMOJI SHORTCUTS — `<3` becomes a heart, everywhere a member types.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER REQUIREMENT, 2026-08-05, verbatim:
 *
 *   "Users should be able to add emojis anywhere in their comments, including
 *    after the comment text. I specifically asked you to support emoji parsing,
 *    including manual emoji shortcuts. For example:
 *      I love this <3   -> should automatically convert to a heart
 *      :)  -> smile   :(  -> frown   ;)  -> wink
 *    Right now, this is not implemented. If I type <3, it remains plain text."
 *
 *   1. Converts common text shortcuts into emoji.
 *   2. Allows standard keyboard emoji.
 *   3. Works anywhere — beginning, middle or end.
 *   4. Stores and displays correctly across all devices.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS ACTUALLY MISSING — MEASURED, NOT ASSUMED
 *
 * Points 2 and 4 were already true and there is live proof, so nothing here
 * touches them. Verified on production, 2026-08-05:
 *
 *   * `post_comments.content` and `posts.content` are `text` with no length
 *     limit; server_encoding and client_encoding are both UTF8.
 *   * 10 of 113 comments and 18 of 153 posts already hold multi-byte text, and
 *     it is stored CORRECTLY — a live comment reads back as code points
 *     U+2764 U+FE0F, a real heart, not the mojibake this codebase has suffered
 *     before. Bengali comments round-trip perfectly too.
 *   * A four-byte (astral) emoji was rehearsed through a real INSERT and read
 *     back byte-identical inside a rolled-back transaction — 24 bytes, 18
 *     characters. Four-byte emoji are exactly what the 2026-08-03 mojibake
 *     sweep had missed, so this was the case worth proving.
 *
 * ONLY POINT 1 WAS MISSING. This file is that, and nothing more.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE EMOJI ARE BUILT FROM CODE POINTS INSTEAD OF TYPED IN
 *
 * See claude/TEXT_ENCODING_CORRUPTION.md. A tool in this repo's chain once read
 * UTF-8 files as Latin-1 and re-saved them, turning 74 runs of text into
 * mojibake — and the ones the first sweep MISSED were precisely the four-byte
 * emoji. `src/__tests__/sourceEncoding.test.ts` is the tripwire for that.
 *
 * A literal emoji in this file would be corruptible by the same tool. Code
 * points are plain ASCII digits and cannot be. That is not superstition: the
 * encoding test itself had to be rewritten the same way after it corrupted its
 * own sample string.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BOUNDARY RULES — the part that decides whether this is safe
 *
 * A shortcut converts ONLY when both sides are clean:
 *
 *   * the character BEFORE it is the start of the text or whitespace, and
 *   * the character AFTER it is whitespace or the end of the text.
 *
 * That is what stops the two obvious ways this feature goes wrong:
 *
 *   * `https://example.com` — the `:` is preceded by `s`, never converts. A URL
 *     is never touched anywhere along its length.
 *   * `word:)` or `:)word` — mid-word sequences are left exactly as typed.
 *
 * `8)` is deliberately NOT a shortcut, because `(see 8)` is ordinary writing and
 * would have become a face wearing sunglasses. If a shortcut cannot be told
 * apart from normal prose, it does not belong in the list.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * shortcut -> the code points of the emoji it becomes.
 *
 * ORDER MATTERS: longest first, so `</3` is not read as `<3` preceded by a
 * slash, and `:-)` is not read as `:-` followed by `)`.
 */
const SHORTCUT_TABLE: ReadonlyArray<readonly [string, readonly number[]]> = [
  ["</3", [0x1f494]], // broken heart
  [":'(", [0x1f622]], // crying
  [":-)", [0x1f60a]],
  [":-(", [0x2639, 0xfe0f]],
  [";-)", [0x1f609]],
  [":-D", [0x1f603]],
  [":-d", [0x1f603]],
  [":-P", [0x1f61b]],
  [":-p", [0x1f61b]],
  [":-O", [0x1f62e]],
  [":-o", [0x1f62e]],
  ["\\o/", [0x1f64c]], // raised hands
  ["<3", [0x2764, 0xfe0f]], // heart — the owner's own example
  [":)", [0x1f60a]], // smiling
  [":(", [0x2639, 0xfe0f]], // frowning
  [";)", [0x1f609]], // winking
  [":D", [0x1f603]],
  [":d", [0x1f603]],
  [":P", [0x1f61b]],
  [":p", [0x1f61b]],
  [":O", [0x1f62e]],
  [":o", [0x1f62e]],
  [":|", [0x1f610]],
  [":*", [0x1f618]],
  ["xD", [0x1f606]],
  ["XD", [0x1f606]],
] as const;

/** Built at runtime from code points — see the note above about corruption. */
const SHORTCUTS: ReadonlyArray<readonly [string, string]> = SHORTCUT_TABLE.map(
  ([shortcut, codePoints]) =>
    [shortcut, String.fromCodePoint(...codePoints)] as const,
);

/** The shortcuts a member can type, longest first. Exported for the help text. */
export const EMOJI_SHORTCUTS: ReadonlyArray<readonly [string, string]> = SHORTCUTS;

const isBoundary = (ch: string | undefined): boolean =>
  ch === undefined || /\s/.test(ch);

/**
 * Convert every shortcut in `text` that stands alone.
 *
 * Pure, and safe to run repeatedly: an emoji is not a shortcut, so a second
 * pass over converted text changes nothing.
 */
export function convertEmojiShortcuts(text: string): string {
  if (!text) return text;

  let out = "";
  let i = 0;

  while (i < text.length) {
    // Left boundary: start of text, or the previous character is whitespace.
    if (i === 0 || isBoundary(text[i - 1])) {
      const hit = SHORTCUTS.find(([shortcut]) => text.startsWith(shortcut, i));
      if (hit) {
        const after = i + hit[0].length;
        // Right boundary: end of text, or the next character is whitespace.
        if (isBoundary(text[after])) {
          out += hit[1];
          i = after;
          continue;
        }
      }
    }
    // Copying one UTF-16 unit at a time is safe: surrogate pairs are copied in
    // order and never split, and a surrogate half is never whitespace, so it
    // can never be mistaken for a boundary.
    out += text[i];
    i += 1;
  }

  return out;
}

/**
 * The typing-time conversion.
 *
 * WHEN IT FIRES: only when the member has just typed a boundary — a space or a
 * newline. Not on every keystroke.
 *
 * WHY NOT ON EVERY KEYSTROKE: `<3` would become a heart the instant the `3` was
 * typed, so `<333` would come out as a heart followed by `33`. Waiting for the
 * space is what every messaging app does, and it means a member is never
 * fighting a substitution while they are still typing.
 *
 * The trailing case the owner named — *"including after the comment text"*, i.e.
 * `I love this <3` with nothing after it — has no space to trigger on, so it is
 * handled by `convertEmojiShortcuts` at submit. Both halves are needed; neither
 * alone satisfies "works anywhere".
 *
 * Returns the new value and where the caret should sit, because replacing `<3`
 * (2 characters) with a heart (2 UTF-16 units) or `:)` with a smiling face
 * (2 units) changes the length, and the caret must not jump to the end.
 */
export function convertEmojiShortcutsWhileTyping(
  value: string,
  caret: number,
): { value: string; caret: number } {
  const safeCaret = Math.max(0, Math.min(caret, value.length));

  // Only act when the character immediately before the caret is a boundary.
  if (safeCaret === 0 || !isBoundary(value[safeCaret - 1])) {
    return { value, caret: safeCaret };
  }

  const before = value.slice(0, safeCaret);
  const converted = convertEmojiShortcuts(before);
  if (converted === before) return { value, caret: safeCaret };

  return {
    value: converted + value.slice(safeCaret),
    caret: safeCaret - (before.length - converted.length),
  };
}

export default convertEmojiShortcuts;
