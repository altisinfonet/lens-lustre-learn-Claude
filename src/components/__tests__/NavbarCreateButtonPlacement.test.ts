/**
 * The "+ Create" control shipped in build 1086 sitting in the MIDDLE of the app
 * top bar, overlapping the centred "50mm Retina World" wordmark. The owner asked
 * for it in the LEFT corner.
 *
 * The cause was layout, not a coordinate. The bar is `justify-between`, and on
 * the app the logo <Link> collapses to ZERO width — both its <img> and its
 * wordmark are `hidden lg:*`. As separate flex children, `justify-between`
 * spread them as [0-width Link] … [+ Create] … [actions], which parks + Create
 * in the middle. Wrapping the Link and the button in ONE element makes them one
 * flex item, pinned left.
 *
 * These tests assert the wrapper survives, because the visual symptom only
 * appears in the native app on a narrow screen — the place nobody looks at
 * during a refactor.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/components/Navbar.tsx"), "utf8");

const OPEN = "── THE LEFT-HAND GROUP";
const CLOSE = "── end of the left-hand group ──";
const CENTRED_WORDMARK = "absolute left-1/2 top-1/2 -translate-x-1/2";
const CREATE_NAV = '"/feed?compose=1"';

describe("the + Create button is pinned to the left of the app top bar", () => {
  it("keeps the left-hand group wrapper", () => {
    expect(src).toContain(OPEN);
    expect(src).toContain(CLOSE);
    expect(src.indexOf(OPEN)).toBeLessThan(src.indexOf(CLOSE));
  });

  it("holds BOTH the logo link and the Create button inside that wrapper", () => {
    const group = src.slice(src.indexOf(OPEN), src.indexOf(CLOSE));
    // The zero-width Link is exactly why the wrapper is needed; if someone
    // moves either one out, justify-between recreates the centre bug.
    expect(group).toContain("to={logoHref}");
    expect(group).toContain(CREATE_NAV);
  });

  it("closes the wrapper BEFORE the absolutely-centred wordmark", () => {
    // If the wordmark ended up inside the left group it would stop being
    // centred on the whole bar, which is the opposite mistake.
    expect(src.indexOf(CLOSE)).toBeLessThan(src.indexOf(CENTRED_WORDMARK));
  });

  it("⚠ shows NO visible 'Create' caption — icon only", () => {
    // Owner, 2026-08-14. The caption made the control two lines tall, which is
    // what pushed it into the wordmark. The name lives on aria-label instead.
    const btn = src.slice(src.indexOf(CREATE_NAV), src.indexOf(CLOSE));
    expect(btn).not.toMatch(/>\s*\{t\("composer\.create", "Create"\)\}\s*</);
    expect(btn).toContain('aria-label={t("composer.create", "Create post")}');
  });

  it("stays app-only — off desktop AND off the mobile website", () => {
    const btn = src.slice(src.indexOf("+ CREATE"), src.indexOf(CLOSE));
    expect(btn).toContain("isNativeCapacitorApp()");
    expect(btn).toContain("lg:hidden");
  });
});
