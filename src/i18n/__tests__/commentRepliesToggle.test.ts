import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * "View N more replies" / "Hide replies" (#875 review, 4 Nov 2026): the toggle
 * under a comment is a translated string in EVERY dictionary, and the shared
 * row reads it through t() — never a hard-coded English sentence.
 */
const root = process.cwd();
const read = (f: string) => fs.readFileSync(path.resolve(root, f), "utf8");
const FILES = ["", ".bn", ".gu", ".hi", ".mr", ".ta", ".te"].map((l) => `src/i18n/translations${l}.ts`);
const KEYS = ["cmt.viewOneReply", "cmt.viewReplies", "cmt.hideReplies"];

describe("the replies toggle is translated", () => {
  for (const f of FILES) {
    it(`${f} has all three strings, and the plural keeps its {n}`, () => {
      const src = read(f);
      for (const k of KEYS) expect(src, `${f} is missing ${k}`).toMatch(new RegExp(`"${k.replace(".", "\\.")}":\\s*"[^"]+"`));
      expect(src).toMatch(/"cmt\.viewReplies":\s*"[^"]*\{n\}[^"]*"/);
    });
  }

  it("CommentThread draws them through t(), with no English sentence of its own", () => {
    const src = read("src/components/comments/CommentThread.tsx");
    for (const k of KEYS) expect(src).toContain(`t("${k}"`);
    expect(src).not.toMatch(/`View \$\{replyCount\}/);
  });
});
