/**
 * BUG-062 on the hashtag page: post_shares has no UPDATE policy, so a default
 * upsert (ON CONFLICT DO UPDATE) fails on a repeat share. The feed already uses
 * ignoreDuplicates; PostCard's own fallback, which the hashtag page uses, did not.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "..", "PostCard.tsx"), "utf8");

describe("PostCard's own share", () => {
  it("a repeat share is a safe no-op, not an error", () => {
    expect(source).toMatch(/post_shares[\s\S]{0,160}ignoreDuplicates: true/);
  });
});
