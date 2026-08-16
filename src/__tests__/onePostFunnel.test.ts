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

  /**
   * ─────────────────────────────────────────────────────────────────────────
   * RULED BY THE OWNER, 2026-08-15: **"keep separate"**.
   *
   * These draw likes or views, and they are NOT posts. Forcing them through
   * PostCard would be dogma rather than design — a story has no caption to
   * render, an advertisement has no author to name. The ruling is recorded
   * here, in the gate, rather than in a document nobody opens, so that the
   * next person to ask "should this be one funnel?" finds the answer and the
   * reasoning in the same place the rule is enforced.
   *
   * The list is CLOSED. Anything new that wants in has to be added here with
   * its own sentence, which is the point: the question can never again be
   * skipped by accident, only answered on purpose.
   * ─────────────────────────────────────────────────────────────────────────
   */
  "src/components/profile/ProfileStories.tsx":
    "SEPARATE, ruled 2026-08-15. A story expires in 24 hours and has no caption, no comments and no shares — there is no post to draw",
  "src/components/ads/AdEngagementBar.tsx":
    "SEPARATE, ruled 2026-08-15. Nobody authored an advertisement; it cannot be opened, reshared or commented on",
};

/**
 * The other surfaces the owner ruled SEPARATE on the same day. They do not
 * import the two modules above — they use `ImageEngagement` / `EngagementFooter`
 * — so the rule above never touched them. They are named anyway, because a
 * surface nobody has written down is exactly how PostDetail grew a second copy
 * of the post card without anyone noticing.
 */
const RULED_SEPARATE: Record<string, string> = {
  "src/components/EntryCard.tsx":
    "SEPARATE, ruled 2026-08-15. A competition entry is judged and scored and belongs to a competition, not to a feed",
  "src/components/CompetitionLightbox.tsx":
    "SEPARATE, ruled 2026-08-15. A fullscreen viewer shows ONE photograph; it is not a card",
  "src/components/Lightbox.tsx":
    "SEPARATE, ruled 2026-08-15. Same reason as CompetitionLightbox",
  "src/components/ImageEngagement.tsx":
    "SEPARATE, ruled 2026-08-15. Likes on a single photograph inside a viewer, not on a post",
  "src/components/EngagementFooter.tsx":
    "SEPARATE, ruled 2026-08-15. A generic footer used by Journal, EntryDetail and MyPhotos — none of which show posts",

  /**
   * These three were found BY THIS CENSUS on the day it was written — they use
   * the shared footer and nobody had ever ruled on them. That is the census
   * doing its job on its first run, and the reason it exists: PostDetail grew a
   * second post card precisely because no list ever named it.
   */
  "src/pages/EntryDetail.tsx":
    "SEPARATE, ruled 2026-08-15. A competition ENTRY, judged and scored — it belongs to a competition, not to a feed",
  "src/pages/Journal.tsx":
    "SEPARATE, ruled 2026-08-15. A journal ARTICLE, written and edited — it has no reactions, reshares or comment thread",
  "src/pages/MyPhotos.tsx":
    "SEPARATE, ruled 2026-08-15. A member's own PHOTO library — a photograph here may not have been posted at all",
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

  it("every surface ruled SEPARATE is named, with the reason and the date", () => {
    // Owner ruled "keep separate" on 2026-08-15. The value of writing it down
    // is not the decision — it is that the list is now CLOSED, so a new
    // surface cannot join it silently.
    for (const [file, reason] of Object.entries(RULED_SEPARATE)) {
      expect(files, `${file} is named as ruled-separate but does not exist`).toContain(file);
      expect(reason, `${file} needs the ruling and its reason`).toMatch(/SEPARATE, ruled 2026-08-15\./);
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  it("no NEW surface draws engagement without being ruled on", () => {
    /**
     * The census that closes docs/PATCHWORK_AUDIT.md §7. Every file that pulls
     * the shared engagement pieces must be either the post card, or on one of
     * the two lists above with a written reason. A new one appearing here is
     * the moment to ask the question — not months later, on the owner's phone.
     */
    const SHARED = ["@/components/ImageEngagement", "@/components/EngagementFooter"];
    const known = new Set([...Object.keys(RULED_SEPARATE), ...Object.keys(ALLOWED)]);
    const unruled = files.filter((f) => {
      if (f.startsWith(HOME) || known.has(f)) return false;
      const src = readFileSync(join(root, f), "utf8");
      return SHARED.some((m) => valueImports(src, m));
    });
    expect(
      unruled,
      "These draw engagement and nobody has ruled whether they are posts. " +
        "Render <PostCard>, or add them to RULED_SEPARATE with a reason.",
    ).toEqual([]);
  });

  it("the allowlist names only files that exist", () => {
    // An allowance for a deleted file is a hole nobody can see.
    const missing = Object.keys(ALLOWED).filter((f) => !files.includes(f));
    expect(missing).toEqual([]);
  });
});
