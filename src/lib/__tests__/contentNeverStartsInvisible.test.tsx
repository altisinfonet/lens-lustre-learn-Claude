import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { motion } from "framer-motion";
import { execSync } from "node:child_process";
import { fadeUp } from "@/lib/motionVariants";

/**
 * F-99 / F-89 AS A CLASS — CONTENT MUST NEVER ANIMATE FROM INVISIBLE.
 *
 * Both P0s had the same signature: an element stranded mid-animation at a
 * fractional opacity, inline `opacity: 0; transform: translateY(...)`, not
 * moving. The 404 at 0.567406. /friends at 0.530973 and 0.127284, sampled three
 * times over three seconds. In both cases the content was fully present in the
 * DOM and unreadable.
 *
 * Fixing F-89 fixed ONE INSTANCE. There was no shared variant to fix, so seven
 * pages each carried their own copy and the pattern survived. This asserts the
 * rule at the only place it can now be broken.
 */
describe("the shared reveal starts visible", () => {
  it("hidden is opacity 1 — an interrupted animation strands a READABLE frame", () => {
    expect((fadeUp.hidden as { opacity: number }).opacity).toBe(1);
  });

  it("it still moves, so the reveal is not simply deleted", () => {
    expect((fadeUp.hidden as { y: number }).y).toBeGreaterThan(0);
  });

  it("the visible state is reachable and ends at rest", () => {
    const visible = (fadeUp.visible as (i: number) => { opacity: number; y: number })(0);
    expect(visible.opacity).toBe(1);
    expect(visible.y).toBe(0);
  });

  it("content rendered through it is readable in its FIRST frame", () => {
    // The member's experience, not the variant's declaration: if the animation
    // never advances past frame one, this is what they are looking at.
    const { getByText } = render(
      <motion.div initial="hidden" animate="visible" variants={fadeUp} custom={0}>
        <p>Followers (515)</p>
      </motion.div>,
    );
    const el = getByText("Followers (515)");
    const box = el.closest("div");
    const opacity = box?.style.opacity;
    expect(opacity === "" || opacity === "1", `first frame opacity was ${opacity}`).toBe(true);
  });
});

describe("no page may declare its own copy of it", () => {
  it("the seven local fadeUp definitions are gone", () => {
    /*
     * This is the assertion that would have prevented F-99. F-89 was fixed in
     * PageTransition and the same pattern sat untouched in seven pages, because
     * nothing tied them together. A local copy is how the rule gets broken
     * again without anyone editing the rule.
     */
    /*
     * ⚠ THE PATTERN IS DELIBERATELY SHAPE-BLIND, because the first version was
     * not and missed two. `grep 'const fadeUp = {'` found seven of nine: it
     * could not see Index.tsx's `const fadeUp: Variants = {` (a type
     * annotation) or PublicProfile.tsx's `const fadeUp = (delay = 0) => ({`
     * (a FUNCTION returning motion props rather than a variants object). Same
     * defect as C-87 for the fifth time — a pattern that cannot match the shape
     * that survives it. Matching the NAME and nothing else is what makes it
     * unevadable.
     */
    const hits = execSync(
      `grep -rlE '(const|let)[[:space:]]+fadeUp\\b' src --include=*.tsx --include=*.ts ` +
        `| grep -v __tests__ | grep -v motionVariants || true`,
      { cwd: process.cwd(), encoding: "utf8" },
    )
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(
      hits,
      `these files declare their own reveal variant instead of importing the ` +
        `shared one, which is how F-89's fix failed to reach F-99's page:\n` +
        hits.map((h) => `  ${h}`).join("\n"),
    ).toEqual([]);
  });
});

describe("no page body starts invisible, on any route", () => {
  /**
   * NAME-INDEPENDENT AND SHAPE-COMPLETE, because the first version was neither.
   *
   * v1 asserted two things: that no file declares a local `fadeUp`, and that no
   * JSX prop reads `initial={{ opacity: 0`. It missed Index.tsx's `fadeIn` — a
   * SECOND variant four lines below the import in a file I had just edited,
   * wrapping real page copy ("A curated collection of moments frozen in time")
   * with a 1.4s duration and a 0.2s stagger, WORSE than the one I fixed. It
   * also missed Dashboard.tsx's `tabContent`. Both are variant OBJECTS, so no
   * amount of scanning JSX props reaches them, and both are named something
   * other than fadeUp, so a name-scoped rule walks straight past.
   *
   * The eleventh copy will be called something else again. So this matches on
   * SHAPE ONLY: any object literal that parks opacity at 0 in its starting
   * state, and any JSX prop that does the same.
   *
   * ⚠ AND `exit` IS NOT AN EXEMPTION. v1 treated any element declaring an exit
   * as transient, which was wrong and let three tab panels and a member list
   * through. F-89's own fix kept its exit and changed only the initial — fading
   * OUT on the way to somewhere else is fine, starting invisible is not.
   *
   * The real distinction is SUMMONED vs ALWAYS PRESENT. A modal, a lightbox, a
   * back-to-top button, a new-posts banner and an expanding filter panel do not
   * exist until an action creates them; they are guarded by a conditional or
   * are fixed inset overlays, and starting them visible would make them flash.
   * A tab panel, a list item and page copy are always there — if their reveal
   * strands, the member is looking at a blank page.
   */
  // The `m` flag matters: without it `$` anchors to the end of the whole
  // slice, not each line, and every conditionally-guarded overlay reads as
  // page body. Caught by this check over-flagging Feed's new-posts banner and
  // back-to-top button, both of which the Auditor had sorted correctly.
  const SUMMONED = /&&\s*\(\s*$|fixed inset-0|z-\[100\]/m;

  /**
   * Elements INSIDE a summoned container, which no backward line scan can see.
   * Listed explicitly rather than matched loosely, so each is auditable:
   *   SubmissionDetail.tsx:177 — interior of the fixed inset-0 z-[100] overlay
   *                              opened at :151. The overlay is summoned; its
   *                              contents cannot outlive it.
   */
  const INSIDE_SUMMONED = new Set(["src/pages/SubmissionDetail.tsx:177"]);

  it("no variant object and no JSX prop starts page-body content at opacity 0", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "src/pages");
    const offenders: string[] = [];

    for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const src = readFileSync(join(dir, file), "utf8");
      const lines = src.split("\n");

      // (a) variant OBJECTS, any name: { hidden: { opacity: 0 } } / { initial: ... }
      for (const m of src.matchAll(/(hidden|initial)\s*:\s*\{[^}]*opacity:\s*0\b/g)) {
        offenders.push(`src/pages/${file}:${src.slice(0, m.index!).split("\n").length}  variant object`);
      }

      // (b) JSX props, unless the element is SUMMONED rather than always present
      for (const m of src.matchAll(/initial=\{\{\s*opacity:\s*0\b/g)) {
        const lineNo = src.slice(0, m.index!).split("\n").length;
        const start = src.lastIndexOf("<", m.index!);
        const end = src.indexOf(">", m.index! + m[0].length);
        const tag = end === -1 ? "" : src.slice(start, end + 1);
        const before = lines.slice(Math.max(0, lineNo - 4), lineNo - 1).join("\n");
        if (SUMMONED.test(before) || SUMMONED.test(tag)) continue;
        if (INSIDE_SUMMONED.has(`src/pages/${file}:${lineNo}`)) continue;
        offenders.push(`src/pages/${file}:${lineNo}  jsx prop`);
      }
    }

    expect(
      offenders,
      `page-body content that animates FROM INVISIBLE. If the reveal does not ` +
        `complete the member reads nothing — measured on deployed staging as ten ` +
        `blocks at opacity 0 on /feed and ten on /dashboard:\n` +
        offenders.map((o) => `  ${o}`).join("\n"),
    ).toEqual([]);
  });
});
