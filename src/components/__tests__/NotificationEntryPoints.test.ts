/**
 * THERE IS MORE THAN ONE WAY BACK TO YOUR NOTIFICATIONS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, checked across the whole of src/ on 2026-08-02
 *
 * `/notifications` was linked from **exactly one place in the entire app**: the
 * bell panel's own footer. Dismiss the panel — which it now does eagerly, on
 * every route change, Escape and outside tap, because of Stage 1 — and a member
 * had no route back to their own history. On a phone the panel is the only
 * surface that ever mentioned it.
 *
 * A screen with one entrance, behind a thing designed to close itself, is a
 * screen most members will never see twice.
 *
 * This test counts the entrances. It fails if the app goes back to one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every source file under src/, excluding tests. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "test") continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const ROOT = join(process.cwd(), "src");
const files = sourceFiles(ROOT);

/** Files that link to /notifications, ignoring the route definition itself. */
const linkers = files.filter((f) => {
  if (f.endsWith(join("src", "App.tsx"))) return false; // the <Route>, not a link
  const src = readFileSync(f, "utf8")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return /["'`]\/notifications["'`]/.test(src);
});

const base = (f: string) => f.slice(ROOT.length + 1);

describe("the history screen is reachable", () => {
  it("is linked from more than just the bell panel", () => {
    // Before 2026-08-02 this list was exactly ["components/NotificationBell.tsx"].
    expect(linkers.length).toBeGreaterThan(1);
  });

  it("is reachable from the desktop account menu", () => {
    expect(linkers.map(base)).toContain(join("components", "UserMenu.tsx"));
  });

  it("is reachable on a phone without opening the bell", () => {
    // The mobile profile sheet is the phone's account menu. The bell panel is
    // NOT a substitute: it closes on every navigation by design.
    expect(linkers.map(base)).toContain(join("components", "MobileProfileSheet.tsx"));
  });

  it("still offers it from the bell, which is where people look first", () => {
    expect(linkers.map(base)).toContain(join("components", "NotificationBell.tsx"));
  });
});
