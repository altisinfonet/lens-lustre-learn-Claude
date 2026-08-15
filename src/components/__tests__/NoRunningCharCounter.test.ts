/**
 * NO RUNNING CHARACTER COUNTER ON MEMBER-FACING TEXT AREAS.
 *
 * Owner instruction, 2026-08-04, with screenshot: "on every text area you are
 * showing 55/2200 … Don't show it anywhere."
 *
 * The rule, exactly: while typing NORMALLY a member sees no "N / 2200".
 * The ONE deliberate exception is being OVER the limit — there the send/save
 * button is disabled, and a disabled control with no explanation is the
 * silent-dead-button failure WORKING_RULES §6 bans. So each surface may render
 * a line ONLY when over the limit, telling the member what to do.
 *
 * Three member-facing surfaces had the counter: MentionInput (all 11 comment
 * boxes), PostCard's caption editor, and the WallPosts composer.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test-utils/sourceText";

const read = (p: string) =>
  // stripComments, not a hand-rolled regex: `accept="image/*"` in this very
  // file opened a fake block comment that swallowed 400 lines of real code,
  // and the assertions below then ran against source that was not there.
  stripComments(readFileSync(join(process.cwd(), p), "utf8"));

describe("no running character counter while typing", () => {
  it("MentionInput shows its limit line only when over the limit", () => {
    const s = read("src/components/MentionInput.tsx");
    // The always-on gate that produced "55 / 2200" must be gone…
    expect(s).not.toMatch(/value\.length > 0 && \(/);
    // …and the remaining line must be gated on overLimit alone.
    expect(s).toMatch(/\{overLimit && \(/);
  });

  it("PostCard's caption editor shows its limit line only when over the limit", () => {
    const s = read("src/components/post/PostCard.tsx");
    expect(s).not.toMatch(/editDraft\.length > 0 && \(/);
    expect(s).toMatch(/\{editDraft\.length > 2200 && \(/);
  });

  it("the WallPosts composer shows its limit line only when over the limit", () => {
    const s = read("src/components/WallPosts.tsx");
    expect(s).not.toMatch(/newContent\.length > 0 && \(\s*<div/);
    expect(s).toMatch(/\{newContent\.length > 2200 && \(/);
  });

  it("no member surface renders the running 'length} / 2200' pattern", () => {
    for (const p of [
      "src/components/MentionInput.tsx",
      "src/components/post/PostCard.tsx",
      "src/components/WallPosts.tsx",
    ]) {
      // "N / 2200" as a live progress readout is what the owner banned.
      expect(read(p), `${p} still renders a running counter`).not.toMatch(/length\} \/ 2200\{/);
    }
  });
});
