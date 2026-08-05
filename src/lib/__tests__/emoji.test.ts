/**
 * EMOJI SHORTCUTS — PINNED.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER REQUIREMENT, 2026-08-05:
 *
 *   "Converts common text shortcuts (like `<3`, `:)`, `:(`, `;)`, etc.) into
 *    emojis... Works anywhere in the comment (beginning, middle, or end)...
 *    Please fix this completely rather than applying a temporary workaround."
 *
 * The value of this file is mostly in the NEGATIVE cases. Turning `<3` into a
 * heart is easy; the way this feature goes wrong in production is by eating
 * text nobody meant as an emoticon — a URL, a ratio, a bracketed number. Those
 * are the tests that matter, and they are first.
 *
 * The emoji are built from code points here for the same reason they are in
 * src/lib/emoji.ts: this repo has a mojibake history (see
 * claude/TEXT_ENCODING_CORRUPTION.md) in which four-byte emoji were exactly
 * what a first sweep missed. A test whose expectations can be silently
 * corrupted proves nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import {
  convertEmojiShortcuts,
  convertEmojiShortcutsWhileTyping,
  EMOJI_SHORTCUTS,
} from "@/lib/emoji";

const HEART = String.fromCodePoint(0x2764, 0xfe0f);
const SMILE = String.fromCodePoint(0x1f60a);
const FROWN = String.fromCodePoint(0x2639, 0xfe0f);
const WINK = String.fromCodePoint(0x1f609);
const BROKEN_HEART = String.fromCodePoint(0x1f494);

describe("text that must NEVER be touched", () => {
  it("leaves a URL completely alone", () => {
    // `https://x` contains `:` then `/`; `:P` can appear in a query string.
    for (const url of [
      "https://example.com",
      "http://50mmretina.com/post/123",
      "see https://example.com/a?q=:P&b=1 here",
      "http://x.com/a:)b",
    ]) {
      expect(convertEmojiShortcuts(url), url).toBe(url);
    }
  });

  it("leaves ordinary punctuation alone", () => {
    for (const text of [
      "(see 8) for details", // `8)` is deliberately not a shortcut
      "ratio 3:2 and f:1.4",
      "arrive at 9:00",
      "the list is: (a) one (b) two",
      "word:) attached to a word",
      ":)word attached the other way",
    ]) {
      expect(convertEmojiShortcuts(text), text).toBe(text);
    }
  });

  it("does not convert a shortcut that is still being typed", () => {
    // `<333` is three characters someone is in the middle of writing, not a
    // heart followed by "33".
    expect(convertEmojiShortcuts("<333")).toBe("<333");
  });

  it("leaves an empty or whitespace-only value untouched", () => {
    expect(convertEmojiShortcuts("")).toBe("");
    expect(convertEmojiShortcuts("   ")).toBe("   ");
  });
});

describe("the owner's own examples", () => {
  it("converts <3 to a heart at the END of the text", () => {
    // His exact sentence, and the case he said was missing.
    expect(convertEmojiShortcuts("I love this <3")).toBe(`I love this ${HEART}`);
  });

  it("converts :) :( ;) ", () => {
    expect(convertEmojiShortcuts(":)")).toBe(SMILE);
    expect(convertEmojiShortcuts(":(")).toBe(FROWN);
    expect(convertEmojiShortcuts(";)")).toBe(WINK);
  });

  it("keeps a keyboard emoji exactly as the member typed it", () => {
    // Point 2 of the requirement. Unicode in, same Unicode out.
    const typed = `already ${SMILE} here`;
    expect(convertEmojiShortcuts(typed)).toBe(typed);
  });
});

describe("works anywhere — beginning, middle, end", () => {
  it("beginning", () => {
    expect(convertEmojiShortcuts("<3 what a shot")).toBe(`${HEART} what a shot`);
  });

  it("middle", () => {
    expect(convertEmojiShortcuts("so <3 good")).toBe(`so ${HEART} good`);
  });

  it("end", () => {
    expect(convertEmojiShortcuts("so good <3")).toBe(`so good ${HEART}`);
  });

  it("several in one comment, side by side", () => {
    expect(convertEmojiShortcuts(":) :( ;)")).toBe(`${SMILE} ${FROWN} ${WINK}`);
  });

  it("across a newline", () => {
    expect(convertEmojiShortcuts("line one <3\nline two :)")).toBe(
      `line one ${HEART}\nline two ${SMILE}`,
    );
  });

  it("longest match wins, so </3 is a broken heart and not a slash + heart", () => {
    expect(convertEmojiShortcuts("</3")).toBe(BROKEN_HEART);
  });
});

describe("running it twice changes nothing", () => {
  it("is idempotent — the submit pass cannot double-convert", () => {
    // MentionInput converts while typing AND the insert converts again. If this
    // were not idempotent the second pass would corrupt the first.
    const once = convertEmojiShortcuts("a <3 b :) c");
    expect(convertEmojiShortcuts(once)).toBe(once);
  });
});

describe("typing-time conversion and the caret", () => {
  it("fires when the space is typed, not before", () => {
    // Mid-token: nothing happens.
    expect(convertEmojiShortcutsWhileTyping("I love this <3", 14).value).toBe(
      "I love this <3",
    );
    // The space arrives: now it converts.
    expect(convertEmojiShortcutsWhileTyping("I love this <3 ", 15).value).toBe(
      `I love this ${HEART} `,
    );
  });

  it("leaves the caret where the member is typing, not at the end", () => {
    // `<3` (2 units) becomes a heart (2 units) so the caret does not move here;
    // `:)` -> a 2-unit surrogate pair likewise. What must never happen is the
    // caret jumping to the end of the box.
    const r = convertEmojiShortcutsWhileTyping("hey <3 there", 7);
    expect(r.value).toBe(`hey ${HEART} there`);
    expect(r.caret).toBeLessThanOrEqual(r.value.length);
    expect(r.value.slice(r.caret)).toBe("there");
  });

  it("never converts text sitting after the caret", () => {
    // The member has gone back to edit; the `:)` further along is not theirs to
    // touch yet.
    const r = convertEmojiShortcutsWhileTyping("start <3 end :)", 9);
    expect(r.value.endsWith(":)")).toBe(true);
  });

  it("survives an out-of-range caret without throwing", () => {
    expect(() => convertEmojiShortcutsWhileTyping("hi", -5)).not.toThrow();
    expect(() => convertEmojiShortcutsWhileTyping("hi", 999)).not.toThrow();
  });
});

describe("the table itself", () => {
  it("is ordered longest-first, or shorter shortcuts would shadow longer ones", () => {
    const lengths = EMOJI_SHORTCUTS.map(([s]) => s.length);
    const threeCharIndexes = lengths
      .map((n, i) => (n >= 3 ? i : -1))
      .filter((i) => i >= 0);
    const twoCharIndexes = lengths
      .map((n, i) => (n === 2 ? i : -1))
      .filter((i) => i >= 0);
    expect(Math.max(...threeCharIndexes)).toBeLessThan(Math.min(...twoCharIndexes));
  });

  it("every entry produces real emoji, never a replacement character", () => {
    for (const [shortcut, emoji] of EMOJI_SHORTCUTS) {
      expect(emoji.length, shortcut).toBeGreaterThan(0);
      expect(emoji, shortcut).not.toContain("�");
      // No C1 control characters — that is the exact shape of the mojibake
      // this codebase suffered in August 2026.
      const hasC1 = [...emoji].some((ch) => {
        const cp = ch.codePointAt(0) ?? 0;
        return cp >= 0x80 && cp <= 0x9f;
      });
      expect(hasC1, shortcut).toBe(false);
    }
  });

  it("does not contain 8) — it cannot be told apart from ordinary writing", () => {
    expect(EMOJI_SHORTCUTS.some(([s]) => s === "8)")).toBe(false);
  });
});
