/**
 * NO TEXT ON THIS SITE IS SMALLER THAN 12px.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE, and who set it
 *
 * Owner, 2026-08-10, asked which floor to use and chose: **nothing below 12px**.
 * That is Android Material's smallest body style; iOS asks for 11pt. It is a
 * product rule about what a member can read, not a styling preference.
 *
 * WHAT WAS MEASURED BEFORE IT WAS SET
 *   Live feed, 2026-08-03: of 168 visible text elements, 70 — 42% — rendered
 *   below 12px. Forty-one at 9px. Six at 7px. Body 14px at line-height 1.34.
 *   Source, 2026-08-10, counted by property rather than by hand:
 *     10px ×1137 · 9px ×928 · 11px ×277 · 8px ×203 · 7px ×39 · 8.5px ×3
 *     10.5px ×2 · 6px ×2   =  2,591 places across 246 files.
 *
 * HOW THE RULE IS ENFORCED
 *   One block at the end of src/index.css raises every sub-12px utility to
 *   12px. That is a floor, not a rename — the class still says what the author
 *   asked for, the product overrides how small it is allowed to get.
 *
 * WHY THIS TEST EXISTS
 *   A floor written as a fixed list of selectors has one failure mode: somebody
 *   writes `text-[5px]` next month, the list does not mention it, and it ships
 *   unreadable with nothing going red. So this test does not check the list —
 *   it re-derives the list from the source every run and fails if the CSS is
 *   missing even one.
 *
 *   The same mistake was made on this project once already, in a different
 *   costume: the mojibake scan was first written against a hand-written list of
 *   known bad characters and was 45% incomplete. Enumerate by property, never
 *   by memory.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The floor, in pixels. Owner's decision, 2026-08-10. */
const FLOOR_PX = 12;

/** Body line-height. Instagram and LinkedIn sit at 1.4–1.5; 1.34 was too tight. */
const MIN_BODY_LINE_HEIGHT = 1.4;

/**
 * Test files are skipped, for one measured reason: on its first run this scan
 * flagged ITS OWN prose, because the sentence explaining the failure mode names
 * a size. Nothing inside a __tests__ folder is rendered to a member, so the
 * floor does not apply there — and a detector that trips over its own
 * documentation is a detector nobody will keep.
 */
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git", "__tests__"]);
const EXTS = /\.(tsx?|jsx?)$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (EXTS.test(name)) out.push(full);
  }
  return out;
}

/**
 * Every arbitrary-value font-size utility in the source, with any variant
 * prefix it carries (`md:text-[10px]` counts separately from `text-[10px]`,
 * because Tailwind emits them as two different class names).
 */
const CLASS_RE = /(?:^|[\s"'`{])((?:[a-z0-9-]+:)*)text-\[(\d+(?:\.\d+)?)px\]/g;

interface Usage {
  /** The full class as written, e.g. "md:text-[10px]". */
  cls: string;
  px: number;
  files: Set<string>;
  count: number;
}

function collectUsages(): Map<string, Usage> {
  const found = new Map<string, Usage>();
  const root = join(process.cwd(), "src");
  for (const file of sourceFiles(root)) {
    const src = readFileSync(file, "utf8");
    CLASS_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CLASS_RE.exec(src)) !== null) {
      const cls = `${m[1]}text-[${m[2]}px]`;
      const px = parseFloat(m[2]);
      const rel = file.slice(process.cwd().length + 1);
      const existing = found.get(cls);
      if (existing) {
        existing.files.add(rel);
        existing.count += 1;
      } else {
        found.set(cls, { cls, px, files: new Set([rel]), count: 1 });
      }
    }
  }
  return found;
}

/** Turn `md:text-[10px]` into the CSS selector Tailwind emits for it. */
function selectorFor(cls: string): string {
  return `.${cls.replace(/[:.[\]]/g, (c) => `\\${c}`)}`;
}

const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");

describe("the readability floor — no member ever gets text under 12px", () => {
  it("covers every sub-12px size that exists in the source", () => {
    const below = [...collectUsages().values()]
      .filter((u) => u.px < FLOOR_PX)
      .sort((a, b) => a.px - b.px);

    const uncovered = below.filter((u) => !css.includes(selectorFor(u.cls)));

    expect(
      uncovered.map(
        (u) =>
          `${u.cls} — ${u.count} use(s) in ${u.files.size} file(s), first: ${[...u.files][0]}\n` +
          `      Nothing in src/index.css raises it to ${FLOOR_PX}px, so it ships at ${u.px}px.\n` +
          `      Add "${selectorFor(u.cls)}" to the P8 readability-floor block at the end of that file.`,
      ),
    ).toEqual([]);
  });

  it("actually sets the floor to 12px, not to some smaller compromise", () => {
    // Guards the other direction: the block could exist and still be wrong.
    const block = css.slice(css.indexOf("P8 — THE READABILITY FLOOR"));
    expect(block).toMatch(/font-size:\s*12px/);
    // No rule inside the floor block may set anything under the floor.
    const sizes = [...block.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => parseFloat(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter((s) => s < FLOOR_PX)).toEqual([]);
  });

  it("gives body text room to breathe between lines", () => {
    // Headings stay tight on purpose — this only pins the body rule.
    const bodyBlock = css.slice(css.indexOf("\n  body {"), css.indexOf("\n  body {") + 900);
    const lh = bodyBlock.match(/line-height:\s*([\d.]+)\s*;/);
    expect(lh, "body has no line-height in src/index.css").not.toBeNull();
    expect(parseFloat(lh![1])).toBeGreaterThanOrEqual(MIN_BODY_LINE_HEIGHT);
  });
});
