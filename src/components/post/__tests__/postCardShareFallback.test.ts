/**
 * BUG-062 on the hashtag page: post_shares has no UPDATE policy, so a default
 * upsert (ON CONFLICT DO UPDATE) fails on a repeat share. The feed already uses
 * ignoreDuplicates; PostCard's own fallback, which the hashtag page uses, did not.
 *
 * 13 Nov 2026: the share logic moved to the ONE share module the story's paper
 * plane uses too (src/lib/share/shareActions.ts); PostCard must call it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const card = readFileSync(join(__dirname, "..", "PostCard.tsx"), "utf8");
const shared = readFileSync(join(__dirname, "..", "..", "..", "lib", "share", "shareActions.ts"), "utf8");
const story = readFileSync(join(__dirname, "..", "..", "stories", "StoryViewer.tsx"), "utf8");

describe("PostCard's own share", () => {
  it("a repeat share is a safe no-op, not an error", () => {
    expect(shared).toMatch(/post_shares[\s\S]{0,160}ignoreDuplicates: true/);
  });
  it("PostCard and the story viewer use the one share module, not their own copy", () => {
    for (const src of [card, story]) {
      expect(src).toMatch(/from "@\/lib\/share\/shareActions"/);
      expect(src).not.toMatch(/from\("post_shares"/);
    }
  });
});
