import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "@/test-utils/sourceText";

/**
 * SEARCH MUST NOT BE ABLE TO FREEZE THE WHOLE APP.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER REPORT, build 1058, 2026-08-09, on the Android app:
 *
 *   "search on app still not working. entire app is freezing and hanging,
 *    even not a click or touch working while no result on search."
 *
 * Only restarting the app cleared it.
 *
 * THIS IS THE SAME DEFECT AS NotificationBell, 2026-08-01 — see
 * NotificationBellDismiss.test.tsx for the production measurements. Summarised:
 * `<AnimatePresence>` keeps an exiting child MOUNTED until its exit animation
 * reports completion. On the Android webview that completion may never arrive
 * (the webview suspends the animation), so the panel stays in the DOM with
 * `pointer-events: auto` and silently eats every tap that lands on it.
 *
 * WHY IT PRESENTED AS "THE ENTIRE APP IS FROZEN" RATHER THAN A SEARCH BUG:
 * NotificationBell's stranded panel was 304x456 in one corner, so it ate only
 * the taps inside that rectangle. The search panel is `fixed inset-0` — the
 * FULL SCREEN. The identical failure therefore eats EVERY tap on every page.
 *
 * It also explains why build 1058 did not fix it. The freeze had been
 * attributed to the image retry storm; images were fixed and the retry capped,
 * and the freeze survived — because it was never a network problem at all. It
 * is an unmount that never happens.
 *
 * THE RULE THIS FILE ENFORCES:
 *
 *   Removing the search panel must never depend on an animation completing.
 *
 * These read the source rather than driving framer-motion, because what has to
 * hold is the SHAPE of the component: no AnimatePresence, no `exit` prop. A
 * behavioural test would have to fake the very animation engine whose failure
 * is the bug.
 */
const SRC = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/GlobalSearch.tsx"),
  "utf8",
);

/** Comments explain WHY the pattern is banned; they must not count as usage. */
const CODE = stripComments(SRC);

describe("the search panel unmounts without waiting for an animation", () => {
  it("does not import AnimatePresence", () => {
    // Not importing it is the cheapest possible guard: the banned pattern
    // cannot be reintroduced by an autocomplete that adds the JSX tag alone.
    expect(CODE).not.toMatch(/import\s*\{[^}]*AnimatePresence[^}]*\}\s*from\s*["']framer-motion["']/);
  });

  it("does not wrap the panel in <AnimatePresence>", () => {
    expect(CODE).not.toContain("<AnimatePresence");
  });

  it("has no `exit` animation anywhere — that is what strands the node", () => {
    expect(CODE).not.toMatch(/\bexit\s*=\s*\{/);
  });

  it("still renders the panel behind a plain `open &&` so React can remove it", () => {
    // Plain conditional rendering is the mechanism that cannot fail: it is
    // reconciliation, not an animation callback.
    expect(CODE).toMatch(/\{open && \(/);
  });

  it("keeps the entrance animation — it never gates unmount", () => {
    // Losing the fade-OUT is the accepted price; the fade-IN is harmless
    // because a mount that animates is still a mount.
    expect(CODE).toMatch(/initial=\{\{/);
    expect(CODE).toMatch(/animate=\{\{/);
  });

  it("the panel is still full-screen on mobile — which is WHY this matters", () => {
    // If this ever stops being fixed inset-0 the stakes drop, but while it is
    // full-screen a stranded node is an app-wide freeze, not a local annoyance.
    expect(CODE).toContain("fixed inset-0");
  });

  it("still closes on navigation — the independent second layer", () => {
    // A single mechanism is one delivery failure away from a stuck overlay;
    // see useDismissOnRouteChange for the two real incidents behind this.
    expect(CODE).toContain("useDismissOnRouteChange");
  });
});
