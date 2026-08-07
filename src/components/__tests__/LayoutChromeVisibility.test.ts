import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Owner requirement, 2026-08-07:
 *  - "Ask anything" shows on the HOME page only, on BOTH app and web.
 *  - The site footer (policy-links menu) shows on the home page only INSIDE THE
 *    APP; on the web it is unchanged (every page).
 *  - The bottom tab bar is primary navigation and must stay on every page.
 *
 * These read the source (the repo's established test style) so an accidental
 * edit that puts the support bubble back on every screen, or hides the footer
 * on the web, fails loudly.
 */
const SRC = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/Layout.tsx"),
  "utf8",
);

describe("Layout chrome visibility", () => {
  it("Ask Anything is gated on the home page", () => {
    // Must be `isHome && ... <AskAnything />`, never just `!hideNav && <AskAnything/>`.
    expect(SRC).toMatch(/isHome[^\n]*<AskAnything\s*\/>/);
    expect(SRC).not.toMatch(/\{!hideNav && <AskAnything\s*\/>\}/);
  });

  it("the site footer is home-only in the app but unrestricted on the web", () => {
    // The web must still see it: the guard includes `!isNativeCapacitorApp()`.
    expect(SRC).toMatch(/\(isHome \|\| !isNativeCapacitorApp\(\)\) && <SiteFooter\s*\/>/);
  });

  it("the bottom tab bar stays on every page — it is primary navigation", () => {
    // MobileBottomNav must NOT be wrapped in an isHome guard here.
    expect(SRC).toMatch(/\n\s*<MobileBottomNav\s*\/>/);
    expect(SRC).not.toMatch(/isHome[^\n]*<MobileBottomNav/);
  });
});
