/**
 * ONE FUNNEL: A POST IS DRAWN IN EXACTLY ONE PLACE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER, 2026-08-15, after opening a post from his wall and finding the OLD
 * layout on a post whose feed card had already changed:
 *
 *   "you are not maintaing one funnel - that is again creating issues multi
 *    funnel for same result... Again damaging rule established"
 *
 * He was right, and the damage was not theoretical. `src/pages/PostDetail.tsx`
 * held ~150 lines that drew the same post a SECOND way — its own header, media,
 * counts row, reaction picker and caption. Every change had to be made twice.
 * When it was not, the same post read one way in the feed and another way when
 * opened, on a live app, in front of members.
 *
 * WHY A TEST AND NOT A PROMISE. The duplication survived because nothing
 * objected to it. The rule "one funnel" existed only in the owner's head and my
 * memory, and my memory is exactly what failed. This file makes the build
 * refuse it, so a second post card cannot be written by accident again — by me,
 * or by anyone.
 *
 * WHAT IT ALLOWS, DELIBERATELY:
 *  • TYPE-ONLY imports, anywhere. `import type { ReactionType }` draws nothing;
 *    it is a name for a string. Banning it would push people to widen types to
 *    `string` to get past the gate, which is worse than the problem.
 *  • A short allowlist, each entry with a WRITTEN reason. An advertisement and
 *    a story are not posts; forcing them through PostCard would be dogma, not
 *    design. But they are NAMED here, so the question stays visible instead of
 *    dissolving back into "somebody probably thought about it".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

/**
 * The two modules that MAKE a post look like a post: the control that sets a
 * reaction, and the figures under it. If a file pulls either of these as a
 * value, it is drawing post furniture.
 */
const RESTRICTED = [
  { module: "@/components/ReactionPicker", drawn: "the reaction control" },
  { module: "@/lib/displayEngagement", drawn: "the reach/viewed figures" },
];

/** The one place a post is allowed to be drawn. */
const HOME = "src/components/post/";

/**
 * Everything else that may hold these, and why. Add to this list ONLY with a
 * sentence a person can disagree with.
 */
const ALLOWED: Record<string, string> = {
  "src/components/ReactionPicker.tsx":
    "it IS the control",
  "src/components/ReactionSummaryTooltip.tsx":
    "the detail panel the control opens — same family, opened from the card",
  "src/components/profile/ProfileStories.tsx":
    "a STORY is not a post: it expires in 24 hours and has no caption, comments or shares. NOT YET RULED ON — see docs/PATCHWORK_AUDIT.md §7",
  "src/components/ads/AdEngagementBar.tsx":
    "an ADVERTISEMENT is not a post: nobody authored it and it cannot be opened, reshared or commented on. NOT YET RULED ON — see docs/PATCHWORK_AUDIT.md §7",
};

function sourceFiles(): string[] {
  const out: string[] = [];
  (function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      if (p.includes("__tests__") || p.includes("/uiharness/")) continue;
      out.push(p.replace(root + "/", ""));
    }
  })(join(root, "src"));
  return out;
}

/**
 * A VALUE import, not a type import. `import type { X } from "m"` and
 * `import { type X } from "m"` are both type-only and draw nothing.
 */
function valueImports(src: string, module: string): boolean {
  const re = new RegExp(`^import\\s+([^;]*?)\\s+from\\s+["']${module.replace(/[/@]/g, "\\$&")}["']`, "gm");
  for (const m of src.matchAll(re)) {
    const clause = m[1].trim();
    if (clause.startsWith("type ")) continue;                 // import type { X }
    const inner = clause.replace(/^\{|\}$/g, "").trim();
    const names = inner.split(",").map((s) => s.trim()).filter(Boolean);
    // A default import (no braces) is always a value.
    if (!clause.startsWith("{")) return true;
    if (names.some((n) => !n.startsWith("type "))) return true;
  }
  return false;
}

describe("a post is drawn in exactly one place", () => {
  const files = sourceFiles();

  it("finds the source tree (a vacuity guard on this file)", () => {
    // Without this an empty list would make every check below pass by
    // examining nothing — the failure this project has already paid for twice.
    expect(files.length).toBeGreaterThan(300);
  });

  for (const { module, drawn } of RESTRICTED) {
    it(`nothing outside ${HOME} draws ${drawn}`, () => {
      const offenders = files.filter((f) => {
        if (f.startsWith(HOME)) return false;
        if (f in ALLOWED) return false;
        return valueImports(readFileSync(join(root, f), "utf8"), module);
      });
      expect(
        offenders,
        `These files draw post furniture outside ${HOME}. Render <PostCard> instead, ` +
          `or add the file to ALLOWED with a written reason.`,
      ).toEqual([]);
    });
  }

  it("PostDetail renders the card and does not redraw it", () => {
    // The specific regression this file exists for.
    const src = readFileSync(join(root, "src/pages/PostDetail.tsx"), "utf8");
    expect(src).toMatch(/<PostCard\b/);
    expect(valueImports(src, "@/components/ReactionPicker")).toBe(false);
    expect(valueImports(src, "@/lib/displayEngagement")).toBe(false);
  });

  it("every allowance carries a real reason, not a shrug", () => {
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, `${file} needs a reason someone can argue with`).toBeGreaterThan(15);
    }
  });

  it("the allowlist names only files that exist", () => {
    // An allowance for a deleted file is a hole nobody can see.
    const missing = Object.keys(ALLOWED).filter((f) => !files.includes(f));
    expect(missing).toEqual([]);
  });
});
