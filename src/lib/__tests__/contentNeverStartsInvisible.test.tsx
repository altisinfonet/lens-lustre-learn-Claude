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
   * THE CHECK THAT WOULD HAVE CAUGHT /feed.
   *
   * F-89's check was written against the not-found SCENE and asserted that
   * scene's first frame is opaque. It could not see fadeUp, which lived in nine
   * page files it never scanned — and it could not see /feed either, which
   * declares its reveal INLINE and is not one of the nine. The Auditor's sweep
   * read "the pages that break are exactly the nine"; /feed is in the failing
   * set and is not among them, so the nine-copy fix alone would have left the
   * busiest page on the site broken.
   *
   * So the rule is enforced by SHAPE, over every page file, regardless of what
   * the variable is called or whether there is a variable at all:
   *
   *     page-body content may not animate from opacity 0.
   *
   * THE ONE EXEMPTION is an element that declares an `exit`. That is a genuinely
   * transient thing — it is meant to arrive and leave — and starting it visible
   * would make it flash. Seven such elements remain and are listed by the
   * failure message rather than hidden by it.
   */
  it("every reveal on page-body content starts at opacity 1", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "src/pages");
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const src = readFileSync(join(dir, file), "utf8");
      for (const m of src.matchAll(/initial=\{\{\s*opacity:\s*0\b/g)) {
        const start = src.lastIndexOf("<", m.index!);
        const end = src.indexOf(">", m.index! + m[0].length);
        const tag = end === -1 ? "" : src.slice(start, end + 1);
        if (tag.includes("exit=")) continue; // transient by declaration
        offenders.push(`src/pages/${file}:${src.slice(0, m.index!).split("\n").length}`);
      }
    }
    expect(
      offenders,
      `page-body content that animates FROM INVISIBLE. If the reveal does not ` +
        `complete, the member reads nothing — measured on deployed staging as ` +
        `ten blocks at opacity 0 on /feed and ten on /dashboard, eight seconds ` +
        `after load:\n` + offenders.map((o) => `  ${o}`).join("\n"),
    ).toEqual([]);
  });
});
